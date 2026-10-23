import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { getActiveWorkflowConfig, getPendingStatusForStage, getRetakeStatusForStage } from '@/app/lib/workflow-config';
import {
  errorResponse,
  successResponse,
  withAuth,
  handleCorsPreflight,
} from '@/app/lib/api-utils';
import { cachedMasterData, stableParamsKey } from '@/app/lib/cache/master-data-cache';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

// The 7 tab counts below are identical on every tab switch (same branch/date
// scope, independent of which tab/approvalFilter/page the user is currently
// viewing) — a very-low TTL read-through cache absorbs that repeat load
// without risking visibly-stale numbers on this approval-workflow page.
// `client.update` has ~23 call sites across the app (the approval workflow
// is wide), too scattered to bump individually — TTL alone is the pragmatic
// safety net here, same call made for the employees dropdown cache.
const CLIENT_TAB_COUNTS_TTL_SECONDS = 15;

export async function OPTIONS() {
  return handleCorsPreflight();
}

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'all' | 'pending' | 'new_loan' | 'yet_to_approve' | 'approved' | 'pre_disbursement' | 'disbursed' | 'recheck' | 'rejected';
// 'stage:<roleSlug>' = one configured dynamic-workflow stage (any role).
type ApprovalFilter = 'all' | 'bm' | 'am' | 'qc' | 'admin' | `stage:${string}`;

const YET_TO_APPROVE_STATUSES = [
  'SUBMITTED',
  'PENDING_BM_REVIEW',
  'PENDING_AM_REVIEW',
  'PENDING_QC_VERIFICATION',
  'PENDING_FINAL_REVIEW',
  'PENDING_LEVEL_1',
  'PENDING_LEVEL_2',
  'PENDING_LEVEL_3',
  'PENDING_LEVEL_4',
  'PENDING_LEVEL_5',
];

const RECHECK_STATUSES = [
  'BM_RETAKE_REQUIRED',
  'AM_RETAKE_REQUIRED',
  'QC_VERIFICATION_RETAKE_REQUIRED',
  'FINAL_RETAKE_REQUIRED',
  'LEVEL_1_RETAKE_REQUIRED',
  'LEVEL_2_RETAKE_REQUIRED',
  'LEVEL_3_RETAKE_REQUIRED',
  'LEVEL_4_RETAKE_REQUIRED',
  'LEVEL_5_RETAKE_REQUIRED',
];

// A client counts as "recheck" the moment ANY single KYC document is marked
// RETAKE_REQUIRED by BM/AM/QC — even if the client-level approvalStatus hasn't
// transitioned to a *_RETAKE_REQUIRED status yet (e.g. AM flagged one image but
// hasn't finished reviewing the rest). This condition is reused to keep the
// "recheck" and "yet_to_approve" tabs mutually exclusive.
// Only the member's own enrollment KYC (loanId null) counts — a Renewal Loan's
// loan-scoped re-uploads are rechecked from the Renewal Loans tab instead
// (/api/loans/renewal-tracker?stage=recheck).
const DOC_RETAKE_CONDITION = {
  kycDocuments: {
    some: {
      isDeleted: false,
      loanId: null,
      OR: [
        { bmDecision: 'RETAKE_REQUIRED' as const },
        { amDecision: 'RETAKE_REQUIRED' as const },
        { qcDecision: 'RETAKE_REQUIRED' as const },
        // Custom-role dynamic workflow stages (see kyc-stage-decisions.ts)
        { stageReviews: { some: { decision: 'RETAKE_REQUIRED' as const } } },
      ],
    },
  },
};

