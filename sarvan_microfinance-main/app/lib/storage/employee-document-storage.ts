import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';

/**
 * Employee HR Document Storage (EmployeeDocument model)
 * ──────────────────────────────────────────────────────
 * Manages uploads for the HR "Employee Documents" catalog (Joining Kit, KYC,
 * Education Certificate, etc. — see prisma `EmployeeDocument`), stored under
 * the employee's branch-ancestry folder (see resolveEmployeeFolder) plus a
 * `documents/{category}/` leaf.
 *
 * Distinct from `app/lib/storage/employee-storage.ts`'s `uploadEmployeeDocument`,
 * which handles the small fixed set of single-purpose doc slots already on
 * `User` (aadhaarDocUrl/panDocUrl/profilePhotoUrl/esiPfDocUrl/locationPhotoUrl) —
 * that one predates and is unrelated to the `EmployeeDocument` catalog model.
 */

export type UploadEmployeeHrDocumentResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

/**
 * Upload an employee HR document to GCS.
 * Key format: {employeeFolder}/documents/{category}/{subtype-or-blank}-{timestamp}{ext}
 */
export async function uploadEmployeeHrDocument(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    employeeId: string;
    category: string;
    subtype?: string | null;
}): Promise<UploadEmployeeHrDocumentResult> {
    const { fileBuffer, contentType, fileName, employeeId, category, subtype } = params;

    const employeeFolder = await resolveEmployeeFolder(employeeId);
    const safeSubtype = subtype ? `${subtype.replace(/[^a-zA-Z0-9_-]/g, '_')}-` : '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
    const key = `${employeeFolder}/documents/${category}/${safeSubtype}${timestamp}${extension}`;

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
 * Delete an employee HR document from storage.
 */
export async function deleteEmployeeHrDocument(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
