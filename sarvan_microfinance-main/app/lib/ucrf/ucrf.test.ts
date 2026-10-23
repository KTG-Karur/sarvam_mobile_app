import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildUcrfRecord, flagDuplicateAccounts } from './build-record';
import { computeLoanFinancials, deriveAccountState } from './financials';
import { UCRF_FIELDS } from './field-map';
import { paiseToRupeesTrunc, toPaise, ymdToDdmmyyyy } from './format';
import { mapCaste, mapEducation, mapRelationship, mapRepaymentFrequency } from './codes';
import { isValidAadhaar, isValidIndianPhone, isValidPan, isValidPin, verhoeffValid } from './id-validation';
import {
    buildCdf,
    buildCdfHeader,
    buildCdfTrailer,
    csvLines,
    errorCsvLines,
    jsonChunks,
    REPORT_COLUMNS,
} from './serialize';
import { buildXlsx } from './serialize-xlsx';
import { REPORT_YMD, TEST_CONFIG, makeInput, paySchedules, syntheticAadhaar } from './test-fixtures';
import { validateFileLevel } from './validate';

const build = (over = {}) => buildUcrfRecord(makeInput(over), TEST_CONFIG, REPORT_YMD);

describe('field table', () => {
    it('has exactly 100 fields: CNSCRD 1-55, ADRCRD 56-63, ACTCRD 64-100', () => {
        expect(UCRF_FIELDS).toHaveLength(100);
        UCRF_FIELDS.forEach((f, i) => expect(f.no).toBe(i + 1));
        expect(UCRF_FIELDS.filter((f) => f.segment === 'CNSCRD')).toHaveLength(55);
        expect(UCRF_FIELDS.filter((f) => f.segment === 'ADRCRD')).toHaveLength(8);
        expect(UCRF_FIELDS.filter((f) => f.segment === 'ACTCRD')).toHaveLength(37);
        expect([1, 56, 64].map((n) => UCRF_FIELDS[n - 1].name)).toEqual(Array(3).fill('Segment Identifier'));
    });
});

describe('formatting & decimals', () => {
    it('formats dates DDMMYYYY', () => expect(ymdToDdmmyyyy('2026-04-30')).toBe('30042026'));
    it('works in integer paise and truncates (not rounds) rupees', () => {
        expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
        expect(toPaise('1234.567')).toBe(123457);
        expect(paiseToRupeesTrunc(123499)).toBe(1234);
        expect(paiseToRupeesTrunc(99)).toBe(0);
    });
});

describe('code mappings against real-world values', () => {
    it('maps Spouse by member gender; unknown relation is null, never K15', () => {
        expect(mapRelationship('Spouse', 'Female')).toBe('K02');
        expect(mapRelationship('SPOUSE', 'Male')).toBe('K06');
        expect(mapRelationship('Spouse', null)).toBeNull();
        expect(mapRelationship('HUSBAND')).toBe('K02');
        expect(mapRelationship('mother-in-law')).toBe('K08');
        expect(mapRelationship('Neighbour')).toBeNull();
    });
    it('maps education / caste / frequency stored values', () => {
        expect(mapEducation('sslc_10th')).toBe('Y04');
        expect(mapEducation('no_education')).toBe('Y01');
        expect(mapEducation('hsc_12th')).toBe('Y05');
        expect(mapEducation('middle_school')).toBe('Y03');
        expect(mapCaste('SC/ST')).toBeNull(); // ambiguous — never guessed
        expect(mapCaste('DNC')).toBe('V04');
        expect(mapRepaymentFrequency('forthnight')).toBe('F02');
        expect(mapRepaymentFrequency('weekly')).toBe('F01');
        expect(mapRepaymentFrequency('')).toBeNull();
    });
    it('Spouse nominee on a female member is exported as K02 without a warning', () => {
        const r = build({ client: { ...makeInput().client, nomineeName: 'Mohan', nomineeRelation: 'Spouse' } });
        expect(r.fields[24]).toBe('Mohan');
        expect(r.fields[25]).toBe('K02');
        expect(r.issues.some((i) => i.fieldNo === 25)).toBe(false);
    });
});

