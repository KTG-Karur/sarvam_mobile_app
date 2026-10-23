import { PrismaClient } from '@prisma/client';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * GL Configuration
 * ────────────────
 * Defines the canonical ledger names that map IL (loan operations)
 * to GL (accounting entries). When the Set GL Balance process runs,
 * it looks up these ledgers by name and auto-creates them if missing.
 *
 * FUTURE-PROOF: To add a new income category (e.g., "Insurance Income"),
 * simply add an entry here and update the sync algorithm to aggregate it.
 */

// ─── Ledger Names (must match or be created in AccountLedger) ───
export const GL_LEDGER_NAMES = {
    LOAN_PORTFOLIO: 'Loan Portfolio',       // Asset: Principal outstanding
    INTEREST_INCOME: 'Interest Income',     // Revenue: Interest earned from collections
    FEE_INCOME: 'Fees & Charges',           // Revenue: Processing fees, document charges
    PENALTY_INCOME: 'Penalty Income',       // Revenue: Late payment penalties
    // ─── HO Inter-Branch Transaction Ledgers ───
    HO_BORROW: 'HO Borrow',                // Liability: Cash received by branch from Head Office
    HO_REMITTANCE: 'HO Remittance',        // Liability: Cash remitted by branch back to Head Office
    // Client's own advance payment, held in trust until applied to a future installment or
    // refunded (see SavingsRefundRequest) — a liability, not loan principal/income. Unlike
    // Principal/Interest/Disbursement, this is NOT split funder-wise or gold-wise: it's the
    // client's own money, not tied to who financed the loan.
    LOAN_ADVANCE: 'LOAN ADVANCE',          // Liability: Client advance payments held in trust
} as const;

// ─── Self Account Names (Cash / Bank — already seeded in system) ───
export const GL_SELF_ACCOUNT_NAMES = {
    CASH_IN_HAND: 'Cash in Hand',
    BANK: 'Bank',
} as const;

// ─── Default Account Group for auto-created ledgers ───
export const GL_DEFAULT_GROUPS = {
    INCOME: 'Income',          // Parent group for interest, fees, penalty
    ASSETS: 'Assets',          // Parent group for loan portfolio
    LIABILITIES: 'Liabilities', // Parent group for HO Borrow / HO Remittance inter-branch accounts
} as const;

/**
 * Canonical "is this a gold loan" check for GL/Day-Book classification — keyed
 * off the loan's LoanProductType name (matches the gate used at disbursement
 * time in bm-disburse), NOT the presence of a GoldLoanDetail row. GoldLoanDetail
 * is only reliably populated for loans disbursed through the BM Disburse UI —
 * bulk-imported/backfilled gold loans can be DISBURSED with no GoldLoanDetail
 * row at all, which silently misclassifies them as "normal" if keyed off that
 * relation instead.
 */
export function isGoldLoanProduct(loanProductTypeName: string | null | undefined): boolean {
    return !!loanProductTypeName?.toLowerCase().includes('gold');
}

/**
 * A funder's canonical identity — the funder's stored name, uppercased with
 * whitespace collapsed, and nothing else added or stripped. A missing name
 * (self-funded loans, Loan.funderId null) defaults to "OWN FUND".
 *
 * Shared identity key used everywhere funders are grouped or labeled — GL ledger
 * naming (buildFunderLabel below), EOD allocation/disbursement funder grouping
 * (accounting-posting.service.ts, app/api/collections/eod-allocation), and DCR's
 * funder columns (app/lib/actions/reports.ts's getDCRData). Reuse this function
 * rather than re-deriving the normalization elsewhere.
 *
 * The funder's stored name is used verbatim (just uppercased): "SBI" stays "SBI"
 * (never "SBI FUND"), "Own Fund" stays "OWN FUND", and a Masters row named
 * "Own Fund - Gold" is its OWN distinct funder — its own "OWN FUND - GOLD ..."
 * ledgers / Day Book rows / DCR column, separate from plain "Own Fund". (Gold as a
 * loan *product-type* flag is a different axis and is still NOT a separate funder
 * — see isGoldLoanProduct and the :GOLD/:NORMAL EOD marker history, neither
 * touched here.)
 */
export function getFunderCoreName(funderName: string | null | undefined): string {
    return (funderName?.trim() || 'OWN FUND').toUpperCase().replace(/\s+/g, ' ');
}

