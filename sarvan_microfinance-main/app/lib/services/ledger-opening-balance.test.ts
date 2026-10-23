import { describe, expect, it } from 'vitest';
import {
    signedOpeningAmount,
    buildBranchOpeningContexts,
    bridgedSelfAccountOpeningAmount,
    selfAccountOpeningAmount,
    type LedgerOpeningBalanceRow,
    type SelfAccountOpeningBalanceRow,
} from '@/app/lib/services/ledger-opening-balance';

const day = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

const row = (overrides: Partial<LedgerOpeningBalanceRow>): LedgerOpeningBalanceRow => ({
    branchId: 'branch-a',
    ledgerId: 'ledger-1',
    balanceType: 'CREDIT',
    amount: 100,
    openingDate: day('2026-07-01'),
    ...overrides,
});

describe('signedOpeningAmount', () => {
    it('DEBIT is positive', () => {
        expect(signedOpeningAmount('DEBIT', 500)).toBe(500);
    });

    it('CREDIT is negative', () => {
        expect(signedOpeningAmount('CREDIT', 500)).toBe(-500);
    });

    it('zero is zero regardless of type', () => {
        // -0 vs +0: numerically identical (-0 === 0), only Object.is (toBe) tells them
        // apart — irrelevant for money, so compare via Math.abs to avoid a false failure.
        expect(Math.abs(signedOpeningAmount('DEBIT', 0))).toBe(0);
        expect(Math.abs(signedOpeningAmount('CREDIT', 0))).toBe(0);
    });
});

describe('buildBranchOpeningContexts', () => {
    it('computes each branch independently — no cross-branch double counting', () => {
        // The exact scenario that made the original cross-branch getOpeningBalanceMap
        // wrong: two branches configured on the same ledger with different dates. Each
        // branch's own amount and date must stay isolated, never summed together.
        const rows: LedgerOpeningBalanceRow[] = [
            row({ branchId: 'branch-a', ledgerId: 'ledger-1', balanceType: 'DEBIT', amount: 1000, openingDate: day('2026-07-01') }),
            row({ branchId: 'branch-b', ledgerId: 'ledger-1', balanceType: 'DEBIT', amount: 500, openingDate: day('2026-04-01') }),
        ];

        const result = buildBranchOpeningContexts(rows);

        expect(result.size).toBe(2);
        expect(result.get('branch-a')?.ledgerAmounts.get('ledger-1')).toBe(1000);
        expect(result.get('branch-a')?.openingDate).toEqual(day('2026-07-01'));
        expect(result.get('branch-b')?.ledgerAmounts.get('ledger-1')).toBe(500);
        expect(result.get('branch-b')?.openingDate).toEqual(day('2026-04-01'));
    });

    it('keeps an explicit zero-amount row as configured, not indistinguishable from unset', () => {
        const rows: LedgerOpeningBalanceRow[] = [
            row({ branchId: 'branch-a', ledgerId: 'ledger-1', balanceType: 'CREDIT', amount: 0 }),
        ];

        const result = buildBranchOpeningContexts(rows);

        const context = result.get('branch-a');
        expect(context).toBeDefined();
        expect(context?.ledgerAmounts.has('ledger-1')).toBe(true);
        expect(Math.abs(context?.ledgerAmounts.get('ledger-1') ?? NaN)).toBe(0);
    });

    it('a branch with no rows at all is absent from the result (unconfigured)', () => {
        const rows: LedgerOpeningBalanceRow[] = [row({ branchId: 'branch-a' })];

        const result = buildBranchOpeningContexts(rows);

        expect(result.has('branch-a')).toBe(true);
        expect(result.has('branch-b')).toBe(false);
    });

    it('a branch stays configured even when its opening date is in the future relative to "today" — "configured" is a pure branch-level fact, not conditioned on any external/report date', () => {
        // Regression test: an earlier version gated this on the caller's own report
        // window/asOfDate, which meant a report run with a from-date before the branch's
        // opening date treated the branch as unconfigured and fell back to showing every
        // transaction since inception — i.e. old data leaking back into the report.
        const rows: LedgerOpeningBalanceRow[] = [
            row({ branchId: 'branch-a', openingDate: day('2026-09-01') }),
        ];

        const result = buildBranchOpeningContexts(rows);

        expect(result.has('branch-a')).toBe(true);
        expect(result.get('branch-a')?.openingDate).toEqual(day('2026-09-01'));
    });

    it('a ledger with no row of its own in a configured branch is absent from ledgerAmounts (caller defaults it to 0, not naive)', () => {
        const rows: LedgerOpeningBalanceRow[] = [
            row({ branchId: 'branch-a', ledgerId: 'ledger-1', amount: 250, balanceType: 'DEBIT' }),
        ];

        const result = buildBranchOpeningContexts(rows);

        const context = result.get('branch-a');
        expect(context?.ledgerAmounts.has('ledger-1')).toBe(true);
        expect(context?.ledgerAmounts.has('ledger-2')).toBe(false);
    });

    it('sums multiple ledgers within the same branch independently', () => {
        const rows: LedgerOpeningBalanceRow[] = [
            row({ branchId: 'branch-a', ledgerId: 'ledger-1', balanceType: 'DEBIT', amount: 300 }),
            row({ branchId: 'branch-a', ledgerId: 'ledger-2', balanceType: 'CREDIT', amount: 150 }),
        ];

        const result = buildBranchOpeningContexts(rows);

        const context = result.get('branch-a');
        expect(context?.ledgerAmounts.get('ledger-1')).toBe(300);
        expect(context?.ledgerAmounts.get('ledger-2')).toBe(-150);
    });
});

