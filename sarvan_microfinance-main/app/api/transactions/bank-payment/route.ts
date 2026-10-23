import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';
import { getBranchWorkingDayWindow, isInstantWithinWindow } from '@/app/lib/branch-working-day-guard';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getBranchEodLockYmdMap, isEodLockedForTransaction } from '@/app/lib/financial-transaction-eod-lock';

const bankPaymentSchema = z.object({
    transactionDate: z.string(), // ISO String
    branchId: z.string().min(1, "Branch is required"),
    ledgerId: z.string().min(1, "Debit Account (Ledger) is required"),
    selfAccountId: z.string().min(1, "Credit Account (Self Account) is required"),
    amount: z.number().positive("Amount must be positive"),
    description: z.string().trim().min(1, "Narration is required."),
});

/**
 * GET /api/transactions/bank-payment
 * Fetch bank payments — server-side date-range filtered, searched, and paginated.
 * Defaults to the current month-to-date when fromDate/toDate are not supplied.
 */
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
                        { selfAccount: { name: { contains: search, mode: 'insensitive' as const } } },
                        { description: { contains: search, mode: 'insensitive' as const } },
                    ],
                }]
                : [];

            const where = {
                isActive: true,
                type: 'BANK_PAYMENT' as const,
                ...(approvalStatus ? { approvalStatus: approvalStatus as any } : {}),
                ...dateFilter,
                AND: [branchScope, ...searchFilter],
            };

            const [totalCount, transactions] = await Promise.all([
                prisma.financialTransaction.count({ where }),
                prisma.financialTransaction.findMany({
                    where,
                    include: {
                        selfAccount: true,
                        ledger: true,
                        branch: {
                            select: { id: true, code: true, name: true }
                        },
                        createdBy: {
                            select: { firstName: true, lastName: true }
                        },
                        rejectedBy: {
                            select: { firstName: true, lastName: true }
                        },
                        revertedBy: {
                            select: { firstName: true, lastName: true }
                        },
                        amApprovedBy: {
                            select: { firstName: true, lastName: true }
                        },
                        adminApprovedBy: {
                            select: { firstName: true, lastName: true }
                        }
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'asc' },
                    ],
                    ...(fetchAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
                }),
            ]);

            const distinctBranchIds = [...new Set(transactions.map((t) => t.branchId).filter(Boolean))] as string[];
            const lockYmdByBranch = await getBranchEodLockYmdMap(distinctBranchIds);

            const rows = transactions.map((t) => {
                if (!t.branchId) return { ...t, canModify: true as const };
                const blocked = isEodLockedForTransaction(lockYmdByBranch.get(t.branchId), t.transactionDate);
                return {
                    ...t,
                    canModify: !blocked,
                    modifyBlockedReason: blocked ? 'EOD completed' : undefined,
                };
            });

            return successResponse(
                { transactions: rows, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                'Bank Payments fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching bank payments:', error);
            return errorResponse('Failed to fetch bank payments', 500);
        }
    })(request);
}

/**
 * POST /api/transactions/bank-payment
 * Create a new bank payment
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (!['ADMIN', 'BRANCH_MANAGER'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const body = await req.json();
            const validation = bankPaymentSchema.safeParse(body);

            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const {
                transactionDate, selfAccountId, ledgerId, amount,
                description
            } = validation.data;

            let branchId: string;
            if (user.role === 'ADMIN' || isSubAdmin) {
                const branch = await prisma.branch.findUnique({ where: { id: validation.data.branchId } });
                if (!branch || !branch.isActive) {
                    return errorResponse('Invalid branch selected', 400);
                }
                branchId = branch.id;
            } else {
                if (!user.branchId) {
                    return errorResponse('Branch context is required to create a bank payment', 400);
                }
                branchId = user.branchId;
            }

            // Auto-generate Voucher No: BP-{YYMM}-{SEQ4}
            const date = new Date();
            const year = date.getFullYear().toString().slice(-2);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const prefix = `BP-${year}${month}-`;

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

            const voucherNo = `${prefix}${seq.toString().padStart(4, '0')}`;
            const parsedTransactionDate = new Date(transactionDate);

            if (user.role !== 'ADMIN') {
                const workingDay = await getBranchWorkingDayWindow({ branchId });
                if (!isInstantWithinWindow(parsedTransactionDate, workingDay)) {
                    return errorResponse(
                        `Transaction date must be within the branch working day (${workingDay.workingDateYmd})`,
                        409
                    );
                }
            }

            const approvalStatus = user.role === 'ADMIN' ? 'APPROVED' : 'PENDING_APPROVAL';

            const newTransaction = await prisma.financialTransaction.create({
                data: {
                    voucherNo,
                    transactionDate: parsedTransactionDate,
                    type: 'BANK_PAYMENT',
                    branchId,
                    selfAccountId,
                    ledgerId,
                    amount,
                    description,
                    createdById: user.userId,
                    approvalStatus: approvalStatus as any,
                    createdByRole: user.role,
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
                    ? 'Bank Payment created and approved successfully'
                    : 'Bank Payment submitted for AM approval',
                201
            );
        } catch (error) {
            console.error('Error creating bank payment:', error);
            return errorResponse('Failed to create bank payment', 500);
        }
    })(request);
}
