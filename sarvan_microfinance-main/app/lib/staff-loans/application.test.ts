import { describe, expect, it } from 'vitest';
import {
    APPLY_PAGE,
    MANAGEMENT_PAGE,
    applicationSchema,
    cancelSchema,
    disburseSchema,
    editTermsSchema,
    formatStaffLoanNumber,
    previewInstallments,
    repaymentSchema,
    reviewSchema,
    roleCanAct,
    saveApplicationSchema,
    serviceMonths,
    settlementSchema,
    type RoleAssignment,
} from './application';
import { getApplicableActions } from '@/app/lib/permissions/page-permission-tree';

describe('serviceMonths calculation', () => {
    it('calculates completed months accurately across year boundaries', () => {
        expect(serviceMonths('2025-01-15', '2026-01-15')).toBe(12);
        expect(serviceMonths('2025-01-15', '2026-01-14')).toBe(11);
        expect(serviceMonths('2025-01-15', '2026-01-16')).toBe(12);
    });

    it('handles leap year joining dates', () => {
        expect(serviceMonths('2024-02-29', '2025-02-28')).toBe(11);
        expect(serviceMonths('2024-02-29', '2025-03-01')).toBe(12);
    });

    it('returns -1 for future joining dates', () => {
        expect(serviceMonths('2026-10-01', '2026-09-10')).toBe(-1);
    });

    it('returns 0 for same-month or incomplete first month', () => {
        expect(serviceMonths('2026-08-15', '2026-09-10')).toBe(0);
        expect(serviceMonths('2026-08-10', '2026-09-10')).toBe(1);
    });
});

describe('previewInstallments calculation and paise distribution', () => {
    it('calculates interest-free installment schedules with distributed paise remainders', () => {
        const preview = previewInstallments(10000, 3, 'INTEREST_FREE', 0);
        expect(preview.principal).toBe(10000);
        expect(preview.totalInterest).toBe(0);
        expect(preview.totalRepayment).toBe(10000);
        expect(preview.installmentCount).toBe(3);
        expect(preview.installments).toHaveLength(3);

        expect(preview.installments[0]).toEqual({ installmentNo: 1, principal: 3333.34, interest: 0, total: 3333.34 });
        expect(preview.installments[1]).toEqual({ installmentNo: 2, principal: 3333.33, interest: 0, total: 3333.33 });
        expect(preview.installments[2]).toEqual({ installmentNo: 3, principal: 3333.33, interest: 0, total: 3333.33 });

        const sumPrincipal = preview.installments.reduce((acc, inst) => acc + inst.principal, 0);
        expect(Number(sumPrincipal.toFixed(2))).toBe(10000);
    });

    it('calculates flat-rate interest schedules and reconciles interest paise', () => {
        // 10000 at 10% flat for 3 months = 10000 * 10 * 3 / 1200 = 250 interest
        const preview = previewInstallments(10000, 3, 'FLAT', 10);
        expect(preview.principal).toBe(10000);
        expect(preview.totalInterest).toBe(250);
        expect(preview.totalRepayment).toBe(10250);

        // 250 / 3 = 83.33 with 1 paisa remainder on the first installment
        expect(preview.installments[0]).toEqual({ installmentNo: 1, principal: 3333.34, interest: 83.34, total: 3416.68 });
        expect(preview.installments[1]).toEqual({ installmentNo: 2, principal: 3333.33, interest: 83.33, total: 3416.66 });
        expect(preview.installments[2]).toEqual({ installmentNo: 3, principal: 3333.33, interest: 83.33, total: 3416.66 });

        const sumTotal = preview.installments.reduce((acc, inst) => acc + inst.total, 0);
        expect(Number(sumTotal.toFixed(2))).toBe(10250);
    });

    it('calculates monthly flat-interest schedules charged fresh every installment', () => {
        // 30000 @ 1% MONTHLY for 10 months = 300 interest/month, 3000 principal/month, 3300/month total
        const preview = previewInstallments(30000, 10, 'MONTHLY', 1);
        expect(preview.principal).toBe(30000);
        expect(preview.totalInterest).toBe(3000);
        expect(preview.totalRepayment).toBe(33000);
        expect(preview.installments[0]).toEqual({ installmentNo: 1, principal: 3000, interest: 300, total: 3300 });
        expect(preview.installments[9]).toEqual({ installmentNo: 10, principal: 3000, interest: 300, total: 3300 });
    });

    it('limits the preview payload to 120 installments while retaining full count', () => {
        const preview = previewInstallments(180000, 180, 'INTEREST_FREE', 0);
        expect(preview.installmentCount).toBe(180);
        expect(preview.installments).toHaveLength(120);
        expect(preview.installments[0].principal).toBe(1000);
    });

    it('rejects invalid calculation parameters', () => {
        expect(() => previewInstallments(0, 12, 'INTEREST_FREE', 0)).toThrow('Invalid repayment terms');
        expect(() => previewInstallments(-500, 12, 'INTEREST_FREE', 0)).toThrow('Invalid repayment terms');
        expect(() => previewInstallments(5000, 0, 'INTEREST_FREE', 0)).toThrow('Invalid repayment terms');
        expect(() => previewInstallments(5000, 1.5, 'INTEREST_FREE', 0)).toThrow('Invalid repayment terms');
        expect(() => previewInstallments(5000, 12, 'FLAT', -2)).toThrow('Invalid repayment terms');
    });
});

