import { NextRequest } from 'next/server';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { highmarkService } from '@/app/lib/services/highmark.service';

export async function GET(request: NextRequest) {
  return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);
      const skip = parseInt(searchParams.get('skip') || '0', 10);
      const take = Math.min(parseInt(searchParams.get('take') || '50', 10), 200);

      let branchIds: string[] | undefined;
      if (user.role === 'BRANCH_MANAGER' || user.role === 'ADMIN_NON_HO_BRANCH_SWITCH') {
        // A session with no branchId is a broken/incomplete session, not "zero pulls" —
        // returning an empty result here would look exactly like missing records.
        if (!user.branchId) return errorResponse('No active branch on this session', 400);
        branchIds = [user.branchId];
      } else if (user.role === 'AREA_MANAGER') {
        branchIds = user.assignedBranchIds && user.assignedBranchIds.length > 0
          ? user.assignedBranchIds
          : (user.branchId ? [user.branchId] : []);
      }
      // ADMIN: branchIds stays undefined — sees every branch

      const branchId = searchParams.get('branchId') || undefined;
      const centerId = searchParams.get('centerId') || undefined;
      const aadhaar = searchParams.get('aadhaar') || undefined;
      const phone = searchParams.get('phone') || undefined;
      const clientId = searchParams.get('clientId') || undefined;
      const fromDateParam = searchParams.get('fromDate');
      const toDateParam = searchParams.get('toDate');
      const fromDate = fromDateParam ? new Date(`${fromDateParam}T00:00:00.000Z`) : undefined;
      const toDate = toDateParam ? new Date(`${toDateParam}T23:59:59.999Z`) : undefined;

      const { items, total, totalCost } = await highmarkService.getRegister({
        branchIds, branchId, centerId, aadhaar, phone, clientId, fromDate, toDate, skip, take,
      });

      return successResponse({ items, total, totalCost, skip, take }, 'Highmark register retrieved');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to fetch Highmark register', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
