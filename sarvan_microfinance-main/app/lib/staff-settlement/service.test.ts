import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, loanService, advanceSettle } = vi.hoisted(() => ({
    db: {
        staffLoan: { findFirst: vi.fn(), findMany: vi.fn() },
        staffAdvance: { findFirst: vi.fn(), findMany: vi.fn() },
    } as any,
    loanService: { recordEarlySettlement: vi.fn(), computeRepayment: vi.fn() },
    advanceSettle: { settleAdvance: vi.fn() },
}));

vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/branch-lock', () => ({ getKolkataCalendarYmd: () => '2026-09-25' }));
vi.mock('@/app/lib/staff-loans/application-service', () => loanService);
vi.mock('@/app/lib/staff-advances/settlement', () => advanceSettle);
vi.mock('@/app/lib/staff-advances/salary', () => ({ getAdvanceSalarySummary: vi.fn() }));
vi.mock('@/app/lib/staff-loans/salary-recovery', () => ({ getSalaryRecoveryDue: vi.fn() }));
vi.mock('@/app/lib/staff-advances/salary-recovery', () => ({ getAdvanceRecoveryDue: vi.fn() }));

import { listSettlementCandidates, settlementCapabilities, submitSettlement } from './service';
import { LEGACY_LOAN_REPAYMENTS_PAGE, STAFF_SETTLEMENT_PAGE, staffSettlementSchema } from './settlement';

const grant = (page: string, view = true, add = false, branchId: string | null = null) => ({
    roleId: 'r1', branchId, pagePermissions: { [page]: { view, add } },
});
const actor = (over: Record<string, unknown> = {}) => ({
    userId: 'mgr1', isAdmin: false, isHR: false, branchIds: null, assignments: [], ...over,
}) as any;

const loanInput = {
    type: 'LOAN' as const, id: 'loan1', paymentMode: 'CASH' as const, reference: null, remarks: null, expectedVersion: 2, expectedAmount: 6600,
};
const advanceInput = { ...loanInput, type: 'ADVANCE' as const, id: 'adv1', expectedAmount: 10000 };

beforeEach(() => {
    vi.clearAllMocks();
    db.staffLoan.findFirst.mockResolvedValue({ employeeId: 'emp1' });
    db.staffAdvance.findFirst.mockResolvedValue({ employeeId: 'emp1' });
    loanService.recordEarlySettlement.mockResolvedValue({ loanNumber: 'SL-000001', transactionId: 'tx1', settlementAmount: 6600, waivedInterest: 330 });
    advanceSettle.settleAdvance.mockResolvedValue({ advanceNumber: 'SA-000001', transactionId: 'tx2', settlementAmount: 10000 });
});

describe('staffSettlementSchema', () => {
    it('offers only Cash and Bank Transfer, and requires a UTR for a bank transfer', () => {
        expect(staffSettlementSchema.safeParse(loanInput).success).toBe(true);
        expect(staffSettlementSchema.safeParse({ ...loanInput, paymentMode: 'UPI' }).success).toBe(false);
        expect(staffSettlementSchema.safeParse({ ...loanInput, paymentMode: 'CHEQUE' }).success).toBe(false);
        expect(staffSettlementSchema.safeParse({ ...loanInput, paymentMode: 'BANK_TRANSFER' }).success).toBe(false);
        expect(staffSettlementSchema.safeParse({ ...advanceInput, paymentMode: 'BANK_TRANSFER', reference: 'UTR1' }).success).toBe(true);
    });

    it('never takes the settlement amount or date from the caller', () => {
        expect(staffSettlementSchema.safeParse({ ...loanInput, amount: 1 }).success).toBe(false);
        expect(staffSettlementSchema.safeParse({ ...loanInput, settlementDate: '2020-01-01' }).success).toBe(false);
        expect(staffSettlementSchema.safeParse({ ...loanInput, expectedAmount: undefined }).success).toBe(false);
    });

    it('rejects an unknown settlement type', () => {
        expect(staffSettlementSchema.safeParse({ ...loanInput, type: 'OTHER' }).success).toBe(false);
    });
});

describe('settlementCapabilities', () => {
    it('gives an admin every capability', () => {
        expect(settlementCapabilities(actor({ isAdmin: true }))).toEqual({ loan: { view: true, settle: true }, advance: { view: true, settle: true } });
    });

    it('gives nothing without a page grant', () => {
        expect(settlementCapabilities(actor())).toEqual({ loan: { view: false, settle: false }, advance: { view: false, settle: false } });
    });

    it('separates view from settle', () => {
        expect(settlementCapabilities(actor({ assignments: [grant(STAFF_SETTLEMENT_PAGE, true, false)] })))
            .toEqual({ loan: { view: true, settle: false }, advance: { view: true, settle: false } });
    });

    it('lets the retired Repayments page grant keep settling Staff Loans only', () => {
        expect(settlementCapabilities(actor({ assignments: [grant(LEGACY_LOAN_REPAYMENTS_PAGE, true, true)] })))
            .toEqual({ loan: { view: true, settle: true }, advance: { view: false, settle: false } });
    });
});

