import * as XLSX from 'xlsx';
import { normalizeMemberId } from '@/app/lib/services/uploan-import.service';

/**
 * Parser for the "Gold Loan Details" export — one row per member's current gold pledge
 * (verified: 313 distinct MemberID keys for 313 data rows in a real sample, no aggregation
 * needed — matches GoldLoanDetail.loanId's @unique constraint directly).
 *
 * Joined against the Member Details Report by MemberID alone (NOT a composite MemberID+Name
 * key like uploan-thrift-outstanding.service.ts uses) — a strict composite key was found to
 * silently drop real matches whose name in this export is a shortened/informal first name
 * only (e.g. "SANTHI" vs. the Member Details Report's "SANTHI SEKAR"; verified 9/313 real
 * gold-loan members dropped this way in a real sample). MemberID alone isn't risk-free
 * either — it's a reused branch/center/group/seat slot code — so a matched row still needs
 * BOTH `namesLooselyOverlap(row.memberName, matchedMemberName)` (checked in
 * uploan-validate.service.ts — rejects the ~4/313 rows in a real sample where the current
 * occupant of that MemberID slot is a genuinely different, unrelated person) AND its
 * resolved LoanProductType to be a gold product (isGoldLoanProduct(), also checked there) —
 * before its gold details are applied. Verified 22/313 rows in a real sample match a real
 * current member whose *current* loan isn't actually gold (stale/prior-cycle pledge).
 *
 * The header row's position varies by export — some copies of this report have a 2-row
 * preamble before the real header, some (e.g. an "All Branch Gold Details" consolidated
 * export) have none, with the header on row 1. A hardcoded row index silently broke on
 * whichever variant it wasn't tuned for (every column index resolved to -1, so every row's
 * memberId/memberName came back empty and got skipped — zero rows mapped, no error, no
 * indication why). Detected instead by scanning the first few rows for one containing a
 * "Member ID" header, so either layout works.
 */

export interface GoldDetailsRow {
    /** The gold file's own Member Name column — kept on the row (not just used to build a
     * key) so uploan-validate.service.ts can run namesLooselyOverlap against whichever
     * member the MemberID-only match actually resolved to. */
    memberName: string;
    weight: number;
    goldAmt: number;
    item: string;
    tokenNo: string;
    ldDate: string;
}

function cell(row: unknown[] | undefined, idx: number): string {
    if (idx < 0 || !row) return '';
    const val = row[idx];
    return val !== undefined && val !== null ? String(val).trim() : '';
}

function toNum(raw: string): number {
    if (!raw) return 0;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}

// Generous bound on how far down to look — real exports have at most a
// small preamble (title/date lines) before the header, never more.
const MAX_HEADER_SEARCH_ROWS = 10;

function findHeaderRowIndex(rows: unknown[][]): number {
    const limit = Math.min(MAX_HEADER_SEARCH_ROWS, rows.length);
    for (let i = 0; i < limit; i++) {
        const row = (rows[i] ?? []) as unknown[];
        if (row.some((h) => String(h ?? '').trim().toLowerCase() === 'member id')) return i;
    }
    return -1;
}

/** Keyed by MemberID alone — see normalizeMemberId. */
export function parseGoldDetailsWorkbook(buffer: ArrayBuffer | Buffer): Map<string, GoldDetailsRow> {
    const workbook = Buffer.isBuffer(buffer)
        ? XLSX.read(buffer, { type: 'buffer' })
        : XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) as unknown[][];

    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex === -1) {
        throw new Error('Gold Loan Details file: could not find the header row (expected a "Member ID" column within the first few rows) — check the file format.');
    }

    const header = (rows[headerRowIndex] ?? []) as unknown[];
    const idx = (name: string) => header.findIndex((h) => String(h ?? '').trim().toLowerCase() === name.toLowerCase());
    const memberIdIdx = idx('Member ID');
    const memberNameIdx = idx('Member Name');
    const weightIdx = idx('Weight');
    const goldAmtIdx = idx('GOLD Amt');
    const itemIdx = idx('Item');
    const tokenNoIdx = idx('GOLD Token No');
    const ldDateIdx = idx('LD Date');

    const byKey = new Map<string, GoldDetailsRow>();
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const memberId = cell(row, memberIdIdx);
        const memberName = cell(row, memberNameIdx);
        if (!memberId || !memberName) continue;

        const key = normalizeMemberId(memberId);
        byKey.set(key, {
            memberName,
            weight: toNum(cell(row, weightIdx)),
            goldAmt: toNum(cell(row, goldAmtIdx)),
            item: cell(row, itemIdx),
            tokenNo: cell(row, tokenNoIdx),
            ldDate: cell(row, ldDateIdx),
        });
    }
    return byKey;
}
