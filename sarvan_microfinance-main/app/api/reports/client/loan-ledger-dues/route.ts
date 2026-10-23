import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withRole, successResponse, errorResponse } from '@/app/lib/api-utils';
import { aggregateCollectionFromTransactionLines } from '@/app/lib/reports/loan-collection-aggregation';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

const querySchema = z.object({
  centerId: z.string().min(1),
  clientId: z.string().min(1),
  loanId: z.string().min(1),
});

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  // Prisma Decimal serializes to string in JSON, but is Decimal-like at runtime.
  if (value && typeof value === 'object' && 'toString' in value) {
    return Number((value as { toString: () => string }).toString());
  }
  return 0;
}

function toDdMmYy(date: Date | null | undefined): string | null {
  if (!date) return null;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = String(date.getFullYear()).slice(-2);
  return `${d}/${m}/${y}`;
}

// Return ISO format with full timestamp (DD-MM-YYYY HH:mm A format will be handled by frontend)
function toIsoDateTime(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString();
}

/**
 * Cookie-free core, split out of the GET handler below so the Request Report queue's
 * PDF renderer (app/lib/reports/loan-ledger-pdf-queue.ts) can call it directly without a
 * request/session context. Unlike the live route, this performs no role-based
 * authorization (FDO/BM/AM center-access checks) — callers with no user/session context
 * (the queue) do their own simpler `branchIds.includes(result.branchId)` check on the
 * returned branchId instead, matching the pattern report-registry.ts's fetchLoanLedger
 * already uses. Returns null if the loan doesn't exist.
 */