/**
 * The shared base label used to build both GL ledger names (buildFunderLedgerNames
 * below) and Day Book particulars (app/lib/actions/reports.ts), so the two always
 * agree. It is exactly the funder's stored name (via getFunderCoreName) — nothing
 * is appended. So ledgers read "{FUNDER NAME} PRINCIPAL" / "{FUNDER NAME} INTEREST"
 * — e.g. "SBI PRINCIPAL", "OWN FUND PRINCIPAL", "OWN FUND - GOLD PRINCIPAL".
 *
 * The `isGoldLoan` parameter is intentionally unused (kept only so callers in
 * app/lib/actions/reports.ts don't need a signature change) — gold *product-type*
 * is not a funder dimension. Do not reintroduce a gold branch here.
 */
export function buildFunderLabel(funderName: string | null | undefined, _isGoldLoan: boolean): string {
    return getFunderCoreName(funderName);
}

/**
 * Funder-wise ledger names for disbursement/collection postings:
 * "{FUNDER LABEL} PRINCIPAL/INTEREST/DISBURSEMENT". `isGoldLoan` does not
 * affect the name — see buildFunderLabel above.
 */
export function buildFunderLedgerNames(funderName: string | null | undefined, isGoldLoan: boolean) {
    const base = buildFunderLabel(funderName, isGoldLoan);
    return {
        principal: `${base} PRINCIPAL`,
        interest: `${base} INTEREST`,
        disbursement: `${base} DISBURSEMENT`,
    } as const;
}

/**
 * Resolve a ledger ID by name, creating it if it doesn't exist.
 * This makes the system self-healing — if someone accidentally deletes
 * the "Interest Income" ledger, the next GL sync will recreate it.
 */
export async function resolveOrCreateLedger(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    ledgerName: string,
    parentGroupName: string
): Promise<string> {
    // Try to find existing ledger by name (case-insensitive)
    const existing = await tx.accountLedger.findFirst({
        where: {
            ledgerName: { equals: ledgerName, mode: 'insensitive' },
            isActive: true,
        },
    });

    if (existing) return existing.id;

    // Fall back to a trimmed, case-insensitive match — real ledger data can
    // carry stray leading/trailing whitespace (e.g. "Admission Fees " with a
    // trailing space) that the exact-equals lookup above would otherwise
    // miss, wrongly creating a duplicate ledger under the same group. Same
    // pattern as the group-name trim match below.
    const allActiveLedgers = await tx.accountLedger.findMany({
        where: { isActive: true },
        select: { id: true, ledgerName: true },
    });
    const normalizedLedgerTarget = ledgerName.trim().toLowerCase();
    const trimmedLedgerMatch = allActiveLedgers.find(
        (l) => l.ledgerName.trim().toLowerCase() === normalizedLedgerTarget
    );
    if (trimmedLedgerMatch) return trimmedLedgerMatch.id;

    // Find or create the parent group. Match by trimmed, case-insensitive name —
    // imported data can carry stray leading/trailing whitespace that would
    // otherwise make an exact-equals lookup miss an existing group and try
    // (wrongly) to create a duplicate.
    const allGroups = await tx.accountGroup.findMany({
        select: { groupId: true, groupName: true },
    });
    const normalizedTarget = parentGroupName.trim().toLowerCase();
    const matchedGroup = allGroups.find((g) => g.groupName.trim().toLowerCase() === normalizedTarget);
    let group = matchedGroup
        ? await tx.accountGroup.findFirst({ where: { groupId: matchedGroup.groupId } })
        : null;

    if (!group) {
        // Auto-create the group with a generated groupId. groupId is a string
        // column, so `orderBy: { groupId: 'desc' }` sorts lexicographically
        // (e.g. "9" > "20") — always compute the numeric max in JS instead.
        let maxGroupId = 0;
        for (const g of allGroups) {
            const num = parseInt(g.groupId, 10);
            if (!isNaN(num) && num > maxGroupId) maxGroupId = num;
        }
        const nextGroupId = (maxGroupId + 1).toString();

        group = await tx.accountGroup.create({
            data: {
                groupId: nextGroupId,
                groupName: parentGroupName,
                isPrimary: true,
                isSystemGroup: true,
                description: `Auto-created by GL Sync for ${parentGroupName}`,
            },
        });
    }

    // Auto-generate numeric ledger ID — same lexicographic-sort pitfall as
    // above, so compute the numeric max in JS instead of relying on orderBy.
    const allLedgers = await tx.accountLedger.findMany({
        select: { ledgerId: true },
    });
    let maxLedgerId = 0;
    for (const l of allLedgers) {
        const num = parseInt(l.ledgerId, 10);
        if (!isNaN(num) && num > maxLedgerId) maxLedgerId = num;
    }
    const nextLedgerId = (maxLedgerId + 1).toString();

    // Create the ledger
    const newLedger = await tx.accountLedger.create({
        data: {
            ledgerId: nextLedgerId,
            ledgerName: ledgerName,
            groupId: group.groupId,
            allowAccessTo: ['H.O'],
        },
    });

    console.log(`[GL Sync] Auto-created ledger "${ledgerName}" with ID ${newLedger.id}`);
    return newLedger.id;
}

