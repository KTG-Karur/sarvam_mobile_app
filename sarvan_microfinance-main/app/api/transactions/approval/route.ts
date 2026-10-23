import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getBranchEodLockYmdMap, isEodLockedForTransaction } from '@/app/lib/financial-transaction-eod-lock';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { z } from 'zod';

const APPROVAL_INCLUDE = {
    selfAccount: { select: { id: true, name: true } },
    contraAccount: { select: { id: true, name: true } },
    ledger: { select: { id: true, ledgerName: true } },
    creditLedger: { select: { id: true, ledgerName: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
    amApprovedBy: { select: { id: true, firstName: true, lastName: true } },
    adminApprovedBy: { select: { id: true, firstName: true, lastName: true } },
    rejectedBy: { select: { id: true, firstName: true, lastName: true } },
    revertedBy: { select: { id: true, firstName: true, lastName: true } },
    approvalHistory: {
        include: {
            performedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: 'asc' as const },
    },
    branch: { select: { id: true, name: true, code: true } },
};

const approvalActionSchema = z.object({
    action: z.enum(['approve', 'reject']),
    rejectionReason: z.string().optional(),
});

/**
 * GET /api/transactions/approval
 * Both AM and Admin see:
 *  - PENDING_APPROVAL transactions (need action)
 *  - APPROVED transactions that are still reversible (EOD hasn't closed their
 *    branch/date yet) — so a mistaken approval can still be rejected. Once EOD
 *    closes a date, its approved transactions roll off this queue.
 *  - REJECTED and REVERTED transactions (terminal — no action left, kept
 *    visible for reference regardless of EOD, since there's nothing left to lock).
 * AM sees only their assigned branches.
 * Admin and Sub-Admin see all branches.
 * Query params: branchId, type
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER' && await isSubAdminUser(user.userId);
            if (user.role !== 'AREA_MANAGER' && user.role !== 'ADMIN' && !isSubAdmin) {
                return errorResponse('Only Area Managers, Admins, and Sub-Admins can access the approval queue', 403);
            }

            const { searchParams } = new URL(request.url);
            const typeFilter = searchParams.get('type');
            const branchFilter = searchParams.get('branchId');

            const pendingStatus = 'PENDING_APPROVAL';
            const queueStatuses = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERTED'] as const;

            // Build branch scope based on user role
            let branchIds: string[] | undefined;

            if (user.role === 'AREA_MANAGER') {
                // AM sees only their assigned branches
                // Get assigned branch IDs from user object
                const assignedBranchIds = (user as any).assignedBranchIds || [];

                if (assignedBranchIds.length === 0) {
                    console.log(`[GET] AM ${user.userId} has no assigned branches`);
                    return successResponse(
                        { transactions: [], pendingCount: 0 },
                        'No branches assigned to this Area Manager'
                    );
                }

                // Apply branch filter if specified and it's in assigned branches
                if (branchFilter && assignedBranchIds.includes(branchFilter)) {
                    branchIds = [branchFilter];
                } else {
                    branchIds = assignedBranchIds;
                }

                console.log(`[GET] AM ${user.userId} assigned branches:`, branchIds);
            } else if ((user.role === 'ADMIN' || isSubAdmin) && branchFilter) {
                // Admin/Sub-Admin can optionally filter by a specific branch
                branchIds = [branchFilter];
                console.log(`[GET] Admin/Sub-Admin filtering by branch: ${branchFilter}`);
            }
            // Admin/Sub-Admin with no branchFilter sees ALL branches (branchIds remains undefined)

            // Build where clause
            const whereClause: any = {
                isActive: true,
                approvalStatus: { in: queueStatuses as unknown as string[] },
            };

            // Add type filter if specified
            if (typeFilter && typeFilter !== 'all') {
                whereClause.type = typeFilter as any;
            }

            // Add branch filter if we have specific branch IDs
            if (branchIds && branchIds.length > 0) {
                whereClause.branchId = { in: branchIds };
            }

            console.log(`[GET] Fetching queue for role: ${user.role}, branchIds: ${branchIds?.join(', ') || 'ALL'}`);

            const rawTransactions = await prisma.financialTransaction.findMany({
                where: whereClause,
                include: APPROVAL_INCLUDE,
                orderBy: { createdAt: 'asc' },
            });

            console.log(`[GET] Found ${rawTransactions.length} transactions with status in [${queueStatuses.join(', ')}]`);

            const distinctBranchIds = [...new Set(rawTransactions.map((t) => t.branchId).filter(Boolean))] as string[];
            const lockYmdByBranch = await getBranchEodLockYmdMap(distinctBranchIds);

            const transactions = rawTransactions
                .map((t) => ({
                    ...t,
                    eodLocked: !!t.branchId && isEodLockedForTransaction(lockYmdByBranch.get(t.branchId), t.transactionDate),
                }))
                // An EOD-closed APPROVED transaction is no longer reversible — drop it
                // from the queue (still visible/reviewable via the full history table).
                // PENDING_APPROVAL and REJECTED are never dropped by EOD lock: pending
                // still needs action, and rejected has no action left to lock.
                .filter((t) => t.approvalStatus !== 'APPROVED' || !t.eodLocked);

            // Pending count for dashboard badges — PENDING_APPROVAL only.
            const pendingCount = transactions.filter((t) => t.approvalStatus === pendingStatus).length;

            return successResponse(
                { transactions, pendingCount },
                `Fetched ${transactions.length} queue transactions`
            );
        } catch (error) {
            console.error('Error fetching approval queue:', error);
            return errorResponse('Failed to fetch approval queue', 500);
        }
    })(request);
}