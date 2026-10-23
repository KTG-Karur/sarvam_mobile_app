import { describe, expect, it } from 'vitest';
import {
    extractUploanMemberId,
    nameTokenKey,
    parseFlexibleDate,
    parseUploanMemberId,
    resolveOptionalDate,
    stripLegacyCodePrefix,
} from '@/app/lib/services/uploan-import.service';

describe('extractUploanMemberId', () => {
    it('reads an exact "MemberID" column', () => {
        expect(extractUploanMemberId({ MemberID: 'SHG12345' })).toBe('SHG12345');
    });

    it('tolerates spacing/casing/punctuation variants', () => {
        expect(extractUploanMemberId({ 'Member ID': 'A1' })).toBe('A1');
        expect(extractUploanMemberId({ memberid: 'A2' })).toBe('A2');
        expect(extractUploanMemberId({ Member_Id: 'A3' })).toBe('A3');
        expect(extractUploanMemberId({ 'MEMBER-ID': 'A4' })).toBe('A4');
    });

    it('falls back to Client ID / member code / client code variants', () => {
        expect(extractUploanMemberId({ 'Client ID': 'C1' })).toBe('C1');
        expect(extractUploanMemberId({ ClientCode: 'C2' })).toBe('C2');
        expect(extractUploanMemberId({ 'Member Code': 'C3' })).toBe('C3');
        expect(extractUploanMemberId({ 'Member No': 'C4' })).toBe('C4');
        expect(extractUploanMemberId({ ClientNo: 'C5' })).toBe('C5');
    });

    it('trims whitespace around the value', () => {
        expect(extractUploanMemberId({ MemberID: '  SHG999  ' })).toBe('SHG999');
    });

    it('returns empty string when no matching column exists', () => {
        expect(extractUploanMemberId({ Name: 'Someone', Phone: '9000000000' })).toBe('');
    });

    it('returns empty string for null/undefined/empty raw', () => {
        expect(extractUploanMemberId(undefined)).toBe('');
        expect(extractUploanMemberId(null)).toBe('');
        expect(extractUploanMemberId({})).toBe('');
    });

    it('skips a matching column whose value is blank and keeps looking', () => {
        expect(extractUploanMemberId({ MemberID: '   ', 'Client ID': 'REAL1' })).toBe('REAL1');
    });

    it('ignores unrelated columns that merely contain "id" as a substring', () => {
        expect(extractUploanMemberId({ 'ID Proof No.': 'SFX123', Name: 'X' })).toBe('');
    });
});

describe('parseUploanMemberId', () => {
    it('splits a valid 4-segment MemberID into branch/center/group/member', () => {
        expect(parseUploanMemberId('33-1-1-1')).toEqual({
            branchCode: '33',
            centerCode: '1',
            groupCode: '1',
            groupNumber: 1,
            memberSeq: '1',
        });
    });

    it('handles multi-digit segments', () => {
        expect(parseUploanMemberId('33-12-4-108')).toEqual({
            branchCode: '33',
            centerCode: '12',
            groupCode: '4',
            groupNumber: 4,
            memberSeq: '108',
        });
    });

    it('trims surrounding whitespace', () => {
        expect(parseUploanMemberId('  33-1-1-1  ')).toEqual({
            branchCode: '33',
            centerCode: '1',
            groupCode: '1',
            groupNumber: 1,
            memberSeq: '1',
        });
    });

    it('returns null when the segment count is not exactly 4', () => {
        expect(parseUploanMemberId('1-1-1')).toBeNull();
        expect(parseUploanMemberId('33-1-1-1-1')).toBeNull();
        expect(parseUploanMemberId('SHG12345')).toBeNull();
    });

    it('returns null when the group segment is not purely numeric', () => {
        expect(parseUploanMemberId('33-1-A-1')).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(parseUploanMemberId('')).toBeNull();
    });
});

