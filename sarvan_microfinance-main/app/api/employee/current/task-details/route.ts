import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse } from '@/app/lib/api-utils';
import { startOfMonth, endOfMonth } from 'date-fns';

interface FdoMetrics {
  targets: { enrollmentTarget: number; newMemberTarget: number; renewalMemberTarget: number; loanDisbursementTarget: number };
  achievement: { newMember: number; renewal: number; goldLoan: number; disbursementAmount: number };
  operations: { numberOfCenters: number; activeClients: number; activeMembers: number; activeClientsWithLoan: number; totalDisbursementMembers: number; totalDisbursementAmount: number };
  goldLoan: { numberOfMembers: number; disbursementAmount: number; goldReturn: number };
  portfolio: { principalOutstanding: number; interestOutstanding: number };
  arrear: { arrearClients: number; arrearPrincipal: number; arrearInterest: number };
  arrearMemberPct: number;
  enrollmentTarget: number;
  enrollmentAchieved: number;
  enrollmentBalance: number;
  collectionTargetPct: number;
  actualCollectionPct: number;
  collectionDifferencePct: number;
}

async function computeFdoMetrics(
  fdoId: string,
  centerIds: string[],
  startDate: Date,
  endDate: Date,
  month: number,
  year: number
): Promise<FdoMetrics> {
  const today = new Date();

  if (centerIds.length === 0) {
    return emptyMetrics(fdoId, month, year);
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
      where: { userId_month_year: { userId: fdoId, month, year } },
      select: { enrollmentTarget: true, newMemberTarget: true, renewalMemberTarget: true, loanDisbursementTarget: true },
    }),
    prisma.client.count({
      where: { enrolledById: fdoId, createdAt: { gte: startDate, lte: endDate } },
    }),
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
      where: {
        type: 'GIVE',
        createdAt: { gte: startDate, lte: endDate },
        loan: { centerId: { in: centerIds } },
      },
    }),
    // Fetch all schedule data for portfolio + arrear + legacy collection in one query
    prisma.loanSchedule.findMany({
      where: {
        loan: { centerId: { in: centerIds }, disbursementStatus: 'DISBURSED', isActive: true },
      },
      select: {
        dueDate: true,
        principalDue: true,
        interestDue: true,
        principalPaid: true,
        interestPaid: true,
        loan: { select: { clientId: true } },
      },
    }),
  ]);

  // Aggregate portfolio, arrear, and collection from schedule data
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
    const pDue = Number(s.principalDue);
    const iDue = Number(s.interestDue);
    const pPaid = Number(s.principalPaid);
    const iPaid = Number(s.interestPaid);
    // Loan (P+I) portion only — NOT s.totalDue/s.totalPaid: legacy/migrated schedules
    // (Ongoing Loan Backup import) can carry a totalDue copied straight from the source
    // spreadsheet, which may already include savings. principalDue/principalPaid and
    // interestDue/interestPaid are the only reliably loan-only figures (mirrors the same
    // fix in app/api/dashboard/v2/route.ts).
    const outstandingPrincipal = Math.max(0, pDue - pPaid);
    const outstandingInterest = Math.max(0, iDue - iPaid);

    // Portfolio outstanding (unpaid portion of all active schedules)
    principalOutstanding += outstandingPrincipal;
    interestOutstanding += outstandingInterest;

    // Arrear: overdue and unpaid
    if (dueDate < today && (outstandingPrincipal > 0 || outstandingInterest > 0)) {
      arrearClientIds.add(s.loan.clientId);
      arrearPrincipal += outstandingPrincipal;
      arrearInterest += outstandingInterest;
      arrearDemandLegacy += outstandingPrincipal + outstandingInterest;
    }

    // Collection calc (period demand vs collected)
    if (dueDate >= startDate && dueDate <= endDate) {
      periodDemand += pDue + iDue;
      periodCollected += pPaid + iPaid;
    }
  }

  const effectiveDemand = periodDemand + arrearDemandLegacy;
  const actualCollectionPct = effectiveDemand > 0 ? (periodCollected / effectiveDemand) * 100 : 100;

  const enrollmentTarget = fdoTask?.enrollmentTarget ?? 0;
  const arrearClients = arrearClientIds.size;
  const arrearMemberPct = activeClientCount > 0 ? (arrearClients / activeClientCount) * 100 : 0;

  const goldClientIds = new Set(goldLoansThisMonth.map((g) => g.clientId));
  const goldDisbursementAmount = goldLoansThisMonth.reduce((sum, g) => sum + Number(g.goldLoanDetail?.cashGiven ?? 0), 0);

  return {
    targets: {
      enrollmentTarget,
      newMemberTarget: fdoTask?.newMemberTarget ?? 0,
      renewalMemberTarget: fdoTask?.renewalMemberTarget ?? 0,
      loanDisbursementTarget: Number(fdoTask?.loanDisbursementTarget ?? 0),
    },
    achievement: {
      newMember: newMemberCount,
      renewal: renewalCount,
      goldLoan: goldLoansThisMonth.length,
      disbursementAmount: Number(disbursementAgg._sum.amount ?? 0),
    },
    operations: {
      numberOfCenters: centerIds.length,
      activeClients: activeClientCount,
      activeClientsWithLoan: activeClientsWithLoanCount,
      activeMembers: activeClientCount - activeClientsWithLoanCount,
      totalDisbursementMembers: disbursementAgg._count.id,
      totalDisbursementAmount: Number(disbursementAgg._sum.amount ?? 0),
    },
    goldLoan: {
      numberOfMembers: goldClientIds.size,
      disbursementAmount: Math.round(goldDisbursementAmount * 100) / 100,
      goldReturn: goldReturnCount,
    },
    portfolio: {
      principalOutstanding: Math.round(principalOutstanding * 100) / 100,
      interestOutstanding: Math.round(interestOutstanding * 100) / 100,
    },
    arrear: { arrearClients, arrearPrincipal: Math.round(arrearPrincipal * 100) / 100, arrearInterest: Math.round(arrearInterest * 100) / 100 },
    arrearMemberPct: Math.round(arrearMemberPct * 100) / 100,
    enrollmentTarget,
    enrollmentAchieved: newMemberCount,
    enrollmentBalance: enrollmentTarget - newMemberCount,
    collectionTargetPct: 100,
    actualCollectionPct: Math.round(actualCollectionPct * 100) / 100,
    collectionDifferencePct: Math.round((100 - actualCollectionPct) * 100) / 100,
  };
}

