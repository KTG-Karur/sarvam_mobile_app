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
            // Find loans pending Level 2 approval for this center with purpose details
            const pendingLoans = await prisma.loan.findMany({
                where: {
                    centerId,
                    isActive: true,
                    disbursementStatus: 'PENDING_LEVEL2'
                },
                select: {
                    amount: true,
                    loanPurpose: {
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

            const totalAmount = pendingLoans.reduce((sum, loan) => sum + Number(loan.amount), 0);

            // Optional: Group by purpose for more detailed stats
            const purposeStats = pendingLoans.reduce((acc, loan) => {
                const purposeName = loan.loanPurpose?.name || 'Uncategorized';
                const purposeTypeName = loan.loanPurpose?.loanPurposeType?.name || 'Unknown';
                const key = `${purposeTypeName} - ${purposeName}`;
                
                if (!acc[key]) {
                    acc[key] = {
                        purposeName,
                        purposeTypeName,
                        count: 0,
                        totalAmount: 0
                    };
                }
                acc[key].count++;
                acc[key].totalAmount += Number(loan.amount);
                return acc;
            }, {} as Record<string, { purposeName: string; purposeTypeName: string; count: number; totalAmount: number }>);

            return successResponse({
                totalClients: pendingLoans.length,
                totalAmount: totalAmount,
                purposeBreakdown: Object.values(purposeStats) // Optional: include purpose breakdown
            }, 'Pending Level 2 stats fetched successfully');
        } catch (error) {
            console.error('Error fetching pending Level 2 stats:', error);
            return errorResponse('Failed to fetch stats', 500);
        }
    })(request);
}