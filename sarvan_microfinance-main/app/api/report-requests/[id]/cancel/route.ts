import { NextRequest } from 'next/server';
import { withAuth, handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/report-requests/[id]/cancel
 * PENDING rows never get claimed by the worker (immediate cancel). PROCESSING
 * rows are advisory-cancelled — the worker checks status at its next
 * checkpoint (app/lib/reports/report-request-worker.ts) and aborts.
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
                return errorResponse('You do not have permission to cancel this request', 403);
            }

            if (row.status !== 'PENDING' && row.status !== 'PROCESSING') {
                return errorResponse(`Cannot cancel a request with status ${row.status}`, 400);
            }

            const updated = await prisma.reportRequest.update({
                where: { id },
                data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: user.userId },
            });

            return successResponse(updated, 'Report request cancelled');
        } catch (error: any) {
            console.error('[report-requests][cancel] Error:', error);
            return errorResponse(error.message || 'Failed to cancel report request', 500);
        }
    })(request);
}