async function emptyMetrics(fdoId: string, month: number, year: number): Promise<FdoMetrics> {
  const fdoTask = await prisma.fdoTask.findUnique({
    where: { userId_month_year: { userId: fdoId, month, year } },
    select: { enrollmentTarget: true, newMemberTarget: true, renewalMemberTarget: true, loanDisbursementTarget: true },
  });
  const enrollmentTarget = fdoTask?.enrollmentTarget ?? 0;
  return {
    targets: { enrollmentTarget, newMemberTarget: fdoTask?.newMemberTarget ?? 0, renewalMemberTarget: fdoTask?.renewalMemberTarget ?? 0, loanDisbursementTarget: Number(fdoTask?.loanDisbursementTarget ?? 0) },
    achievement: { newMember: 0, renewal: 0, goldLoan: 0, disbursementAmount: 0 },
    operations: { numberOfCenters: 0, activeClients: 0, activeMembers: 0, activeClientsWithLoan: 0, totalDisbursementMembers: 0, totalDisbursementAmount: 0 },
    goldLoan: { numberOfMembers: 0, disbursementAmount: 0, goldReturn: 0 },
    portfolio: { principalOutstanding: 0, interestOutstanding: 0 },
    arrear: { arrearClients: 0, arrearPrincipal: 0, arrearInterest: 0 },
    arrearMemberPct: 0,
    enrollmentTarget,
    enrollmentAchieved: 0,
    enrollmentBalance: enrollmentTarget,
    collectionTargetPct: 100,
    actualCollectionPct: 100,
    collectionDifferencePct: 0,
  };
}