describe('bridgedSelfAccountOpeningAmount', () => {
    const context = { openingDate: day('2026-07-01'), ledgerAmounts: new Map([['cash-ledger', 750]]), selfAccountAmounts: new Map<string, number>() };

    it('returns null when the branch is entirely unconfigured', () => {
        expect(bridgedSelfAccountOpeningAmount(undefined, 'cash-ledger')).toBeNull();
    });

    it('returns null when there is no bridge ledger at all (e.g. Bank never created)', () => {
        expect(bridgedSelfAccountOpeningAmount(context, null)).toBeNull();
    });

    it('returns the configured amount when the branch and bridge ledger both have data', () => {
        expect(bridgedSelfAccountOpeningAmount(context, 'cash-ledger')).toBe(750);
    });

    it('defaults to 0 when the branch is configured but this bridge ledger was never given its own row', () => {
        expect(bridgedSelfAccountOpeningAmount(context, 'bank-ledger')).toBe(0);
    });
});

const selfRow = (overrides: Partial<SelfAccountOpeningBalanceRow>): SelfAccountOpeningBalanceRow => ({
    branchId: 'branch-a',
    selfAccountId: 'self-cash',
    balanceType: 'DEBIT',
    amount: 100,
    openingDate: day('2026-07-01'),
    ...overrides,
});

describe('buildBranchOpeningContexts — self-account rows', () => {
    it('merges self-account opening rows into the same branch context', () => {
        const ctx = buildBranchOpeningContexts(
            [row({ branchId: 'branch-a', ledgerId: 'ledger-1', balanceType: 'CREDIT', amount: 200 })],
            [selfRow({ branchId: 'branch-a', selfAccountId: 'self-cash', balanceType: 'DEBIT', amount: 5000 })],
        ).get('branch-a');
        expect(ctx?.ledgerAmounts.get('ledger-1')).toBe(-200);
        expect(ctx?.selfAccountAmounts.get('self-cash')).toBe(5000);
    });

    it('a branch with ONLY self-account rows still produces a context (date from the self row)', () => {
        const ctx = buildBranchOpeningContexts(
            [],
            [selfRow({ branchId: 'branch-b', selfAccountId: 'self-bank', balanceType: 'DEBIT', amount: 750, openingDate: day('2026-04-01') })],
        ).get('branch-b');
        expect(ctx?.openingDate).toEqual(day('2026-04-01'));
        expect(ctx?.selfAccountAmounts.get('self-bank')).toBe(750);
    });
});

describe('selfAccountOpeningAmount', () => {
    const ctx = buildBranchOpeningContexts(
        [row({ branchId: 'branch-a', ledgerId: 'bridge-cash', balanceType: 'DEBIT', amount: 999 })],
        [selfRow({ branchId: 'branch-a', selfAccountId: 'self-cash', balanceType: 'DEBIT', amount: 5000 })],
    ).get('branch-a');

    it('returns null when the branch is entirely unconfigured', () => {
        expect(selfAccountOpeningAmount(undefined, 'self-cash', 'bridge-cash')).toBeNull();
    });

    it('prefers the direct SelfAccountOpeningBalance row over the legacy bridge ledger', () => {
        expect(selfAccountOpeningAmount(ctx, 'self-cash', 'bridge-cash')).toBe(5000);
    });

    it('falls back to the bridge ledger amount when there is no direct self row', () => {
        expect(selfAccountOpeningAmount(ctx, 'self-other', 'bridge-cash')).toBe(999);
    });

    it('configured-but-unset self account with no bridge ledger = 0', () => {
        expect(selfAccountOpeningAmount(ctx, 'self-other', null)).toBe(0);
    });
});
