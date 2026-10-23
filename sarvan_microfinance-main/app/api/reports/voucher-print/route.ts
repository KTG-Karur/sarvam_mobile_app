import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async (request, user) => {
            const { searchParams } = new URL(request.url);
            const voucherDate = searchParams.get('date');
            const typeFilter = searchParams.get('type'); // optional: BANK_RECEIPT, CASH_RECEIPT, etc.

            if (!voucherDate) {
                return NextResponse.json(
                    { success: false, message: 'date is required.' },
                    { status: 400 }
                );
            }

            const startOfDay = new Date(voucherDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(voucherDate);
            endOfDay.setHours(23, 59, 59, 999);

            const whereClause: any = {
                isActive: true,
                transactionDate: { gte: startOfDay, lte: endOfDay },
            };

            if (typeFilter && typeFilter !== 'ALL') {
                whereClause.type = typeFilter;
            }

            // Branch scope: ADMIN sees company-wide; BM/AM restricted to their own/assigned branch(es).
            if (user.role !== 'ADMIN') {
                const permitted = await getPermittedBranchIds(user);
                const ors = (permitted ?? []).flatMap(
                    (id) => (buildFinancialTransactionBranchScope({ branchId: id }) as any).OR ?? []
                );
                Object.assign(whereClause, ors.length > 0 ? { OR: ors } : { branchId: '__NO_PERMITTED_BRANCH__' });
            }

            const transactions = await prisma.financialTransaction.findMany({
                where: whereClause,
                include: {
                    selfAccount: { select: { id: true, name: true } },
                    ledger: { select: { id: true, ledgerName: true } },
                    createdBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            branch: { select: { name: true, code: true } },
                        },
                    },
                },
                orderBy: [{ type: 'asc' }, { voucherNo: 'asc' }],
            });

            const vouchers = transactions.map((tx) => {
                const amount = Number(tx.amount);

                // Determine Dr/Cr based on transaction type
                let drAccount = '';
                let crAccount = '';

                switch (tx.type) {
                    case 'BANK_RECEIPT':
                    case 'CASH_RECEIPT':
                        drAccount = tx.selfAccount?.name ?? '';
                        crAccount = tx.ledger?.ledgerName ?? '';
                        break;
                    case 'BANK_PAYMENT':
                    case 'CASH_PAYMENT':
                        drAccount = tx.ledger?.ledgerName ?? '';
                        crAccount = tx.selfAccount?.name ?? '';
                        break;
                    case 'CONTRA':
                        drAccount = tx.selfAccount?.name ?? '';
                        crAccount = tx.ledger?.ledgerName ?? '';
                        break;
                    case 'JOURNAL':
                        drAccount = tx.ledger?.ledgerName ?? '';
                        crAccount = tx.selfAccount?.name ?? '';
                        break;
                    default:
                        drAccount = tx.ledger?.ledgerName ?? '';
                        crAccount = tx.selfAccount?.name ?? '';
                }

                const voucherTypeLabel: Record<string, string> = {
                    BANK_RECEIPT: 'Bank Receipt',
                    BANK_PAYMENT: 'Bank Payment',
                    CASH_RECEIPT: 'Cash Receipt',
                    CASH_PAYMENT: 'Cash Payment',
                    CONTRA: 'Contra',
                    JOURNAL: 'Journal',
                };

                return {
                    id: tx.id,
                    voucherNo: tx.voucherNo,
                    voucherType: tx.type,
                    voucherTypeLabel: voucherTypeLabel[tx.type] ?? tx.type,
                    transactionDate: tx.transactionDate.toISOString(),
                    drAccount,
                    crAccount,
                    amount,
                    narration: tx.description ?? '',
                    instrumentNo: tx.instrumentNo ?? '',
                    instrumentDate: tx.instrumentDate?.toISOString() ?? null,
                    bankName: tx.bankName ?? '',
                    createdBy: `${tx.createdBy.firstName} ${tx.createdBy.lastName}`,
                    branch: tx.createdBy.branch?.name ?? '',
                };
            });

            const summary = {
                total: vouchers.length,
                bankReceipts: vouchers.filter((v) => v.voucherType === 'BANK_RECEIPT').length,
                cashReceipts: vouchers.filter((v) => v.voucherType === 'CASH_RECEIPT').length,
                bankPayments: vouchers.filter((v) => v.voucherType === 'BANK_PAYMENT').length,
                cashPayments: vouchers.filter((v) => v.voucherType === 'CASH_PAYMENT').length,
                contras: vouchers.filter((v) => v.voucherType === 'CONTRA').length,
                journals: vouchers.filter((v) => v.voucherType === 'JOURNAL').length,
                totalAmount: vouchers.reduce((s, v) => s + v.amount, 0),
            };

            return NextResponse.json({ success: true, data: { vouchers, summary } });
        }
    )(req);
}
