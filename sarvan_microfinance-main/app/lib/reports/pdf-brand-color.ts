import type { jsPDF } from 'jspdf';

type DocWithBrandColor = jsPDF & {
  __brandPrimaryRgb?: [number, number, number];
  __brandTintRgb?: [number, number, number];
};

/** Sarvam green — only used as a read-side fallback if a table is ever drawn on a `doc` that
 *  never had a header drawn on it first (shouldn't happen: every real report draws its header
 *  via drawPdfReportHeader/-Server before its first autoTable call). */
const FALLBACK_PRIMARY_RGB: [number, number, number] = [3, 127, 53];

/** Sarvam's pale-green zebra-row tint — same fallback reasoning as FALLBACK_PRIMARY_RGB. */
const FALLBACK_TINT_RGB: [number, number, number] = [240, 250, 244];

/**
 * Stashes the active theme's primary color (as resolved by drawPdfReportHeader/-Server, the
 * shared "logo + company name + report title" header drawers) onto the jsPDF instance itself,
 * so every report's own `autoTable` header/foot `fillColor` — previously each a separate
 * hardcoded `[3, 127, 53]` Sarvam-green literal, one per report file — can read it back without
 * threading a new parameter through ~50 report-drawing functions' public signatures (each
 * already shared between a browser Direct-download caller and a server Request-Report queue
 * caller via an injected `drawHeader`).
 */
export function setDocBrandPrimaryRgb(doc: jsPDF, rgb: [number, number, number]): void {
  (doc as DocWithBrandColor).__brandPrimaryRgb = rgb;
}

/** Reads back the color stashed by `setDocBrandPrimaryRgb` — use in place of the old hardcoded
 *  `fillColor: [3, 127, 53]` in any report's `autoTable` `headStyles`/`footStyles`. */
export function getDocBrandPrimaryRgb(doc: jsPDF): [number, number, number] {
  return (doc as DocWithBrandColor).__brandPrimaryRgb ?? FALLBACK_PRIMARY_RGB;
}

/** Same side-channel as `setDocBrandPrimaryRgb`, for the theme's pale tint anchor — used for
 *  `autoTable` `alternateRowStyles`/highlighted-cell `fillColor`s that used to hardcode a pale
 *  Sarvam-green literal (`[240, 250, 244]` / `[240, 249, 244]`). */
export function setDocBrandTintRgb(doc: jsPDF, rgb: [number, number, number]): void {
  (doc as DocWithBrandColor).__brandTintRgb = rgb;
}

/** Reads back the color stashed by `setDocBrandTintRgb` — use in place of the old hardcoded
 *  pale-green zebra-tint literals. */
export function getDocBrandTintRgb(doc: jsPDF): [number, number, number] {
  return (doc as DocWithBrandColor).__brandTintRgb ?? FALLBACK_TINT_RGB;
}
