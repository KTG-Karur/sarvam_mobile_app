import { describe, expect, it } from 'vitest';
import {
    deriveLoanIndexFrequency,
    LOAN_INDEX_FREQUENCY_ALL,
    LOAN_INDEX_FREQUENCY_MIXED,
    normalizeFrequencyKey,
    resolveLoanFrequencyForDisplay,
} from '@/app/lib/loan-frequency';

describe('normalizeFrequencyKey', () => {
    it('trims and lowercases', () => {
        expect(normalizeFrequencyKey('  WEEKLY  ')).toBe('weekly');
    });
    it('returns empty for null/blank', () => {
        expect(normalizeFrequencyKey(null)).toBe('');
        expect(normalizeFrequencyKey('')).toBe('');
    });
});

describe('deriveLoanIndexFrequency', () => {
    it('uses explicit body frequency when provided', () => {
        expect(
            deriveLoanIndexFrequency({
                loanFrequencies: ['weekly', 'monthly'],
                explicitBodyFrequency: 'custom',
            })
        ).toBe('custom');
    });
    it('returns ALL when no frequencies', () => {
        expect(deriveLoanIndexFrequency({ loanFrequencies: [] })).toBe(LOAN_INDEX_FREQUENCY_ALL);
        expect(deriveLoanIndexFrequency({ loanFrequencies: [null, ''] })).toBe(
            LOAN_INDEX_FREQUENCY_ALL
        );
    });
    it('returns single frequency as stored', () => {
        expect(deriveLoanIndexFrequency({ loanFrequencies: ['monthly', 'monthly'] })).toBe(
            'monthly'
        );
    });
    it('treats case variants as same', () => {
        expect(deriveLoanIndexFrequency({ loanFrequencies: ['MONTHLY', 'monthly'] })).toBe(
            'MONTHLY'
        );
    });
    it('returns MIXED for distinct frequencies', () => {
        expect(deriveLoanIndexFrequency({ loanFrequencies: ['weekly', 'monthly'] })).toBe(
            LOAN_INDEX_FREQUENCY_MIXED
        );
    });
});

describe('resolveLoanFrequencyForDisplay', () => {
    it('prefers loan frequency', () => {
        expect(resolveLoanFrequencyForDisplay('weekly', 'monthly')).toBe('weekly');
    });
    it('falls back to product', () => {
        expect(resolveLoanFrequencyForDisplay(null, 'MONTHLY')).toBe('MONTHLY');
    });
    it('uses fallback', () => {
        expect(resolveLoanFrequencyForDisplay(undefined, undefined)).toBe('MONTHLY');
    });
});
