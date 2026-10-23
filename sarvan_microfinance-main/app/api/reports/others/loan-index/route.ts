import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Cookie-free core, split out of the GET handler below so the Request Report queue's
 * PDF renderer (app/lib/reports/loan-index-pdf-queue.ts) can call it directly without a
 * request/session context. Returns null if the index doesn't exist — the branch
 * permission check (which needs the requesting user) stays in each caller.
 */
export async function computeLoanIndexReport(indexId: string) {
    // 1. Fetch Loan Index details
    const loanIndex = await prisma.loanIndex.findUnique({
        where: { id: indexId },
        include: {
            center: {
                include: {
                    fdo: true,
                    branch: true,
                    centerLeader: true,
                }
            },
            loans: {
                include: {
                    client: {
                        include: {
                            // A client may have several co-applicants over
                            // time — only the Primary one is fetched here.
                            coApplicants: { where: { isPrimary: true }, take: 1 },
                            highmarkReports: {
                                orderBy: { pulledAt: 'desc' },
                                take: 1,
                                select: { creditScore: true, status: true, pulledAt: true },
                            },
                        }
                    },
                    loanProduct: true,
                    loanPurpose: { // Add loanPurpose relation
                        select: {
                            id: true,
                            name: true,
                            loanPurposeType: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                }
            },
            createdBy: true,
        } as any
    }) as any;

    if (!loanIndex) {
        return null;
    }

    // 2. Fetch Center O/S and Arrears
    // Outstanding: Sum of principalDue - principalPaid for all active loans in center
    // Arrears: Sum of totalDue - totalPaid for all schedules with dueDate < now and status not PAID
    const now = new Date();

    const centerMetrics = await prisma.$transaction(async (tx) => {
        const activeLoansInCenter = await tx.loan.findMany({
            where: {
                // Use the index's own (verified) center, not the raw client-supplied centerId param.
                centerId: loanIndex.centerId,
                isActive: true,
                disbursementStatus: 'DISBURSED',
            },
            select: { id: true }
        });

        const loanIds = activeLoansInCenter.map(l => l.id);

        if (loanIds.length === 0) {
            return { os: 0, arrear: 0 };
        }

        // Calculate O/S
        const schedules = await tx.loanSchedule.aggregate({
            where: {
                loanId: { in: loanIds },
            },
            _sum: {
                principalDue: true,
                principalPaid: true,
                interestDue: true,
                interestPaid: true,
            }
        });

        const os = Number(schedules._sum.principalDue || 0) - Number(schedules._sum.principalPaid || 0);

        // Calculate Arrears
        const arrearsSchedules = await tx.loanSchedule.aggregate({
            where: {
                loanId: { in: loanIds },
                dueDate: { lt: now },
                status: { not: 'PAID' }
            },
            _sum: {
                totalDue: true,
                totalPaid: true,
            }
        });

        const arrear = Number(arrearsSchedules._sum.totalDue || 0) - Number(arrearsSchedules._sum.totalPaid || 0);

        return { os, arrear };
    });

    // 3. Calculate Individual Client O/S and Arrear
    const clientIds = loanIndex.loans.map((l: any) => l.clientId);
    const allActiveClientLoans = await prisma.loan.findMany({
        where: {
            clientId: { in: clientIds },
            isActive: true,
            disbursementStatus: 'DISBURSED',
        },
        include: {
            schedules: {
                where: {
                    dueDate: { lt: now },
                    status: { not: 'PAID' }
                }
            },
            loanPurpose: { // Add loanPurpose relation
                select: {
                    id: true,
                    name: true,
                    loanPurposeType: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            },
        }
    });

    const clientMetricsMap = clientIds.reduce((acc: any, cid: any) => {
        const clientLoans = allActiveClientLoans.filter(l => l.clientId === cid);
        let os = 0;
        let arrear = 0;

        clientLoans.forEach(cl => {
            // Outstanding = Sanctioned Amount - Principal Already Paid
            os += Number(cl.amount) - Number(cl.principalPaid);

            // Arrears = Sum of (Total Due - Total Paid) for past schedules
            cl.schedules.forEach(s => {
                arrear += Number(s.totalDue) - Number(s.totalPaid);
            });
        });

        acc[cid] = { os, arrear };
        return acc;
    }, {} as Record<string, { os: number, arrear: number }>);

    // 4. Format Loan Data
    const loansData = await Promise.all(loanIndex.loans.map(async (loan: any, idx: number) => {
        // Calculate Loan SL No (Cycle)
        const loanCycleCount = await prisma.loan.count({
            where: {
                clientId: loan.clientId,
                isActive: true,
                createdAt: { lte: loan.createdAt }
            }
        });

        const metrics = clientMetricsMap[loan.clientId] || { os: 0, arrear: 0 };

        // Determine purpose: use loanPurpose name, fallback to loanProduct name or '-'
        let purposeValue = '-';
        if (loan.loanPurpose?.name) {
            purposeValue = loan.loanPurpose.name;
            // Optionally include the purpose type in parentheses
            if (loan.loanPurpose.loanPurposeType?.name) {
                purposeValue = `${loan.loanPurpose.name} (${loan.loanPurpose.loanPurposeType.name})`;
            }
        } else if (loan.loanProduct?.productName) {
            purposeValue = loan.loanProduct.productName;
        }

        const latestHm = loan.client.highmarkReports?.[0];
        return {
            slNo: idx + 1,
            clientId: loan.client.clientId,
            clientName: `${loan.client.firstName} ${loan.client.lastName}`,
            nominee: loan.client.nomineeName || '-',
            highmarkScore: latestHm?.creditScore ?? null,
            highmarkStatus: latestHm?.status || 'N/A',
            loanOs: Math.round(metrics.os),
            arrear: Math.round(metrics.arrear),
            loanSlNo: loanCycleCount,
            loanAmount: Number(loan.amount),
            totalDues: loan.loanProduct?.numberOfDues || loan.tenureMonths,
            purpose: purposeValue,
        };
    }));

    return {
        branchId: loanIndex.center.branchId as string,
        reportData: {
            metadata: {
                branchName: loanIndex.center.branch.name,
                branchCode: loanIndex.center.branch.code,
                centerCode: loanIndex.center.code,
                centerName: loanIndex.center.name,
                centerFullDisplay: `${loanIndex.center.code} - ${loanIndex.center.name}`,
                centerAddress: loanIndex.center.address || '-',
                centerMeetingDay: loanIndex.center.meetingDay || '-',
                centerMeetingPlace: loanIndex.center.meetingPlace || '-',
                centerContactPerson: loanIndex.center.contactPerson || '-',
                centerContactNumber: loanIndex.center.contactNumber || '-',
                totalClients: loanIndex.totalApps,
                indexNo: loanIndex.indexNo,
                officerName: loanIndex.center.fdo ? `${loanIndex.center.fdo.firstName} ${loanIndex.center.fdo.lastName}` : '-',
                officerCode: loanIndex.center.fdo?.employeeId || '-',
                centerLeader: loanIndex.center.centerLeader ? `${loanIndex.center.centerLeader.firstName} ${loanIndex.center.centerLeader.lastName}` : '-',
                centerOs: centerMetrics.os,
                centerArrear: centerMetrics.arrear,
                indexDate: loanIndex.indexDate.toISOString().split('T')[0],
            },
            loans: loansData,
        },
    };
}

/**
 * GET /api/reports/others/loan-index
 * Get detailed data for Loan Index Report
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const indexId = searchParams.get('indexId');

            if (!centerId || !indexId) {
                return errorResponse('Missing centerId or indexId', 400);
            }

            const result = await computeLoanIndexReport(indexId);
            if (!result) {
                return errorResponse('Loan Index not found', 404);
            }

            // Ownership check: reject if this index's branch isn't one the caller may see
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds && !permittedBranchIds.includes(result.branchId)) {
                return errorResponse('Loan Index not found', 404);
            }

            return successResponse(result.reportData, 'Loan Index Report data retrieved successfully');
        } catch (error) {
            console.error('Error fetching loan index report:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loan index report',
                500
            );
        }
    })(request);
}
