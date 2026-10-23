import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { getDrivingDistanceKm } from '@/app/lib/services/geo-routing.service';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const querySchema = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
});

export async function GET(request: NextRequest) {
  return withAuth(async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const params = querySchema.parse({
        fromLat: searchParams.get('fromLat'),
        fromLng: searchParams.get('fromLng'),
        toLat: searchParams.get('toLat'),
        toLng: searchParams.get('toLng'),
      });

      const result = await getDrivingDistanceKm(
        params.fromLat,
        params.fromLng,
        params.toLat,
        params.toLng,
      );

      return successResponse(result, 'Driving distance calculated');
    } catch (error: any) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error.message || 'Failed to calculate driving distance', 500);
    }
  })(request);
}
