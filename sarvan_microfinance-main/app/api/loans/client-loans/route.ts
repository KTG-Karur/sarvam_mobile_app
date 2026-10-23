// app/api/loans/client-loans/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loans/client-loans?clientId={clientId}
 * Get all loans for a client with index status
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const clientId = searchParams.get('clientId');

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            const loans = await prisma.loan.findMany({
                where: {
                    clientId: clientId,
                    isActive: true,
                },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    interestRate: true,
                    tenureMonths: true,
                    applicationStatus: true,
                    disbursementStatus: true,
                    createdAt: true,
                    indexId: true,
                    loanIndex: {
                        select: {
                            indexNo: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const formattedLoans = loans.map(loan => ({
                id: loan.id,
                loanNumber: loan.loanNumber,
                amount: loan.amount.toString(),
                interestRate: loan.interestRate.toString(),
                tenureMonths: loan.tenureMonths,
                applicationStatus: loan.applicationStatus,
                disbursementStatus: loan.disbursementStatus,
                createdAt: loan.createdAt.toISOString(),
                indexCreated: loan.indexId !== null,
                indexNumber: loan.loanIndex?.indexNo,
                canDelete: !loan.indexId && 
                           (loan.disbursementStatus === 'PENDING_LEVEL1' || 
                            loan.disbursementStatus === 'APPROVED_LEVEL1'),
            }));

            return successResponse(formattedLoans, 'Client loans fetched successfully');
        } catch (error) {
            console.error('Error fetching client loans:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch client loans',
                500
            );
        }
    })(request);
}