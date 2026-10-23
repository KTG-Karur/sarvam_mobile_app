// ============================================================
// EMPLOYEE ID WHITESPACE FIX
// scripts/fix-employee-id-whitespace.ts
//
// Some legacy Employee IDs carry stray leading/trailing whitespace ("ST049 ",
// "ST221\t"). Login matches the ID exactly, so a tab makes the account
// impossible to log into, and the QR verification page trims the scanned ID,
// so "ST089 " resolves to a *different* person's "ST089". ID card eligibility
// already refuses such IDs (INVALID_EMPLOYEE_ID); this corrects them.
//
// Trims each ID. If the trimmed ID is already used by another user (compared
// case-insensitively, like the verification lookup), it is NOT changed — two
// different people would end up sharing one ID — and is reported for HR to
// assign a new number by hand.
//
// No table references User.employeeId as a foreign key (relations use User.id),
// so renaming it is safe; the affected person logs in with the trimmed ID.
//
// Usage:
//   npx tsx scripts/fix-employee-id-whitespace.ts           (Dry run - reports only)
//   npx tsx scripts/fix-employee-id-whitespace.ts --execute (Applies changes)
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const isExecute = process.argv.includes('--execute');
    console.log(`\n======================================================`);
    console.log(`MODE: ${isExecute ? '⚡ EXECUTE (Changes will be written)' : '🔍 DRY RUN (Read-only, no changes)'}`);
    console.log(`======================================================\n`);

    const users = await prisma.user.findMany({
        where: { employeeId: { not: null } },
        select: { id: true, employeeId: true, firstName: true, lastName: true },
    });
    const byNormalised = new Map<string, typeof users>();
    for (const u of users) {
        const key = u.employeeId!.trim().toUpperCase();
        byNormalised.set(key, [...(byNormalised.get(key) ?? []), u]);
    }

    let fixed = 0;
    let conflicts = 0;
    for (const u of users) {
        const raw = u.employeeId!;
        const trimmed = raw.trim();
        if (trimmed === raw) continue;
        const name = `${u.firstName.trim()} ${u.lastName.trim()}`.trim();

        const others = (byNormalised.get(trimmed.toUpperCase()) ?? []).filter((o) => o.id !== u.id);
        if (others.length > 0 || trimmed === '') {
            conflicts++;
            const holders = others.map((o) => `${JSON.stringify(o.employeeId)} ${o.firstName.trim()} ${o.lastName.trim()}`).join(', ');
            console.log(`  ⚠ ${JSON.stringify(raw)} (${name}) — "${trimmed}" already belongs to ${holders || 'nobody (empty ID)'}; needs a new ID, left unchanged`);
            continue;
        }

        fixed++;
        console.log(`  ${JSON.stringify(raw)} → "${trimmed}"  (${name})`);
        if (isExecute) {
            await prisma.user.update({ where: { id: u.id }, data: { employeeId: trimmed } });
        }
    }

    console.log(`\nIDs ${isExecute ? 'corrected' : 'to correct'}: ${fixed}`);
    if (conflicts > 0) console.log(`Needs a new ID assigned by HR (not changed): ${conflicts}`);
    if (!isExecute && fixed > 0) console.log('Re-run with --execute to apply.');
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
