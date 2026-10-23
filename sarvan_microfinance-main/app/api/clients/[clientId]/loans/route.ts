import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/clients/[clientId]/loans
 * Fetch approved and active loans for a specific client
 * 
 * @access All authenticated users with role-based access
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { clientId } = await params;

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            // Check if clientId is a UUID (database ID) or a CUID
            const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId) || /^c[a-z0-9]{24}$/i.test(clientId);

            // Find client by clientId (client code) or database id — findFirst, not
            // findUnique: Client.clientId isn't DB-unique (uploan-imported legacy IDs can
            // intentionally collide, see schema.prisma) — deterministic oldest-created
            // tiebreak.
            const client = await prisma.client.findFirst({
                where: isId ? { id: clientId } : { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    centerId: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { branchId: true } },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || (client.center?.branchId ?? client.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const assignedCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];

                const uniqueCenterIds = [...new Set(assignedCenterIds)];

                // Check if client's center is assigned OR if it's an APPROVED center in FDO's branch
                let hasAccess = uniqueCenterIds.includes(client.centerId ?? "");

                if (!hasAccess && userRecord?.branchId && client.center?.branchId === userRecord.branchId) {
                    // Check if it's an APPROVED center in FDO's branch
                    const approvedCenter = await prisma.center.findFirst({
                        where: {
                            id: client.centerId ?? undefined,
                            branchId: userRecord.branchId,
                            status: 'APPROVED',
                        },
                        select: { id: true },
                    });
                    hasAccess = !!approvedCenter;
                }

                // Grant access when client has no center but was enrolled by someone in FDO's branch
                if (!hasAccess && userRecord?.branchId && client.enrolledBy?.branchId === userRecord.branchId) {
                    hasAccess = true;
                }

                if (!hasAccess) {
                    return errorResponse('Insufficient permissions: Client is not in your assigned centers', 403);
                }
            }

            // Fetch approved and active loans for this client
            // Approved means: APPROVED_LEVEL1 or DISBURSED
            // Active means: isActive = true

            // Check if simple mode is requested (for dropdowns)
            const { searchParams } = new URL(request.url);
            const simple = searchParams.get('simple') === 'true';
            const statusFilter = searchParams.get('status');

            // Build where clause
            const whereClause: any = {
                clientId: client.id,
                isActive: true,
            };

            // Filter by status if provided
            if (statusFilter === 'active') {
                whereClause.disbursementStatus = 'DISBURSED';
            } else {
                whereClause.disbursementStatus = {
                    in: ['APPROVED_LEVEL1', 'DISBURSED'],
                };
            }

            // If simple mode, return just id and loanNumber
            if (simple) {
                const loans = await prisma.loan.findMany({
                    where: whereClause,
                    select: {
                        id: true,
                        loanNumber: true,
                    },
                    orderBy: {
                        disbursedLevel1At: 'desc',
                    },
                });

                return successResponse(loans, 'Loans fetched successfully');
            }

            const loans = await prisma.loan.findMany({
                where: whereClause,
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    interestRate: true,
                    tenureMonths: true,
                    frequency: true,
                    disbursedLevel1At: true,
                    disbursedByBMAt: true,
                    createdAt: true,
                    loanProductId: true,
                },
                orderBy: {
                    disbursedLevel1At: 'desc',
                },
            });

            // Fetch loan products for loans that have productId
            const productIds = Array.from(
                new Set(loans.map((l) => l.loanProductId).filter(Boolean))
            ) as string[];

            let productMap: Record<string, { numberOfDues: number; interestAmount: number | null }> = {};

            if (productIds.length > 0) {
                const products = await prisma.loanProduct.findMany({
                    where: {
                        productId: {
                            in: productIds,
                        },
                    },
                    select: {
                        productId: true,
                        numberOfDues: true,
                        interestAmount: true,
                    },
                });

                products.forEach((product) => {
                    productMap[product.productId] = {
                        numberOfDues: product.numberOfDues,
                        interestAmount: product.interestAmount ? Number(product.interestAmount) : null,
                    };
                });
            }

            // Fetch loan schedules for all loans to calculate actual dues and balances
            const loanIds = loans.map(l => l.id);
            const schedules = await prisma.loanSchedule.findMany({
                where: {
                    loanId: { in: loanIds },
                },
                select: {
                    loanId: true,
                    installmentNo: true,
                    dueDate: true,
                    principalDue: true,
                    interestDue: true,
                    totalDue: true,
                    principalPaid: true,
                    interestPaid: true,
                    totalPaid: true,
                    status: true,
                },
                orderBy: {
                    installmentNo: 'asc',
                },
            });

            // Group schedules by loanId
            const schedulesByLoan: Record<string, typeof schedules> = {};
            schedules.forEach(schedule => {
                if (!schedulesByLoan[schedule.loanId]) {
                    schedulesByLoan[schedule.loanId] = [];
                }
                schedulesByLoan[schedule.loanId].push(schedule);
            });

            // Transform loans to LoanInfo format
            const loanInfos = loans.map((loan) => {
                const disbursementDate = loan.disbursedByBMAt || loan.disbursedLevel1At || loan.createdAt;

                // Get loan product details if available
                const product = loan.loanProductId ? productMap[loan.loanProductId] : null;

                // Get schedules for this loan
                const loanSchedules = schedulesByLoan[loan.id] || [];

                // Calculate total dues from loan product or tenure
                const totalDues = product?.numberOfDues || loan.tenureMonths || loanSchedules.length;

                // Calculate maturity date (disbursement date + tenure months)
                const maturityDate = new Date(disbursementDate);
                maturityDate.setMonth(maturityDate.getMonth() + loan.tenureMonths);

                // Calculate due start date (typically same as disbursement date)
                const dueStartDate = new Date(disbursementDate);

                // Format dates as DD/MM/YYYY
                const formatDate = (date: Date) => {
                    const day = date.getDate().toString().padStart(2, '0');
                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                    const year = date.getFullYear();
                    return `${day}/${month}/${year}`;
                };

                const loanAmount = Number(loan.amount);
                const interestRate = Number(loan.interestRate);
                const totalInterest = (loanAmount * interestRate) / 100;

                // Calculate from actual schedule data
                let completedDues = 0;
                let collectedDues = 0;
                let totalPrincipalPaid = 0;
                let totalInterestPaid = 0;
                let totalPrincipalDue = 0;
                let totalInterestDue = 0;
                let overdueCount = 0;

                const today = new Date();
                today.setHours(0, 0, 0, 0);

                loanSchedules.forEach(schedule => {
                    const principalPaid = Number(schedule.principalPaid);
                    const interestPaid = Number(schedule.interestPaid);
                    const principalDue = Number(schedule.principalDue);
                    const interestDue = Number(schedule.interestDue);
                    const totalPaid = Number(schedule.totalPaid);
                    const totalDue = Number(schedule.totalDue);

                    totalPrincipalPaid += principalPaid;
                    totalInterestPaid += interestPaid;
                    totalPrincipalDue += principalDue;
                    totalInterestDue += interestDue;

                    // Count completed dues (fully paid installments)
                    if (schedule.status === 'PAID' || totalPaid >= totalDue) {
                        completedDues++;
                    }

                    // Count collected dues (any payment made)
                    if (totalPaid > 0) {
                        collectedDues++;
                    }

                    // Count overdue installments
                    const dueDate = new Date(schedule.dueDate);
                    dueDate.setHours(0, 0, 0, 0);
                    if (dueDate < today && schedule.status !== 'PAID') {
                        overdueCount++;
                    }
                });

                // Calculate balances
                const principalBalance = Math.max(0, loanAmount - totalPrincipalPaid);
                const interestBalance = Math.max(0, totalInterestDue - totalInterestPaid);

                // Calculate arrears (overdue amounts)
                // Arrears = sum of unpaid amounts for all overdue installments
                let closingArrPrincipal = 0;
                let closingArrInterest = 0;

                loanSchedules.forEach(schedule => {
                    const dueDate = new Date(schedule.dueDate);
                    dueDate.setHours(0, 0, 0, 0);

                    if (dueDate < today && schedule.status !== 'PAID') {
                        const principalDue = Number(schedule.principalDue);
                        const interestDue = Number(schedule.interestDue);
                        const principalPaid = Number(schedule.principalPaid);
                        const interestPaid = Number(schedule.interestPaid);

                        closingArrPrincipal += Math.max(0, principalDue - principalPaid);
                        closingArrInterest += Math.max(0, interestDue - interestPaid);
                    }
                });

                return {
                    id: loan.id,
                    disbursementDate: formatDate(disbursementDate),
                    loanAccount: loan.loanNumber,
                    loanAmount,
                    totalDues,
                    completedDues,
                    collectedDues,
                    dueStartDate: formatDate(dueStartDate),
                    maturityDate: formatDate(maturityDate),
                    closedDate: undefined,
                    principalBalance,
                    interestBalance,
                    closingArrPrincipal,
                    closingArrInterest,
                };
            });

            return successResponse(
                {
                    clientId: client.clientId,
                    loans: loanInfos,
                },
                'Loans fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching loans:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch loans',
                500
            );
        }
    })(request);
}
