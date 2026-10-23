import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';

const createLedgerSchema = z.object({
    ledgerName: z.string().min(1, "Ledger Name is required"),
    groupedUnder: z.string().min(1, "Grouped Under is required"),
    allowAccessTo: z.array(z.enum(['H.O', 'B.O'])).min(1, "Please select at least one access permission"),
});

/**
 * GET /api/accounts/ledgers
 * Fetch all account ledgers
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const ledgers = await prisma.accountLedger.findMany({
                orderBy: {
                    createdAt: 'asc'
                },
                include: {
                    group: {
                        select: {
                            groupName: true,
                            groupId: true,
                            parentGroup: {
                                select: {
                                    groupName: true
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            financialTransactions: true,
                            creditFinancialTransactions: true
                        }
                    }
                },
                where: {
                    isActive: true
                }
            });

            // Transform for UI
            const formattedLedgers = ledgers.map(l => ({
                ...l,
                parentGroupName: l.group?.groupName || null,
                primaryGroupName: l.group?.parentGroup?.groupName || l.group?.groupName || null,
                hasTransactions: (l._count.financialTransactions + l._count.creditFinancialTransactions) > 0
            }));

            // Sort numerically in JS
            formattedLedgers.sort((a, b) => {
                const numA = parseInt(a.ledgerId, 10);
                const numB = parseInt(b.ledgerId, 10);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return a.ledgerId.localeCompare(b.ledgerId);
            });

            return successResponse(formattedLedgers, 'Ledgers fetched successfully');
        } catch (error) {
            console.error('Error fetching ledgers:', error);
            return errorResponse('Failed to fetch ledgers', 500);
        }
    })(request);
}

/**
 * POST /api/accounts/ledgers
 * Create a new account ledger
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const body = await req.json();

            const validation = createLedgerSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const data = validation.data;

            return await prisma.$transaction(async (tx) => {
                // 1. Check for duplicate name
                const existingName = await tx.accountLedger.findFirst({
                    where: {
                        ledgerName: { equals: data.ledgerName, mode: 'insensitive' },
                        isActive: true
                    }
                });

                if (existingName) {
                    throw new Error(`Ledger Name "${data.ledgerName}" already exists`);
                }

                // 2. Validate Group existence
                const group = await tx.accountGroup.findUnique({
                    where: { groupId: data.groupedUnder }
                });

                if (!group) {
                    throw new Error('Selected Group does not exist');
                }

                // 3. Auto-generate Numeric Ledger ID
                const allLedgers = await tx.accountLedger.findMany({
                    select: { ledgerId: true }
                });

                let maxId = 0;
                for (const l of allLedgers) {
                    const num = parseInt(l.ledgerId, 10);
                    if (!isNaN(num) && num > maxId) {
                        maxId = num;
                    }
                }
                const nextLedgerId = (maxId + 1).toString();

                // 4. Create
                const newLedger = await tx.accountLedger.create({
                    data: {
                        ledgerId: nextLedgerId,
                        ledgerName: data.ledgerName,
                        groupId: data.groupedUnder,
                        allowAccessTo: data.allowAccessTo,
                        isActive: true
                    }
                });

                return successResponse(newLedger, 'Account Ledger created successfully', 201);
            });

        } catch (error: any) {
            console.error('Error creating ledger:', error);
            if (error.message.includes('already exists') || error.message.includes('does not exist')) {
                return errorResponse(error.message, 409);
            }
            return errorResponse('Failed to create account ledger', 500);
        }
    })(request);
}
