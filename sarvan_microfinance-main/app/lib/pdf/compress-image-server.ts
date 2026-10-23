import sharp from 'sharp';

/**
 * Server-side (Node) counterpart to compress-image-for-pdf.ts's browser-canvas
 * version — used wherever a PDF is built by Puppeteer rendering HTML against
 * cross-origin storage URLs. A canvas-based resize can't be done in that page
 * (the private bucket has no CORS policy, so drawing a signed-URL <img> onto a
 * <canvas> throws a SecurityError before it can be re-encoded), so the bytes
 * must be fetched and resized here instead, then embedded as a data: URI —
 * which also sidesteps needing any cross-origin image load at PDF-render time.
 *
 * Downscales to a bounded pixel size and re-encodes as JPEG; uploaded source
 * photos are often several MB at full camera resolution, but a PDF only ever
 * displays them as a few-centimetre thumbnail.
 */
export async function compressImageBufferForPdf(
    buffer: Buffer,
    maxDimPx = 700,
    quality = 60
): Promise<{ dataUrl: string; mimeType: string } | null> {
    try {
        const resized = await sharp(buffer)
            .rotate() // apply EXIF orientation before flattening metadata away
            .resize({ width: maxDimPx, height: maxDimPx, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' }) // drop alpha (e.g. source PNG) before JPEG encode
            .jpeg({ quality, mozjpeg: true })
            .toBuffer();
        return { dataUrl: `data:image/jpeg;base64,${resized.toString('base64')}`, mimeType: 'image/jpeg' };
    } catch {
        return null;
    }
}
