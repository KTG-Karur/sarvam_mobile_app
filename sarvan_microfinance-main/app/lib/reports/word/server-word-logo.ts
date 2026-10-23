// ============================================================
// SERVER-SIDE WORD LOGO LOADER
// app/lib/reports/word/server-word-logo.ts
//
// Server-only (fs/Prisma/sharp) counterpart to report-export-utils.ts's
// browser-based loadWordLogo() — same active-logo source, same compression
// target, same compact sizing (34px tall, capped at 150px wide, aspect-ratio
// preserved), producing the same WordLogo shape so buildWordDocument() (the
// shared docx-core) renders an identical header regardless of which loader
// supplied the logo.
// ============================================================

import sharp from 'sharp';
import { getActiveLogoBuffer } from '@/app/lib/brand-server';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';
import type { WordLogo } from '@/app/lib/reports/word/docx-core';

// Matches WORD_LOGO_HEIGHT_PX / WORD_LOGO_MAX_WIDTH_PX in report-export-utils.ts.
const WORD_LOGO_HEIGHT_PX = 34;
const WORD_LOGO_MAX_WIDTH_PX = 150;

/**
 * Loads + compresses the active brand logo for a queued (server-generated) Word
 * export. Never throws — any failure resolves to `null` so the worker falls back
 * to a text-only header instead of failing the job.
 */
export async function loadServerWordLogo(): Promise<WordLogo | null> {
    try {
        const logo = await getActiveLogoBuffer();
        if (!logo) return null;

        const metadata = await sharp(logo.buffer).rotate().metadata();
        const naturalWidth = metadata.width;
        const naturalHeight = metadata.height;
        if (!naturalWidth || !naturalHeight) return null;

        const compressed = await compressImageBufferForPdf(logo.buffer, 700, 60);
        if (!compressed) return null;

        const heightPx = WORD_LOGO_HEIGHT_PX;
        const widthPx = Math.min(WORD_LOGO_MAX_WIDTH_PX, Math.round(heightPx * (naturalWidth / naturalHeight)));

        return { dataUri: compressed.dataUrl, widthPx, heightPx };
    } catch (err) {
        console.warn('Queued Word export: could not load brand logo, falling back to text-only header.', err);
        return null;
    }
}
