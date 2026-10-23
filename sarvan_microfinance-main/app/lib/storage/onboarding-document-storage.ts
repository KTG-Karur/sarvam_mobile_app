import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';

/**
 * Onboarding Document Storage (OnboardingDocument model)
 * ────────────────────────────────────────────────────────
 * Documents attached to an EmployeeOnboardingRequest before any User exists —
 * no employee/branch folder to resolve yet (unlike
 * app/lib/storage/employee-document-storage.ts), so this stores under a flat
 * request-scoped key instead. Copied into the employee's proper folder via
 * copyObject at final approval (app/api/hr/onboarding/[id]/action/route.ts).
 */

export type UploadOnboardingDocumentResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

/**
 * Upload an onboarding document to GCS.
 * Key format: hr-onboarding/{requestId}/documents/{category}/{subtype-or-blank}-{timestamp}{ext}
 */
export async function uploadOnboardingDocument(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    onboardingRequestId: string;
    category: string;
    subtype?: string | null;
}): Promise<UploadOnboardingDocumentResult> {
    const { fileBuffer, contentType, fileName, onboardingRequestId, category, subtype } = params;

    const safeSubtype = subtype ? `${subtype.replace(/[^a-zA-Z0-9_-]/g, '_')}-` : '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
    const key = `hr-onboarding/${onboardingRequestId}/documents/${category}/${safeSubtype}${timestamp}${extension}`;

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
 * Delete an onboarding document from storage.
 */
export async function deleteOnboardingDocument(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