describe('roleCanAct checking', () => {
    const assignments: RoleAssignment[] = [
        { roleId: 'branch-mgr', branchId: 'branch-1' },
        { roleId: 'global-hr', branchId: null },
    ];

    it('allows global role assignment for any branch', () => {
        expect(roleCanAct(assignments, 'global-hr', 'branch-1')).toBe(true);
        expect(roleCanAct(assignments, 'global-hr', 'branch-99')).toBe(true);
    });

    it('allows branch-scoped role only for the designated branch', () => {
        expect(roleCanAct(assignments, 'branch-mgr', 'branch-1')).toBe(true);
        expect(roleCanAct(assignments, 'branch-mgr', 'branch-2')).toBe(false);
    });

    it('denies roles not assigned to the actor', () => {
        expect(roleCanAct(assignments, 'auditor', 'branch-1')).toBe(false);
    });
});

describe('application Zod schemas', () => {
    const validApp = {
        schemeId: 'scheme-1',
        requestedAmount: 50000,
        tenureMonths: 12,
        recoveryMethod: 'SALARY' as const,
        purpose: 'Medical emergency',
        remarks: 'Doctor prescription attached',
        document: { fileKey: 'org/employee-emp-1/staff-loan/slip.jpg', fileName: 'slip.jpg' },
    };

    it('validates a correct application input', () => {
        expect(applicationSchema.safeParse(validApp).success).toBe(true);
    });

    it.each([
        { requestedAmount: 0 },
        { requestedAmount: -100 },
        { requestedAmount: 50.123 }, // More than 2 decimal places
        { tenureMonths: 0 },
        { tenureMonths: -6 },
        { tenureMonths: 12.5 },
        { recoveryMethod: 'UNKNOWN' },
        { purpose: '   ' },
        { document: undefined }, // supporting document is required
        { document: { fileKey: '', fileName: 'slip.jpg' } },
        { extraField: 'not-allowed' }, // strict validation
    ])('rejects invalid application input %j', patch => {
        expect(applicationSchema.safeParse({ ...validApp, ...patch }).success).toBe(false);
    });

    it('enforces id and expectedVersion pair in saveApplicationSchema', () => {
        expect(saveApplicationSchema.safeParse({ application: validApp, id: null, expectedVersion: null, submit: false }).success).toBe(true);
        expect(saveApplicationSchema.safeParse({ application: validApp, id: 'app-1', expectedVersion: 1, submit: true }).success).toBe(true);
        expect(saveApplicationSchema.safeParse({ application: validApp, id: 'app-1', expectedVersion: null, submit: true }).success).toBe(false);
        expect(saveApplicationSchema.safeParse({ application: validApp, id: null, expectedVersion: 1, submit: true }).success).toBe(false);
    });

    it('requires remarks for review rejection, but optional for approval', () => {
        expect(reviewSchema.safeParse({ id: 'app-1', expectedVersion: 1, action: 'APPROVE', remarks: '' }).success).toBe(true);
        expect(reviewSchema.safeParse({ id: 'app-1', expectedVersion: 1, action: 'REJECT', remarks: '' }).success).toBe(false);
        expect(reviewSchema.safeParse({ id: 'app-1', expectedVersion: 1, action: 'REJECT', remarks: 'Incomplete documentation' }).success).toBe(true);
    });

    it('no longer accepts Return as a review action (approvers edit instead)', () => {
        expect(reviewSchema.safeParse({ id: 'app-1', expectedVersion: 1, action: 'RETURN', remarks: 'Please update salary slip' }).success).toBe(false);
    });

    it('validates approver term edits strictly', () => {
        const edit = {
            expectedVersion: 1, schemeId: 'scheme-1', requestedAmount: 25000, tenureMonths: 10,
            interestType: 'FLAT' as const, annualInterestRate: 1.5, recoveryMethod: 'SALARY' as const,
            purpose: 'Medical', remarks: '', reason: '',
        };
        expect(editTermsSchema.safeParse(edit).success).toBe(true);
        // every application detail is editable, including a replacement document
        expect(editTermsSchema.safeParse({ ...edit, interestType: 'MONTHLY', recoveryMethod: 'CASH_BANK', schemeId: 'scheme-2', remarks: 'Updated', reason: 'Per policy' }).success).toBe(true);
        expect(editTermsSchema.safeParse({ ...edit, document: { fileKey: 'org/employee-e1/staff-loan/new.pdf', fileName: 'new.pdf' } }).success).toBe(true);
        // interest type and rate must agree
        expect(editTermsSchema.safeParse({ ...edit, interestType: 'INTEREST_FREE', annualInterestRate: 0 }).success).toBe(true);
        expect(editTermsSchema.safeParse({ ...edit, interestType: 'INTEREST_FREE', annualInterestRate: 2 }).success).toBe(false);
        expect(editTermsSchema.safeParse({ ...edit, interestType: 'MONTHLY', annualInterestRate: 0 }).success).toBe(false);
        for (const patch of [
            { requestedAmount: 0 }, { requestedAmount: 10.123 }, { tenureMonths: 0 }, { tenureMonths: 2.5 }, { annualInterestRate: -1 },
            { purpose: ' ' }, { schemeId: '' }, { recoveryMethod: 'CHEQUE' }, { interestType: 'COMPOUND' },
            { document: {} }, { document: { fileKey: '', fileName: 'x.pdf' } }, { status: 'APPROVED' },
        ]) {
            expect(editTermsSchema.safeParse({ ...edit, ...patch }).success).toBe(false);
        }
    });

    it('formats the business loan number as a zero-padded sequence', () => {
        expect(formatStaffLoanNumber(1)).toBe('SL-000001');
        expect(formatStaffLoanNumber(BigInt(123456))).toBe('SL-123456');
        expect(formatStaffLoanNumber(1234567)).toBe('SL-1234567');
    });

    it('validates cancelSchema strictly', () => {
        expect(cancelSchema.safeParse({ id: 'app-1', expectedVersion: 1 }).success).toBe(true);
        expect(cancelSchema.safeParse({ id: '', expectedVersion: 1 }).success).toBe(false);
        expect(cancelSchema.safeParse({ id: 'app-1', expectedVersion: 0 }).success).toBe(false);
    });

    it('validates disburseSchema requirements', () => {
        const valid = {
            id: 'loan-1',
            expectedVersion: 1,
            disbursementDate: '2026-09-10',
            paymentMode: 'BANK_TRANSFER' as const,
            reference: 'UTR123456',
            firstDueDate: '2026-10-10',
            remarks: null,
        };
        expect(disburseSchema.safeParse(valid).success).toBe(true);
        expect(disburseSchema.safeParse({ ...valid, disbursementDate: '10/09/2026' }).success).toBe(false);
        expect(disburseSchema.safeParse({ ...valid, paymentMode: 'CHEQUE' }).success).toBe(false);
        expect(disburseSchema.safeParse({ ...valid, expectedVersion: 0 }).success).toBe(false);
    });

    it('requires the payment reference / UTR for a bank transfer, but not for cash', () => {
        const base = { id: 'loan-1', expectedVersion: 1, disbursementDate: '2026-09-10', firstDueDate: '2026-10-10', remarks: null };
        for (const reference of [null, '', '   ']) {
            const result = disburseSchema.safeParse({ ...base, paymentMode: 'BANK_TRANSFER', reference });
            expect(result.success).toBe(false);
            expect(!result.success && result.error.issues[0]).toMatchObject({ path: ['reference'], message: expect.stringContaining('UTR') });
        }
        expect(disburseSchema.safeParse({ ...base, paymentMode: 'BANK_TRANSFER', reference: '  UTR998877  ' })).toMatchObject({ success: true, data: { reference: 'UTR998877' } });
        expect(disburseSchema.safeParse({ ...base, paymentMode: 'CASH', reference: null }).success).toBe(true);
        expect(disburseSchema.safeParse({ ...base, paymentMode: 'CASH', reference: '' }).success).toBe(true);
    });

    it('validates repaymentSchema correctly', () => {
        const valid = {
            loanId: 'loan-1',
            amount: 5000,
            paymentMode: 'CASH' as const,
            paymentDate: '2026-09-10',
            reference: 'REC001',
            remarks: 'Cash collection at branch',
            expectedVersion: 1,
        };
        expect(repaymentSchema.safeParse(valid).success).toBe(true);
        expect(repaymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
        expect(repaymentSchema.safeParse({ ...valid, amount: -100 }).success).toBe(false);
        expect(repaymentSchema.safeParse({ ...valid, paymentDate: '2026/09/10' }).success).toBe(false);
        expect(repaymentSchema.safeParse({ ...valid, loanId: '' }).success).toBe(false);
    });

    it('validates settlementSchema correctly', () => {
        const valid = {
            loanId: 'loan-1',
            paymentMode: 'BANK_TRANSFER' as const,
            settlementDate: '2026-09-10',
            reference: 'UTR998877',
            remarks: 'Full settlement',
            expectedVersion: 1,
        };
        expect(settlementSchema.safeParse(valid).success).toBe(true);
        expect(settlementSchema.safeParse({ ...valid, settlementDate: 'invalid' }).success).toBe(false);
        expect(settlementSchema.safeParse({ ...valid, expectedVersion: 0 }).success).toBe(false);
    });

    it('limits early settlement to Cash and Bank Transfer, and requires a UTR for a bank transfer', () => {
        const valid = { loanId: 'loan-1', settlementDate: '2026-09-10', reference: null, remarks: null, expectedVersion: 1 };
        expect(settlementSchema.safeParse({ ...valid, paymentMode: 'CASH' }).success).toBe(true);
        expect(settlementSchema.safeParse({ ...valid, paymentMode: 'BANK_TRANSFER', reference: 'UTR1' }).success).toBe(true);
        expect(settlementSchema.safeParse({ ...valid, paymentMode: 'BANK_TRANSFER' }).success).toBe(false);
        expect(settlementSchema.safeParse({ ...valid, paymentMode: 'CHEQUE' }).success).toBe(false);
        expect(settlementSchema.safeParse({ ...valid, paymentMode: 'UPI' }).success).toBe(false);
    });
});

describe('staff loan page permission registration', () => {
    it('registers expected actions for apply, management, and the combined settlement pages', () => {
        expect(getApplicableActions(APPLY_PAGE)).toEqual(['view', 'add', 'edit']);
        expect(getApplicableActions(MANAGEMENT_PAGE)).toEqual(['view', 'edit', 'approve']);
        expect(getApplicableActions('/dashboard/hr/staff-settlement')).toEqual(['view', 'add']);
    });
});


