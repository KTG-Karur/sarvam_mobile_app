import { prisma } from '@/app/lib/db';
import type { OpeningBalanceType } from '@prisma/client';
import { GL_SELF_ACCOUNT_NAMES } from '@/app/lib/gl-config';

/**
 * Trial Balance's ledgerBalances and Ledger Report's runningBalance are both
 * debit-positive — this must stay consistent with that convention. DEBIT increases a
 * ledger's balance, CREDIT decreases it, matching standard double-entry semantics.
 */
export function signedOpeningAmount(balanceType: OpeningBalanceType, amount: number): number {
  return balanceType === 'DEBIT' ? amount : -amount;
}

export type BranchOpeningContext = {
  /** Single opening date shared by every opening-balance row in this branch — ledger AND
   *  self-account (see the POST /api/accounts/opening-balance route, which enforces one
   *  date per branch across both stores). */
  openingDate: Date;
  /** AccountLedger.id -> debit-positive signed amount. */
  ledgerAmounts: Map<string, number>;
  /** SelfAccount.id -> debit-positive signed amount. Populated from SelfAccountOpeningBalance;
   *  empty when the branch has no self-account opening rows (callers then fall back to the
   *  legacy name→ledger bridge via {@link selfAccountOpeningAmount}). */
  selfAccountAmounts: Map<string, number>;
};

export type LedgerOpeningBalanceRow = {
  branchId: string;
  ledgerId: string;
  balanceType: OpeningBalanceType;
  amount: number | { toString(): string }; // Prisma.Decimal-compatible
  openingDate: Date;
};

export type SelfAccountOpeningBalanceRow = {
  branchId: string;
  selfAccountId: string;
  balanceType: OpeningBalanceType;
  amount: number | { toString(): string };
  openingDate: Date;
};

/**
 * Pure aggregation core of {@link getBranchOpeningContext} — separated out so the
 * per-branch independence/no-double-counting logic (the reason this service exists) can
 * be unit-tested without a database, matching this codebase's convention of testing pure
 * logic rather than mocking Prisma.
 *
 * Computes each branch's context independently — never summed or date-blended across
 * branches (a branch's own transactions must never bleed into another branch's
 * snapshot). Returns an entry for every branch that has at least one row — "configured"
 * is a pure branch-level fact, deliberately independent of any report's requested date
 * range. (An earlier version gated this on the caller's own `asOfDate`/window, which
 * caused a real bug: a report run with a from-date earlier than the branch's configured
 * opening date would treat the branch as unconfigured and fall back to showing every
 * transaction since inception — the opposite of what an opening balance is for.) Callers
 * use the returned `openingDate` to exclude pre-cutover transactions per-row; that
 * exclusion, not this function, is what keeps old data out.
 */
export function buildBranchOpeningContexts(
  rows: LedgerOpeningBalanceRow[],
  selfRows: SelfAccountOpeningBalanceRow[] = []
): Map<string, BranchOpeningContext> {
  const byBranch = new Map<string, LedgerOpeningBalanceRow[]>();
  for (const row of rows) {
    const list = byBranch.get(row.branchId);
    if (list) list.push(row);
    else byBranch.set(row.branchId, [row]);
  }
  const selfByBranch = new Map<string, SelfAccountOpeningBalanceRow[]>();
  for (const row of selfRows) {
    const list = selfByBranch.get(row.branchId);
    if (list) list.push(row);
    else selfByBranch.set(row.branchId, [row]);
  }

  const result = new Map<string, BranchOpeningContext>();
  // A branch is "configured" if it has EITHER a ledger opening row or a self-account one.
  const allBranchIds = new Set<string>([...byBranch.keys(), ...selfByBranch.keys()]);
  for (const branchId of allBranchIds) {
    const branchRows = byBranch.get(branchId) ?? [];
    const branchSelfRows = selfByBranch.get(branchId) ?? [];
    // Every row for a branch shares one date, enforced at save time — take it from the
    // first row rather than re-deriving a min/max, so a save-time bug surfaces as a
    // visible date mismatch instead of being silently papered over here.
    const openingDate = (branchRows[0] ?? branchSelfRows[0]).openingDate;

    const ledgerAmounts = new Map<string, number>();
    for (const row of branchRows) {
      ledgerAmounts.set(row.ledgerId, signedOpeningAmount(row.balanceType, Number(row.amount)));
    }
    const selfAccountAmounts = new Map<string, number>();
    for (const row of branchSelfRows) {
      selfAccountAmounts.set(row.selfAccountId, signedOpeningAmount(row.balanceType, Number(row.amount)));
    }
    result.set(branchId, { openingDate, ledgerAmounts, selfAccountAmounts });
  }
  return result;
}

