import { uploadObject, deleteObject } from '@/app/lib/storage/gcs-client';

export type CollectionMeetingPhotoUploadResult = {
    photoKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    photoUrl: string;
};

export async function uploadCollectionMeetingPhoto(params: {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    branchId: string;
    centerId: string;
    collectionBatchId: string;
}): Promise<CollectionMeetingPhotoUploadResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = params.fileName.match(/\.([a-zA-Z0-9]+)$/)?.at(0)?.toLowerCase() ?? '';
    const key = `collection-meetings/${params.branchId}/${params.centerId}/${params.collectionBatchId}-${timestamp}${extension}`;

    await uploadObject(key, params.fileBuffer, params.contentType);

    return {
        photoKey: key,
        photoUrl: key,
    };
}

export async function deleteCollectionMeetingPhoto(photoKey: string): Promise<void> {
    await deleteObject(photoKey);
}
