import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { resolvePlace } from '@/app/lib/services/geo-search.service';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const querySchema = z.object({
  placeId: z.string().trim().min(1, 'placeId is required').max(300),
  sessionToken: z.string().max(100).optional(),
});

// GET /api/geo/place?placeId=...&sessionToken= — coordinates for a Google place
// suggestion picked from /api/geo/search.
export async function GET(request: NextRequest) {
  return withAuth(async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const params = querySchema.parse({
        placeId: searchParams.get('placeId') ?? '',
        sessionToken: searchParams.get('sessionToken') || undefined,
      });
      const place = await resolvePlace(params.placeId, params.sessionToken);
      return successResponse(place, 'Place resolved');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error instanceof Error ? error.message : 'Failed to get place location', 500);
    }
  })(request);
}