/**
 * Per-branch opening-balance context — computed independently for each branch, never
 * summed or date-blended across branches (a branch's own transactions must never bleed
 * into another branch's snapshot). The returned Map contains an entry for every branch
 * that has at least one `LedgerOpeningBalance` row — a missing key means the caller must
 * fall back to its existing naive/since-inception calculation for that branch.
 *
 * `branchIds: null` means unrestricted — every configured branch is included; branches
 * with none simply don't appear (there's no bounded universe to enumerate "unconfigured"
 * branches against in that mode).
 */
export async function getBranchOpeningContext(
  branchIds: string[] | null
): Promise<Map<string, BranchOpeningContext>> {
  const where = branchIds !== null ? { branchId: { in: branchIds } } : {};
  const [rows, selfRows] = await Promise.all([
    prisma.ledgerOpeningBalance.findMany({
      where,
      select: { branchId: true, ledgerId: true, balanceType: true, amount: true, openingDate: true },
    }),
    prisma.selfAccountOpeningBalance.findMany({
      where,
      select: { branchId: true, selfAccountId: true, balanceType: true, amount: true, openingDate: true },
    }),
  ]);

  return buildBranchOpeningContexts(rows, selfRows);
}

/**
 * The opening amount to seed a SelfAccount's running balance with, debit-positive.
 *
 * Preference order: (1) a direct SelfAccountOpeningBalance row for this branch+account;
 * (2) the legacy name→ledger bridge amount (`fallbackBridgeLedgerId`), for branches
 * configured only on the ledger side; (3) 0 when the branch IS configured (context exists)
 * but this self account was never given a row — "configured-but-unset = 0", matching the
 * ledger-side {@link bridgedSelfAccountOpeningAmount} convention. Returns `null` only when
 * the branch is entirely unconfigured, so the caller falls back to naive/since-inception.
 */
export function selfAccountOpeningAmount(
  ctx: BranchOpeningContext | undefined,
  selfAccountId: string,
  fallbackBridgeLedgerId: string | null
): number | null {
  if (!ctx) return null;
  const direct = ctx.selfAccountAmounts.get(selfAccountId);
  if (direct !== undefined) return direct;
  if (fallbackBridgeLedgerId) return ctx.ledgerAmounts.get(fallbackBridgeLedgerId) ?? 0;
  return 0;
}

export type SelfAccountBridge = {
  /** SelfAccount.id — the id actually referenced by FinancialTransaction.selfAccountId. */
  selfAccountId: string;
  /** The single AccountLedger.id whose configured amount is shown on this self account's
   *  row — auto-created on first use if missing (see below), so this should only be null
   *  when the self account itself has no existing ledger to model it after (no reference
   *  group to place the new one in). When more than one active ledger shares this name
   *  (a pre-existing chart-of-accounts duplicate), the lowest-numbered ledger code wins
   *  deterministically; ALL of them are still excluded from ledger-side seeding via
   *  {@link allBridgeLedgerIds} below — a duplicate must never seed a second, independent
   *  opening amount for the same physical cash. */
  bridgeLedgerId: string | null;
};

/** Next available numeric AccountLedger.ledgerId — same "compute the max in JS" approach
 *  as resolveOrCreateLedger in app/lib/gl-config.ts (ledgerId is a string column, so
 *  ORDER BY sorts lexicographically, e.g. "9" > "20" — must compute the numeric max). */
