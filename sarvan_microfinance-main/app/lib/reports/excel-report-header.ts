// xlsx-js-style is an API-compatible fork of the `xlsx` (SheetJS) package that adds support for
// per-cell styling (`cell.s`) — the free `xlsx` build silently discards any style on write. Every
// report Excel export must import XLSX from here (not from 'xlsx') for `applyExcelReportFont`
// below to actually persist into the written .xlsx file, since the write call itself is what
// applies (or discards) cell styles, not the worksheet object.
import * as XLSX from 'xlsx-js-style';
import { getBrandNamesGlobal } from '@/app/lib/brand-context';

/**
 * Standard header rows to prepend to an aoa_to_sheet array literal: [[trust name], [title], []].
 * `companyName` defaults to the live browser-side active theme name — pass it explicitly
 * from server-side callers (no `window` there), e.g. via `getActiveBrandNames()`.
 */
export function reportHeaderRows(title: string, companyName?: string): (string | number)[][] {
  return [[(companyName ?? getBrandNamesGlobal().companyNameFull).toUpperCase()], [title], []];
}

/**
 * Builds a worksheet with the standard trust header rows above the data —
 * a drop-in replacement for `XLSX.utils.json_to_sheet(rows)`.
 */
export function buildReportSheet(
  title: string,
  rows: Record<string, unknown>[],
  companyName?: string
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(reportHeaderRows(title, companyName));
  XLSX.utils.sheet_add_json(ws, rows, { origin: -1 });
  return ws;
}

/**
 * Sets a readable column width per column based on the longest stringified
 * value actually present in that column (header or data), so Excel's narrow
 * default width (~8.43 chars) doesn't clip numbers into "####". Works on any
 * worksheet regardless of how it was built (aoa_to_sheet, json_to_sheet,
 * sheet_add_json) — call it once, right after the worksheet is fully populated.
 */
export function autoSizeColumns(
  ws: XLSX.WorkSheet,
  minWidth = 10,
  maxWidth = 40
): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cols: { wch: number }[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    let maxLen = minWidth;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== null) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = len;
      }
    }
    cols.push({ wch: Math.min(maxWidth, maxLen + 2) });
  }
  ws['!cols'] = cols;
}

// Column headers whose values are identifiers that merely look numeric — these must stay text
// (leading zeros, 10+ digit phone/Aadhaar/account numbers, codes that should never be summed).
const IDENTIFIER_HEADER =
  /mobile|phone|contact|aadha|adhar|\bpan\b|voter|ifsc|micr|pin\s*code|pincode|postal|zip|cheque|chq|instrument|utr|\buan\b|\besi\b|\bpf\b|a\/c|\b(id|code)\b|\b(loan|client|member|cust(omer)?|center|centre|group|book|employee|emp|staff|voucher|receipt|bill|invoice|policy|account|acc|ac|card|ref(erence)?|txn|transaction|reg(istration)?)\.?\s*(no|number|#)\b/i;

// Plain digits, Western grouping (1,234,567) or Indian grouping (12,34,567), optional decimals.
const NUMERIC_BODY = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.\d+)?$/;
const CURRENCY_PREFIX = /^(₹|rs\.?|inr)\s*/i;

/**
 * Turns a display-formatted number string ("₹1,23,456.00", "-450.50", "(1,200)", "12.5%",
 * "1,000/-") into { value, numFmt }, or null when it isn't a plain number. Pure-digit strings
 * with a leading zero or 10+ digits are treated as identifiers and left alone.
 */
export function parseNumericText(raw: string): { value: number; numFmt?: string } | null {
  let s = raw.trim();
  if (!s) return null;

  const isPercent = s.endsWith('%');
  if (isPercent) s = s.slice(0, -1).trim();

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  }

  const hadCurrency = CURRENCY_PREFIX.test(s);
  s = s.replace(CURRENCY_PREFIX, '').replace(/\s*\/-$/, '');
  if (s.startsWith('-')) {
    // "₹-450" / "Rs. -450"
    negative = !negative;
    s = s.slice(1).trim();
  }

  if (!NUMERIC_BODY.test(s)) return null;

  const [intPart, decPart = ''] = s.split('.');
  const digits = intPart.replace(/,/g, '');
  const hadGrouping = intPart.includes(',');
  if (!hadGrouping && !decPart && !hadCurrency && !isPercent) {
    if (digits.length > 1 && digits.startsWith('0')) return null;
    if (digits.length >= 10) return null;
  }
  if (digits.length + decPart.length > 15) return null; // beyond double precision

  const parsed = Number(`${digits}${decPart ? `.${decPart}` : ''}`);
  if (!Number.isFinite(parsed)) return null;
  const value = negative ? -parsed : parsed;

  const decimals = decPart ? `.${'0'.repeat(decPart.length)}` : '';
  if (isPercent) return { value: value / 100, numFmt: `0${decimals}%` };
  if (hadGrouping || hadCurrency) return { value, numFmt: `#,##0${decimals}` };
  if (decimals) return { value, numFmt: `0${decimals}` };
  return { value };
}

/**
 * Converts text cells holding a formatted number (amounts/counts/percentages built with
 * formatCurrency, toLocaleString, toFixed, ...) into real numeric cells so Excel can sum and
 * sort them, keeping the same visible decimals/grouping via a number format. A column whose
 * header looks like an identifier (mobile, Aadhaar, account no, IFSC, IDs, codes — see
 * IDENTIFIER_HEADER) is left as text. Works on sheets from either `xlsx` or `xlsx-js-style`.
 */
export function normalizeNumericCells(ws: XLSX.WorkSheet): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  // Per column: the most recent non-numeric text seen above the current row, i.e. its header.
  const columnLabel: string[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.t !== 's' || typeof cell.v !== 'string' || cell.z === '@') continue;
      const parsed = parseNumericText(cell.v);
      if (!parsed) {
        const text = cell.v.trim();
        if (text && !/^[-–—]+$/.test(text)) columnLabel[c] = text;
        continue;
      }
      if (IDENTIFIER_HEADER.test(columnLabel[c] ?? '')) continue;
      cell.t = 'n';
      cell.v = parsed.value;
      delete cell.w;
      if (parsed.numFmt) cell.z = parsed.numFmt;
    }
  }
}

/** Runs `normalizeNumericCells` on every sheet of the workbook — call right before writing it. */
export function normalizeWorkbookNumbers(wb: XLSX.WorkBook): void {
  for (const name of wb.SheetNames) normalizeNumericCells(wb.Sheets[name]);
}

/**
 * Stamps Times New Roman 11pt on every populated cell in the worksheet's used range — the
 * report-export font requirement — after first converting number-looking text cells into real
 * numbers (see `normalizeNumericCells`), so every report calling this exports amounts Excel
 * can sum. Never touches column widths or other existing styles, and is independent of
 * `autoSizeColumns`. Call once, right after the worksheet is fully populated (same point
 * autoSizeColumns is called from). The font only reaches the actual .xlsx file if the worksheet
 * is written via `xlsx-js-style` (see the import note above) — the plain `xlsx` package
 * discards it silently; the numeric conversion survives either way.
 */
export function applyExcelReportFont(ws: XLSX.WorkSheet): void {
  if (!ws['!ref']) return;
  normalizeNumericCells(ws);
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      cell.s = { ...cell.s, font: { ...cell.s?.font, name: 'Times New Roman', sz: 11 } };
    }
  }
}
