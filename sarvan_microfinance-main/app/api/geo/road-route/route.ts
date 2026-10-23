import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { getRoadRoute } from '@/app/lib/services/geo-routing.service';

export async function OPTIONS() {
  return handleCorsPreflight();
}

// OSRM's public server caps a request at 100 waypoints; the mobile client
// splits longer days into chunks of that size.
const bodySchema = z.object({
  points: z
    .array(
      z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    )
    .min(2, 'At least two points are required')
    .max(100, 'At most 100 points per request'),
});

// POST /api/geo/road-route — road-following geometry through chronological
// GPS points (used by the mobile "Full Route on Map" screen).
export async function POST(request: NextRequest) {
  return withAuth(async (req) => {
    try {
      const { points } = bodySchema.parse(await req.json());
      const result = await getRoadRoute(points);
      return successResponse(result, 'Road route calculated');
    } catch (error: any) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error.message || 'Failed to calculate road route', 500);
    }
  })(request);
}
