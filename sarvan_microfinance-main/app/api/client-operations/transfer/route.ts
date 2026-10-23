import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import type { JWTPayload } from '@/app/lib/auth';
import {
    validateGroupCapacity,
    listCandidateGroupsWithActiveCounts,
    pickGroupWithCapacity,
    GROUP_CAPACITY_FULL_MESSAGE,
    GROUP_NOT_AVAILABLE_MESSAGE,
} from '@/app/lib/services/group-assignment.service';
import { getMaxMembersPerGroup } from '@/app/lib/group-assignment-config';

/**
 * Roles allowed to use the Client Transfer page. `withRole` always lets ADMIN
 * through regardless of this list (see evaluateApiRoleAccess).
 */
const TRANSFER_ROLES = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'];

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Branches the caller may act on (null = unrestricted). The primary branch is
 * re-read from the DB (not the JWT) so a branch reassignment applies immediately.
 * ADMIN is unrestricted, as in /api/clients.
 */
async function resolvePermittedBranchIds(user: JWTPayload): Promise<string[] | null> {
    if (user.role === 'ADMIN') return null;
    const userRecord = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { branchId: true },
    });
    return getPermittedBranchIds({
        userId: user.userId,
        role: user.role,
        branchId: userRecord?.branchId ?? user.branchId,
        assignedBranchIds: user.assignedBranchIds,
    });
}

/**
 * GET /api/client-operations/transfer?branchId=<id>
 * Approved centers of ANY branch, used to populate the destination "New Center"
 * dropdown. /api/centers can't serve this: it pins a BM to their own branch and
 * an AM to their assigned branches, so another branch's centers never come back.
 * Only id/name/code are exposed.
 *
 * GET /api/client-operations/transfer?centerId=<id>
 * The destination center's active groups (fill order) with ACTIVE-member counts
 * and the per-group capacity, for the optional "Group" dropdown.
 */
export async function GET(request: NextRequest) {
    return withRole(TRANSFER_ROLES, async (req, user) => {
        try {
            const params = new URL(req.url).searchParams;
            const centerId = params.get('centerId');

            // A Branch Manager can only transfer inside their own branch, so they
            // only get destination centers/groups from the branches they act on.
            const bmBranchIds =
                user.role === 'BRANCH_MANAGER' ? await resolvePermittedBranchIds(user) : null;

            if (centerId) {
                if (bmBranchIds) {
                    const center = await prisma.center.findUnique({
                        where: { id: centerId },
                        select: { branchId: true },
                    });
                    if (!center || !bmBranchIds.includes(center.branchId)) {
                        return errorResponse('Center is not in your branch', 403);
                    }
                }
                const maxMembers = await getMaxMembersPerGroup();
                const groups = await prisma.$transaction((tx) =>
                    listCandidateGroupsWithActiveCounts(tx, centerId)
                );
                return successResponse(
                    groups.map((g) => ({
                        id: g.id,
                        name: g.name,
                        code: g.code,
                        memberCount: g.memberCount,
                        maxMembers,
                        isFull: g.memberCount >= maxMembers,
                    })),
                    'Groups fetched successfully'
                );
            }

            const branchId = params.get('branchId');
            if (!branchId) {
                return errorResponse('branchId or centerId is required', 400);
            }
            if (bmBranchIds && !bmBranchIds.includes(branchId)) {
                return errorResponse('Branch Managers can only transfer within their own branch', 403);
            }

            const centers = await prisma.center.findMany({
                where: { branchId, status: 'APPROVED', isActive: true },
                select: { id: true, name: true, code: true, branchId: true, status: true },
                orderBy: { name: 'asc' },
            });

            return successResponse(centers, 'Centers fetched successfully');
        } catch (error) {
            console.error('Error fetching transfer target centers:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch centers',
                500
            );
        }
    })(request);
}

/**
 * Client Transfer Request Schema.
 * `newClientId` is still accepted for backward compatibility but is IGNORED
 * (the client's ID never changes on transfer). `groupId` is optional: if supplied, that exact
 * group is used (validated for capacity); if omitted, the first existing
 * group in the new center with spare capacity is picked — this endpoint
 * never creates a group.
 */
const clientTransferSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    oldCenterId: z.string().min(1, 'Old center ID is required'),
    newCenterId: z.string().min(1, 'New center ID is required'),
    newClientId: z.string().optional(),
    groupId: z.string().optional(),
});