describe('id validation', () => {
    it('validates Aadhaar check digit (Verhoeff)', () => {
        const ok = syntheticAadhaar();
        expect(verhoeffValid(ok)).toBe(true);
        expect(isValidAadhaar(ok)).toBe(true);
        expect(isValidAadhaar(ok.slice(0, 11) + ((Number(ok[11]) + 1) % 10))).toBe(false);
        expect(isValidAadhaar('12345')).toBe(false);
    });
    it('validates PAN, phone and PIN rules', () => {
        expect(isValidPan('ABCPE1234F')).toBe(true);
        expect(isValidPan('ABCDE1234F')).toBe(false);
        expect(isValidIndianPhone('9876501234')).toBe(true);
        expect(isValidIndianPhone('1234567890')).toBe(false);
        expect(isValidIndianPhone('9999999999')).toBe(false);
        expect(isValidIndianPhone('9876543210')).toBe(false); // descending run
        expect(isValidPin('301001', 'RJ').ok).toBe(true);
        expect(isValidPin('301000', 'RJ').ok).toBe(false);
        expect(isValidPin('601001', 'RJ').ok).toBe(false);
        expect(isValidPin('30100', 'RJ').ok).toBe(false);
    });
});

describe('financials: overdue, DPD, outstanding', () => {
    const input = makeInput();
    it('no payments: 4 installments due before 30-Apr are all overdue; DPD from the oldest (15-Jan)', () => {
        const f = computeLoanFinancials(input.amount, input.schedules, REPORT_YMD);
        expect(f.overduePaise).toBe(440000);
        expect(f.dpd).toBe(105);
        expect(f.outstandingPaise).toBe(400000);
        expect(f.installmentPaise).toBe(110000);
        expect(f.installments).toBe(4);
    });
    it('a schedule due on the report date itself is not past due', () => {
        const f = computeLoanFinancials(1000, [{ dueYmd: REPORT_YMD, principalDue: 1000, interestDue: 100, status: 'PENDING', principalPaid: 0, interestPaid: 0 }], REPORT_YMD);
        expect(f.overduePaise).toBe(0);
        expect(f.dpd).toBe(0);
    });
    it('uses ledger-paid amounts: partial payment on oldest keeps DPD, reduces overdue and balance', () => {
        const s = input.schedules.map((x, i) => (i === 0 ? { ...x, principalPaid: 400, interestPaid: 50 } : x));
        const f = computeLoanFinancials(input.amount, s, REPORT_YMD);
        expect(f.overduePaise).toBe(440000 - 45000);
        expect(f.dpd).toBe(105);
        expect(f.outstandingPaise).toBe(400000 - 40000);
    });
    it('WAIVED/CLOSED schedules are excluded from overdue', () => {
        const s = input.schedules.map((x, i) => (i < 2 ? { ...x, status: 'WAIVED' } : x));
        expect(computeLoanFinancials(input.amount, s, REPORT_YMD).overduePaise).toBe(220000);
    });
    it('caps DPD at 999 and never reports a negative balance', () => {
        const f = computeLoanFinancials(100, [{ dueYmd: '2020-01-01', principalDue: 100, interestDue: 0, status: 'PENDING', principalPaid: 150, interestPaid: 0 }], REPORT_YMD);
        expect(f.outstandingPaise).toBe(0);
        const g = computeLoanFinancials(100, [{ dueYmd: '2020-01-01', principalDue: 100, interestDue: 0, status: 'PENDING', principalPaid: 0, interestPaid: 0 }], REPORT_YMD);
        expect(g.dpd).toBe(999);
    });
    it('derives account status: S05 delinquent, S04 current, S07 closed, S06 written off', () => {
        expect(deriveAccountState(makeInput(), REPORT_YMD).status).toBe('S05');
        expect(deriveAccountState(paySchedules(makeInput(), 4), REPORT_YMD).status).toBe('S04');
        const closed = deriveAccountState(makeInput({ disbursementStatus: 'CLOSED', closedYmd: '2026-04-20' }), REPORT_YMD);
        expect(closed).toMatchObject({ status: 'S07', outstandingRupees: 0, overdueRupees: 0, dpd: 0, closedYmd: '2026-04-20' });
        const wo = deriveAccountState(makeInput({ disbursementStatus: 'CLOSED', closedYmd: '2026-04-20', closureReason: 'WRITEOFF', writeOff: { amount: 3000.75, ymd: '2026-04-20' } }), REPORT_YMD);
        expect(wo).toMatchObject({ status: 'S06', writeOffRupees: 3000, writeOffYmd: '2026-04-20', writeOffReason: 'X09' });
        // closed after the report date → still reported as live on that date
        expect(deriveAccountState(makeInput({ disbursementStatus: 'CLOSED', closedYmd: '2026-06-01' }), REPORT_YMD).status).toBe('S05');
    });
});

