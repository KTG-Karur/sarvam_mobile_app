import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { highmarkService } from '@/app/lib/services/highmark.service';

const configSchema = z.object({
  pullLimitPerAadhaar: z.number().int().min(1).max(50),
  limitWindowDays: z.number().int().min(1).max(3650),
  freshnessWindowDays: z.number().int().min(1).max(3650),
  enforcementMode: z.enum(['BLOCK', 'WARN']),
  limitedRoles: z.array(z.string()).min(0),
});

export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async () => {
    try {
      const config = await highmarkService.getConfig();
      return successResponse(config, 'Highmark config retrieved');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to fetch Highmark config', 500);
    }
  })(request);
}

export async function PUT(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();
      const validated = configSchema.parse(body);
      const result = await highmarkService.saveConfig(validated);
      return successResponse(result, 'Highmark policy saved');
    } catch (error: any) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error.message || 'Failed to save Highmark config', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