function sumMetrics(list: FdoMetrics[], subordinateCount: number) {
  const r: FdoMetrics = {
    targets: { enrollmentTarget: 0, newMemberTarget: 0, renewalMemberTarget: 0, loanDisbursementTarget: 0 },
    achievement: { newMember: 0, renewal: 0, goldLoan: 0, disbursementAmount: 0 },
    operations: { numberOfCenters: 0, activeClients: 0, activeMembers: 0, activeClientsWithLoan: 0, totalDisbursementMembers: 0, totalDisbursementAmount: 0 },
    goldLoan: { numberOfMembers: 0, disbursementAmount: 0, goldReturn: 0 },
    portfolio: { principalOutstanding: 0, interestOutstanding: 0 },
    arrear: { arrearClients: 0, arrearPrincipal: 0, arrearInterest: 0 },
    arrearMemberPct: 0,
    enrollmentTarget: 0,
    enrollmentAchieved: 0,
    enrollmentBalance: 0,
    collectionTargetPct: 100,
    actualCollectionPct: 0,
    collectionDifferencePct: 0,
  };

  let collectionSum = 0;
  for (const m of list) {
    r.targets.enrollmentTarget += m.targets.enrollmentTarget;
    r.targets.newMemberTarget += m.targets.newMemberTarget;
    r.targets.renewalMemberTarget += m.targets.renewalMemberTarget;
    r.targets.loanDisbursementTarget += m.targets.loanDisbursementTarget;
    r.achievement.newMember += m.achievement.newMember;
    r.achievement.renewal += m.achievement.renewal;
    r.achievement.goldLoan += m.achievement.goldLoan;
    r.achievement.disbursementAmount += m.achievement.disbursementAmount;
    r.operations.numberOfCenters += m.operations.numberOfCenters;
    r.operations.activeClients += m.operations.activeClients;
    r.operations.activeMembers += m.operations.activeMembers;
    r.operations.activeClientsWithLoan += m.operations.activeClientsWithLoan;
    r.operations.totalDisbursementMembers += m.operations.totalDisbursementMembers;
    r.operations.totalDisbursementAmount += m.operations.totalDisbursementAmount;
    r.goldLoan.numberOfMembers += m.goldLoan.numberOfMembers;
    r.goldLoan.disbursementAmount += m.goldLoan.disbursementAmount;
    r.goldLoan.goldReturn += m.goldLoan.goldReturn;
    r.portfolio.principalOutstanding += m.portfolio.principalOutstanding;
    r.portfolio.interestOutstanding += m.portfolio.interestOutstanding;
    r.arrear.arrearClients += m.arrear.arrearClients;
    r.arrear.arrearPrincipal += m.arrear.arrearPrincipal;
    r.arrear.arrearInterest += m.arrear.arrearInterest;
    r.enrollmentTarget += m.enrollmentTarget;
    r.enrollmentAchieved += m.enrollmentAchieved;
    r.enrollmentBalance += m.enrollmentBalance;
    collectionSum += m.actualCollectionPct;
  }

  r.arrearMemberPct = r.operations.activeClients > 0
    ? Math.round((r.arrear.arrearClients / r.operations.activeClients) * 10000) / 100
    : 0;
  r.actualCollectionPct = list.length > 0 ? Math.round((collectionSum / list.length) * 100) / 100 : 100;
  r.collectionDifferencePct = Math.round((100 - r.actualCollectionPct) * 100) / 100;

  return { metrics: r, subordinateCount };
}

async function getFdoMetricsList(fdoIds: string[], startDate: Date, endDate: Date, month: number, year: number) {
  return Promise.all(
    fdoIds.map(async (fdoId) => {
      const centers = await prisma.center.findMany({ where: { fdoId, isActive: true }, select: { id: true } });
      return computeFdoMetrics(fdoId, centers.map((c) => c.id), startDate, endDate, month, year);
    })
  );
}

type TargetUser = { id: string; role: string; branchId: string | null; firstName: string; lastName: string };

