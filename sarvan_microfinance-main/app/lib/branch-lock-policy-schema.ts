import { prisma } from '@/app/lib/db';

type BranchLockColumnRow = {
    column_name: string;
};

/**
 * True when `20260326110000_eod_branch_lock_policy` (or equivalent) has been applied.
 * Legacy DBs only have id, branchId, currentWorkingDate, lockTime, timestamps.
 */
export async function hasBranchLockPolicyColumns(): Promise<boolean> {
    try {
        const rows = await prisma.$queryRaw<BranchLockColumnRow[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'branch_locks'
        AND column_name IN (
          'timezone',
          'defaultOpenMinutes',
          'defaultCloseMinutes',
          'effectiveWindowStartAt',
          'effectiveWindowEndAt',
          'isManuallyExtended',
          'manualOverrideUntil',
          'manualOverrideReason',
          'manualOverrideByUserId',
          'lastEodClosedAt',
          'lastEodClosedByUserId'
        )
    `;

        const existing = new Set(rows.map((row) => row.column_name));
        return (
            existing.has('timezone') &&
            existing.has('defaultOpenMinutes') &&
            existing.has('defaultCloseMinutes') &&
            existing.has('effectiveWindowStartAt') &&
            existing.has('effectiveWindowEndAt') &&
            existing.has('isManuallyExtended') &&
            existing.has('manualOverrideUntil') &&
            existing.has('manualOverrideReason') &&
            existing.has('manualOverrideByUserId') &&
            existing.has('lastEodClosedAt') &&
            existing.has('lastEodClosedByUserId')
        );
    } catch {
        return false;
    }
}