describe('stripLegacyCodePrefix', () => {
    it('strips a leading "<code>-" prefix that matches the parsed center code', () => {
        expect(stripLegacyCodePrefix('154-ARANMANAIPUDHUR', '154')).toBe('ARANMANAIPUDHUR');
    });

    it('trims whitespace around the whole value and after the separator', () => {
        expect(stripLegacyCodePrefix('  154-ARANMANAIPUDHUR  ', '154')).toBe('ARANMANAIPUDHUR');
        expect(stripLegacyCodePrefix('154-  ARANMANAIPUDHUR', '154')).toBe('ARANMANAIPUDHUR');
    });

    it('leaves the text unchanged when the leading number does not match the code', () => {
        expect(stripLegacyCodePrefix('99-ARANMANAIPUDHUR', '154')).toBe('99-ARANMANAIPUDHUR');
    });

    it('leaves the text unchanged when there is no leading numeric prefix at all', () => {
        expect(stripLegacyCodePrefix('MAIN BRANCH CENTER', '154')).toBe('MAIN BRANCH CENTER');
    });

    it('leaves the text unchanged when stripping would leave nothing behind', () => {
        expect(stripLegacyCodePrefix('154-', '154')).toBe('154-');
    });
});

describe('nameTokenKey', () => {
    it('matches identical names regardless of case', () => {
        expect(nameTokenKey('G Sankar Kumar')).toBe(nameTokenKey('g sankar kumar'));
    });

    it('matches names split into firstName/lastName in a different word order than the report', () => {
        // Legacy report: "G Sankar Kumar" as one string.
        // System User: firstName "Sankar Kumar", lastName "G" — same person, different split/order.
        expect(nameTokenKey('G Sankar Kumar')).toBe(nameTokenKey('Sankar Kumar G'));
    });

    it('strips periods from initials so "G." and "G" collapse to the same key', () => {
        expect(nameTokenKey('G. Sankar Kumar')).toBe(nameTokenKey('G Sankar Kumar'));
    });

    it('treats a period with no following space as a token separator, not a deletion', () => {
        // Legacy report: "P.Sivapandi" (initial + surname, no space after the period).
        // System User: firstName "P", lastName "Sivapandi" -> "P Sivapandi".
        // Deleting the period outright would merge this into one token
        // ("psivapandi") and never match "p sivapandi".
        expect(nameTokenKey('P.Sivapandi')).toBe(nameTokenKey('P Sivapandi'));
    });

    it('collapses repeated internal whitespace', () => {
        expect(nameTokenKey('G   Sankar  Kumar')).toBe(nameTokenKey('G Sankar Kumar'));
    });

    it('does not match a genuinely different name', () => {
        expect(nameTokenKey('G Sankar Kumar')).not.toBe(nameTokenKey('Rajasekaran M'));
    });

    it('does not match a subset of the same name (fewer tokens is a different key)', () => {
        expect(nameTokenKey('Sankar Kumar')).not.toBe(nameTokenKey('G Sankar Kumar'));
    });
});

describe('parseFlexibleDate', () => {
    it('parses ISO YYYY-MM-DD', () => {
        expect(parseFlexibleDate('1973-11-24')?.toISOString().slice(0, 10)).toBe('1973-11-24');
    });

    it('parses legacy DD-MM-YYYY', () => {
        expect(parseFlexibleDate('24-11-1973')?.toISOString().slice(0, 10)).toBe('1973-11-24');
    });

    it('returns null for blank or "-"', () => {
        expect(parseFlexibleDate('')).toBeNull();
        expect(parseFlexibleDate('-')).toBeNull();
        expect(parseFlexibleDate(undefined)).toBeNull();
    });

    it('returns null for unparseable garbage instead of an Invalid Date', () => {
        // This exact shape (free-text junk in a DOB-type column) is what made
        // `new Date(str)` produce an Invalid Date that Prisma rejected at import time.
        expect(parseFlexibleDate('NotADate123')).toBeNull();
    });
});

describe('resolveOptionalDate', () => {
    it('resolves a valid date to YYYY-MM-DD and adds no error', () => {
        const errors: string[] = [];
        expect(resolveOptionalDate('22-04-1992', 'Spouse DOB', errors)).toBe('1992-04-22');
        expect(errors).toHaveLength(0);
    });

    it('treats blank / "-" as "not provided" — no error, empty result', () => {
        const errors: string[] = [];
        expect(resolveOptionalDate('', 'Spouse DOB', errors)).toBe('');
        expect(resolveOptionalDate('-', 'Spouse DOB', errors)).toBe('');
        expect(resolveOptionalDate(undefined, 'Spouse DOB', errors)).toBe('');
        expect(errors).toHaveLength(0);
    });

    it('pushes a labeled error for an unparseable value instead of silently passing it through', () => {
        const errors: string[] = [];
        const result = resolveOptionalDate('NotADate123', 'Spouse DOB', errors);
        expect(result).toBe('');
        expect(errors).toEqual(['Spouse DOB could not be parsed — use a valid date or leave blank']);
    });
});
