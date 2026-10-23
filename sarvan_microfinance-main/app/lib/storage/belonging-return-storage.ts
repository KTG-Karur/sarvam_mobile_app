import { randomUUID } from 'crypto';
import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';

/**
 * Belonging return proof (item photos, handover signature, lost-item
 * declaration). Files live under the EMPLOYEE's own folder:
 * {employeeFolder}/belonging-return/{issuedBelongingId}/{timestamp}-{id}{ext} —
 * the storage guard already treats employee-{id} paths as "the employee
 * themself, or an authorised HR viewer", same as leave proof.
 */

export async function uploadBelongingReturnProof(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    employeeId: string;
    issuedBelongingId: string;
}): Promise<{ fileKey: string; fileSize: number }> {
    const { fileBuffer, contentType, fileName, employeeId, issuedBelongingId } = params;
    const folder = await resolveEmployeeFolder(employeeId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '';
    const key = `${folder}/belonging-return/${issuedBelongingId}/${timestamp}-${randomUUID().slice(0, 8)}${extension}`;
    await uploadObject(key, fileBuffer, contentType);
    return { fileKey: key, fileSize: fileBuffer.byteLength };
}

/** True only for a key inside THIS belonging's proof folder (blocks referencing someone else's file). */
export async function isBelongingReturnProofKeyFor(employeeId: string, issuedBelongingId: string, fileKey: string): Promise<boolean> {
    if (!fileKey || fileKey.includes('..')) return false;
    const folder = await resolveEmployeeFolder(employeeId);
    return fileKey.startsWith(`${folder}/belonging-return/${issuedBelongingId}/`);
}

export async function deleteBelongingReturnProof(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}
