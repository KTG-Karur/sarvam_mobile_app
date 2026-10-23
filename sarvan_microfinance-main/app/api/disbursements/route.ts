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

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const {
                indexNo,
                funderId,
                firstDueDate,
                disbursalType,
                disbursalStatus
            } = body;

            if (!indexNo) return errorResponse('Index Number is required', 400);

            // Find the index
            const loanIndex = await prisma.loanIndex.findUnique({
                where: { indexNo },
                include: {
                    loans: {
                        where: { disbursementStatus: 'APPROVED_LEVEL1' }
                    }
                }
            });

            if (!loanIndex) return errorResponse('Loan Index not found', 404);

            const loanIds = loanIndex.loans.map(l => l.id);

            if (loanIds.length === 0) {
                return errorResponse('No approved loans found in this index for disbursement', 400);
            }

            // Update loans to PENDING_LEVEL2
            await prisma.loan.updateMany({
                where: {
                    id: { in: loanIds }
                },
                data: {
                    disbursementStatus: 'PENDING_LEVEL2',
                    disbursedLevel1ById: user.userId,
                    disbursedLevel1At: new Date(),
                }
            });

            return successResponse({ count: loanIds.length }, 'Disbursement processed successfully');
        } catch (error) {
            console.error('Error processing disbursement:', error);
            return errorResponse('Failed to process disbursement', 500);
        }
    })(request);
}
