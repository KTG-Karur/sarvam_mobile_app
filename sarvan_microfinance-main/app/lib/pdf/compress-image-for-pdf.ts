'use client';

/**
 * Downscale + recompress a data: URL image before embedding it into a jsPDF
 * document via doc.addImage(). Uploaded source photos (phone camera JPEGs)
 * are often several MB at full resolution, but a PDF only ever displays them
 * at a few centimetres — re-encoding at a bounded pixel size keeps each
 * embedded image in the tens of KB instead of megabytes, without a visible
 * quality loss at print size.
 */
export function compressDataUrlForPdf(
    dataUrl: string,
    maxDimPx = 700,
    quality = 0.6
): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxDimPx / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas not supported')); return; }
            // Flatten any transparency (e.g. a source PNG) onto white before the JPEG encode.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = dataUrl;
    });
}
