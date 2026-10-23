import { describe, expect, it } from 'vitest';
import {
    normalizeMobile,
    normalizeAadhaar,
    normalizePAN,
    normalizeVoterId,
    normalizeBankAccount,
    normalizeIdentityValue,
    valuesMatchAfterNormalization,
} from '@/app/lib/services/identity-uniqueness.service';

describe('normalizeMobile', () => {
    it('strips country code prefixes down to 10 digits', () => {
        expect(normalizeMobile('9876543210')).toBe('9876543210');
        expect(normalizeMobile('+919876543210')).toBe('9876543210');
        expect(normalizeMobile('919876543210')).toBe('9876543210');
        expect(normalizeMobile('09876543210')).toBe('9876543210');
    });
    it('strips non-digit formatting', () => {
        expect(normalizeMobile('+91 98765 43210')).toBe('9876543210');
    });
    it('returns empty for blank/null', () => {
        expect(normalizeMobile('')).toBe('');
        expect(normalizeMobile(null)).toBe('');
        expect(normalizeMobile(undefined)).toBe('');
    });
});

describe('normalizeAadhaar', () => {
    it('strips whitespace', () => {
        expect(normalizeAadhaar('1234 5678 9012')).toBe('123456789012');
        expect(normalizeAadhaar('123456789012')).toBe('123456789012');
    });
    it('returns empty for blank/null', () => {
        expect(normalizeAadhaar('  ')).toBe('');
        expect(normalizeAadhaar(null)).toBe('');
    });
});

describe('normalizePAN', () => {
    it('trims and uppercases', () => {
        expect(normalizePAN(' abcde1234f ')).toBe('ABCDE1234F');
    });
});

describe('normalizeVoterId', () => {
    it('uppercases and strips whitespace while preserving slashes', () => {
        expect(normalizeVoterId('tn/01/123456')).toBe('TN/01/123456');
        expect(normalizeVoterId(' abc1234567 ')).toBe('ABC1234567');
    });
});

describe('normalizeBankAccount', () => {
    it('strips non-digits', () => {
        expect(normalizeBankAccount('1234-5678-9012')).toBe('123456789012');
    });
});

describe('normalizeIdentityValue', () => {
    it('dispatches to the correct normalizer per field', () => {
        expect(normalizeIdentityValue('MOBILE', '+919876543210')).toBe('9876543210');
        expect(normalizeIdentityValue('AADHAAR', '1234 5678 9012')).toBe('123456789012');
        expect(normalizeIdentityValue('PAN', 'abcde1234f')).toBe('ABCDE1234F');
        expect(normalizeIdentityValue('VOTER_ID', 'tn/01/123456')).toBe('TN/01/123456');
        expect(normalizeIdentityValue('BANK_ACCOUNT', '1234-5678-9012')).toBe('123456789012');
    });
});

describe('valuesMatchAfterNormalization', () => {
    it('matches equal values in different raw formats', () => {
        expect(valuesMatchAfterNormalization('MOBILE', '9876543210', '+91 98765 43210')).toBe(true);
        expect(valuesMatchAfterNormalization('AADHAAR', '1234 5678 9012', '123456789012')).toBe(true);
        expect(valuesMatchAfterNormalization('PAN', 'abcde1234f', 'ABCDE1234F')).toBe(true);
    });
    it('does not match different values', () => {
        expect(valuesMatchAfterNormalization('MOBILE', '9876543210', '9876543211')).toBe(false);
    });
    it('never matches when either side is empty', () => {
        expect(valuesMatchAfterNormalization('MOBILE', '', '9876543210')).toBe(false);
        expect(valuesMatchAfterNormalization('MOBILE', '9876543210', '')).toBe(false);
        expect(valuesMatchAfterNormalization('MOBILE', '', '')).toBe(false);
        expect(valuesMatchAfterNormalization('AADHAAR', undefined, undefined)).toBe(false);
    });
});
