import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { applyOpeningAliasPlan, buildOpeningAliasPlan } from '@/app/lib/services/opening-balance-alias.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    branchId: z.string().min(1, 'Branch is required'),
    mode: z.enum(['preview', 'apply']),
    reason: z.string().trim().optional(),
});

/**
 * POST /api/super-control/bulk-funder-change/opening-balance
 * Moves a branch's opening balance sitting on an older-named funder ledger (e.g. "OWN FUND GOLD PRINCIPAL")
 * onto the funder's proper ledger ("OWN FUND - GOLD PRINCIPAL"). Net signed amounts are merged, so the
 * branch's total opening balance never changes.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = bodySchema.parse(await req.json());

            if (body.mode === 'preview') {
                return successResponse({ moves: await buildOpeningAliasPlan(prisma, body.branchId) });
            }

            const reason = body.reason ?? '';
            if (reason.length < 5) return errorResponse('Reason is required (min 5 characters)', 400);

            const moves = await prisma.$transaction(
                async (tx) => {
                    const plan = await buildOpeningAliasPlan(tx, body.branchId);
                    await applyOpeningAliasPlan(tx, body.branchId, plan, { changedById: user.userId, reason });
                    return plan;
                },
                { timeout: 60000, maxWait: 10000 }
            );
            return successResponse({ moves }, `${moves.length} opening balance(s) moved`);
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error instanceof Error ? error.message : 'Opening balance fix failed', 500);
        }
    })(request);
}
