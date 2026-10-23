// ============================================================
// CANCEL ORPHANED APPROVAL INSTANCES
// scripts/cancel-orphaned-approvals.ts
//
// Before cancelApprovalForRecord() (app/lib/approval/engine.ts) existed, the
// HR create routes deleted their record when a step after
// startApprovalWorkflow failed but left the already-committed approval
// instance PENDING. Such an orphan points at a record that no longer exists,
// shows in no one's queue, and locks its workflow on Approval Settings
// ("Editing is temporarily locked because N request(s) are in progress").
//
// Dry run by default — lists orphans only. Pass --apply to cancel them.
// Cancelled (with an ApprovalLog entry), never deleted, so the audit trail stays.
//
//   npm run db:fix:orphaned-approvals            # dry run
//   npm run db:fix:orphaned-approvals -- --apply # cancel them
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ApprovalInstance.recordType -> the Prisma model holding that record.
const RECORD_MODELS: Record<string, string> = {
    EmployeeTransfer: 'employeeTransfer',
    hr_confirmation: 'employeeConfirmation',
    EmployeeExitRequest: 'employeeExitRequest',
    LeaveApplication: 'leaveApplication',
    PermissionRequest: 'permissionRequest',
    EmployeePromotion: 'employeePromotion',
    EmployeeOnboardingRequest: 'employeeOnboardingRequest',
};

const REASON = 'Orphaned — its record was rolled back when the request failed to submit';

type FindUniqueDelegate = { findUnique: (args: { where: { id: string }; select: { id: true } }) => Promise<{ id: string } | null> };

async function main() {
    const apply = process.argv.includes('--apply');

    const open = await prisma.approvalInstance.findMany({
        where: { status: { in: ['PENDING', 'IN_PROGRESS', 'SENT_BACK'] } },
        select: {
            id: true, recordType: true, recordId: true, submittedBy: true, submittedAt: true,
            workflow: { select: { name: true, module: { select: { slug: true } } } },
        },
    });
    console.log(`Open approval instances: ${open.length}`);

    const orphans: typeof open = [];
    const unknownTypes = new Set<string>();
    for (const inst of open) {
        const model = RECORD_MODELS[inst.recordType];
        if (!model) {
            unknownTypes.add(inst.recordType);
            continue;
        }
        // Dynamic model lookup by name — Prisma's client has no typed index signature.
        const delegate = (prisma as unknown as Record<string, FindUniqueDelegate>)[model];
        const record = await delegate.findUnique({ where: { id: inst.recordId }, select: { id: true } });
        if (!record) orphans.push(inst);
    }

    if (unknownTypes.size > 0) {
        console.log(`Skipped unknown record type(s) — add them to RECORD_MODELS to check: ${[...unknownTypes].join(', ')}`);
    }

    if (orphans.length === 0) {
        console.log('No orphaned approval instances found.');
        return;
    }

    console.log(`\nOrphaned instances: ${orphans.length}`);
    for (const o of orphans) {
        console.log(`  ${o.id}  ${o.workflow.module.slug.padEnd(16)} ${o.recordType}:${o.recordId}  submitted ${o.submittedAt.toISOString()}`);
    }

    if (!apply) {
        console.log('\nDry run — nothing changed. Re-run with --apply to cancel these.');
        return;
    }

    const now = new Date();
    await prisma.$transaction([
        prisma.approvalInstance.updateMany({
            where: { id: { in: orphans.map((o) => o.id) } },
            data: { status: 'CANCELLED', completedAt: now, currentStageId: null, rejectionReason: REASON },
        }),
        prisma.approvalLog.createMany({
            data: orphans.map((o) => ({ instanceId: o.id, actedBy: o.submittedBy, action: 'cancelled', remarks: REASON })),
        }),
    ]);
    console.log(`\nCancelled ${orphans.length} orphaned instance(s).`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
