import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { applyReconcilePlan, buildReconcilePlan } from '@/app/lib/services/eod-funder-reconcile.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    branchId: z.string().min(1, 'Branch is required'),
    mode: z.enum(['preview', 'apply']),
    reason: z.string().trim().optional(),
});

/**
 * POST /api/super-control/bulk-funder-change/reconcile
 * Fixes leftover amounts sitting in the wrong funder's EOD ledger vouchers: per day, moves the surplus
 * of an over-posted funder ledger to the under-posted one (GL total of the day is never changed).
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = bodySchema.parse(await req.json());

            if (body.mode === 'preview') {
                const plan = await buildReconcilePlan(prisma, body.branchId);
                return successResponse({ moves: plan.moves, skipped: plan.skipped });
            }

            const reason = body.reason ?? '';
            if (reason.length < 5) return errorResponse('Reason is required (min 5 characters)', 400);

            const result = await prisma.$transaction(
                async (tx) => {
                    const plan = await buildReconcilePlan(tx, body.branchId);
                    await applyReconcilePlan(tx, body.branchId, plan, { changedById: user.userId, reason: `[Reconcile] ${reason}` });
                    return plan;
                },
                { timeout: 120000, maxWait: 10000 }
            );
            return successResponse({ moves: result.moves, skipped: result.skipped }, `${result.moves.length} voucher move(s) applied`);
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error instanceof Error ? error.message : 'GL reconcile failed', 500);
        }
    })(request);
}
