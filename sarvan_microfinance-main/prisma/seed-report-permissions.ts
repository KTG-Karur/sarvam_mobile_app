// ============================================================
// REPORT PERMISSIONS SEEDER
// prisma/seed-report-permissions.ts
//
// Seeds default ReportPermission rows for every role x every report currently
// in app/lib/reports/report-registry.ts. Export access is always-allowed
// (canView/canExport/canPrint = true for every role) — the only per-report
// lever is exportMode (DIRECT vs REQUEST_QUEUE), managed from the admin
// Report Permissions screen (/dashboard/admin/report-permissions).
//
// Idempotent by design: existing rows are left untouched (upsert with an
// empty `update`), so re-running after an admin has changed a report's
// exportMode via the Report Permissions screen never clobbers their choice —
// only newly-added registry entries or newly-created roles get a row.
//
// Run: npx tsx prisma/seed-report-permissions.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { listReportEntries } from '@/app/lib/reports/report-registry';

const prisma = new PrismaClient();

async function main() {
    const module = await prisma.module.upsert({
        where: { slug: 'reports' },
        update: {},
        create: { name: 'Reports', slug: 'reports', icon: 'BarChart3', sortOrder: 12, isSystem: true },
    });

    const roles = await prisma.role.findMany({ where: { isActive: true }, select: { id: true, name: true, legacyRole: true } });
    const entries = listReportEntries();

    let createdCount = 0;
    let skippedCount = 0;

    for (const entry of entries) {
        for (const role of roles) {
            const existing = await prisma.reportPermission.findUnique({
                where: { roleId_reportSlug: { roleId: role.id, reportSlug: entry.slug } },
            });
            if (existing) {
                skippedCount++;
                continue;
            }

            await prisma.reportPermission.create({
                data: {
                    roleId: role.id,
                    moduleId: module.id,
                    reportSlug: entry.slug,
                    reportName: entry.reportName,
                    canView: true,
                    canExport: true,
                    canPrint: true,
                    branchScope: 'ALL',
                    maskFinancial: false,
                    exportMode: 'DIRECT',
                },
            });
            createdCount++;
        }
    }

    console.log(`[seed-report-permissions] Done — ${createdCount} row(s) created, ${skippedCount} already existed (left untouched) across ${entries.length} report(s) x ${roles.length} role(s).`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
