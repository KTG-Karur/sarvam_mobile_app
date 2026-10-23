import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse } from '@/app/lib/api-utils';
import { startOfMonth, endOfMonth } from 'date-fns';

interface TaskRow {
  employeeId: string | null;
  name: string;
  branch: string;
  // Targets
  enrollmentTarget: number;
  newMemberTarget: number;
  renewalTarget: number;
  loanDisbursementTarget: number;
  // Achievement
  enrollmentAchieved: number;
  enrollmentBalance: number;
  newMemberAchieved: number;
  renewalAchieved: number;
  loanDisbursementAchieved: number;
  // Collection
  collectionTargetPct: number;
  actualCollectionPct: number;
  collectionDifferencePct: number;
  // Operations
  numberOfCenters: number;
  activeClients: number;
  // Member (no loan yet) vs Client (has at least one loan) split of activeClients
  activeMembers: number;
  activeClientsWithLoan: number;
  totalDisbursementMembers: number;
  // Gold Loan
  goldLoanMembers: number;
  goldLoanAmount: number;
  goldReturn: number;
  // Portfolio
  portfolioPrincipal: number;
  portfolioInterest: number;
  // Arrears
  arrearClients: number;
  arrearPrincipal: number;
  arrearInterest: number;
  arrearMemberPct: number;
}

