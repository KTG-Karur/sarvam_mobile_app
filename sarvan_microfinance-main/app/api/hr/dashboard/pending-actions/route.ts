import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requireAuth, isUserContext } from '@/app/lib/permissions/guards';
import { getPendingQueue } from '@/app/lib/approval/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/dashboard/pending-actions — merges the generic approval engine's
// pending queue (Transfer, via app/lib/approval/engine.ts) with direct
// pending-status queries for Exit/Leave/Confirmation/Promotion/Documents,
// since those are bespoke maker-checker models the generic engine doesn't
// know about (see Phase 2's design notes).
export async function GET(request: NextRequest) {
    const ctx = await requireAuth(request);
    if (!isUserContext(ctx)) return ctx;

    try {
        // ctx.branchAccess already resolves the user's permitted branches (empty
        // for a Head-Office-based user, who is unrestricted via isHeadOffice) —
        // reuse that directly rather than re-deriving it through the separate
        // legacy-JWT-shaped getPermittedBranchIds() helper used elsewhere in the
        // HR module (this route already has the full RBAC UserContext on hand).
        const permittedBranchIds = ctx.isHeadOffice ? null : ctx.branchAccess.map((ba) => ba.branchId);
        const branchFilter = permittedBranchIds ? { branchId: { in: permittedBranchIds } } : {};

        const [transferQueue, exits, leaves, confirmations, promotions, documents] = await Promise.all([
            getPendingQueue(ctx).catch(() => []),
            prisma.employeeExitRequest.findMany({
                where: { status: 'IN_PROGRESS', employee: branchFilter },
                select: { id: true, initiatedAt: true, employee: { select: { firstName: true, lastName: true } } },
            }),
            prisma.leaveApplication.findMany({
                where: { status: 'PENDING', employee: branchFilter },
                select: { id: true, appliedAt: true, employee: { select: { firstName: true, lastName: true } } },
            }),
            prisma.employeeConfirmation.findMany({
                where: { status: 'PENDING', employee: branchFilter },
                select: { id: true, initiatedAt: true, employee: { select: { firstName: true, lastName: true } } },
            }),
            prisma.employeePromotion.findMany({
                where: { status: 'PENDING', employee: branchFilter },
                select: { id: true, initiatedAt: true, employee: { select: { firstName: true, lastName: true } } },
            }),
            prisma.employeeDocument.findMany({
                where: { status: 'PENDING', employee: branchFilter },
                select: { id: true, uploadedAt: true, category: true, employee: { select: { firstName: true, lastName: true } } },
            }),
        ]);

        const items = [
            ...transferQueue.map((t) => ({
                type: 'TRANSFER' as const, id: t.instanceId, label: `Transfer approval — ${t.stageName}`, at: t.submittedAt,
            })),
            ...exits.map((e) => ({
                type: 'EXIT' as const, id: e.id, label: `Exit clearance — ${e.employee.firstName} ${e.employee.lastName}`, at: e.initiatedAt,
            })),
            ...leaves.map((l) => ({
                type: 'LEAVE' as const, id: l.id, label: `Leave approval — ${l.employee.firstName} ${l.employee.lastName}`, at: l.appliedAt,
            })),
            ...confirmations.map((c) => ({
                type: 'CONFIRMATION' as const, id: c.id, label: `Confirmation — ${c.employee.firstName} ${c.employee.lastName}`, at: c.initiatedAt,
            })),
            ...promotions.map((p) => ({
                type: 'PROMOTION' as const, id: p.id, label: `Promotion — ${p.employee.firstName} ${p.employee.lastName}`, at: p.initiatedAt,
            })),
            ...documents.map((d) => ({
                type: 'DOCUMENT' as const, id: d.id, label: `Document verification (${d.category}) — ${d.employee.firstName} ${d.employee.lastName}`, at: d.uploadedAt,
            })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());

        return successResponse({ items, total: items.length }, 'Pending actions fetched successfully');
    } catch (error: any) {
        console.error('Error fetching HR pending actions:', error);
        return errorResponse(error.message || 'Failed to fetch pending actions', 500);
    }
}