const PRE_DISBURSE_LOAN_STATUSES = [
  'PENDING_LEVEL1',
  'APPROVED_LEVEL1',
  'PENDING_LEVEL2',
  'APPROVED_LEVEL2',
];

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeId: true,
} as const;

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/clients/tracker
 * Returns clients segmented by lifecycle stage for the Client Loan Tracker page.
 *
 * Query params:
 *   tab            – all | pending | new_loan | yet_to_approve | approved | pre_disbursement | disbursed | recheck | rejected
 *   approvalFilter – all | bm | am | qc | admin | stage:<roleSlug>  (applies only for yet_to_approve tab;
 *                    stage:<roleSlug> = one configured dynamic workflow stage)
 *   search         – client ID, name, or mobile
 *   dateFrom       – ISO date
 *   dateTo         – ISO date
 *   branchId       – branch override (ADMIN / ADMIN_NON_HO_BRANCH_SWITCH / AREA_MANAGER)
 *   centerId       – center override (ADMIN / ADMIN_NON_HO_BRANCH_SWITCH / AREA_MANAGER)
 *   page           – default 1
 *   pageSize       – default 20, max 100
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);

      const tab = (searchParams.get('tab') || 'all') as Tab;
      const approvalFilter = (searchParams.get('approvalFilter') || 'all') as ApprovalFilter;

      // With a dynamic approval workflow the BM / AM / QC filter chips follow the
      // configured order: each chip = that role's pending status, plus SUBMITTED
      // for whichever role holds the first stage (legacy: SUBMITTED = BM).
      const wfConfig = await getActiveWorkflowConfig();
      const dynamicFilterStatuses = (roleSlug: string): string[] => {
        const stage = wfConfig?.stages.find(st => st.roleSlug === roleSlug
          || (roleSlug === 'quality-checkers' && st.roleSlug === 'background-verification-team'));
        if (!stage) return [];
        const out: string[] = [getPendingStatusForStage(stage)];
        if (stage.levelOrder === wfConfig!.stages[0]?.levelOrder) out.push('SUBMITTED');
        return out;
      };
      const search = searchParams.get('search') || '';
      const dateFrom = searchParams.get('dateFrom');
      const dateTo = searchParams.get('dateTo');
      const branchIdParam = searchParams.get('branchId');
      const centerIdParam = searchParams.get('centerId');
      const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
      const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

      // ── Role-based branch scoping ────────────────────────────────────────
      let branchIds: string[] | undefined;

      if (user.role === 'ADMIN' || user.role === 'ADMIN_NON_HO_BRANCH_SWITCH') {
        if (branchIdParam) branchIds = [branchIdParam];
        // ADMIN / SUBADMIN with no branchId param = see all branches
      } else if (user.role === 'AREA_MANAGER') {
        const amBranches = await prisma.areaManagerBranch.findMany({
          where: { userId: user.userId },
          select: { branchId: true },
        });
        const assigned = amBranches.map((b) => b.branchId);
        branchIds = branchIdParam && assigned.includes(branchIdParam)
          ? [branchIdParam]
          : assigned;
        if (branchIds.length === 0) {
          return successResponse(
            { clients: [], tabCounts: emptyTabCounts(), pagination: emptyPagination(page, pageSize) },
            'No branches assigned'
          );
        }
      } else {
        // BM, FDO, QC — scoped to own branch
        const dbUser = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });
        if (!dbUser?.branchId) {
          return successResponse(
            { clients: [], tabCounts: emptyTabCounts(), pagination: emptyPagination(page, pageSize) },
            'No branch assigned'
          );
        }
        branchIds = [dbUser.branchId];
      }

      // ── Orphan-draft auto-cleanup ────────────────────────────────────────
      // Find all DRAFT records in this branch where the same FDO has already
      // enrolled the same person (same firstName + lastName) as a non-DRAFT.
      // This fires on every tracker load so stale drafts disappear automatically
      // even when the mobile number was different between draft and enrollment.
      {
        const staleDrafts = await prisma.client.findMany({
          where: {
            approvalStatus: 'DRAFT' as any,
            ...(branchIds ? {
              OR: [
                { centerId: { not: null }, center: { branchId: { in: branchIds } } },
                { centerId: null, enrolledBy: { branchId: { in: branchIds } } },
              ],
            } : {}),
          },
          select: { id: true, firstName: true, lastName: true, enrolledById: true },
        });

        if (staleDrafts.length > 0) {
          const orphanIds: string[] = [];
          await Promise.all(staleDrafts.map(async (draft) => {
            const enrolled = await prisma.client.findFirst({
              where: {
                firstName: draft.firstName,
                lastName: draft.lastName,
                enrolledById: draft.enrolledById,
                approvalStatus: { not: 'DRAFT' as any },
              },
              select: { id: true },
            });
            if (enrolled) orphanIds.push(draft.id);
          }));

          if (orphanIds.length > 0) {
            // Delete child records first to satisfy FK constraints before removing the draft.
            await prisma.kYC.deleteMany({ where: { clientId: { in: orphanIds } } });
            await prisma.client.deleteMany({ where: { id: { in: orphanIds } } });
          }
        }
      }

      // ── Build base filter conditions ─────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseConditions: Record<string, any>[] = [];

      // Branch scope for clients without a real center yet (centerId IS NULL) splits
      // in two, same distinction as the orphan-draft cleanup above:
      //  - DRAFT: requestedCenterId is never set on a draft, so the enroller's own
      //    branch (enrolledBy.branchId) is the only signal available.
      //  - Non-draft (submitted, awaiting center assignment): branch must come from
      //    the Loan Details tab's REQUESTED center (Center → Branch), not the
      //    enroller — an HO Admin enrolling into another branch's center needs to
      //    show up under that branch here, not under HO. Mirrors the same fix
      //    already applied to app/api/clients/route.ts's noCenter=true path.
      // The extra approvalStatus condition on each OR arm is redundant once AND'd
      // with a tab's own approvalStatus filter (e.g. 'pending' already requires
      // DRAFT) — it only matters for the 'all' tab, which has no such filter and
      // mixes both kinds of unassigned client in one query.
      if (branchIds) {
        baseConditions.push({
          OR: [
            { centerId: { not: null }, center: { branchId: { in: branchIds } } },
            { centerId: null, approvalStatus: 'DRAFT', enrolledBy: { branchId: { in: branchIds } } },
            { centerId: null, approvalStatus: { not: 'DRAFT' }, requestedCenter: { branchId: { in: branchIds } } },
          ],
        });
      }

      if (centerIdParam) {
        baseConditions.push({ centerId: centerIdParam });
      }

      // Date range on createdAt
      if (dateFrom || dateTo) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dateFilter: Record<string, any> = {};
        if (dateFrom) dateFilter.gte = new Date(dateFrom);
        if (dateTo) {
          const end = new Date(dateTo);
          end.setHours(23, 59, 59, 999);
          dateFilter.lte = end;
        }
        baseConditions.push({ createdAt: dateFilter });
      }

      // Search by name, clientId, mobile, Aadhaar, or co-applicant mobile
      if (search.trim()) {
        baseConditions.push({
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { clientId: { contains: search, mode: 'insensitive' } },
            { mobileNumber: { contains: search, mode: 'insensitive' } },
            ...memberIdSearchConditions(search),
          ],
        });
      }

      // ── Tab-specific filter builder ──────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function buildTabWhere(targetTab: Tab, filter: ApprovalFilter = 'all'): Record<string, any> {
        const conditions = [...baseConditions];

        switch (targetTab) {
          case 'pending':
            // Only explicit DRAFT enrollments saved via the "Save Draft" button.
            // Clients that are enrolled but awaiting center assignment belong in
            // yet_to_approve (BM Approval) — not here.
            conditions.push({ approvalStatus: 'DRAFT' as any });
            break;

          case 'new_loan':
            // New Loan tab → "All Stages": every submitted member (drafts excluded),
            // wherever they are — approval, recheck, disbursement or rejected.
            conditions.push({ approvalStatus: { not: 'DRAFT' as any } });
            break;

          case 'yet_to_approve': {
            // Fully enrolled and submitted for approval — DRAFT excluded.
            // centerId may be null (client enrolled but awaiting center assignment);
            // branch scoping via enrolledBy.branchId already handles those.
            conditions.push({ approvalStatus: { not: 'DRAFT' as any } });
            let statuses: string[];
            switch (filter) {
              case 'bm':
                statuses = wfConfig ? dynamicFilterStatuses('branch-manager') : ['SUBMITTED', 'PENDING_BM_REVIEW', 'PENDING_LEVEL_1'];
                break;
              case 'am':
                statuses = wfConfig ? dynamicFilterStatuses('area-manager') : ['PENDING_AM_REVIEW', 'PENDING_LEVEL_2'];
                break;
              case 'qc':
                statuses = wfConfig ? dynamicFilterStatuses('quality-checkers') : ['PENDING_QC_VERIFICATION', 'PENDING_LEVEL_3'];
                break;
              case 'admin':
                statuses = wfConfig ? ['PENDING_FINAL_REVIEW'] : ['PENDING_FINAL_REVIEW', 'PENDING_LEVEL_4'];
                break;
              default:
                statuses = filter.startsWith('stage:')
                  ? dynamicFilterStatuses(filter.slice('stage:'.length))
                  : YET_TO_APPROVE_STATUSES;
            }
            conditions.push({ approvalStatus: { in: statuses } });
            // Clients with an unresolved document-level retake belong exclusively
            // in the "recheck" tab, not here.
            conditions.push({
              NOT: DOC_RETAKE_CONDITION,
            });
            break;
          }

          case 'approved':
            // "Approved" = permanent roster of every client whose KYC/enrollment
            // approval reached APPROVED. Unlike pre_disbursement/disbursed (which
            // key off the loan's own progress), this tab is NOT mutually exclusive
            // with those — a client stays listed here for life once approved, even
            // after they apply for and are disbursed a loan.
            conditions.push({ approvalStatus: 'APPROVED' });
            break;

          case 'pre_disbursement':
            // Clients with at least one loan currently in the disburse pipeline.
            // Takes priority over the "Disbursed" bucket — a client with BOTH a
            // historical disbursed loan AND an active pre-disburse loan lives here.
            // Normal loans only — renewal loans have their own Pre-Disbursement /
            // Disbursed lists on the Renewal Loans tab (/api/loans/renewal-tracker).
            conditions.push({
              loanApplications: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                some: { isRenewalApplication: false, disbursementStatus: { in: PRE_DISBURSE_LOAN_STATUSES as any } },
              },
            });
            break;

          case 'disbursed':
            // Clients whose last loan is fully disbursed — none are still in pipeline.
            // Normal loans only, same as pre_disbursement above.
            conditions.push({
              loanApplications: {
                some: { isRenewalApplication: false, disbursementStatus: 'DISBURSED' as const },
              },
            });
            // Exclude clients that also have a pre-disburse loan (they belong to
            // pre_disbursement above so we keep tabs mutually exclusive).
            conditions.push({
              loanApplications: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                none: { isRenewalApplication: false, disbursementStatus: { in: PRE_DISBURSE_LOAN_STATUSES as any } },
              },
            });
            break;

          case 'recheck':
            conditions.push({
              OR: [
                { approvalStatus: { in: RECHECK_STATUSES } },
                DOC_RETAKE_CONDITION,
              ],
            });
            break;

          case 'rejected':
            // Rejected at any stage — can be re-accessed back to the rejecting stage.
            conditions.push({ approvalStatus: 'REJECTED' });
            break;

          // 'all': no extra conditions
        }

        return conditions.length > 0 ? { AND: conditions } : {};
      }

      const tabWhere = buildTabWhere(tab, approvalFilter);

      // Configured stages (in order) + how many members wait at each — drives the
      // tracker's "Filter by approval stage" chips, badges and trail labels.
      const workflowStages = (wfConfig?.stages ?? []).map(st => ({
        levelOrder: st.levelOrder,
        roleSlug: st.roleSlug,
        stageName: st.stageName,
        pendingStatus: getPendingStatusForStage(st),
        retakeStatus: getRetakeStatusForStage(st),
      }));
      const stageCountEntries = await Promise.all([
        ...workflowStages.map(async st => [
          `stage:${st.roleSlug}`,
          await prisma.client.count({ where: buildTabWhere('yet_to_approve', `stage:${st.roleSlug}`) }),
        ] as const),
        (async () => ['admin', await prisma.client.count({ where: buildTabWhere('yet_to_approve', 'admin') })] as const)(),
      ]);
      const stageCounts = Object.fromEntries(stageCountEntries);

      const fetchTabCounts = () => Promise.all([
        prisma.client.count({ where: buildTabWhere('all') }),
        prisma.client.count({ where: buildTabWhere('pending') }),
        prisma.client.count({ where: buildTabWhere('new_loan') }),
        prisma.client.count({ where: buildTabWhere('yet_to_approve') }),
        prisma.client.count({ where: buildTabWhere('approved') }),
        prisma.client.count({ where: buildTabWhere('pre_disbursement') }),
        prisma.client.count({ where: buildTabWhere('disbursed') }),
        prisma.client.count({ where: buildTabWhere('recheck') }),
        prisma.client.count({ where: buildTabWhere('rejected') }),
      ]);
      const tabCountsPromise = search.trim()
        ? fetchTabCounts()
        : cachedMasterData(
            // v2: count tuple gained new_loan — new key so stale cached tuples aren't misread
            'clientTabCountsV2',
            stableParamsKey({
              branchIds: branchIds ?? null,
              centerId: centerIdParam ?? null,
              dateFrom: dateFrom ?? null,
              dateTo: dateTo ?? null,
            }),
            fetchTabCounts,
            CLIENT_TAB_COUNTS_TTL_SECONDS
          );

      // ── Fetch tab counts + main page data in parallel ────────────────────
      const [
        [
          allCount,
          pendingCount,
          newLoanCount,
          yetToApproveCount,
          approvedCount,
          preDisbursementCount,
          disbursedCount,
          recheckCount,
          rejectedCount,
        ],
        total,
        clients,
      ] = await Promise.all([
        tabCountsPromise,
        prisma.client.count({ where: tabWhere }),
        prisma.client.findMany({
          where: tabWhere,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
          select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            mobileNumber: true,
            approvalStatus: true,
            createdAt: true,
            bmReviewedAt: true,
            bmRemarks: true,
            amReviewedAt: true,
            amRemarks: true,
            qcVerifiedAt: true,
            qcRemarks: true,
            finalReviewedAt: true,
            finalRemarks: true,
            rejectionReason: true,
            // Only the retake-flagged docs are needed — used to label which stage
            // (BM/AM/QC) flagged a document-level recheck on the Recheck tab.
            kycDocuments: {
              where: {
                isDeleted: false,
                // Member's own KYC only — renewal re-uploads live on the Renewal Loans tab.
                loanId: null,
                OR: [
                  { bmDecision: 'RETAKE_REQUIRED' },
                  { amDecision: 'RETAKE_REQUIRED' },
                  { qcDecision: 'RETAKE_REQUIRED' },
                  // Custom-role dynamic workflow stages
                  { stageReviews: { some: { decision: 'RETAKE_REQUIRED' } } },
                ],
              },
              select: {
                id: true,
                documentType: true,
                fileUrl: true,
                mimeType: true,
                bmDecision: true,
                amDecision: true,
                qcDecision: true,
                bmRemark: true,
                amRemark: true,
                qcRemark: true,
                retakeReason: true,
                stageReviews: {
                  where: { decision: 'RETAKE_REQUIRED' },
                  select: { roleSlug: true, decision: true, remark: true },
                },
              },
            },
            enrolledBy: { select: USER_SELECT },
            bmReviewedBy: { select: USER_SELECT },
            amReviewedBy: { select: USER_SELECT },
            qcVerifiedBy: { select: USER_SELECT },
            finalReviewedBy: { select: USER_SELECT },
            center: {
              select: {
                id: true,
                name: true,
                code: true,
                branch: { select: { id: true, name: true, code: true } },
              },
            },
            loanApplications: {
              where: tab === 'disbursed'
                ? { isRenewalApplication: false, disbursementStatus: 'DISBURSED' as const }
                : tab === 'pre_disbursement'
                  // The Prisma enum in() type is strict — cast to satisfy
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ? { isRenewalApplication: false, disbursementStatus: { in: PRE_DISBURSE_LOAN_STATUSES as any } }
                  : undefined,
              select: {
                id: true,
                loanNumber: true,
                amount: true,
                disbursementStatus: true,
                applicationStatus: true,
                disbursedByBMAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
            // Approval history — used both to fill in reviewer names when the named
            // reviewer fields (bmReviewedBy / amReviewedBy) are null (e.g. approved via
            // the dynamic LEVEL_APPROVE workflow before the fix was deployed) AND to
            // render the full FDO -> BM -> AM -> (recheck) -> FDO -> BM -> AM -> QC -> Admin
            // cycle on the tracker's Approval Trail. Per-document VERIFIED/DELETED
            // actions are excluded — only actions that move the client between
            // stages are kept, so the cycle stays readable.
            approvalHistory: {
              where: {
                action: {
                  in: [
                    'SUBMITTED',
                    'BM_COMPLETED_REVIEW', 'BM_RETAKE_DOCUMENT', 'BM_REJECTED_CLIENT',
                    'AM_APPROVED_CLIENT', 'AM_RETAKE_DOCUMENT', 'AM_REJECTED_CLIENT',
                    'QC_VERIFIED_CLIENT', 'QC_RETAKE_CLIENT', 'QC_REJECTED_CLIENT',
                    'FINAL_APPROVED_CLIENT', 'FINAL_RETAKE_CLIENT', 'FINAL_REJECTED_CLIENT',
                    'FDO_RESUBMITTED',
                    'LEVEL_APPROVED', 'LEVEL_RETAKE_REQUESTED', 'LEVEL_REJECTED',
                    'QC_RETAKE_DOCUMENT', 'LEVEL_RETAKE_DOCUMENT',
                    'REJECTION_REVOKED',
                  ] as any,
                },
              },
              select: {
                action: true,
                previousState: true,
                remarks: true,
                createdAt: true,
                performedBy: { select: USER_SELECT },
              },
              orderBy: { createdAt: 'asc' },
              take: 100,
            },
          },
        }),
      ]);

      return successResponse(
        {
          clients,
          tabCounts: {
            all: allCount,
            pending: pendingCount,
            new_loan: newLoanCount,
            yet_to_approve: yetToApproveCount,
            approved: approvedCount,
            pre_disbursement: preDisbursementCount,
            disbursed: disbursedCount,
            recheck: recheckCount,
            rejected: rejectedCount,
          },
          workflowStages,
          stageCounts,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        },
        'Clients fetched'
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch clients';
      return errorResponse(msg, 500);
    }
  })(request);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyTabCounts() {
  return {
    all: 0,
    pending: 0,
    new_loan: 0,
    yet_to_approve: 0,
    approved: 0,
    pre_disbursement: 0,
    disbursed: 0,
    recheck: 0,
    rejected: 0,
  };
}

function emptyPagination(page: number, pageSize: number) {
  return { page, pageSize, total: 0, totalPages: 0 };
}
