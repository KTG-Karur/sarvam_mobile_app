import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { deriveEodStartDates } from '@/app/lib/branch-eod-start';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';
import { BRANCH_LOCK_TIMEZONE, getKolkataCalendarYmd } from '@/app/lib/branch-lock';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/branches/lock
 * Read-only branch working-date registry — backs the "Branch Working Date" admin page
 * (components/branch/BranchWorkingDateClient.tsx). The write-window/"Extend Lock" POST
 * endpoint that used to live here was removed along with business-hours enforcement
 * (see assertBranchNotLocked in app/lib/branch-lock.ts) — employees may submit
 * transactions any time of day now, so there is nothing left to extend.
 */
export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async () => {
    try {
      const [branches, centers, loanClientRows] = await Promise.all([
        prisma.branch.findMany({
          where: { isActive: true, code: { not: 'HO' } },
          include: {
            lock: {
              select: {
                id: true,
                branchId: true,
                currentWorkingDate: true,
                lockTime: true,
                lastEodClosedAt: true,
              },
            },
            areas: {
              select: {
                id: true,
                name: true,
                division: {
                  select: {
                    id: true,
                    name: true,
                    region: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
          orderBy: {
            code: 'asc',
          },
        }),
        prisma.center.findMany({ where: { isActive: true }, select: { id: true, branchId: true } }),
        // Active / inactive CLIENT is loan-based: a client is "active" while they hold
        // at least one DISBURSED loan, and "inactive" once every loan they had is CLOSED
        // (no running loan left). One row per (branch, client, status) — distinct clients
        // are tallied per branch below.
        prisma.loan.groupBy({
          by: ['branchId', 'clientId', 'disbursementStatus'],
          where: { disbursementStatus: { in: ['DISBURSED', 'CLOSED'] } },
        }),
      ]);

      const centerCountByBranch = new Map<string, number>();
      const branchIdByCenterId = new Map<string, string>();
      for (const c of centers) {
        centerCountByBranch.set(c.branchId, (centerCountByBranch.get(c.branchId) ?? 0) + 1);
        branchIdByCenterId.set(c.id, c.branchId);
      }

      const activeClientIds = new Map<string, Set<string>>();
      const closedClientIds = new Map<string, Set<string>>();
      for (const row of loanClientRows) {
        const target = row.disbursementStatus === 'DISBURSED' ? activeClientIds : closedClientIds;
        if (!target.has(row.branchId)) target.set(row.branchId, new Set());
        target.get(row.branchId)!.add(row.clientId);
      }
      const activeClientsByBranch = new Map<string, number>();
      const inactiveClientsByBranch = new Map<string, number>();
      for (const [branchId, ids] of activeClientIds) activeClientsByBranch.set(branchId, ids.size);
      for (const [branchId, ids] of closedClientIds) {
        const active = activeClientIds.get(branchId);
        let n = 0;
        for (const id of ids) if (!active?.has(id)) n++;
        inactiveClientsByBranch.set(branchId, n);
      }

      // Same fallback the branch edit form shows: when no eodStartDate is on record,
      // use the earliest real activity date for the branch.
      const derivedStartByBranch = await deriveEodStartDates(
        branches.filter((b) => !b.eodStartDate).map((b) => b.id)
      );

      const currentDate = new Date();
      const todayYmd = getKolkataCalendarYmd(currentDate);
      const branchLocks = branches.map((branch) => {
        const lock = branch.lock;
        const currentWorkingDate = lock?.currentWorkingDate ?? currentDate;
        const workingDateYmd = getKolkataCalendarYmd(currentWorkingDate);
        const diffDays = Math.round(
          (new Date(`${todayYmd}T00:00:00Z`).getTime() - new Date(`${workingDateYmd}T00:00:00Z`).getTime()) /
            (24 * 60 * 60 * 1000)
        );

        // A branch may (rarely) sit under more than one Area — take the first for display.
        const area = branch.areas[0] ?? null;
        const division = area?.division ?? null;
        const region = division?.region ?? null;

        return {
          id: branch.id,
          branchId: branch.id,
          branchCode: branch.code,
          branchName: branch.name,
          regionName: region?.name ?? 'N/A',
          divisionName: division?.name ?? 'N/A',
          areaName: area?.name ?? 'N/A',
          eodStartDate: (branch.eodStartDate ?? derivedStartByBranch.get(branch.id))?.toISOString() ?? null,
          currentDate: currentDate.toISOString(),
          currentWorkingDate: currentWorkingDate.toISOString(),
          lastEodClosedAt: lock?.lastEodClosedAt?.toISOString() ?? null,
          diffFromCurrentDate: diffDays,
          timezone: BRANCH_LOCK_TIMEZONE,
          noOfCenters: centerCountByBranch.get(branch.id) ?? 0,
          noOfActiveClients: activeClientsByBranch.get(branch.id) ?? 0,
          noOfInactiveClients: inactiveClientsByBranch.get(branch.id) ?? 0,
        };
      });

      return successResponse(branchLocks, 'Branch working dates fetched successfully');
    } catch (error) {
      console.error('Error fetching branch working dates:', error);
      return errorResponse('Failed to fetch branch working dates', 500);
    }
  })(request);
}

