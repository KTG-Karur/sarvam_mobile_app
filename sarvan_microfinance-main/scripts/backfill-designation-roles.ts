// ============================================================
// DESIGNATION ROLE BACKFILL & SEED SCRIPT
// scripts/backfill-designation-roles.ts
//
// Usage:
//   npx tsx scripts/backfill-designation-roles.ts           (Dry run - reports only)
//   npx tsx scripts/backfill-designation-roles.ts --execute (Applies changes)
// ============================================================

import { PrismaClient } from '@prisma/client';
import { syncUserLegacyRoleFromActiveAssignments } from '../app/lib/rbac-role-sync';
import { invalidateUserPermissions } from '../app/lib/permissions/engine';

const prisma = new PrismaClient();

const DESIGNATION_MAPPINGS: Record<string, string | null> = {
    AM: 'area-manager',
    BM: 'branch-manager',
    ABM: 'branch-manager',
    SFDO: 'fdo',
    FDO: 'fdo',
    JFDO: 'fdo',
    ACCT: 'fdo',
    CASH: 'fdo',
    HREX: 'fdo',
    MIS: 'fdo',
    OA: 'fdo',
    MD: 'admin',
    GM: 'admin',
    DM: null,
    AUD: null,
};

async function main() {
    const isExecute = process.argv.includes('--execute');
    console.log(`\n======================================================`);
    console.log(`MODE: ${isExecute ? '⚡ EXECUTE (Changes will be written)' : '🔍 DRY RUN (Read-only, no changes)'}`);
    console.log(`======================================================\n`);

    // 1. Audit / Seed Designation defaultRoleSlug
    console.log('--- STEP 1: Designation Default Role Slugs ---');
    const existingDesignations = await prisma.designation.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, defaultRoleSlug: true },
        orderBy: { code: 'asc' },
    });

    const designationsToUpdate: { id: string; name: string; code: string; currentSlug: string | null; targetSlug: string | null }[] = [];
    for (const desig of existingDesignations) {
        if (desig.code in DESIGNATION_MAPPINGS) {
            const target = DESIGNATION_MAPPINGS[desig.code];
            if (desig.defaultRoleSlug !== target) {
                designationsToUpdate.push({
                    id: desig.id,
                    name: desig.name,
                    code: desig.code,
                    currentSlug: desig.defaultRoleSlug,
                    targetSlug: target,
                });
            }
        }
    }

    console.log(`Found ${existingDesignations.length} active designations.`);
    if (designationsToUpdate.length > 0) {
        console.log(`Designations to update (${designationsToUpdate.length}):`);
        console.table(designationsToUpdate.map(d => ({
            code: d.code,
            name: d.name,
            currentSlug: d.currentSlug ?? '(null)',
            targetSlug: d.targetSlug ?? '(null)',
        })));

        if (isExecute) {
            for (const d of designationsToUpdate) {
                await prisma.designation.update({
                    where: { id: d.id },
                    data: { defaultRoleSlug: d.targetSlug },
                });
            }
            console.log(`✓ Updated ${designationsToUpdate.length} designations with defaultRoleSlug.`);
        }
    } else {
        console.log('✓ All active designations already match the target defaultRoleSlug mappings.');
    }

    // 2. Audit Users
    console.log('\n--- STEP 2: User Role Audit & Backfill ---');
    const roles = await prisma.role.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, name: true },
    });
    const roleMap = new Map(roles.map(r => [r.slug, r]));

    const users = await prisma.user.findMany({
        where: { isActive: true, designationId: { not: null } },
        include: {
            designation: true,
            userRoles: {
                where: { isActive: true },
                include: { role: true },
            },
        },
        orderBy: { employeeId: 'asc' },
    });

    const autoFixList: {
        userId: string;
        employeeId: string | null;
        name: string;
        designationCode: string;
        designationName: string;
        currentLegacyRole: string;
        targetRoleSlug: string;
        targetRoleId: string;
    }[] = [];

    const manualReviewList: {
        userId: string;
        employeeId: string | null;
        name: string;
        designationCode: string;
        currentLegacyRole: string;
        assignedRoleSlugs: string[];
        targetRoleSlug: string | null;
    }[] = [];

    const upToDateList: {
        employeeId: string | null;
        name: string;
        designationCode: string;
        currentRole: string;
    }[] = [];

    for (const user of users) {
        const desigCode = user.designation?.code;
        const targetSlug = desigCode ? DESIGNATION_MAPPINGS[desigCode] ?? user.designation?.defaultRoleSlug : null;

        if (!targetSlug) {
            // Designation has no default role (e.g. DM, AUD, or unmapped)
            continue;
        }

        const activeAssignments = user.userRoles;
        if (activeAssignments.length === 0) {
            // User has NO active RBAC role assignments -> Safe to auto-fix!
            const roleRecord = roleMap.get(targetSlug);
            if (!roleRecord) {
                console.warn(`⚠️ Role slug "${targetSlug}" not found in active Roles table for user ${user.employeeId}`);
                continue;
            }
            autoFixList.push({
                userId: user.id,
                employeeId: user.employeeId,
                name: `${user.firstName} ${user.lastName}`.trim(),
                designationCode: desigCode!,
                designationName: user.designation!.name,
                currentLegacyRole: user.role,
                targetRoleSlug: targetSlug,
                targetRoleId: roleRecord.id,
            });
        } else {
            const hasMatchingRole = activeAssignments.some(a => a.role.slug === targetSlug);
            if (hasMatchingRole) {
                upToDateList.push({
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`.trim(),
                    designationCode: desigCode!,
                    currentRole: user.role,
                });
            } else {
                manualReviewList.push({
                    userId: user.id,
                    employeeId: user.employeeId,
                    name: `${user.firstName} ${user.lastName}`.trim(),
                    designationCode: desigCode!,
                    currentLegacyRole: user.role,
                    assignedRoleSlugs: activeAssignments.map(a => a.role.slug),
                    targetRoleSlug: targetSlug,
                });
            }
        }
    }

    console.log(`Audited ${users.length} active users with designations:`);
    console.log(`- Up-to-date with active matching assignment: ${upToDateList.length}`);
    console.log(`- Auto-fixable (0 active assignments): ${autoFixList.length}`);
    console.log(`- Manual review (has existing active assignments different from default): ${manualReviewList.length}`);

    if (autoFixList.length > 0) {
        console.log('\nUsers to auto-assign:');
        console.table(autoFixList.map(u => ({
            employeeId: u.employeeId,
            name: u.name,
            designation: `${u.designationName} (${u.designationCode})`,
            currentRole: u.currentLegacyRole,
            newRoleAssignment: u.targetRoleSlug,
        })));

        if (isExecute) {
            for (const u of autoFixList) {
                await prisma.userRoleAssignment.create({
                    data: {
                        userId: u.userId,
                        roleId: u.targetRoleId,
                        branchId: null,
                        assignedBy: 'system-backfill',
                        isActive: true,
                    },
                });
                await syncUserLegacyRoleFromActiveAssignments(u.userId);
                await invalidateUserPermissions(u.userId);
                console.log(`✓ Auto-assigned role "${u.targetRoleSlug}" to user ${u.employeeId} (${u.name})`);
            }
        }
    }

    if (manualReviewList.length > 0) {
        console.log('\n⚠️ Users requiring manual review (not modified):');
        console.table(manualReviewList);
    }

    if (!isExecute) {
        console.log('\n======================================================');
        console.log('DRY RUN COMPLETE — No changes were made to the database.');
        console.log('Run with --execute to apply these changes.');
        console.log('======================================================\n');
    } else {
        console.log('\n======================================================');
        console.log('EXECUTE COMPLETE — Changes successfully applied.');
        console.log('======================================================\n');
    }
}

main()
    .catch((e) => {
        console.error('Script failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

