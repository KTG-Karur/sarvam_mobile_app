// ============================================================
// PLACEHOLDER DEPARTMENT / DESIGNATION SEED
// scripts/seed-placeholder-department-designation.ts
//
// Most staff created outside HR Onboarding (Add User, legacy employee-ID
// backfill) have no department or designation, so Employee Master can't be
// saved for them (both are required fields). This assigns a clearly-labelled
// "To Be Assigned" (code TBA) department and/or designation to every user with
// an Employee ID that is missing one, so HR can open and save those records
// and replace the placeholder with the real value later.
//
// The placeholder is never treated as real: ID card eligibility
// (app/lib/hr/id-card-eligibility.ts, PLACEHOLDER_ORG_CODE) reports
// "Designation not assigned yet", so no card is printed with it.
//
// Only fills NULL departmentId / designationId; never overwrites a real value.
//
// Usage:
//   npx tsx scripts/seed-placeholder-department-designation.ts            (Dry run - reports only)
//   npx tsx scripts/seed-placeholder-department-designation.ts --execute  (Applies changes)
//   npx tsx scripts/seed-placeholder-department-designation.ts --revert   (Dry run of undo)
//   npx tsx scripts/seed-placeholder-department-designation.ts --revert --execute
//     (Undo: clears the placeholder from every user still on it, and deactivates the placeholders)
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mirrors PLACEHOLDER_ORG_CODE in app/lib/hr/id-card-eligibility.ts (scripts
// import Prisma directly rather than the app's path-aliased modules).
const PLACEHOLDER_CODE = 'TBA';
const PLACEHOLDER_NAME = 'To Be Assigned';

async function findOrCreatePlaceholders(isExecute: boolean) {
    let department = await prisma.department.findFirst({ where: { code: PLACEHOLDER_CODE, isActive: true } });
    let designation = await prisma.designation.findFirst({ where: { code: PLACEHOLDER_CODE, isActive: true } });

    if (!department) {
        console.log(`  Department "${PLACEHOLDER_NAME}" (${PLACEHOLDER_CODE}): ${isExecute ? 'creating' : 'would create'}`);
        if (isExecute) department = await prisma.department.create({ data: { name: PLACEHOLDER_NAME, code: PLACEHOLDER_CODE } });
    } else {
        console.log(`  Department "${department.name}" (${PLACEHOLDER_CODE}): exists`);
    }
    if (!designation) {
        console.log(`  Designation "${PLACEHOLDER_NAME}" (${PLACEHOLDER_CODE}): ${isExecute ? 'creating' : 'would create'}`);
        // No defaultRoleSlug — assigning it must never change anyone's role.
        if (isExecute) designation = await prisma.designation.create({ data: { name: PLACEHOLDER_NAME, code: PLACEHOLDER_CODE } });
    } else {
        console.log(`  Designation "${designation.name}" (${PLACEHOLDER_CODE}): exists`);
    }
    return { department, designation };
}

async function seed(isExecute: boolean) {
    console.log('--- Placeholders ---');
    const { department, designation } = await findOrCreatePlaceholders(isExecute);

    const users = await prisma.user.findMany({
        where: { employeeId: { not: null }, OR: [{ departmentId: null }, { designationId: null }] },
        select: { id: true, employeeId: true, firstName: true, lastName: true, departmentId: true, designationId: true },
        orderBy: { employeeId: 'asc' },
    });

    console.log(`\n--- Employees missing department and/or designation: ${users.length} ---`);
    let deptCount = 0;
    let desigCount = 0;
    for (const u of users) {
        const fill: string[] = [];
        if (!u.departmentId) fill.push('department');
        if (!u.designationId) fill.push('designation');
        console.log(`  ${u.employeeId}  ${u.firstName} ${u.lastName}: ${fill.join(' + ')}`);
        if (!u.departmentId) deptCount++;
        if (!u.designationId) desigCount++;
    }

    if (isExecute && users.length > 0) {
        await prisma.$transaction([
            prisma.user.updateMany({
                where: { employeeId: { not: null }, departmentId: null },
                data: { departmentId: department!.id },
            }),
            prisma.user.updateMany({
                where: { employeeId: { not: null }, designationId: null },
                data: { designationId: designation!.id },
            }),
        ]);
    }

    console.log(`\nDepartment ${isExecute ? 'set' : 'to set'}: ${deptCount}   Designation ${isExecute ? 'set' : 'to set'}: ${desigCount}`);
    if (!isExecute && users.length > 0) console.log('Re-run with --execute to apply.');
}

async function revert(isExecute: boolean) {
    const departments = await prisma.department.findMany({ where: { code: PLACEHOLDER_CODE }, select: { id: true } });
    const designations = await prisma.designation.findMany({ where: { code: PLACEHOLDER_CODE }, select: { id: true } });
    const deptIds = departments.map((d) => d.id);
    const desigIds = designations.map((d) => d.id);

    const onDept = await prisma.user.count({ where: { departmentId: { in: deptIds } } });
    const onDesig = await prisma.user.count({ where: { designationId: { in: desigIds } } });
    console.log(`Users still on placeholder department: ${onDept}   designation: ${onDesig}`);

    if (!isExecute) {
        console.log('Re-run with --revert --execute to clear them and deactivate the placeholders.');
        return;
    }
    await prisma.$transaction([
        prisma.user.updateMany({ where: { departmentId: { in: deptIds } }, data: { departmentId: null } }),
        prisma.user.updateMany({ where: { designationId: { in: desigIds } }, data: { designationId: null } }),
        prisma.department.updateMany({ where: { id: { in: deptIds } }, data: { isActive: false } }),
        prisma.designation.updateMany({ where: { id: { in: desigIds } }, data: { isActive: false } }),
    ]);
    console.log('Reverted.');
}

async function main() {
    const isExecute = process.argv.includes('--execute');
    const isRevert = process.argv.includes('--revert');
    console.log(`\n======================================================`);
    console.log(`MODE: ${isRevert ? 'REVERT ' : ''}${isExecute ? '⚡ EXECUTE (Changes will be written)' : '🔍 DRY RUN (Read-only, no changes)'}`);
    console.log(`======================================================\n`);
    if (isRevert) await revert(isExecute);
    else await seed(isExecute);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
