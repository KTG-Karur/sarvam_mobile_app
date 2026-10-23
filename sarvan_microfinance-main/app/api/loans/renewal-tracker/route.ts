import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus, LoanDisbursementStatus, Prisma } from '@prisma/client';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getRenewalStages, getRenewalStatusesForStage, RENEWAL_RETAKE_STATUSES } from '@/app/lib/renewal-workflow';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// 'all' | 'admin' | 'stage:<roleSlug>' — one per configured workflow stage, in the
// admin-configured order (ClientWorkflowConfig; legacy BM -> AM -> QC when none is
// active — see app/lib/renewal-workflow.ts), so the tracker's chips match the
// actual renewal approval chain — plus 'recheck', 'pre_disbursement', 'disbursed'
// and 'rejected'.
type StageFilter = string;

// After the approval chain finishes (renewalApprovalStatus APPROVED) a renewal goes
// through the same Level-1 / Level-2 disbursement pipeline as a normal loan. Its
// disbursementStatus is PENDING_LEVEL1 from creation, so the approval status must
// be checked too — otherwise renewals still under review would show here.
const PRE_DISBURSE_STATUSES: LoanDisbursementStatus[] = ['PENDING_LEVEL1', 'APPROVED_LEVEL1', 'PENDING_LEVEL2', 'APPROVED_LEVEL2'];
const DISBURSEMENT_WHERE: Record<string, Prisma.LoanWhereInput> = {
    pre_disbursement: { renewalApprovalStatus: 'APPROVED', disbursementStatus: { in: PRE_DISBURSE_STATUSES } },
    disbursed: { disbursementStatus: 'DISBURSED' },
};

const RETAKE_DOC_DECISION: Prisma.KYCWhereInput[] = [
    { bmDecision: 'RETAKE_REQUIRED' },
    { amDecision: 'RETAKE_REQUIRED' },
    { qcDecision: 'RETAKE_REQUIRED' },
    // Custom-role dynamic workflow stages
    { stageReviews: { some: { decision: 'RETAKE_REQUIRED' } } },
];

// A renewal is in recheck once its status moved to a *_RETAKE_REQUIRED, or as soon
// as any one of its loan-scoped re-uploads was flagged (status may not have moved
// yet). Kept out of the per-stage chips so Recheck and the stages don't overlap —
// same split as the member tracker's Recheck vs Approval Queue tabs.
const RECHECK_WHERE: Prisma.LoanWhereInput = {
    OR: [
        { renewalApprovalStatus: { in: RENEWAL_RETAKE_STATUSES } },
        { renewalKycDocuments: { some: { isDeleted: false, OR: RETAKE_DOC_DECISION } } },
    ],
};

const FINAL_STATUSES = ['PENDING_FINAL_REVIEW', 'FINAL_RETAKE_REQUIRED'] as ClientApprovalStatus[];
// Pre-dynamic chip ids still accepted from older clients / bookmarked URLs.
const LEGACY_STAGE_ROLE: Record<string, string> = { bm: 'branch-manager', am: 'area-manager', qc: 'quality-checkers' };

