import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { buildUcrfRecord, flagDuplicateMemberIds } from './build-record';
import { buildCdf } from './serialize';
import { UCRF_FIELDS } from './field-map';
import { REPORT_YMD, TEST_CONFIG, makeInput } from './test-fixtures';

vi.mock('@/app/lib/db', () => ({ prisma: {} }));

/**
 * Regression against a sanitized copy of the official sample (.CDF): every name, ID, phone,
 * address and account number was replaced; codes, segment layout and fixed-width header/trailer
 * were kept byte-for-byte. The generator must reproduce the same physical structure.
 */
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'reference-sample.cdf'), 'latin1');
const [refHdr, refRec, refTrl] = fixture.split('\n');
const refParts = refRec.split('|');

const out = buildCdf([buildUcrfRecord(makeInput(), TEST_CONFIG, REPORT_YMD)], TEST_CONFIG, REPORT_YMD, '2026-05-02');
const [hdr, rec, trl] = out.split('\n');
const parts = rec.split('|');

describe('CDF vs sanitized reference sample', () => {
    it('header: same length and identical fixed-width layout of every field', () => {
        expect(hdr).toHaveLength(refHdr.length);
        expect(hdr).toHaveLength(190);
        for (const [from, to] of [[0, 3], [3, 8], [8, 11], [11, 21], [21, 51], [51, 81], [81, 89], [89, 97], [97, 100], [100, 130], [130, 160], [160, 170], [170, 190]]) {
            expect(hdr.slice(from, to)).toHaveLength(refHdr.slice(from, to).length);
        }
        expect(hdr.slice(0, 11)).toBe(refHdr.slice(0, 11)); // HDR + HMMFI + 3.3
        expect(hdr.slice(97, 100)).toBe(refHdr.slice(97, 100)); // JLG
        expect(hdr.slice(160, 170).trim()).toBe(refHdr.slice(160, 170).trim()); // ME
        expect(/^\d{8}$/.test(hdr.slice(81, 89)) && /^\d{8}$/.test(hdr.slice(89, 97))).toBe(true);
        expect(refHdr.slice(100, 160).trim()).toBe(''); // reference leaves old-member/reserved blank
        expect(hdr.slice(100, 160).trim()).toBe('');
    });

    it('trailer: same length, tag, version and member-id offsets', () => {
        expect(trl).toHaveLength(refTrl.length);
        expect(trl.slice(0, 6)).toBe(refTrl.slice(0, 6));
        expect(trl.slice(6, 16)).toBe(TEST_CONFIG.memberId);
        expect(refTrl.slice(16).trim()).toBe('');
        expect(trl.slice(16).trim()).toBe('');
    });

    it('record: 101 pipe parts, segment tags at the same indices, trailing pipe', () => {
        expect(parts).toHaveLength(refParts.length);
        for (const i of [0, 55, 63]) expect(parts[i]).toBe(refParts[i]);
        expect([parts[0], parts[55], parts[63]]).toEqual(['CNSCRD', 'ADRCRD', 'ACTCRD']);
        expect(parts[100]).toBe('');
        expect(refParts[100]).toBe('');
        expect(rec.endsWith('|')).toBe(true);
    });

    it('record: code-typed fields use the same code families as the reference', () => {
        const codeFields: Array<[number, RegExp]> = [
            [14, /^M0\d$/], [16, /^K\d\d$/], [38, /^P0\d$/], [55, /^W0\d$/], [71, /^T0\d$/], [75, /^S\d\d$/], [85, /^F\d\d$/],
        ];
        for (const [no, re] of codeFields) {
            expect(refParts[no - 1], `reference field ${no}`).toMatch(re);
            expect(parts[no - 1], `generated field ${no}`).toMatch(re);
        }
        // dates are DDMMYYYY in both
        for (const no of [10, 70, 78]) {
            expect(refParts[no - 1]).toMatch(/^\d{8}$/);
            expect(parts[no - 1]).toMatch(/^\d{8}$/);
        }
    });

    it('fields mandatory in the spec are populated in both the reference and our output', () => {
        for (const f of UCRF_FIELDS.filter((x) => x.option === 'Mandatory')) {
            expect(refParts[f.no - 1], `reference #${f.no} ${f.name}`).not.toBe('');
            expect(parts[f.no - 1], `generated #${f.no} ${f.name}`).not.toBe('');
        }
    });

    it('line endings are LF, file ends with a newline, no CR / headings / extras', () => {
        expect(fixture.includes('\r')).toBe(false);
        expect(out.includes('\r')).toBe(false);
        expect(out.endsWith('\n')).toBe(true);
        expect(out.split('\n')).toHaveLength(4); // hdr, rec, trl, ''
    });
});

