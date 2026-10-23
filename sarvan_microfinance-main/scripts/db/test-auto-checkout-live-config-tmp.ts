import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getWorkingHours, saveWorkingHours } from '@/app/lib/working-hours';
import { startAutoCheckoutWorker } from '@/app/lib/auto-checkout-worker';

const prisma = new PrismaClient();
const ROW_ID = 'cmuf2pl1j0011v250fe1sb5hw';

function currentKolkataHHMM(): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('hour')}:${get('minute')}`;
}

async function main() {
    const originalAutoCheckoutTime = (await getWorkingHours()).autoCheckoutTime;

    // Start with a far-future time so the worker does NOT close the punch yet.
    await saveWorkingHours({ autoCheckoutTime: '23:58' });
    console.log('Started with autoCheckoutTime=23:58 (far future) — worker should NOT close it yet.');

    startAutoCheckoutWorker();

    console.log('Waiting 65s (past the first tick) with the future time still set...');
    await new Promise((r) => setTimeout(r, 65_000));

    let row = await prisma.attendance.findUnique({ where: { id: ROW_ID } });
    console.log('After first tick (should still be OPEN):', JSON.stringify({ checkOut: row?.checkOut }));

    // Now simulate an admin changing the Working Hours page mid-run, WITHOUT restarting anything.
    const nowHHMM = currentKolkataHHMM();
    console.log('Now changing autoCheckoutTime live to the current time:', nowHHMM);
    await saveWorkingHours({ autoCheckoutTime: nowHHMM });

    console.log('Waiting another 65s for the worker to pick up the live change on its own...');
    await new Promise((r) => setTimeout(r, 65_000));

    row = await prisma.attendance.findUnique({ where: { id: ROW_ID } });
    console.log('After live config change (should now be CLOSED):', JSON.stringify({ checkOut: row?.checkOut, status: row?.status, workingHours: row?.workingHours }));

    await saveWorkingHours({ autoCheckoutTime: originalAutoCheckoutTime });
    await prisma.attendance.update({
        where: { id: ROW_ID },
        data: { checkIn: null, checkOut: null, status: 'ABSENT', workingHours: null },
    });
    console.log('Restored config and row to original state.');

    await prisma.$disconnect();
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
