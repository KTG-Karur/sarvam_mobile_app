import type { jsPDF } from 'jspdf';

// Report PDFs use Times New Roman at 11pt (see pdf-report-header.ts / each report's
// autoTable styles). jsPDF ships 'times' as one of its 14 built-in standard fonts, so unlike
// the previous Poppins setup it needs no TTF embedding — `doc.setFont('times', 'normal'|'bold')`
// and jspdf-autotable's `styles.font: 'times'` work with zero registration.
export const REPORT_FONT_FAMILY = 'times';

/**
 * Returns the font family to use for report PDFs. Kept as an async function (rather than
 * inlining the 'times' literal at every call site) so every existing `await ensureReportFont(doc)`
 * call across the report PDF builders keeps working unchanged.
 */
export async function ensureReportFont(_doc: jsPDF): Promise<string> {
  return REPORT_FONT_FAMILY;
}
