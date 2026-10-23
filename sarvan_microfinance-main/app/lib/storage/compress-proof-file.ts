import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

/**
 * Server-side size reduction for uploaded proof files. Images are resized (max 1600px) and
 * re-encoded; PDFs are re-saved with object streams. Falls back to the original bytes on any
 * failure or when the result is not smaller.
 */
export async function compressProofBuffer(buffer: Buffer, mime: 'image/jpeg' | 'image/png' | 'application/pdf'): Promise<Buffer> {
    try {
        let output: Buffer;
        if (mime === 'image/jpeg') {
            output = Buffer.from(await sharp(buffer).rotate()
                .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80, progressive: true }).toBuffer());
        } else if (mime === 'image/png') {
            output = Buffer.from(await sharp(buffer).rotate()
                .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                .png({ compressionLevel: 9 }).toBuffer());
        } else {
            const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
            output = Buffer.from(await pdf.save({ useObjectStreams: true, addDefaultPage: false }));
        }
        return output.byteLength < buffer.byteLength ? output : buffer;
    } catch (error) {
        console.warn('[compressProofBuffer] compression failed, keeping original:', error);
        return buffer;
    }
}
