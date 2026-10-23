import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getKolkataCalendarYmd, parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';
import { z } from 'zod';

export async function OPTIONS() {
  return handleCorsPreflight();
}

// A branch is only "in scope" for this user if resolveScopedBranchIds echoes back
// the exact branch requested — for a restricted user requesting an out-of-scope
// branch it silently substitutes their permitted set instead, which we must treat
// as a rejection here rather than a substitution (see branch-scope.ts).
async function assertBranchInScope(user: any, branchId: string): Promise<boolean> {
  const scoped = await resolveScopedBranchIds(user, branchId);
  return scoped === null || scoped.includes(branchId);
}

/**
 * GET /api/accounts/opening-balance?branchId=xxx
 * All active account ledgers for the branch, merged with any saved opening balance.
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const branchId = req.nextUrl.searchParams.get('branchId');
      if (!branchId) {
        return errorResponse('branchId is required', 400);
      }

      if (!(await assertBranchInScope(user, branchId))) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const [ledgers, openingBalances, selfAccounts, selfOpeningBalances] = await Promise.all([
        prisma.accountLedger.findMany({
          where: { isActive: true },
          select: { id: true, ledgerId: true, ledgerName: true },
        }),
        prisma.ledgerOpeningBalance.findMany({
          where: { branchId },
        }),
        prisma.selfAccount.findMany({
          where: { isActive: true },
          select: { id: true, name: true, type: true },
        }),
        prisma.selfAccountOpeningBalance.findMany({
          where: { branchId },
        }),
      ]);

      ledgers.sort((a, b) => {
        const numA = parseInt(a.ledgerId, 10);
        const numB = parseInt(b.ledgerId, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.ledgerId.localeCompare(b.ledgerId);
      });

      const openingBalanceByLedgerId = new Map(openingBalances.map((ob) => [ob.ledgerId, ob]));
      const selfOpeningBySelfAccountId = new Map(selfOpeningBalances.map((ob) => [ob.selfAccountId, ob]));

      // One date for the whole branch — every row (ledger AND self-account) shares it
      // (enforced on save), so any single existing row's date represents the branch.
      // `null` when nothing is saved yet.
      const firstDated = openingBalances[0]?.openingDate ?? selfOpeningBalances[0]?.openingDate ?? null;
      const openingDate = firstDated ? getKolkataCalendarYmd(firstDated) : null;

      const data = ledgers.map((ledger) => {
        const existing = openingBalanceByLedgerId.get(ledger.id);
        return {
          ledgerId: ledger.id,
          ledgerCode: ledger.ledgerId,
          ledgerName: ledger.ledgerName,
          balanceType: existing?.balanceType ?? 'CREDIT',
          amount: existing ? Number(existing.amount) : 0,
        };
      });

      const selfData = selfAccounts
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((sa) => {
          const existing = selfOpeningBySelfAccountId.get(sa.id);
          return {
            selfAccountId: sa.id,
            name: sa.name,
            type: sa.type,
            // Cash/Bank balances are assets — default Debit, unlike the ledger table.
            balanceType: existing?.balanceType ?? 'DEBIT',
            amount: existing ? Number(existing.amount) : 0,
          };
        });

      return successResponse(
        {
          openingDate,
          ledgers: data,
          selfAccounts: selfData,
          totalAccounts: data.length,
          totalSelfAccounts: selfData.length,
        },
        'Opening balances fetched successfully'
      );
    } catch (error: any) {
      console.error('Error fetching opening balances:', error);
      return errorResponse('Failed to fetch opening balances', 500);
    }
  })(request);
}

const openingBalanceEntrySchema = z.object({
  ledgerId: z.string().min(1),
  balanceType: z.enum(['CREDIT', 'DEBIT']),
  amount: z.number().min(0, 'Amount must be a positive value'),
});

const selfOpeningBalanceEntrySchema = z.object({
  selfAccountId: z.string().min(1),
  balanceType: z.enum(['CREDIT', 'DEBIT']),
  amount: z.number().min(0, 'Amount must be a positive value'),
});

const saveOpeningBalanceSchema = z.object({
  branchId: z.string().min(1, 'Branch is required'),
  // One opening date for the whole branch — not per ledger / self account. Applied to
  // every dirty entry AND synced onto every other existing opening-balance row (ledger
  // and self-account) for this branch, so the "single date per branch" invariant always
  // holds in the DB.
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Opening Balance Date must be in YYYY-MM-DD format'),
  // Both allowed to be empty — a date-only change (no amounts touched) is still a valid
  // save; see the "nothing to do" guard below for the truly-no-op case.
  entries: z.array(openingBalanceEntrySchema),
  selfEntries: z.array(selfOpeningBalanceEntrySchema).optional().default([]),
});

/**
 * POST /api/accounts/opening-balance
 * Upserts only the changed ledger opening balance entries for a branch.
 */