async function computeForUser(targetUser: TargetUser, startDate: Date, endDate: Date, month: number, year: number) {
  const name = `${targetUser.firstName} ${targetUser.lastName}`.trim();

  if (targetUser.role === 'FDO') {
    const centers = await prisma.center.findMany({ where: { fdoId: targetUser.id, isActive: true }, select: { id: true } });
    const metrics = await computeFdoMetrics(targetUser.id, centers.map((c) => c.id), startDate, endDate, month, year);
    return { role: targetUser.role, name, month, year, subordinateCount: 0, ...metrics };
  }

  if (targetUser.role === 'BRANCH_MANAGER') {
    if (!targetUser.branchId) return null;
    const fdos = await prisma.user.findMany({ where: { branchId: targetUser.branchId, role: 'FDO', isActive: true }, select: { id: true } });
    const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
    const { metrics } = sumMetrics(metricsList, fdos.length);
    return { role: targetUser.role, name, month, year, subordinateCount: fdos.length, ...metrics };
  }

  if (targetUser.role === 'AREA_MANAGER') {
    const amBranches = await prisma.areaManagerBranch.findMany({ where: { userId: targetUser.id }, select: { branchId: true } });
    const branchIds = amBranches.map((ab) => ab.branchId);
    const [fdos, bms] = await Promise.all([
      prisma.user.findMany({ where: { branchId: { in: branchIds }, role: 'FDO', isActive: true }, select: { id: true } }),
      prisma.user.findMany({ where: { branchId: { in: branchIds }, role: 'BRANCH_MANAGER', isActive: true }, select: { id: true } }),
    ]);
    const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
    const { metrics } = sumMetrics(metricsList, bms.length);
    return { role: targetUser.role, name, month, year, subordinateCount: bms.length, ...metrics };
  }

  if (targetUser.role === 'DIVISION_MANAGER') {
    const divBranches = await prisma.branch.findMany({
      where: { areas: { some: { division: { managers: { some: { id: targetUser.id } } } } } },
      select: { id: true },
    });
    const branchIds = divBranches.map((b) => b.id);
    const [fdos, ams] = await Promise.all([
      prisma.user.findMany({ where: { branchId: { in: branchIds }, role: 'FDO', isActive: true }, select: { id: true } }),
      prisma.areaManagerBranch.findMany({ where: { branchId: { in: branchIds } }, distinct: ['userId'], select: { userId: true } }),
    ]);
    const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
    const { metrics } = sumMetrics(metricsList, ams.length);
    return { role: targetUser.role, name, month, year, subordinateCount: ams.length, ...metrics };
  }

  return null;
}

async function isAuthorizedToView(requester: TargetUser, target: TargetUser): Promise<boolean> {
  if (requester.role === 'ADMIN') return true;

  if (requester.role === 'BRANCH_MANAGER') {
    return (target.role === 'FDO') && target.branchId === requester.branchId;
  }

  if (requester.role === 'AREA_MANAGER') {
    const amBranches = await prisma.areaManagerBranch.findMany({ where: { userId: requester.id }, select: { branchId: true } });
    const branchIds = amBranches.map((ab) => ab.branchId);
    if (target.role === 'FDO' || target.role === 'BRANCH_MANAGER') {
      return target.branchId !== null && branchIds.includes(target.branchId);
    }
    return false;
  }

  if (requester.role === 'DIVISION_MANAGER') {
    const divBranches = await prisma.branch.findMany({
      where: { areas: { some: { division: { managers: { some: { id: requester.id } } } } } },
      select: { id: true },
    });
    const branchIds = divBranches.map((b) => b.id);
    if (target.role === 'FDO' || target.role === 'BRANCH_MANAGER') {
      return target.branchId !== null && branchIds.includes(target.branchId);
    }
    if (target.role === 'AREA_MANAGER') {
      const amBranches = await prisma.areaManagerBranch.findMany({ where: { userId: target.id }, select: { branchId: true } });
      return amBranches.some((ab) => branchIds.includes(ab.branchId));
    }
    return false;
  }

  return false;
}

