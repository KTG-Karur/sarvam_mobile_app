import { NextRequest } from 'next/server';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { highmarkService } from '@/app/lib/services/highmark.service';

export async function GET(request: NextRequest) {
  return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'QC', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const clientId = searchParams.get('clientId');
      const aadhaar = searchParams.get('aadhaar');

      if (!clientId && !aadhaar) {
        return errorResponse('clientId or aadhaar is required', 400);
      }

      const history = clientId
        ? await highmarkService.getHistoryForClient(clientId)
        : await highmarkService.getHistoryForAadhaar(aadhaar as string);

      return successResponse(history, 'Credit report history retrieved');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to fetch credit report history', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