describe('validator regressions', () => {
    const closedWriteOff = () =>
        buildUcrfRecord(
            makeInput({ disbursementStatus: 'CLOSED', closedYmd: '2026-04-20', closureReason: 'WRITEOFF', writeOff: { amount: 3000, ymd: '2026-04-20' } }),
            TEST_CONFIG,
            REPORT_YMD
        );

    it('a written-off (S06) loan is a VALID record — closed date, overdue and write-off fields allowed together', () => {
        const r = closedWriteOff();
        expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(r.isValid).toBe(true);
        const f = (n: number) => r.fields[n - 1];
        expect([f(75), f(79), f(87), f(90), f(91), f(92)]).toEqual(['S06', '20042026', '0', '3000', '20042026', 'X09']);
        expect(Number(f(88))).toBeGreaterThan(0);
        expect(buildCdf([r], TEST_CONFIG, REPORT_YMD, REPORT_YMD)).toContain('|S06|');
    });

    it('a closed S07 loan with no overdue is valid; with a stale S07 + overdue it never happens by construction', () => {
        const r = buildUcrfRecord(makeInput({ disbursementStatus: 'CLOSED', closedYmd: '2026-04-20' }), TEST_CONFIG, REPORT_YMD);
        expect(r.isValid).toBe(true);
        expect(r.fields[74]).toBe('S07');
    });

    it('members with a valid email stay valid (A/N charset must not reject @ and .)', () => {
        const r = buildUcrfRecord(makeInput({ client: { ...makeInput().client, email: 'asha.devi@example.com' } }), TEST_CONFIG, REPORT_YMD);
        expect(r.isValid).toBe(true);
        expect(r.fields[62]).toBe('asha.devi@example.com');
        const bad = buildUcrfRecord(makeInput({ client: { ...makeInput().client, email: 'not an email' } }), TEST_CONFIG, REPORT_YMD);
        expect(bad.isValid).toBe(true); // optional → field blanked with a warning
        expect(bad.fields[62]).toBe('');
        expect(bad.issues.some((i) => i.fieldNo === 63 && i.severity === 'warning')).toBe(true);
    });

    it('violations in Optional fields are field-level warnings, not record rejections', () => {
        const long = 'X'.repeat(120); // field 21 allows 100
        const r = buildUcrfRecord(makeInput({ client: { ...makeInput().client, motherName: long } }), TEST_CONFIG, REPORT_YMD);
        expect(r.isValid).toBe(true);
        expect(r.issues.some((i) => i.fieldNo === 21 && i.severity === 'warning')).toBe(true);
    });

    it('centre identifier is branch-qualified because Center.code is only unique per branch', () => {
        const r = buildUcrfRecord(makeInput(), TEST_CONFIG, REPORT_YMD);
        expect(r.fields[3]).toBe('BR01-C07');
        expect(r.fields[67]).toBe('BR01-C07');
    });

    it('two different clients sharing one Member Identifier are both rejected; one client with two loans is fine', () => {
        const a = buildUcrfRecord(makeInput(), TEST_CONFIG, REPORT_YMD);
        const b = buildUcrfRecord(makeInput({ loanId: 'l2', loanNumber: '000124', client: { ...makeInput().client, dbId: 'client_2' } }), TEST_CONFIG, REPORT_YMD);
        flagDuplicateMemberIds([a, b]);
        expect(a.isValid || b.isValid).toBe(false);
        expect([a, b].every((r) => r.issues.some((i) => i.fieldNo === 2 && i.severity === 'error'))).toBe(true);

        const c = buildUcrfRecord(makeInput(), TEST_CONFIG, REPORT_YMD);
        const d = buildUcrfRecord(makeInput({ loanId: 'l3', loanNumber: '000125' }), TEST_CONFIG, REPORT_YMD);
        flagDuplicateMemberIds([c, d]);
        expect(c.isValid && d.isValid).toBe(true);
    });
});