export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (!user.userId) return errorResponse('User ID not found', 401);

      const userData = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { id: true, firstName: true, lastName: true, role: true, branchId: true },
      });

      if (!userData) return errorResponse('User not found', 404);

      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const startDate = startOfMonth(new Date(year, month - 1, 1));
      const endDate = endOfMonth(new Date(year, month - 1, 1));
      const name = `${userData.firstName} ${userData.lastName}`.trim();

      // Drill-down: view another user's metrics (DM→AM/BM/FDO, AM→BM/FDO, BM→FDO)
      const viewUserIdParam = req.nextUrl.searchParams.get('viewUserId');
      if (viewUserIdParam) {
        const targetUser = await prisma.user.findUnique({
          where: { id: viewUserIdParam },
          select: { id: true, role: true, branchId: true, firstName: true, lastName: true },
        });
        if (!targetUser) return errorResponse('Viewed user not found', 404);

        const authorized = await isAuthorizedToView(
          { id: userData.id, role: userData.role, branchId: userData.branchId ?? null, firstName: userData.firstName, lastName: userData.lastName },
          { id: targetUser.id, role: targetUser.role, branchId: targetUser.branchId ?? null, firstName: targetUser.firstName, lastName: targetUser.lastName }
        );
        if (!authorized) return errorResponse('Not authorized to view this user\'s data', 403);

        const result = await computeForUser(
          { id: targetUser.id, role: targetUser.role, branchId: targetUser.branchId ?? null, firstName: targetUser.firstName, lastName: targetUser.lastName },
          startDate, endDate, month, year
        );
        if (!result) return errorResponse('Cannot compute metrics for this user', 400);

        return successResponse(result, 'Task details retrieved');
      }

      if (userData.role === 'FDO') {
        const centers = await prisma.center.findMany({ where: { fdoId: userData.id, isActive: true }, select: { id: true } });
        const metrics = await computeFdoMetrics(userData.id, centers.map((c) => c.id), startDate, endDate, month, year);
        return successResponse({ role: userData.role, name, month, year, subordinateCount: 0, ...metrics }, 'Task details retrieved');
      }

      if (userData.role === 'BRANCH_MANAGER') {
        if (!userData.branchId) return errorResponse('Branch Manager not assigned to a branch', 404);
        const fdos = await prisma.user.findMany({ where: { branchId: userData.branchId, role: 'FDO', isActive: true }, select: { id: true } });
        const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
        const { metrics, subordinateCount } = sumMetrics(metricsList, fdos.length);
        return successResponse({ role: userData.role, name, month, year, subordinateCount, ...metrics }, 'Task details retrieved');
      }

      if (userData.role === 'AREA_MANAGER') {
        const amBranches = await prisma.areaManagerBranch.findMany({ where: { userId: userData.id }, select: { branchId: true } });
        if (amBranches.length === 0) return errorResponse('Area Manager not assigned to any branches', 404);
        const branchIds = amBranches.map((ab) => ab.branchId);
        const fdos = await prisma.user.findMany({ where: { branchId: { in: branchIds }, role: 'FDO', isActive: true }, select: { id: true } });
        const bms = await prisma.user.findMany({ where: { branchId: { in: branchIds }, role: 'BRANCH_MANAGER', isActive: true }, select: { id: true } });
        const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
        const { metrics } = sumMetrics(metricsList, bms.length);
        return successResponse({ role: userData.role, name, month, year, subordinateCount: bms.length, ...metrics }, 'Task details retrieved');
      }

      if (userData.role === 'DIVISION_MANAGER') {
        const divBranches = await prisma.branch.findMany({
          where: { areas: { some: { division: { managers: { some: { id: userData.id } } } } } },
          select: { id: true },
        });
        const branchIds = divBranches.map((b) => b.id);
        const fdos = await prisma.user.findMany({ where: { branchId: { in: branchIds }, role: 'FDO', isActive: true }, select: { id: true } });
        const ams = await prisma.areaManagerBranch.findMany({
          where: { branchId: { in: branchIds } },
          distinct: ['userId'],
          select: { userId: true },
        });
        const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
        const { metrics } = sumMetrics(metricsList, ams.length);
        return successResponse({ role: userData.role, name, month, year, subordinateCount: ams.length, ...metrics }, 'Task details retrieved');
      }

      if (userData.role === 'ADMIN') {
        const branchId = req.nextUrl.searchParams.get('branchId');
        const areaId = req.nextUrl.searchParams.get('areaId');
        const divisionId = req.nextUrl.searchParams.get('divisionId');
        const regionId = req.nextUrl.searchParams.get('regionId');

        // Build FDO filter based on admin filters
        let fdoWhere: Record<string, unknown> = { role: 'FDO', isActive: true };

        if (branchId) {
          fdoWhere.branchId = branchId;
        } else if (areaId) {
          const areaBranches = await prisma.branch.findMany({
            where: { areas: { some: { id: areaId } } },
            select: { id: true },
          });
          fdoWhere.branchId = { in: areaBranches.map((b) => b.id) };
        } else if (divisionId) {
          const divBranches = await prisma.branch.findMany({
            where: { areas: { some: { divisionId } } },
            select: { id: true },
          });
          fdoWhere.branchId = { in: divBranches.map((b) => b.id) };
        } else if (regionId) {
          const regBranches = await prisma.branch.findMany({
            where: { areas: { some: { division: { regionId } } } },
            select: { id: true },
          });
          fdoWhere.branchId = { in: regBranches.map((b) => b.id) };
        }

        const fdos = await prisma.user.findMany({ where: fdoWhere, select: { id: true } });
        const metricsList = await getFdoMetricsList(fdos.map((f) => f.id), startDate, endDate, month, year);
        const { metrics } = sumMetrics(metricsList, fdos.length);
        return successResponse({ role: userData.role, name, month, year, subordinateCount: fdos.length, ...metrics }, 'Task details retrieved');
      }

      return errorResponse('Task details not available for this role', 403);
    } catch (error) {
      console.error('Error fetching task details:', error);
      return errorResponse('Failed to fetch task details', 500);
    }
  })(request);
}
