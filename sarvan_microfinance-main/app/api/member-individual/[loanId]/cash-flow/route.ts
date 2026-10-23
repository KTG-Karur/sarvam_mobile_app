import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { z } from 'zod';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const cashFlowSchema = z.object({
    foodExpense: z.number().min(0),
    medicalExpense: z.number().min(0),
    cookingFuelExpense: z.number().min(0),
    electricityExpense: z.number().min(0),
    transportExpense: z.number().min(0),
    waterExpense: z.number().min(0),
    educationalExpense: z.number().min(0),
    monthlyExpense: z.number().min(0),
});

/**
 * PATCH /api/member-individual/[loanId]/cash-flow
 * Saves the client's household expense breakdown and marks the tab complete.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { loanId } = await params;
            const body = await req.json();
            const data = cashFlowSchema.parse(body);

            const memberIndividual = await prisma.memberIndividual.findUnique({ where: { loanId } });
            if (!memberIndividual) return errorResponse('Member Individual record not found — open the loan first', 404);

            const updated = await prisma.memberIndividual.update({
                where: { loanId },
                data: {
                    ...data,
                    cashFlowCompletedAt: new Date(),
                    cashFlowCompletedById: user.userId,
                },
            });

            return successResponse({ completedAt: updated.cashFlowCompletedAt }, 'Cash Flow saved');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error saving Cash Flow:', error);
            return errorResponse(error.message || 'Failed to save Cash Flow', 500);
        }
    })(request);
}
