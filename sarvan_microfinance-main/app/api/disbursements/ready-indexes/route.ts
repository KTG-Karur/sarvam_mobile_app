import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        const { searchParams } = new URL(req.url);
        const centerId = searchParams.get('centerId');

        if (!centerId) {
            return errorResponse('Center ID is required', 400);
        }

        try {
            // Find indexes that have loans ready for Level 1 disbursement (status APPROVED_LEVEL1)
            const indexes = await prisma.loanIndex.findMany({
                where: {
                    centerId,
                    isActive: true,
                    loans: {
                        some: {
                            disbursementStatus: 'APPROVED_LEVEL1'
                        }
                    }
                },
                include: {
                    loans: {
                        where: {
                            disbursementStatus: 'APPROVED_LEVEL1'
                        },
                        select: {
                            amount: true
                        }
                    }
                }
            });

            // Map to response format
            const readyIndexes = indexes.map(idx => {
                const readyLoans = idx.loans;
                const totalAmount = readyLoans.reduce((sum, loan) => sum + Number(loan.amount), 0);

                return {
                    id: idx.id,
                    indexNo: idx.indexNo,
                    indexDate: idx.indexDate.toISOString().split('T')[0],
                    centerId: idx.centerId,
                    readyLoanCount: readyLoans.length,
                    readyAmount: totalAmount
                };
            });

            return successResponse(readyIndexes, 'Ready indexes fetched successfully');
        } catch (error) {
            console.error('Error fetching ready indexes:', error);
            return errorResponse('Failed to fetch ready indexes', 500);
        }
    })(request);
}
