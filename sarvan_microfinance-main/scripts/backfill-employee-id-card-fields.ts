// ============================================================
// EMPLOYEE ID CARD FIELD BACKFILL
// scripts/backfill-employee-id-card-fields.ts
//
// The ID card (app/lib/hr/id-card-data.ts) now reads only the User row. It used
// to fall back per field to the employee's onboarding request, which covered
// employees provisioned before onboarding copied these fields onto User — but
// also made a field HR had deliberately cleared reappear. This one-time script
// copies the onboarding value onto User for every ID card field that is still
// empty on User, so those older employees keep their card details.
//
// Only fills NULL / empty User fields; never overwrites an existing value.
//
// Usage:
//   npx tsx scripts/backfill-employee-id-card-fields.ts           (Dry run - reports only)
//   npx tsx scripts/backfill-employee-id-card-fields.ts --execute (Applies changes)
// ============================================================

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// User field ← EmployeeOnboardingRequest field
const FIELD_MAP = [
    ['dateOfJoining', 'dateOfJoining'],
    ['dob', 'dateOfBirth'],
    ['bloodGroup', 'bloodGroup'],
    ['address', 'currentAddress'],
    ['mobileNumber', 'mobileNumber'],
    ['emergencyContactName', 'emergencyContactName'],
    ['emergencyContactRelation', 'emergencyContactRelation'],
    ['emergencyContactMobile', 'emergencyContactNumber'],
    ['branchId', 'branchId'],
    ['designationId', 'designationId'],
    ['departmentId', 'departmentId'],
] as const;

type UserField = (typeof FIELD_MAP)[number][0];

function isEmpty(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

async function main() {
    const isExecute = process.argv.includes('--execute');
    console.log(`\n======================================================`);
    console.log(`MODE: ${isExecute ? '⚡ EXECUTE (Changes will be written)' : '🔍 DRY RUN (Read-only, no changes)'}`);
    console.log(`======================================================\n`);

    const requests = await prisma.employeeOnboardingRequest.findMany({
        where: { createdUserId: { not: null } },
        select: {
            createdUserId: true,
            dateOfJoining: true,
            dateOfBirth: true,
            bloodGroup: true,
            currentAddress: true,
            mobileNumber: true,
            emergencyContactName: true,
            emergencyContactRelation: true,
            emergencyContactNumber: true,
            branchId: true,
            designationId: true,
            departmentId: true,
            createdUser: {
                select: {
                    id: true,
                    employeeId: true,
                    dateOfJoining: true,
                    dob: true,
                    bloodGroup: true,
                    address: true,
                    mobileNumber: true,
                    emergencyContactName: true,
                    emergencyContactRelation: true,
                    emergencyContactMobile: true,
                    branchId: true,
                    designationId: true,
                    departmentId: true,
                },
            },
        },
    });

    let usersToUpdate = 0;
    let fieldsToFill = 0;
    let skippedMobileConflicts = 0;

    for (const req of requests) {
        const user = req.createdUser;
        if (!user) continue;

        const data: Record<string, unknown> = {};
        for (const [userField, requestField] of FIELD_MAP) {
            const current = user[userField as UserField];
            const fallback = req[requestField];
            if (isEmpty(current) && !isEmpty(fallback)) data[userField] = fallback;
        }

        // mobileNumber is @unique on User — don't take one another user already holds.
        if (typeof data.mobileNumber === 'string') {
            const holder = await prisma.user.findFirst({
                where: { mobileNumber: data.mobileNumber, id: { not: user.id } },
                select: { employeeId: true },
            });
            if (holder) {
                console.log(`  ⚠ ${user.employeeId ?? user.id}: mobile ${data.mobileNumber} already used by ${holder.employeeId ?? 'another user'} — skipped`);
                delete data.mobileNumber;
                skippedMobileConflicts++;
            }
        }

        const fields = Object.keys(data);
        if (fields.length === 0) continue;

        usersToUpdate++;
        fieldsToFill += fields.length;
        console.log(`  ${user.employeeId ?? user.id}: fill ${fields.join(', ')}`);

        if (isExecute) {
            await prisma.user.update({ where: { id: user.id }, data: data as Prisma.UserUncheckedUpdateInput });
        }
    }

    console.log(`\nOnboarded employees checked: ${requests.length}`);
    console.log(`Employees ${isExecute ? 'updated' : 'to update'}: ${usersToUpdate} (${fieldsToFill} fields)`);
    if (skippedMobileConflicts > 0) console.log(`Mobile numbers skipped (already in use): ${skippedMobileConflicts}`);
    if (!isExecute && usersToUpdate > 0) console.log(`\nRe-run with --execute to apply.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
