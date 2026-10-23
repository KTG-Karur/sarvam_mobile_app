import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { applyFunderChangePlan, buildFunderChangePlan } from '@/app/lib/services/loan-funder-change.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const MAX_LOANS = 200;

const bodySchema = z.object({
    branchId: z.string().min(1, 'Branch is required'),
    fromFunderId: z.string().optional().default(''),
    newFunderId: z.string().min(1, 'Target funder is required'),
    loanIds: z.array(z.string().min(1)).min(1, 'Select at least one loan').max(MAX_LOANS, `Max ${MAX_LOANS} loans per transfer`),
    /** 'preview' = read-only per-loan summary; 'apply' = perform the transfer. */
    /** Set = GL-only fix of vouchers sitting under this older ledger name of `fromFunderId` (target = same funder). */
    fromLedgerAlias: z.string().trim().optional(),
    mode: z.enum(['preview', 'apply']),
    reason: z.string().trim().optional(),
    acknowledgeWarnings: z.boolean().optional(),
});

/**
 * POST /api/super-control/bulk-funder-change/apply
 *
 * Bulk version of the individual funder change: every selected loan (all in one branch, all
 * currently under `fromFunderId`) is moved to `newFunderId`, with its posted GL vouchers
 * rewritten on their original dates. Loans are processed one after another inside ONE
 * transaction — plans are built per loan AFTER the previous loan's vouchers were rewritten, so
 * shared vouchers (e.g. one disbursement leg covering many members) drain correctly — and the
 * whole batch rolls back if any loan fails.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = bodySchema.parse(await req.json());
            if (!body.fromLedgerAlias && body.fromFunderId === body.newFunderId) return errorResponse('Source and target funder are the same', 400);
            if (!body.fromLedgerAlias && !body.fromFunderId) return errorResponse('Source funder is required', 400);
            const loanIds = [...new Set(body.loanIds)];

            const loans = await prisma.loan.findMany({
                where: { id: { in: loanIds } },
                select: { id: true, branchId: true, funderId: true },
            });
            if (loans.length !== loanIds.length) return errorResponse('Some selected loans were not found', 400);
            if (loans.some((l) => l.branchId !== body.branchId || (!body.fromLedgerAlias && l.funderId !== body.fromFunderId))) {
                return errorResponse('Selected loans must all belong to the chosen branch and source funder — reload the list', 400);
            }

            // 'KEEP' (old-ledger GL fix only): each loan stays with its own current funder
            const currentFunder = new Map(loans.map((l) => [l.id, l.funderId]));
            const targetFor = (loanId: string): string => {
                if (body.newFunderId !== 'KEEP') return body.newFunderId;
                const f = currentFunder.get(loanId);
                if (!f) throw new Error('A selected loan has no funder — choose a target funder instead of "keep current"');
                return f;
            };

            if (body.mode === 'preview') {
                const summaries = [];
                for (const loanId of loanIds) {
                    const plan = await buildFunderChangePlan(prisma, loanId, targetFor(loanId), { legacyLedgerAlias: body.fromLedgerAlias });
                    summaries.push({
                        loanId,
                        loanNumber: plan.loanNumber,
                        oldFunderName: plan.oldFunderName,
                        newFunderName: plan.newFunderName,
                        moveCount: plan.moves.length,
                        movedAmount: Number(plan.moves.reduce((s, m) => s + m.amount, 0).toFixed(2)),
                        warnings: plan.warnings,
                    });
                }
                return successResponse({ summaries });
            }

            const reason = body.reason ?? '';
            if (reason.length < 5) return errorResponse('Reason is required (min 5 characters)', 400);

            const result = await prisma.$transaction(
                async (tx) => {
                    const done: { loanNumber: string; moveCount: number; warnings: string[] }[] = [];
                    for (const loanId of loanIds) {
                        const plan = await buildFunderChangePlan(tx, loanId, targetFor(loanId), { legacyLedgerAlias: body.fromLedgerAlias });
                        if (plan.warnings.length > 0 && !body.acknowledgeWarnings) {
                            throw new Error(`Loan ${plan.loanNumber}: some GL vouchers could not be matched — review the warnings and confirm to continue`);
                        }
                        await applyFunderChangePlan(tx, plan, { changedById: user.userId, reason: `[Bulk] ${reason}` });
                        done.push({ loanNumber: plan.loanNumber, moveCount: plan.moves.length, warnings: plan.warnings });
                    }
                    return done;
                },
                { timeout: 180000, maxWait: 10000 }
            );

            return successResponse({ transferred: result.length, loans: result }, `${result.length} loan(s) transferred`);
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error instanceof Error ? error.message : 'Bulk funder change failed', 500);
        }
    })(request);
}
