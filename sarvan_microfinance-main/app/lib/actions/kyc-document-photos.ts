'use server';

import { getServerActionUser } from '@/app/lib/permissions/server-action-auth';
import { downloadObject } from '@/app/lib/storage/gcs-client';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';

/**
 * Downloads KYC document images server-side and returns them as compressed
 * base64 data URLs, for embedding into a client-built print/PDF document —
 * the private bucket has no CORS policy, so a browser-side fetch() against a
 * signed URL can't read the bytes into a <canvas> for compression (same
 * constraint documented in getGoldPhotoDataUrls). Fetching and compressing
 * here (server-to-server) sidesteps that and keeps each embedded document
 * image in the tens of KB instead of several MB at full camera resolution.
 */
export async function getKycDocumentDataUrls(keys: string[]): Promise<{ key: string; dataUrl: string }[]> {
    const user = await getServerActionUser();
    if (!user) throw new Error('Authentication required');

    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const results = await Promise.all(
        uniqueKeys.map(async (key) => {
            try {
                const isLegacyUrl = /^https?:\/\//i.test(key);
                const fetched = isLegacyUrl
                    ? await fetch(key).then(async (res) =>
                        res.ok ? { buffer: Buffer.from(await res.arrayBuffer()) } : null
                    )
                    : await downloadObject(key);
                if (!fetched) return null;

                const compressed = await compressImageBufferForPdf(fetched.buffer);
                if (!compressed) return null;
                return { key, dataUrl: compressed.dataUrl };
            } catch {
                return null;
            }
        })
    );
    return results.filter((r): r is { key: string; dataUrl: string } => r !== null);
}
