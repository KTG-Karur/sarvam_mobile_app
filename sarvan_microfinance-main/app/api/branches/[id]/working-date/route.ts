import { NextRequest } from 'next/server';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/branches/[id]/working-date
 * Resolves a branch's current EOD working date server-side
 * (BranchLock.currentWorkingDate via getBranchWorkingDayWindow), so forms
 * elsewhere in the app can prefill a transaction date that always matches
 * the branch the user has selected, rather than the caller's local clock.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(async (req) => {
    try {
      if (!id) {
        return errorResponse('Branch ID is required', 400);
      }

      let workingDateYmd: string;
      try {
        const window = await getBranchWorkingDayWindow({ branchId: id });
        workingDateYmd = window.workingDateYmd;
      } catch {
        // No BranchLock row yet (e.g. brand-new branch, EOD never run) —
        // fall back to today in IST. Read-only; does not create any row.
        workingDateYmd = getKolkataCalendarYmd(new Date());
      }

      return successResponse({ workingDateYmd }, 'Branch working date resolved');
    } catch (error) {
      console.error('Error resolving branch working date:', error);
      return errorResponse('Failed to resolve branch working date', 500);
    }
  })(request);
}
