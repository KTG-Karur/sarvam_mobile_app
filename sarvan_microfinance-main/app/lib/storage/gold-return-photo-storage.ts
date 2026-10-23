import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';
import { resolveLoanFolder } from '@/app/lib/storage/gcs-path-resolver';

type UploadGoldReturnPhotoParams = {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    loanId: string;
};

export type UploadGoldReturnPhotoResult = {
    photoKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    photoUrl: string;
    fileSize: number;
    mimeType: string;
};

export async function uploadGoldReturnPhoto(
    params: UploadGoldReturnPhotoParams
): Promise<UploadGoldReturnPhotoResult> {
    const { fileBuffer, contentType, fileName, loanId } = params;

    const loanFolder = await resolveLoanFolder(loanId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extensionMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '';
    const key = `${loanFolder}/gold-loan/return-photos/${timestamp}${extension}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        photoKey: key,
        photoUrl: key,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}

export async function deleteGoldReturnPhoto(photoKey: string): Promise<void> {
    await deleteObject(photoKey);
}
