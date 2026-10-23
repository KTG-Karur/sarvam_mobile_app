import { NextRequest } from 'next/server';
import { withAuth, handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/report-requests/[id]/retry
 * Requeues a FAILED or CANCELLED request with the exact same conditions, so the
 * user can get the file again without re-entering filters. The worker
 * (app/lib/reports/report-request-worker.ts) picks it up on its next tick.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return withAuth(async (_req, user) => {
        try {
            const row = await prisma.reportRequest.findUnique({ where: { id } });
            if (!row) return errorResponse('Report request not found', 404);

            const isOwner = row.requestedByUserId === user.userId;
            const isAdmin = user.role === 'ADMIN' && (!user.branchId || (await isHeadOfficeBranch(user.branchId)));
            if (!isOwner && !isAdmin) {
                return errorResponse('You do not have permission to retry this request', 403);
            }

            // Conditional update so a double-click can't requeue a row the worker already picked up
            const result = await prisma.reportRequest.updateMany({
                where: { id, status: { in: ['FAILED', 'CANCELLED'] } },
                data: {
                    status: 'PENDING',
                    progressPercent: 0,
                    attemptCount: 0,
                    errorMessage: null,
                    lockedAt: null,
                    completedAt: null,
                    cancelledAt: null,
                    cancelledByUserId: null,
                    storageKey: null,
                    totalCount: 0,
                },
            });
            if (result.count === 0) {
                return errorResponse(`Cannot retry a request with status ${row.status}`, 400);
            }

            return successResponse({ id }, 'Report request queued again');
        } catch (error: any) {
            console.error('[report-requests][retry] Error:', error);
            return errorResponse(error.message || 'Failed to retry report request', 500);
        }
    })(request);
}
