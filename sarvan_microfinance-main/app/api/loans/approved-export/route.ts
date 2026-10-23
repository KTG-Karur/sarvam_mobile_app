import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
  errorResponse,
  successResponse,
  withAuth,
  handleCorsPreflight,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getBuiltinColumns } from '@/app/lib/kyc-stage-decisions';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/loans/approved-export
 *
 * Approved-members export for the Loan Tracker — new-member loans (client
 * approval chain) and renewal loans (per-loan renewal chain), with the latest
 * BM / AM / QC / Admin approval (who + when) for each.
 *
 * Approvals are read from the audit trails (ClientApprovalHistory /
 * LoanApprovalHistory), not from the client's bm/am/qc review columns: those are also
 * stamped on retakes, and custom-role stages only exist in the history. A dynamic
 * stage (LEVEL_APPROVED) is mapped to BM/AM/QC by its role slug; any other role
 * goes to "Other Stages".
 *
 * Query params:
 *   from, to   YYYY-MM-DD (IST, inclusive) — the approval date range
 *   stage      any | bm | am | qc | admin — whose approval must fall in the range
 *   loanType   all | new | renewal
 *   branchId   optional, clamped to the caller's permitted branches
 */

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'From date is required (YYYY-MM-DD)'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'To date is required (YYYY-MM-DD)'),
  stage: z.enum(['any', 'bm', 'am', 'qc', 'admin']).default('any'),
  loanType: z.enum(['all', 'new', 'renewal']).default('all'),
  branchId: z.string().optional(),
});

type StageKey = 'BM' | 'AM' | 'QC' | 'ADMIN';

const MAX_ROWS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Legacy (fixed-chain) approval actions → stage. LEVEL_APPROVED is resolved from newState.
const CLIENT_APPROVE_ACTIONS: Record<string, StageKey> = {
  BM_COMPLETED_REVIEW: 'BM',
  AM_APPROVED_CLIENT: 'AM',
  QC_VERIFIED_CLIENT: 'QC',
  FINAL_APPROVED_CLIENT: 'ADMIN',
};
const LOAN_APPROVE_ACTIONS: Record<string, StageKey> = {
  BM_COMPLETED_REVIEW: 'BM',
  AM_APPROVED_LOAN: 'AM',
  QC_VERIFIED_LOAN: 'QC',
  FINAL_APPROVED_LOAN: 'ADMIN',
};

const USER_SELECT = { firstName: true, lastName: true, employeeId: true } as const;

const BRANCH_SELECT = {
  name: true,
  code: true,
  areas: {
    take: 1,
    select: {
      name: true,
      division: { select: { name: true, region: { select: { name: true } } } },
    },
  },
} as const;

type HistoryRow = {
  action: string;
  newState: string | null;
  createdAt: Date;
  performedBy: { firstName: string; lastName: string; employeeId: string | null };
};

export interface StageApproval {
  by: string;
  employeeId: string | null;
  at: string;
}

export interface ApprovedExportRow {
  loanType: 'NEW' | 'RENEWAL';
  loanId: string;
  memberId: string;
  memberName: string;
  mobile: string;
  region: string;
  division: string;
  area: string;
  branch: string;
  branchCode: string;
  center: string;
  fdo: string;
  product: string;
  amount: number | null;
  status: string;
  submittedAt: string;
  bm: StageApproval | null;
  am: StageApproval | null;
  qc: StageApproval | null;
  admin: StageApproval | null;
  otherStages: string;
}

function fullName(u: { firstName: string; lastName: string } | null | undefined) {
  return u ? `${u.firstName} ${u.lastName}`.trim() : '';
}

function stageOf(row: Pick<HistoryRow, 'action' | 'newState'>, legacy: Record<string, StageKey>): { key: StageKey | null; name: string } | null {
  const fixed = legacy[row.action];
  if (fixed) return { key: fixed, name: fixed };
  if (row.action !== 'LEVEL_APPROVED') return null;
  try {
    const stage = row.newState ? JSON.parse(row.newState)?.stage : null;
    const slug: string | undefined = stage?.roleSlug;
    const prefix = slug ? getBuiltinColumns(slug)?.auditPrefix : undefined;
    return { key: prefix ?? null, name: stage?.stageName || slug || 'Stage' };
  } catch {
    return null;
  }
}

