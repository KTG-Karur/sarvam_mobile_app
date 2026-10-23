import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { applyFunderChangePlan, buildFunderChangePlan } from '@/app/lib/services/loan-funder-change.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const applySchema = z.object({
    newFunderId: z.string().min(1, 'New funder is required'),
    reason: z.string().trim().min(5, 'Reason is required (min 5 characters)'),
    /** Must be true when the preview carried warnings (vouchers that could not be matched). */
    acknowledgeWarnings: z.boolean().optional(),
});

/**
 * GET /api/super-control/member-loan-edit/loans/[loanId]/funder?newFunderId=
 * Read-only preview: the exact GL vouchers that would be rewritten.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { loanId } = await params;
            const newFunderId = new URL(req.url).searchParams.get('newFunderId') || '';
            if (!newFunderId) return errorResponse('newFunderId is required', 400);
            const plan = await buildFunderChangePlan(prisma, loanId, newFunderId);
            return successResponse(plan);
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to build preview', 400);
        }
    })(request);
}

/**
 * POST /api/super-control/member-loan-edit/loans/[loanId]/funder
 * Changes Loan.funderId and rewrites the original GL vouchers, atomically, with an audit row.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { loanId } = await params;
            const body = applySchema.parse(await req.json());

            const result = await prisma.$transaction(
                async (tx) => {
                    const plan = await buildFunderChangePlan(tx, loanId, body.newFunderId);
                    if (plan.warnings.length > 0 && !body.acknowledgeWarnings) {
                        throw new Error('Some GL vouchers could not be matched — review the warnings and confirm to continue');
                    }
                    const applied = await applyFunderChangePlan(tx, plan, { changedById: user.userId, reason: body.reason });
                    return { plan, ...applied };
                },
                { timeout: 60000, maxWait: 10000 }
            );

            return successResponse(result, 'Funder changed and GL vouchers updated');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error instanceof Error ? error.message : 'Failed to change funder', 500);
        }
    })(request);
}
