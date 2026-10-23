import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus } from '@prisma/client';
import {
    getActiveWorkflowConfig,
    getQueueStatusesForRole,
    getUserWorkflowRoleSlugs,
    userHoldsStage,
} from '@/app/lib/workflow-config';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { applyOrgScope } from '@/app/lib/permissions/org-scope';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/approval/queue
 * Returns the Center → Group → Client hierarchy for the approval workbench.
 *
 * Query params:
 *   centerId  – (optional) drill into a specific center
 *   groupId   – (optional) drill into a specific group
 *   status    – (optional) filter by approval status; defaults to role-appropriate queue
 *
 * Dynamic workflow active: each user sees the pending + retake statuses of every
 * configured stage whose role they hold (ANY role), plus SUBMITTED if they hold
 * the first stage. Admin / Sub Admin see the final review stage.
 *
 * Legacy (no workflow configured):
 * BM      sees: SUBMITTED, PENDING_BM_REVIEW, BM_RETAKE_REQUIRED
 * AM      sees: PENDING_AM_REVIEW, AM_RETAKE_REQUIRED
 * QC Team sees: PENDING_QC_VERIFICATION, QC_VERIFICATION_RETAKE_REQUIRED
 * ADMIN   sees: PENDING_FINAL_REVIEW, FINAL_RETAKE_REQUIRED
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, FDO (background-verification-team only),
 *         Sub Admin roles (see Role.isSubAdmin — final review queue, plus any workflow
 *         stage their role is configured for)
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const groupId = searchParams.get('groupId');
            const statusFilter = searchParams.get('status');
            const search = searchParams.get('search');
            const page = parseInt(searchParams.get('page') || '1');
            const limit = parseInt(searchParams.get('limit') || '10');
            const skip = (page - 1) * limit;
            const allBranch = searchParams.get('allBranch') === 'true';

            // QC role is always treated as Quality Checkers team.
            // FDO with quality-checkers RBAC assignment is also treated as QC team.
            const isQCTeam = user.role === 'QC' || (user.role === 'FDO'
                ? !!(await prisma.userRoleAssignment.findFirst({
                    where: {
                        userId: user.userId,
                        isActive: true,
                        role: { slug: 'quality-checkers', isActive: true },
                    },
                }))
                : false);

            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);

            // Dynamic workflow: the configured stages this user holds (any role,
            // including admin-created ones with a custom user.role code).
            const wfConfig = await getActiveWorkflowConfig();
            const userSlugs = await getUserWorkflowRoleSlugs(user);
            const myStages = wfConfig ? wfConfig.stages.filter(s => userHoldsStage(s, userSlugs)) : [];

            // Base access gate (mirrors the previous withRole([...]) allowlist),
            // extended to let Sub Admin roles and any configured stage role in.
            const baseAllowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'FDO', 'QC'];
            if (!baseAllowedRoles.includes(user.role) && !isQCTeam && !isSubAdmin && myStages.length === 0) {
                return errorResponse('Insufficient permissions', 403);
            }

            // Regular FDO (not Quality Checkers, no stage role) cannot access the approval queue
            if (user.role === 'FDO' && !isQCTeam && myStages.length === 0) {
                return errorResponse('Access denied — only approval-stage members can access this queue', 403);
            }

            // Determine which approval statuses to show based on role
            let approvalStatuses: ClientApprovalStatus[];
            if (statusFilter && statusFilter !== 'all') {
                approvalStatuses = statusFilter.split(',') as ClientApprovalStatus[];
            } else if (statusFilter === 'all') {
                approvalStatuses = Object.values(ClientApprovalStatus) as unknown as ClientApprovalStatus[];
            } else if (isSubAdmin || (wfConfig && user.role !== 'ADMIN')) {
                // Dynamic workflow — role-agnostic: every stage this user holds.
                // A Sub Admin (Role.isSubAdmin) also gets the Final Review stage; a role
                // can be both (e.g. CEO configured as Level 4 AND flagged Sub Admin).
                const statuses = new Set<ClientApprovalStatus>();
                for (const stage of myStages) {
                    for (const st of getQueueStatusesForRole(stage.roleSlug, [stage])) statuses.add(st);
                    if (stage.levelOrder === wfConfig!.stages[0]?.levelOrder) statuses.add('SUBMITTED' as ClientApprovalStatus);
                }
                if (isSubAdmin) {
                    statuses.add('PENDING_FINAL_REVIEW' as ClientApprovalStatus);
                    statuses.add('FINAL_RETAKE_REQUIRED' as ClientApprovalStatus);
                }
                approvalStatuses = [...statuses];
            } else if (isQCTeam) {
                // QC sees ONLY clients awaiting their review (PENDING_QC_VERIFICATION).
                // QC_VERIFICATION_RETAKE_REQUIRED is intentionally excluded:
                // once QC requests a retake, the client moves to FDO's "Recheck" tab
                // and returns to this queue as PENDING_QC_VERIFICATION after FDO
                // re-uploads and resubmits — matching the same pattern as BM/AM retake.
                approvalStatuses = ['PENDING_QC_VERIFICATION'] as ClientApprovalStatus[];
            } else if (user.role === 'BRANCH_MANAGER') {
                approvalStatuses = ['SUBMITTED', 'PENDING_BM_REVIEW', 'BM_RETAKE_REQUIRED'];
            } else if (user.role === 'AREA_MANAGER') {
                approvalStatuses = ['PENDING_AM_REVIEW', 'AM_RETAKE_REQUIRED'];
            } else {
                // ADMIN — final review stage
                approvalStatuses = ['PENDING_FINAL_REVIEW', 'FINAL_RETAKE_REQUIRED'] as ClientApprovalStatus[];
            }

            // Branch-scoping: every role only sees clients in their own / assigned
            // branch(es), via the same canonical resolver used across the rest of
            // the app (app/lib/permissions/branch-scope.ts):
            //  - AREA_MANAGER: ALL branches assigned via AreaManagerBranch (Manage
            //    Branch) — an AM managing multiple branches sees pending approvals
            //    from every one of them at once, not just whichever branch happens
            //    to be "active" in their session.
            //  - Any other role (BRANCH_MANAGER, FDO, QC, custom RBAC roles): ALL
            //    branches assigned via UserBranchAssignment, falling back to just
            //    their primary branch for the common single-branch case.
            //  - A user whose own/active branch IS Head Office (e.g. a
            //    QC/background-verification team member stationed at HO) is
            //    unrestricted (org-wide) — HO itself has no centers/clients.
            //
            // BRANCH_MANAGER is re-read fresh from the DB first so a branch
            // transfer takes effect immediately instead of waiting for their token
            // to refresh (mirrors the fresh-read pattern in app/api/clients/route.ts).
            let effectiveUser = user;
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (!userRecord?.branchId) {
                    return errorResponse('User is not assigned to a branch', 403);
                }
                effectiveUser = { ...user, branchId: userRecord.branchId };
            }

            // null = unrestricted (HO-based user); array = permitted branch(es).
            // Narrowed by the user's Region/Division/Area/Branch org scope (e.g. a
            // Quality Checker assigned to one Division sees only that Division's members).
            const branchFilter = await applyOrgScope(user.userId, await resolveScopedBranchIds(effectiveUser));

            // ── ALL BRANCH: flat list without center/group cascade ──
            if (allBranch) {
                const branchClientWhere: any = {
                    isActive: true,
                    approvalStatus: { in: approvalStatuses },
                    // Only show clients with at least 1 KYC document uploaded
                    kycDocuments: { some: { isDeleted: false } },
                    AND: [],
                };

                if (branchFilter) {
                    // Include center-assigned clients AND unassigned clients whose
                    // requested center (Loan Details tab selection) is in this branch —
                    // not the enroller's own branch, which may differ.
                    branchClientWhere.AND.push({
                        OR: [
                            { center: { branchId: { in: branchFilter } } },
                            { centerId: null, requestedCenter: { branchId: { in: branchFilter } } },
                        ],
                    });
                }

                // Branch dropdown options — every branch (within the caller's scope)
                // that currently has members in this queue, with a pending count.
                // Computed before the branch/search filters so the list stays stable.
                const scopeClients = await prisma.client.findMany({
                    where: { ...branchClientWhere, AND: [...branchClientWhere.AND] },
                    select: {
                        center: { select: { branch: { select: { id: true, name: true, code: true } } } },
                        requestedCenter: { select: { branch: { select: { id: true, name: true, code: true } } } },
                    },
                });
                const branchCounts = new Map<string, { id: string; name: string; code: string; count: number }>();
                for (const c of scopeClients) {
                    const b = c.center?.branch ?? c.requestedCenter?.branch;
                    if (!b) continue;
                    const entry = branchCounts.get(b.id) ?? { id: b.id, name: b.name, code: b.code, count: 0 };
                    entry.count += 1;
                    branchCounts.set(b.id, entry);
                }
                const branches = [...branchCounts.values()].sort((a, b) => a.name.localeCompare(b.name));

                const selectedBranchId = searchParams.get('branchId');
                if (selectedBranchId) {
                    if (branchFilter && !branchFilter.includes(selectedBranchId)) {
                        return errorResponse('You do not have access to this branch', 403);
                    }
                    branchClientWhere.AND.push({
                        OR: [
                            { center: { branchId: selectedBranchId } },
                            { centerId: null, requestedCenter: { branchId: selectedBranchId } },
                        ],
                    });
                }

                if (search) {
                    branchClientWhere.AND.push({
                        OR: [
                            { firstName: { contains: search, mode: 'insensitive' } },
                            { lastName: { contains: search, mode: 'insensitive' } },
                            { clientId: { contains: search, mode: 'insensitive' } },
                            ...memberIdSearchConditions(search),
                        ],
                    });
                }

                if (branchClientWhere.AND.length === 0) {
                    delete branchClientWhere.AND;
                }

                const total = await prisma.client.count({ where: branchClientWhere });

                const allClients = await prisma.client.findMany({
                    where: branchClientWhere,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        mobileNumber: true,
                        approvalStatus: true,
                        verificationStatus: true,
                        createdAt: true,
                        enrolledBy:      { select: { firstName: true, lastName: true, employeeId: true } },
                        bmReviewedBy:    { select: { firstName: true, lastName: true, employeeId: true } },
                        amReviewedBy:    { select: { firstName: true, lastName: true, employeeId: true } },
                        qcVerifiedBy:    { select: { firstName: true, lastName: true, employeeId: true } },
                        finalReviewedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                        bmReviewedAt: true,
                        center: { select: { name: true, code: true } },
                        _count: {
                            select: { kycDocuments: { where: { isDeleted: false } } },
                        },
                    },
                    orderBy: [
                        { createdAt: 'asc' },
                        { id: 'asc' },
                    ],
                    skip,
                    take: limit,
                });

                const allData = allClients.map((c) => ({
                    id: c.id,
                    clientId: c.clientId,
                    name: `${c.firstName} ${c.lastName}`,
                    mobileNumber: c.mobileNumber,
                    approvalStatus: c.approvalStatus,
                    verificationStatus: c.verificationStatus,
                    enrolledBy:      c.enrolledBy      ? { name: `${c.enrolledBy.firstName} ${c.enrolledBy.lastName}`,           employeeId: c.enrolledBy.employeeId }      : null,
                    bmReviewedBy:    c.bmReviewedBy    ? { name: `${c.bmReviewedBy.firstName} ${c.bmReviewedBy.lastName}`,       employeeId: c.bmReviewedBy.employeeId }    : null,
                    amReviewedBy:    c.amReviewedBy    ? { name: `${c.amReviewedBy.firstName} ${c.amReviewedBy.lastName}`,       employeeId: c.amReviewedBy.employeeId }    : null,
                    qcVerifiedBy:    c.qcVerifiedBy    ? { name: `${c.qcVerifiedBy.firstName} ${c.qcVerifiedBy.lastName}`,       employeeId: c.qcVerifiedBy.employeeId }    : null,
                    finalReviewedBy: c.finalReviewedBy ? { name: `${c.finalReviewedBy.firstName} ${c.finalReviewedBy.lastName}`, employeeId: c.finalReviewedBy.employeeId } : null,
                    bmReviewedAt: c.bmReviewedAt,
                    kycDocCount: c._count.kycDocuments,
                    enrolledAt: c.createdAt,
                    centerName: c.center ? `${c.center.code} - ${c.center.name}` : null,
                }));

                return successResponse(
                    {
                        level: 'clients',
                        items: allData,
                        totalPending: total,
                        branches,
                        // Names of the stages this user reviews (for the page badge).
                        myStageNames: user.role === 'ADMIN'
                            ? ['Final Review']
                            : [...myStages.map(s => s.stageName), ...(isSubAdmin ? ['Final Review'] : [])],
                        pagination: {
                            total,
                            page,
                            limit,
                            totalPages: Math.ceil(total / limit),
                        },
                    },
                    'Approval queue clients fetched'
                );
            }

            // ── Level 1: Centers with counts ──
            if (!centerId) {
                const centers = await prisma.center.findMany({
                    where: {
                        status: 'APPROVED',
                        ...(branchFilter ? { branchId: { in: branchFilter } } : {}),
                    },
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        branchId: true,
                        branch: { select: { name: true } },
                        _count: {
                            select: {
                                clients: {
                                    where: {
                                        approvalStatus: { in: approvalStatuses },
                                        isActive: true,
                                        kycDocuments: { some: { isDeleted: false } },
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { name: 'asc' },
                });

                const data = centers
                    .filter((c) => c._count.clients > 0)
                    .map((c) => ({
                        id: c.id,
                        name: c.name,
                        code: c.code,
                        branchName: c.branch.name,
                        pendingCount: c._count.clients,
                    }));

                return successResponse(
                    { level: 'centers', items: data, totalPending: data.reduce((s, c) => s + c.pendingCount, 0) },
                    'Approval queue centers fetched'
                );
            }

            // A requested center must lie inside the caller's (approval-narrowed) scope.
            if (centerId && branchFilter) {
                const requestedCenter = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
                if (!requestedCenter || !branchFilter.includes(requestedCenter.branchId)) {
                    return errorResponse('You do not have access to this center', 403);
                }
            }

            // ── Level 2: Groups within a center with counts ──
            if (centerId && !groupId) {
                const groups = await prisma.group.findMany({
                    where: {
                        centerId,
                        isActive: true,
                    },
                    select: {
                        id: true,
                        name: true,
                        members: {
                            select: {
                                client: {
                                    select: {
                                        approvalStatus: true,
                                        isActive: true,
                                        _count: {
                                            select: { kycDocuments: { where: { isDeleted: false } } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { name: 'asc' },
                });

                // Also count clients in this center without a group (with at least 1 KYC doc)
                const ungroupedCount = await prisma.client.count({
                    where: {
                        centerId,
                        isActive: true,
                        approvalStatus: { in: approvalStatuses },
                        groupMemberships: { none: {} },
                        kycDocuments: { some: { isDeleted: false } },
                    },
                });

                const data = groups.map((g) => {
                    const pendingCount = g.members.filter(
                        (m) =>
                            m.client.isActive &&
                            approvalStatuses.includes(m.client.approvalStatus) &&
                            m.client._count.kycDocuments > 0
                    ).length;
                    return { id: g.id, name: g.name, pendingCount };
                }).filter((g) => g.pendingCount > 0);

                // Add ungrouped bucket if there are ungrouped pending clients
                if (ungroupedCount > 0) {
                    data.push({ id: '__ungrouped__', name: 'Ungrouped Clients', pendingCount: ungroupedCount });
                }

                // Get center name for breadcrumb
                const center = await prisma.center.findUnique({
                    where: { id: centerId },
                    select: { name: true, code: true },
                });

                return successResponse(
                    { level: 'groups', centerId, centerName: center?.name, centerCode: center?.code, items: data },
                    'Approval queue groups fetched'
                );
            }

            // ── Level 3: Clients within a group ──
            if (centerId && groupId) {
                let clientWhere: any;

                const searchFilter = search ? {
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                        { clientId: { contains: search, mode: 'insensitive' } },
                        ...memberIdSearchConditions(search),
                    ]
                } : {};

                if (groupId === '__ungrouped__') {
                    clientWhere = {
                        centerId,
                        isActive: true,
                        approvalStatus: { in: approvalStatuses },
                        groupMemberships: { none: {} },
                        kycDocuments: { some: { isDeleted: false } },
                        ...searchFilter
                    };
                } else {
                    const memberClientIds = await prisma.groupMember.findMany({
                        where: { groupId },
                        select: { clientId: true },
                    });
                    clientWhere = {
                        id: { in: memberClientIds.map((m) => m.clientId) },
                        isActive: true,
                        approvalStatus: { in: approvalStatuses },
                        kycDocuments: { some: { isDeleted: false } },
                        ...searchFilter
                    };
                }

                // Get total for pagination
                const total = await prisma.client.count({
                    where: clientWhere
                });

                const clients = await prisma.client.findMany({
                    where: clientWhere,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        mobileNumber: true,
                        approvalStatus: true,
                        verificationStatus: true,
                        createdAt: true,
                        enrolledBy:      { select: { firstName: true, lastName: true, employeeId: true } },
                        bmReviewedBy:    { select: { firstName: true, lastName: true, employeeId: true } },
                        amReviewedBy:    { select: { firstName: true, lastName: true, employeeId: true } },
                        qcVerifiedBy:    { select: { firstName: true, lastName: true, employeeId: true } },
                        finalReviewedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                        bmReviewedAt: true,
                        _count: {
                            select: {
                                kycDocuments: { where: { isDeleted: false } },
                            },
                        },
                    },
                    orderBy: [
                        { createdAt: 'asc' },
                        { id: 'asc' },
                    ],
                    skip,
                    take: limit,
                });

                // Get group name for breadcrumb
                let groupName = 'Ungrouped Clients';
                if (groupId !== '__ungrouped__') {
                    const group = await prisma.group.findUnique({
                        where: { id: groupId },
                        select: { name: true },
                    });
                    groupName = group?.name || groupId;
                }

                const data = clients.map((c) => ({
                    id: c.id,
                    clientId: c.clientId,
                    name: `${c.firstName} ${c.lastName}`,
                    mobileNumber: c.mobileNumber,
                    approvalStatus: c.approvalStatus,
                    verificationStatus: c.verificationStatus,
                    enrolledBy:      c.enrolledBy      ? { name: `${c.enrolledBy.firstName} ${c.enrolledBy.lastName}`,           employeeId: c.enrolledBy.employeeId }      : null,
                    bmReviewedBy:    c.bmReviewedBy    ? { name: `${c.bmReviewedBy.firstName} ${c.bmReviewedBy.lastName}`,       employeeId: c.bmReviewedBy.employeeId }    : null,
                    amReviewedBy:    c.amReviewedBy    ? { name: `${c.amReviewedBy.firstName} ${c.amReviewedBy.lastName}`,       employeeId: c.amReviewedBy.employeeId }    : null,
                    qcVerifiedBy:    c.qcVerifiedBy    ? { name: `${c.qcVerifiedBy.firstName} ${c.qcVerifiedBy.lastName}`,       employeeId: c.qcVerifiedBy.employeeId }    : null,
                    finalReviewedBy: c.finalReviewedBy ? { name: `${c.finalReviewedBy.firstName} ${c.finalReviewedBy.lastName}`, employeeId: c.finalReviewedBy.employeeId } : null,
                    bmReviewedAt: c.bmReviewedAt,
                    kycDocCount: c._count.kycDocuments,
                    enrolledAt: c.createdAt,
                }));

                return successResponse(
                    {
                        level: 'clients',
                        centerId,
                        groupId,
                        groupName,
                        items: data,
                        pagination: {
                            total,
                            page,
                            limit,
                            totalPages: Math.ceil(total / limit)
                        }
                    },
                    'Approval queue clients fetched'
                );
            }

            return errorResponse('Invalid query parameters', 400);
        } catch (error) {
            console.error('Error fetching approval queue:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch approval queue',
                500
            );
        }
    })(request);
}
