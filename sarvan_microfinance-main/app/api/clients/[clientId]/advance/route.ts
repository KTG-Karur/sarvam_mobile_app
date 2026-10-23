import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/clients/[clientId]/advance
 * Fetch advance summary for a specific client
 * 
 * Advance summary includes:
 * - Opening Balance
 * - Total Collected
 * - Total Adjusted
 * - Closing Balance
 * 
 * @access All authenticated users with role-based access
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

            // Find client by clientId (not database id) — findFirst, not findUnique:
            // Client.clientId isn't DB-unique (uploan-imported legacy IDs can
            // intentionally collide, see schema.prisma) — deterministic oldest-created
            // tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    centerId: true,
                    center: {
                        select: {
                            branchId: true,
                            nextMeetingDate: true,
                        },
                    },
                    enrolledBy: { select: { branchId: true } },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || (client.center?.branchId ?? client.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const assignedCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];

                const uniqueCenterIds = [...new Set(assignedCenterIds)];

                // Check if client's center is assigned OR if it's an APPROVED center in FDO's branch
                let hasAccess = uniqueCenterIds.includes(client.centerId ?? "");

                if (!hasAccess && userRecord?.branchId && client.center?.branchId === userRecord.branchId) {
                    // Check if it's an APPROVED center in FDO's branch
                    const approvedCenter = await prisma.center.findFirst({
                        where: {
                            id: client.centerId ?? undefined,
                            branchId: userRecord.branchId,
                            status: 'APPROVED',
                        },
                        select: { id: true },
                    });
                    hasAccess = !!approvedCenter;
                }

                // Grant access when client has no center but was enrolled by someone in FDO's branch
                if (!hasAccess && userRecord?.branchId && client.enrolledBy?.branchId === userRecord.branchId) {
                    hasAccess = true;
                }

                if (!hasAccess) {
                    return errorResponse('Insufficient permissions: Client is not in your assigned centers', 403);
                }
            }

            // Get active loans for the client to calculate advance amounts
            const loans = await prisma.loan.findMany({
                where: {
                    clientId: client.id,
                    isActive: true,
                    disbursementStatus: {
                        in: ['APPROVED_LEVEL1', 'DISBURSED'],
                    },
                },
                select: {
                    id: true,
                    amount: true,
                    disbursedLevel1At: true,
                },
            });

            // Calculate advance summary
            // Opening Balance: Sum of all disbursed loan amounts
            const openingBalance = loans.reduce((sum, loan) => {
                return sum + Number(loan.amount);
            }, 0);

            // TODO: When collection/transaction models are added, calculate:
            // - Total Collected: Sum of all collection transactions
            // - Total Adjusted: Sum of all adjustment transactions
            // - Closing Balance: Opening Balance + Total Collected - Total Adjusted

            // For now, return calculated values with placeholders
            const totalCollected = 0; // TODO: Calculate from collections
            const totalAdjusted = 0; // TODO: Calculate from adjustments
            const closingBalance = openingBalance + totalCollected - totalAdjusted;

            // Format date helper
            const formatDate = (date: Date | null | undefined) => {
                if (!date) return '';
                const d = typeof date === 'string' ? new Date(date) : date;
                if (isNaN(d.getTime())) return '';
                const day = d.getDate().toString().padStart(2, '0');
                const month = (d.getMonth() + 1).toString().padStart(2, '0');
                const year = d.getFullYear();
                return `${day}/${month}/${year}`;
            };

            // Build advance rows
            const advanceRows = [
                {
                    id: 'opening-balance',
                    meetingSerial: '0',
                    meetingDate: '',
                    description: 'Opening Balance',
                    amount: openingBalance,
                },
                {
                    id: 'total-collected',
                    meetingSerial: '0',
                    meetingDate: '',
                    description: 'Total Collected',
                    amount: totalCollected,
                },
                {
                    id: 'total-adjusted',
                    meetingSerial: '0',
                    meetingDate: '',
                    description: 'Total Adjusted',
                    amount: totalAdjusted,
                },
                {
                    id: 'closing-balance',
                    meetingSerial: '0',
                    meetingDate: formatDate(client.center?.nextMeetingDate) || formatDate(new Date()),
                    description: 'Closing Balance',
                    amount: closingBalance,
                },
            ];

            return successResponse(
                {
                    clientId: client.clientId,
                    advanceRows,
                },
                'Advance summary fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching advance summary:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch advance summary',
                500
            );
        }
    })(request);
}
