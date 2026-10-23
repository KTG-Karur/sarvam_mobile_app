import * as XLSX from 'xlsx-js-style';
import { Packer } from 'docx';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { getActiveBrandNames, getActiveBrandInfo, getActiveLogoBuffer } from '@/app/lib/brand-server';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';
import { buildWordDocument } from '@/app/lib/reports/word/docx-core';
import { loadServerWordLogo } from '@/app/lib/reports/word/server-word-logo';
import { getWordOptionsBuilder } from '@/app/lib/reports/word/options-registry';
import { buildDemandSheetQueuePdf } from '@/app/lib/reports/demand-sheet-pdf-queue';
import { pdfRegistry } from '@/app/lib/reports/pdf-registry';
import { excelRegistry } from '@/app/lib/reports/excel-registry';
import type { ReportExportFormat } from '@prisma/client';
import type { ReportRows } from '@/app/lib/reports/report-registry';

/** Extra context a queued Word build needs beyond {title, data} — same values the worker
 *  already has on the ReportRequest row (reportSlug/filters/branchLabel/date range), passed
 *  through so the report-specific options builder (app/lib/reports/word/options-registry.ts)
 *  can reconstruct the same reportInfo/summary/totalsRow the direct export shows.
 *  `branchIds` (added for the "demand-sheet" PDF path, see buildPdf below) is the same
 *  already-authorized branch scope passed to entry.fetch() — null = all branches. */
export type BuildReportFileContext = {
    reportSlug: string;
    filters: Record<string, string> | null;
    branchLabel: string;
    fromDate: string | null;
    toDate: string | null;
    branchIds: string[] | null;
};

/** Puppeteer/Chromium is a heavy single instance shared by the whole always-on process — bail out early on huge PDFs rather than risking OOM. */
export const MAX_PDF_ROWS = 50_000;

export type BuiltFile = {
    buffer: Buffer;
    contentType: string;
    extension: string;
};

function escapeCsvValue(value: string | number): string {
    const str = String(value);
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Report slugs whose Direct Download CSV bypasses the shared `exportToCSV()` utility
 * (app/lib/report-export-utils.ts) entirely, building CSV inline instead — confirmed by
 * direct inspection of each component's own CSV handler (Phase 2 CSV audit). None of these
 * have a company-name/title/blank-line header block or a BOM in their Direct CSV, so this
 * queue builder must not add one for them either — doing so would make Queue's CSV diverge
 * from Direct's own CSV, the opposite of the goal. Every other report slug's Direct CSV goes
 * through `exportToCSV()`, which does have that header block + BOM (see buildCsv() below).
 */
const LEGACY_CSV_REPORT_SLUGS = new Set([
    'addition-disbursed', 'dcr', 'dropouts', 'loan-index', 'loan-ledger', 'meeting-attendance',
    'member-report', 'neft-format', 'loan-passbook', 'transfer', 'mis-branch-demand',
    'os-centerwise', 'mis-agewise-arrear',
]);

/**
 * "neft-format" is the one report where the shared registry fetch's trailing "Grand Total"
 * row is correct for Excel/PDF/Word (all three want it, confirmed) but Direct's own CSV
 * handler (NEFTFormatClient.tsx's handleExport) never appends it — a pre-existing
 * inconsistency between Direct's own CSV and Direct's own other formats. Since Direct CSV is
 * this batch's source of truth and the totals row can't be removed from the shared fetch
 * without breaking Excel/PDF/Word, it's dropped here, in CSV serialization only, for this one
 * report — not a new calculation, just omitting a row already known to be totals-only.
 */
const CSV_DROP_TRAILING_TOTALS_SLUGS = new Set(['neft-format']);

function buildCsv({ headers, rows }: ReportRows, title: string, companyName: string, reportSlug: string): Buffer {
    const effectiveRows = CSV_DROP_TRAILING_TOTALS_SLUGS.has(reportSlug) && rows.length > 0 ? rows.slice(0, -1) : rows;

    if (LEGACY_CSV_REPORT_SLUGS.has(reportSlug)) {
        // Matches each of these reports' own bespoke Direct CSV shape exactly: no header
        // block, no BOM — see LEGACY_CSV_REPORT_SLUGS' comment above.
        const lines = [headers.join(','), ...effectiveRows.map((row) => row.map(escapeCsvValue).join(','))];
        return Buffer.from(lines.join('\n'), 'utf-8');
    }

    // Matches exportToCSV()'s structure exactly (app/lib/report-export-utils.ts): company
    // name (uppercased) + title + blank line, then headers + rows (headers escaped too,
    // matching exportToCSV's `headers.map(escape)`), prefixed with a UTF-8 BOM.
    const lines = [
        companyName.toUpperCase(),
        title,
        '',
        headers.map(escapeCsvValue).join(','),
        ...effectiveRows.map((row) => row.map(escapeCsvValue).join(',')),
    ];
    return Buffer.from('﻿' + lines.join('\n'), 'utf-8');
}

function buildExcel(title: string, { headers, rows }: ReportRows, companyName: string): Buffer {
    // Built positionally (aoa_to_sheet), not via a header-keyed row object — some reports
    // (e.g. Payslip's two-column Earnings/Deductions layout) reuse the same header label
    // for more than one column, and a keyed object would silently collapse those to one.
    const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows(title, companyName), headers, ...rows]);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