describe('record build + validation', () => {
    it('builds a valid record with 100 fields and expected values', () => {
        const r = build();
        expect(r.isValid).toBe(true);
        expect(r.fields).toHaveLength(100);
        const f = (n: number) => r.fields[n - 1];
        expect(f(1)).toBe('CNSCRD');
        expect(f(2)).toBe('00045'); // leading zeros preserved
        expect(f(10)).toBe('17051990');
        expect(f(13)).toBe('F');
        expect(f(15)).toBe('Mohan Lal');
        expect(f(16)).toBe('K02');
        expect(f(38)).toBe('P03');
        expect(f(55)).toBe('W01');
        expect(f(56)).toBe('ADRCRD');
        expect(f(58)).toBe('RJ');
        expect(f(59)).toBe('301001');
        expect(f(64)).toBe('ACTCRD');
        expect(f(65)).toBe('000123');
        expect(f(70)).toBe('30042026');
        expect(f(71)).toBe('T02');
        expect(f(75)).toBe('S05');
        expect(f(78)).toBe('10012026');
        expect(f(83)).toBe('4000');
        expect(f(84)).toBe('4');
        expect(f(85)).toBe('F03');
        expect(f(86)).toBe('1100');
        expect(f(87)).toBe('4000');
        expect(f(88)).toBe('4400');
        expect(f(89)).toBe('105');
        expect(f(93)).toBe('C01');
        // reserved / unmapped fields stay blank
        for (const n of [8, 9, 11, 12, 27, 31, 43, 44, 48, 53, 54, 76, 77, 94, 98, 99, 100]) expect(f(n)).toBe('');
    });

    it('flags each missing mandatory field instead of defaulting it', () => {
        const r = build({ client: { ...makeInput().client, dobYmd: null, gender: null, firstName: '' } });
        expect(r.isValid).toBe(false);
        const names = r.issues.filter((i) => i.severity === 'error').map((i) => i.field);
        expect(names).toEqual(expect.arrayContaining(['Member Birth Date', 'Member Gender Type', 'Member Name 1']));
    });

    it('rejects unmappable state, bad PIN prefix, unmappable frequency, missing group', () => {
        expect(build({ client: { ...makeInput().client, state: 'Atlantis' } }).isValid).toBe(false);
        expect(build({ client: { ...makeInput().client, pincode: '601001' } }).isValid).toBe(false);
        expect(build({ frequency: 'WHENEVER' }).issues.some((i) => i.fieldNo === 85)).toBe(true);
        expect(build({ groupIdentifier: null }).issues.some((i) => i.fieldNo === 72)).toBe(true);
    });

    it('requires an ID or phone; invalid optional IDs are blanked with a warning, not exported', () => {
        const bad = build({ client: { ...makeInput().client, aadhaar: '123456789012', mobileNumber: null } });
        expect(bad.fields[28]).toBe('');
        expect(bad.isValid).toBe(false); // no valid ID and no phone
        const warnOnly = build({ client: { ...makeInput().client, aadhaar: '123456789012' } });
        expect(warnOnly.fields[28]).toBe('');
        expect(warnOnly.isValid).toBe(true);
        expect(warnOnly.issues.some((i) => i.severity === 'warning' && i.field === 'UID')).toBe(true);
    });

    it('enforces overdue/DPD consistency rules', () => {
        const sub1 = makeInput({
            schedules: [{ dueYmd: '2026-04-29', principalDue: 0.5, interestDue: 0, status: 'PENDING', principalPaid: 0, interestPaid: 0 }],
        });
        const r = buildUcrfRecord(sub1, TEST_CONFIG, REPORT_YMD);
        expect(r.isValid).toBe(false); // DPD 1 but overdue truncates to 0
    });

    it('requires family income for post-Apr-2022 disbursals', () => {
        expect(build({ client: { ...makeInput().client, monthlyFamilyIncome: null } }).issues.some((i) => i.fieldNo === 49)).toBe(true);
    });

    it('rejects pipes/digits in names and non-ASCII text', () => {
        expect(build({ client: { ...makeInput().client, firstName: 'Asha 2' } }).isValid).toBe(false);
        expect(build({ client: { ...makeInput().client, firstName: 'आशा' } }).isValid).toBe(false);
        const piped = build({ client: { ...makeInput().client, permanentAddress: '12 Main | Street' } });
        expect(piped.fields[56]).toBe('12 Main Street'); // delimiter can never reach the file
    });

    it('flags duplicate account references', () => {
        const a = build();
        const b = buildUcrfRecord(makeInput({ loanId: 'loan_2' }), TEST_CONFIG, REPORT_YMD);
        flagDuplicateAccounts([a, b]);
        expect(a.isValid).toBe(true);
        expect(b.isValid).toBe(false);
    });

    it('validates file-level inputs', () => {
        expect(validateFileLevel(null, REPORT_YMD, REPORT_YMD)).toHaveLength(1);
        expect(validateFileLevel(TEST_CONFIG, REPORT_YMD, REPORT_YMD)).toEqual([]);
        expect(validateFileLevel(TEST_CONFIG, '2026-05-01', REPORT_YMD)[0]).toMatch(/future/);
        expect(validateFileLevel({ ...TEST_CONFIG, memberId: 'TOO-LONG-ID!!' }, REPORT_YMD, REPORT_YMD).length).toBeGreaterThan(0);
    });
});

