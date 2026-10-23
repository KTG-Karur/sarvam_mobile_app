import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

const updateLedgerSchema = z.object({
    ledgerName: z.string().min(1, "Ledger Name is required"),
    groupedUnder: z.string().min(1, "Grouped Under is required"),
    allowAccessTo: z.array(z.enum(['H.O', 'B.O'])).min(1, "Please select at least one access permission"),
});

/**
 * PUT /api/accounts/ledgers/[id]
 * Update an account ledger
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const body = await req.json();

            const validation = updateLedgerSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const data = validation.data;

            return await prisma.$transaction(async (tx) => {
                // 1. Check if ledger exists
                const existing = await tx.accountLedger.findUnique({
                    where: { id },
                    include: {
                        _count: {
                            select: {
                                financialTransactions: true,
                                creditFinancialTransactions: true
                            }
                        }
                    }
                });

                if (!existing) {
                    throw new Error('Ledger not found');
                }

                // 2. Check for duplicate name (excluding current ledger)
                const duplicateName = await tx.accountLedger.findFirst({
                    where: {
                        ledgerName: { equals: data.ledgerName, mode: 'insensitive' },
                        isActive: true,
                        id: { not: id }
                    }
                });

                if (duplicateName) {
                    throw new Error(`Ledger Name "${data.ledgerName}" already exists`);
                }

                // 3. Validate Group existence
                const group = await tx.accountGroup.findUnique({
                    where: { groupId: data.groupedUnder }
                });

                if (!group) {
                    throw new Error('Selected Group does not exist');
                }

                // 4. Once transactions are recorded, the Group can no longer change
                //    (Allow Access To remains editable regardless of transactions)
                const hasTransactions =
                    existing._count.financialTransactions + existing._count.creditFinancialTransactions > 0;
                if (hasTransactions && data.groupedUnder !== existing.groupId) {
                    throw new Error('This ledger has recorded transactions - the Group can no longer be changed.');
                }

                // 5. Only Admin may rename an existing ledger
                if (data.ledgerName !== existing.ledgerName && user.role !== 'ADMIN') {
                    throw new Error('Only Admin can rename this ledger.');
                }

                // 6. Update
                const updatedLedger = await tx.accountLedger.update({
                    where: { id },
                    data: {
                        ledgerName: data.ledgerName,
                        groupId: data.groupedUnder,
                        allowAccessTo: data.allowAccessTo
                    }
                });

                return successResponse(updatedLedger, 'Account Ledger updated successfully');
            }).then(async (res) => {
                // Funder GET embeds principalGL/interestGL full ledger rows — a rename here
                // must bust that cache too, not just the ledgers list.
                await bumpMasterDataVersion('funders');
                return res;
            });

        } catch (error: any) {
            console.error('Error updating ledger:', error);
            if (error.message.includes('not found')) {
                return errorResponse(error.message, 404);
            }
            if (error.message.includes('already exists') || error.message.includes('does not exist')) {
                return errorResponse(error.message, 409);
            }
            if (error.message.includes('recorded transactions')) {
                return errorResponse(error.message, 400);
            }
            if (error.message.includes('Only Admin can rename')) {
                return errorResponse(error.message, 403);
            }
            return errorResponse('Failed to update account ledger', 500);
        }
    })(request);
}

/**
 * DELETE /api/accounts/ledgers/[id]
 * Delete an account ledger (soft delete)
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withAuth(async (req) => {
        try {
            const { id } = await params;

            const ledger = await prisma.accountLedger.findUnique({
                where: { id },
                include: {
                    _count: {
                        select: {
                            financialTransactions: true,
                            creditFinancialTransactions: true
                        }
                    }
                }
            });

            if (!ledger) {
                return errorResponse('Ledger not found', 404);
            }

            if (ledger._count.financialTransactions + ledger._count.creditFinancialTransactions > 0) {
                return errorResponse('Cannot delete a ledger with recorded transactions.', 400);
            }

            // Soft delete
            await prisma.accountLedger.update({
                where: { id },
                data: { isActive: false }
            });

            return successResponse(null, 'Account Ledger deleted successfully');
        } catch (error) {
            console.error('Error deleting ledger:', error);
            return errorResponse('Failed to delete account ledger', 500);
        }
    })(request);
}
