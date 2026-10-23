import { describe, expect, it } from 'vitest';
import {
    createBackupLoanFromReports,
    calculateNextDueDate,
    type CreateBackupLoanFromReportsInput,
} from '@/app/lib/services/backup-loan.service';
import type { ParsedLoanCardReport, ParsedRepaymentReport } from '@/app/lib/services/uploan-loan-history.service';

/**
 * Minimal fake Prisma transaction client — only implements the handful of calls
 * createBackupLoanFromReports's code path actually makes (no gold/savings-lump-sum
 * branches exercised here), with enough real in-memory state (schedule rows keyed by
 * loanId, mutated in place) for replayRepaymentEvents's waterfall allocation to behave
 * exactly as it would against a real database.
 */
function createFakeTx() {
    type ScheduleRow = {
        id: string;
        loanId: string;
        installmentNo: number;
        dueDate: Date;
        principalDue: number;
        interestDue: number;
        feesDue: number;
        penaltiesDue: number;
        savingsDue: number;
        totalDue: number;
        principalPaid: number;
        interestPaid: number;
        savingsPaid: number;
        totalPaid: number;
        status: string;
        paidAt: Date | null;
    };

    const schedules: ScheduleRow[] = [];
    const transactions: any[] = [];
    const clientUpdates: any[] = [];
    const loanCreates: any[] = [];
    let nextId = 1;

    const tx = {
        loanProduct: {
            findUnique: async () => ({
                id: 'product-1',
                loanAmount: 200,
                interestRate: 10,
                numberOfDues: 2,
                interestAmount: 40,
                advanceSavingsAmount: 0,
                frequency: 'weekly',
                scheduleTemplates: [
                    { installmentNo: 1, principalAmount: '100', interestAmount: '20' },
                    { installmentNo: 2, principalAmount: '100', interestAmount: '20' },
                ],
            }),
        },
        loan: {
            create: async ({ data }: any) => {
                loanCreates.push(data);
                return { id: 'loan-1', ...data };
            },
            update: async ({ data }: any) => {
                transactions.push({ __loanUpdate: data });
                return {};
            },
            findFirst: async () => null,
            findUnique: async () => null,
        },
        loanSchedule: {
            createMany: async ({ data }: any) => {
                for (const item of data) {
                    schedules.push({
                        id: `sched-${nextId++}`,
                        loanId: item.loanId,
                        installmentNo: item.installmentNo,
                        dueDate: item.dueDate,
                        principalDue: Number(item.principalDue),
                        interestDue: Number(item.interestDue),
                        feesDue: Number(item.feesDue ?? 0),
                        penaltiesDue: Number(item.penaltiesDue ?? 0),
                        savingsDue: Number(item.savingsDue ?? 0),
                        totalDue: Number(item.totalDue),
                        principalPaid: Number(item.principalPaid ?? 0),
                        interestPaid: Number(item.interestPaid ?? 0),
                        savingsPaid: Number(item.savingsPaid ?? 0),
                        totalPaid: Number(item.totalPaid ?? 0),
                        status: item.status,
                        paidAt: null,
                    });
                }
                return { count: data.length };
            },
            findMany: async ({ where }: any) => schedules.filter((s) => s.loanId === where.loanId),
            update: async ({ where, data }: any) => {
                const row = schedules.find((s) => s.id === where.id);
                if (row) Object.assign(row, data, {
                    principalPaid: data.principalPaid !== undefined ? Number(data.principalPaid) : row.principalPaid,
                    interestPaid: data.interestPaid !== undefined ? Number(data.interestPaid) : row.interestPaid,
                    totalPaid: data.totalPaid !== undefined ? Number(data.totalPaid) : row.totalPaid,
                });
                return row;
            },
        },
        loanTransaction: {
            create: async ({ data }: any) => {
                transactions.push(data);
                return { id: `txn-${nextId++}`, ...data };
            },
        },
        goldLoanDetail: { create: async () => ({}) },
        goldTransaction: { create: async () => ({}) },
        client: {
            update: async ({ data }: any) => {
                clientUpdates.push(data);
                return {};
            },
        },
    };

    return { tx, schedules, transactions, clientUpdates, loanCreates };
}

