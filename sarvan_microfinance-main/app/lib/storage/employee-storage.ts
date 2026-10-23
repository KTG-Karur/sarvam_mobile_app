import { uploadObject } from '@/app/lib/storage/gcs-client';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';

export type EmployeeDocType = 'aadhaar' | 'pan' | 'profile' | 'esi_pf' | 'location';

type UploadEmployeeDocParams = {
    fileBuffer: Buffer;
    contentType: string;
    fileName: string;
    employeeId: string;
    docType: EmployeeDocType;
};

export type UploadEmployeeDocResult = {
    fileKey: string;
    /** GCS object key — bucket is private, resolve via GET /api/storage/signed-url before display. */
    fileUrl: string;
    fileName: string;
    mimeType: string;
};

export async function uploadEmployeeDocument(params: UploadEmployeeDocParams): Promise<UploadEmployeeDocResult> {
    const { fileBuffer, contentType, fileName, employeeId, docType } = params;

    const employeeFolder = await resolveEmployeeFolder(employeeId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = fileName.match(/\.([a-zA-Z0-9]+)$/)?.[0].toLowerCase() ?? '';
    const key = `${employeeFolder}/documents/${docType}-${timestamp}${ext}`;

    await uploadObject(key, fileBuffer, contentType);

    return {
        fileKey: key,
        fileUrl: key,
        fileName,
        mimeType: contentType,
    };
}
