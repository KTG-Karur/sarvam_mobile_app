import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getBranchOpeningContext, resolveSelfAccountBridges } from '@/app/lib/services/ledger-opening-balance';
import { stripPostingMarker } from '@/app/lib/narration';
import type { Prisma } from '@prisma/client';

// Human-readable voucher type labels — mirrors app/api/reports/voucher-print/route.ts
const VOUCHER_TYPE_LABEL: Record<string, string> = {
  BANK_RECEIPT: 'Bank Receipt',
  BANK_PAYMENT: 'Bank Payment',
  CASH_RECEIPT: 'Cash Receipt',
  CASH_PAYMENT: 'Cash Payment',
  CONTRA: 'Contra',
  JOURNAL: 'Journal',
};

type TxForClassify = {
  ledgerId: string | null;
  creditLedgerId: string | null;
  selfAccountId: string | null;
  contraAccountId: string | null;
  type: string;
  amount: Prisma.Decimal | number;
  selfAccount: { name: string } | null;
  contraAccount: { name: string } | null;
  ledger: { ledgerName: string } | null;
  creditLedger: { ledgerName: string } | null;
};

// Correct double-entry sign convention (matches how vouchers are actually posted —
// see app/api/transactions/cash-receipt|cash-payment/route.ts). Trial Balance
// (app/api/reports/trial-balance/route.ts) uses this same type-aware convention now,
// so the two reports agree for every voucher type, not just JOURNAL.
// `accountId` is an AccountLedger.id, unless `isSelfAccount` — then it's a SelfAccount.id
// and the leg is read off selfAccountId/contraAccountId instead (debit-positive: an inflow
// to the cash/bank account is a Debit, matching gl-one and the Trial Balance).
function classify(
  tx: TxForClassify,
  accountId: string,
  isSelfAccount: boolean,
): { debit: number; credit: number; particulars: string } {
  const amount = Number(tx.amount || 0);
  let debit = 0;
  let credit = 0;
  let particulars = '';

  if (isSelfAccount) {
    if (tx.selfAccountId === accountId) {
      switch (tx.type) {
        case 'CASH_RECEIPT':
        case 'BANK_RECEIPT':
          debit = amount;
          particulars = tx.ledger?.ledgerName || 'Cash/Bank';
          break;
        case 'CASH_PAYMENT':
        case 'BANK_PAYMENT':
          credit = amount;
          particulars = tx.ledger?.ledgerName || 'Cash/Bank';
          break;
        case 'CONTRA':
          // selfAccountId is the receiving (debit) leg of a Contra voucher
          debit = amount;
          particulars = tx.contraAccount?.name || 'Contra';
          break;
        default:
          break;
      }
    } else if (tx.contraAccountId === accountId) {
      // paying (credit) leg of a Contra voucher
      credit = amount;
      particulars = tx.selfAccount?.name || 'Contra';
    }
    return { debit, credit, particulars };
  }

  const ledgerId = accountId;
  if (tx.ledgerId === ledgerId) {
    switch (tx.type) {
      case 'CASH_RECEIPT':
      case 'BANK_RECEIPT':
        credit = amount;
        particulars = tx.selfAccount?.name || 'Cash/Bank';
        break;
      case 'CASH_PAYMENT':
      case 'BANK_PAYMENT':
        debit = amount;
        particulars = tx.selfAccount?.name || 'Cash/Bank';
        break;
      case 'JOURNAL':
        debit = amount;
        particulars = tx.creditLedger?.ledgerName || 'UNKNOWN LEDGER';
        break;
      default:
        break;
    }
  } else if (tx.creditLedgerId === ledgerId) {
    // Only reachable for JOURNAL entries per the confirmed creation routes
    credit = amount;
    particulars = tx.ledger?.ledgerName || 'UNKNOWN LEDGER';
  }

  return { debit, credit, particulars };
}

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * Shared computation, used by the live GET below and by the Request-Queue
 * export adapter (app/lib/reports/report-registry.ts). `scopedBranchIds: null`
 * means unrestricted (already resolved by the caller). Throws (not error-response)
 * on a bad/missing ledger, matching the adapter-error convention used elsewhere
 * in report-registry.ts.
 */
