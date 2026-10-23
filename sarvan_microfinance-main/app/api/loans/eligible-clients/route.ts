// app/api/loans/eligible-clients/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loans/eligible-clients?centerId={centerId}
 * Get clients eligible for a RENEWAL loan: fully APPROVED (client.approvalStatus
 * — the dynamic, config-driven workflow's terminal status; NOT the legacy
 * client.verificationStatus field, which isn't reliably synced for clients
 * approved before that sync was added — see incident: approved clients showing
 * zero renewal-eligible members), have at least one prior loan (renewal only —
 * brand-new members with no loan history don't qualify here), and have no
 * active loan still pending indexation.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const centerId = searchParams.get('centerId');
            // Optional: restrict to members of one group (Center -> Group -> Member
            // cascade used by the Member Enrollment page's Renewal Loan mode).
            const groupId = searchParams.get('groupId');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            // Get all fully-approved clients in the center
            const clients = await prisma.client.findMany({
                where: {
                    centerId: centerId,
                    approvalStatus: 'APPROVED',
                    isActive: true,
                },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    verificationStatus: true,
                    isDefaultMember: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            if (clients.length === 0) {
                return successResponse([], 'No clients found in this center');
            }

            // Get all loans (any status) for these clients in one query — used both to
            // confirm renewal eligibility (has prior loan history) and to block clients
            // with a loan still awaiting indexation.
            const clientIds = clients.map(c => c.id);
            const allLoans = await prisma.loan.findMany({
                where: { clientId: { in: clientIds } },
                select: {
                    id: true,
                    clientId: true,
                    disbursementStatus: true,
                    indexId: true,
                    isActive: true,
                },
            });

            // Clients with at least one prior loan — required for renewal eligibility
            const clientsWithLoanHistory = new Set(allLoans.map(loan => loan.clientId));

            // Create a set of clients who have unindexed loans (PENDING or APPROVED without index)
            const clientsWithUnindexedLoans = new Set<string>();
            allLoans.forEach(loan => {
                if (loan.isActive && !loan.indexId &&
                    (loan.disbursementStatus === 'PENDING_LEVEL1' || loan.disbursementStatus === 'APPROVED_LEVEL1')) {
                    clientsWithUnindexedLoans.add(loan.clientId);
                }
            });

            // Renewal only: must have prior loan history, and no loan currently awaiting
            // indexation. Clients with a DISBURSED loan are kept — they'll be warned via
            // the ongoing-loan modal when selected.
            const eligibleClients = clients.filter(client =>
                clientsWithLoanHistory.has(client.id) && !clientsWithUnindexedLoans.has(client.id)
            );

            // Check which clients have a group membership (required before loan application)
            const groupMemberships = await prisma.groupMember.findMany({
                where: { clientId: { in: eligibleClients.map(c => c.id) } },
                select: { clientId: true, groupId: true, group: { select: { id: true, name: true, code: true } } },
            });
            const clientsWithGroup = new Set(groupMemberships.map(m => m.clientId));
            const clientGroupMap = new Map(groupMemberships.map(m => [m.clientId, m.group]));

            // Format client names
            let formattedClients = eligibleClients.map(client => ({
                id: client.id,
                clientId: client.clientId,
                name: client.firstName && client.lastName
                    ? `${client.firstName} ${client.lastName}`
                    : client.clientId,
                verificationStatus: client.verificationStatus,
                hasGroup: clientsWithGroup.has(client.id),
                isDefaultMember: client.isDefaultMember,
                groupId: clientGroupMap.get(client.id)?.id ?? null,
                groupName: clientGroupMap.get(client.id)?.name ?? null,
                groupCode: clientGroupMap.get(client.id)?.code ?? null,
            }));

            if (groupId) {
                formattedClients = formattedClients.filter(c => c.groupId === groupId);
            }

            return successResponse(formattedClients, 'Eligible clients fetched successfully');
        } catch (error) {
            console.error('Error fetching eligible clients:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch eligible clients',
                500
            );
        }
    })(request);
}