describe('createBackupLoanFromReports — repayment waterfall allocation', () => {
    it('fills installment 1\'s balance completely before any amount spills into installment 2, even when the split payments are recorded under installment 2\'s own dueNo', async () => {
        const { tx, schedules } = createFakeTx();

        // Installment 1's true EMI is 100 principal + 20 interest = 120. In the source
        // file this was actually paid via TWO collection records that landed on the same
        // day the legacy system's own counter had already rolled over to "installment 2"
        // — exactly the real-world pattern from the bug report (600+400 recorded against
        // two different S.No values on the same collection date). Both events use dueNo
        // "2" here to reproduce that mislabeling; the fix must not trust it.
        const loanCardReport: ParsedLoanCardReport = {
            memberId: 'M1',
            contractCode: 'L1',
            officerName: 'Officer',
            groupName: '',
            amount: 0,
            funderName: '',
            installments: 2,
            interestRate: 0,
            disbursementDate: null,
            scheduleRows: [
                { installmentNo: 1, dueDate: '2026-01-01T00:00:00.000Z', principalDue: 100, interestDue: 20, feesDue: 0, savingsDue: 0, totalDue: 120, outstandingBalance: 0, receivedDate: null, receivedAmount: null },
                { installmentNo: 2, dueDate: '2026-01-08T00:00:00.000Z', principalDue: 100, interestDue: 20, feesDue: 0, savingsDue: 0, totalDue: 120, outstandingBalance: 0, receivedDate: null, receivedAmount: null },
            ],
        };
        const repaymentReport: ParsedRepaymentReport = {
            memberId: 'M1',
            clientName: 'Test Client',
            events: [
                {
                    dueNo: '2', dueDate: '2026-01-08', dueAmount: 70, transactionDate: '2026-01-08',
                    transactionType: 'Demand Collection', amount: 70, principalAmount: 60, interestAmount: 10,
                    loanBalance: 0, walletAdvanceAmount: 0, walletAdvanceDate: null, walletPayAmount: 0, walletPayDate: null, walletBalance: 0,
                },
                {
                    dueNo: '2', dueDate: '2026-01-08', dueAmount: 50, transactionDate: '2026-01-08',
                    transactionType: 'Demand Collection', amount: 50, principalAmount: 40, interestAmount: 10,
                    loanBalance: 0, walletAdvanceAmount: 0, walletAdvanceDate: null, walletPayAmount: 0, walletPayDate: null, walletBalance: 0,
                },
            ],
        };

        const input: CreateBackupLoanFromReportsInput = {
            clientId: 'client-1',
            centerId: 'center-1',
            branchId: 'branch-1',
            loanProductId: 'product-1',
            loanPurposeId: 'purpose-1',
            frequency: 'weekly',
            disbursementDate: new Date('2026-01-01'),
            scheduleStartDate: new Date('2026-01-01'),
            principalPaid: 0,
            interestPaid: 0,
            savingsPaid: 0,
            createdById: 'user-1',
            loanCardReport,
            repaymentReport,
        };

        await createBackupLoanFromReports(tx as any, input);

        const [row1, row2] = schedules.sort((a, b) => a.installmentNo - b.installmentNo);

        // The combined 70+50=120 must fully pay off installment 1 (its real 100/20 EMI)
        // first, not get pinned to installment 2 because that's what the source data's
        // own dueNo said. (principalPaid/interestPaid come back as Decimal instances once
        // replayRepaymentEvents's own code touches them, same as a real Prisma row.)
        expect(Number(row1.principalPaid)).toBe(100);
        expect(Number(row1.interestPaid)).toBe(20);
        expect(row1.status).toBe('PAID');

        // Nothing should have spilled into installment 2 — the combined payment exactly
        // covers installment 1 alone.
        expect(Number(row2.principalPaid)).toBe(0);
        expect(Number(row2.interestPaid)).toBe(0);
        expect(row2.status).toBe('PENDING');
    });
});

describe('createBackupLoanFromReports — aggregate path (no reports), savings/loan-advance handling', () => {
    it('records an aggregate savingsPaid figure as the client/loan wallet balance without stamping it onto individual schedule rows', async () => {
        const { tx, schedules, transactions, clientUpdates } = createFakeTx();

        // No loanCardReport/repaymentReport → falls through to createBackupLoanWithHistory's
        // aggregate path (applyAggregatePaymentAndSchedule / distributePayments). The
        // product here has 2 installments of principal 100 + interest 20 each (see
        // createFakeTx's loanProduct mock); a savingsPaid figure large enough to cover both
        // installments' savings-due (100 each, per advanceSavingsAmount below) must NOT mark
        // either row's savingsPaid — only the loan/client aggregate should reflect it.
        const input: CreateBackupLoanFromReportsInput = {
            clientId: 'client-1',
            centerId: 'center-1',
            branchId: 'branch-1',
            loanProductId: 'product-1',
            loanPurposeId: 'purpose-1',
            frequency: 'weekly',
            disbursementDate: new Date('2026-01-01'),
            scheduleStartDate: new Date('2026-01-01'),
            principalPaid: 0,
            interestPaid: 0,
            savingsPaid: 250,
            createdById: 'user-1',
        };

        // advanceSavingsAmount comes from the loan product — override the fake's default
        // (0) so savingsDue is nonzero on the generated schedule, matching a real product.
        (tx as any).loanProduct.findUnique = async () => ({
            id: 'product-1',
            loanAmount: 200,
            interestRate: 10,
            numberOfDues: 2,
            interestAmount: 40,
            advanceSavingsAmount: 100,
            frequency: 'weekly',
            scheduleTemplates: [
                { installmentNo: 1, principalAmount: '100', interestAmount: '20' },
                { installmentNo: 2, principalAmount: '100', interestAmount: '20' },
            ],
        });

        await createBackupLoanFromReports(tx as any, input);

        const [row1, row2] = schedules.sort((a, b) => a.installmentNo - b.installmentNo);

        // Neither installment's savingsPaid is stamped, even though 250 would have fully
        // covered both rows' 100 savingsDue each under the old (buggy) distribution.
        expect(row1.savingsDue).toBe(100);
        expect(Number(row1.savingsPaid)).toBe(0);
        expect(row1.status).toBe('PENDING');
        expect(row2.savingsDue).toBe(100);
        expect(Number(row2.savingsPaid)).toBe(0);
        expect(row2.status).toBe('PENDING');

        // The aggregate figure is still recorded as the loan/client wallet balance.
        const loanUpdate = transactions.find((t) => t.__loanUpdate?.savingsPaid)?.__loanUpdate;
        expect(Number(loanUpdate?.savingsPaid?.increment)).toBe(250);
        const clientLoanAdvanceUpdate = clientUpdates.find((u) => u.loanAdvance);
        expect(Number(clientLoanAdvanceUpdate?.loanAdvance?.increment)).toBe(250);
    });
});

