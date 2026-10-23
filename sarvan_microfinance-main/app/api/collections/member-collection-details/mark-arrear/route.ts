import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/collections/member-collection-details/mark-arrear
 * Marks a specific loan schedule installment as OVERDUE (Move to Arrear action).
 * Body: { loanId: string, installmentNo: number }
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const body = await req.json();
            const { loanId, installmentNo } = body;

            if (!loanId || typeof loanId !== 'string') {
                return errorResponse('loanId is required', 400);
            }
            if (!installmentNo || typeof installmentNo !== 'number') {
                return errorResponse('installmentNo is required', 400);
            }

            const schedule = await prisma.loanSchedule.findFirst({
                where: {
                    loanId,
                    installmentNo,
                    status: { in: ['PENDING', 'PARTIALLY_PAID'] },
                },
                select: { id: true, status: true },
            });

            if (!schedule) {
                return errorResponse('Schedule not found or already in a final state', 404);
            }

            await prisma.loanSchedule.update({
                where: { id: schedule.id },
                data: { status: 'OVERDUE' },
            });

            return successResponse({}, 'Installment moved to arrear');
        } catch (error: any) {
            console.error('[mark-arrear] Error:', error);
            return errorResponse(error.message || 'Failed to mark arrear', 500);
        }
    })(request);
}
