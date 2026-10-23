import { uploadObject } from '@/app/lib/storage/gcs-client';
import { resolveEmployeeFolder } from '@/app/lib/storage/gcs-path-resolver';

/**
 * HR Letter Storage — Confirmation/Promotion/Relieving/Transfer letters.
 *
 * To minimize persistent cloud storage usage and eliminate GCS storage bloat,
 * letters are rendered on-demand directly into the browser stream.
 * Uploading to Google Cloud Storage is bypassed unless explicitly requested
 * via the PERSIST_HR_LETTERS_TO_GCS=true environment flag.
 */
export async function uploadHrLetter(params: {
    employeeId: string;
    letterType: 'confirmation' | 'promotion' | 'relieving' | 'transfer';
    pdfBuffer?: Buffer;
}): Promise<string> {
    const { employeeId, letterType, pdfBuffer } = params;
    const employeeFolder = await resolveEmployeeFolder(employeeId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${employeeFolder}/letters/${letterType}-${timestamp}.pdf`;

    if (process.env.PERSIST_HR_LETTERS_TO_GCS === 'true' && pdfBuffer) {
        await uploadObject(key, pdfBuffer, 'application/pdf');
    }

    return key;
}