function escapeHtml(value: string | number): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * `reportHtmlHeader()`'s logo markup references `/Sarvam_01.png` by relative
 * URL, which only resolves when a page is navigated in-browser — server-side
 * `page.setContent()` has no base URL to resolve it against. Instead the logo
 * is fetched and re-encoded as a compressed base64 `data:` URI by the caller
 * (see `buildPdf`), which `page.setContent()` can render with no network
 * request at all; `logoDataUrl` is omitted when the logo can't be resolved.
 */
function buildReportHtml(
    title: string,
    { headers, rows }: ReportRows,
    companyName: string,
    logoDataUrl: string | null,
    brandColor: { primaryColor: string; primaryTint: string }
): string {
    const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const bodyRows = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:'Times New Roman', Times, serif; }
  body { padding: 16px; }
  .report-header { position:relative; min-height:32px; margin-bottom:4px; }
  .report-logo { position:absolute; left:0; top:0; height:32px; width:auto; max-width:140px; object-fit:contain; }
  .report-header-text { width:100%; text-align:center; }
  h1 { font-size: 11pt; text-align:center; }
  h2 { font-size: 11pt; text-align:center; color:${brandColor.primaryColor}; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; font-size:9px; }
  th, td { border:1px solid #ccc; padding:4px 6px; text-align:left; white-space:nowrap; }
  th { background:${brandColor.primaryColor}; color:#fff; }
  tr:nth-child(even) { background:${brandColor.primaryTint}; }
</style>
</head>
<body>
  <header class="report-header">
    ${logoDataUrl ? `<img class="report-logo" src="${logoDataUrl}" alt="${escapeHtml(companyName)}" />` : ''}
    <div class="report-header-text">
      <h1>${escapeHtml(companyName.toUpperCase())}</h1>
      <h2>${escapeHtml(title)}</h2>
    </div>
  </header>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

/** Resolves the active logo as a small compressed data URI, or null if unavailable — never throws. */
async function getLogoDataUrl(): Promise<string | null> {
    try {
        const logo = await getActiveLogoBuffer();
        if (!logo) return null;
        const compressed = await compressImageBufferForPdf(logo.buffer);
        return compressed?.dataUrl ?? null;
    } catch {
        return null;
    }
}

async function buildPdf(
    title: string,
    data: ReportRows,
    companyName: string,
    brandColor: { primaryColor: string; primaryTint: string }
): Promise<Buffer> {
    if (data.rows.length > MAX_PDF_ROWS) {
        throw new Error(`Report has ${data.rows.length} rows, exceeding the ${MAX_PDF_ROWS}-row PDF export limit — use Excel or CSV instead.`);
    }

    const logoDataUrl = await getLogoDataUrl();

    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
        const page = await browser.newPage();
        try {
            await page.setContent(buildReportHtml(title, data, companyName, logoDataUrl, brandColor), { waitUntil: 'domcontentloaded' });
            const buf = await page.pdf({
                format: 'a4',
                landscape: true,
                printBackground: true,
                margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
            });
            return Buffer.from(buf);
        } finally {
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

/**
 * Builds a queued .docx via the same shared docx-core (app/lib/reports/word/docx-core.ts)
 * used by the direct client-side export, so the two are visually identical by construction.
 * Looks up a report-specific WordExportOptions reconstruction from the options registry;
 * reports with no registered builder yet fall back to the flat/legacy layout (bodyRows as-is,
 * no options) — the same fallback direct Word itself uses when a report's own exportToWord()
 * call omits `options`.
 */
async function buildWord(
    title: string,
    data: ReportRows,
    companyName: string,
    ctx: BuildReportFileContext,
    brandColor: { primaryColor: string; primaryDark: string; primaryTint: string }
): Promise<Buffer> {
    const builder = getWordOptionsBuilder(ctx.reportSlug);
    const { bodyRows, options } = builder
        ? await builder(data.headers, data.rows, { filters: ctx.filters, branchLabel: ctx.branchLabel, fromDate: ctx.fromDate, toDate: ctx.toDate })
        : { bodyRows: data.rows, options: undefined };

    const logo = await loadServerWordLogo();
    const doc = buildWordDocument(companyName.toUpperCase(), title, data.headers, bodyRows, options, logo, {
        primary: brandColor.primaryColor,
        dark: brandColor.primaryDark,
        tint: brandColor.primaryTint,
    });
    return Packer.toBuffer(doc);
}

export async function buildReportFile(
    format: ReportExportFormat,
    title: string,
    data: ReportRows,
    ctx: BuildReportFileContext
): Promise<BuiltFile> {
    switch (format) {
        case 'EXCEL': {
            // Registry-based report-specific Excel renderers (see excel-registry.ts) —
            // checked first, mirroring the PDF registry's own precedent, so a future
            // migration only ever needs to add an entry there, never touch this switch again.
            const registeredExcelRenderer = excelRegistry[ctx.reportSlug];
            if (registeredExcelRenderer) {
                return {
                    buffer: await registeredExcelRenderer(ctx),
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    extension: 'xlsx',
                };
            }
            const { companyNameFull } = await getActiveBrandNames();
            return {
                buffer: buildExcel(title, data, companyNameFull),
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                extension: 'xlsx',
            };
        }
        case 'CSV': {
            const { companyNameFull } = await getActiveBrandNames();
            return {
                buffer: buildCsv(data, title, companyNameFull, ctx.reportSlug),
                contentType: 'text/csv;charset=utf-8',
                extension: 'csv',
            };
        }
        case 'PDF': {
            // Registry-based report-specific PDF renderers (see pdf-registry.ts) —
            // checked first so a future migration only ever needs to add an entry
            // there, never touch this switch again.
            const registeredPdfRenderer = pdfRegistry[ctx.reportSlug];
            if (registeredPdfRenderer) {
                return {
                    buffer: await registeredPdfRenderer(ctx),
                    contentType: 'application/pdf',
                    extension: 'pdf',
                };
            }
            // "demand-sheet" predates the registry above and is handled directly
            // here (untouched) — it reproduces the Direct Download PDF's structure
            // (per-center table + denomination/signature section, repeated once per
            // center for "all centers", or the flat centerwise table + grand total)
            // instead of the generic flat-table Puppeteer layout every other
            // (unregistered) report slug uses below.
            if (ctx.reportSlug === 'demand-sheet' && ctx.fromDate) {
                const reportType = (ctx.filters?.reportType === 'clientwise' ? 'clientwise' : 'centerwise') as
                    | 'centerwise'
                    | 'clientwise';
                return {
                    buffer: await buildDemandSheetQueuePdf({
                        fromDate: ctx.fromDate,
                        fdoId: ctx.filters?.fdoId || 'all',
                        reportType,
                        centerId: ctx.filters?.centerId || undefined,
                        branchIds: ctx.branchIds,
                        branchLabel: ctx.branchLabel,
                    }),
                    contentType: 'application/pdf',
                    extension: 'pdf',
                };
            }
            const { companyNameFull, primaryColor, primaryTint } = await getActiveBrandInfo();
            return {
                buffer: await buildPdf(title, data, companyNameFull, { primaryColor, primaryTint }),
                contentType: 'application/pdf',
                extension: 'pdf',
            };
        }
        case 'WORD': {
            const { companyNameFull, primaryColor, primaryDark, primaryTint } = await getActiveBrandInfo();
            return {
                buffer: await buildWord(title, data, companyNameFull, ctx, { primaryColor, primaryDark, primaryTint }),
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                extension: 'docx',
            };
        }
        default:
            throw new Error(`Unsupported export format: ${format}`);
    }
}
