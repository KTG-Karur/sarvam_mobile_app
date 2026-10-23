import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'],
        async (request, user) => {
            const { searchParams } = new URL(request.url);
            const date = searchParams.get('date');
            const branchId = searchParams.get('branchId');

            if (!date) {
                return NextResponse.json(
                    { success: false, message: 'Date is required.' },
                    { status: 400 }
                );
            }

            const searchDate = new Date(date);
            // Construct UTC range explicitly to match how we save (UTC midnight)
            const startOfDay = new Date(`${date}T00:00:00.000Z`);
            const endOfDay = new Date(`${date}T23:59:59.999Z`);

            try {
                const scopedBranchIds = await resolveScopedBranchIds(user, branchId);

                const transactions = await prisma.financialTransaction.findMany({
                    where: {
                        transactionDate: {
                            gte: startOfDay,
                            lte: endOfDay,
                        },
                        isActive: true,
                        // Branch filtering
                        ...buildFinancialTransactionBranchScope({ branchId: scopedBranchIds ?? undefined }),
                    },
                    include: {
                        ledger: { select: { id: true, ledgerName: true } },
                        creditLedger: { select: { id: true, ledgerName: true } },
                        selfAccount: { select: { id: true, name: true } },
                        contraAccount: { select: { id: true, name: true } },
                    },
                    orderBy: { voucherNo: 'asc' },
                });

                const formattedTransactions = transactions.map((tx) => {
                    let debitAccountName = '';
                    let creditAccountName = '';
                    let debitAccountId = '';
                    let creditAccountId = '';
                    let typeCode = '';

                    // Map internal types to legacy codes and resolve accounts
                    switch (tx.type) {
                        case 'CASH_PAYMENT':
                            typeCode = 'CP';
                            debitAccountName = tx.ledger?.ledgerName || '';
                            debitAccountId = tx.ledger?.id || '';
                            creditAccountName = tx.selfAccount?.name || ''; // Cash
                            creditAccountId = tx.selfAccount?.id || '';
                            break;
                        case 'CASH_RECEIPT':
                            typeCode = 'CR';
                            debitAccountName = tx.selfAccount?.name || ''; // Cash
                            debitAccountId = tx.selfAccount?.id || '';
                            creditAccountName = tx.ledger?.ledgerName || '';
                            creditAccountId = tx.ledger?.id || '';
                            break;
                        case 'BANK_PAYMENT':
                            typeCode = 'BP';
                            debitAccountName = tx.ledger?.ledgerName || '';
                            debitAccountId = tx.ledger?.id || '';
                            creditAccountName = tx.selfAccount?.name || ''; // Bank
                            creditAccountId = tx.selfAccount?.id || '';
                            break;
                        case 'BANK_RECEIPT':
                            typeCode = 'BR';
                            debitAccountName = tx.selfAccount?.name || ''; // Bank
                            debitAccountId = tx.selfAccount?.id || '';
                            creditAccountName = tx.ledger?.ledgerName || '';
                            creditAccountId = tx.ledger?.id || '';
                            break;
                        case 'JOURNAL':
                            typeCode = 'JV';
                            debitAccountName = tx.ledger?.ledgerName || '';
                            debitAccountId = tx.ledger?.id || '';
                            creditAccountName = tx.creditLedger?.ledgerName || '';
                            creditAccountId = tx.creditLedger?.id || '';
                            break;
                        case 'CONTRA':
                            typeCode = 'CV';
                            // Logic: Debit is receiver, Credit is giver.
                            // If selfAccountId and contraAccountId are used...
                            // Typically one is debit, one is credit depending on specific logic (Deposit/Withdrawal).
                            // Assuming simplistic mapping for now based on typical schema usage:
                            // If logic isn't explicit in DB, we display raw names or best guess.
                            // Let's assume transaction follows standard debit/credit convention if possible,
                            // but schema has specific fields.
                            // For consistency, let's map selfAccount to Debit and contraAccount to Credit or vice versa based on Amount direction if available?
                            // Actually, let's just use selfAccount as Primary and Contra as Secondary for now.
                            // Better: check if amount is positive/negative? No, amount is unsigned usually.
                            // Let's just map names:
                            debitAccountName = tx.selfAccount?.name || 'Bank/Cash';
                            debitAccountId = tx.selfAccount?.id || '';
                            creditAccountName = tx.contraAccount?.name || 'Cash/Bank';
                            creditAccountId = tx.contraAccount?.id || '';
                            break;
                        default:
                            typeCode = tx.type;
                    }

                    return {
                        id: tx.id,
                        voucherNo: tx.voucherNo,
                        transactionDate: tx.transactionDate.toISOString().split('T')[0],
                        type: tx.type, // Full type for logic
                        typeCode,     // Short code for display
                        amount: Number(tx.amount),
                        narration: tx.description || '',
                        debitAccountName,
                        creditAccountName,
                        debitAccountId,
                        creditAccountId,
                    };
                });

                return NextResponse.json({
                    success: true,
                    data: formattedTransactions,
                });
            } catch (error: any) {
                console.error('Error fetching transactions:', error);
                return NextResponse.json(
                    { success: false, message: 'Failed to fetch transactions.' },
                    { status: 500 }
                );
            }
        }
    )(req);
}
