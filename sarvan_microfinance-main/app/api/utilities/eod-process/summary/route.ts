import { NextRequest } from 'next/server';
import type { FinancialTransactionType, TransactionType } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    parseKolkataAttendanceDateYmd,
    getKolkataDayEndExclusiveUtc,
    getKolkataCalendarYmd,
} from '@/app/lib/branch-lock';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getDaybookData } from '@/app/lib/actions/reports';
import { resolveEodViewBranchId } from '@/app/lib/denomination-entry';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Same view roles as the main EOD process endpoint — this feeds the same page.
const EOD_SUMMARY_VIEW_ROLES = ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER'] as const;

const BANK_TYPES: FinancialTransactionType[] = ['BANK_RECEIPT', 'BANK_PAYMENT'];
const RECEIPT_TYPES = new Set(['CASH_RECEIPT', 'BANK_RECEIPT']);

/** Strip the internal [POSTING:...] idempotency marker from a voucher description for display. */
function stripPostingMarker(description: string | null): string {
    if (!description) return '';
    return description.replace(/^\[POSTING:[^\]]+\]\s*/, '');
}

async function buildBook(
    branchId: string,
    dayStartUtc: Date,
    dayEndExclusiveUtc: Date,
    types: FinancialTransactionType[]
) {
    const branchScope = buildFinancialTransactionBranchScope({ branchId });

    const [priorAgg, dayRows] = await Promise.all([
        prisma.financialTransaction.findMany({
            where: {
                isActive: true,
                type: { in: types },
                approvalStatus: 'APPROVED',
                transactionDate: { lt: dayStartUtc },
                ...branchScope,
            },
            select: { type: true, amount: true },
        }),
        prisma.financialTransaction.findMany({
            where: {
                isActive: true,
                type: { in: types },
                approvalStatus: 'APPROVED',
                transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                ...branchScope,
            },
            select: {
                id: true,
                type: true,
                voucherNo: true,
                description: true,
                amount: true,
                approvalStatus: true,
                ledger: { select: { ledgerName: true } },
            },
            orderBy: { createdAt: 'asc' },
        }),
    ]);

    let openingBalance = 0;
    for (const tx of priorAgg) {
        const amt = Number(tx.amount || 0);
        openingBalance += RECEIPT_TYPES.has(tx.type) ? amt : -amt;
    }

    let runningBalance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    const rows = dayRows.map((tx, idx) => {
        const amt = Number(tx.amount || 0);
        const isReceipt = RECEIPT_TYPES.has(tx.type);
        const debit = isReceipt ? amt : 0;
        const credit = isReceipt ? 0 : amt;
        // dayRows is already approvalStatus: 'APPROVED'-filtered above, so every
        // row here counts toward the running balance.
        runningBalance += debit - credit;
        totalDebit += debit;
        totalCredit += credit;
        // Same "ledger name on top, description below" layout the Daybook uses
        // for manual financial transactions, so Bank Book rows read consistently.
        const ledgerName = tx.ledger?.ledgerName?.trim() || (isReceipt ? 'Bank Receipt' : 'Bank Payment');
        const desc = stripPostingMarker(tx.description);
        return {
            sNo: idx + 1,
            status: tx.approvalStatus,
            voucherType: tx.type,
            voucherNo: tx.voucherNo,
            particulars: desc ? `${ledgerName}\n${desc}` : ledgerName,
            debit,
            credit,
        };
    });

    return {
        openingBalance,
        closingBalance: runningBalance,
        totalDebit,
        totalCredit,
        rows,
    };
}

/**
 * Cash Book must show the exact same voucher-level rows as the Daybook report
 * (`getDaybookData`) so the two can never drift apart — every cash-affecting event
 * (repayments, savings collections, fees, admission fees, disbursements, manual
 * cash receipts/payments) is already broken out there per voucher, GL-shadow-filtered,
 * with the correct opening/closing balance. `exportAll: true` skips pagination so we
 * get every row for the day in one call.
 */
