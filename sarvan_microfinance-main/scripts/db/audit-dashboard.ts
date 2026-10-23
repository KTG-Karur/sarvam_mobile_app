import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Totals = {
  totalCenters: number;
  totalClients: number;
  totalDisbursed: number;
  totalCollectionsApproved: number;
  portfolioOutstanding: number;
  totalDemandDueToDate: number;
  totalPaidDueToDate: number;
  totalPendingDueToDate: number;
};

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object') {
    const maybe = value as { toString?: unknown };
    if (typeof maybe.toString === 'function') {
      const n = Number(maybe.toString());
      return Number.isFinite(n) ? n : 0;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getBranchIds(): Promise<Array<{ id: string; code: string; name: string }>> {
  return prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
}

async function computeTotals(branchId?: string): Promise<Totals> {
  const branchFilter = branchId ? { branchId } : {};
  const clientFilter = branchId ? { center: { branchId } } : {};

  const now = new Date();

  const [totalCenters, totalClients, disbursedAgg, collectionsAgg, demandAgg] =
    await prisma.$transaction([
      prisma.center.count({ where: { isActive: true, ...branchFilter } }),
      prisma.client.count({ where: { isActive: true, ...clientFilter } }),
      prisma.loan.aggregate({
        _sum: { amount: true },
        where: { isActive: true, disbursementStatus: 'DISBURSED', ...branchFilter },
      }),
      prisma.loanTransaction.aggregate({
        _sum: { amount: true },
        where: {
          type: 'REPAYMENT',
          status: 'APPROVED',
          isReversed: false,
          ...(branchId ? { branchId } : {}),
        },
      }),
      prisma.loanSchedule.aggregate({
        _sum: { totalDue: true, totalPaid: true },
        where: {
          dueDate: { lte: now },
          loan: {
            isActive: true,
            disbursementStatus: 'DISBURSED',
            ...(branchId ? { branchId } : {}),
          },
        },
      }),
    ]);

  const totalDisbursed = toNumber(disbursedAgg._sum.amount ?? 0);
  const totalCollectionsApproved = toNumber(collectionsAgg._sum.amount ?? 0);
  const totalDemandDueToDate = toNumber(demandAgg._sum.totalDue ?? 0);
  const totalPaidDueToDate = toNumber(demandAgg._sum.totalPaid ?? 0);
  const totalPendingDueToDate = Math.max(0, totalDemandDueToDate - totalPaidDueToDate);

  return {
    totalCenters,
    totalClients,
    totalDisbursed,
    totalCollectionsApproved,
    portfolioOutstanding: Math.max(0, totalDisbursed - totalCollectionsApproved),
    totalDemandDueToDate,
    totalPaidDueToDate,
    totalPendingDueToDate,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set (required for audit).');
  }

  const branches = await getBranchIds();
  const overall = await computeTotals();
  const perBranch = await Promise.all(
    branches.map(async (b) => ({
      branchId: b.id,
      branchCode: b.code,
      branchName: b.name,
      totals: await computeTotals(b.id),
    })),
  );

  // Output in a diff-friendly JSON shape for audit trails.
  const payload = {
    generatedAt: new Date().toISOString(),
    overall,
    perBranch,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

