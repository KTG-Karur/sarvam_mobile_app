import { randomUUID } from 'crypto';
import { uploadObject, deleteObject, downloadObject } from '@/app/lib/storage/gcs-client';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';

/**
 * Staff loan / staff advance supporting document (image or PDF). Files live under the applicant's own employee
 * folder: {employeeFolder}/staff-loan/{timestamp}-{id}{ext} (or /staff-advance/ for an advance).
 */
export type StaffDocumentKind = 'staff-loan' | 'staff-advance';

export async function uploadStaffLoanDocument(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    employeeId: string;
    kind?: StaffDocumentKind;
}): Promise<{ fileKey: string; fileName: string; fileSize: number; mimeType: string }> {
    const { fileBuffer, contentType, fileName, employeeId, kind = 'staff-loan' } = params;
    const folder = await resolveEmployeeFolder(employeeId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
    const key = `${folder}/${kind}/${timestamp}-${randomUUID().slice(0, 8)}${extension}`;
    await uploadObject(key, fileBuffer, contentType);
    return { fileKey: key, fileName, fileSize: fileBuffer.byteLength, mimeType: contentType };
}

/** True only for a key inside THIS employee's folder of that kind (blocks referencing someone else's file, or a loan's file on an advance). */
export async function isStaffLoanDocumentKeyFor(employeeId: string, fileKey: string, kind: StaffDocumentKind = 'staff-loan'): Promise<boolean> {
    if (!fileKey || fileKey.includes('..')) return false;
    const folder = await resolveEmployeeFolder(employeeId);
    return fileKey.startsWith(`${folder}/${kind}/`);
}

/** Reads the stored object back so the size/type we record are the real ones, not client-supplied. */
export async function readStaffLoanDocument(fileKey: string) {
    return downloadObject(fileKey);
}

export async function deleteStaffLoanDocument(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