async function buildCashBook(branchId: string, dateYmd: string) {
    const daybook = await getDaybookData(dateYmd, dateYmd, branchId, 1, 1, false, true);

    // getDaybookData's tx.credit = cash IN (receipts), tx.debit = cash OUT (payments) —
    // the Daybook report displays those under "Debit Rs." (receipts) / "Credit Rs."
    // (payments) per standard cash-book convention. Mirror that swap here so the EOD
    // Cash Book's Debit/Credit columns agree with the Daybook report for the same rows.
    const rows = daybook.transactions.map((tx, idx) => ({
        sNo: idx + 1,
        status: 'APPROVED',
        voucherType: tx.debit > 0 ? 'CASH_PAYMENT' : 'CASH_RECEIPT',
        voucherNo: tx.refNo,
        particulars: tx.description ? `${tx.particulars}\n${tx.description}` : tx.particulars,
        debit: tx.credit,
        credit: tx.debit,
    }));

    return {
        openingBalance: daybook.openingBalance,
        closingBalance: daybook.closingBalance,
        totalDebit: daybook.totalCredits,
        totalCredit: daybook.totalDebits,
        rows,
    };
}

/**
 * GET /api/utilities/eod-process/summary
 * Feeds the EOD page's "Demand Collection", "Cash Book" and "Bank Book" sections.
 */
