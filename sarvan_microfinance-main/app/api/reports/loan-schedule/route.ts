
import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { assertFdoOwnsCenter, checkCenterAccess } from '@/app/lib/filters/fdo-center-scope';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/loan-schedule
 * Get list of loans for the schedule report
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const status = searchParams.get('status');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            // Enforce role-based center access
            if (user.role !== 'ADMIN') {
                const centerRecord = await prisma.center.findUnique({
                    where: { id: centerId },
                    select: { branchId: true, fdoId: true },
                });

                if (!centerRecord) {
                    return errorResponse('Center not found', 404);
                }

                if (user.role === 'FDO') {
                    if (!assertFdoOwnsCenter(user, centerRecord)) {
                        return errorResponse('Access denied to this center', 403);
                    }
                } else if (user.role === 'AREA_MANAGER') {
                    const assigned = await isAmAssignedToBranch(user.userId, centerRecord.branchId);
                    if (!assigned) {
                        return errorResponse('Access denied to this center', 403);
                    }
                } else {
                    const accessError = await checkCenterAccess(user, centerRecord);
                    if (accessError) {
                        return errorResponse('Access denied to this center', 403);
                    }
                }
            }

            // Build filter
            const whereClause: any = { centerId };

            // status dropdown: 'open' -> active loans only, 'closed' -> loans closed via
            // foreclosure/write-off/final-payment auto-close, 'all'/unset -> no isActive filter.
            if (status === 'open') {
                whereClause.isActive = true;
            } else if (status === 'closed') {
                whereClause.isActive = false;
                // Excludes soft-deleted pre-disbursement applications (isActive:false but
                // never reached DISBURSED) — those never generated schedules to show here anyway.
                whereClause.disbursementStatus = { in: ['DISBURSED', 'CLOSED'] };
            }

            const loans = await prisma.loan.findMany({
                where: whereClause,
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    disbursedLevel1At: true,
                    approvedLevel2At: true,
                    disbursedByBMAt: true,
                    createdAt: true,
                    disbursementStatus: true, // Added for debug visibility
                    client: {
                        select: {
                            clientId: true,
                            firstName: true,
                            lastName: true,
                        }
                    },
                    center: {
                        select: {
                            code: true,
                            name: true
                        }
                    },
                    schedules: {
                        select: {
                            dueDate: true,
                        },
                        orderBy: {
                            installmentNo: 'desc',
                        },
                        take: 1,
                    },
                    deathMarking: {
                        where: { isReversed: false },
                        select: {
                            deceasedPersonType: true,
                            deceasedPersonName: true,
                            deathReason: true,
                            deathDate: true,
                            placeOfDeath: true,
                            demandRequired: true,
                        }
                    }
                },
                orderBy: {
                    client: {
                        clientId: 'asc'
                    }
                }
            });

            // Format response
            const formattedLoans = loans.map(loan => {
                // disbursedByBMAt is the true final BM disbursement. disbursedLevel1At is
                // stamped at Loan Index approval (-> PENDING_LEVEL2), and approvedLevel2At is
                // only AM approval — neither is a disbursement. Not-yet-disbursed loans return
                // null; the older fallbacks are kept only for already-disbursed/migrated loans
                // that lack disbursedByBMAt.
                const isDisbursed =
                    loan.disbursementStatus === 'DISBURSED' || loan.disbursementStatus === 'CLOSED';
                const disbursedDate =
                    loan.disbursedByBMAt ??
                    (isDisbursed ? loan.disbursedLevel1At ?? loan.createdAt : null);

                return {
                    id: loan.id,
                    clientName: `${loan.client.clientId} - ${loan.client.firstName} ${loan.client.lastName}`,
                    loanAccount: loan.loanNumber,
                    disbursementDate: disbursedDate ? disbursedDate.toISOString().split('T')[0] : null,
                    loanEndDate: loan.schedules[0]?.dueDate?.toISOString().split('T')[0] ?? null,
                    amount: Number(loan.amount),
                    centerId: centerId,
                    centerName: loan.center.name,
                    status: loan.disbursementStatus,
                    isDead: loan.deathMarking.length > 0,
                    deathMarking: loan.deathMarking[0]
                        ? {
                            deceasedPersonType: loan.deathMarking[0].deceasedPersonType,
                            deceasedPersonName: loan.deathMarking[0].deceasedPersonName,
                            deathDate: loan.deathMarking[0].deathDate.toISOString(),
                            placeOfDeath: loan.deathMarking[0].placeOfDeath,
                            deathReason: loan.deathMarking[0].deathReason,
                            demandRequired: loan.deathMarking[0].demandRequired,
                          }
                        : null,
                };
            });

            return successResponse(formattedLoans, 'Loans retrieved successfully');

        } catch (error) {
            console.error('Error fetching loans for schedule:', error);
            return errorResponse('Failed to fetch loans', 500);
        }
    })(request);
}
