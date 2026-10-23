import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { withAuth, successResponse, errorResponse } from '@/app/lib/api-utils';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getBranchEodLockYmdMap, isEodLockedForTransaction } from '@/app/lib/financial-transaction-eod-lock';

const cashReceiptSchema = z.object({
    transactionDate: z.string(), // ISO String
    branchId: z.string().min(1, "Branch is required"),
    selfAccountId: z.string().min(1, "Debit Account (Self Account) is required"),
    ledgerId: z.string().min(1, "Credit Account (Ledger) is required"),
    amount: z.number().positive("Amount must be positive"),
    description: z.string().trim().min(1, "Narration is required."),
});

export async function GET(req: NextRequest) {
    return withAuth(async (request, user) => {
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
                type: 'CASH_RECEIPT' as const,
                ...(approvalStatus ? { approvalStatus: approvalStatus as any } : {}),
                ...dateFilter,
                AND: [branchScope, ...searchFilter],
            };

            const [totalCount, transactions] = await Promise.all([
                prisma.financialTransaction.count({ where }),
                prisma.financialTransaction.findMany({
                    where,
                    include: {
                        selfAccount: {
                            select: { id: true, name: true }
                        },
                        ledger: {
                            select: { id: true, ledgerName: true }
                        },
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
                        { transactionDate: 'desc' },
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

            return successResponse({ transactions: rows, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize });
        } catch (error: any) {
            console.error("Error fetching cash receipts:", error);
            return errorResponse(error.message || 'Internal Server Error', 500);
        }
    })(req);
}

export async function POST(req: NextRequest) {
    return withAuth(async (request, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            if (!['ADMIN', 'BRANCH_MANAGER'].includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const body = await req.json();

            const validation = cashReceiptSchema.safeParse({
                ...body,
                amount: typeof body.amount === 'string' ? Number(body.amount) : body.amount,
            });
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }
            body.description = validation.data.description;

            let branchId: string;
            if (user.role === 'ADMIN' || isSubAdmin) {
                const branch = await prisma.branch.findUnique({ where: { id: validation.data.branchId } });
                if (!branch || !branch.isActive) {
                    return errorResponse('Invalid branch selected', 400);
                }
                branchId = branch.id;
            } else {
                if (!user.branchId) {
                    return errorResponse('Branch context is required to create a cash receipt', 400);
                }
                branchId = user.branchId;
            }

            const amount = validation.data.amount;

            // Generate Voucher No: CR-YYMM-XXXX
            const date = new Date();
            const year = date.getFullYear().toString().slice(-2);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const prefix = `CR-${year}${month}-`;

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

            // The voucher date is always the current EOD working date of the voucher's
            // own branch (the one resolved above) — never the client-sent date, for any
            // role. Anchor at UTC midnight of the working-day YMD to match how every
            // other FinancialTransaction date is stored and how the list query filters.
            const workingDay = await getBranchWorkingDayWindow({ branchId });
            const transactionDate = new Date(`${workingDay.workingDateYmd}T00:00:00.000Z`);

            const approvalStatus = user.role === 'ADMIN' ? 'APPROVED' : 'PENDING_APPROVAL';

            const newTransaction = await prisma.financialTransaction.create({
                data: {
                    voucherNo,
                    transactionDate,
                    type: 'CASH_RECEIPT',
                    branchId,
                    selfAccountId: body.selfAccountId, // Debit
                    ledgerId: body.ledgerId,         // Credit
                    amount,
                    description: body.description,
                    instrumentNo: body.instrumentNo,
                    instrumentDate: body.instrumentDate ? new Date(body.instrumentDate) : null,
                    bankName: body.bankName,
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

            return NextResponse.json({
                success: true,
                data: newTransaction,
                message: approvalStatus === 'APPROVED'
                    ? 'Cash Receipt created and approved successfully'
                    : 'Cash Receipt submitted for AM approval'
            });

        } catch (error: any) {
            console.error("Error creating Cash Receipt:", error);
            return errorResponse(error.message || 'Internal Server Error', 500);
        }
    })(req);
}
