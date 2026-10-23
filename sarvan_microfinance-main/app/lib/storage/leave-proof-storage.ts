import { randomUUID } from 'crypto';
import { uploadObject, deleteObject, downloadObject } from '@/app/lib/storage/gcs-client';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';

/**
 * Leave proof storage (medical certificates etc.) — see attendance-hr/plan-leave-proof-attachment.md.
 * Files live under the EMPLOYEE's own folder: {employeeFolder}/leave-proof/{timestamp}-{id}{ext}.
 * That keeps them under the existing employee-{id} path, which the storage guard already treats as
 * "the employee themself, or an authorised HR viewer".
 */

export async function uploadLeaveProof(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    employeeId: string;
}): Promise<{ fileKey: string; fileName: string; fileSize: number; mimeType: string }> {
    const { fileBuffer, contentType, fileName, employeeId } = params;
    const folder = await resolveEmployeeFolder(employeeId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
    const key = `${folder}/leave-proof/${timestamp}-${randomUUID().slice(0, 8)}${extension}`;
    await uploadObject(key, fileBuffer, contentType);
    return { fileKey: key, fileName, fileSize: fileBuffer.byteLength, mimeType: contentType };
}

/** True only for a key inside THIS employee's leave-proof folder (blocks referencing someone else's file). */
export async function isLeaveProofKeyFor(employeeId: string, fileKey: string): Promise<boolean> {
    if (!fileKey || fileKey.includes('..')) return false;
    const folder = await resolveEmployeeFolder(employeeId);
    return fileKey.startsWith(`${folder}/leave-proof/`);
}

/** Reads the stored object back so the size/type we record are the real ones, not client-supplied. */
export async function readLeaveProof(fileKey: string) {
    return downloadObject(fileKey);
}

export async function deleteLeaveProof(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
