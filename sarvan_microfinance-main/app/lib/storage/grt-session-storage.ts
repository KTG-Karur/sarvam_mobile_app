import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';
import { resolveBranchAncestry, branchFolder } from '@/app/lib/storage/gcs-path-resolver';
import { prisma } from '@/app/lib/prisma';

type UploadGrtSessionPhotoParams = {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    sessionId: string;
};

export type UploadGrtSessionPhotoResult = {
    photoKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    photoUrl: string;
    fileSize: number;
    mimeType: string;
};

export async function uploadGrtSessionPhoto(
    params: UploadGrtSessionPhotoParams
): Promise<UploadGrtSessionPhotoResult> {
    const { fileBuffer, contentType, fileName, sessionId } = params;

    const session = await prisma.grtSession.findUnique({
        where: { id: sessionId },
        select: { branchId: true, centerId: true },
    });

    const branch = await resolveBranchAncestry(session?.branchId ?? null);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extensionMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '';
    const key = `${branchFolder(branch)}/center-${session?.centerId ?? 'unassigned'}/grt-${sessionId}/${timestamp}${extension}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        photoKey: key,
        photoUrl: key,
        fileSize: fileBuffer.byteLength,
        mimeType: contentType,
    };
}

export async function deleteGrtSessionPhoto(photoKey: string): Promise<void> {
    await deleteObject(photoKey);
}