describe('createBackupLoanFromReports — isBulkMemberImport tagging', () => {
    const baseInput: Omit<CreateBackupLoanFromReportsInput, 'loanNumberOverride'> = {
        clientId: 'client-1',
        centerId: 'center-1',
        branchId: 'branch-1',
        loanProductId: 'product-1',
        loanPurposeId: 'purpose-1',
        frequency: 'weekly',
        disbursementDate: new Date('2026-01-01'),
        scheduleStartDate: new Date('2026-01-01'),
        principalPaid: 0,
        interestPaid: 0,
        savingsPaid: 0,
        createdById: 'user-1',
    };

    it('tags the loan isBulkMemberImport:true when loanNumberOverride is supplied (bulk uploan-member import)', async () => {
        const { tx, loanCreates } = createFakeTx();

        await createBackupLoanFromReports(tx as any, { ...baseInput, loanNumberOverride: '72833' });

        expect(loanCreates).toHaveLength(1);
        expect(loanCreates[0].isBulkMemberImport).toBe(true);
        expect(loanCreates[0].loanNumber).toBe('72833');
    });

    it('leaves the loan isBulkMemberImport:false when no loanNumberOverride is supplied (single-entry "Ongoing Loan Backup" form)', async () => {
        const { tx, loanCreates } = createFakeTx();

        await createBackupLoanFromReports(tx as any, { ...baseInput });

        expect(loanCreates).toHaveLength(1);
        expect(loanCreates[0].isBulkMemberImport).toBe(false);
    });
});

describe('calculateNextDueDate — monthly/quarterly are fixed-day, not calendar, intervals', () => {
    it('steps a monthly installment forward by exactly 28 days, not a calendar month', () => {
        const next = calculateNextDueDate(new Date('2026-01-05T00:00:00.000Z'), 'monthly');
        // A calendar month would land on 2026-02-05; 28 fixed days lands on 2026-02-02.
        expect(next.toISOString().slice(0, 10)).toBe('2026-02-02');
    });

    it('steps a quarterly installment forward by exactly 91 days, not 3 calendar months', () => {
        const next = calculateNextDueDate(new Date('2026-01-05T00:00:00.000Z'), 'quarterly');
        // 3 calendar months would land on 2026-04-05; 91 fixed days lands on 2026-04-06.
        expect(next.toISOString().slice(0, 10)).toBe('2026-04-06');
    });

    it('never drifts the day-of-week for monthly (28 is a multiple of 7)', () => {
        const first = new Date('2026-01-05T00:00:00.000Z'); // Monday
        const second = calculateNextDueDate(first, 'monthly');
        const third = calculateNextDueDate(second, 'monthly');
        expect(second.getDay()).toBe(first.getDay());
        expect(third.getDay()).toBe(first.getDay());
    });

    it('never drifts the day-of-week for quarterly (91 is a multiple of 7)', () => {
        const first = new Date('2026-01-05T00:00:00.000Z'); // Monday
        const second = calculateNextDueDate(first, 'quarterly');
        expect(second.getDay()).toBe(first.getDay());
    });

    it('still skips Sunday after the new fixed-day math (existing getNextValidDate behavior preserved)', () => {
        // 2026-01-11 is a Sunday; +28 days lands on 2026-02-08, also a Sunday, so the
        // existing Sunday-skip must bump it one day forward to Monday 2026-02-09.
        const sunday = new Date('2026-01-11T00:00:00.000Z');
        expect(sunday.getDay()).toBe(0);
        const next = calculateNextDueDate(sunday, 'monthly');
        expect(next.getDay()).not.toBe(0);
        expect(next.toISOString().slice(0, 10)).toBe('2026-02-09');
    });
});
