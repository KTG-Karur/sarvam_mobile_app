import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getBranchEodLockYmdMap, isEodLockedForTransaction } from '@/app/lib/financial-transaction-eod-lock';

const journalSchema = z.object({
    transactionDate: z.string().min(1, 'Transaction date is required'),
    branchId: z.string().min(1, 'Branch is required'),
    debitLedgerId: z.string().min(1, 'Debit account is required'),
    creditLedgerId: z.string().min(1, 'Credit account is required'),
    amount: z.number().positive('Amount must be positive'),
    description: z.string().trim().min(1, 'Narration is required.'),
});

async function getNextVoucherNo() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `JV-${year}${month}-`;

    const lastTx = await prisma.financialTransaction.findFirst({
        where: { voucherNo: { startsWith: prefix } },
        orderBy: { voucherNo: 'desc' },
    });

    let seq = 1;
    if (lastTx) {
        const parts = lastTx.voucherNo.split('-');
        if (parts.length >= 3) {
            const lastSeq = parseInt(parts[2]);
            if (!isNaN(lastSeq)) seq = lastSeq + 1;
        }
    }

    return `${prefix}${seq.toString().padStart(4, '0')}`;
}

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
                        { ledger: { ledgerName: { contains: search, mode: 'insensitive' as const } } },
                        { creditLedger: { ledgerName: { contains: search, mode: 'insensitive' as const } } },
                        { description: { contains: search, mode: 'insensitive' as const } },
                    ],
                }]
                : [];

            const where = {
                isActive: true,
                type: 'JOURNAL' as const,
                ...(approvalStatus ? { approvalStatus: approvalStatus as any } : {}),
                ...dateFilter,
                AND: [branchScope, ...searchFilter],
            };

            const [totalCount, rawTransactions, nextVoucherNo] = await Promise.all([
                prisma.financialTransaction.count({ where }),
                prisma.financialTransaction.findMany({
                    where,
                    include: {
                        ledger: { select: { id: true, ledgerName: true } },
                        creditLedger: { select: { id: true, ledgerName: true } },
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
                getNextVoucherNo(),
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

            return successResponse(
                { transactions, nextVoucherNo, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                'Journal transactions fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching journal transactions:', error);
            return errorResponse('Failed to fetch journal transactions', 500);
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
            const validation = journalSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { transactionDate, debitLedgerId, creditLedgerId, amount, description } = validation.data;

            if (debitLedgerId === creditLedgerId) {
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
                    return errorResponse('Branch context is required to create a journal voucher', 400);
                }
                branchId = user.branchId;
            }

            const voucherNo = await getNextVoucherNo();
            const approvalStatus = user.role === 'ADMIN' ? 'APPROVED' : 'PENDING_APPROVAL';

            const newTransaction = await prisma.financialTransaction.create({
                data: {
                    voucherNo,
                    transactionDate: new Date(transactionDate),
                    type: 'JOURNAL',
                    branchId,
                    ledgerId: debitLedgerId,
                    creditLedgerId,
                    amount,
                    description,
                    createdById: user.userId,
                    approvalStatus: approvalStatus as any,
                    createdByRole: user.role,
                },
                include: {
                    ledger: { select: { id: true, ledgerName: true } },
                    creditLedger: { select: { id: true, ledgerName: true } },
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
                    ? 'Journal voucher created and approved successfully'
                    : 'Journal voucher submitted for AM approval',
                201
            );
        } catch (error) {
            console.error('Error creating journal transaction:', error);
            return errorResponse('Failed to create journal voucher', 500);
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
                where: { id, type: 'JOURNAL', isActive: true },
            });
            if (!tx) return errorResponse('Journal voucher not found', 404);

            await prisma.financialTransaction.update({
                where: { id },
                data: { isActive: false },
            });

            return successResponse(null, 'Journal voucher deleted successfully');
        } catch (error) {
            console.error('Error deleting journal transaction:', error);
            return errorResponse('Failed to delete journal voucher', 500);
        }
    })(request);
}
