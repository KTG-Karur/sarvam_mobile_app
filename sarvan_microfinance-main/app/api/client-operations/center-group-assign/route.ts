import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import {
    validateGroupCapacity,
    nextClientSequenceForPrefix,
    GROUP_CAPACITY_FULL_MESSAGE,
    GROUP_NOT_AVAILABLE_MESSAGE,
} from '@/app/lib/services/group-assignment.service';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getMaxMembersPerGroup } from '@/app/lib/group-assignment-config';

/**
 * Schema for assigning a center to freshly enrolled clients (no centerId yet).
 * The caller must pick an existing group with spare capacity — this route
 * never creates a group.
 */
const centerGroupAssignSchema = z.object({
    assignments: z.array(
        z.object({
            clientDbId: z.string().min(1, 'Client DB ID is required'),
            centerId: z.string().min(1, 'Center ID is required'),
            groupId: z.string().min(1, 'Group ID is required'),
        })
    ).min(1, 'At least one assignment is required'),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/client-operations/center-group-assign
 * Assign a Center AND an existing Group (both chosen by the caller) to newly
 * enrolled clients who have no center yet. Capacity (ACTIVE clients only) is
 * re-validated per assignment inside the transaction — this route never
 * creates a group; if no group has spare capacity, create one first from
 * Centers → Groups.
 *
 * Access: BRANCH_MANAGER (own branch only); ADMIN / ADMIN_NON_HO_BRANCH_SWITCH
 * (any permitted branch)
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const body = await req.json();

            const validationResult = centerGroupAssignSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const { assignments } = validationResult.data;

            // BM: own branch only. Admin / Sub-admin: permitted branches (null = unrestricted).
            let ownBranchId: string | null = null;
            let permitted: string[] | null = null;
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (!userRecord?.branchId) {
                    return errorResponse('User is not assigned to a branch', 403);
                }
                ownBranchId = userRecord.branchId;
            } else {
                permitted = await getPermittedBranchIds(user);
            }

            // Collect unique centerIds and verify they are within the permitted branches
            const centerIds = [...new Set(assignments.map((a) => a.centerId))];
            const centers = await prisma.center.findMany({
                where: { id: { in: centerIds } },
                select: { id: true, branchId: true, code: true, status: true },
            });

            const centerMap = new Map(centers.map((c) => [c.id, c]));

            for (const centerId of centerIds) {
                const c = centerMap.get(centerId);
                if (!c) return errorResponse(`Center ${centerId} not found`, 404);
                if (ownBranchId !== null) {
                    if (c.branchId !== ownBranchId)
                        return errorResponse(`Center ${centerId} does not belong to your branch`, 403);
                } else if (permitted !== null && !permitted.includes(c.branchId)) {
                    return errorResponse(`Access denied to the branch of center ${centerId}`, 403);
                }
                if (c.status !== 'APPROVED')
                    return errorResponse(`Center ${centerId} is not approved`, 400);
            }

            // Verify all clients exist and currently have no center (unassigned)
            const clientDbIds = assignments.map((a) => a.clientDbId);
            const clients = await prisma.client.findMany({
                where: { id: { in: clientDbIds } },
                select: { id: true, clientId: true, centerId: true },
            });

            if (clients.length !== clientDbIds.length) {
                return errorResponse('One or more clients not found', 404);
            }

            const alreadyAssigned = clients.filter((c) => c.centerId !== null);
            if (alreadyAssigned.length > 0) {
                return errorResponse(
                    `Client(s) already have a center assigned: ${alreadyAssigned.map((c) => c.clientId).join(', ')}. Use the Group Reassign page instead.`,
                    400
                );
            }

            // Verify all submitted groups exist and belong to their assignment's center
            const groupIds = [...new Set(assignments.map((a) => a.groupId))];
            const groupRecords = await prisma.group.findMany({
                where: { id: { in: groupIds } },
                select: { id: true, name: true, code: true, centerId: true },
            });
            const groupMap = new Map(groupRecords.map((g) => [g.id, g]));

            for (const assignment of assignments) {
                const g = groupMap.get(assignment.groupId);
                if (!g || g.centerId !== assignment.centerId) {
                    return errorResponse(
                        `Group ${assignment.groupId} does not belong to center ${assignment.centerId}`,
                        400
                    );
                }
            }

            const maxMembers = await getMaxMembersPerGroup();

            // Perform the assignment inside a transaction
            const result = await prisma.$transaction(
                async (tx) => {
                    const updates = [];

                    for (const assignment of assignments) {
                        const { clientDbId, centerId, groupId } = assignment;
                        const group = groupMap.get(groupId)!;

                        // Re-validate capacity per assignment (ACTIVE clients only) —
                        // GroupMember rows written earlier in this batch are visible
                        // to the recount, so batches fill/reject correctly.
                        await validateGroupCapacity(tx, { groupId, centerId, maxMembers });

                        // Re-generate clientId: {branchCode}-{centerCode}-{groupCode}-{seq}
                        const center = centerMap.get(centerId)!;
                        const branchRecord = await tx.branch.findUnique({
                            where: { id: center.branchId },
                            select: { code: true },
                        });

                        const branchCode = branchRecord?.code ?? '0';
                        const centerCode = center.code ?? '0';
                        const groupCode = group.code ?? '0';

                        const seq = await nextClientSequenceForPrefix(tx, `${branchCode}-${centerCode}-${groupCode}`);
                        const newClientId = `${branchCode}-${centerCode}-${groupCode}-${seq}`;

                        // Update client: set centerId, groupId and new center-based clientId
                        const updatedClient = await tx.client.update({
                            where: { id: clientDbId },
                            data: {
                                centerId,
                                groupId: group.id,
                                clientId: newClientId,
                            },
                            select: {
                                id: true,
                                clientId: true,
                                firstName: true,
                                lastName: true,
                                centerId: true,
                                groupId: true,
                            },
                        });

                        // Remove any stale group memberships, then record the new one
                        await tx.groupMember.deleteMany({ where: { clientId: clientDbId } });
                        await tx.groupMember.create({
                            data: {
                                groupId: group.id,
                                clientId: clientDbId,
                                joinedAt: new Date(),
                            },
                        });

                        updates.push({
                            ...updatedClient,
                            assignedGroup: {
                                id: group.id,
                                name: group.name,
                            },
                        });
                    }

                    return updates;
                },
                // Batches run several queries per client and may wait on the
                // per-center advisory lock — Prisma's 5s default is too tight.
                { timeout: 30000, maxWait: 10000 }
            );

            const groupSummary = [
                ...new Map(result.map((r) => [r.assignedGroup.id, r.assignedGroup.name])).values(),
            ].join(', ');

            return successResponse(
                { updatedCount: result.length, clients: result },
                `Successfully assigned ${result.length} client(s). Groups used: ${groupSummary}`
            );
        } catch (error) {
            console.error('Error in center-group-assign:', error);
            if (error instanceof Error) {
                if ('code' in error) {
                    if ((error as any).code === 'P2025')
                        return errorResponse('One or more clients or groups not found', 404);
                    if ((error as any).code === 'P2002')
                        return errorResponse(
                            'Client ID conflict — please try again (sequential ID collision)',
                            409
                        );
                }
                // validateGroupCapacity throws a plain Error with a known
                // user-facing message (capacity-full or group-unavailable) —
                // surface those verbatim as 409; anything else is a real 500.
                if (error.message === GROUP_CAPACITY_FULL_MESSAGE || error.message === GROUP_NOT_AVAILABLE_MESSAGE) {
                    return errorResponse(error.message, 409);
                }
                return errorResponse(`Assignment failed: ${error.message}`, 500);
            }
            return errorResponse('Assignment failed: unknown error', 500);
        }
    })(request);
}
