import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getBranchEodLockYmdMap, isEodLockedForTransaction } from '@/app/lib/financial-transaction-eod-lock';

const contraSchema = z.object({
    transactionDate: z.string().min(1, 'Transaction date is required'),
    branchId: z.string().min(1, 'Branch is required'),
    debitAccountId: z.string().min(1, 'Debit account is required'),
    creditAccountId: z.string().min(1, 'Credit account is required'),
    amount: z.number().positive('Amount must be positive'),
    description: z.string().trim().min(1, 'Narration is required.'),
});

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const approvalStatus = searchParams.get('approvalStatus');
            const scopedBranchIds = await resolveScopedBranchIds(user, searchParams.get('branchId'));
            const search = searchParams.get('search')?.trim() || undefined;
            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '10', 10)));
            const fetchAll = searchParams.get('all') === 'true';

            const now = new Date();
            const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const defaultTo = now.toISOString().split('T')[0];
            const fromDate = searchParams.get('fromDate') || defaultFrom;
            const toDate = searchParams.get('toDate') || defaultTo;
            const dateFilter = {
                transactionDate: {
                    gte: new Date(`${fromDate}T00:00:00.000Z`),
                    lte: new Date(`${toDate}T23:59:59.999Z`),
                },
            };

            const branchScope = buildFinancialTransactionBranchScope({ branchId: scopedBranchIds ?? undefined });
            const searchFilter = search
                ? [{
                    OR: [
                        { voucherNo: { contains: search, mode: 'insensitive' as const } },
                        { selfAccount: { name: { contains: search, mode: 'insensitive' as const } } },
                        { contraAccount: { name: { contains: search, mode: 'insensitive' as const } } },
                        { description: { contains: search, mode: 'insensitive' as const } },
                    ],
                }]
                : [];

            const where = {
                isActive: true,
                type: 'CONTRA' as const,
                ...(approvalStatus ? { approvalStatus: approvalStatus as any } : {}),
                ...dateFilter,
                AND: [branchScope, ...searchFilter],
            };

            const [totalCount, rawTransactions] = await Promise.all([
                prisma.financialTransaction.count({ where }),
                prisma.financialTransaction.findMany({
                    where,
                    include: {
                        selfAccount: { select: { id: true, name: true } },
                        contraAccount: { select: { id: true, name: true } },
                        branch: { select: { id: true, code: true, name: true } },
                        createdBy: { select: { firstName: true, lastName: true } },
                        rejectedBy: { select: { firstName: true, lastName: true } },
                        revertedBy: { select: { firstName: true, lastName: true } },
                        amApprovedBy: { select: { firstName: true, lastName: true } },
                        adminApprovedBy: { select: { firstName: true, lastName: true } },
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'asc' },
                    ],
                    ...(fetchAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
                }),
            ]);

            const distinctBranchIds = [...new Set(rawTransactions.map((t) => t.branchId).filter(Boolean))] as string[];
            const lockYmdByBranch = await getBranchEodLockYmdMap(distinctBranchIds);

            const transactions = rawTransactions.map((t) => {
                if (!t.branchId) return { ...t, canModify: true as const };
                const blocked = isEodLockedForTransaction(lockYmdByBranch.get(t.branchId), t.transactionDate);
                return {
                    ...t,
                    canModify: !blocked,
                    modifyBlockedReason: blocked ? 'EOD completed' : undefined,
                };
            });

            // Calculate next voucher number: First available integer (Gap filling).
            // Always scans the full active-CONTRA set (unfiltered by date/pagination) —
            // this is a global sequence, not a list.
            const activeContras = await prisma.financialTransaction.findMany({
                where: { type: 'CONTRA', isActive: true },
                select: { voucherNo: true }
            });

            const usedNums = activeContras
                .map(tx => parseInt(tx.voucherNo))
                .filter(num => !isNaN(num) && /^\d+$/.test(activeContras.find(v => parseInt(v.voucherNo) === num)?.voucherNo || ''))
                .sort((a, b) => a - b);

            let nextVoucherNoNum = 1;
            for (const num of usedNums) {
                if (num === nextVoucherNoNum) {
                    nextVoucherNoNum++;
                } else if (num > nextVoucherNoNum) {
                    break;
                }
            }
            const nextVoucherNo = nextVoucherNoNum.toString();

            return successResponse(
                { transactions, nextVoucherNo, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                'Contra transactions fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching contra transactions:', error);
            return errorResponse('Failed to fetch contra transactions', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (!['ADMIN', 'BRANCH_MANAGER'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const body = await req.json();
            const validation = contraSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { transactionDate, debitAccountId, creditAccountId, amount, description } = validation.data;

            if (debitAccountId === creditAccountId) {
                return errorResponse('Debit and Credit accounts must be different', 400);
            }

            let branchId: string;
            if (user.role === 'ADMIN' || isSubAdmin) {
                const branch = await prisma.branch.findUnique({ where: { id: validation.data.branchId } });
                if (!branch || !branch.isActive) {
                    return errorResponse('Invalid branch selected', 400);
                }
                branchId = branch.id;
            } else {
                if (!user.branchId) {
                    return errorResponse('Branch context is required to create a contra voucher', 400);
                }
                branchId = user.branchId;
            }

            // Simple incrementing sequence logic (Active only - Gap filling)
            const activeContras = await prisma.financialTransaction.findMany({
                where: { type: 'CONTRA', isActive: true },
                select: { voucherNo: true }
            });

            const usedNums = activeContras
                .map(tx => parseInt(tx.voucherNo))
                .filter(num => !isNaN(num) && /^\d+$/.test(activeContras.find(v => parseInt(v.voucherNo) === num)?.voucherNo || ''))
                .sort((a, b) => a - b);

            let nextVoucherNoNum = 1;
            for (const num of usedNums) {
                if (num === nextVoucherNoNum) {
                    nextVoucherNoNum++;
                } else if (num > nextVoucherNoNum) {
                    break;
                }
            }
            const voucherNo = nextVoucherNoNum.toString();

            // Proactive cleanup: if this voucherNo is already taken by an INACTIVE record, 
            // rename it to free up the unique constraint.
            const conflictingInactive = await prisma.financialTransaction.findFirst({
                where: { voucherNo, type: 'CONTRA', isActive: false }
            });

            if (conflictingInactive) {
                await prisma.financialTransaction.update({
                    where: { id: conflictingInactive.id },
                    data: { voucherNo: `${voucherNo}-deleted-cleanup-${Date.now()}` }
                });
            }

            const approvalStatus = user.role === 'ADMIN' ? 'APPROVED' : 'PENDING_APPROVAL';

            const newTransaction = await prisma.financialTransaction.create({
                data: {
                    voucherNo,
                    transactionDate: new Date(transactionDate),
                    type: 'CONTRA',
                    branchId,
                    selfAccountId: debitAccountId,
                    contraAccountId: creditAccountId,
                    amount,
                    description,
                    createdById: user.userId,
                    approvalStatus: approvalStatus as any,
                    createdByRole: user.role,
                },
                include: {
                    selfAccount: { select: { id: true, name: true } },
                    contraAccount: { select: { id: true, name: true } },
                    createdBy: { select: { firstName: true, lastName: true } },
                },
            });

            await prisma.transactionApprovalHistory.create({
                data: {
                    transactionId: newTransaction.id,
                    action: approvalStatus === 'APPROVED' ? 'AUTO_APPROVED' : 'CREATED',
                    performedById: user.userId,
                    previousStatus: 'PENDING_APPROVAL',
                    newStatus: approvalStatus as any,
                },
            });

            return successResponse(
                newTransaction,
                approvalStatus === 'APPROVED'
                    ? 'Contra voucher created and approved successfully'
                    : 'Contra voucher submitted for AM approval',
                201
            );
        } catch (error: any) {
            console.error('Error creating contra transaction:', error);
            if (error.code) {
                console.error(`Prisma error code: ${error.code}`);
                if (error.code === 'P2002') {
                    return errorResponse(`Voucher number conflict. Please try again.`, 409);
                }
            }
            return errorResponse(`Failed to create contra voucher: ${error.message || 'Unknown error'}`, 500);
        }
    })(request);
}

export async function DELETE(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (user.role !== 'ADMIN' && !isSubAdmin) {
                return errorResponse('Only Admins and Sub-Admins can delete this transaction', 403);
            }

            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Transaction ID is required', 400);

            const tx = await prisma.financialTransaction.findFirst({
                where: { id, type: 'CONTRA', isActive: true },
            });
            if (!tx) return errorResponse('Contra voucher not found', 404);

            // Append deleted suffix to free up voucherNo for reuse
            await prisma.financialTransaction.update({
                where: { id },
                data: {
                    isActive: false,
                    voucherNo: `${tx.voucherNo}-deleted-${Date.now()}`
                },
            });

            return successResponse(null, 'Contra voucher deleted successfully');
        } catch (error) {
            console.error('Error deleting contra transaction:', error);
            return errorResponse('Failed to delete contra voucher', 500);
        }
    })(request);
}