export async function POST(request: NextRequest) {
  // Chart-of-accounts master data (Groups/Ledgers) is Admin-only throughout this app
  // (see navigation.config.ts's Accounts section) — Opening Balance follows the same
  // restriction rather than the broader BRANCH_MANAGER/AREA_MANAGER set used by reports.
  return withRole(['ADMIN'], async (req, user) => {
    try {
      const body = await req.json();
      const validation = saveOpeningBalanceSchema.safeParse(body);
      if (!validation.success) {
        return errorResponse(validation.error.errors[0].message, 400);
      }

      const { branchId, openingDate, entries, selfEntries } = validation.data;

      if (!(await assertBranchInScope(user, branchId))) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const ledgerIds = entries.map((e) => e.ledgerId);
      if (ledgerIds.length > 0) {
        const validLedgerCount = await prisma.accountLedger.count({
          where: { id: { in: ledgerIds }, isActive: true },
        });
        if (validLedgerCount !== new Set(ledgerIds).size) {
          return errorResponse('One or more ledgers are invalid', 400);
        }
      }

      const selfAccountIds = selfEntries.map((e) => e.selfAccountId);
      if (selfAccountIds.length > 0) {
        const validSelfCount = await prisma.selfAccount.count({
          where: { id: { in: selfAccountIds }, isActive: true },
        });
        if (validSelfCount !== new Set(selfAccountIds).size) {
          return errorResponse('One or more self accounts are invalid', 400);
        }
      }

      if (entries.length === 0 && selfEntries.length === 0) {
        // Date-only save — only meaningful if the branch already has something to re-date.
        const [existingLedgerCount, existingSelfCount] = await Promise.all([
          prisma.ledgerOpeningBalance.count({ where: { branchId } }),
          prisma.selfAccountOpeningBalance.count({ where: { branchId } }),
        ]);
        if (existingLedgerCount === 0 && existingSelfCount === 0) {
          return errorResponse('No changes to save', 400);
        }
      }

      const sharedOpeningDate = parseKolkataAttendanceDateYmd(openingDate);

      await prisma.$transaction([
        ...entries.map((entry) =>
          prisma.ledgerOpeningBalance.upsert({
            where: { branchId_ledgerId: { branchId, ledgerId: entry.ledgerId } },
            update: {
              balanceType: entry.balanceType,
              openingDate: sharedOpeningDate,
              amount: entry.amount,
              updatedById: user.userId,
            },
            create: {
              branchId,
              ledgerId: entry.ledgerId,
              balanceType: entry.balanceType,
              openingDate: sharedOpeningDate,
              amount: entry.amount,
              createdById: user.userId,
            },
          })
        ),
        ...selfEntries.map((entry) =>
          prisma.selfAccountOpeningBalance.upsert({
            where: { branchId_selfAccountId: { branchId, selfAccountId: entry.selfAccountId } },
            update: {
              balanceType: entry.balanceType,
              openingDate: sharedOpeningDate,
              amount: entry.amount,
              updatedById: user.userId,
            },
            create: {
              branchId,
              selfAccountId: entry.selfAccountId,
              balanceType: entry.balanceType,
              openingDate: sharedOpeningDate,
              amount: entry.amount,
              createdById: user.userId,
            },
          })
        ),
        // Every other already-saved row in this branch (ledger AND self-account) must move
        // to the same date too — the branch has exactly one opening date, never a mix.
        prisma.ledgerOpeningBalance.updateMany({
          where: { branchId, ledgerId: { notIn: ledgerIds } },
          data: { openingDate: sharedOpeningDate, updatedById: user.userId },
        }),
        prisma.selfAccountOpeningBalance.updateMany({
          where: { branchId, selfAccountId: { notIn: selfAccountIds } },
          data: { openingDate: sharedOpeningDate, updatedById: user.userId },
        }),
      ]);

      return successResponse(null, 'Opening balances saved successfully');
    } catch (error: any) {
      console.error('Error saving opening balances:', error);
      return errorResponse(error.message || 'Failed to save opening balances', 500);
    }
  })(request);
}
