import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';
import { resolveClientFolder } from '@/app/lib/storage/gcs-path-resolver';

/**
 * Insurance Document Storage
 * ──────────────────────────
 * Manages PDF uploads for insurance policies, stored under the client's
 * full org-hierarchy folder (region/division/area/branch/center/group/client)
 * plus an `insurance/` leaf.
 */

export type UploadInsuranceDocResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

/**
 * Upload an insurance PDF document to GCS.
 * Key format: {clientFolder}/insurance/{policyNumber}-{timestamp}.pdf
 */
export async function uploadInsuranceDocument(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    clientId: string;
    policyNumber: string;
}): Promise<UploadInsuranceDocResult> {
    const { fileBuffer, contentType, fileName, clientId, policyNumber } = params;

    const clientFolder = await resolveClientFolder(clientId);
    const safePolicyNo = policyNumber.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '.pdf';
    const key = `${clientFolder}/insurance/${safePolicyNo}-${timestamp}${extension}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileUrl: key,
        fileName,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}

/**
 * Delete an insurance document from storage.
 */
export async function deleteInsuranceDocument(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
