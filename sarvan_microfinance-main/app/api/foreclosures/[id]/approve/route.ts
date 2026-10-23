import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { z } from 'zod';
import {
  computeOutstandingTotalsForApproval,
  finalizeClosureCoveredLoan,
  FORECLOSURE_MONEY_TOLERANCE,
} from '@/app/lib/foreclosure-workflow';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const bodySchema = z.object({
  remarks: z.string().trim().optional(),
});

/**
 * POST /api/foreclosures/:id/approve
 * Checker action: marks the foreclosure APPROVED and the underlying LoanTransaction
 * APPROVED, then immediately finalizes the loan (schedules → PAID, isActive:false,
 * closedDate — see finalizeClosureCoveredLoan in app/lib/foreclosure-workflow.ts).
 * Mirrors how a REPAYMENT collection's approval immediately updates the loan's balances
 * (app/api/collections/approve/route.ts) — "Allocate for EOD" is purely a later GL-voucher
 * posting step (postEodClosureAllocation / postEodFunderAllocation), it no longer touches
 * the loan.
 *
 * @access AREA_MANAGER, ADMIN, Sub Admin (Role.isSubAdmin)
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(async (req, user) => {
    const { id } = await ctx.params;
    if (!id) return errorResponse('Preclosure request id is required', 400);

    // Sub Admin: a custom role explicitly flagged Role.isSubAdmin === true,
    // treated as Admin-equivalent for this checker step.
    const isSubAdmin = user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER' && await isSubAdminUser(user.userId);
    if (user.role !== 'AREA_MANAGER' && user.role !== 'ADMIN' && !isSubAdmin) {
      return errorResponse('Insufficient permissions', 403);
    }

    const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
    }
    const safeRemarks = parsed.data.remarks?.trim() ? parsed.data.remarks.trim() : null;

    const requestRecord = await prisma.foreclosureRequest.findUnique({
      where: { id },
      include: {
        loan: {
          include: {
            schedules: {
              orderBy: { dueDate: 'asc' },
            },
          },
        },
        transaction: true,
      },
    });

    if (!requestRecord) return errorResponse('Preclosure request not found', 404);

    // Multi-tenancy boundary — an AREA_MANAGER may only approve preclosures
    // for branches they're assigned to.
    const permittedBranchIds = await getPermittedBranchIds(user);
    if (permittedBranchIds !== null && !permittedBranchIds.includes(requestRecord.branchId)) {
      return errorResponse('You do not have access to this branch\'s preclosure requests', 403);
    }

    if (requestRecord.status === 'APPROVED') {
      return successResponse(
        { id: requestRecord.id, status: requestRecord.status },
        'Preclosure already approved'
      );
    }
    if (requestRecord.status === 'REJECTED') {
      return errorResponse('Preclosure request already rejected', 409);
    }
    if (requestRecord.status !== 'PENDING_APPROVAL') {
      return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
    }

    // Admin and Sub Admin may approve a request they initiated themselves —
    // everyone else (AREA_MANAGER) keeps the maker-checker separation.
    if (requestRecord.initiatedById === user.userId && user.role !== 'ADMIN' && !isSubAdmin) {
      return errorResponse('Self-approval is not allowed', 400);
    }

    const lockResponse = await assertBranchNotLocked(requestRecord.branchId);
    if (lockResponse) return lockResponse;

    const loanAmount = Number(requestRecord.loan.amount);
    const principalPaid = Number(requestRecord.loan.principalPaid || 0);
    const scheduleInputs = requestRecord.loan.schedules.map((s) => ({
      status: String(s.status),
      principalDue: Number(s.principalDue),
      principalPaid: Number(s.principalPaid || 0),
      interestDue: Number(s.interestDue),
      interestPaid: Number(s.interestPaid || 0),
      penaltiesDue: Number(s.penaltiesDue || 0),
      penaltiesPaid: Number(s.penaltiesPaid || 0),
    }));
    const computed = computeOutstandingTotalsForApproval({
      loanAmount,
      principalPaid,
      schedules: scheduleInputs,
    });

    const expected = Number(requestRecord.amountCollected);
    if (Math.abs(computed.total - expected) > FORECLOSURE_MONEY_TOLERANCE) {
      return errorResponse(
        `Loan outstanding changed since submission (expected ₹${expected.toFixed(
          2
        )}, now ₹${computed.total.toFixed(2)}). Please reject and resubmit.`,
        409
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.foreclosureRequest.findUnique({
          where: { id: requestRecord.id },
          select: { status: true, transactionId: true, loanId: true, branchId: true },
        });
        if (!fresh) throw new Error('Preclosure request not found');
        if (fresh.status === 'APPROVED') {
          return { status: 'APPROVED' as const };
        }
        if (fresh.status !== 'PENDING_APPROVAL') {
          throw new Error(`Invalid state: ${fresh.status}`);
        }

        const loan = await tx.loan.findUnique({
          where: { id: fresh.loanId },
          select: { id: true, isActive: true },
        });
        if (!loan || !loan.isActive) {
          throw new Error('Loan not found or not active');
        }

        if (fresh.transactionId) {
          await tx.loanTransaction.update({
            where: { id: fresh.transactionId },
            data: {
              status: 'APPROVED',
              approvedById: user.userId,
              approvedAt: new Date(),
              rejectionReason: null,
            },
          });
        }

        await tx.foreclosureRequest.update({
          where: { id: requestRecord.id },
          data: {
            status: 'APPROVED',
            reviewedById: user.userId,
            reviewedAt: new Date(),
            reviewRemarks: safeRemarks,
          },
        });

        // Loan finalization (schedules → PAID, isActive:false, closedDate) happens right here,
        // at approval time — matching REPAYMENT's approval-immediately-updates-the-loan pattern
        // (app/api/collections/approve/route.ts). "Allocate for EOD" only posts the GL voucher
        // afterward (postEodClosureAllocation / postEodFunderAllocation), it no longer touches
        // the loan. Must run after the ForeclosureRequest update above — finalizeClosureCoveredLoan
        // re-reads the request expecting status APPROVED.
        if (fresh.transactionId) {
          await finalizeClosureCoveredLoan(
            tx,
            'PRECLOSURE',
            fresh.transactionId,
            fresh.loanId,
            requestRecord.transaction?.transactionDate ?? new Date()
          );
        }

        return { status: 'APPROVED' as const };
      },
      { timeout: 20000, maxWait: 20000 }
    );

    await bumpLoanBalance(requestRecord.loanId);

    return successResponse(
      { id: requestRecord.id, status: result.status },
      'Preclosure approved successfully'
    );
  })(request);
}

