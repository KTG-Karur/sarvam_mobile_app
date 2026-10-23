import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Args = {
  branchCode?: string;
  centerCode?: string;
  demandDate: string; // YYYY-MM-DD
  take: number;
};

function getArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Record<string, string> = {};
  for (const part of raw) {
    const [k, ...rest] = part.split('=');
    if (!k) continue;
    args[k.replace(/^--/, '')] = rest.join('=');
  }

  const demandDate = args.demandDate ?? args.date;
  if (!demandDate) {
    throw new Error('Missing --demandDate=YYYY-MM-DD');
  }

  const take = Number(args.take ?? '10');
  if (!Number.isFinite(take) || take <= 0) {
    throw new Error('Invalid --take (must be > 0)');
  }

  return {
    branchCode: args.branchCode,
    centerCode: args.centerCode,
    demandDate,
    take,
  };
}

function toDayBoundsUtc(demandDate: string) {
  const start = new Date(`${demandDate}T00:00:00.000Z`);
  const end = new Date(`${demandDate}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid demandDate; expected YYYY-MM-DD');
  }
  return { start, end };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Create a local `.env.local` with DATABASE_URL=... (do NOT commit it).',
    );
  }

  const { branchCode, centerCode, demandDate, take } = getArgs();
  const { start: dayStartUtc, end: dayEndUtc } = toDayBoundsUtc(demandDate);

  // 1) Prove which date fields drive the report
  console.log('\nDATE SOURCES USED BY PLATFORM');
  console.log('- Demand/Arrear are installment-based: loan_schedules.due_date');
  console.log('- Collected is transaction-based: loan_transactions.transaction_date (REPAYMENT, APPROVED)');

  // 1.1) Quick data presence / date ranges (helps pick a real demandDate)
  const [scheduleRange, txRange, disbursedLoansCount] = await Promise.all([
    prisma.loanSchedule.aggregate({
      _min: { dueDate: true },
      _max: { dueDate: true },
      _count: { _all: true },
    }),
    prisma.loanTransaction.aggregate({
      _min: { transactionDate: true },
      _max: { transactionDate: true },
      _count: { _all: true },
    }),
    prisma.loan.count({ where: { disbursementStatus: 'DISBURSED' } }),
  ]);

  console.log('\nDB DATE RANGES (to choose demandDate)');
  console.log({
    loanSchedules: {
      count: scheduleRange._count._all,
      minDueDate: scheduleRange._min.dueDate?.toISOString() ?? null,
      maxDueDate: scheduleRange._max.dueDate?.toISOString() ?? null,
    },
    loanTransactions: {
      count: txRange._count._all,
      minTransactionDate: txRange._min.transactionDate?.toISOString() ?? null,
      maxTransactionDate: txRange._max.transactionDate?.toISOString() ?? null,
    },
    disbursedLoansCount,
  });

  // Resolve optional branch/center filters
  const branch =
    branchCode
      ? await prisma.branch.findUnique({
          where: { code: branchCode },
          select: { id: true, code: true, name: true },
        })
      : null;

  // Center.code is only unique per-branch now, not globally — scope by
  // branch when known, otherwise best-effort match on code alone.
  const center =
    centerCode
      ? await prisma.center.findFirst({
          where: { code: centerCode, ...(branch ? { branchId: branch.id } : {}) },
          select: { id: true, code: true, name: true, branchId: true },
        })
      : null;

  if (branchCode && !branch) {
    throw new Error(`Branch not found for code=${branchCode}`);
  }
  if (centerCode && !center) {
    throw new Error(`Center not found for code=${centerCode}`);
  }
  if (branch && center && center.branchId !== branch.id) {
    throw new Error(`Center ${center.code} does not belong to branch ${branch.code}`);
  }

  // 2) Clientwise demand/arrear snapshot from schedules (<= demandDate)
  // Note: the platform demand sheet typically scopes to DISBURSED loans, but this script prints both:
  // - schedule sample without loan-status filtering (to prove dueDate-based installment rows exist)
  // - counts with DISBURSED filtering (to match report logic)
  const scheduleWhereBase = {
    dueDate: { lte: new Date(`${demandDate}T23:59:59.999Z`) },
    loan: {
      ...(center ? { centerId: center.id } : {}),
      ...(branch ? { center: { branchId: branch.id } } : {}),
    },
  };

  const scheduleCountAnyStatus = await prisma.loanSchedule.count({ where: scheduleWhereBase });
  const scheduleCountNotPaid = await prisma.loanSchedule.count({
    where: { ...scheduleWhereBase, status: { not: 'PAID' as const } },
  });

  const scheduleStatusBreakdown = await prisma.loanSchedule.groupBy({
    by: ['status'],
    _count: { _all: true },
    orderBy: { status: 'asc' },
  });

  console.log('\nSCHEDULE QUICK COUNTS');
  console.log({
    demandDate,
    schedulesDueOnOrBeforeDate_anyStatus: scheduleCountAnyStatus,
    schedulesDueOnOrBeforeDate_statusNotPaid: scheduleCountNotPaid,
    statusBreakdownAllTime: scheduleStatusBreakdown.map((s) => ({ status: s.status, count: s._count._all })),
  });

  const scheduleRows = await prisma.loanSchedule.findMany({
    where: { ...scheduleWhereBase, status: { not: 'PAID' as const } },
    select: {
      dueDate: true,
      totalDue: true,
      totalPaid: true,
      loan: {
        select: {
          loanNumber: true,
          client: { select: { clientId: true, firstName: true, lastName: true } },
          center: { select: { code: true, name: true, branch: { select: { code: true, name: true } } } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    take,
  });

  console.log('\nSCHEDULE SAMPLE (demand/arrear source)');
  console.log(
    scheduleRows.map((r) => ({
      branch: r.loan.center.branch.code,
      center: r.loan.center.code,
      clientId: r.loan.client.clientId,
      clientName: `${r.loan.client.firstName} ${r.loan.client.lastName}`.trim(),
      loanNumber: r.loan.loanNumber,
      dueDate: r.dueDate.toISOString(),
      totalDue: Number(r.totalDue),
      totalPaid: Number(r.totalPaid),
      pending: Number(r.totalDue) - Number(r.totalPaid),
    })),
  );

  // Count installments by date bucket to prove the split logic (all loans)
  const [arrearCountAll, currentCountAll] = await Promise.all([
    prisma.loanSchedule.count({
      where: { ...scheduleWhereBase, status: { not: 'PAID' as const }, dueDate: { lt: new Date(`${demandDate}T00:00:00.000Z`) } },
    }),
    prisma.loanSchedule.count({
      where: {
        ...scheduleWhereBase,
        status: { not: 'PAID' as const },
        dueDate: { gte: new Date(`${demandDate}T00:00:00.000Z`), lte: new Date(`${demandDate}T23:59:59.999Z`) },
      },
    }),
  ]);

  console.log('\nSCHEDULE COUNTS');
  console.log({
    demandDate,
    arrearInstallmentsCount: arrearCountAll,
    currentDayInstallmentsCount: currentCountAll,
  });

  // Counts matching demand-sheet logic (DISBURSED loans only)
  const scheduleWhereDisbursed = {
    ...scheduleWhereBase,
    status: { not: 'PAID' as const },
    loan: {
      ...(scheduleWhereBase.loan as Record<string, unknown>),
      disbursementStatus: 'DISBURSED' as const,
    },
  };
  const [arrearCountDisbursed, currentCountDisbursed] = await Promise.all([
    prisma.loanSchedule.count({
      where: { ...scheduleWhereDisbursed, dueDate: { lt: new Date(`${demandDate}T00:00:00.000Z`) } },
    }),
    prisma.loanSchedule.count({
      where: {
        ...scheduleWhereDisbursed,
        dueDate: { gte: new Date(`${demandDate}T00:00:00.000Z`), lte: new Date(`${demandDate}T23:59:59.999Z`) },
      },
    }),
  ]);

  console.log('\nSCHEDULE COUNTS (DISBURSED loans only)');
  console.log({
    demandDate,
    arrearInstallmentsCount: arrearCountDisbursed,
    currentDayInstallmentsCount: currentCountDisbursed,
  });

  // 3) Clientwise collections from transactions (transactionDate)
  const txWhere = {
    type: 'REPAYMENT' as const,
    status: 'APPROVED' as const,
    isReversed: false,
    transactionDate: { gte: dayStartUtc, lte: dayEndUtc },
    ...(center ? { centerId: center.id } : {}),
    ...(branch ? { branchId: branch.id } : {}),
  };

  const txRows = await prisma.loanTransaction.findMany({
    where: txWhere,
    select: {
      transactionDate: true,
      amount: true,
      client: { select: { clientId: true, firstName: true, lastName: true } },
      loan: { select: { loanNumber: true } },
      center: { select: { code: true, name: true, branch: { select: { code: true, name: true } } } },
    },
    orderBy: { transactionDate: 'asc' },
    take,
  });

  console.log('\nTRANSACTION SAMPLE (collection source)');
 

  const txCount = await prisma.loanTransaction.count({ where: txWhere });
  console.log('\nTRANSACTION COUNTS');
  console.log({ demandDate, approvedRepaymentsCount: txCount });
}

main()
  .catch((e) => {
    console.error('\nDB CHECK FAILED');
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

