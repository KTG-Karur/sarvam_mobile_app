
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'],
        async (request) => {
            const { id } = params;
            const body = await request.json();
            const { transactionDate, amount, debitAccountId, creditAccountId, description, originalType } = body;

            if (!id || amount === undefined || amount === null || !transactionDate || !debitAccountId || !creditAccountId) {
                const missing = [
                    !transactionDate && 'date',
                    (amount === undefined || amount === null) && 'amount',
                    !debitAccountId && 'debit account',
                    !creditAccountId && 'credit account',
                ].filter(Boolean).join(', ');
                return NextResponse.json(
                    { success: false, message: `All fields are required. Missing: ${missing}.` },
                    { status: 400 }
                );
            }

            const existing = await prisma.financialTransaction.findUnique({
                where: { id },
                select: { approvalStatus: true, postingMarker: true },
            });

            if (!existing) {
                return NextResponse.json(
                    { success: false, message: 'Transaction not found.' },
                    { status: 404 }
                );
            }

            // System-posted vouchers (e.g. Loan Advance Refund) are owned by the
            // workflow that created them — editing here would desync the source
            // record. They can only be undone from that workflow's revert screen.
            if (existing.postingMarker) {
                return NextResponse.json(
                    { success: false, message: 'This voucher was auto-posted by another workflow (e.g. Loan Advance Refund). Undo it from that workflow\'s revert screen, not here.' },
                    { status: 409 }
                );
            }

            if (existing.approvalStatus === 'APPROVED') {
                return NextResponse.json(
                    { success: false, message: 'Approved transactions cannot be edited. Please revert the transaction before making changes.' },
                    { status: 409 }
                );
            }

            const type = originalType; // Assuming type can't change via this simple interface as discussed

            let updateData: any = {
                transactionDate: new Date(transactionDate),
                amount: parseFloat(amount),
                description,
                // Editing a reverted transaction re-enters the normal approval workflow.
                ...(existing.approvalStatus === 'REVERTED' ? { approvalStatus: 'PENDING_APPROVAL' } : {}),
            };

            // Map generic debit/credit account IDs back to specific schema fields based on type
            switch (type) {
                case 'CASH_PAYMENT':
                case 'BANK_PAYMENT':
                    updateData.ledgerId = debitAccountId;       // Debit = Ledger
                    updateData.selfAccountId = creditAccountId; // Credit = Self(Cash/Bank)
                    break;
                case 'CASH_RECEIPT':
                case 'BANK_RECEIPT':
                    updateData.selfAccountId = debitAccountId;  // Debit = Self(Cash/Bank)
                    updateData.ledgerId = creditAccountId;      // Credit = Ledger
                    break;
                case 'JOURNAL':
                    updateData.ledgerId = debitAccountId;       // Debit = Ledger
                    updateData.creditLedgerId = creditAccountId;// Credit = Ledger
                    break;
                case 'CONTRA':
                    updateData.selfAccountId = debitAccountId;    // Debit = Self
                    updateData.contraAccountId = creditAccountId; // Credit = Contra (e.g. Bank)
                    break;
                default:
                    // If unknown type, try to infer or fallback. But simpler to error if unsupported.
                    return NextResponse.json(
                        { success: false, message: 'Unsupported transaction type for modification.' },
                        { status: 400 }
                    );
            }

            try {
                const updatedTx = await prisma.financialTransaction.update({
                    where: { id },
                    data: updateData,
                });

                return NextResponse.json({
                    success: true,
                    message: 'Transaction updated successfully.',
                    data: updatedTx,
                });
            } catch (error: any) {
                console.error('Error updating transaction:', error);
                return NextResponse.json(
                    { success: false, message: 'Failed to update transaction.' },
                    { status: 500 }
                );
            }
        }
    )(req);
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER'],
        async (request) => {
            const id = params.id;

            if (!id) {
                return NextResponse.json(
                    { success: false, message: 'Transaction ID is required.' },
                    { status: 400 }
                );
            }

            try {
                const tx = await prisma.financialTransaction.findUnique({
                    where: { id },
                    select: { voucherNo: true, postingMarker: true }
                });

                if (!tx) {
                    return NextResponse.json(
                        { success: false, message: 'Transaction not found.' },
                        { status: 404 }
                    );
                }

                // System-posted vouchers (e.g. Loan Advance Refund) are owned by the
                // workflow that created them — deleting here would leave the source
                // record dangling. They can only be undone from that workflow's revert screen.
                if (tx.postingMarker) {
                    return NextResponse.json(
                        { success: false, message: 'This voucher was auto-posted by another workflow (e.g. Loan Advance Refund). Undo it from that workflow\'s revert screen, not here.' },
                        { status: 409 }
                    );
                }

                // Soft delete by setting isActive = false and renaming voucherNo for reuse
                await prisma.financialTransaction.update({
                    where: { id },
                    data: {
                        isActive: false,
                        voucherNo: `${tx.voucherNo}-deleted-${Date.now()}`
                    },
                });

                return NextResponse.json({
                    success: true,
                    message: 'Transaction deleted successfully.',
                });
            } catch (error: any) {
                console.error('Error deleting transaction:', error);
                return NextResponse.json(
                    { success: false, message: 'Failed to delete transaction.' },
                    { status: 500 }
                );
            }
        }
    )(req);
}