/**
 * POST /api/client-operations/transfer
 * Transfer a client from one center to another
 *
 * This endpoint:
 * - Assigns the client to an existing group in the new center — either the
 *   caller-supplied `groupId` (capacity-validated) or, if omitted, the first
 *   existing group with spare capacity (ACTIVE clients only). Never creates
 *   a group; if none has capacity, the transfer is rejected.
 * - Updates client's centerId and groupId. The client's ID (clientId) is NOT
 *   changed — it stays the same across transfers, including cross-branch ones.
 * - Keeps all personal enrollment details intact
 * - Moves the client's still-unindexed loans (indexId null — i.e. not yet part
 *   of any LoanIndex/center meeting cycle) to the new centerId, so they surface
 *   under the new center in Loan Index. Already-indexed loans are left alone —
 *   they're already tied to an old-center LoanIndex/schedule and must not be
 *   pulled out from under it.
 * - The new center may be in a DIFFERENT branch. Then the moved loans get the
 *   new branchId too, and the transfer is rejected if the client still has an
 *   active indexed/disbursed loan — its schedule, collections and GL postings
 *   belong to the old branch and are not migrated by this endpoint.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN (+ ADMIN_NON_HO_BRANCH_SWITCH).
 * The client must be in a branch the caller may act on; ADMIN is unrestricted.
 * The destination center can be in any branch, EXCEPT for a BRANCH_MANAGER,
 * who can only transfer within the client's own branch.
 */