/** Latest approval per stage (a retake restarts the chain, so the last one counts). */
function collectApprovals(history: HistoryRow[], legacy: Record<string, StageKey>) {
  const byStage: Partial<Record<StageKey, StageApproval>> = {};
  const others = new Map<string, StageApproval>();
  for (const h of history) {
    const stage = stageOf(h, legacy);
    if (!stage) continue;
    const approval: StageApproval = {
      by: fullName(h.performedBy),
      employeeId: h.performedBy.employeeId,
      at: h.createdAt.toISOString(),
    };
    // history is ordered ascending, so later entries overwrite earlier ones
    if (stage.key) byStage[stage.key] = approval;
    else others.set(stage.name, approval);
  }
  return { byStage, others };
}

function branchHierarchy(branch: { name: string; code: string; areas: { name: string; division: { name: string; region: { name: string } } }[] } | null | undefined) {
  const area = branch?.areas[0];
  return {
    region: area?.division.region.name ?? '',
    division: area?.division.name ?? '',
    area: area?.name ?? '',
    branch: branch?.name ?? '',
    branchCode: branch?.code ?? '',
  };
}

export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const params = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

      const fromUtc = new Date(`${params.from}T00:00:00+05:30`);
      const toExclusiveUtc = new Date(new Date(`${params.to}T00:00:00+05:30`).getTime() + DAY_MS);
      if (fromUtc >= toExclusiveUtc) return errorResponse('From date must be on or before To date', 400);

      const branchIds = await resolveScopedBranchIds(user, params.branchId);
      if (branchIds && branchIds.length === 0) return successResponse({ rows: [], truncated: false }, 'No branches assigned');

      const wanted: StageKey | null = params.stage === 'any' ? null : (params.stage.toUpperCase() as StageKey);
      const inRange = (iso: string | undefined) => {
        if (!iso) return false;
        const t = new Date(iso).getTime();
        return t >= fromUtc.getTime() && t < toExclusiveUtc.getTime();
      };
      // Row qualifies when the selected stage's latest approval (or any stage's, for "any") is in range.
      const qualifies = (byStage: Partial<Record<StageKey, StageApproval>>, others: Map<string, StageApproval>) =>
        wanted
          ? inRange(byStage[wanted]?.at)
          : Object.values(byStage).some((a) => inRange(a?.at)) || [...others.values()].some((a) => inRange(a.at));

      const actionsFor = (legacy: Record<string, StageKey>) =>
        wanted
          ? [...Object.keys(legacy).filter((a) => legacy[a] === wanted), 'LEVEL_APPROVED']
          : [...Object.keys(legacy), 'LEVEL_APPROVED'];

      const rows: ApprovedExportRow[] = [];
      let truncated = false;

      // ── New-member loans ────────────────────────────────────────────────
      if (params.loanType !== 'renewal') {
        const candidates = await prisma.clientApprovalHistory.findMany({
          where: {
            action: { in: actionsFor(CLIENT_APPROVE_ACTIONS) as never[] },
            createdAt: { gte: fromUtc, lt: toExclusiveUtc },
            ...(branchIds ? { client: { center: { branchId: { in: branchIds } } } } : {}),
          },
          select: { clientId: true },
          distinct: ['clientId'],
          take: MAX_ROWS + 1,
        });
        if (candidates.length > MAX_ROWS) truncated = true;
        const clientIds = candidates.slice(0, MAX_ROWS).map((c) => c.clientId);

        if (clientIds.length > 0) {
          const clients = await prisma.client.findMany({
            where: { id: { in: clientIds } },
            select: {
              id: true,
              clientId: true,
              firstName: true,
              lastName: true,
              mobileNumber: true,
              phone: true,
              approvalStatus: true,
              createdAt: true,
              requestedAmount: true,
              enrolledBy: { select: USER_SELECT },
              center: { select: { name: true, code: true, branch: { select: BRANCH_SELECT } } },
              requestedLoanProductType: { select: { name: true } },
              loanApplications: {
                where: { isRenewalApplication: false },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { loanNumber: true, amount: true, loanProduct: { select: { productName: true } } },
              },
              approvalHistory: {
                where: { action: { in: [...Object.keys(CLIENT_APPROVE_ACTIONS), 'LEVEL_APPROVED'] as never[] } },
                orderBy: { createdAt: 'asc' },
                select: { action: true, newState: true, createdAt: true, performedBy: { select: USER_SELECT } },
              },
            },
          });

          for (const c of clients) {
            const { byStage, others } = collectApprovals(c.approvalHistory as HistoryRow[], CLIENT_APPROVE_ACTIONS);
            if (!qualifies(byStage, others)) continue;
            const loan = c.loanApplications[0];
            rows.push({
              loanType: 'NEW',
              loanId: loan?.loanNumber ?? '',
              memberId: c.clientId,
              memberName: fullName(c),
              mobile: c.mobileNumber ?? c.phone ?? '',
              ...branchHierarchy(c.center?.branch),
              center: c.center ? `${c.center.name}${c.center.code ? ` (${c.center.code})` : ''}` : '',
              fdo: fullName(c.enrolledBy),
              product: loan?.loanProduct?.productName ?? c.requestedLoanProductType?.name ?? '',
              amount: loan ? Number(loan.amount) : c.requestedAmount != null ? Number(c.requestedAmount) : null,
              status: c.approvalStatus,
              submittedAt: c.createdAt.toISOString(),
              bm: byStage.BM ?? null,
              am: byStage.AM ?? null,
              qc: byStage.QC ?? null,
              admin: byStage.ADMIN ?? null,
              otherStages: [...others.entries()].map(([name, a]) => `${name}: ${a.by}`).join('; '),
            });
          }
        }
      }

      // ── Renewal loans ───────────────────────────────────────────────────
      if (params.loanType !== 'new') {
        const candidates = await prisma.loanApprovalHistory.findMany({
          where: {
            action: { in: actionsFor(LOAN_APPROVE_ACTIONS) },
            createdAt: { gte: fromUtc, lt: toExclusiveUtc },
            loan: { isRenewalApplication: true, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
          },
          select: { loanId: true },
          distinct: ['loanId'],
          take: MAX_ROWS + 1,
        });
        if (candidates.length > MAX_ROWS) truncated = true;
        const loanIds = candidates.slice(0, MAX_ROWS).map((c) => c.loanId);

        if (loanIds.length > 0) {
          const loans = await prisma.loan.findMany({
            where: { id: { in: loanIds } },
            select: {
              loanNumber: true,
              amount: true,
              renewalApprovalStatus: true,
              createdAt: true,
              createdBy: { select: USER_SELECT },
              loanProduct: { select: { productName: true } },
              branch: { select: BRANCH_SELECT },
              center: { select: { name: true, code: true } },
              client: { select: { clientId: true, firstName: true, lastName: true, mobileNumber: true, phone: true } },
              renewalHistory: {
                where: { action: { in: [...Object.keys(LOAN_APPROVE_ACTIONS), 'LEVEL_APPROVED'] } },
                orderBy: { createdAt: 'asc' },
                select: { action: true, newState: true, createdAt: true, performedBy: { select: USER_SELECT } },
              },
            },
          });

          for (const l of loans) {
            const { byStage, others } = collectApprovals(l.renewalHistory as HistoryRow[], LOAN_APPROVE_ACTIONS);
            if (!qualifies(byStage, others)) continue;
            rows.push({
              loanType: 'RENEWAL',
              loanId: l.loanNumber,
              memberId: l.client.clientId,
              memberName: fullName(l.client),
              mobile: l.client.mobileNumber ?? l.client.phone ?? '',
              ...branchHierarchy(l.branch),
              center: `${l.center.name}${l.center.code ? ` (${l.center.code})` : ''}`,
              fdo: fullName(l.createdBy),
              product: l.loanProduct?.productName ?? '',
              amount: Number(l.amount),
              status: l.renewalApprovalStatus ?? '',
              submittedAt: l.createdAt.toISOString(),
              bm: byStage.BM ?? null,
              am: byStage.AM ?? null,
              qc: byStage.QC ?? null,
              admin: byStage.ADMIN ?? null,
              otherStages: [...others.entries()].map(([name, a]) => `${name}: ${a.by}`).join('; '),
            });
          }
        }
      }

      rows.sort((a, b) =>
        a.region.localeCompare(b.region) ||
        a.division.localeCompare(b.division) ||
        a.area.localeCompare(b.area) ||
        a.branch.localeCompare(b.branch) ||
        a.center.localeCompare(b.center) ||
        a.memberName.localeCompare(b.memberName)
      );

      return successResponse({ rows, truncated }, `${rows.length} approved record(s)`);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      console.error('Error building approved export:', error);
      return errorResponse(error instanceof Error ? error.message : 'Failed to build approved export', 500);
    }
  })(request);
}