describe('listSettlementCandidates', () => {
    it('is refused without the view grant', async () => {
        await expect(listSettlementCandidates(actor(), 'LOAN')).rejects.toMatchObject({ status: 403 });
    });

    it('lists only ACTIVE loans, inside the branch of the role assignment', async () => {
        db.staffLoan.findMany.mockResolvedValue([]);
        await listSettlementCandidates(actor({ assignments: [grant(STAFF_SETTLEMENT_PAGE, true, false, 'b1')], branchIds: ['b1', 'b2'] }), 'LOAN');
        expect(db.staffLoan.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', branchId: { in: ['b1'] } });
        expect(db.staffAdvance.findMany).not.toHaveBeenCalled();
    });

    it('lists only ACTIVE advances for the advance type', async () => {
        db.staffAdvance.findMany.mockResolvedValue([]);
        await listSettlementCandidates(actor({ isAdmin: true }), 'ADVANCE');
        expect(db.staffAdvance.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
        expect(db.staffLoan.findMany).not.toHaveBeenCalled();
    });

    it('narrows by branch, role and department', async () => {
        db.staffLoan.findMany.mockResolvedValue([]);
        await listSettlementCandidates(actor({ isAdmin: true, branchIds: null }), 'LOAN', { branchId: 'b2', role: 'FDO', departmentId: 'd1' });
        expect(db.staffLoan.findMany.mock.calls[0][0].where).toMatchObject({
            status: 'ACTIVE', branchId: 'b2', employee: { role: 'FDO', departmentId: 'd1' },
        });
    });

    it('applies the role filter to advances too', async () => {
        db.staffAdvance.findMany.mockResolvedValue([]);
        await listSettlementCandidates(actor({ isAdmin: true }), 'ADVANCE', { role: 'BRANCH_MANAGER' });
        expect(db.staffAdvance.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', employee: { role: 'BRANCH_MANAGER' } });
    });

    it('refuses a branch outside the role assignment branch', async () => {
        const limited = actor({ assignments: [grant(STAFF_SETTLEMENT_PAGE, true, false, 'b1')], branchIds: ['b1', 'b2'] });
        await expect(listSettlementCandidates(limited, 'LOAN', { branchId: 'b2' })).rejects.toMatchObject({ status: 403 });
        expect(db.staffLoan.findMany).not.toHaveBeenCalled();
    });
});

describe('submitSettlement', () => {
    const settler = (over: Record<string, unknown> = {}) => actor({ assignments: [grant(STAFF_SETTLEMENT_PAGE, true, true)], ...over });

    it('is refused for a view-only user, before anything is looked up or written', async () => {
        await expect(submitSettlement(actor({ assignments: [grant(STAFF_SETTLEMENT_PAGE, true, false)] }), loanInput)).rejects.toMatchObject({ status: 403 });
        expect(loanService.recordEarlySettlement).not.toHaveBeenCalled();
    });

    it('is refused for a target outside the permitted branches', async () => {
        db.staffLoan.findFirst.mockResolvedValue(null);
        await expect(submitSettlement(settler({ branchIds: ['b1'] }), loanInput)).rejects.toMatchObject({ status: 404 });
        expect(db.staffLoan.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'loan1', branchId: { in: ['b1'] } });
        expect(loanService.recordEarlySettlement).not.toHaveBeenCalled();
    });

    it('will not let a user settle their own loan or advance', async () => {
        db.staffLoan.findFirst.mockResolvedValue({ employeeId: 'mgr1' });
        await expect(submitSettlement(settler(), loanInput)).rejects.toMatchObject({ status: 403 });
        db.staffAdvance.findFirst.mockResolvedValue({ employeeId: 'mgr1' });
        await expect(submitSettlement(settler(), advanceInput)).rejects.toMatchObject({ status: 403 });
        expect(loanService.recordEarlySettlement).not.toHaveBeenCalled();
        expect(advanceSettle.settleAdvance).not.toHaveBeenCalled();
    });

    it('settles a loan as of today (server date) with the quoted amount', async () => {
        const result = await submitSettlement(settler(), { ...loanInput, paymentMode: 'BANK_TRANSFER', reference: 'UTR7' });
        expect(loanService.recordEarlySettlement).toHaveBeenCalledWith(
            expect.objectContaining({ loanId: 'loan1', settlementDate: '2026-09-25', paymentMode: 'BANK_TRANSFER', reference: 'UTR7', expectedVersion: 2, expectedAmount: 6600 }),
            expect.anything(),
        );
        expect(result).toMatchObject({ type: 'LOAN', number: 'SL-000001', settlementAmount: 6600, waivedInterest: 330 });
        expect(advanceSettle.settleAdvance).not.toHaveBeenCalled();
    });

    it('settles an advance through the advance settlement, never the loan one', async () => {
        const result = await submitSettlement(settler(), advanceInput);
        expect(advanceSettle.settleAdvance).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ advanceId: 'adv1', expectedAmount: 10000 }));
        expect(result).toMatchObject({ type: 'ADVANCE', number: 'SA-000001', settlementAmount: 10000, waivedInterest: 0 });
        expect(loanService.recordEarlySettlement).not.toHaveBeenCalled();
    });

    it('lets the retired Repayments grant settle a loan but not an advance', async () => {
        const legacy = actor({ assignments: [grant(LEGACY_LOAN_REPAYMENTS_PAGE, true, true)] });
        await expect(submitSettlement(legacy, loanInput)).resolves.toMatchObject({ type: 'LOAN' });
        await expect(submitSettlement(legacy, advanceInput)).rejects.toMatchObject({ status: 403 });
    });
});