export async function POST(request: NextRequest) {
    return withRole(TRANSFER_ROLES, async (req, user) => {
        try {
            // Parse and validate request body
            const body = await req.json();
            const validatedData = clientTransferSchema.parse(body);

            // Branches the caller may transfer FROM (null = unrestricted)
            const permittedBranchIds = await resolvePermittedBranchIds(user);

            if (permittedBranchIds !== null && permittedBranchIds.length === 0) {
                return errorResponse('User branch not found', 400);
            }

            // Find the client by database ID (not clientId)
            const client = await prisma.client.findUnique({
                where: { id: validatedData.clientId },
                select: {
                    id: true,
                    clientId: true,
                    centerId: true,
                    groupId: true,
                    firstName: true,
                    lastName: true,
                    center: {
                        select: {
                            id: true,
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { branchId: true } },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Verify old center matches
            if (client.centerId !== validatedData.oldCenterId) {
                return errorResponse(
                    'Old center ID does not match client\'s current center',
                    400
                );
            }

            // Verify the client is in a branch the caller may transfer from
            const oldBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
            if (
                permittedBranchIds !== null &&
                (!oldBranchId || !permittedBranchIds.includes(oldBranchId))
            ) {
                return errorResponse(
                    'Unauthorized: Client is not in your branch',
                    403
                );
            }

            // Verify new center exists and is approved
            const newCenter = await prisma.center.findUnique({
                where: { id: validatedData.newCenterId },
                select: {
                    id: true,
                    status: true,
                    branchId: true,
                    code: true,
                },
            });

            if (!newCenter) {
                return errorResponse('New center not found', 404);
            }

            if (newCenter.status !== 'APPROVED') {
                return errorResponse(
                    'New center must be approved before transferring clients',
                    400
                );
            }

            // A Branch Manager may only transfer within the client's own branch;
            // moving to another branch is for Admin / Area Manager.
            if (user.role === 'BRANCH_MANAGER' && newCenter.branchId !== oldBranchId) {
                return errorResponse(
                    'Branch Managers can only transfer clients to a center within their own branch',
                    403
                );
            }

            // Cross-branch: a client with a live (indexed or disbursed) loan can't
            // move — that loan's schedule, collections and GL stay with the old
            // branch, which would leave the client and their loan in different
            // branches. Only clients with no such loan (e.g. enrolled/pending,
            // or all loans closed) can change branch.
            const isCrossBranch = !!oldBranchId && oldBranchId !== newCenter.branchId;
            if (isCrossBranch) {
                const liveLoanCount = await prisma.loan.count({
                    where: {
                        clientId: client.id,
                        isActive: true,
                        OR: [{ indexId: { not: null } }, { disbursementStatus: 'DISBURSED' }],
                    },
                });
                if (liveLoanCount > 0) {
                    return errorResponse(
                        'Cannot transfer to another branch: this client has an active loan (indexed or disbursed). Close the loan first, or transfer within the same branch.',
                        409
                    );
                }
            }

            const maxMembers = await getMaxMembersPerGroup();

            // Perform transfer in a transaction
            const result = await prisma.$transaction(
                async (tx) => {
                    // Resolve the target group: use the caller-supplied groupId
                    // (validated for capacity) or fall back to the first existing
                    // group in the new center with spare capacity. Never creates
                    // a group — reject if none has room.
                    let group: { id: string; name: string; code: string | null };
                    if (validatedData.groupId) {
                        await validateGroupCapacity(tx, {
                            groupId: validatedData.groupId,
                            centerId: validatedData.newCenterId,
                            maxMembers,
                        });
                        const explicit = await tx.group.findUniqueOrThrow({
                            where: { id: validatedData.groupId },
                            select: { id: true, name: true, code: true },
                        });
                        group = explicit;
                    } else {
                        // Same lock key as validateGroupCapacity/createNextGroupForCenter,
                        // so the fallback pick serializes against concurrent writers too.
                        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('auto-group-assign'), hashtext(${validatedData.newCenterId}))`;
                        const candidates = await listCandidateGroupsWithActiveCounts(tx, validatedData.newCenterId);
                        const picked = pickGroupWithCapacity(candidates, maxMembers);
                        if (!picked) {
                            throw new Error(
                                'No group with available capacity in the new center. Please create a new Group from Centers → Groups first.'
                            );
                        }
                        group = picked;
                    }

                    // Update client: change centerId and groupId only. The client's ID
                    // (Client.clientId) is deliberately left untouched — it stays the
                    // same for the client's whole life, across center/branch transfers.
                    // All other personal details remain unchanged
                    const updatedClient = await tx.client.update({
                        where: { id: client.id },
                        data: {
                            centerId: validatedData.newCenterId,
                            groupId: group.id,
                            updatedAt: new Date(),
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

                    // Move group membership to the auto-assigned group
                    await tx.groupMember.deleteMany({
                        where: { clientId: client.id },
                    });
                    await tx.groupMember.create({
                        data: {
                            groupId: group.id,
                            clientId: client.id,
                        },
                    });

                    // Carry the client's still-unindexed loans to the new center so
                    // they don't get stranded under the old center in Loan Index.
                    // indexId null means the loan hasn't been locked into a
                    // LoanIndex/meeting cycle yet — anything already indexed keeps
                    // its original centerId untouched.
                    const movedLoans = await tx.loan.updateMany({
                        where: {
                            clientId: client.id,
                            isActive: true,
                            indexId: null,
                        },
                        data: {
                            centerId: validatedData.newCenterId,
                            // Loan carries its own branchId — keep it in step with the
                            // center (a no-op for same-branch transfers).
                            branchId: newCenter.branchId,
                        },
                    });

                    // Log the transfer
                    await tx.clientTransfer.create({
                        data: {
                            clientId: client.id,
                            oldCenterId: validatedData.oldCenterId,
                            newCenterId: validatedData.newCenterId,
                            // ID no longer changes on transfer; both columns kept for the
                            // transfer report and existing history rows.
                            oldClientId: client.clientId,
                            newClientId: client.clientId,
                            oldGroupId: client.groupId,
                            newGroupId: group.id,
                            transferredById: user.userId,
                            remarks: body.remarks || 'Client transfer',
                        },
                    });

                    return { updatedClient, group, movedLoanCount: movedLoans.count };
                },
                // Several queries plus a possible wait on the per-center
                // advisory lock — Prisma's 5s default is too tight.
                { timeout: 30000, maxWait: 10000 }
            );

            return successResponse(
                {
                    clientId: result.updatedClient.clientId,
                    oldClientId: client.clientId,
                    newClientId: result.updatedClient.clientId,
                    centerId: result.updatedClient.centerId,
                    groupId: result.updatedClient.groupId,
                    assignedGroup: {
                        id: result.group.id,
                        name: result.group.name,
                    },
                    clientName: `${result.updatedClient.firstName} ${result.updatedClient.lastName}`,
                    movedLoanCount: result.movedLoanCount,
                },
                result.movedLoanCount > 0
                    ? `Client transferred successfully — assigned to ${result.group.name} (${result.movedLoanCount} pending loan(s) moved to the new center)`
                    : `Client transferred successfully — assigned to ${result.group.name}`
            );
        } catch (error) {
            // Handle validation errors
            if (error instanceof z.ZodError) {
                console.error('Validation error:', error.errors);
                return errorResponse(
                    `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                    400
                );
            }

            // Handle Prisma unique constraint violation (duplicate clientId)
            if (
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'P2002'
            ) {
                return errorResponse(
                    'Client ID conflict — please try again (sequential ID collision)',
                    409
                );
            }

            // Handle Prisma not found errors
            if (
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'P2025'
            ) {
                return errorResponse('Client or center not found', 404);
            }

            console.error('Error transferring client:', error);

            // Group-capacity/availability errors (from validateGroupCapacity or
            // the no-group-with-capacity fallback) are a 409, not a 500.
            if (
                error instanceof Error &&
                (error.message === GROUP_CAPACITY_FULL_MESSAGE ||
                    error.message === GROUP_NOT_AVAILABLE_MESSAGE ||
                    error.message.startsWith('No group with available capacity'))
            ) {
                return errorResponse(error.message, 409);
            }

            return errorResponse(
                error instanceof Error
                    ? error.message
                    : 'Failed to transfer client',
                500
            );
        }
    })(request);
}