describe('CDF structure', () => {
    const valid = build();
    const invalid = build({ client: { ...makeInput().client, gender: null }, loanId: 'x', loanNumber: '000999' });

    it('header is 190 fixed chars with exact field offsets', () => {
        const h = buildCdfHeader(TEST_CONFIG, REPORT_YMD, '2026-05-02');
        expect(h).toHaveLength(190);
        expect(h.slice(0, 11)).toBe('HDRHMMFI3.3');
        expect(h.slice(11, 21)).toBe('NBF0000001');
        expect(h.slice(21, 51)).toBe('TEST FINANCE PVT LTD'.padEnd(30));
        expect(h.slice(51, 81)).toBe(' '.repeat(30));
        expect(h.slice(81, 89)).toBe('30042026');
        expect(h.slice(89, 97)).toBe('02052026');
        expect(h.slice(97, 100)).toBe('JLG');
        expect(h.slice(100, 160)).toBe(' '.repeat(60));
        expect(h.slice(160, 170)).toBe('ME'.padEnd(10));
        expect(h.slice(170)).toBe(' '.repeat(20));
    });

    it('trailer is 36 fixed chars', () => {
        const t = buildCdfTrailer(TEST_CONFIG);
        expect(t).toHaveLength(36);
        expect(t.slice(0, 16)).toBe('TRL3.3NBF0000001');
        expect(t.slice(16)).toBe(' '.repeat(20));
    });

    it('writes header, one line per valid member (100 fields + trailing pipe), trailer, LF endings; invalid excluded', () => {
        const out = buildCdf([valid, invalid], TEST_CONFIG, REPORT_YMD, '2026-05-02');
        expect(out.endsWith('\n')).toBe(true);
        expect(out).not.toContain('\r');
        const lines = out.split('\n');
        expect(lines.pop()).toBe('');
        expect(lines).toHaveLength(3);
        expect(lines[0].startsWith('HDR')).toBe(true);
        expect(lines[2].startsWith('TRL')).toBe(true);
        const parts = lines[1].split('|');
        expect(parts).toHaveLength(101); // 100 fields + empty after trailing pipe
        expect(parts[100]).toBe('');
        expect([parts[0], parts[55], parts[63]]).toEqual(['CNSCRD', 'ADRCRD', 'ACTCRD']);
        expect(out).not.toContain('000999');
    });

    it('preserves separators for blank fields and keeps identifiers verbatim', () => {
        const line = valid.fields.join('|') + '|';
        expect(line).toContain('|00045|');
        expect(line).toContain('|000123|000123|');
        expect(line.match(/\|/g)).toHaveLength(100);
    });

    it('empty report still yields a well-formed header + trailer file', () => {
        const out = buildCdf([], TEST_CONFIG, REPORT_YMD, REPORT_YMD);
        expect(out.split('\n').filter(Boolean)).toHaveLength(2);
    });
});

