import { uploadObject } from '@/app/lib/storage/gcs-client';
import { resolveLoanFolder } from '@/app/lib/storage/gcs-path-resolver';

export type UploadDeathCertificateResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
};

export async function uploadDeathCertificate(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    loanId: string;
}): Promise<UploadDeathCertificateResult> {
    const { fileBuffer, contentType, fileName, loanId } = params;

    const loanFolder = await resolveLoanFolder(loanId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0]?.toLowerCase() || '.pdf';
    const key = `${loanFolder}/death-certificate/${timestamp}${extension}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileUrl: key,
        fileName,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}
