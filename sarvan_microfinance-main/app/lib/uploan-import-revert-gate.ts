import { prisma } from '@/app/lib/prisma';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/** Calendar days (IST, counting the completion day itself) a completed import stays revertable. */
export const UPLOAN_REVERT_WINDOW_DAYS = 7;

/**
 * A one-week revert window, IST calendar-day based — bounds the blast radius of undoing a
 * bulk uploan import without needing to trace every downstream consequence of an old one.
 */
export function isWithinRevertWindow(jobCompletedAt: Date, now: Date = new Date()): boolean {
    const toDayNumber = (d: Date) => Date.parse(`${getKolkataCalendarYmd(d)}T00:00:00Z`) / 86_400_000;
    const elapsedDays = toDayNumber(now) - toDayNumber(jobCompletedAt);
    return elapsedDays >= 0 && elapsedDays < UPLOAN_REVERT_WINDOW_DAYS;
}

/**
 * Every LoanTransaction backup-loan.service.ts creates is stamped
 * excludeFromEodAllocation: true (Phase 5). A loan that has since received real
 * activity — a live collection recorded through the normal app — will have at least
 * one LoanTransaction WITHOUT that flag. Returns the loanIds carrying that signal, so
 * revert can skip (not delete) those specific rows while reverting the rest of the job
 * normally.
 */
export async function findRowsWithPostImportActivity(
    rows: { loanId: string | null }[]
): Promise<Set<string>> {
    const loanIds = rows.map((r) => r.loanId).filter((id): id is string => !!id);
    if (loanIds.length === 0) return new Set();

    const flagged = await prisma.loanTransaction.findMany({
        where: { loanId: { in: loanIds }, excludeFromEodAllocation: false },
        select: { loanId: true },
        distinct: ['loanId'],
    });
    return new Set(flagged.map((f) => f.loanId));
}
