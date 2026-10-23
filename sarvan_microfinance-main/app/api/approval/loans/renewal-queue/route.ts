import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus, Prisma } from '@prisma/client';
import { getUserWorkflowRoleSlugs, userHoldsStage } from '@/app/lib/workflow-config';
import { getRenewalStages, getRenewalStatusesForStage } from '@/app/lib/renewal-workflow';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { applyOrgScope } from '@/app/lib/permissions/org-scope';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/approval/loans/renewal-queue
 * Role-appropriate list of renewal loan applications for the Member Approval
 * workbench (rendered under its own "Renewal Loan Approval" tab).
 *
 * Each reviewer sees the renewals waiting at every configured stage their role
 * holds (ClientWorkflowConfig order, any role — see renewal-workflow.ts; legacy
 * BM → AM → QC when none is active). Admin / Sub Admin also see final review.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const search = (searchParams.get('search') || '').trim();

            const isSubAdmin = user.role !== 'ADMIN' && (await isSubAdminUser(user.userId));
            const { stages } = await getRenewalStages();
            const slugs = await getUserWorkflowRoleSlugs(user);
            const heldStages = stages.filter((st) => userHoldsStage(st, slugs));

            const statusSet = new Set<ClientApprovalStatus>();
            for (const st of heldStages) {
                for (const status of getRenewalStatusesForStage(st, stages)) statusSet.add(status);
            }
            if (isSubAdmin || user.role === 'ADMIN') {
                statusSet.add('PENDING_FINAL_REVIEW' as ClientApprovalStatus);
                statusSet.add('FINAL_RETAKE_REQUIRED' as ClientApprovalStatus);
            }
            if (statusSet.size === 0 && !['BRANCH_MANAGER', 'AREA_MANAGER', 'QC'].includes(user.role)) {
                return errorResponse('Insufficient permissions', 403);
            }
            const statuses = [...statusSet];

            // Same branch scope renewal-action enforces (canAccessClientBranch) — an AM
            // sees only their AreaManagerBranch branches, other roles their assigned
            // branches; BM re-read fresh from DB so a branch transfer applies at once.
            // HO-based users are unrestricted (null).
            let effectiveUser = user;
            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                if (!u?.branchId) return errorResponse('User is not assigned to a branch', 403);
                effectiveUser = { ...user, branchId: u.branchId };
            }
            // Narrowed by the user's Region/Division/Area/Branch org scope, if any.
            const scopedBranchIds = await applyOrgScope(user.userId, await resolveScopedBranchIds(effectiveUser));

            const where: Prisma.LoanWhereInput = {
                isRenewalApplication: true,
                renewalApprovalStatus: { in: statuses },
                isActive: true,
                ...(scopedBranchIds ? { branchId: { in: scopedBranchIds } } : {}),
            };
            if (search) {
                where.OR = [
                    { loanNumber: { contains: search, mode: 'insensitive' } },
                    { client: { firstName: { contains: search, mode: 'insensitive' } } },
                    { client: { lastName: { contains: search, mode: 'insensitive' } } },
                    { client: { clientId: { contains: search, mode: 'insensitive' } } },
                    ...loanMemberIdSearchConditions(search),
                ];
            }

            const loans = statuses.length === 0 ? [] : await prisma.loan.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    renewalApprovalStatus: true,
                    createdAt: true,
                    frequency: true,
                    client: { select: { id: true, clientId: true, firstName: true, lastName: true, mobileNumber: true } },
                    center: { select: { name: true, code: true } },
                    loanProduct: { select: { productName: true } },
                    createdBy: { select: { firstName: true, lastName: true, employeeId: true } },
                    _count: { select: { renewalKycDocuments: { where: { isDeleted: false } } } },
                },
            });

            const items = loans.map((l) => ({
                id: l.id,
                loanNumber: l.loanNumber,
                amount: Number(l.amount),
                frequency: l.frequency,
                renewalApprovalStatus: l.renewalApprovalStatus,
                createdAt: l.createdAt,
                clientId: l.client.id,
                clientDisplayId: l.client.clientId,
                clientName: `${l.client.firstName} ${l.client.lastName}`.trim(),
                mobileNumber: l.client.mobileNumber,
                centerName: l.center ? `${l.center.code} - ${l.center.name}` : null,
                productName: l.loanProduct?.productName ?? null,
                kycDocCount: l._count.renewalKycDocuments,
                fdoName: l.createdBy ? `${l.createdBy.firstName} ${l.createdBy.lastName}`.trim() : null,
                fdoEmployeeId: l.createdBy?.employeeId ?? null,
            }));

            return successResponse({ items, totalPending: items.length }, 'Renewal loan approval queue fetched');
        } catch (error) {
            console.error('Error fetching renewal loan approval queue:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch queue', 500);
        }
    })(request);
}