/**
 * Resolve a Self Account ID by name.
 * Self accounts (Cash in Hand, Bank) should already be seeded.
 * If missing, auto-creates it — unless `options.autoCreate` is explicitly `false`,
 * in which case `null` is returned so the caller can decide a fallback.
 */
export async function resolveSelfAccount(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    accountName: string,
    options?: { autoCreate?: true }
): Promise<string>;
export async function resolveSelfAccount(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    accountName: string,
    options: { autoCreate: false }
): Promise<string | null>;
export async function resolveSelfAccount(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    accountName: string,
    options?: { autoCreate?: boolean }
): Promise<string | null> {
    const existing = await tx.selfAccount.findFirst({
        where: {
            name: { equals: accountName, mode: 'insensitive' },
            isActive: true,
        },
    });

    if (existing) return existing.id;

    if (options?.autoCreate === false) return null;

    // Auto-create if missing
    const newAccount = await tx.selfAccount.create({
        data: {
            name: accountName,
            description: `Auto-created by GL Sync`,
        },
    });

    console.log(`[GL Sync] Auto-created self account "${accountName}" with ID ${newAccount.id}`);
    return newAccount.id;
}

/**
 * Generate the next voucher number for a given prefix.
 * Follows existing codebase pattern: PREFIX-YYMM-XXXX
 */
export async function getNextVoucherNo(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    typePrefix: string
): Promise<string> {
    // Derive year and month in IST — independent of server timezone.
    // e.g. 2026-05-06 in IST → year='26', month='05'
    const istYmd = getKolkataCalendarYmd(new Date());
    const year = istYmd.slice(2, 4);   // last 2 digits of year
    const month = istYmd.slice(5, 7);  // MM
    const prefix = `${typePrefix}-${year}${month}-`;

    const lastTx = await tx.financialTransaction.findFirst({
        where: { voucherNo: { startsWith: prefix } },
        orderBy: { voucherNo: 'desc' },
    });

    let seq = 1;
    if (lastTx) {
        const parts = lastTx.voucherNo.split('-');
        if (parts.length >= 3) {
            const lastSeq = parseInt(parts[2]);
            if (!isNaN(lastSeq)) seq = lastSeq + 1;
        }
    }

    return `${prefix}${seq.toString().padStart(4, '0')}`;
}

/**
 * Maps a PaymentMode from LoanTransaction to the corresponding
 * FinancialTransactionType and SelfAccount.
 *
 * CASH, ADJUSTMENT → Cash in Hand (CASH_RECEIPT / CASH_PAYMENT)
 * BANK_TRANSFER, CHEQUE, UPI → Bank (BANK_RECEIPT / BANK_PAYMENT)
 */
export function mapPaymentModeToGL(paymentMode: string, isInflow: boolean) {
    const isCash = paymentMode === 'CASH' || paymentMode === 'ADJUSTMENT';

    return {
        selfAccountName: isCash ? GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND : GL_SELF_ACCOUNT_NAMES.BANK,
        transactionType: isInflow
            ? (isCash ? 'CASH_RECEIPT' : 'BANK_RECEIPT')
            : (isCash ? 'CASH_PAYMENT' : 'BANK_PAYMENT'),
        voucherPrefix: isInflow
            ? (isCash ? 'CR' : 'BR')
            : (isCash ? 'CP' : 'BP'),
    } as const;
}