export async function computeLedgerReport(params: {
  ledgerId: string;
  reportType: 'RANGE' | 'AS_ON';
  fromDateStr?: string | null;
  toDateStr?: string | null;
  asOnDateStr?: string | null;
  scopedBranchIds: string[] | null;
}) {
      const { ledgerId, reportType, fromDateStr, toDateStr, asOnDateStr, scopedBranchIds } = params;

      // Resolve the selection as an AccountLedger, or (mirrors gl-one) fall back to a
      // SelfAccount — the Ledger Report dropdown now offers both.
      let accountName: string;
      let isSelfAccount = false;
      const ledgerInfo = await prisma.accountLedger.findUnique({
        where: { id: ledgerId },
        select: { ledgerName: true },
      });
      if (ledgerInfo) {
        accountName = ledgerInfo.ledgerName;
      } else {
        const selfInfo = await prisma.selfAccount.findUnique({
          where: { id: ledgerId },
          select: { name: true },
        });
        if (!selfInfo) {
          throw new Error('Ledger not found');
        }
        accountName = selfInfo.name;
        isSelfAccount = true;
      }

      const branchScope = buildFinancialTransactionBranchScope({ branchId: scopedBranchIds ?? undefined });

      let fromDate: Date | null = null;
      let upperBound: Date;

      if (reportType === 'RANGE') {
        fromDate = new Date(fromDateStr as string);
        fromDate.setHours(0, 0, 0, 0);

        upperBound = new Date(toDateStr as string);
        upperBound.setHours(23, 59, 59, 999);
      } else {
        upperBound = new Date(asOnDateStr as string);
        upperBound.setHours(23, 59, 59, 999);
      }

      // The account leg and the branch filter are AND'd explicitly: both
      // buildFinancialTransactionBranchScope and the leg filter produce an `OR` key, so a
      // plain spread would let the branch `OR` clobber the leg `OR` (branch-filtered
      // reports would then ignore the selected account entirely).
      const accountLegFilter = isSelfAccount
        ? { OR: [{ selfAccountId: ledgerId }, { contraAccountId: ledgerId }] }
        : { OR: [{ ledgerId }, { creditLedgerId: ledgerId }] };
      const baseWhere = {
        AND: [accountLegFilter, branchScope],
        isActive: true,
        approvalStatus: 'APPROVED' as const,
      };

      const includeClause = {
        ledger: { select: { ledgerName: true } },
        creditLedger: { select: { ledgerName: true } },
        selfAccount: { select: { name: true } },
        contraAccount: { select: { name: true } },
        branch: { select: { name: true, code: true } },
        createdBy: { select: { branch: { select: { name: true, code: true } } } },
      };

      // Opening balance: only computed for RANGE mode (sum of everything before fromDate).
      // AS_ON mode has no stored master opening balance, so it is always 0 and every
      // transaction from the ledger's inception through asOnDate is listed as a row.
      let openingBalanceAmount = 0;
      if (reportType === 'RANGE' && fromDate) {
        // If a persisted LedgerOpeningBalance exists (openingDate <= fromDate), seed from
        // it and only sum transactions from openingDate forward — otherwise fall back to
        // summing every transaction since inception, exactly as before. Not one of the six
        // reports being integrated with the new per-branch opening-balance semantics — this
        // reproduces the prior cross-branch sum/earliest-date behavior on top of the new
        // per-branch-keyed service, unchanged.
        const branchContexts = await getBranchOpeningContext(scopedBranchIds);
        // A self account's persisted opening balance is read first from its own
        // SelfAccountOpeningBalance row (branch cash/bank position entered on the Opening
        // Balance page), then — for branches configured only that way — from its legacy
        // matching-named bridge ledger (Cash in Hand / Bank). A plain ledger reads its own row.
        let bridgeLedgerIdForSelf: string | null = null;
        if (isSelfAccount) {
          const bridges = await resolveSelfAccountBridges();
          bridgeLedgerIdForSelf =
            bridges.cashInHand?.selfAccountId === ledgerId ? bridges.cashInHand.bridgeLedgerId
            : bridges.bank?.selfAccountId === ledgerId ? bridges.bank.bridgeLedgerId
            : null;
        }
        let persistedOpeningDate: Date | null = null;
        let hasPersisted = false;
        for (const context of branchContexts.values()) {
          let amt: number | undefined;
          if (isSelfAccount) {
            const direct = context.selfAccountAmounts.get(ledgerId);
            amt = direct !== undefined
              ? direct
              : (bridgeLedgerIdForSelf ? context.ledgerAmounts.get(bridgeLedgerIdForSelf) : undefined);
          } else {
            amt = context.ledgerAmounts.get(ledgerId);
          }
          if (amt === undefined) continue;
          hasPersisted = true;
          openingBalanceAmount += amt;
          if (persistedOpeningDate === null || context.openingDate < persistedOpeningDate) {
            persistedOpeningDate = context.openingDate;
          }
        }
        const persisted = hasPersisted ? { openingDate: persistedOpeningDate as Date } : null;

        const pastTransactions = await prisma.financialTransaction.findMany({
          where: {
            ...baseWhere,
            transactionDate: persisted ? { gte: persisted.openingDate, lt: fromDate } : { lt: fromDate },
          },
          include: includeClause,
        });
        for (const tx of pastTransactions) {
          const { debit, credit } = classify(tx, ledgerId, isSelfAccount);
          openingBalanceAmount += debit - credit;
        }
      }

      const transactions = await prisma.financialTransaction.findMany({
        where: {
          ...baseWhere,
          transactionDate:
            reportType === 'AS_ON'
              ? { lte: upperBound }
              : { gte: fromDate as Date, lte: upperBound },
        },
        include: includeClause,
        orderBy: { transactionDate: 'asc' },
      });

      let runningBalance = openingBalanceAmount;
      const rows = transactions.map((tx) => {
        const { debit, credit, particulars } = classify(tx, ledgerId, isSelfAccount);
        runningBalance += debit - credit;

        const branchName = tx.branch
          ? `${tx.branch.code || ''} - ${tx.branch.name || ''}`.trim()
          : tx.createdBy?.branch
          ? `${tx.createdBy.branch.code || ''} - ${tx.createdBy.branch.name || ''}`.trim()
          : 'N/A';

        return {
          voucherDate: tx.transactionDate.toISOString(),
          branchName,
          particulars,
          narration: stripPostingMarker(tx.description),
          voucherType: tx.type,
          voucherTypeLabel: VOUCHER_TYPE_LABEL[tx.type] ?? tx.type,
          voucherNo: tx.voucherNo,
          debit,
          credit,
          balance: Math.abs(runningBalance),
          balanceType: runningBalance >= 0 ? 'Dr' : 'Cr',
          // Reference # is intentionally left blank; Reference Date is the voucher's
          // creation timestamp (not the business transactionDate, which can be backdated).
          referenceNo: '',
          referenceDate: tx.createdAt.toISOString(),
        };
      });

      const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
      const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);

      return {
        ledgerName: accountName,
        openingBalance: Math.abs(openingBalanceAmount),
        openingBalanceType: openingBalanceAmount >= 0 ? 'Dr' : 'Cr',
        rows,
        totalDebit,
        totalCredit,
        closingBalance: Math.abs(runningBalance),
        closingBalanceType: runningBalance >= 0 ? 'Dr' : 'Cr',
      };
}