/**
 * GET /api/loans/renewal-tracker
 *
 * Read-only, stage-filterable view of every renewal loan application for the
 * Client Loan Tracker page's "Renewal Loans" tab — unlike
 * /api/approval/loans/renewal-queue (which only ever shows what's pending at
 * the CALLER's own stage, for taking action), this lets any tracker viewer
 * browse and filter by ANY configured stage (All / <each stage> / Admin) across their
 * permitted branches, purely for monitoring where each renewal currently sits.
 *
 * Query params:
 *   stage    – all | admin | stage:<roleSlug> | recheck | pre_disbursement | disbursed | rejected   (default all)
 *   search   – loan number, client name or client ID
 *   branchId – branch override (ADMIN / AREA_MANAGER)
 *   centerId – center filter
 *   page     – default 1
 *   pageSize – default 20, max 100
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const rawStage = searchParams.get('stage') || 'all';
            const stage: StageFilter = LEGACY_STAGE_ROLE[rawStage] ? `stage:${LEGACY_STAGE_ROLE[rawStage]}` : rawStage;
            const { stages } = await getRenewalStages();
            const stageList = stages.map((st) => ({ levelOrder: st.levelOrder, roleSlug: st.roleSlug, stageName: st.stageName }));
            const stageKeys: StageFilter[] = ['all', ...stages.map((st) => `stage:${st.roleSlug}`), 'admin', 'recheck', 'pre_disbursement', 'disbursed', 'rejected'];
            const search = (searchParams.get('search') || '').trim();
            const dateFrom = searchParams.get('dateFrom');
            const dateTo = searchParams.get('dateTo');
            const branchIdParam = searchParams.get('branchId');
            const centerId = searchParams.get('centerId') || undefined;
            const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

            const branchIds = await resolveScopedBranchIds(user, branchIdParam);
            if (branchIds !== null && branchIds.length === 0) {
                return successResponse(
                    { items: [], stages: stageList, stageCounts: Object.fromEntries(stageKeys.map((k) => [k, 0])), pagination: { page, pageSize, total: 0, totalPages: 0 } },
                    'No branches assigned'
                );
            }

            const baseWhere: Prisma.LoanWhereInput = {
                isRenewalApplication: true,
                isActive: true,
                ...(branchIds ? { branchId: { in: branchIds } } : {}),
                ...(centerId ? { centerId } : {}),
            };
            if (dateFrom || dateTo) {
                const dateFilter: Prisma.DateTimeFilter = {};
                if (dateFrom) dateFilter.gte = new Date(dateFrom);
                if (dateTo) {
                    const end = new Date(dateTo);
                    end.setHours(23, 59, 59, 999);
                    dateFilter.lte = end;
                }
                baseWhere.createdAt = dateFilter;
            }
            if (search) {
                baseWhere.OR = [
                    { loanNumber: { contains: search, mode: 'insensitive' } },
                    { client: { firstName: { contains: search, mode: 'insensitive' } } },
                    { client: { lastName: { contains: search, mode: 'insensitive' } } },
                    { client: { clientId: { contains: search, mode: 'insensitive' } } },
                    ...loanMemberIdSearchConditions(search),
                ];
            }

            const statusesForStage = (s: StageFilter): ClientApprovalStatus[] | null => {
                if (s === 'admin') return FINAL_STATUSES;
                if (s === 'rejected') return ['REJECTED'] as ClientApprovalStatus[];
                const st = s.startsWith('stage:') ? stages.find((x) => `stage:${x.roleSlug}` === s) : undefined;
                return st ? getRenewalStatusesForStage(st, stages) : null;
            };
            const whereForStage = (s: StageFilter): Prisma.LoanWhereInput => {
                if (s === 'recheck') return { AND: [baseWhere, RECHECK_WHERE] };
                if (DISBURSEMENT_WHERE[s]) return { AND: [baseWhere, DISBURSEMENT_WHERE[s]] };
                const statuses = statusesForStage(s);
                if (!statuses) return baseWhere;
                const atStage: Prisma.LoanWhereInput = { ...baseWhere, renewalApprovalStatus: { in: statuses } };
                return s === 'rejected' ? atStage : { AND: [atStage, { NOT: RECHECK_WHERE }] };
            };

            const [stageCountValues, total, loans] = await Promise.all([
                Promise.all(stageKeys.map((k) => prisma.loan.count({ where: whereForStage(k) }))),
                prisma.loan.count({ where: whereForStage(stage) }),
                prisma.loan.findMany({
                    where: whereForStage(stage),
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        loanNumber: true,
                        amount: true,
                        frequency: true,
                        renewalApprovalStatus: true,
                        disbursementStatus: true,
                        disbursedByBMAt: true,
                        createdAt: true,
                        client: { select: { id: true, clientId: true, firstName: true, lastName: true, mobileNumber: true } },
                        center: { select: { id: true, name: true, code: true } },
                        branch: { select: { id: true, name: true, code: true } },
                        loanProduct: { select: { productName: true } },
                        createdBy: { select: { firstName: true, lastName: true, employeeId: true } },
                        _count: { select: { renewalKycDocuments: { where: { isDeleted: false } } } },
                        // Latest flagged re-upload — "by <stage>" + remark on the Recheck chip.
                        renewalKycDocuments: {
                            where: { isDeleted: false, OR: RETAKE_DOC_DECISION },
                            orderBy: { updatedAt: 'desc' },
                            take: 1,
                            select: {
                                bmDecision: true, bmRemark: true,
                                amDecision: true, amRemark: true,
                                qcDecision: true, qcRemark: true,
                                retakeReason: true,
                                stageReviews: {
                                    where: { decision: 'RETAKE_REQUIRED' },
                                    select: { roleSlug: true, remark: true },
                                },
                            },
                        },
                        // Latest rejection — "Rejected by" + reason on the Rejected chip.
                        renewalHistory: {
                            where: { action: 'RENEWAL_REJECTED' },
                            orderBy: { createdAt: 'desc' },
                            take: 1,
                            select: {
                                remarks: true,
                                newState: true,
                                createdAt: true,
                                performedBy: { select: { firstName: true, lastName: true } },
                            },
                        },
                    },
                }),
            ]);

            const items = loans.map((l) => ({
                id: l.id,
                loanNumber: l.loanNumber,
                amount: Number(l.amount),
                frequency: l.frequency,
                renewalApprovalStatus: l.renewalApprovalStatus,
                disbursementStatus: l.disbursementStatus,
                disbursedAt: l.disbursedByBMAt,
                createdAt: l.createdAt,
                clientId: l.client.id,
                clientDisplayId: l.client.clientId,
                clientName: `${l.client.firstName} ${l.client.lastName}`.trim(),
                mobileNumber: l.client.mobileNumber,
                centerName: l.center ? `${l.center.code} - ${l.center.name}` : null,
                branchName: l.branch ? `${l.branch.code} - ${l.branch.name}` : null,
                productName: l.loanProduct?.productName ?? null,
                kycDocCount: l._count.renewalKycDocuments,
                fdoName: l.createdBy ? `${l.createdBy.firstName} ${l.createdBy.lastName}`.trim() : null,
                fdoEmployeeId: l.createdBy?.employeeId ?? null,
                recheck: (() => {
                    const doc = l.renewalKycDocuments[0];
                    const statusRetake = (RENEWAL_RETAKE_STATUSES as string[]).includes(l.renewalApprovalStatus ?? '');
                    if (!doc && !statusRetake) return null;
                    const review = doc?.stageReviews[0];
                    const by = !doc ? null
                        : review ? (stages.find((st) => st.roleSlug === review.roleSlug)?.stageName ?? review.roleSlug)
                        : doc.amDecision === 'RETAKE_REQUIRED' ? 'AM'
                        : doc.bmDecision === 'RETAKE_REQUIRED' ? 'BM'
                        : doc.qcDecision === 'RETAKE_REQUIRED' ? 'QC'
                        : null;
                    return {
                        // Document flagged but the renewal's status hasn't moved to *_RETAKE_REQUIRED yet.
                        documentOnly: !statusRetake,
                        by,
                        remarks: review?.remark || doc?.amRemark || doc?.bmRemark || doc?.qcRemark || doc?.retakeReason || null,
                    };
                })(),
                rejection: l.renewalApprovalStatus === 'REJECTED' && l.renewalHistory[0]
                    ? (() => {
                        const h = l.renewalHistory[0];
                        let stageName: string | null = null;
                        try { stageName = JSON.parse(h.newState ?? '{}').stage?.stageName ?? null; } catch { /* ignore */ }
                        return {
                            // FINAL_REJECT carries no stage info — that's the Admin final review.
                            stageName: stageName ?? 'Admin',
                            by: `${h.performedBy.firstName} ${h.performedBy.lastName}`.trim(),
                            at: h.createdAt,
                            remarks: h.remarks,
                        };
                    })()
                    : null,
            }));

            return successResponse(
                {
                    items,
                    stages: stageList,
                    stageCounts: Object.fromEntries(stageKeys.map((k, i) => [k, stageCountValues[i]])),
                    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
                },
                'Renewal loan tracker fetched'
            );
        } catch (error) {
            console.error('Error fetching renewal loan tracker:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch renewal loan tracker', 500);
        }
    })(request);
}