async function computeFdoRow(
  fdo: { id: string; employeeId: string | null; firstName: string; lastName: string; branch: { id: string; code: string; name: string } | null },
  startDate: Date,
  endDate: Date,
  month: number,
  year: number
): Promise<TaskRow> {
  const today = new Date();
  const branchLabel = fdo.branch ? `${fdo.branch.code} - ${fdo.branch.name}` : 'N/A';

  const centers = await prisma.center.findMany({ where: { fdoId: fdo.id, isActive: true }, select: { id: true } });
  const centerIds = centers.map((c) => c.id);

  if (centerIds.length === 0) {
    const fdoTask = await prisma.fdoTask.findUnique({
      where: { userId_month_year: { userId: fdo.id, month, year } },
      select: { enrollmentTarget: true, newMemberTarget: true, renewalMemberTarget: true, loanDisbursementTarget: true },
    });
    return {
      employeeId: fdo.employeeId,
      name: `${fdo.firstName} ${fdo.lastName}`.trim(),
      branch: branchLabel,
      enrollmentTarget: fdoTask?.enrollmentTarget ?? 0,
      newMemberTarget: fdoTask?.newMemberTarget ?? 0,
      renewalTarget: fdoTask?.renewalMemberTarget ?? 0,
      loanDisbursementTarget: Number(fdoTask?.loanDisbursementTarget ?? 0),
      enrollmentAchieved: 0, enrollmentBalance: fdoTask?.enrollmentTarget ?? 0,
      newMemberAchieved: 0, renewalAchieved: 0, loanDisbursementAchieved: 0,
      collectionTargetPct: 100, actualCollectionPct: 100, collectionDifferencePct: 0,
      numberOfCenters: 0, activeClients: 0, activeMembers: 0, activeClientsWithLoan: 0, totalDisbursementMembers: 0,
      goldLoanMembers: 0, goldLoanAmount: 0, goldReturn: 0,
      portfolioPrincipal: 0, portfolioInterest: 0,
      arrearClients: 0, arrearPrincipal: 0, arrearInterest: 0, arrearMemberPct: 0,
    };
  }

  const [
    fdoTask,
    newMemberCount,
    renewalCount,
    disbursementAgg,
    activeClientCount,
    activeClientsWithLoanCount,
    goldLoansThisMonth,
    goldReturnCount,
    allSchedules,
  ] = await Promise.all([
    prisma.fdoTask.findUnique({
      where: { userId_month_year: { userId: fdo.id, month, year } },
      select: { enrollmentTarget: true, newMemberTarget: true, renewalMemberTarget: true, loanDisbursementTarget: true },
    }),
    prisma.client.count({ where: { enrolledById: fdo.id, createdAt: { gte: startDate, lte: endDate } } }),
    prisma.loan.count({
      where: {
        centerId: { in: centerIds },
        disbursementStatus: 'DISBURSED',
        disbursedByBMAt: { gte: startDate, lte: endDate },
        client: { loanApplications: { some: { disbursementStatus: 'DISBURSED', disbursedByBMAt: { lt: startDate } } } },
      },
    }),
    prisma.loan.aggregate({
      where: { centerId: { in: centerIds }, disbursementStatus: 'DISBURSED', disbursedByBMAt: { gte: startDate, lte: endDate } },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.client.count({ where: { centerId: { in: centerIds }, isActive: true } }),
    prisma.client.count({ where: { centerId: { in: centerIds }, isActive: true, loanApplications: { some: {} } } }),
    prisma.loan.findMany({
      where: {
        centerId: { in: centerIds },
        disbursementStatus: 'DISBURSED',
        disbursedByBMAt: { gte: startDate, lte: endDate },
        goldLoanDetail: { isNot: null },
      },
      select: { clientId: true, goldLoanDetail: { select: { cashGiven: true } } },
    }),
    prisma.goldTransaction.count({
      where: { type: 'GIVE', createdAt: { gte: startDate, lte: endDate }, loan: { centerId: { in: centerIds } } },
    }),
    prisma.loanSchedule.findMany({
      where: { loan: { centerId: { in: centerIds }, disbursementStatus: 'DISBURSED', isActive: true } },
      select: {
        dueDate: true,
        principalDue: true, interestDue: true, principalPaid: true, interestPaid: true,
        totalDue: true, totalPaid: true,
        loan: { select: { clientId: true } },
      },
    }),
  ]);

  let principalOutstanding = 0;
  let interestOutstanding = 0;
  let periodDemand = 0;
  let periodCollected = 0;
  let arrearDemandLegacy = 0;
  const arrearClientIds = new Set<string>();
  let arrearPrincipal = 0;
  let arrearInterest = 0;

  for (const s of allSchedules) {
    const dueDate = new Date(s.dueDate);
    const pDue = Number(s.principalDue), iDue = Number(s.interestDue);
    const pPaid = Number(s.principalPaid), iPaid = Number(s.interestPaid);
    const totalDue = Number(s.totalDue), totalPaid = Number(s.totalPaid);

    principalOutstanding += Math.max(0, pDue - pPaid);
    interestOutstanding += Math.max(0, iDue - iPaid);

    if (dueDate < today && totalPaid < totalDue) {
      arrearClientIds.add(s.loan.clientId);
      arrearPrincipal += Math.max(0, pDue - pPaid);
      arrearInterest += Math.max(0, iDue - iPaid);
      arrearDemandLegacy += totalDue - totalPaid;
    }

    if (dueDate >= startDate && dueDate <= endDate) {
      periodDemand += totalDue;
      periodCollected += totalPaid;
    }
  }

  const effectiveDemand = periodDemand + arrearDemandLegacy;
  const actualCollectionPct = effectiveDemand > 0 ? (periodCollected / effectiveDemand) * 100 : 100;

  const goldClientIds = new Set(goldLoansThisMonth.map((g) => g.clientId));
  const goldDisbursementAmount = goldLoansThisMonth.reduce((sum, g) => sum + Number(g.goldLoanDetail?.cashGiven ?? 0), 0);

  const enrollmentTarget = fdoTask?.enrollmentTarget ?? 0;
  const arrearClients = arrearClientIds.size;
  const arrearMemberPct = activeClientCount > 0 ? (arrearClients / activeClientCount) * 100 : 0;

  return {
    employeeId: fdo.employeeId,
    name: `${fdo.firstName} ${fdo.lastName}`.trim(),
    branch: branchLabel,
    enrollmentTarget,
    newMemberTarget: fdoTask?.newMemberTarget ?? 0,
    renewalTarget: fdoTask?.renewalMemberTarget ?? 0,
    loanDisbursementTarget: Number(fdoTask?.loanDisbursementTarget ?? 0),
    enrollmentAchieved: newMemberCount,
    enrollmentBalance: enrollmentTarget - newMemberCount,
    newMemberAchieved: newMemberCount,
    renewalAchieved: renewalCount,
    loanDisbursementAchieved: Math.round(Number(disbursementAgg._sum.amount ?? 0) * 100) / 100,
    collectionTargetPct: 100,
    actualCollectionPct: Math.round(actualCollectionPct * 100) / 100,
    collectionDifferencePct: Math.round((100 - actualCollectionPct) * 100) / 100,
    numberOfCenters: centerIds.length,
    activeClients: activeClientCount,
    activeClientsWithLoan: activeClientsWithLoanCount,
    activeMembers: activeClientCount - activeClientsWithLoanCount,
    totalDisbursementMembers: disbursementAgg._count.id,
    goldLoanMembers: goldClientIds.size,
    goldLoanAmount: Math.round(goldDisbursementAmount * 100) / 100,
    goldReturn: goldReturnCount,
    portfolioPrincipal: Math.round(principalOutstanding * 100) / 100,
    portfolioInterest: Math.round(interestOutstanding * 100) / 100,
    arrearClients,
    arrearPrincipal: Math.round(arrearPrincipal * 100) / 100,
    arrearInterest: Math.round(arrearInterest * 100) / 100,
    arrearMemberPct: Math.round(arrearMemberPct * 100) / 100,
  };
}

function aggregateRows(rows: TaskRow[], employeeId: string | null, name: string, branch: string): TaskRow {
  const base: TaskRow = {
    employeeId, name, branch,
    enrollmentTarget: 0, newMemberTarget: 0, renewalTarget: 0, loanDisbursementTarget: 0,
    enrollmentAchieved: 0, enrollmentBalance: 0, newMemberAchieved: 0, renewalAchieved: 0, loanDisbursementAchieved: 0,
    collectionTargetPct: 100, actualCollectionPct: 0, collectionDifferencePct: 0,
    numberOfCenters: 0, activeClients: 0, activeMembers: 0, activeClientsWithLoan: 0, totalDisbursementMembers: 0,
    goldLoanMembers: 0, goldLoanAmount: 0, goldReturn: 0,
    portfolioPrincipal: 0, portfolioInterest: 0,
    arrearClients: 0, arrearPrincipal: 0, arrearInterest: 0, arrearMemberPct: 0,
  };

  let collectionSum = 0;
  for (const r of rows) {
    base.enrollmentTarget += r.enrollmentTarget;
    base.newMemberTarget += r.newMemberTarget;
    base.renewalTarget += r.renewalTarget;
    base.loanDisbursementTarget += r.loanDisbursementTarget;
    base.enrollmentAchieved += r.enrollmentAchieved;
    base.enrollmentBalance += r.enrollmentBalance;
    base.newMemberAchieved += r.newMemberAchieved;
    base.renewalAchieved += r.renewalAchieved;
    base.loanDisbursementAchieved += r.loanDisbursementAchieved;
    base.numberOfCenters += r.numberOfCenters;
    base.activeClients += r.activeClients;
    base.activeMembers += r.activeMembers;
    base.activeClientsWithLoan += r.activeClientsWithLoan;
    base.totalDisbursementMembers += r.totalDisbursementMembers;
    base.goldLoanMembers += r.goldLoanMembers;
    base.goldLoanAmount += r.goldLoanAmount;
    base.goldReturn += r.goldReturn;
    base.portfolioPrincipal += r.portfolioPrincipal;
    base.portfolioInterest += r.portfolioInterest;
    base.arrearClients += r.arrearClients;
    base.arrearPrincipal += r.arrearPrincipal;
    base.arrearInterest += r.arrearInterest;
    collectionSum += r.actualCollectionPct;
  }

  base.actualCollectionPct = rows.length > 0 ? Math.round((collectionSum / rows.length) * 100) / 100 : 100;
  base.collectionDifferencePct = Math.round((100 - base.actualCollectionPct) * 100) / 100;
  base.arrearMemberPct = base.activeClients > 0 ? Math.round((base.arrearClients / base.activeClients) * 10000) / 100 : 0;

  return base;
}

/**
 * Shared computation, used by the live GET below and by the Request-Queue
 * export adapter (app/lib/reports/report-registry.ts).
 */
export async function computeTaskReport(monthNum: number, yearNum: number, branchId?: string | null, userId?: string | null) {
      const startDate = startOfMonth(new Date(yearNum, monthNum - 1, 1));
      const endDate = endOfMonth(new Date(yearNum, monthNum - 1, 1));

      const fdoWhere: Record<string, unknown> = { role: 'FDO', isActive: true };
      if (branchId) fdoWhere.branchId = branchId;
      if (userId) fdoWhere.id = userId;

      const fdos = await prisma.user.findMany({
        where: fdoWhere,
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          lastName: true,
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { firstName: 'asc' },
      });

      const fdoRows = await Promise.all(fdos.map((fdo) => computeFdoRow(fdo, startDate, endDate, monthNum, yearNum)));

      // Aggregate to BM level
      const bmMap = new Map<string, { rows: TaskRow[]; bm: { employeeId: string | null; name: string; branch: string } }>();
      for (let i = 0; i < fdos.length; i++) {
        const fdo = fdos[i];
        if (!fdo.branch) continue;
        const branchKey = fdo.branch.id;
        if (!bmMap.has(branchKey)) {
          const bm = await prisma.user.findFirst({
            where: { role: 'BRANCH_MANAGER', branchId: branchKey, isActive: true },
            select: { employeeId: true, firstName: true, lastName: true },
          });
          bmMap.set(branchKey, {
            rows: [],
            bm: {
              employeeId: bm?.employeeId ?? null,
              name: bm ? `${bm.firstName} ${bm.lastName}`.trim() : 'Unassigned',
              branch: `${fdo.branch.code} - ${fdo.branch.name}`,
            },
          });
        }
        bmMap.get(branchKey)!.rows.push(fdoRows[i]);
      }

      const bmRows: TaskRow[] = Array.from(bmMap.entries()).map(([, { rows, bm }]) =>
        aggregateRows(rows, bm.employeeId, bm.name, bm.branch)
      );

      // Aggregate to AM level
      const amMap = new Map<string, { rows: TaskRow[]; am: { employeeId: string | null; name: string } }>();
      for (const [branchKey, { rows }] of bmMap.entries()) {
        const amBranch = await prisma.areaManagerBranch.findFirst({
          where: { branchId: branchKey },
          include: { user: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
        });
        if (!amBranch) continue;
        const amId = amBranch.user.id;
        if (!amMap.has(amId)) {
          amMap.set(amId, {
            rows: [],
            am: {
              employeeId: amBranch.user.employeeId,
              name: `${amBranch.user.firstName} ${amBranch.user.lastName}`.trim(),
            },
          });
        }
        amMap.get(amId)!.rows.push(...rows);
      }

      const amRows: TaskRow[] = Array.from(amMap.entries()).map(([, { rows, am }]) =>
        aggregateRows(rows, am.employeeId, am.name, 'Area-wide')
      );

      // Aggregate to DM level
      const dmMap = new Map<string, { rows: TaskRow[]; dm: { employeeId: string | null; name: string } }>();
      for (const [branchKey, { rows }] of bmMap.entries()) {
        const area = await prisma.area.findFirst({ where: { branches: { some: { id: branchKey } } }, select: { divisionId: true } });
        if (!area) continue;
        const division = await prisma.division.findUnique({
          where: { id: area.divisionId },
          select: { managers: { where: { isActive: true }, select: { id: true, employeeId: true, firstName: true, lastName: true } } },
        });
        if (!division || division.managers.length === 0) continue;
        const dm = division.managers[0];
        if (!dmMap.has(dm.id)) {
          dmMap.set(dm.id, {
            rows: [],
            dm: { employeeId: dm.employeeId, name: `${dm.firstName} ${dm.lastName}`.trim() },
          });
        }
        dmMap.get(dm.id)!.rows.push(...rows);
      }

      const dmRows: TaskRow[] = Array.from(dmMap.entries()).map(([, { rows, dm }]) =>
        aggregateRows(rows, dm.employeeId, dm.name, 'Division-wide')
      );

      const totals = aggregateRows(fdoRows, null, 'TOTAL', 'Organization-wide');

      return { fdo: fdoRows, bm: bmRows, am: amRows, dm: dmRows, totals };
}

export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const month = req.nextUrl.searchParams.get('month');
      const year = req.nextUrl.searchParams.get('year');
      const branchId = req.nextUrl.searchParams.get('branchId');
      const userId = req.nextUrl.searchParams.get('userId');

      if (!month || !year) return errorResponse('month and year parameters are required', 400);

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);

      if (monthNum < 1 || monthNum > 12 || isNaN(yearNum)) return errorResponse('Invalid month (1-12) or year', 400);

      const result = await computeTaskReport(monthNum, yearNum, branchId, userId);
      return successResponse(result, 'Task report generated');
    } catch (error) {
      console.error('Error generating task report:', error);
      return errorResponse('Failed to generate task report', 500);
    }
  })(request);
}
