import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { revertLocationFields, revertLocationColumns } from '@/app/lib/revert-location';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const RevertSchema = z.object({
    reason: z.string().min(1, 'Reason is required'),
    ...revertLocationFields,
});

/**
 * POST /api/loans/[loanId]/death-marking/revert
 * Admin-only: undo a death marking recorded in error. Soft-deletes
 * (isReversed: true) rather than hard-deleting, so the "Death Revert" history
 * toggle can show who reverted it and why — the marking's own fields (death
 * date, certificate, etc.) never touched any other table, so nothing else
 * needs to change as part of the undo itself. loanId is no longer unique on
 * this model for that reason — the same loan can be marked deceased again
 * later without colliding with the reverted row.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { loanId } = await params;
            if (!loanId) return errorResponse('Loan ID is required', 400);

            const body = await req.json();
            const { reason, latitude, longitude } = RevertSchema.parse(body);

            const record = await prisma.loanDeathMarking.findFirst({
                where: { loanId, isReversed: false },
            });
            if (!record) return errorResponse('No death marking found for this loan', 404);

            await prisma.loanDeathMarking.update({
                where: { id: record.id },
                data: {
                    isReversed: true,
                    revertedAt: new Date(),
                    revertedById: user.userId,
                    revertReason: reason,
                    ...revertLocationColumns({ latitude, longitude }),
                },
            });

            return successResponse(null, 'Death marking reverted successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            const message = error instanceof Error ? error.message : 'Failed to revert death marking';
            return errorResponse(message, 500);
        }
    })(request);
}
