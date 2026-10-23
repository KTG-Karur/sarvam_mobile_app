import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';
import { getUserContext } from '@/app/lib/permissions/guards';
import { canAccessStorageKey } from '@/app/lib/storage/storage-access-guard';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/storage/signed-url?key={gcsObjectKey}
 *
 * The GCS bucket is private, so every stored `fileUrl`/`fileKey`/`photoKey`/etc.
 * column now holds a bare GCS object path rather than a permanently viewable URL.
 * Call this endpoint at display time to mint a short-lived (1 hour) signed URL.
 *
 * Scoped check ensures an authenticated user cannot access documents outside
 * their branch or employee authorization boundary.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const key = req.nextUrl.searchParams.get('key');
            if (!key) return errorResponse('Query parameter "key" is required', 400);

            const userCtx = await getUserContext(req);
            if (!userCtx) return errorResponse('Authentication required', 401);

            const allowed = await canAccessStorageKey(userCtx, key);
            if (!allowed) return errorResponse('You do not have access to this document', 403);

            const url = await getSignedReadUrl(key);
            return successResponse({ url, key });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to generate signed URL';
            return errorResponse(message, 500);
        }
    })(request);
}