export async function computeLoanLedgerDues(loanId: string, clientId: string, centerId: string) {
  // No isActive filter: the caller explicitly picked this loanId (including from the
  // "Closed Loans" tab), so a closed loan's historical ledger must still be viewable.
  const loan = await prisma.loan.findFirst({
    where: {
      id: loanId,
      clientId,
      centerId,
    },
    select: {
      id: true,
      loanNumber: true,
      amount: true,
      branchId: true,
      approvedLevel2At: true,
      disbursedLevel1At: true,
      disbursedByBMAt: true,
      center: {
        select: {
          code: true,
          name: true,
          fdo: { select: { firstName: true, lastName: true } },
          branch: { select: { code: true, name: true } },
        },
      },
      funder: { select: { funderName: true } },
      schedules: {
        orderBy: { installmentNo: 'asc' },
        select: {
          id: true,
          installmentNo: true,
          dueDate: true,
          principalDue: true,
          interestDue: true,
          totalDue: true,
          savingsDue: true,
          savingsPaid: true,
          principalPaid: true,
          interestPaid: true,
          penaltiesPaid: true,
          paidAt: true,
          transactionLines: {
            where: {
              transaction: {
                isReversed: false,
                status: { in: ['PENDING', 'APPROVED'] as any },
              },
            },
            select: {
              lineTotal: true,
              principalAmount: true,
              interestAmount: true,
              feesAmount: true,
              penaltyAmount: true,
              transaction: {
                select: {
                  id: true,
                  transactionDate: true,
                  status: true,
                  collectionBatchId: true,
                  collectedBy: { select: { firstName: true, lastName: true } },
                },
              },
            },
            orderBy: { transaction: { transactionDate: 'asc' } } as any,
          },
        },
      },
      loanProduct: {
        select: { productName: true, numberOfDues: true, interestAmount: true },
      },
      client: {
        select: {
          clientId: true,
          firstName: true,
          lastName: true,
        },
      },
      deathMarking: { where: { isReversed: false } },
    },
  });

  const branchLock = loan?.branchId
    ? await prisma.branchLock.findUnique({
        where: { branchId: loan.branchId },
        select: { currentWorkingDate: true },
      })
    : null;
  const currentWorkingDate = branchLock?.currentWorkingDate ?? null;

  if (!loan) {
    return null;
  }

  const disbursalDate = loan.disbursedByBMAt ?? loan.disbursedLevel1At ?? null;
  const lastSchedule = loan.schedules.length > 0 ? loan.schedules[loan.schedules.length - 1] : null;
  const loanEndDate = lastSchedule ? lastSchedule.dueDate : null;
  const clientName = `${loan.client.firstName} ${loan.client.lastName}`.trim();
  const totalDues = loan.loanProduct?.numberOfDues ?? loan.schedules.length;

  const rows = loan.schedules.map((s) => {
    const duePrincipal = toNumber(s.principalDue);
    const dueInterest = toNumber(s.interestDue);
    const dueAmount = toNumber(s.totalDue);
    const collection = aggregateCollectionFromTransactionLines(s.transactionLines);
    const hasTransactionLines = (s.transactionLines?.length ?? 0) > 0;
    const collPrincipal = hasTransactionLines ? collection.principal : toNumber(s.principalPaid);
    const collInterest = hasTransactionLines ? collection.interest : toNumber(s.interestPaid);
    const collPenalty = hasTransactionLines
      ? s.transactionLines.reduce((sum, l) => sum + toNumber(l.penaltyAmount), 0)
      : toNumber(s.penaltiesPaid);
    const collAmount = hasTransactionLines
      ? collection.total
      : toNumber(s.principalPaid) + toNumber(s.interestPaid) + toNumber(s.penaltiesPaid);
    const balance = Math.max(0, dueAmount - collAmount);

    const collectionDate = s.paidAt ?? collection.latestTransactionDate;

    // Find the latest transaction line for action metadata
    let transactionDbId: string | null = null;
    let collectionBatchId: string | null = null;
    let transactionStatus: string | null = null;
    let collectedByName: string | null = null;
    let latestTxnDate: Date | null = null;

    for (const line of s.transactionLines) {
      const txDate = new Date(line.transaction.transactionDate);
      if (!latestTxnDate || txDate > latestTxnDate) {
        latestTxnDate = txDate;
        transactionDbId = line.transaction.id;
        collectionBatchId = line.transaction.collectionBatchId ?? null;
        transactionStatus = line.transaction.status as string;
        if (line.transaction.collectedBy) {
          collectedByName = `${line.transaction.collectedBy.firstName} ${line.transaction.collectedBy.lastName}`.trim();
        }
      }
    }

    const isEodLocked =
      latestTxnDate && currentWorkingDate ? latestTxnDate < currentWorkingDate : false;

    const arrearPrincipal = Math.max(0, duePrincipal - collPrincipal);
    const arrearInterest = Math.max(0, dueInterest - collInterest);

    return {
      dueNo: s.installmentNo,
      dueDate: toIsoDateTime(s.dueDate),
      collectionDate: toIsoDateTime(collectionDate),
      duePrincipal,
      dueInterest,
      dueAmount,
      dueSavings: toNumber(s.savingsDue),
      collectedPrincipal: collPrincipal,
      collectedInterest: collInterest,
      collectedPenalty: collPenalty,
      collectedAmount: collAmount,
      collectedSavings: toNumber(s.savingsPaid),
      dueBalance: balance,
      arrearPrincipal,
      arrearInterest,
      arrearTotal: arrearPrincipal + arrearInterest,
      transactionDbId,
      collectionBatchId,
      transactionStatus,
      collectedByName,
      isEodLocked,
    };
  });

  const sum = <K extends keyof (typeof rows)[number]>(key: K) =>
    rows.reduce((acc, r) => acc + (r[key] as number), 0);

  const totals = {
    duePrincipal: sum('duePrincipal'),
    dueInterest: sum('dueInterest'),
    dueAmount: sum('dueAmount'),
    dueSavings: sum('dueSavings'),
    collectedPrincipal: sum('collectedPrincipal'),
    collectedInterest: sum('collectedInterest'),
    collectedAmount: sum('collectedAmount'),
    collectedSavings: sum('collectedSavings'),
    dueBalance: sum('dueBalance'),
  };

  const interestAmount =
    loan.loanProduct?.interestAmount != null ? toNumber(loan.loanProduct.interestAmount) : totals.dueInterest;

  const groupOfficerName = loan.center?.fdo
    ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`.trim()
    : null;

  return {
    branchId: loan.branchId as string,
    header: {
      branchLabel: `${loan.center.branch.code} - ${loan.center.branch.name}`,
      centerLabel: `${loan.center.code} - ${loan.center.name}`,
      groupOfficerName,
      funderName: loan.funder?.funderName ?? null,
      clientId: loan.client.clientId,
      clientName,
      loanAccount: loan.loanNumber,
      loanAmount: toNumber(loan.amount),
      disbursalDate: toIsoDateTime(disbursalDate),
      loanEndDate: toIsoDateTime(loanEndDate),
      totalDues,
      interestAmount,
      totalAmount: toNumber(loan.amount) + interestAmount,
      isDead: (loan as any).deathMarking?.length > 0,
      deathMarking: (loan as any).deathMarking?.[0]
        ? {
            deceasedPersonType: (loan as any).deathMarking[0].deceasedPersonType,
            deceasedPersonName: (loan as any).deathMarking[0].deceasedPersonName,
            deathDate: (loan as any).deathMarking[0].deathDate.toISOString(),
            placeOfDeath: (loan as any).deathMarking[0].placeOfDeath,
            deathReason: (loan as any).deathMarking[0].deathReason,
            demandRequired: (loan as any).deathMarking[0].demandRequired,
          }
        : null,
    },
    rows,
    totals,
  };
}

export async function GET(req: NextRequest) {
  return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO'], async (request, user) => {
    try {
      const parsed = querySchema.safeParse({
        centerId: request.nextUrl.searchParams.get('centerId'),
        clientId: request.nextUrl.searchParams.get('clientId'),
        loanId: request.nextUrl.searchParams.get('loanId'),
      });

      if (!parsed.success) {
        return errorResponse('centerId, clientId and loanId are required', 400);
      }

      const { centerId, clientId, loanId } = parsed.data;

      const center = await prisma.center.findUnique({
        where: { id: centerId },
        select: { id: true, branchId: true, fdoId: true },
      });

      if (!center) {
        return errorResponse('Center not found', 404);
      }

      // Enforce role-based center access for robust API-level security.
      if (user.role === 'FDO') {
        const assignedCenter = await prisma.user.findUnique({
          where: { id: user.userId },
          select: {
            assignedCenters: {
              where: { id: centerId },
              select: { id: true },
            },
          },
        });

        const isAllowedByFdoId = center.fdoId === user.userId;
        const isAllowedByAssignment = (assignedCenter?.assignedCenters.length ?? 0) > 0;
        if (!isAllowedByFdoId && !isAllowedByAssignment) {
          return errorResponse('Unauthorized center access', 403);
        }
      }

      if (user.role === 'BRANCH_MANAGER') {
        const permittedBranchIds = await getPermittedBranchIds(user);
        if (permittedBranchIds !== null && !permittedBranchIds.includes(center.branchId)) {
          return errorResponse('Unauthorized center access', 403);
        }
      }

      // ADMIN has unrestricted access. AREA_MANAGER is scoped to their assigned branches
      // (AreaManagerBranch), not just the currently-active branch — an AM managing multiple
      // branches must be able to open a ledger for any branch they're assigned to, regardless
      // of which one is currently active in the branch switcher.
      if (user.role === 'AREA_MANAGER' && !(await isAmAssignedToBranch(user.userId, center.branchId))) {
        return errorResponse('Unauthorized center access', 403);
      }

      const result = await computeLoanLedgerDues(loanId, clientId, centerId);
      if (!result) {
        return errorResponse('Loan not found', 404);
      }

      return successResponse({
        header: result.header,
        rows: result.rows,
        totals: result.totals,
      });
    } catch (error) {
      console.error('Error fetching dues loan ledger:', error);
      return errorResponse('Failed to fetch dues loan ledger', 500);
    }
  })(req);
}
