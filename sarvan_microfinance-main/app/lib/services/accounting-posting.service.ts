import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';
import { GL_DEFAULT_GROUPS, GL_LEDGER_NAMES, GL_SELF_ACCOUNT_NAMES, buildFunderLedgerNames, getNextVoucherNo, resolveOrCreateLedger, resolveSelfAccount } from '@/app/lib/gl-config';
import { parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { SYSTEM_LEDGERS } from '@/app/lib/constants/ledgers';
import { buildEodClosureMarker, type ClosureType } from '@/app/lib/eod-closure-allocation';

type TransactionClient = Prisma.TransactionClient;

/**
 * Fee ledgers posted at final disbursement. Resolved by name via
 * resolveOrCreateLedger — these are expected to already exist in the DB
 * (Chart of Accounts: Income > Operating Income), so the name lookup finds
 * them directly. The auto-create fallback (flat root group) only fires if
 * they're genuinely missing and should be treated as a misconfiguration
 * signal, not the normal path.
 */
const FEE_LEDGER_NAMES = {
  ADMISSION_FEE: 'Admission & Training Charges',
  PROCESSING_FEE: 'Processing Fees',
} as const;
const FEE_LEDGER_GROUP = 'Operating Income';

/**
 * postIndexDisbursementAggregate's per-index posting-marker prefix, and the exact
 * descriptions of its funder-disbursement and fee-receipt legs. Exported so
 * app/lib/denomination-entry.ts's cash reconciliation (getFinancialNetCashForDay)
 * can tell these legs apart from the aggregate's HO Borrow leg:
 *   - Funder-disbursement (CASH_PAYMENT) and Admission/Processing/Insurance fee
 *     (CASH_RECEIPT) legs duplicate cash already tracked via the underlying
 *     LoanTransaction rows (todayDisbursement / todayCollection there) — must
 *     stay EXCLUDED from that file's own cash total, or the amount double-counts.
 *   - HO Borrow has no LoanTransaction equivalent at all — it's the branch's only
 *     record of that cash arriving — and must stay INCLUDED there. It always
 *     equals the same-batch disbursement total by construction (see step 1/2
 *     below), so omitting it doesn't zero out on its own; it silently understates
 *     the expected denomination total by the HO Borrow amount.
 * Keep these literals in sync with their actual use below and with
 * buildIndexDisbursementMarker.
 */
export const INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX = '[POSTING:INDEX_DISBURSEMENT:';
export const INDEX_DISBURSEMENT_FUNDER_LEG_DESCRIPTION_PREFIX = 'For Loan Disbursement Loan Index ID :';
export const INDEX_DISBURSEMENT_FEE_LEG_DESCRIPTIONS = {
  ADMISSION_FEE: 'Being amount received admission fees',
  PROCESSING_FEE: 'Processing Fees for Loan Disbursement',
  INSURANCE_FEE: 'Being amount received insurance fees',
} as const;
export const INDEX_DISBURSEMENT_DUPLICATE_FEE_DESCRIPTIONS: readonly string[] = Object.values(INDEX_DISBURSEMENT_FEE_LEG_DESCRIPTIONS);

/**
 * postEodFunderAllocation's per-funder/date posting-marker prefix. Unlike
 * postIndexDisbursementAggregate above, every leg this method creates echoes a
 * collection/preclosure/write-off already counted via todayCollection on the day
 * it actually happened (which can differ from the day the EOD allocation itself
 * runs), so app/lib/denomination-entry.ts blanket-excludes any row carrying this
 * marker from its cash reconciliation.
 */
export const EOD_FUNDER_POSTING_MARKER_PREFIX = '[POSTING:EOD_FUNDER:';

/**
 * postSavingsRefundPayment's per-request posting-marker prefix. Unlike the EOD_*
 * markers above, this leg is NOT a same-day echo of anything else — it's the ONLY
 * record of this specific cash outflow, so app/lib/denomination-entry.ts must
 * always include it in the day's cash-out total (never exclude it as a GL echo).
 * The paired LoanTransaction(type SAVINGS_REFUND) is a business-domain record
 * only; denomination-entry.ts deliberately does NOT sum it directly, because it
 * and this voucher aren't guaranteed to share the same `transactionDate` (e.g. a
 * refund request re-approved on a different day than a stale still-active voucher
 * from an earlier attempt) — relying on that same-day assumption previously made
 * the refund's cash impact vanish from EOD math entirely when the dates diverged.
 * Reading the voucher directly (like the Daybook already does) is robust regardless.
 */
export const SAVINGS_REFUND_POSTING_MARKER_PREFIX = '[POSTING:SAVINGS_REFUND:';

/** Thrown by postEodClosureAllocation when a concurrent "Allocate for EOD" click already
 *  claimed some of the same transactions — see the comment at its throw site. */
export class ClosureAllocationConflictError extends Error {}

export class AccountingPostingService {
  private static readonly EOD_COLLECTION_MARKER_PREFIX = '[POSTING:EOD_COLLECTION:';
  private static readonly EOD_LOAN_ADVANCE_MARKER_PREFIX = '[POSTING:EOD_LOAN_ADVANCE:';
  // These two reuse the module-level exports above (rather than their own literal) so
  // app/lib/denomination-entry.ts's cash reconciliation can never drift out of sync with
  // the marker this class actually writes.
  private static readonly INDEX_DISBURSEMENT_MARKER_PREFIX = INDEX_DISBURSEMENT_POSTING_MARKER_PREFIX;
  private static readonly EOD_FUNDER_MARKER_PREFIX = EOD_FUNDER_POSTING_MARKER_PREFIX;
  private static readonly SAVINGS_REFUND_MARKER_PREFIX = SAVINGS_REFUND_POSTING_MARKER_PREFIX;

  /** Tags every voucher postIndexDisbursementAggregate creates for a given index,
   *  so a revert can find and deactivate exactly this index's disbursement vouchers
   *  regardless of how many other centers/indexes posted on the same branch/day. */
  private static buildIndexDisbursementMarker(indexId: string): string {
    return `${this.INDEX_DISBURSEMENT_MARKER_PREFIX}${indexId}]`;
  }

  /** One bucket per funder/date — Gold and Normal collections for the same funder share this
   *  marker (gold is a loan-type flag, not a separate funder; see buildFunderLabel in gl-config.ts). */
  private static buildEodCollectionMarker(branchId: string, workingDateYmd: string, funderKey: string): string {
    return `${this.EOD_COLLECTION_MARKER_PREFIX}${branchId}:${workingDateYmd}:${funderKey}]`;
  }

  /** Branch/date-wide — unlike the collection marker, this is NOT split by funder or gold/normal:
   *  Loan Advance posts into a single shared LOAN ADVANCE ledger regardless of who financed the
   *  loan, so it's allocated/reverted as one bucket for the whole day (see
   *  postEodLoanAdvanceAllocation and the dedicated /loan-advance routes). */
  private static buildEodLoanAdvanceMarker(branchId: string, workingDateYmd: string): string {
    return `${this.EOD_LOAN_ADVANCE_MARKER_PREFIX}${branchId}:${workingDateYmd}]`;
  }

  /** Same funder/date key convention as buildEodCollectionMarker / buildEodClosureMarker —
   *  used by postEodFunderAllocation, which merges REPAYMENT + PRECLOSURE + WRITEOFF into one
   *  voucher pair per funder/date instead of one pair per type. */
  private static buildEodFunderMarker(branchId: string, workingDateYmd: string, funderKey: string): string {
    return `${this.EOD_FUNDER_MARKER_PREFIX}${branchId}:${workingDateYmd}:${funderKey}]`;
  }

  /** One bucket per refund request — used by postSavingsRefundPayment. Written to the
   *  `postingMarker` column (not `description`), so it needs no entry in
   *  app/lib/actions/reports.ts's GL_SHADOW_DESCRIPTION_MARKERS (the voucher is meant to be
   *  visible in the Day Book, sourced generically via finMap). See SAVINGS_REFUND_POSTING_MARKER_PREFIX
   *  above — app/lib/denomination-entry.ts's getFinancialCashFlowForDay explicitly INCLUDES this
   *  marker (never excludes it as a GL echo), unlike EOD_FUNDER/EOD_COLLECTION/etc. */
  private static buildSavingsRefundMarker(refundRequestId: string): string {
    return `${this.SAVINGS_REFUND_MARKER_PREFIX}${refundRequestId}]`;
  }

  /**
   * Creates a single auto-approved FinancialTransaction leg (with its
   * TransactionApprovalHistory row). `description` is stored exactly as
   * given — callers needing to find this voucher again later (e.g. for a
   * revert) should pass `postingMarker` rather than embedding a tag in
   * `description`, since `description` is rendered as-is on every GL report
   * (Trial Balance, GL-One/All, Ledger Report, Day Book, voucher print).
   */
  private async createOrGetAutoApprovedTransaction(params: {
    tx: TransactionClient;
    type: 'CASH_RECEIPT' | 'CASH_PAYMENT';
    voucherPrefix: 'CR' | 'CP';
    branchId: string;
    selfAccountId: string | null;
    ledgerId?: string;
    amount: number;
    description: string;
    postingMarker?: string;
    createdById: string;
    createdByRole: string;
    transactionDate: Date;
    approvalRemarks: string;
  }): Promise<string> {
    const voucherNo = await getNextVoucherNo(params.tx as never, params.voucherPrefix);
    const created = await params.tx.financialTransaction.create({
      data: {
        voucherNo,
        transactionDate: params.transactionDate,
        type: params.type,
        branchId: params.branchId,
        selfAccountId: params.selfAccountId,
        ledgerId: params.ledgerId,
        amount: new Decimal(params.amount),
        description: params.description,
        postingMarker: params.postingMarker,
        createdById: params.createdById,
        approvalStatus: 'APPROVED',
        createdByRole: params.createdByRole,
      },
      select: { id: true, voucherNo: true },
    });

    await params.tx.transactionApprovalHistory.create({
      data: {
        transactionId: created.id,
        action: 'AUTO_APPROVED',
        performedById: params.createdById,
        previousStatus: 'PENDING_APPROVAL',
        newStatus: 'APPROVED',
        remarks: params.approvalRemarks,
      },
    });

    console.log(`[AccountingPostingService] Bulk posting created: ${created.voucherNo} | ₹${params.amount} | ${params.description.slice(0, 80)}`);
    return created.voucherNo;
  }

  /**
   * Aggregates every loan currently DISBURSED under a given LoanIndex into a
   * single set of bulk accounting vouchers instead of one voucher per loan:
   *   - one CASH_RECEIPT HO Borrow leg (total)
   *   - one CASH_PAYMENT per distinct final funder (Gold and Normal loans from the same
   *     funder combine into one leg — gold is a loan-type flag, not a separate funder)
   *   - one CASH_RECEIPT Admission Fees leg (total, if any)
   *   - one CASH_RECEIPT Processing Fees leg (total, if any)
   *   - one CASH_RECEIPT Insurance Fees leg (total, if any)
   *
   * Sources amounts by re-querying the DB (Loan + LoanTransaction rows already
   * written for this index) rather than from caller-held totals, so this
   * always reflects "everything currently DISBURSED under this index." Not
   * idempotent — calling it twice for the same index creates duplicate
   * vouchers, so callers must not invoke it more than once per disbursement
   * without first deactivating the prior set (see app/api/disbursements/revert,
   * which reverts a whole index's disbursement atomically). Every voucher's
   * `postingMarker` column (not `description` — kept clean for GL reports) is
   * set to `[POSTING:INDEX_DISBURSEMENT:{indexId}]` (buildIndexDisbursementMarker)
   * so that revert flow can find exactly this index's active vouchers.
   */
  async postIndexDisbursementAggregate(params: {
    tx: TransactionClient;
    indexId: string;
    branchId: string;
    centerCode: string;
    centerName: string;
    createdById: string;
    createdByRole: string;
    transactionDate: Date;
    /** Restrict the aggregate to these loans (a partial-day disbursement where absent members
     *  are disbursed later). Omit to aggregate every DISBURSED loan in the index. */
    loanIds?: string[];
  }): Promise<{ voucherNos: string[] }> {
    const voucherNos: string[] = [];
    const indexMarker = AccountingPostingService.buildIndexDisbursementMarker(params.indexId);

    const loans = await params.tx.loan.findMany({
      where: {
        indexId: params.indexId,
        disbursementStatus: 'DISBURSED',
        ...(params.loanIds ? { id: { in: params.loanIds } } : {}),
      },
      select: {
        id: true,
        loanNumber: true,
        amount: true,
        funderId: true,
        funder: { select: { funderName: true } },
        loanProduct: { select: { loanProductType: { select: { name: true } } } },
      },
    });

    if (loans.length === 0) {
      return { voucherNos };
    }

    const loanIds = loans.map((l) => l.id);
    const feeTxns = await params.tx.loanTransaction.findMany({
      where: {
        loanId: { in: loanIds },
        type: 'FEE',
        status: 'APPROVED',
        isReversed: false,
      },
      select: { description: true, amount: true },
    });

    const totalDisbursed = loans.reduce((sum, l) => sum + Number(l.amount), 0);
    const totalAdmissionFee = feeTxns
      .filter((t) => t.description === 'Client Admission Fee')
      .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
    const totalProcessingFee = feeTxns
      .filter((t) => t.description === SYSTEM_LEDGERS.DOC_CHARGES.name)
      .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
    const totalInsuranceFee = feeTxns
      .filter((t) => t.description === SYSTEM_LEDGERS.INSURANCE_PAYABLE.name)
      .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);

    // Grouped by funder only — Gold and Normal loans from the same funder post one combined
    // disbursement leg (gold is a loan-type flag, not a separate funder; see buildFunderLabel
    // in app/lib/gl-config.ts).
    const funderGroups = new Map<string, { funderName: string | null; amount: number; loanNumbers: string[] }>();
    for (const loan of loans) {
      const funderKey = loan.funderId ?? 'OWN';
      const existing = funderGroups.get(funderKey);
      if (existing) {
        existing.amount += Number(loan.amount);
        existing.loanNumbers.push(loan.loanNumber);
      } else {
        funderGroups.set(funderKey, {
          funderName: loan.funder?.funderName ?? null,
          amount: Number(loan.amount),
          loanNumbers: [loan.loanNumber],
        });
      }
    }

    let centerSelfAccountId = await resolveSelfAccount(params.tx as never, params.centerName, { autoCreate: false });
    if (!centerSelfAccountId) {
      console.log(`[AccountingPostingService] No Self Account found for center "${params.centerName}" — falling back to Cash in Hand`);
      centerSelfAccountId = await resolveSelfAccount(params.tx as never, GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
    }

    // 1. Bulk HO Borrow leg
    if (totalDisbursed > 0) {
      const hoBorrowLedgerId = await resolveOrCreateLedger(params.tx as never, GL_LEDGER_NAMES.HO_BORROW, GL_DEFAULT_GROUPS.LIABILITIES);
      const voucherNo = await this.createOrGetAutoApprovedTransaction({
        tx: params.tx,
        type: 'CASH_RECEIPT',
        voucherPrefix: 'CR',
        branchId: params.branchId,
        selfAccountId: centerSelfAccountId,
        ledgerId: hoBorrowLedgerId,
        amount: totalDisbursed,
        description: `${params.centerCode} - ${params.centerName} (Members: ${loans.length})`,
        postingMarker: indexMarker,
        createdById: params.createdById,
        createdByRole: params.createdByRole,
        transactionDate: params.transactionDate,
        approvalRemarks: 'System-generated bulk HO Borrow leg (final disbursement).',
      });
      voucherNos.push(voucherNo);
    }

    // 2. Per-funder-group disbursement ledger leg
    for (const [, group] of funderGroups) {
      if (group.amount <= 0) continue;
      const disbursementLedgerName = buildFunderLedgerNames(group.funderName, false).principal;
      const disbursementLedgerId = await resolveOrCreateLedger(params.tx as never, disbursementLedgerName, GL_DEFAULT_GROUPS.ASSETS);
      const loanNumbersCsv = group.loanNumbers
        .map((n) => parseInt(n, 10).toString())
        .sort((a, b) => Number(a) - Number(b))
        .join(',');
      const voucherNo = await this.createOrGetAutoApprovedTransaction({
        tx: params.tx,
        type: 'CASH_PAYMENT',
        voucherPrefix: 'CP',
        branchId: params.branchId,
        selfAccountId: centerSelfAccountId,
        ledgerId: disbursementLedgerId,
        amount: group.amount,
        description: `${INDEX_DISBURSEMENT_FUNDER_LEG_DESCRIPTION_PREFIX} ${loanNumbersCsv} (Members: ${group.loanNumbers.length})`,
        postingMarker: indexMarker,
        createdById: params.createdById,
        createdByRole: params.createdByRole,
        transactionDate: params.transactionDate,
        approvalRemarks: `System-generated bulk funder disbursement leg (${disbursementLedgerName}).`,
      });
      voucherNos.push(voucherNo);
    }

    // 3. Bulk Admission Fees leg
    if (totalAdmissionFee > 0) {
      const admissionFeeLedgerId = await resolveOrCreateLedger(params.tx as never, FEE_LEDGER_NAMES.ADMISSION_FEE, FEE_LEDGER_GROUP);
      const voucherNo = await this.createOrGetAutoApprovedTransaction({
        tx: params.tx,
        type: 'CASH_RECEIPT',
        voucherPrefix: 'CR',
        branchId: params.branchId,
        selfAccountId: centerSelfAccountId,
        ledgerId: admissionFeeLedgerId,
        amount: totalAdmissionFee,
        description: INDEX_DISBURSEMENT_FEE_LEG_DESCRIPTIONS.ADMISSION_FEE,
        postingMarker: indexMarker,
        createdById: params.createdById,
        createdByRole: params.createdByRole,
        transactionDate: params.transactionDate,
        approvalRemarks: 'System-generated bulk admission fee receipt (final disbursement).',
      });
      voucherNos.push(voucherNo);
    }

    // 4. Bulk Processing Fees leg
    if (totalProcessingFee > 0) {
      const processingFeeLedgerId = await resolveOrCreateLedger(params.tx as never, FEE_LEDGER_NAMES.PROCESSING_FEE, FEE_LEDGER_GROUP);
      const voucherNo = await this.createOrGetAutoApprovedTransaction({
        tx: params.tx,
        type: 'CASH_RECEIPT',
        voucherPrefix: 'CR',
        branchId: params.branchId,
        selfAccountId: centerSelfAccountId,
        ledgerId: processingFeeLedgerId,
        amount: totalProcessingFee,
        description: INDEX_DISBURSEMENT_FEE_LEG_DESCRIPTIONS.PROCESSING_FEE,
        postingMarker: indexMarker,
        createdById: params.createdById,
        createdByRole: params.createdByRole,
        transactionDate: params.transactionDate,
        approvalRemarks: 'System-generated bulk processing fee receipt (final disbursement).',
      });
      voucherNos.push(voucherNo);
    }

    // 5. Bulk Insurance Fees leg — collected in cash from the borrower alongside
    // admission/processing fees, but payable onward to the insurer, so it posts
    // as a Current Liability rather than Operating Income.
    if (totalInsuranceFee > 0) {
      const insuranceFeeLedgerId = await resolveOrCreateLedger(params.tx as never, SYSTEM_LEDGERS.INSURANCE_PAYABLE.name, GL_DEFAULT_GROUPS.LIABILITIES);
      const voucherNo = await this.createOrGetAutoApprovedTransaction({
        tx: params.tx,
        type: 'CASH_RECEIPT',
        voucherPrefix: 'CR',
        branchId: params.branchId,
        selfAccountId: centerSelfAccountId,
        ledgerId: insuranceFeeLedgerId,
        amount: totalInsuranceFee,
        description: INDEX_DISBURSEMENT_FEE_LEG_DESCRIPTIONS.INSURANCE_FEE,
        postingMarker: indexMarker,
        createdById: params.createdById,
        createdByRole: params.createdByRole,
        transactionDate: params.transactionDate,
        approvalRemarks: 'System-generated bulk insurance fee receipt (final disbursement).',
      });
      voucherNos.push(voucherNo);
    }

    return { voucherNos };
  }

  /**
   * "Allocate for EOD" — posts a funder's approved same-day collections as Cash Receipt
   * vouchers: Dr Cash in Hand / Cr "{Funder} PRINCIPAL" (auto-created if missing) and /
   * Cr "{Funder} INTEREST", per the standard collection GL reference in ledgers.ts. Gold
   * and Normal loans for the same funder/date share the same ledgers and allocation bucket —
   * gold is a loan-type flag, not a separate funder (see buildFunderLabel in gl-config.ts).
   * Idempotent per branch+date+funder via a marker embedded in the description.
   */
  async postEodCollectionAllocation(params: {
    tx: TransactionClient;
    branchId: string;
    workingDateYmd: string;
    funderId: string | null;
    funderName: string;
    principalAmount: number;
    interestAmount: number;
    transactionDate: Date;
    createdById: string;
    createdByRole: string;
    /** LoanTransaction ids being covered by this posting — stamped with eodAllocatedAt so the
     *  EOD allocation tab can track pending/allocated per-transaction (e.g. a per-row
     *  "Allocate for EOD" click covering just one client, instead of the whole funder/date). */
    transactionIds: string[];
  }): Promise<{ posted: boolean; voucherNos: string[]; message?: string }> {
    const funderKey = params.funderId ?? 'OWN';
    const marker = AccountingPostingService.buildEodCollectionMarker(params.branchId, params.workingDateYmd, funderKey);
    const ledgerNames = buildFunderLedgerNames(params.funderName, false);

    // The caller (POST /api/collections/eod-allocation) already scopes params.principalAmount /
    // interestAmount to transactions with eodAllocatedAt = null — i.e. money that is NOT yet
    // covered by any prior "Allocate for EOD" click, whether that's the whole funder/date
    // (footer button) or a single client (per-row button). So the amount handed to us here is
    // already the delta; it must NOT be netted against every historical posting under this
    // marker, or one client's click nets out against a different client's already-tagged/posted
    // amount (see incident: allocating client A, then client B, wrongly reported "already
    // allocated" because B's request got reduced by A's posted total).
    //
    // The only amount that legitimately still needs netting out is "legacy residual" — postings
    // that predate per-transaction eodAllocatedAt tagging (this field), where the marker's total
    // is real GL history but no transaction was ever tagged for it. Compute that residual as
    // marker total minus what's explained by currently-tagged transactions, and net only that.
    const dayStartUtc = parseKolkataAttendanceDateYmd(params.workingDateYmd);
    const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);
    const [existingPostings, candidateTaggedTx] = await Promise.all([
      params.tx.financialTransaction.findMany({
        where: { description: { contains: marker, mode: 'insensitive' }, isActive: true },
        select: { id: true, voucherNo: true, description: true, amount: true },
      }),
      params.tx.loanTransaction.findMany({
        where: {
          branchId: params.branchId,
          type: 'REPAYMENT',
          status: 'APPROVED',
          isReversed: false,
          eodAllocatedAt: { not: null },
          transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
          loan: params.funderId ? { funderId: params.funderId } : { funderId: null },
        },
        select: {
          principalAmount: true,
          interestAmount: true,
        },
      }),
    ]);
    let markerPostedPrincipal = 0;
    let markerPostedInterest = 0;
    for (const posting of existingPostings) {
      if (posting.description?.includes(`${marker} ${ledgerNames.principal}`)) {
        markerPostedPrincipal += Number(posting.amount || 0);
      } else if (posting.description?.includes(`${marker} ${ledgerNames.interest}`)) {
        markerPostedInterest += Number(posting.amount || 0);
      }
    }
    // Gold and Normal loans for this funder/date share this marker/bucket — no product-type
    // filtering needed here anymore (see buildFunderLabel in gl-config.ts).
    const taggedTx = candidateTaggedTx;
    const taggedPrincipal = taggedTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0);
    const taggedInterest = taggedTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0);
    const legacyResidualPrincipal = Math.max(0, markerPostedPrincipal - taggedPrincipal);
    const legacyResidualInterest = Math.max(0, markerPostedInterest - taggedInterest);

    const principalToPost = Number((params.principalAmount - legacyResidualPrincipal).toFixed(2));
    const interestToPost = Number((params.interestAmount - legacyResidualInterest).toFixed(2));

    if (principalToPost <= 0 && interestToPost <= 0) {
      return { posted: false, voucherNos: [], message: 'Already allocated for this funder/date' };
    }

    const cashSelfAccountId = await resolveSelfAccount(params.tx as never, GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
    // Always auto-approved, regardless of who clicked "Allocate for EOD" — unlike a manual
    // voucher, this is a system-computed aggregate of individual collections that already went
    // through their own maker-checker approval (Collection Approval workbench) before they were
    // even eligible for allocation, so a second 3-level GL approval on top would be redundant.
    const approvalStatus = 'APPROVED';
    const voucherNos: string[] = [];

    // Fold a delta into the single active voucher this marker+ledger already has, rather than
    // creating a new CASH_RECEIPT row per "Allocate for EOD" click — a funder/date/loan-type
    // must never show more than one active Principal (and one Interest) receipt. If more than
    // one active voucher already exists for this marker+ledger (duplicates from before this
    // fix), self-heal: fold every duplicate's amount into the first and deactivate the rest.
    const foldIntoSingleVoucher = async (
      matchingText: string,
      deltaToPost: number,
      ledgerId: string,
      voucherDescription: string
    ): Promise<string> => {
      const existingVouchers = existingPostings.filter((p) => p.description?.includes(matchingText));
      if (existingVouchers.length > 0) {
        const [keep, ...duplicates] = existingVouchers;
        const consolidatedAmount = Number(
          (existingVouchers.reduce((s, p) => s + Number(p.amount || 0), 0) + deltaToPost).toFixed(2)
        );
        if (duplicates.length > 0) {
          await params.tx.financialTransaction.updateMany({
            where: { id: { in: duplicates.map((d) => d.id) } },
            data: { isActive: false },
          });
        }
        await params.tx.financialTransaction.update({
          where: { id: keep.id },
          data: { amount: new Decimal(consolidatedAmount) },
        });
        return keep.voucherNo;
      }

      const voucherNo = await getNextVoucherNo(params.tx as never, 'CR');
      await params.tx.financialTransaction.create({
        data: {
          voucherNo,
          transactionDate: params.transactionDate,
          type: 'CASH_RECEIPT',
          branchId: params.branchId,
          selfAccountId: cashSelfAccountId,
          ledgerId,
          amount: new Decimal(deltaToPost),
          description: voucherDescription,
          createdById: params.createdById,
          approvalStatus: approvalStatus as never,
          createdByRole: params.createdByRole,
        },
      });
      return voucherNo;
    };

    if (principalToPost > 0) {
      const principalLedgerId = await resolveOrCreateLedger(
        params.tx as never,
        ledgerNames.principal,
        GL_DEFAULT_GROUPS.ASSETS
      );
      const voucherNo = await foldIntoSingleVoucher(
        `${marker} ${ledgerNames.principal}`,
        principalToPost,
        principalLedgerId,
        `${marker} ${ledgerNames.principal}\n\nEOD Principal Amount Collected on ${params.workingDateYmd}`
      );
      voucherNos.push(voucherNo);
    }

    if (interestToPost > 0) {
      const interestLedgerId = await resolveOrCreateLedger(
        params.tx as never,
        ledgerNames.interest,
        GL_DEFAULT_GROUPS.INCOME
      );
      const voucherNo = await foldIntoSingleVoucher(
        `${marker} ${ledgerNames.interest}`,
        interestToPost,
        interestLedgerId,
        `${marker} ${ledgerNames.interest}\n\nEOD Interest Amount Collected on ${params.workingDateYmd}`
      );
      voucherNos.push(voucherNo);
    }

    if (params.transactionIds.length > 0) {
      await params.tx.loanTransaction.updateMany({
        where: { id: { in: params.transactionIds } },
        data: { eodAllocatedAt: new Date() },
      });
    }

    return { posted: true, voucherNos };
  }

  /**
   * "Allocate for EOD" (Pre-Closure / Loan Closing) — posts the cash-collected portion of an
   * approved PRECLOSURE or WRITEOFF LoanTransaction as Cash Receipt vouchers, using the same
   * funder ledgers REPAYMENT uses (a pre-closure or write-off's paid portion is economically
   * identical to a normal repayment — cash reducing that funder's outstanding principal/interest).
   * Unlike postEodCollectionAllocation, there is no legacy-residual netting here — this is a
   * greenfield path with no pre-existing "posted but untagged" history, so the caller's
   * principal/interest amounts (already scoped to eodAllocatedAt:null, isGlSynced:false rows via
   * pendingClosureAllocationWhere) are posted exactly as given.
   *
   * Pure GL-voucher posting — same shape as postEodCollectionAllocation. The loan itself is
   * finalized earlier, at approval/creation time (see finalizeClosureCoveredLoan in
   * app/lib/foreclosure-workflow.ts, called from the Foreclosure approve route and the Loan
   * Write-Off/Death Closure creation route), exactly like a REPAYMENT collection's balances are
   * updated at approval rather than at allocation. Waiver amounts (WRITEOFF's
   * principalWaiver/interestWaiver) get no GL leg — they stay audit-only in LoanClosureRecord.
   */
  async postEodClosureAllocation(params: {
    tx: TransactionClient;
    branchId: string;
    workingDateYmd: string;
    funderId: string | null;
    funderName: string;
    principalAmount: number;
    interestAmount: number;
    transactionDate: Date;
    createdById: string;
    createdByRole: string;
    closureType: ClosureType;
    /** LoanTransaction ids being covered by this posting — stamped with eodAllocatedAt. */
    transactionIds: string[];
  }): Promise<{ posted: boolean; voucherNos: string[]; finalizedLoanIds: string[]; message?: string }> {
    const principalToPost = Number(params.principalAmount.toFixed(2));
    const interestToPost = Number(params.interestAmount.toFixed(2));

    if (principalToPost <= 0 && interestToPost <= 0) {
      return { posted: false, voucherNos: [], finalizedLoanIds: [], message: 'Nothing to allocate' };
    }

    // Atomically claim the covered transactions before posting anything. Unlike
    // postEodCollectionAllocation, this method has no legacy-residual netting to fall back on to
    // absorb a double-click, so the WHERE clause requiring eodAllocatedAt:null doubles as the
    // concurrency guard: under Read Committed, two simultaneous allocation attempts reading the
    // same untagged rows could otherwise both post a voucher for the same money. If a concurrent
    // request already claimed some of these ids, the updated count comes back short and this
    // throws to roll back the whole transaction — including this partial claim — rather than risk
    // stamping eodAllocatedAt on rows with no corresponding voucher.
    if (params.transactionIds.length > 0) {
      const claimed = await params.tx.loanTransaction.updateMany({
        where: { id: { in: params.transactionIds }, eodAllocatedAt: null },
        data: { eodAllocatedAt: new Date() },
      });
      if (claimed.count !== params.transactionIds.length) {
        throw new ClosureAllocationConflictError(
          'Some of these transactions were already allocated by a concurrent request — refresh and try again'
        );
      }
    }

    const funderKey = params.funderId ?? 'OWN';
    const marker = buildEodClosureMarker(params.branchId, params.workingDateYmd, funderKey, params.closureType);
    const ledgerNames = buildFunderLedgerNames(params.funderName, false);
    const cashSelfAccountId = await resolveSelfAccount(params.tx as never, GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
    // Always auto-approved — same reasoning as postEodCollectionAllocation: the underlying
    // transaction already went through its own maker-checker approval before being eligible here.
    const approvalStatus = 'APPROVED';
    const voucherNos: string[] = [];
    const closureLabel = params.closureType === 'PRECLOSURE' ? 'Pre-closure' : 'Write-Off Closure';

    if (principalToPost > 0) {
      const principalLedgerId = await resolveOrCreateLedger(
        params.tx as never,
        ledgerNames.principal,
        GL_DEFAULT_GROUPS.ASSETS
      );
      const voucherNo = await getNextVoucherNo(params.tx as never, 'CR');
      await params.tx.financialTransaction.create({
        data: {
          voucherNo,
          transactionDate: params.transactionDate,
          type: 'CASH_RECEIPT',
          branchId: params.branchId,
          selfAccountId: cashSelfAccountId,
          ledgerId: principalLedgerId,
          amount: new Decimal(principalToPost),
          description: `${marker} ${ledgerNames.principal}\n\nEOD ${closureLabel} Principal Amount Collected on ${params.workingDateYmd}`,
          createdById: params.createdById,
          approvalStatus: approvalStatus as never,
          createdByRole: params.createdByRole,
        },
      });
      voucherNos.push(voucherNo);
    }

    if (interestToPost > 0) {
      const interestLedgerId = await resolveOrCreateLedger(
        params.tx as never,
        ledgerNames.interest,
        GL_DEFAULT_GROUPS.INCOME
      );
      const voucherNo = await getNextVoucherNo(params.tx as never, 'CR');
      await params.tx.financialTransaction.create({
        data: {
          voucherNo,
          transactionDate: params.transactionDate,
          type: 'CASH_RECEIPT',
          branchId: params.branchId,
          selfAccountId: cashSelfAccountId,
          ledgerId: interestLedgerId,
          amount: new Decimal(interestToPost),
          description: `${marker} ${ledgerNames.interest}\n\nEOD ${closureLabel} Interest Amount Collected on ${params.workingDateYmd}`,
          createdById: params.createdById,
          approvalStatus: approvalStatus as never,
          createdByRole: params.createdByRole,
        },
      });
      voucherNos.push(voucherNo);
    }

    // eodAllocatedAt was already stamped by the claim step above, before the vouchers were
    // created — see the comment there. The covered loan(s) were already finalized at
    // approval/creation time (see finalizeClosureCoveredLoan in app/lib/foreclosure-workflow.ts) —
    // nothing left to do to the loan here.

    return { posted: true, voucherNos, finalizedLoanIds: [] };
  }

  /**
   * "Allocate for EOD" — merged funder voucher. Combines every pending Demand/Advance/Arrear
   * (REPAYMENT), Pre-Closure (PRECLOSURE), and Loan Closing (WRITEOFF) collection for one
   * funder/date (Gold and Normal loans share the same bucket) into a single principal voucher
   * + single interest voucher, instead of
   * a separate voucher pair per type (postEodCollectionAllocation / postEodClosureAllocation).
   * Requested explicitly by the business to reduce a funder's day to two GL entries.
   *
   * The marker is written to the `postingMarker` column (not embedded in `description` — see the
   * doc comment on that Prisma field), so the description stays clean, breakdown-formatted text
   * (Collection / Pre-Closed / Closed Loan subtotals) instead of carrying the lookup tag. EOD
   * Allocation Revert (app/api/collections/eod-allocation/revert/route.ts) looks vouchers up by
   * this exact `postingMarker` to revert them — pure GL cleanup, deactivating the voucher and
   * un-tagging the covered transactions. Any covered PRECLOSURE/WRITEOFF loan was already
   * finalized (closed) at approval/creation time, before this posting ever ran — see
   * finalizeClosureCoveredLoan in app/lib/foreclosure-workflow.ts — so there's no loan state for
   * this posting or its revert to touch; undoing the loan closure itself is the separate Delete
   * Foreclosure / Loan Closure Revert pages' job, gated on `eodAllocatedAt` being clear.
   *
   * No legacy-residual netting — this marker has no posting history predating this method, so
   * the caller's transactionIds (already scoped to eodAllocatedAt: null) are posted exactly as
   * given. The atomic claim below is the only safety net needed against a concurrent double-click.
   */
  async postEodFunderAllocation(params: {
    tx: TransactionClient;
    branchId: string;
    workingDateYmd: string;
    funderId: string | null;
    funderName: string;
    transactionDate: Date;
    createdById: string;
    createdByRole: string;
    /** Every pending LoanTransaction id (REPAYMENT + PRECLOSURE + WRITEOFF) to cover in this
     *  single funder/date voucher — already scoped to eodAllocatedAt: null by the caller. */
    transactionIds: string[];
  }): Promise<{ posted: boolean; voucherNos: string[]; finalizedLoanIds: string[]; message?: string }> {
    if (params.transactionIds.length === 0) {
      return { posted: false, voucherNos: [], finalizedLoanIds: [], message: 'Nothing to allocate' };
    }

    // Atomically claim every covered transaction before posting anything — same concurrency
    // guard as postEodClosureAllocation (no legacy-residual netting here to fall back on).
    const claimed = await params.tx.loanTransaction.updateMany({
      where: { id: { in: params.transactionIds }, eodAllocatedAt: null },
      data: { eodAllocatedAt: new Date() },
    });
    if (claimed.count !== params.transactionIds.length) {
      throw new ClosureAllocationConflictError(
        'Some of these transactions were already allocated by a concurrent request — refresh and try again'
      );
    }

    const coveredTx = await params.tx.loanTransaction.findMany({
      where: { id: { in: params.transactionIds } },
      select: { id: true, loanId: true, type: true, principalAmount: true, interestAmount: true },
    });

    const funderKey = params.funderId ?? 'OWN';
    const marker = AccountingPostingService.buildEodFunderMarker(params.branchId, params.workingDateYmd, funderKey);
    const ledgerNames = buildFunderLedgerNames(params.funderName, false);
    const cashSelfAccountId = await resolveSelfAccount(params.tx as never, GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
    // Always auto-approved — same reasoning as the other EOD allocation postings: every covered
    // transaction already went through its own maker-checker approval before being eligible here.
    const approvalStatus = 'APPROVED';
    const voucherNos: string[] = [];

    // Normally this marker has exactly one active voucher (the API route blocks a second
    // "Allocate for EOD" click while one is active — see /api/collections/eod-allocation
    // POST). If one is somehow already active (a double-submit race, or a duplicate left over
    // from before this guard existed), fold it in: recompute the FULL total from every
    // transaction currently tagged under this marker's key (not just this call's freshly
    // claimed batch) and consolidate onto a single voucher instead of layering another one on
    // top of it.
    const existingMarkerVouchers = await params.tx.financialTransaction.findMany({
      where: { postingMarker: marker, isActive: true },
      select: { id: true, voucherNo: true, ledgerId: true },
    });
    let allCoveredTx = coveredTx;
    if (existingMarkerVouchers.length > 0) {
      const dayStartUtc = parseKolkataAttendanceDateYmd(params.workingDateYmd);
      const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);
      // Gold and Normal loans for this funder/date share this marker/bucket — no product-type
      // filtering needed here anymore (see buildFunderLabel in gl-config.ts).
      const historicalTx = await params.tx.loanTransaction.findMany({
        where: {
          branchId: params.branchId,
          type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
          isReversed: false,
          eodAllocatedAt: { not: null },
          transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
          loan: params.funderId ? { funderId: params.funderId } : { funderId: null },
          id: { notIn: params.transactionIds },
        },
        select: {
          id: true,
          loanId: true,
          type: true,
          principalAmount: true,
          interestAmount: true,
        },
      });
      allCoveredTx = [...historicalTx, ...coveredTx];
    }

    const principalToPost = Number(allCoveredTx.reduce((s, t) => s + Number(t.principalAmount || 0), 0).toFixed(2));
    const interestToPost = Number(allCoveredTx.reduce((s, t) => s + Number(t.interestAmount || 0), 0).toFixed(2));

    // Merged voucher covers three transaction types under one amount — break the narration down
    // by type so an accountant reading the voucher can still tell collection income apart from a
    // pre-closure payoff apart from a write-off closure, even though the GL amount is one lump sum.
    const sumByType = (type: 'REPAYMENT' | 'PRECLOSURE' | 'WRITEOFF', field: 'principalAmount' | 'interestAmount') =>
      Number(allCoveredTx.filter((t) => t.type === type).reduce((s, t) => s + Number(t[field] || 0), 0).toFixed(2));
    const buildBreakdownLines = (field: 'principalAmount' | 'interestAmount'): string => {
      const lines: string[] = [];
      const collection = sumByType('REPAYMENT', field);
      const preClosed = sumByType('PRECLOSURE', field);
      const closedLoan = sumByType('WRITEOFF', field);
      if (collection > 0) lines.push(`Collection: ₹${collection.toFixed(2)}`);
      if (preClosed > 0) lines.push(`Pre-Closed: ₹${preClosed.toFixed(2)}`);
      if (closedLoan > 0) lines.push(`Closed Loan: ₹${closedLoan.toFixed(2)}`);
      return lines.join('\n');
    };

    // Consolidates onto whichever of `matches` was created first, deactivating the rest — same
    // self-healing pattern as postEodCollectionAllocation's foldIntoSingleVoucher.
    const consolidateOrCreate = async (
      matches: { id: string; voucherNo: string }[],
      ledgerId: string,
      amount: number,
      description: string
    ): Promise<string> => {
      if (matches.length > 0) {
        const [keep, ...duplicates] = matches;
        if (duplicates.length > 0) {
          await params.tx.financialTransaction.updateMany({
            where: { id: { in: duplicates.map((d) => d.id) } },
            data: { isActive: false },
          });
        }
        await params.tx.financialTransaction.update({
          where: { id: keep.id },
          data: { amount: new Decimal(amount), description },
        });
        return keep.voucherNo;
      }

      const voucherNo = await getNextVoucherNo(params.tx as never, 'CR');
      await params.tx.financialTransaction.create({
        data: {
          voucherNo,
          transactionDate: params.transactionDate,
          type: 'CASH_RECEIPT',
          branchId: params.branchId,
          selfAccountId: cashSelfAccountId,
          ledgerId,
          amount: new Decimal(amount),
          description,
          postingMarker: marker,
          createdById: params.createdById,
          approvalStatus: approvalStatus as never,
          createdByRole: params.createdByRole,
        },
      });
      return voucherNo;
    };

    if (principalToPost > 0) {
      const principalLedgerId = await resolveOrCreateLedger(
        params.tx as never,
        ledgerNames.principal,
        GL_DEFAULT_GROUPS.ASSETS
      );
      const voucherNo = await consolidateOrCreate(
        existingMarkerVouchers.filter((v) => v.ledgerId === principalLedgerId),
        principalLedgerId,
        principalToPost,
        `${ledgerNames.principal}\n\nEOD Principal Amount Collected on ${params.workingDateYmd}\n${buildBreakdownLines('principalAmount')}`
      );
      voucherNos.push(voucherNo);
    }

    if (interestToPost > 0) {
      const interestLedgerId = await resolveOrCreateLedger(
        params.tx as never,
        ledgerNames.interest,
        GL_DEFAULT_GROUPS.INCOME
      );
      const voucherNo = await consolidateOrCreate(
        existingMarkerVouchers.filter((v) => v.ledgerId === interestLedgerId),
        interestLedgerId,
        interestToPost,
        `${ledgerNames.interest}\n\nEOD Interest Amount Collected on ${params.workingDateYmd}\n${buildBreakdownLines('interestAmount')}`
      );
      voucherNos.push(voucherNo);
    }

    // eodAllocatedAt was already stamped by the claim step above, before the vouchers were
    // created — see the comment there. Any covered PRECLOSURE/WRITEOFF loan(s) were already
    // finalized at approval/creation time (see finalizeClosureCoveredLoan in
    // app/lib/foreclosure-workflow.ts) — nothing left to do to the loan here.

    return { posted: true, voucherNos, finalizedLoanIds: [] };
  }

  /**
   * "Allocate for EOD" (Loan Advance) — posts a branch/date's approved "Loan Advance"
   * (SAVINGS_COLLECTION) amounts as a Cash Receipt voucher: Dr Cash in Hand / Cr "LOAN ADVANCE"
   * (auto-created if missing, GL_LEDGER_NAMES.LOAN_ADVANCE). Deliberately independent of the
   * funder collection posting (postEodCollectionAllocation) — it's the client's own advance
   * payment, not tied to who financed the loan or whether it's a gold loan, so it's allocated
   * and reverted as a single branch/date-wide bucket via its own dedicated
   * /api/collections/eod-allocation/loan-advance routes rather than piggybacking on a funder's
   * "Allocate For EOD" click.
   * Idempotent per branch+date via a marker embedded in the description.
   */
  async postEodLoanAdvanceAllocation(params: {
    tx: TransactionClient;
    branchId: string;
    workingDateYmd: string;
    loanAdvanceAmount: number;
    transactionDate: Date;
    createdById: string;
    createdByRole: string;
    /** SAVINGS_COLLECTION LoanTransaction ids being covered by this posting — stamped with
     *  eodAllocatedAt, same convention as postEodCollectionAllocation's REPAYMENT ids. */
    transactionIds: string[];
  }): Promise<{ posted: boolean; voucherNo?: string; message?: string }> {
    const marker = AccountingPostingService.buildEodLoanAdvanceMarker(params.branchId, params.workingDateYmd);
    const ledgerName = GL_LEDGER_NAMES.LOAN_ADVANCE;

    // Same legacy-residual netting pattern as postEodCollectionAllocation — the caller already
    // scopes loanAdvanceAmount to untagged (eodAllocatedAt = null) transactions, so only net out
    // amounts posted before per-transaction tagging existed.
    const dayStartUtc = parseKolkataAttendanceDateYmd(params.workingDateYmd);
    const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);
    const [existingPostings, taggedTx] = await Promise.all([
      params.tx.financialTransaction.findMany({
        where: { description: { contains: marker, mode: 'insensitive' }, isActive: true },
        select: { amount: true },
      }),
      params.tx.loanTransaction.findMany({
        where: {
          branchId: params.branchId,
          type: 'SAVINGS_COLLECTION' as never,
          status: 'APPROVED',
          isReversed: false,
          eodAllocatedAt: { not: null },
          transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        },
        select: { amount: true },
      }),
    ]);
    const markerPosted = existingPostings.reduce((s, p) => s + Number(p.amount || 0), 0);
    const tagged = taggedTx.reduce((s, t) => s + Number(t.amount || 0), 0);
    const legacyResidual = Math.max(0, markerPosted - tagged);

    const amountToPost = Number((params.loanAdvanceAmount - legacyResidual).toFixed(2));
    if (amountToPost <= 0) {
      return { posted: false, message: 'Already allocated for this date' };
    }

    const cashSelfAccountId = await resolveSelfAccount(params.tx as never, GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
    const ledgerId = await resolveOrCreateLedger(params.tx as never, ledgerName, GL_DEFAULT_GROUPS.LIABILITIES);
    const voucherNo = await getNextVoucherNo(params.tx as never, 'CR');
    // Always auto-approved — same reasoning as postEodCollectionAllocation: the underlying
    // collections already went through their own maker-checker approval.
    await params.tx.financialTransaction.create({
      data: {
        voucherNo,
        transactionDate: params.transactionDate,
        type: 'CASH_RECEIPT',
        branchId: params.branchId,
        selfAccountId: cashSelfAccountId,
        ledgerId,
        amount: new Decimal(amountToPost),
        description: `${marker} ${ledgerName}\n\nEOD Loan Advance Amount Collected on ${params.workingDateYmd}`,
        createdById: params.createdById,
        approvalStatus: 'APPROVED' as never,
        createdByRole: params.createdByRole,
      },
    });

    if (params.transactionIds.length > 0) {
      await params.tx.loanTransaction.updateMany({
        where: { id: { in: params.transactionIds } },
        data: { eodAllocatedAt: new Date() },
      });
    }

    return { posted: true, voucherNo };
  }

  /**
   * Loan Advance Refund approval — posts the approved refund amount as a Cash Payment
   * voucher: Dr "LOAN ADVANCE" (auto-created if missing, GL_LEDGER_NAMES.LOAN_ADVANCE) /
   * Cr Cash in Hand. Mirror image of postEodLoanAdvanceAllocation (which posts the client's
   * advance payment IN as a Cash Receipt) — this posts it back OUT once the refund request
   * itself is approved. Always auto-approved: the refund already went through its own
   * maker-checker (SavingsRefundRequest PENDING_APPROVAL -> APPROVED) before this runs, so a
   * second 3-level GL approval on top would be redundant — same reasoning as every other
   * system posting in this file. `postingMarker` (not `description`) carries the tag, kept
   * unique per refund request, so a second call for the same request is a no-op that returns
   * the existing voucher instead of creating a duplicate — defense-in-depth alongside the
   * route's own PENDING_APPROVAL status guard.
   */
  async postSavingsRefundPayment(params: {
    tx: TransactionClient;
    refundRequestId: string;
    branchId: string;
    amount: number;
    description: string;
    transactionDate: Date;
    createdById: string;
    createdByRole: string;
  }): Promise<{ voucherNo: string; financialTransactionId: string }> {
    const marker = AccountingPostingService.buildSavingsRefundMarker(params.refundRequestId);

    const existing = await params.tx.financialTransaction.findFirst({
      where: { postingMarker: marker, isActive: true },
      select: { id: true, voucherNo: true, transactionDate: true },
    });
    if (existing) {
      // This should only ever fire on a genuine same-request retry (network hiccup,
      // duplicate click) — same day, same amount. If the existing voucher's date
      // doesn't match this approval's date, the request's status was reset to
      // PENDING_APPROVAL and re-approved WITHOUT going through the tracked revert
      // flow (POST /api/savings/refund/revert), which is the only thing that
      // deactivates the old voucher. Reusing it here silently leaves a fresh
      // LoanTransaction on the new date with no matching GL cash movement — flag
      // it loudly rather than let it pass unnoticed.
      if (existing.transactionDate.getTime() !== params.transactionDate.getTime()) {
        console.warn(
          `[AccountingPostingService] postSavingsRefundPayment reused a voucher dated ${existing.transactionDate.toISOString()} ` +
          `for a refundRequestId=${params.refundRequestId} approval dated ${params.transactionDate.toISOString()} — ` +
          `the request's status was likely reset outside the tracked revert flow. Voucher ${existing.voucherNo} was NOT re-dated.`
        );
      }
      return { voucherNo: existing.voucherNo, financialTransactionId: existing.id };
    }

    const ledgerId = await resolveOrCreateLedger(params.tx as never, GL_LEDGER_NAMES.LOAN_ADVANCE, GL_DEFAULT_GROUPS.LIABILITIES);
    const cashSelfAccountId = await resolveSelfAccount(params.tx as never, GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
    const voucherNo = await getNextVoucherNo(params.tx as never, 'CP');

    const created = await params.tx.financialTransaction.create({
      data: {
        voucherNo,
        transactionDate: params.transactionDate,
        type: 'CASH_PAYMENT',
        branchId: params.branchId,
        selfAccountId: cashSelfAccountId,
        ledgerId,
        amount: new Decimal(params.amount),
        description: params.description,
        postingMarker: marker,
        createdById: params.createdById,
        approvalStatus: 'APPROVED',
        createdByRole: params.createdByRole,
      },
      select: { id: true, voucherNo: true },
    });

    await params.tx.transactionApprovalHistory.create({
      data: {
        transactionId: created.id,
        action: 'AUTO_APPROVED',
        performedById: params.createdById,
        previousStatus: 'PENDING_APPROVAL',
        newStatus: 'APPROVED',
        remarks: 'System-generated Cash Payment for an approved Loan Advance Refund request.',
      },
    });

    console.log(`[AccountingPostingService] Savings refund posting created: ${created.voucherNo} | ₹${params.amount} | refundRequestId=${params.refundRequestId}`);
    return { voucherNo: created.voucherNo, financialTransactionId: created.id };
  }
}

export const accountingPostingService = new AccountingPostingService();
