import { uploadObject, deleteObject, copyObject } from '@/app/lib/storage/gcs-client';
import { resolveClientFolder } from '@/app/lib/storage/gcs-path-resolver';
import { type SupportedKycDocumentType } from '@/app/lib/kyc-document-types';

type UploadKycDocumentParams = {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    clientIdentifier: string;
    documentType: SupportedKycDocumentType;
    owner?: 'client' | 'nominee' | 'coApplicant';
    category?: 'kyc' | 'photos' | 'nominee';
};

export type UploadKycDocumentResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    documentType: SupportedKycDocumentType;
};

async function buildObjectKey(params: {
    clientIdentifier: string;
    documentType: SupportedKycDocumentType;
    fileName: string;
    verified?: boolean;
    owner?: 'client' | 'nominee' | 'coApplicant';
    category?: 'kyc' | 'photos' | 'nominee';
}): Promise<string> {
    const clientFolder = await resolveClientFolder(params.clientIdentifier);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extensionMatch = params.fileName.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '';

    const status = params.verified ? 'verified' : 'pending';

    if (params.category) {
        const safeOwner = params.owner ?? (params.documentType.startsWith('co_applicant_') ? 'coApplicant' : 'client');
        return `${clientFolder}/${status}/${params.category}/${safeOwner}/${params.documentType}-${timestamp}${extension}`;
    }

    return `${clientFolder}/${status}/${params.documentType}-${timestamp}${extension}`;
}

export async function uploadKycDocument(params: UploadKycDocumentParams): Promise<UploadKycDocumentResult> {
    const { fileBuffer, contentType, fileName, clientIdentifier, documentType, owner, category } = params;

    const key = await buildObjectKey({ clientIdentifier, documentType, fileName, verified: false, owner, category });

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileUrl: key,
        fileName,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
        documentType,
    };
}

/**
 * Delete KYC document from storage.
 * No-ops for legacy Supabase https:// URLs (those documents are intentionally left in place, not migrated).
 */
export async function deleteKycDocument(fileKey: string): Promise<void> {
    await deleteObject(fileKey);
}

/**
 * Extract the storable key from a stored `fileUrl` value. New uploads store the
 * bare GCS object key directly, so this is now mostly a passthrough — retained
 * for legacy Supabase public URLs still referenced by pre-migration records.
 */
export function extractFileKeyFromUrl(url: string): string | null {
    if (!url) return null;
    // Legacy Supabase URL: not a GCS key. Return unchanged so deleteObject()
    // recognizes the https:// prefix and skips the (pointless) GCS delete call.
    if (/^https?:\/\//i.test(url)) return url;
    return url; // already a bare GCS key
}

/**
 * Move KYC document to verified folder after verification.
 * No-ops (returns the original key) for legacy Supabase URLs.
 */
export async function moveKycDocumentToVerified(fileKey: string): Promise<string> {
    if (/^https?:\/\//i.test(fileKey)) return fileKey;

    const newKey = fileKey.replace('/pending/', '/verified/');
    if (newKey === fileKey) return fileKey;

    await copyObject(fileKey, newKey);
    await deleteObject(fileKey);

    return newKey;
}
