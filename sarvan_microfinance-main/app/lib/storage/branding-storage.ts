import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';

/**
 * White-label branding asset storage (login carousel photos).
 * Unlike client-document storage (insurance-storage.ts, etc.), objects here
 * are served publicly (no signed URL) via GET /api/branding/asset/[...type] —
 * see that route for why (unauthenticated login page, browser favicon, PDF
 * generation all need to fetch these without a session).
 */

export type UploadLoginSlideImageResult = {
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

/**
 * Upload a login carousel photo to GCS.
 * Key format: branding/login-slides/{timestamp}-{safeName}
 */
export async function uploadLoginSlideImage(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
}): Promise<UploadLoginSlideImageResult> {
    const { fileBuffer, contentType, fileName } = params;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'slide.png';
    const key = `branding/login-slides/${timestamp}-${safeName}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileName,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}

export async function deleteLoginSlideImage(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}

export type BrandAssetType = 'logo-wordmark' | 'logo-icon' | 'favicon' | 'tamil-logo' | 'payment-qr' | 'page-loader' | 'authorised-signatory';

export type UploadBrandAssetResult = {
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

/**
 * Upload a logo/icon/favicon image to GCS.
 * Key format: branding/{type}/{timestamp}-{safeName}
 */
export async function uploadBrandAsset(params: {
    type: BrandAssetType;
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
}): Promise<UploadBrandAssetResult> {
    const { type, fileBuffer, contentType, fileName } = params;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_') || `${type}.png`;
    const key = `branding/${type}/${timestamp}-${safeName}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileName,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}

export async function deleteBrandAsset(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
