// app/api/loan-indexes/[indexId]/index-sheet/route.ts
import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { compareMemberIds } from '@/app/lib/member-id-sort';
import { getRoleDisplayName } from '@/app/lib/role-display';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loan-indexes/[indexId]/index-sheet
 * Get details for the loan index sheet (numbered format)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { indexId } = await params;

            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
                include: {
                    center: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            address: true,
                            meetingDay: true,
                            meetingPlace: true,
                            contactPerson: true,
                            contactNumber: true,
                            fdo: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                    employeeId: true,
                                    mobileNumber: true,
                                    role: true,
                                }
                            },
                            centerLeader: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                }
                            }
                        }
                    },
                    branch: {
                        select: {
                            name: true,
                            code: true,
                            address: true,
                        }
                    },
                    createdBy: {
                        select: {
                            firstName: true,
                            lastName: true,
                            employeeId: true,
                        }
                    },
                    loans: {
                        where: { isActive: true },
                        include: {
                            client: {
                                select: {
                                    clientId: true,
                                    firstName: true,
                                    lastName: true,
                                    dateOfBirth: true,
                                    mobileNumber: true,
                                    permanentAddress: true,
                                    highmarkReports: {
                                        orderBy: { pulledAt: 'desc' },
                                        take: 1,
                                        select: { creditScore: true, status: true },
                                    },
                                }
                            },
                            loanPurpose: {
                                select: { name: true }
                            },
                        },
                        orderBy: {
                            createdAt: 'asc',
                        }
                    }
                }
            });

            if (!loanIndex) {
                return errorResponse('Loan index not found', 404);
            }

            // Natural member-ID order (29-96-1-2 before 29-96-1-10); createdAt order stays the tiebreaker (stable sort).
            loanIndex.loans.sort((a, b) => compareMemberIds(a.client.clientId, b.client.clientId));

            const [bmUser, amUser] = await Promise.all([
                prisma.user.findFirst({
                    where: {
                        isActive: true,
                        OR: [
                            { role: 'BRANCH_MANAGER', branchId: loanIndex.branchId },
                            {
                                userRoles: {
                                    some: {
                                        branchId: loanIndex.branchId,
                                        isActive: true,
                                        role: { slug: 'branch-manager', isActive: true },
                                    },
                                },
                            },
                        ],
                    },
                    select: { firstName: true, lastName: true, mobileNumber: true, role: true },
                }),
                prisma.user.findFirst({
                    where: {
                        isActive: true,
                        OR: [
                            {
                                areaManagerBranches: {
                                    some: { branchId: loanIndex.branchId },
                                },
                            },
                            {
                                userRoles: {
                                    some: {
                                        branchId: loanIndex.branchId,
                                        isActive: true,
                                        role: { slug: 'area-manager', isActive: true },
                                    },
                                },
                            },
                        ],
                    },
                    select: { firstName: true, lastName: true, mobileNumber: true, role: true },
                }),
            ]);

            // Calculate center outstanding, arrear and member counts for the WHOLE CENTER
            // (every loan/member in the center, not just this index's own batch — the query
            // below is scoped by centerId, not indexId), as a snapshot as of this index's
            // creation date.
            const indexCreationTime = loanIndex.createdAt;
            const centerMetrics = await prisma.$transaction(async (tx) => {
                // Active Members = every fully-approved, active client enrolled in this
                // center (the full member roster), not just clients who happen to have a
                // disbursed loan, and excluding clients still in the approval pipeline.
                const activeMembers = await tx.client.count({
                    where: { centerId: loanIndex.centerId, isActive: true, approvalStatus: 'APPROVED' },
                });

                const activeLoansInCenter = await tx.loan.findMany({
                    where: {
                        centerId: loanIndex.centerId,
                        isActive: true,
                        disbursementStatus: 'DISBURSED',
                        createdAt: { lt: indexCreationTime },
                    },
                    select: { id: true, clientId: true }
                });

                const loanIds = activeLoansInCenter.map(l => l.id);

                if (loanIds.length === 0) {
                    return { outstanding: 0, arrear: 0, activeMembers, arrearMembers: 0 };
                }

                const loanIdToClientId = new Map(activeLoansInCenter.map(l => [l.id, l.clientId]));

                // Calculate Outstanding: Sum of (principalDue - principalPaid) for all schedules
                const schedules = await tx.loanSchedule.aggregate({
                    where: {
                        loanId: { in: loanIds },
                    },
                    _sum: {
                        principalDue: true,
                        principalPaid: true,
                    }
                });

                const outstanding = Math.max(0, Number(schedules._sum.principalDue || 0) - Number(schedules._sum.principalPaid || 0));

                // Calculate Arrears: Sum of (totalDue - totalPaid) for schedules overdue as of index creation time
                const arrearsScheduleRows = await tx.loanSchedule.findMany({
                    where: {
                        loanId: { in: loanIds },
                        dueDate: { lt: indexCreationTime },
                        status: { not: 'PAID' }
                    },
                    select: { loanId: true, totalDue: true, totalPaid: true }
                });

                const arrear = Math.max(
                    0,
                    arrearsScheduleRows.reduce((s, row) => s + Number(row.totalDue) - Number(row.totalPaid), 0)
                );
                const arrearMembers = new Set(
                    arrearsScheduleRows.map(row => loanIdToClientId.get(row.loanId))
                ).size;

                return { outstanding, arrear, activeMembers, arrearMembers };
            });

            // Batch: per-client arrear, outstanding, and loan cycle
            const clientIds = loanIndex.loans.map(l => l.clientId);
            const allDisbursedLoans = await prisma.loan.findMany({
                where: {
                    clientId: { in: clientIds },
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                },
                select: { id: true, clientId: true, amount: true, principalPaid: true }
            });

            const disbursedLoanIds = allDisbursedLoans.map(l => l.id);
            let arrearScheduleRows: { loanId: string; totalDue: any; totalPaid: any }[] = [];
            if (disbursedLoanIds.length > 0) {
                arrearScheduleRows = await prisma.loanSchedule.findMany({
                    where: {
                        loanId: { in: disbursedLoanIds },
                        dueDate: { lt: new Date() },
                        status: { not: 'PAID' },
                    },
                    select: { loanId: true, totalDue: true, totalPaid: true }
                });
            }

            const disbursedByClient = new Map<string, typeof allDisbursedLoans>();
            allDisbursedLoans.forEach(l => {
                if (!disbursedByClient.has(l.clientId)) disbursedByClient.set(l.clientId, []);
                disbursedByClient.get(l.clientId)!.push(l);
            });

            const arrearByLoanId = new Map<string, number>();
            arrearScheduleRows.forEach(s => {
                arrearByLoanId.set(
                    s.loanId,
                    (arrearByLoanId.get(s.loanId) || 0) + Number(s.totalDue) - Number(s.totalPaid)
                );
            });

            // Calculate age from dateOfBirth
            const calculateAge = (dateOfBirth: Date | null): number | null => {
                if (!dateOfBirth) return null;
                const today = new Date();
                const birthDate = new Date(dateOfBirth);
                let age = today.getFullYear() - birthDate.getFullYear();
                const monthDiff = today.getMonth() - birthDate.getMonth();

                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                return age;
            };

            // Format loans with sequential numbers and per-client metrics
            const loans = loanIndex.loans.map((loan, index) => {
                const clientDisbursed = disbursedByClient.get(loan.clientId) || [];
                const outstanding = Math.max(
                    0,
                    clientDisbursed.reduce((s, l) => s + Number(l.amount) - Number(l.principalPaid), 0)
                );
                const arrear = Math.max(
                    0,
                    clientDisbursed.reduce((s, l) => s + (arrearByLoanId.get(l.id) || 0), 0)
                );
                const loanCycle = clientDisbursed.length + 1;

                const latestHm = (loan.client as any).highmarkReports?.[0];
                return {
                    serialNo: index + 1,
                    id: loan.id,
                    loanNumber: loan.loanNumber,
                    clientId: loan.client.clientId,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    clientMobile: loan.client.mobileNumber,
                    clientAddress: loan.client.permanentAddress,
                    highmarkScore: latestHm?.creditScore ?? null,
                    highmarkStatus: latestHm?.status || 'N/A',
                    age: calculateAge(loan.client.dateOfBirth),
                    amount: Number(loan.amount),
                    purpose: loan.loanPurpose?.name || 'N/A',
                    frequency: loan.frequency || 'N/A',
                    tenureMonths: loan.tenureMonths,
                    interestRate: Number(loan.interestRate),
                    disbursementStatus: loan.disbursementStatus,
                    arrear,
                    outstanding,
                    loanCycle,
                };
            });

            // Format dates
            const formatDate = (date: Date) => {
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();
                return `${day}/${month}/${year}`;
            };

            const data = {
                indexNo: loanIndex.indexNo,
                indexDate: formatDate(loanIndex.indexDate),
                createdAt: formatDate(loanIndex.createdAt),
                centerCode: loanIndex.center.code,
                centerName: loanIndex.center.name,
                centerAddress: loanIndex.center.address || '',
                centerContactPerson: loanIndex.center.contactPerson || '',
                centerMobile: loanIndex.center.contactNumber || '',
                centerMeetingDay: loanIndex.center.meetingDay || 'FRIDAY',
                centerMeetingPlace: loanIndex.center.meetingPlace || loanIndex.center.address || 'SEM MANAT HAM',
                centerLeader: (loanIndex.center as any).centerLeader ?
                    `${(loanIndex.center as any).centerLeader.firstName} ${(loanIndex.center as any).centerLeader.lastName}` : 'N/A',
                branchName: loanIndex.branch.name,
                branchCode: loanIndex.branch.code,
                branchAddress: loanIndex.branch.address,
                createdBy: loanIndex.createdBy ?
                    `${loanIndex.createdBy.firstName} ${loanIndex.createdBy.lastName}` : 'N/A',
                createdByEmployeeId: loanIndex.createdBy?.employeeId,
                fdoName: loanIndex.center.fdo ?
                    `${loanIndex.center.fdo.firstName} ${loanIndex.center.fdo.lastName}` : 'N/A',
                fdoEmployeeId: loanIndex.center.fdo?.employeeId,
                fdoMobile: loanIndex.center.fdo?.mobileNumber ?? null,
                fdoRole: loanIndex.center.fdo ? getRoleDisplayName(loanIndex.center.fdo) : null,
                bmName: bmUser ? `${bmUser.firstName} ${bmUser.lastName}` : null,
                bmMobile: bmUser?.mobileNumber ?? null,
                bmRole: bmUser ? getRoleDisplayName(bmUser) : null,
                amName: amUser ? `${amUser.firstName} ${amUser.lastName}` : null,
                amMobile: amUser?.mobileNumber ?? null,
                amRole: amUser ? getRoleDisplayName(amUser) : null,
                centerOutstanding: centerMetrics.outstanding,
                centerArrear: centerMetrics.arrear,
                activeMembers: centerMetrics.activeMembers,
                arrearMembers: centerMetrics.arrearMembers,
                totalApps: loanIndex.totalApps,
                totalAmount: Number(loanIndex.totalAmount),
                frequency: loanIndex.frequency,
                loans,
            };

            return successResponse(data, 'Loan index sheet data retrieved successfully');
        } catch (error) {
            console.error('Error fetching loan index sheet:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loan index sheet',
                500
            );
        }
    })(request);
}