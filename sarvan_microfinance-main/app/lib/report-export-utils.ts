import { Packer } from 'docx';
import { getBrandNamesGlobal } from '@/app/lib/brand-context';
import { compressDataUrlForPdf } from '@/app/lib/pdf/compress-image-for-pdf';
import { buildWordDocument, type CellValue, type WordExportOptions, type WordLogo } from '@/app/lib/reports/word/docx-core';

export type { WordExportInfoItem, WordExportGroupHeader, WordExportOptions } from '@/app/lib/reports/word/docx-core';

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Exports tabular data to a CSV file, prefixed with the trust name + report title
 * (matching the header convention used by buildReportSheet for Excel exports).
 */
export function exportToCSV(
    filename: string,
    title: string,
    headers: CellValue[],
    rows: CellValue[][]
): void {
    const escape = (v: CellValue) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csvContent = [
        getBrandNamesGlobal().companyNameFull.toUpperCase(),
        title,
        '',
        headers.map(escape).join(','),
        ...rows.map((row) => row.map(escape).join(',')),
    ].join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

// ── Brand logo for the Word header ──────────────────────────────────────────────
// Reuses the exact source + compression approach already proven out for the PDF
// header (app/lib/reports/pdf-report-header.ts): fetch the active logo from the
// same public endpoint via a browser <img>, then re-encode it small via the shared
// canvas-based compressDataUrlForPdf() helper — never the server-only
// getActiveLogoBuffer()/compressImageBufferForPdf() (fs/Prisma/sharp), since this
// whole exporter runs client-side. The server-side queued-export path
// (app/lib/reports/word/server-word-builder.ts) loads its own WordLogo the
// server-safe way and passes it into the same buildWordDocument() core.
const WORD_LOGO_SRC = '/api/branding/asset/logo-wordmark';
// Compact inline sizing (not a full-width banner) so the logo reads as a small
// header mark next to the company name rather than dominating the page.
const WORD_LOGO_HEIGHT_PX = 34;
const WORD_LOGO_MAX_WIDTH_PX = 150;

// Cached per logoVersion (BrandConfig/ThemePreset updatedAt) so repeated exports —
// even across different reports in the same tab — don't refetch/recompress the
// same image; a freshly-uploaded logo still busts the cache, matching the `?v=`
// convention used elsewhere for the logo <img>.
let cachedWordLogo: WordLogo | null | undefined;
let cachedWordLogoVersion: number | undefined;

/**
 * Loads + compresses the active brand logo for the Word header. Never throws —
 * any failure (network, decode, missing browser APIs) resolves to `null` so
 * callers fall back to the existing text-only header instead of breaking the
 * export.
 */
async function loadWordLogo(): Promise<WordLogo | null> {
    const logoVersion = getBrandNamesGlobal().logoVersion;
    if (cachedWordLogo !== undefined && cachedWordLogoVersion === logoVersion) return cachedWordLogo;

    try {
        const src = logoVersion ? `${WORD_LOGO_SRC}?v=${logoVersion}` : WORD_LOGO_SRC;
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.crossOrigin = 'Anonymous';
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Word export: logo image failed to load'));
            el.src = src;
        });

        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        if (!naturalWidth || !naturalHeight) throw new Error('Word export: logo image has no dimensions');

        // Same re-encode as the PDF header — the source wordmark can be a multi-MB
        // full-resolution PNG; a Word header only ever displays it a few mm tall.
        const dataUri = await compressDataUrlForPdf(img.src, 700, 0.6);

        const heightPx = WORD_LOGO_HEIGHT_PX;
        const widthPx = Math.min(WORD_LOGO_MAX_WIDTH_PX, Math.round(heightPx * (naturalWidth / naturalHeight)));

        const result: WordLogo = { dataUri, widthPx, heightPx };
        cachedWordLogo = result;
        cachedWordLogoVersion = logoVersion;
        return result;
    } catch (err) {
        console.warn('Word export: could not load brand logo, falling back to text-only header.', err);
        cachedWordLogo = null;
        cachedWordLogoVersion = logoVersion;
        return null;
    }
}

/**
 * Exports tabular data to a genuine .docx file (via the docx package), prefixed with
 * the trust name + report title, mirroring the Excel/CSV export header convention.
 *
 * `options` is optional and additive — when omitted, output is the original flat
 * single-header-row layout used by most reports' Word export.
 *
 * This is the thin, browser-only wrapper around the shared, environment-agnostic
 * `buildWordDocument()` core (app/lib/reports/word/docx-core.ts): it only owns loading
 * the logo via browser APIs and triggering the download. Document construction itself
 * lives in the shared core so the server-side queued-export path
 * (app/lib/reports/word/server-word-builder.ts) produces byte-for-byte the same design.
 */
export async function exportToWord(
    filename: string,
    title: string,
    headers: CellValue[],
    rows: CellValue[][],
    options?: WordExportOptions
): Promise<void> {
    const brand = getBrandNamesGlobal();
    const companyNameCaps = brand.companyNameFull.toUpperCase();
    // Loaded once per export call (and cached across calls by loadWordLogo itself).
    const logo = await loadWordLogo();
    const doc = buildWordDocument(companyNameCaps, title, headers, rows, options, logo, {
        primary: brand.primaryColor,
        dark: brand.primaryDark,
        tint: brand.primaryTint,
    });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, filename.endsWith('.docx') ? filename : `${filename}.docx`);
}