async function nextLedgerCode(): Promise<string> {
  const allLedgers = await prisma.accountLedger.findMany({ select: { ledgerId: true } });
  let max = 0;
  for (const l of allLedgers) {
    const num = parseInt(l.ledgerId, 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return (max + 1).toString();
}

/**
 * Resolves both halves of the Cash in Hand / Bank bridge once per call site: the
 * `SelfAccount` id (to attribute transactions) and the matching-named `AccountLedger` id(s)
 * (to look up opening-balance config via `BranchOpeningContext.ledgerAmounts`).
 *
 * Self-heals a missing bridge ledger (mirrors resolveOrCreateLedger's philosophy in
 * app/lib/gl-config.ts): without a ledger to attach to, an admin has no way to enter an
 * opening balance for that self account at all, and its transactions could never be
 * excluded — e.g. Bank had no ledger out of the box, so Bank transactions kept showing up
 * in full regardless of any configured opening balance. The new ledger is created in the
 * same chart-of-accounts group as whichever bridge ledger already exists (Cash in Hand),
 * so it lands in a sensible place rather than requiring a guessed default group.
 *
 * `allBridgeLedgerIds` deliberately includes EVERY active ledger matching either name, not
 * just the one `bridgeLedgerId` picks as the amount-of-record — the chart of accounts can
 * (and here, does) contain more than one ledger named "Cash in Hand"; every one of them
 * must be excluded from a report's plain ledger-seeding loop, or a duplicate ledger would
 * seed its own independent opening amount for the same physical cash the self-account row
 * already accounts for.
 */
export async function resolveSelfAccountBridges(): Promise<{
  cashInHand: SelfAccountBridge | null;
  bank: SelfAccountBridge | null;
  allBridgeLedgerIds: string[];
}> {
  const names = [GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND, GL_SELF_ACCOUNT_NAMES.BANK];
  const [selfAccounts, ledgers] = await Promise.all([
    prisma.selfAccount.findMany({
      where: { name: { in: names, mode: 'insensitive' }, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.accountLedger.findMany({
      where: { ledgerName: { in: names, mode: 'insensitive' }, isActive: true },
      select: { id: true, ledgerId: true, ledgerName: true, groupId: true },
    }),
  ]);
  const selfByName = new Map(selfAccounts.map((s) => [s.name.trim().toLowerCase(), s.id]));

  const ledgersByName = new Map<string, typeof ledgers>();
  for (const l of ledgers) {
    const key = l.ledgerName.trim().toLowerCase();
    const list = ledgersByName.get(key);
    if (list) list.push(l);
    else ledgersByName.set(key, [l]);
  }
  // Deterministic winner per name (lowest numeric ledger code) — DB row order isn't
  // guaranteed, so picking ledgers[0] would let the "amount of record" flip between runs.
  const pickWinner = (matches: typeof ledgers) =>
    [...matches].sort((a, b) => {
      const na = parseInt(a.ledgerId, 10);
      const nb = parseInt(b.ledgerId, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.ledgerId.localeCompare(b.ledgerId);
    })[0];

  const referenceGroupId = ledgers[0]?.groupId ?? null;
  for (const name of names) {
    const key = name.toLowerCase();
    if (ledgersByName.has(key)) continue;
    if (!selfByName.has(key)) continue; // nothing to bridge if the self account doesn't exist
    if (!referenceGroupId) continue; // no existing bridge ledger to model the group after

    const created = await prisma.accountLedger.create({
      data: {
        ledgerId: await nextLedgerCode(),
        ledgerName: name,
        groupId: referenceGroupId,
        allowAccessTo: ['H.O'],
      },
      select: { id: true, ledgerId: true, ledgerName: true, groupId: true },
    });
    ledgersByName.set(key, [created]);
  }

  const allBridgeLedgerIds = Array.from(ledgersByName.values()).flatMap((matches) => matches.map((l) => l.id));

  const build = (name: string): SelfAccountBridge | null => {
    const selfAccountId = selfByName.get(name.toLowerCase());
    if (!selfAccountId) return null;
    const matches = ledgersByName.get(name.toLowerCase());
    return { selfAccountId, bridgeLedgerId: matches ? pickWinner(matches).id : null };
  };

  return {
    cashInHand: build(GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND),
    bank: build(GL_SELF_ACCOUNT_NAMES.BANK),
    allBridgeLedgerIds,
  };
}

/**
 * Bridges a branch's Cash-in-Hand/Bank opening balance from its ledger-level config.
 * `SelfAccount` (used by Day Book, Receipts & Payments, and the self-account rows of GL
 * One/GL All) has no relation to `AccountLedger` and no branch scoping at all, so this
 * resolves the opening amount via the matching-named ledger instead.
 *
 * Returns `null` when there's no data source to use (branch entirely unconfigured, or no
 * ledger with this name exists at all) — the caller must fall back to naive/since-inception
 * for that branch/account. Returns 0 when the branch IS configured but this particular
 * bridge ledger was never given its own row (Decision 1: configured-but-unset = 0, not naive).
 *
 * Sign convention: verified against the actual signed-impact logic already in gl-one/gl-all
 * (self-account: receipt = +debit, payment = -credit) and receipts-payments
 * (openingBalance = receipts - payments) — both already treat "inflow increases the
 * balance" as debit-positive, so this reuses the same signedOpeningAmount formula. Kept as
 * its own function (not a direct re-export) so the self-account convention can diverge
 * independently later without touching the ledger-side callers.
 */
export function bridgedSelfAccountOpeningAmount(
  branchOpeningContext: BranchOpeningContext | undefined,
  bridgeLedgerId: string | null
): number | null {
  if (!branchOpeningContext || !bridgeLedgerId) return null;
  return branchOpeningContext.ledgerAmounts.get(bridgeLedgerId) ?? 0;
}
