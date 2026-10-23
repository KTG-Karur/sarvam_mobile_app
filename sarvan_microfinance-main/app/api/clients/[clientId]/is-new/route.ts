import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/clients/{clientId}/is-new
 *
 * Check if a client is new (first-time borrower)
 * A client is considered new if they have:
 * - No completed loans
 * - No active/running loans
 * - No previous loan history
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { clientId } = await params;

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            // First try to find by database ID, then by formatted clientId
            let client = await prisma.client.findUnique({
                where: { id: clientId },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    admissionFees: true,
                },
            });

            // If not found by ID, try by formatted clientId
            if (!client) {
                // Client.clientId isn't DB-unique (uploan-imported legacy IDs can
                // intentionally collide, see schema.prisma) — deterministic oldest-created
                // tiebreak.
                client = await prisma.client.findFirst({
                    where: { clientId: clientId },
                    orderBy: { createdAt: 'asc' },
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        admissionFees: true,
                    },
                });
            }

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Use the database client ID (not the formatted one)
            const dbClientId = client.id;

            // Count disbursed loans (completed loans)
            const disbursedLoansCount = await prisma.loan.count({
                where: {
                    clientId: dbClientId,
                    disbursementStatus: 'DISBURSED',
                },
            });

            // Count active/running loans (non-rejected loans that are still active)
            const activeLoansCount = await prisma.loan.count({
                where: {
                    clientId: dbClientId,
                    isActive: true,
                    disbursementStatus: {
                        not: 'REJECTED',
                    },
                },
            });

            // A client is NEW if they have never had a loan DISBURSED
            const isNew = disbursedLoansCount === 0;

            return successResponse(
                {
                    clientId: client.id,
                    clientName: `${client.firstName} ${client.lastName}`.trim(),
                    isNew,
                    disbursedLoans: disbursedLoansCount,
                    activeLoans: activeLoansCount,
                    admissionFees: client.admissionFees ? parseFloat(client.admissionFees.toString()) : null,
                },
                `Client ${isNew ? 'is' : 'is not'} a new client`
            );
        } catch (error) {
            console.error('[is-new] Error checking client status:', error);
            return errorResponse('Failed to check client status', 500);
        }
    })(request);
}
