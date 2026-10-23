import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { assertBranchNotLocked, BRANCH_LOCK_TIMEZONE } from '@/app/lib/branch-lock';
import { getBranchCalendarYmdForInstant } from '@/app/lib/branch-financial-day';
import { computeEodChecklist } from '@/app/lib/eod-checklist';
import { getDenominationValidation, resolveBranchIdFromUser } from '@/app/lib/denomination-entry';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/eod-close-requests
 * BM submits (or resubmits after rejection) the branch's current working date for
 * AM approval. Denomination is prefilled from FDO CollectionMeetingRecord data but
 * BM-editable (to account for opening balance, cash receipts/payments, etc. — see
 * DenominationEntryPanel) — the client saves the on-screen entry via
 * POST /api/denomination-entry immediately before calling this route, so here we
 * just validate the already-saved DenominationEntry against the expected books
 * total. The branch's working date/lock only actually advances once an AM
 * approves via /api/eod-close-requests/[id]/approve.
 *
 * @access BRANCH_MANAGER
 */
export async function POST(req: NextRequest) {
  return withRole(['BRANCH_MANAGER'], async (_req, user) => {
    try {
      const branchId = await resolveBranchIdFromUser(user);
      if (!branchId) {
        return errorResponse('No valid branch for this user.', 400);
      }

      const lockGuard = await assertBranchNotLocked(branchId);
      if (lockGuard) return lockGuard;

      const branchLock = await prisma.branchLock.findUnique({
        where: { branchId },
        select: { currentWorkingDate: true, timezone: true },
      });
      if (!branchLock) {
        return errorResponse('Branch lock not found. Open the EOD checklist step first.', 404);
      }

      const timezone = branchLock.timezone || BRANCH_LOCK_TIMEZONE;
      const workingDate = new Date(branchLock.currentWorkingDate);
      const workingDateYmd = getBranchCalendarYmdForInstant(workingDate, timezone);

      const existing = await prisma.eodCloseRequest.findUnique({
        where: { branchId_workingDateYmd: { branchId, workingDateYmd } },
      });
      if (existing && existing.status === 'PENDING_AM_APPROVAL') {
        return errorResponse('EOD for this working date is already pending AM approval.', 409);
      }
      if (existing && existing.status === 'APPROVED') {
        return errorResponse('EOD for this working date has already been approved.', 409);
      }

      // Denomination is saved by the BM (prefilled from FDO center collections, then
      // edited as needed) via POST /api/denomination-entry right before this call —
      // validate that saved entry against the expected books total here.
      const denominationGate = await getDenominationValidation(branchId, workingDate, timezone);
      if (!denominationGate.entry) {
        return errorResponse(
          'Save the denomination entry before submitting for approval.',
          409
        );
      }
      // A mismatch against the expected books total is informational only (surfaced
      // in the UI) and no longer blocks submission — see DenominationEntryPanel.

      const checklistResult = await computeEodChecklist(branchId, workingDate, timezone);
      if (!checklistResult.canCompleteEod) {
        return errorResponse(
          'EOD cannot be submitted. Resolve pending checklist issues before proceeding.',
          409
        );
      }

      const entry = denominationGate.entry!;
      const snapshot = {
        d500: entry.d500,
        d200: entry.d200,
        d100: entry.d100,
        d50: entry.d50,
        d20: entry.d20,
        d10: entry.d10,
        d5: entry.d5,
        d2: entry.d2,
        d1: entry.d1,
        upi: entry.upi,
        totalAmount: entry.totalAmount,
        expectedCashCreditTotal: denominationGate.expectedAmount,
      };

      const request = await prisma.eodCloseRequest.upsert({
        where: { branchId_workingDateYmd: { branchId, workingDateYmd } },
        create: {
          branchId,
          workingDateYmd,
          status: 'PENDING_AM_APPROVAL',
          ...snapshot,
          submittedById: user.userId,
        },
        update: {
          status: 'PENDING_AM_APPROVAL',
          ...snapshot,
          submittedById: user.userId,
          submittedAt: new Date(),
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
        },
      });

      return successResponse(
        {
          id: request.id,
          status: request.status,
          workingDateYmd: request.workingDateYmd,
          submittedAt: request.submittedAt,
        },
        'EOD submitted for Area Manager approval'
      );
    } catch (error) {
      console.error('[EOD Close Request] POST Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to submit EOD for approval',
        500
      );
    }
  })(req);
}
