import { NextRequest, NextResponse } from 'next/server';
import { handleCorsPreflight, errorResponse, withAuth } from '@/app/lib/api-utils';
import { downloadObject } from '@/app/lib/storage/gcs-client';
import { getUserContext } from '@/app/lib/permissions/guards';
import { canAccessStorageKey } from '@/app/lib/storage/storage-access-guard';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/storage/proxy?key={gcsObjectKey}
 *
 * Same-origin alternative to /api/storage/signed-url for images that get
 * captured into a <canvas> — e.g. the Employee ID Card's PDF export
 * (html2canvas). A GCS signed URL is cross-origin, and the GCS bucket has no
 * CORS configuration granting this app's origin read access, so the browser
 * refuses to let canvas code read pixel data drawn from that <img> (it
 * displays fine — that alone doesn't need CORS — but taints the canvas the
 * moment something tries to read it back out). Proxying the bytes through
 * this same-origin route sidesteps that entirely: the response comes from
 * our own domain, so no CORS check applies. Uses the exact same withAuth
 * and canAccessStorageKey check as /signed-url — the underlying file is
 * never made public.
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

            const object = await downloadObject(key);
            if (!object) return errorResponse('File not found', 404);

            return new NextResponse(new Uint8Array(object.buffer), {
                status: 200,
                headers: {
                    'Content-Type': object.contentType,
                    'Cache-Control': 'private, max-age=300',
                },
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load file';
            return errorResponse(message, 500);
        }
    })(request);
}
