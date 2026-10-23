import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';
import {
  parseKolkataAttendanceDateYmd,
  getKolkataDayEndExclusiveUtc,
} from '@/app/lib/branch-lock';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { toDisplayDate } from '@/app/lib/date-format';

export function OPTIONS() {
  return handleCorsPreflight();
}

function formatDateDisplay(utcDate: Date): string {
  const ist = new Date(utcDate.getTime() + 330 * 60_000);
  const d = String(ist.getUTCDate()).padStart(2, '0');
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const y = ist.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Shared computation, used by the live GET below and by the Request-Queue
 * export adapter (app/lib/reports/report-registry.ts).
 */
export async function computeBranchProfile(branchId: string, reportDateParam: string | null) {
        // ── Date setup ────────────────────────────────────────────────
        const todayIst = toDisplayDate(new Date());
        const reportYmd = reportDateParam || todayIst;

        const reportDayStart = parseKolkataAttendanceDateYmd(reportYmd);
        const reportDayEnd = getKolkataDayEndExclusiveUtc(reportDayStart);

        // FY start: April 1 of the financial year containing reportDate
        const reportDateIST = new Date(reportDayStart.getTime() + 330 * 60_000);
        const month = reportDateIST.getUTCMonth(); // 0-indexed; April = 3
        const year = reportDateIST.getUTCFullYear();
        const fyYear = month >= 3 ? year : year - 1;
        const fyStart = parseKolkataAttendanceDateYmd(`${fyYear}-04-01`);

        const dayName = reportDayStart.toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: 'Asia/Kolkata',
        });

        // ── Branch info + hierarchy ───────────────────────────────────
        const [branch, area] = await Promise.all([
          prisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true, name: true, code: true, createdAt: true },
          }),
          prisma.area.findFirst({
            where: { branches: { some: { id: branchId } } },
            select: {
              name: true,
              division: {
                select: {
                  name: true,
                  region: { select: { name: true } },
                },
              },
            },
          }),
        ]);
        if (!branch) throw new Error('Branch not found');

        const regionName = area?.division?.region?.name ?? '—';
        const divisionName = area?.division?.name ?? '—';
        const areaName = area?.name ?? '—';

        // ── Operational counts ────────────────────────────────────────
        const [noOfCenters, noOfGroups, noOfFdo] = await Promise.all([
          prisma.center.count({
            where: { branchId, isActive: true, status: 'APPROVED' },
          }),
          prisma.group.count({
            where: { center: { branchId }, isActive: true },
          }),
          prisma.user.count({
            where: { branchId, role: 'FDO', isActive: true },
          }),
        ]);

        // ── Members ───────────────────────────────────────────────────
        const allApproved = await prisma.client.findMany({
          where: { center: { branchId }, approvalStatus: 'APPROVED' },
          select: {
            id: true,
            createdAt: true,
            isActive: true,
            inactiveDate: true,
          },
        });

        // Active DISBURSED loan client IDs (point-in-time)
        const disbursedLoans = await prisma.loan.findMany({
          where: { branchId, disbursementStatus: 'DISBURSED', isActive: true },
          select: { clientId: true },
        });
        const clientsWithLoans = new Set(disbursedLoans.map((l) => l.clientId));

        const activeApprovedIds = new Set(
          allApproved.filter((c) => c.isActive).map((c) => c.id)
        );
        const activeBorrowers = [...activeApprovedIds].filter((id) =>
          clientsWithLoans.has(id)
        ).length;
        const waitingBorrowers = [...activeApprovedIds].filter(
          (id) => !clientsWithLoans.has(id)
        ).length;

        // Since April members
        const saOpeningMembers = allApproved.filter(
          (c) =>
            c.createdAt < fyStart &&
            (!c.inactiveDate || c.inactiveDate >= fyStart)
        ).length;
        const saNewMembers = allApproved.filter(
          (c) => c.createdAt >= fyStart && c.createdAt < reportDayEnd
        ).length;
        const closingMembers = allApproved.filter(
          (c) => c.isActive && c.createdAt < reportDayEnd
        ).length;

        // Current day members
        const cdOpeningMembers = allApproved.filter(
          (c) => c.createdAt < reportDayStart
        ).length;
        const cdNewMembers = allApproved.filter(
          (c) => c.createdAt >= reportDayStart && c.createdAt < reportDayEnd
        ).length;

        // Rejected members
        const [saRejected, cdRejected] = await Promise.all([
          prisma.client.count({
            where: {
              center: { branchId },
              approvalStatus: 'REJECTED',
              updatedAt: { gte: fyStart, lt: reportDayEnd },
            },
          }),
          prisma.client.count({
            where: {
              center: { branchId },
              approvalStatus: 'REJECTED',
              updatedAt: { gte: reportDayStart, lt: reportDayEnd },
            },
          }),
        ]);

        // ── Outstanding balance (as of report date) ───────────────────
        const activeLoansForOS = await prisma.loan.findMany({
          where: { branchId, disbursementStatus: 'DISBURSED', isActive: true },
          select: {
            amount: true,
            principalPaid: true,
          },
        });

        let outstandingBalance = 0;
        for (const loan of activeLoansForOS) {
          outstandingBalance += Math.max(0, Number(loan.amount) - Number(loan.principalPaid));
        }

        // ── Arrear schedules (overdue as of report date) ──────────────
        const arrearSchedules = await prisma.loanSchedule.findMany({
          where: {
            loan: { branchId, disbursementStatus: 'DISBURSED', isActive: true },
            dueDate: { lt: reportDayEnd },
            status: { in: ['OVERDUE', 'PARTIALLY_PAID', 'PENDING'] },
          },
          select: {
            principalDue: true,
            principalPaid: true,
            interestDue: true,
            interestPaid: true,
            loan: { select: { clientId: true } },
          },
        });

        let cumulativeArrearPrincipal = 0;
        let cumulativeArrearInterest = 0;
        const arrearClientIds = new Set<string>();
        for (const s of arrearSchedules) {
          const pArr = Math.max(0, Number(s.principalDue) - Number(s.principalPaid));
          const iArr = Math.max(0, Number(s.interestDue) - Number(s.interestPaid));
          if (pArr > 0 || iArr > 0) {
            cumulativeArrearPrincipal += pArr;
            cumulativeArrearInterest += iArr;
            arrearClientIds.add(s.loan.clientId);
          }
        }
        const cumulativeArrear = cumulativeArrearPrincipal + cumulativeArrearInterest;
        const arrearMemberCount = arrearClientIds.size;
        const parPercent =
          outstandingBalance > 0
            ? Math.round((cumulativeArrear / outstandingBalance) * 10000) / 100
            : 0;

        // ── Since April loan disbursement ─────────────────────────────
        const saDisbursed = await prisma.loan.findMany({
          where: {
            branchId,
            disbursementStatus: 'DISBURSED',
            disbursedByBMAt: { gte: fyStart, lt: reportDayEnd },
          },
          select: { amount: true, clientId: true },
        });
        const saLoanDisbursement = saDisbursed.reduce(
          (s, l) => s + Number(l.amount),
          0
        );
        const saLoanDisbursementMemberCount = new Set(
          saDisbursed.map((l) => l.clientId)
        ).size;

        // ── Current day loan disbursement ─────────────────────────────
        const cdDisbursed = await prisma.loan.findMany({
          where: {
            branchId,
            disbursementStatus: 'DISBURSED',
            disbursedByBMAt: { gte: reportDayStart, lt: reportDayEnd },
          },
          select: { amount: true, clientId: true },
        });
        const cdLoanDisbursement = cdDisbursed.reduce(
          (s, l) => s + Number(l.amount),
          0
        );

        // ── Current day demand ────────────────────────────────────────
        const demandAgg = await prisma.loanSchedule.aggregate({
          where: {
            loan: { branchId, disbursementStatus: 'DISBURSED', isActive: true },
            dueDate: { gte: reportDayStart, lt: reportDayEnd },
          },
          _sum: { principalDue: true, interestDue: true },
        });
        const cdDemandPrincipal = Number(demandAgg._sum.principalDue || 0);
        const cdDemandInterest = Number(demandAgg._sum.interestDue || 0);
        const cdDemandTotal = cdDemandPrincipal + cdDemandInterest;

        // ── Current day collection ────────────────────────────────────
        const collAgg = await prisma.loanTransaction.aggregate({
          where: {
            branchId,
            type: 'REPAYMENT',
            status: 'APPROVED',
            transactionDate: { gte: reportDayStart, lt: reportDayEnd },
          },
          _sum: { principalAmount: true, interestAmount: true },
        });
        const cdCollectionPrincipal = Number(collAgg._sum.principalAmount || 0);
        const cdCollectionInterest = Number(collAgg._sum.interestAmount || 0);
        const cdCollectionTotal = cdCollectionPrincipal + cdCollectionInterest;

        const cdRecoveryRate =
          cdDemandTotal > 0
            ? Math.round((cdCollectionTotal / cdDemandTotal) * 10000) / 100
            : 0;

        // ── Arrear collection & advance collection (current day) ──────
        // Uses LoanTransactionLine → LoanSchedule.dueDate
        const txLines = await prisma.loanTransactionLine.findMany({
          where: {
            transaction: {
              branchId,
              type: 'REPAYMENT',
              status: 'APPROVED',
              transactionDate: { gte: reportDayStart, lt: reportDayEnd },
            },
          },
          select: {
            lineTotal: true,
            schedule: { select: { dueDate: true } },
          },
        });

        let cdArrearCollection = 0;
        let cdAdvanceCollection = 0;
        for (const line of txLines) {
          const dueDate = line.schedule?.dueDate;
          if (!dueDate) continue;
          if (dueDate < reportDayStart) {
            cdArrearCollection += Number(line.lineTotal);
          } else if (dueDate >= reportDayEnd) {
            cdAdvanceCollection += Number(line.lineTotal);
          }
        }

        return {
          branchInfo: {
            regionName,
            divisionName,
            areaName,
            branchId: branch.code,
            branchName: branch.name,
            branchStartDate: formatDateDisplay(branch.createdAt),
            noOfCenters,
            noOfGroups,
            noOfFdo,
          },
          reportMeta: {
            branchProfileDate: formatDateDisplay(reportDayStart),
            reportDayName: dayName,
            reportYmd,
          },
          sinceApril: {
            openingMembers: saOpeningMembers,
            newMembers: saNewMembers,
            rejectedMembers: saRejected,
            closingMembers,
            waitingBorrowers,
            activeMembers: activeBorrowers,
            loanDisbursement: Math.round(saLoanDisbursement),
            loanDisbursementMemberCount: saLoanDisbursementMemberCount,
            cumulativeArrear: Math.round(cumulativeArrear),
            arrearMemberCount,
            parPercent,
          },
          currentDay: {
            openingMembers: cdOpeningMembers,
            newMembers: cdNewMembers,
            rejectedMembers: cdRejected,
            closingMembers,
            waitingBorrowers,
            activeMembers: activeBorrowers,
            loanDisbursement: Math.round(cdLoanDisbursement),
            outstandingBalance: Math.round(outstandingBalance),
            demandPrincipal: Math.round(cdDemandPrincipal),
            demandInterest: Math.round(cdDemandInterest),
            demandTotal: Math.round(cdDemandTotal),
            collectionPrincipal: Math.round(cdCollectionPrincipal),
            collectionInterest: Math.round(cdCollectionInterest),
            collectionTotal: Math.round(cdCollectionTotal),
            arrearPrincipal: Math.round(cumulativeArrearPrincipal),
            arrearTotal: Math.round(cumulativeArrear),
            recoveryRate: cdRecoveryRate,
            arrearCollection: Math.round(cdArrearCollection),
            advanceCollection: Math.round(cdAdvanceCollection),
          },
        };
}

export async function GET(request: NextRequest) {
  return withRole(
    ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'],
    async (req, user) => {
      try {
        const { searchParams } = new URL(req.url);
        const reportDateParam = searchParams.get('reportDate');
        const branchIdParam = searchParams.get('branchId');

        // ── Branch resolution ──────────────────────────────────────────
        let branchId: string;
        if (user.role === 'ADMIN') {
          if (!branchIdParam) return errorResponse('Branch is required', 400);
          branchId = branchIdParam;
        } else if (user.role === 'AREA_MANAGER') {
          if (!branchIdParam) return errorResponse('Branch is required', 400);
          const assigned = await isAmAssignedToBranch(user.userId, branchIdParam);
          if (!assigned) return errorResponse('Branch not assigned to you', 403);
          branchId = branchIdParam;
        } else {
          if (!user.branchId) return errorResponse('No branch context', 400);
          branchId = user.branchId;
        }

        const result = await computeBranchProfile(branchId, reportDateParam);
        return successResponse(result);
      } catch (error: any) {
        console.error('Branch profile error:', error);
        return errorResponse(error.message || 'Internal server error', 500);
      }
    }
  )(request);
}
