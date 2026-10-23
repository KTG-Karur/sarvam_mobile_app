import { NextRequest } from 'next/server';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { highmarkService } from '@/app/lib/services/highmark.service';

export async function GET(request: NextRequest) {
  return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const aadhaar = (searchParams.get('aadhaar') || '').trim();
      if (!/^\d{12}$/.test(aadhaar)) {
        return errorResponse('A 12-digit Aadhaar number is required', 400);
      }

      const report = await highmarkService.getReusableReport(aadhaar);
      return successResponse(report, report ? 'Existing report found' : 'No reusable report');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to look up existing Highmark report', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
