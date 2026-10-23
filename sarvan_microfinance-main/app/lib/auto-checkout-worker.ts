import { prisma } from '@/app/lib/db';
import { deriveDayStatusFromHours } from '@/app/lib/attendance-config';
import { getWorkingHours } from '@/app/lib/working-hours';
import { resolveEmployeeShiftConfig } from '@/app/lib/employee-shift';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

/**
 * In-process background worker for Auto Punch-Out (Working Hours page's
 * Auto-close time) — started once (from repo-root instrumentation.ts) on a
 * persistent `next start` process, same pattern as the report-export and
 * bulk-import queue workers (app/lib/reports/report-request-worker.ts).
 * Polls every minute; once the current IST time reaches the admin-configured
 * autoCheckoutTime, closes out every open punch (checkIn set, checkOut still
 * null, not already marked a holiday) for TODAY across all branches.
 *
 * The manual Daily-Register-save path (app/api/payroll/attendance/route.ts)
 * still separately auto-closes PAST days whenever an admin saves that date's
 * register — this worker is what closes out TODAY unattended at the
 * configured time, without needing anyone to open the register at all.
 */

const POLL_INTERVAL_MS = 60_000;
let lastRunKey: string | null = null;

declare global {
    // eslint-disable-next-line no-var
    var __autoCheckoutInterval: NodeJS.Timeout | undefined;
}

export function startAutoCheckoutWorker(): void {
    if (globalThis.__autoCheckoutInterval) {
        clearInterval(globalThis.__autoCheckoutInterval);
    }
    globalThis.__autoCheckoutInterval = setInterval(() => {
        tick().catch((err) => console.error('[AutoCheckoutWorker] Tick failed:', err));
    }, POLL_INTERVAL_MS);
}

function currentKolkataYmdAndTime(): { ymd: string; hhmm: string } {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}` };
}

async function tick(): Promise<void> {
    const { ymd, hhmm } = currentKolkataYmdAndTime();
    const autoCheckoutTime = (await getWorkingHours()).autoCheckoutTime;
    const runKey = `${ymd}_${autoCheckoutTime}`;
    if (lastRunKey === runKey) return; // already swept for this scheduled time today
    if (hhmm < autoCheckoutTime) return; // not time yet

    lastRunKey = runKey; // claim this scheduled run before async work
    await sweepOpenPunches(autoCheckoutTime);
}

async function sweepOpenPunches(autoCheckoutTime: string): Promise<void> {
    const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(new Date(), 'Asia/Kolkata');
    const [hh, mm] = autoCheckoutTime.split(':').map(Number);
    const checkOutAt = new Date(dayStartUtc.getTime() + (hh * 60 + mm) * 60 * 1000);

    const openRows = await prisma.attendance.findMany({
        where: { date: dayStartUtc, checkIn: { not: null }, checkOut: null, isHoliday: false },
        select: { id: true, userId: true, checkIn: true },
    });
    if (openRows.length === 0) return;

    let closedCount = 0;
    for (const row of openRows) {
        try {
            const shiftConfig = await resolveEmployeeShiftConfig(row.userId);
            const netHours = Math.max(0, (checkOutAt.getTime() - row.checkIn!.getTime()) / (1000 * 60 * 60));
            const workingHours = Math.round(netHours * 100) / 100;
            const status = deriveDayStatusFromHours(workingHours, shiftConfig);
            // Re-checks checkOut is still null at write time — a real punch-out
            // racing in the same minute must win, never get silently overwritten.
            const result = await prisma.attendance.updateMany({
                where: { id: row.id, checkOut: null },
                data: { checkOut: checkOutAt, workingHours, status },
            });
            closedCount += result.count;
        } catch (err) {
            console.error(`[AutoCheckoutWorker] Failed to auto-close attendance ${row.id}:`, err);
        }
    }
    if (closedCount > 0) {
        console.log(`[AutoCheckoutWorker] Auto-closed ${closedCount} open punch(es) at ${autoCheckoutTime} IST.`);
    }
}
