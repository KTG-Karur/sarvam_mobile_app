import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

const ALLOWED_ROLES = ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'];

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/client/reverse/meeting?collectionBatchId=xxx
 * Full detail for the Collection Revert dialog: center/meeting context, the
 * signed meeting photo, the current denomination breakdown, and every
 * REPAYMENT transaction in the batch (so the BM can pick which client(s)
 * to revert and see what's already been reverted).
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            if (!ALLOWED_ROLES.includes(user.role)) {
                return errorResponse('Only Admin, Area Manager, or Branch Manager can view this', 403);
            }

            const { searchParams } = new URL(req.url);
            const collectionBatchId = searchParams.get('collectionBatchId');
            if (!collectionBatchId) {
                return errorResponse('collectionBatchId is required', 400);
            }

            const meeting = await prisma.collectionMeetingRecord.findUnique({
                where: { collectionBatchId },
                include: {
                    center: { select: { name: true, code: true } },
                    branch: { select: { name: true, code: true } },
                    submittedBy: { select: { firstName: true, lastName: true } },
                },
            });
            if (!meeting) {
                return errorResponse('Meeting record not found for this batch', 404);
            }

            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes(meeting.branchId)) {
                return errorResponse('Not authorized to view this batch', 403);
            }

            const branchLock = await prisma.branchLock.findUnique({
                where: { branchId: meeting.branchId },
                select: { currentWorkingDate: true },
            });

            const transactions = await prisma.loanTransaction.findMany({
                where: { collectionBatchId, type: { in: ['REPAYMENT', 'SAVINGS_COLLECTION'] }, status: 'APPROVED' },
                include: {
                    client: { select: { firstName: true, lastName: true, clientId: true } },
                    loan: { select: { loanNumber: true } },
                },
                orderBy: { createdAt: 'asc' },
            });

            const photoUrl = await getSignedReadUrl(meeting.photoKey);

            // Compare Kolkata-calendar YMD strings, not raw Date instants — `transactionDate`
            // is IST-midnight-anchored (`T00:00:00+05:30`) while `currentWorkingDate` is
            // UTC-midnight-anchored (`T00:00:00.000Z`), a ~5.5h gap that makes a naive `<`
            // comparison misfire as locked even for the branch's own current working day
            // (see isEodLockedForTransaction in app/lib/financial-transaction-eod-lock.ts).
            const lockYmd = branchLock ? getKolkataCalendarYmd(branchLock.currentWorkingDate) : null;

            return successResponse({
                collectionBatchId,
                center: meeting.center,
                branch: meeting.branch,
                collectionDate: meeting.collectionDate.toISOString(),
                submittedBy: meeting.submittedBy
                    ? `${meeting.submittedBy.firstName} ${meeting.submittedBy.lastName}`
                    : null,
                photoUrl,
                denomination: {
                    d500: meeting.d500, d200: meeting.d200, d100: meeting.d100, d50: meeting.d50,
                    d20: meeting.d20, d10: meeting.d10, d5: meeting.d5, d2: meeting.d2, d1: meeting.d1,
                    upi: Number(meeting.upi),
                    totalAmount: Number(meeting.totalAmount),
                },
                transactions: transactions.map((t) => ({
                    transactionId: t.id,
                    clientId: t.clientId,
                    clientCode: t.client?.clientId || 'N/A',
                    clientName: t.client ? `${t.client.firstName} ${t.client.lastName}` : 'Unknown Client',
                    loanNumber: t.loan?.loanNumber || 'N/A',
                    amount: Number(t.amount),
                    principalAmount: Number(t.principalAmount || 0),
                    interestAmount: Number(t.interestAmount || 0),
                    isReversed: t.isReversed,
                    isEodLocked: !!lockYmd && lockYmd > getKolkataCalendarYmd(t.transactionDate),
                    isAllocationLocked: !!t.eodAllocatedAt,
                    // Loan-advance/savings cash sits in the same physical denomination pile
                    // but has its own ADMIN-only, LIFO-guarded revert flow (Loan Advance
                    // Revert) — it must still count toward the batch total here so the
                    // denomination math balances, but it is never selectable in this dialog.
                    isSavingsRow: t.type === 'SAVINGS_COLLECTION',
                })),
            }, 'Batch meeting details fetched successfully');
        } catch (error) {
            console.error('[Collection Revert] Error fetching batch meeting details:', error);
            return errorResponse('Failed to fetch batch details', 500);
        }
    })(request);
}
