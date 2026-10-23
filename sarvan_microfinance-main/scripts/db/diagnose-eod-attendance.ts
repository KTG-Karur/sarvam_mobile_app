/**
 * Compare DB attendance rows with EOD checklist logic for a branch + working date.
 *
 * Usage (from repo root, .env with DATABASE_URL):
 *   npx tsx scripts/db/diagnose-eod-attendance.ts
 *   npx tsx scripts/db/diagnose-eod-attendance.ts --branchId=<cuid> --date=2026-03-28
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay } from 'date-fns';
import {
    getKolkataDayEndExclusiveUtc,
    getUtcBoundsForBranchCalendarDay,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';

function startOfDayWithOffset(date: Date, offsetMinutes: number): Date {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const shifted = new Date(utc + offsetMinutes * 60000);
    shifted.setHours(0, 0, 0, 0);
    const shiftedUtc = shifted.getTime() - offsetMinutes * 60000;
    return new Date(shiftedUtc);
}

function parseArgs(): { branchId?: string; dateYmd?: string } {
    const out: { branchId?: string; dateYmd?: string } = {};
    for (const a of process.argv.slice(2)) {
        if (a.startsWith('--branchId=')) out.branchId = a.slice('--branchId='.length);
        if (a.startsWith('--date=')) out.dateYmd = a.slice('--date='.length);
    }
    return out;
}

async function main() {
    const prisma = new PrismaClient();
    const { branchId: argBranchId, dateYmd: argDate } = parseArgs();

    try {
        console.log('Node:', process.version);
        console.log('Server TZ offset (min):', new Date().getTimezoneOffset());
        console.log('---');

        const locks = await prisma.branchLock.findMany({
            where: argBranchId ? { branchId: argBranchId } : undefined,
            include: { branch: { select: { code: true, name: true } } },
            orderBy: { branch: { code: 'asc' } },
        });

        if (locks.length === 0) {
            console.log('No branch_lock rows found.', argBranchId ? `branchId=${argBranchId}` : '');
            return;
        }

        for (const lock of locks) {
            const branchId = lock.branchId;
            const processDate = argDate
                ? parseKolkataAttendanceDateYmd(argDate)
                : new Date(lock.currentWorkingDate);

            const ymdKolkata = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(processDate);

            const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(
                processDate,
                lock.timezone ?? 'Asia/Kolkata'
            );
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            const legacyStart = startOfDayWithOffset(processDate, 330);
            const legacyEnd = new Date(legacyStart.getTime() + 24 * 60 * 60 * 1000 - 1);

            const serverLocalStart = startOfDay(processDate);
            const serverLocalEnd = endOfDay(processDate);

            console.log(
                `\n=== Branch ${lock.branch?.code ?? '?'} (${lock.branch?.name ?? branchId}) ===`
            );
            console.log('branchId:', branchId);
            console.log('lock.currentWorkingDate (raw):', lock.currentWorkingDate.toISOString());
            console.log('processDate used:', processDate.toISOString());
            console.log('Kolkata calendar date:', ymdKolkata);
            console.log('EOD IST bounds inclusive end:', dayStartUtc.toISOString(), '–', dayEndUtc.toISOString());
            console.log('EOD query (half-open): date >= start AND date <', dayEndExclusiveUtc.toISOString());
            console.log('Legacy startOfDayWithOffset bounds:', legacyStart.toISOString(), '–', legacyEnd.toISOString());
            console.log('Server local startOfDay/endOfDay:', serverLocalStart.toISOString(), '–', serverLocalEnd.toISOString());

            const employees = await prisma.user.findMany({
                where: { branchId, isActive: true },
                select: { id: true, firstName: true, lastName: true, role: true },
                orderBy: { firstName: 'asc' },
            });
            const ids = employees.map((e) => e.id);

            if (ids.length === 0) {
                console.log('No active users on this branch.');
                continue;
            }

            const inEodWindow = await prisma.attendance.findMany({
                where: {
                    userId: { in: ids },
                    date: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                },
                select: { userId: true, date: true, status: true, branchId: true },
            });

            const wide = await prisma.attendance.findMany({
                where: {
                    userId: { in: ids },
                    date: {
                        gte: new Date(dayStartUtc.getTime() - 48 * 60 * 60 * 1000),
                        lte: new Date(dayEndUtc.getTime() + 48 * 60 * 60 * 1000),
                    },
                },
                select: { userId: true, date: true, status: true, branchId: true },
                orderBy: { date: 'asc' },
            });

            const inWindowSet = new Set(inEodWindow.map((r) => r.userId));
            const missing = employees.filter((e) => !inWindowSet.has(e.id));

            console.log(`\nActive employees: ${employees.length}`);
            console.log(`Attendance rows in EOD window: ${inEodWindow.length}`);
            console.log(`EOD would report missing: ${missing.length}`);
            if (missing.length > 0) {
                console.log(
                    'Missing:',
                    missing.map((e) => `${e.firstName} ${e.lastName} (${e.role})`).join('; ')
                );
            }

            const outsideWindow = wide.filter(
                (r) => r.date < dayStartUtc || r.date >= dayEndExclusiveUtc
            );
            if (outsideWindow.length > 0) {
                console.log('\nRows within ±48h but OUTSIDE EOD IST window (likely date-anchor mismatch):');
                for (const r of outsideWindow) {
                    const emp = employees.find((e) => e.id === r.userId);
                    console.log(
                        `  ${emp?.firstName ?? '?'} ${emp?.lastName ?? ''} | date=${r.date.toISOString()} | status=${r.status} | branchId=${r.branchId ?? 'null'}`
                    );
                }
            }

            const canonical = parseKolkataAttendanceDateYmd(ymdKolkata);
            const exactCanonical = await prisma.attendance.findMany({
                where: { userId: { in: ids }, date: canonical },
                select: { userId: true, date: true, status: true },
            });
            console.log(
                `\nRows with exact canonical Kolkata midnight (${canonical.toISOString()}): ${exactCanonical.length}`
            );
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
