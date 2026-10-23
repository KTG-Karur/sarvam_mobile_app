import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { deriveLoanIndexFrequency } from '@/app/lib/loan-frequency';
import { recordLoanHistory } from '@/app/lib/loan-history';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loan-indexes
 * Get all created loan indexes with date and branch filters
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');
            const centerId = searchParams.get('centerId');
            const branchId = searchParams.get('branchId');
            const branchIdsParam = searchParams.get('branchIds');
            const includeDisbursementStatus = searchParams.get('includeDisbursementStatus') === 'true';

            // Admin-only: list soft-deleted indexes (with who/when/why) so they can be restored
            const deletedOnly = searchParams.get('deleted') === 'true';
            if (deletedOnly && user.role !== 'ADMIN') {
                return errorResponse('Only Admin can view deleted indexes', 403);
            }

            // Build where clause
            const whereClause: any = {
                isActive: !deletedOnly,
            };

            // Date range filter
            if (fromDate) {
                const startDate = new Date(fromDate);
                startDate.setHours(0, 0, 0, 0);
                whereClause.indexDate = {
                    ...whereClause.indexDate,
                    gte: startDate,
                };
            }

            if (toDate) {
                const endDate = new Date(toDate);
                endDate.setHours(23, 59, 59, 999);
                whereClause.indexDate = {
                    ...whereClause.indexDate,
                    lte: endDate,
                };
            }

            if (centerId) {
                whereClause.centerId = centerId;
            }

            // Branch filtering based on user role
            const branchIdsToFilter: string[] = [];
            
            if (branchIdsParam) {
                branchIdsToFilter.push(...branchIdsParam.split(','));
            } else if (branchId) {
                branchIdsToFilter.push(branchId);
            }

            // Apply branch filter based on user role
            if (user.role === 'ADMIN') {
                // Admin can filter by selected branches or see all
                if (branchIdsToFilter.length > 0) {
                    whereClause.branchId = { in: branchIdsToFilter };
                }
            } else if (user.role === 'AREA_MANAGER') {
                // Area Manager - get branches assigned to them
                const areaManagerBranches = await prisma.areaManagerBranch.findMany({
                    where: { userId: user.userId },
                    select: { branchId: true },
                });
                const assignedBranchIds = areaManagerBranches.map(amb => amb.branchId);
                
                if (branchIdsToFilter.length > 0) {
                    // Filter by selected branches that are also assigned to the AM
                    whereClause.branchId = {
                        in: branchIdsToFilter.filter(id => assignedBranchIds.includes(id))
                    };
                } else if (assignedBranchIds.length > 0) {
                    whereClause.branchId = { in: assignedBranchIds };
                }
            } else if (user.role === 'BRANCH_MANAGER') {
                // Branch Manager - only their branch
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (userRecord?.branchId) {
                    whereClause.branchId = userRecord.branchId;
                }
            } else {
                // FDO and others - only their branch
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (userRecord?.branchId) {
                    whereClause.branchId = userRecord.branchId;
                }
            }

            // Get loan indexes
            const loanIndexes = await prisma.loanIndex.findMany({
                where: whereClause,
                select: {
                    id: true,
                    indexNo: true,
                    indexDate: true,
                    centerId: true,
                    frequency: true,
                    totalApps: true,
                    totalAmount: true,
                    createdAt: true,
                    branchId: true,
                    deletedById: true,
                    deletedAt: true,
                    deleteReason: true,
                    center: {
                        select: {
                            code: true,
                            name: true,
                        },
                    },
                    branch: {
                        select: {
                            name: true,
                            code: true,
                        },
                    },
                    loans: {
                        select: {
                            disbursementStatus: true,
                        }
                    }
                },
                orderBy: {
                    indexDate: 'desc',
                },
            });

            const deleterIds = Array.from(new Set(loanIndexes.map((i) => i.deletedById).filter(Boolean))) as string[];
            const deleters = deleterIds.length
                ? await prisma.user.findMany({
                    where: { id: { in: deleterIds } },
                    select: { id: true, firstName: true, lastName: true },
                })
                : [];
            const deleterName = new Map(deleters.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

            // Format response
            const formattedIndexes = loanIndexes.map(index => {
                const statuses = index.loans.map(l => l.disbursementStatus);
                const allDisbursed = statuses.every(s => s === 'DISBURSED');
                const allAmApproved = statuses.length > 0 && statuses.every(s => ['APPROVED_LEVEL2', 'DISBURSED'].includes(s));
                const allSubmitted = statuses.every(s => ['PENDING_LEVEL2', 'APPROVED_LEVEL1', 'APPROVED_LEVEL2', 'DISBURSED', 'REJECTED'].includes(s));
                const anySubmitted = statuses.some(s => ['PENDING_LEVEL2', 'APPROVED_LEVEL1', 'APPROVED_LEVEL2', 'DISBURSED'].includes(s));

                let status = 'PENDING';
                if (allDisbursed) status = 'DISBURSED';
                else if (allAmApproved) status = 'AM_APPROVED';
                else if (allSubmitted) status = 'BM_APPROVED';
                else if (anySubmitted) status = 'PARTIALLY_APPROVED';

                const statusCounts = statuses.reduce((acc, curr) => {
                    acc[curr] = (acc[curr] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);

                const hasNonDisbursedLoans = !allDisbursed && statuses.some(s => s !== 'DISBURSED');
                const nonDisbursedCount = statuses.filter(s => s !== 'DISBURSED').length;

                return {
                    id: index.id,
                    indexNo: index.indexNo,
                    indexDate: index.indexDate.toISOString().split('T')[0],
                    centerId: index.centerId,
                    centerCode: index.center.code,
                    centerName: index.center.name,
                    branchName: index.branch?.name ?? '',
                    branchCode: index.branch?.code ?? '',
                    frequency: index.frequency,
                    totalApps: index.totalApps,
                    totalAmount: Number(index.totalAmount),
                    status,
                    statusCounts,
                    hasNonDisbursedLoans,
                    nonDisbursedCount,
                    ...(deletedOnly
                        ? {
                            deletedAt: index.deletedAt?.toISOString() ?? null,
                            deleteReason: index.deleteReason ?? null,
                            deletedByName: index.deletedById ? deleterName.get(index.deletedById) ?? 'Unknown' : 'Unknown (deleted before audit)',
                        }
                        : {}),
                };
            });

            return successResponse(formattedIndexes, 'Loan indexes retrieved successfully');
        } catch (error) {
            console.error('Error fetching loan indexes:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loan indexes',
                500
            );
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const { indexDate, centerId, frequency, selectedLoanIds } = body;

            if (!indexDate || !centerId || !selectedLoanIds || selectedLoanIds.length === 0) {
                return errorResponse('Missing required fields', 400);
            }

            // The index's branch must be the branch that owns the center being
            // indexed — not the creating user's own home branch. A user based
            // at a different branch (e.g. an HO-based ADMIN) can legitimately
            // index loans for a center they don't personally belong to; using
            // their own branchId here mistags the LoanIndex, which then makes
            // it invisible to branch-scoped queues downstream (e.g. the AM
            // Level-2 disbursement queue filters LoanIndex by branchId).
            const centerForBranch = await prisma.center.findUnique({
                where: { id: centerId },
                select: { branchId: true },
            });

            if (!centerForBranch) {
                return errorResponse('Center not found', 404);
            }

            const branchId = centerForBranch.branchId;

            const allSelectedLoans = await prisma.loan.findMany({
                where: {
                    id: { in: selectedLoanIds },
                },
                select: {
                    id: true,
                    loanNumber: true,
                    applicationStatus: true,
                    disbursementStatus: true,
                    indexId: true,
                    centerId: true,
                    isActive: true,
                },
            });

            const loans = await prisma.loan.findMany({
                where: {
                    id: { in: selectedLoanIds },
                    centerId,
                    applicationStatus: {
                        in: ['VERIFIED', 'PENDING_VERIFICATION']
                    },
                    indexId: null,
                    // Excludes backup/legacy-imported and BM-rejected loans — see unindexed-loans/route.ts
                    disbursementStatus: { notIn: ['DISBURSED', 'REJECTED'] },
                    isActive: true,
                },
                select: {
                    id: true,
                    amount: true,
                    frequency: true,
                },
            });

            if (loans.length !== selectedLoanIds.length) {
                const validLoanIds = loans.map(l => l.id);
                const invalidLoanIds = selectedLoanIds.filter((id: string) => !validLoanIds.includes(id));

                const invalidLoans = allSelectedLoans.filter(l => invalidLoanIds.includes(l.id));
                const reasons = invalidLoans.map(l => {
                    if (l.indexId) return `${l.loanNumber}: Already indexed`;
                    if (l.disbursementStatus === 'DISBURSED') return `${l.loanNumber}: Already disbursed (backup/legacy import)`;
                    if (l.centerId !== centerId) return `${l.loanNumber}: Wrong center`;
                    if (!l.isActive) return `${l.loanNumber}: Inactive`;
                    if (!['VERIFIED', 'PENDING_VERIFICATION'].includes(l.applicationStatus)) {
                        return `${l.loanNumber}: Status is ${l.applicationStatus}`;
                    }
                    return `${l.loanNumber}: Unknown reason`;
                });

                return errorResponse(
                    `Cannot create index. Issues found: ${reasons.join('; ')}`,
                    400
                );
            }

            const totalAmount = loans.reduce((sum, loan) => sum + Number(loan.amount), 0);
            const totalApps = loans.length;

            const determinedFrequency = deriveLoanIndexFrequency({
                loanFrequencies: loans.map((l) => l.frequency),
                explicitBodyFrequency: typeof frequency === 'string' ? frequency : null,
            });

            const [branchRecord, centerRecord] = await Promise.all([
                prisma.branch.findUnique({ where: { id: branchId }, select: { code: true } }),
                prisma.center.findUnique({ where: { id: centerId }, select: { code: true } }),
            ]);
            const idxPrefix = `${branchRecord?.code ?? '000'}-${centerRecord?.code ?? '000'}-`;
            const existingCount = await prisma.loanIndex.count({ where: { branchId, centerId } });
            const indexNo = `${idxPrefix}${(existingCount + 1).toString().padStart(4, '0')}`;

            const loanIndex = await prisma.$transaction(async (tx) => {
                const newIndex = await tx.loanIndex.create({
                    data: {
                        indexNo,
                        indexDate: new Date(indexDate),
                        centerId,
                        branchId,
                        frequency: determinedFrequency,
                        totalApps,
                        totalAmount,
                        createdById: user.userId,
                    },
                    include: {
                        center: {
                            select: {
                                code: true,
                                name: true,
                            },
                        },
                    },
                });

                // Per-loan update (not updateMany) because indexedAmount — the
                // frozen ceiling for Disbursement-stage product selection —
                // differs per loan.
                await Promise.all(
                    loans.map((l) =>
                        tx.loan.update({
                            where: { id: l.id },
                            data: { indexId: newIndex.id, indexedAmount: l.amount },
                        })
                    )
                );

                await recordLoanHistory(
                    tx,
                    loans.map((l) => ({
                        loanId: l.id,
                        action: 'INDEX_CREATED',
                        performedById: user.userId,
                        remarks: `Indexed under ${newIndex.indexNo}`,
                    }))
                );

                return newIndex;
            });

            return successResponse(
                {
                    id: loanIndex.id,
                    indexNo: loanIndex.indexNo,
                    indexDate: loanIndex.indexDate.toISOString().split('T')[0],
                    centerId: loanIndex.centerId,
                    centerCode: loanIndex.center.code,
                    centerName: loanIndex.center.name,
                    frequency: loanIndex.frequency,
                    totalApps: loanIndex.totalApps,
                    totalAmount: Number(loanIndex.totalAmount),
                },
                'Loan index created successfully',
                201
            );
        } catch (error) {
            console.error('Error creating loan index:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to create loan index',
                500
            );
        }
    })(request);
}