describe('CSV / JSON / XLSX mirror the CDF', () => {
    const good = build();
    const rows = [good]; // tabular exports carry the same (valid) records as the CDF
    const cdfParts = buildCdf(rows, TEST_CONFIG, REPORT_YMD, REPORT_YMD).split('\n')[1].split('|');
    const idx = (no: number) => REPORT_COLUMNS.findIndex((c) => c.header.startsWith(`${no}. `));

    it('has the 100 official UCRF fields in CDF order', () => {
        expect(REPORT_COLUMNS).toHaveLength(100);
        REPORT_COLUMNS.forEach((c, i) => expect(c.header.startsWith(`${i + 1}. `)).toBe(true));
        expect(REPORT_COLUMNS[0].header).toBe('1. CNSCRD - Segment Identifier');
        expect(REPORT_COLUMNS[99].header).toBe('100. ACTCRD - Dummy (Reserved for Future Use)');
    });

    it('CSV: header + one row per record; every CSV value equals the CDF value', () => {
        const lines = Array.from(csvLines(rows)).join('').split('\r\n').filter(Boolean);
        expect(lines).toHaveLength(2);
        expect(lines[0].split('","')).toHaveLength(100);
        expect(lines[1]).toContain('"00045"'); // identifier kept as quoted text
        expect(lines[1]).toContain(',4000,'); // amounts bare numbers
        // field-by-field: text cells equal CDF text, numeric cells equal CDF numbers
        for (let i = 0; i < 100; i++) {
            const v = REPORT_COLUMNS[i].value(good);
            const cdf = cdfParts[i];
            if (cdf === '') expect(v).toBeNull();
            else expect(typeof v === 'number' ? v : v).toEqual(typeof v === 'number' ? Number(cdf) : cdf);
        }
    });

    it('CSV escapes quotes and commas in text', () => {
        const r = build({ client: { ...makeInput().client, permanentAddress: '12 "Main", Street' } });
        const line = Array.from(csvLines([r])).join('').split('\r\n')[1];
        expect(line).toContain('"12 ""Main"", Street"');
    });

    it('validation-error report lists the invalid records', () => {
        const bad = build({ client: { ...makeInput().client, gender: null }, loanId: 'l2', loanNumber: '000777' });
        const errors = Array.from(errorCsvLines([good, bad])).join('');
        expect(errors).toContain('Member Gender Type');
    });

    it('JSON: valid document; numbers stay numbers, ids/codes/dates stay strings, blanks are null', () => {
        const meta = {
            reportDate: REPORT_YMD,
            generatedAt: '2026-05-02T00:00:00.000Z',
            filters: { reportDate: REPORT_YMD, loanStatus: 'ALL' as const, validity: 'ALL' as const },
            totals: { eligible: 2, valid: 1, invalid: 1 },
            institution: { memberId: 'NBF0000001', name: 'TEST FINANCE PVT LTD' },
        };
        const doc = JSON.parse(Array.from(jsonChunks(rows, meta)).join(''));
        expect(doc.metadata.totals).toEqual({ eligible: 2, valid: 1, invalid: 1 });
        expect(Object.keys(doc.records[0])).toHaveLength(100);
        const r0 = doc.records[0];
        const key = (no: number) => REPORT_COLUMNS[idx(no)].key;
        expect(r0[key(2)]).toBe('00045');
        expect(r0[key(65)]).toBe('000123');
        expect(r0[key(10)]).toBe('17051990'); // DDMMYYYY text, same as CDF
        expect(r0[key(83)]).toBe(4000);
        expect(typeof r0[key(89)]).toBe('number');
        expect(r0[key(8)]).toBeNull();
        expect(JSON.parse(Array.from(jsonChunks([], meta)).join('')).records).toEqual([]);
    });

    it('XLSX: genuine workbook; amount/DPD/count cells numeric, ids and dates text', () => {
        const buf = buildXlsx(rows, [good, build({ client: { ...makeInput().client, gender: null }, loanId: 'l2', loanNumber: '000777' })]);
        expect(buf.subarray(0, 2).toString()).toBe('PK');
        const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
        expect(wb.SheetNames).toEqual(['UCRF Report', 'Validation Errors']);
        const ws = wb.Sheets['UCRF Report'];
        const cell = (no: number, row = 1) => ws[XLSX.utils.encode_cell({ r: row, c: idx(no) })];
        for (const no of [49, 83, 84, 86, 87, 88, 89]) {
            expect(cell(no).t, `field ${no}`).toBe('n');
            expect(typeof cell(no).v).toBe('number');
        }
        expect(cell(83).v).toBe(4000);
        expect(cell(89).v).toBe(105);
        expect(cell(83).z).toBe('#,##0');
        for (const no of [2, 65, 66, 10, 78, 59, 39]) expect(cell(no).t, `field ${no}`).toBe('s');
        expect(cell(2).v).toBe('00045');
        expect(cell(65).v).toBe('000123');
        expect(cell(10).v).toBe('17051990');
        expect(XLSX.utils.sheet_to_json(ws, { header: 1 })).toHaveLength(2); // header + 1 valid record
        const err = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Validation Errors'], { header: 1 });
        expect(JSON.stringify(err)).toContain('Member Gender Type');
    });
});

describe('large report handling', () => {
    it('builds and serialises 5,000 records quickly', () => {
        const recs = Array.from({ length: 5000 }, (_, i) =>
            buildUcrfRecord(makeInput({ loanId: `l${i}`, loanNumber: String(100000 + i).padStart(8, '0') }), TEST_CONFIG, REPORT_YMD)
        );
        const t = Date.now();
        const out = buildCdf(recs, TEST_CONFIG, REPORT_YMD, REPORT_YMD);
        expect(out.split('\n').filter(Boolean)).toHaveLength(5002);
        expect(Date.now() - t).toBeLessThan(5000);
    });
});
