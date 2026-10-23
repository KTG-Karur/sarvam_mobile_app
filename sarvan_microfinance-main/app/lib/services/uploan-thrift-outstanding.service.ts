import * as XLSX from 'xlsx';
import { buildMemberNameKey } from '@/app/lib/services/uploan-import.service';

/**
 * Parser for the "Thrift/Loan-Advance Outstanding Report" — one row per member per loan
 * cycle, covering a member's ENTIRE loan-advance savings history (unlike the Member
 * Details Report's Thrift1 OS/Thrift2 OS columns, which only reflect their current loan).
 *
 * Joined against the Member Details Report by (MemberID, Name) — NOT MemberID alone, which
 * is a reused branch/center/group/seat slot code (verified: 8/475 multi-row MemberIDs in a
 * real sample actually span two different people's names). Per-member value is the SUM of
 * "Balance Loan Advance O/S" across every row sharing that (MemberID, Name) key — the
 * report is loan-cycle-wise, and the outstanding balance is the total across all cycles.
 *
 * Runs server-side (can run to 1000+ rows for a full branch) — see
 * app/api/uploan/member/preview/route.ts, which uploads the raw file to GCS once and
 * re-parses it from there on every re-validate rather than round-tripping the parsed
 * result through the browser.
 */

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

/** Sums "Balance Loan Advance O/S" per (MemberID, Name) key — see buildMemberNameKey. */
export function parseThriftOutstandingWorkbook(buffer: ArrayBuffer | Buffer): Map<string, number> {
    const workbook = Buffer.isBuffer(buffer)
        ? XLSX.read(buffer, { type: 'buffer' })
        : XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) as unknown[][];

    const header = (rows[0] ?? []) as unknown[];
    const idx = (name: string) => header.findIndex((h) => String(h ?? '').trim().toLowerCase() === name.toLowerCase());
    const memberIdIdx = idx('Member ID');
    const memberNameIdx = idx('Member Name');
    const balanceOsIdx = idx('Balance Loan Advance O/S');

    const sumByKey = new Map<string, number>();
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const memberId = cell(row, memberIdIdx);
        const memberName = cell(row, memberNameIdx);
        if (!memberId || !memberName) continue;

        const key = buildMemberNameKey(memberId, memberName);
        const amount = toNum(cell(row, balanceOsIdx));
        sumByKey.set(key, (sumByKey.get(key) ?? 0) + amount);
    }
    return sumByKey;
}
