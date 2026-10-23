// ============================================================
// REPORT PERMISSIONS API — per-report Export Mode (Direct vs Request Queue)
// app/api/admin/report-permissions/route.ts
//
// Export access itself is always-allowed for every role (canView/canExport/
// canPrint are fixed true — see prisma/seed-report-permissions.ts and the
// one-time backfill that flipped every existing row). The only thing this
// screen configures is exportMode, and it applies uniformly across every
// role for a given report — there is no per-role distinction here anymore.
// Storage-wise this still writes one ReportPermission row per role (the
// schema is still keyed on [roleId, reportSlug]), it's just that every role's
// row is always kept in lockstep by this route.
// ============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { listReportEntries, isQueueCapable } from '@/app/lib/reports/report-registry';

const ExportModeEnum = z.enum(['DIRECT', 'REQUEST_QUEUE']);

const EntrySchema = z.object({
    reportSlug: z.string().min(1),
    exportMode: ExportModeEnum,
});

const SaveSchema = z.object({
    entries: z.array(EntrySchema),
});

// GET /api/admin/report-permissions — every registry report with its current
// (role-independent) exportMode and whether Request Queue is even an option.
export async function GET(request: NextRequest) {
    try {
        const result = await requirePermission(request, 'admin', 'view');
        if (!isUserContext(result)) return result;

        const entries = listReportEntries();
        const slugs = entries.map((e) => e.slug);

        // One row per reportSlug is enough — every role's row is kept identical
        // by the POST handler below, so any one of them reflects the current mode.
        const existing = await prisma.reportPermission.findMany({
            where: { reportSlug: { in: slugs } },
            distinct: ['reportSlug'],
            select: { reportSlug: true, exportMode: true },
        });
        const modeBySlug = new Map(existing.map((row) => [row.reportSlug, row.exportMode]));

        const rows = entries.map((entry) => {
            const queueCapable = isQueueCapable(entry.slug);
            return {
                reportSlug: entry.slug,
                reportName: entry.reportName,
                exportMode: queueCapable ? (modeBySlug.get(entry.slug) ?? 'DIRECT') : 'DIRECT',
                queueCapable,
                navHref: entry.navHref,
            };
        });

        return successResponse({ entries: rows });
    } catch (error: any) {
        console.error('Error fetching report permissions:', error);
        return errorResponse(error?.message || 'Failed to fetch report permissions', 500);
    }
}

// POST /api/admin/report-permissions — bulk-set exportMode for a set of
// reports, applied identically across every role.
export async function POST(request: NextRequest) {
    try {
        const result = await requirePermission(request, 'admin', 'edit');
        if (!isUserContext(result)) return result;

        const body = await request.json();
        const parsed = SaveSchema.safeParse(body);
        if (!parsed.success) {
            return errorResponse(parsed.error.errors[0].message, 400);
        }
        const { entries } = parsed.data;

        const module = await prisma.module.findUnique({ where: { slug: 'reports' } });
        if (!module) {
            return errorResponse('The "reports" module has not been seeded — run prisma/seed-rbac.ts first', 500);
        }

        const roles = await prisma.role.findMany({ where: { isActive: true }, select: { id: true } });
        const registryBySlug = new Map(listReportEntries().map((e) => [e.slug, e]));

        await prisma.$transaction(async (tx) => {
            for (const entry of entries) {
                const registryEntry = registryBySlug.get(entry.reportSlug);
                if (!registryEntry) continue; // stale slug from a since-removed registry entry — skip rather than error

                // Server-side enforcement, independent of whatever the client posted:
                // Request Queue mode is only meaningful for a report with a working
                // `fetch` adapter. A non-capable report is pinned to DIRECT so a
                // stale/tampered payload can never persist an unusable export mode.
                const exportMode = isQueueCapable(entry.reportSlug) ? entry.exportMode : 'DIRECT';

                for (const role of roles) {
                    await tx.reportPermission.upsert({
                        where: { roleId_reportSlug: { roleId: role.id, reportSlug: entry.reportSlug } },
                        create: {
                            roleId: role.id,
                            moduleId: module.id,
                            reportSlug: entry.reportSlug,
                            reportName: registryEntry.reportName,
                            canView: true,
                            canExport: true,
                            canPrint: true,
                            branchScope: 'ALL',
                            maskFinancial: false,
                            exportMode,
                        },
                        update: {
                            reportName: registryEntry.reportName,
                            canView: true,
                            canExport: true,
                            canPrint: true,
                            maskFinancial: false,
                            exportMode,
                        },
                    });
                }
            }

            await tx.roleAuditLog.create({
                data: {
                    actedBy: result.userId,
                    action: 'report_permissions_updated',
                    targetType: 'role',
                    targetId: 'all',
                    after: { entryCount: entries.length },
                },
            });
        });

        // exportMode is now uniform across every role, so every user's cached
        // permissions are stale — invalidate everyone, not just users of one role.
        const affectedUsers = await prisma.user.findMany({ select: { id: true } });
        await Promise.all(affectedUsers.map((u) => invalidateUserPermissions(u.id)));

        return successResponse(
            { entryCount: entries.length, invalidatedUsers: affectedUsers.length },
            `Updated ${entries.length} report(s). Invalidated ${affectedUsers.length} user permission caches.`
        );
    } catch (error: any) {
        console.error('Error saving report permissions:', error);
        return errorResponse(error?.message || 'Failed to save report permissions', 500);
    }
}