export async function GET(request: NextRequest) {
    return withRole([...EOD_SUMMARY_VIEW_ROLES], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = await resolveEodViewBranchId(user, searchParams.get('branchId'));
            const dateYmd = searchParams.get('date');
            if (!branchId) return errorResponse('Branch context is required', 400);
            if (!dateYmd) return errorResponse('date is required', 400);

            const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const [approvedTx, branchLock] = await Promise.all([
                prisma.loanTransaction.findMany({
                    where: {
                        branchId,
                        type: { in: ['REPAYMENT', 'SAVINGS_COLLECTION'] as TransactionType[] },
                        status: 'APPROVED',
                        isReversed: false,
                        transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                        // Migrated history from the bulk "Ongoing Loan Backup" Excel import
                        // (/dashboard/masters/uploan/member) must not read as today's live
                        // Demand Collection activity.
                        loan: { isBulkMemberImport: false },
                    },
                    orderBy: { transactionDate: 'asc' },
                    select: {
                        type: true,
                        principalAmount: true,
                        interestAmount: true,
                        currentDemandPrincipal: true,
                        currentDemandInterest: true,
                        amount: true,
                        collectedBy: { select: { firstName: true, lastName: true } },
                        center: {
                            select: {
                                name: true,
                                code: true,
                                fdo: { select: { firstName: true, lastName: true } },
                            },
                        },
                        loan: { select: { funderId: true } },
                    },
                }),
                prisma.branchLock.findUnique({ where: { branchId }, select: { currentWorkingDate: true } }),
            ]);

            const status =
                branchLock && getKolkataCalendarYmd(branchLock.currentWorkingDate) > dateYmd
                    ? 'EOD APPROVED'
                    : 'PENDING';

            const markerBase = `[POSTING:EOD_COLLECTION:${branchId}:${dateYmd}:`;
            const postedMarkers = await prisma.financialTransaction.findMany({
                where: { description: { contains: markerBase }, isActive: true },
                select: { description: true, amount: true },
            });
            const postedAmountByFunderKey = new Map<string, number>();
            for (const p of postedMarkers) {
                const match = p.description?.match(/\[POSTING:EOD_COLLECTION:[^:]+:[^:]+:([^\]]+)\]/);
                if (!match) continue;
                const key = match[1];
                postedAmountByFunderKey.set(key, (postedAmountByFunderKey.get(key) ?? 0) + Number(p.amount || 0));
            }

            // An approved collection only belongs in this EOD summary once its funder's
            // collections have actually been posted to GL via "Allocate for EOD" — otherwise
            // the Demand Collection detail would show ahead of the books it's meant to explain.
            // Attribute that per *transaction* via the same oldest-first FIFO consumption of the
            // posted total used in GET /api/collections/eod-allocation, instead of an all-or-
            // nothing per-funder exact-match: a funder's posted total almost never re-matches its
            // current total exactly once more collections get approved for it later the same day,
            // so the exact-match version made already-posted history disappear the moment any new,
            // still-unallocated collection came in for that funder — this keeps it stable.
            const txByFunder = new Map<string, typeof approvedTx>();
            for (const tx of approvedTx) {
                const funderKey = tx.loan?.funderId ?? 'OWN';
                const arr = txByFunder.get(funderKey) ?? [];
                arr.push(tx);
                txByFunder.set(funderKey, arr);
            }

            const centers = new Map<string, {
                centerName: string; centerCode: string; officerName: string; collectedByName: string;
                demandPrincipal: number; demandInterest: number; demandLoanAdvance1: number;
                receivedPrincipal: number; receivedInterest: number; receivedLoanAdvance1: number;
            }>();

            for (const [funderKey, txs] of txByFunder.entries()) {
                const postedTotal = postedAmountByFunderKey.get(funderKey) ?? 0;
                let running = 0;
                for (const tx of txs) {
                    const isSavings = (tx.type as string) === 'SAVINGS_COLLECTION';
                    // SAVINGS_COLLECTION isn't posted to GL by EOD allocation at all (only
                    // principal/interest are), so it never advances `running` — its allocated
                    // status just follows whatever REPAYMENT coverage has been reached so far.
                    if (!isSavings) {
                        running += Number(tx.principalAmount || 0) + Number(tx.interestAmount || 0);
                    }
                    const allocated = running <= postedTotal + 0.01;
                    if (!allocated) continue;

                    const key = tx.center?.code || 'MANUAL';
                    if (!centers.has(key)) {
                        centers.set(key, {
                            centerName: tx.center?.name || 'Manual',
                            centerCode: tx.center?.code || '',
                            officerName: tx.center?.fdo ? `${tx.center.fdo.firstName} ${tx.center.fdo.lastName}` : 'N/A',
                            collectedByName: tx.collectedBy ? `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}` : 'N/A',
                            demandPrincipal: 0, demandInterest: 0, demandLoanAdvance1: 0,
                            receivedPrincipal: 0, receivedInterest: 0, receivedLoanAdvance1: 0,
                        });
                    }
                    const bucket = centers.get(key)!;
                    if (isSavings) {
                        bucket.receivedLoanAdvance1 += Number(tx.amount || 0);
                        bucket.demandLoanAdvance1 += Number(tx.amount || 0);
                    } else {
                        bucket.demandPrincipal += Number(tx.currentDemandPrincipal || 0);
                        bucket.demandInterest += Number(tx.currentDemandInterest || 0);
                        bucket.receivedPrincipal += Number(tx.principalAmount || 0);
                        bucket.receivedInterest += Number(tx.interestAmount || 0);
                    }
                }
            }

            const demandRows = Array.from(centers.values()).map((c) => ({
                centerName: c.centerName,
                centerCode: c.centerCode,
                officerName: c.officerName,
                collectedByName: c.collectedByName,
                collectMode: 'Demand Amount',
                demandPrincipal: c.demandPrincipal,
                demandInterest: c.demandInterest,
                demandLoanAdvance1: c.demandLoanAdvance1,
                demandLoanAdvance2: 0,
                demandTotal: c.demandPrincipal + c.demandInterest + c.demandLoanAdvance1,
                receivedPrincipal: c.receivedPrincipal,
                receivedInterest: c.receivedInterest,
                receivedLoanAdvance1: c.receivedLoanAdvance1,
                receivedLoanAdvance2: 0,
                receivedTotal: c.receivedPrincipal + c.receivedInterest + c.receivedLoanAdvance1,
                status,
            }));

            const demandTotals = demandRows.reduce(
                (acc, r) => {
                    acc.demandPrincipal += r.demandPrincipal;
                    acc.demandInterest += r.demandInterest;
                    acc.demandLoanAdvance1 += r.demandLoanAdvance1;
                    acc.demandTotal += r.demandTotal;
                    acc.receivedPrincipal += r.receivedPrincipal;
                    acc.receivedInterest += r.receivedInterest;
                    acc.receivedLoanAdvance1 += r.receivedLoanAdvance1;
                    acc.receivedTotal += r.receivedTotal;
                    return acc;
                },
                {
                    demandPrincipal: 0, demandInterest: 0, demandLoanAdvance1: 0, demandTotal: 0,
                    receivedPrincipal: 0, receivedInterest: 0, receivedLoanAdvance1: 0, receivedTotal: 0,
                }
            );

            const [cashBook, bankBook] = await Promise.all([
                buildCashBook(branchId, dateYmd),
                buildBook(branchId, dayStartUtc, dayEndExclusiveUtc, BANK_TYPES),
            ]);

            return successResponse({
                date: dateYmd,
                demandCollection: { rows: demandRows, totals: demandTotals },
                cashBook,
                bankBook,
            }, 'EOD summary fetched');
        } catch (error) {
            console.error('[EOD Summary] GET Error:', error);
            return errorResponse('Failed to fetch EOD summary', 500);
        }
    })(request);
}