export async function GET(req: NextRequest) {
  return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
      const { searchParams } = new URL(request.url);
      const ledgerId = searchParams.get('ledgerId');
      const reportType = (searchParams.get('reportType') || 'RANGE') as 'RANGE' | 'AS_ON';
      const fromDateStr = searchParams.get('fromDate');
      const toDateStr = searchParams.get('toDate');
      const asOnDateStr = searchParams.get('asOnDate');
      const branchIdParam = searchParams.get('branchId');
      // viewType (Condensed/Detailed) is intentionally not read here — the full field
      // set is always computed/returned and the client chooses which columns to render.

      if (!ledgerId) {
        return errorResponse('ledgerId is required', 400);
      }

      if (reportType === 'RANGE' && (!fromDateStr || !toDateStr)) {
        return errorResponse('fromDate and toDate are required for range reports', 400);
      }

      if (reportType === 'AS_ON' && !asOnDateStr) {
        return errorResponse('asOnDate is required for as-on-date reports', 400);
      }

      const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam ?? null);
      const result = await computeLedgerReport({ ledgerId, reportType, fromDateStr, toDateStr, asOnDateStr, scopedBranchIds });

      return successResponse(result);
    } catch (error: any) {
      console.error('Ledger report error:', error);
      return errorResponse(error.message || 'Failed to fetch ledger report data', 500);
    }
  })(req);
}
