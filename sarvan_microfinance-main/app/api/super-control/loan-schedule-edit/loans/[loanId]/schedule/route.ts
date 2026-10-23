import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { applyScheduleEditPlan, buildScheduleEditPlan } from '@/app/lib/services/loan-schedule-edit.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/super-control/loan-schedule-edit/loans/[loanId]/schedule
 * Current Loan Card (schedule) of a live loan, plus whether amount edits are currently allowed.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async () => {
        try {
            const { loanId } = await params;
            // An empty edit list yields the "Nothing was changed" plan, which still carries the
            // current rows — reuse it rather than duplicating the row mapping.
            const plan = await buildScheduleEditPlan(prisma, loanId, []);
            const [pending, closure, foreclosure] = await Promise.all([
                prisma.loanTransaction.count({ where: { loanId, type: 'REPAYMENT', status: 'PENDING', isReversed: false } }),
                prisma.loanTransaction.count({ where: { loanId, type: { in: ['PRECLOSURE', 'WRITEOFF'] }, isReversed: false } }),
                prisma.foreclosureRequest.count({ where: { loanId, status: { in: ['INITIATED', 'PENDING_APPROVAL', 'APPROVED'] } } }),
            ]);
            const blockers = plan.errors.filter((e) => e !== 'Nothing was changed.');
            const amountLocks = [
                ...(pending > 0 ? ['Pending collections exist'] : []),
                ...(closure > 0 ? ['Pre-closure / write-off recorded'] : []),
                ...(foreclosure > 0 ? ['Foreclosure request exists'] : []),
            ];
            return successResponse({
                loanId,
                loanNumber: plan.loanNumber,
                rows: plan.before,
                blockers,
                amountLocks,
            });
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to load schedule', 400);
        }
    })(request);
}

const editSchema = z.object({
    installmentNo: z.number().int().positive(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    principalDue: z.number().min(0).optional(),
    interestDue: z.number().min(0).optional(),
    savingsDue: z.number().min(0).optional(),
});

const bodySchema = z.object({
    mode: z.enum(['preview', 'apply']),
    edits: z.array(editSchema).min(1, 'No changes to apply').max(500),
    reason: z.string().trim().optional(),
    acknowledgeWarnings: z.boolean().optional(),
});

/**
 * POST /api/super-control/loan-schedule-edit/loans/[loanId]/schedule
 * mode 'preview' → before/after diff + errors/warnings (read-only).
 * mode 'apply'   → performs the edit atomically with an audit row.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { loanId } = await params;
            const body = bodySchema.parse(await req.json());

            if (body.mode === 'preview') {
                const plan = await buildScheduleEditPlan(prisma, loanId, body.edits);
                const { internal: _internal, ...visible } = plan;
                return successResponse(visible);
            }

            const reason = body.reason ?? '';
            if (reason.length < 5) return errorResponse('Reason is required (min 5 characters)', 400);

            const mode = await prisma.$transaction(
                async (tx) => {
                    const plan = await buildScheduleEditPlan(tx, loanId, body.edits);
                    if (plan.errors.length > 0) throw new Error(plan.errors[0]);
                    if (plan.warnings.length > 0 && !body.acknowledgeWarnings) {
                        throw new Error('Review the warnings and confirm to continue');
                    }
                    await applyScheduleEditPlan(tx, plan, { editedById: user.userId, reason });
                    return plan.mode;
                },
                { timeout: 60000, maxWait: 10000 }
            );

            return successResponse({ mode }, 'Loan schedule updated');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update schedule', 500);
        }
    })(request);
}
