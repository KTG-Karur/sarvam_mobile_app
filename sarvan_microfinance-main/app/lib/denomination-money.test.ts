import { describe, expect, it } from 'vitest';
import {
    amountsMatchForDenomination,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
    floorToWholeRupeesForDenomination,
    normalizeDenominationCounts,
    roundAmountToPaise,
} from '@/app/lib/denomination-money';

describe('roundAmountToPaise', () => {
    it('rounds halves to nearest paise', () => {
        expect(roundAmountToPaise(0.005)).toBe(1);
        expect(roundAmountToPaise(100.125)).toBe(10013);
    });
});

describe('amountsMatchForDenomination', () => {
    it('treats exact integers as equal', () => {
        expect(amountsMatchForDenomination(1500, 1500)).toBe(true);
    });

    it('ignores float noise under one paisa when rounded', () => {
        expect(amountsMatchForDenomination(100.1, 100.1 + 1e-10)).toBe(true);
    });

    it('rejects mismatch over one paisa', () => {
        expect(amountsMatchForDenomination(100, 100.02)).toBe(false);
    });

    it('handles non-finite as zero', () => {
        expect(amountsMatchForDenomination(Number.NaN, 0)).toBe(true);
    });
});

describe('floorToWholeRupeesForDenomination', () => {
    it('floors paise toward zero for positive amounts', () => {
        expect(floorToWholeRupeesForDenomination(20952.01)).toBe(20952);
        expect(floorToWholeRupeesForDenomination(20952.99)).toBe(20952);
        expect(floorToWholeRupeesForDenomination(20952)).toBe(20952);
    });

    it('treats non-finite as zero', () => {
        expect(floorToWholeRupeesForDenomination(Number.NaN)).toBe(0);
    });
});

describe('denominationMatchesFlooredCollection', () => {
    it('matches when notes total equals floored collection', () => {
        expect(denominationMatchesFlooredCollection(20952, 20952.01)).toBe(true);
        expect(denominationMatchesFlooredCollection(20952, 20952.99)).toBe(true);
    });

    it('rejects when notes total differs from floored collection', () => {
        expect(denominationMatchesFlooredCollection(20953, 20952.99)).toBe(false);
    });
});

describe('calculateDenominationTotal', () => {
    it('sums note counts', () => {
        const c = normalizeDenominationCounts({ d500: 2, d100: 1 });
        expect(calculateDenominationTotal(c)).toBe(1100);
    });
});

describe('normalizeDenominationCounts', () => {
    it('clamps negatives to zero', () => {
        const c = normalizeDenominationCounts({ d10: -5 });
        expect(c.d10).toBe(0);
    });
});
