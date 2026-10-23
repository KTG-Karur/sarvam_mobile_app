import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { buildBranchWhereClause, getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/savings/loan-advance-ledger
 * Returns all SAVINGS_COLLECTION and SAVINGS_REFUND transactions grouped by client.
 * Query: branchId, centerId, fromDate, toDate (all optional)
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const centerId = searchParams.get('centerId');
            const clientDbId = searchParams.get('clientDbId');
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');

            // Multi-tenancy boundary — never let an omitted/arbitrary branchId
            // return every branch's savings ledger; scope to what this role
            // is actually permitted to see.
            const branchWhere = await buildBranchWhereClause(user, branchId);

            const where: any = {
                type: { in: ['SAVINGS_COLLECTION', 'SAVINGS_REFUND'] },
                ...branchWhere,
            };

            if (centerId) where.centerId = centerId;
            if (clientDbId) where.clientId = clientDbId;

            if (fromDate || toDate) {
                where.transactionDate = {};
                if (fromDate) where.transactionDate.gte = new Date(fromDate + 'T00:00:00.000Z');
                if (toDate) where.transactionDate.lte = new Date(toDate + 'T23:59:59.999Z');
            }

            const transactions = await prisma.loanTransaction.findMany({
                where,
                select: {
                    id: true,
                    transactionId: true,
                    amount: true,
                    type: true,
                    paymentMode: true,
                    transactionDate: true,
                    status: true,
                    clientId: true,
                    loanId: true,
                    client: {
                        select: {
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            loanAdvance: true,
                            center: {
                                select: { name: true, code: true },
                            },
                        },
                    },
                    loan: {
                        select: { loanNumber: true },
                    },
                },
                orderBy: { transactionDate: 'desc' },
            });

            // Group by clientId
            const clientMap = new Map<string, {
                clientDbId: string;
                clientCode: string;
                clientName: string;
                centerCode: string;
                centerName: string;
                currentBalance: number;
                totalCollected: number;
                totalRefunded: number;
                transactions: Array<{
                    id: string;
                    transactionId: string;
                    date: string;
                    type: string;
                    loanNumber: string;
                    amount: number;
                    paymentMode: string;
                    status: string;
                }>;
            }>();

            for (const tx of transactions) {
                const cId = tx.clientId;
                if (!clientMap.has(cId)) {
                    clientMap.set(cId, {
                        clientDbId: cId,
                        clientCode: tx.client.clientId,
                        clientName: `${tx.client.firstName} ${tx.client.lastName}`,
                        centerCode: tx.client.center?.code ?? '',
                        centerName: tx.client.center?.name ?? '',
                        currentBalance: Number(tx.client.loanAdvance ?? 0),
                        totalCollected: 0,
                        totalRefunded: 0,
                        transactions: [],
                    });
                }

                const entry = clientMap.get(cId)!;
                const amt = Number(tx.amount);
                if (tx.type === 'SAVINGS_COLLECTION') entry.totalCollected += amt;
                else if (tx.type === 'SAVINGS_REFUND') entry.totalRefunded += amt;

                entry.transactions.push({
                    id: tx.id,
                    transactionId: tx.transactionId,
                    date: tx.transactionDate.toISOString(),
                    type: tx.type,
                    loanNumber: tx.loan?.loanNumber ?? '',
                    amount: amt,
                    paymentMode: tx.paymentMode,
                    status: tx.status,
                });
            }

            // Backup loan clients: loanAdvance updated but no SAVINGS_COLLECTION transactions exist.
            // If a specific client was requested and isn't in the map, fetch them directly.
            if (clientDbId && !clientMap.has(clientDbId)) {
                const client = await prisma.client.findUnique({
                    where: { id: clientDbId },
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        loanAdvance: true,
                        center: { select: { name: true, code: true, branchId: true } },
                    },
                });
                const permittedBranchIds = await getPermittedBranchIds(user);
                const clientAllowed = !client || permittedBranchIds === null
                    || (client.center && permittedBranchIds.includes(client.center.branchId));
                if (client && clientAllowed) {
                    clientMap.set(clientDbId, {
                        clientDbId,
                        clientCode: client.clientId,
                        clientName: `${client.firstName} ${client.lastName}`,
                        centerCode: client.center?.code ?? '',
                        centerName: client.center?.name ?? '',
                        currentBalance: Number(client.loanAdvance ?? 0),
                        totalCollected: 0,
                        totalRefunded: 0,
                        transactions: [],
                    });
                }
            }

            const data = Array.from(clientMap.values());

            const grandTotalCollected = data.reduce((s, r) => s + r.totalCollected, 0);
            const grandTotalRefunded = data.reduce((s, r) => s + r.totalRefunded, 0);
            const grandNetBalance = data.reduce((s, r) => s + r.currentBalance, 0);

            return successResponse({
                data,
                totals: {
                    totalCollected: grandTotalCollected,
                    totalRefunded: grandTotalRefunded,
                    netBalance: grandNetBalance,
                    clientCount: data.length,
                },
            }, 'Loan advance ledger fetched');
        } catch (error) {
            console.error('Error fetching loan advance ledger:', error);
            return errorResponse('Failed to fetch loan advance ledger', 500);
        }
    })(request);
}
