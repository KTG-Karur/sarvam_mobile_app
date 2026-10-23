import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { searchPlaces } from '@/app/lib/services/geo-search.service';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const querySchema = z.object({
  q: z.string().trim().min(2, 'Enter at least 2 characters to search').max(200),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  sessionToken: z.string().max(100).optional(),
});

// GET /api/geo/search?q=...&lat=&lng=&sessionToken= — type-ahead place search for the
// map location pickers (Google Places when configured, else OpenStreetMap/Photon).
// lat/lng bias results towards the pin's current area.
export async function GET(request: NextRequest) {
  return withAuth(async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const params = querySchema.parse({
        q: searchParams.get('q') ?? '',
        lat: searchParams.get('lat') || undefined,
        lng: searchParams.get('lng') || undefined,
        sessionToken: searchParams.get('sessionToken') || undefined,
      });
      const bias = params.lat != null && params.lng != null ? { lat: params.lat, lng: params.lng } : undefined;
      const results = await searchPlaces(params.q, bias, params.sessionToken);
      return successResponse(results, 'Locations found');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error instanceof Error ? error.message : 'Failed to search location', 500);
    }
  })(request);
}
