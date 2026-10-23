'use server';

import type { Prisma } from '@prisma/client';
import { ScheduleStatus, TransactionStatus } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { format, differenceInCalendarDays } from 'date-fns';
import { cookies, headers } from 'next/headers';
import { verifyAccessToken } from '@/app/lib/auth';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getKolkataCalendarYmd, parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc } from '@/app/lib/branch-lock';
import { ACTIVE_BRANCH_COOKIE_NAME } from '@/app/lib/branch-session';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { compareMemberIds } from '@/app/lib/member-id-sort';
import { addCalendarDaysToYmd } from '@/app/lib/branch-financial-day';
import { classifyDemandBreakdown, netCurrentDemand, resolveDemandSheetEffectiveCutoffYmd, NON_OUTSTANDING_SCHEDULE_STATUSES } from '@/app/lib/collections/demand-calculation';
import { getLedgerPaidByScheduleBatched, type SchedulePaidAmount } from '@/app/lib/ledger/schedule-paid-amounts';

// ─── Types ───────────────────────────────────────────────────────────────────
export type DemandSheetData = {
  centerId: string;
  centerName: string;
  phone: string;
  noOfClients: number;
  wb: number;
  app: number;
  dueNo: number;
  meetingTime: string;
  loanOS: number;
  arrear: number;
  arrearPrincipal: number;
  arrearInterest: number;
  demand: number;
  demandPrincipal: number;
  demandInterest: number;
  savingsArrear: number;
  savingsDemand: number;
  loanAdvanceDemand: number;
  loanAdvanceOS: number;
  collected: number;
  clSignature: string;
};

export type DemandSheetMeta = {
  branchCode: string;
  branchName: string;
};

export type FDOOption = {
  id: string;
  name: string;
};

export type DemandClientTableRow = {
  clientId: string;
  clientDbId: string;
  clientName: string;
  memberPhone: string;
  loanId: string;
  branchName: string;
  centerId: string;
  centerName: string;
  groupName: string;
  productName: string;
  funderName: string;
  meetingTime: string;
  approvedLevel2At: string;
  loanAmount: number;
  loanAmountInterest: number;
  loanAmountTotal: number;
  loanOS: number;
  loanOSPrincipal: number;
  loanOSInterest: number;
  curDue: number;
  collDue: number;
  demandDate: string;
  demand: number;
  demandPrincipal: number;
  demandInterest: number;
  arrear: number;
  arrearPrincipal: number;
  arrearInterest: number;
  savingsArrear: number;
  savingsDemand: number;
  loanAdvanceDemand: number;
  loanAdvanceOS: number;
  totalDemandAmount: number;
  officerName: string;
  collected: number;
  currentDemandCollAmount: number;
  collectionDate: string;
  collectionStatus: string;
};

export type DemandClientCollectedTableRow = {
  clientId: string;
  clientDbId: string;
  clientName: string;
  centerId: string;
  centerName: string;
  meetingTime: string;
  collectedApproved: number;
  collectedPending: number;
  collectedTotal: number;
};

export type DemandClientWiseCollectedReportClientRow = {
  cid: string;
  clientId: string;
  clientName: string;
  mobileNumber: string;
  collectedApproved: number;
  collectedPending: number;
  collectedTotal: number;
};

export type DemandClientWiseCollectedReportData = {
  branchCode: string;
  branchName: string;
  centerCode: string;
  centerName: string;
  fdoId: string;
  fdoName: string;
  meetingDay: string;
  meetingTime: string;
  meetingDate: string;
  totalClients: number;
  grandTotalCollectedApproved: number;
  grandTotalCollectedPending: number;
  grandTotalCollectedTotal: number;
  clients: DemandClientWiseCollectedReportClientRow[];
};

export type DemandClientWiseReportClientRow = {
  cid: string;
  clientId: string;
  clientName: string;
  loanId: string;
  mobileNumber: string;
  approvedLevel2At: string;
  loanAmount: number;
  loanOS: number;
  loanOSPrincipal: number;
  loanOSInterest: number;
  currentDueNo: number;
  collectionDueNo: number;
  dues: number;
  arrear: number;
  arrearPrincipal: number;
  arrearInterest: number;
  currentDemand: number;
  currentDemandPrincipal: number;
  currentDemandInterest: number;
  totalDemand: number;
  savingsArrear: number;
  savingsDemand: number;
  loanAdvanceDemand: number;
  loanAdvanceOS: number;
  collected: number;
  collectedTillDate: number;
  /** Current Demand Total + Loan Savings Due — deliberately excludes Arrear. */
  totalDemandAmount: number;
  /** Everything collected today: loan (P+I) + savings/loan-advance combined. */
  collectedIncludingSavings: number;
};

export type DemandClientWiseReportData = {
  branchCode: string;
  branchName: string;
  centerCode: string;
  centerName: string;
  fdoId: string;
  fdoName: string;
  meetingDay: string;
  meetingTime: string;
  meetingDate: string;
  totalClients: number;
  grandTotalLoanAmount: number;
  grandTotalLoanOS: number;
  grandTotalLoanOSPrincipal: number;
  grandTotalLoanOSInterest: number;
  grandTotalArrear: number;
  grandTotalArrearPrincipal: number;
  grandTotalArrearInterest: number;
  grandTotalCurrentDemand: number;
  grandTotalCurrentDemandPrincipal: number;
  grandTotalCurrentDemandInterest: number;
  grandTotalDemand: number;
  grandTotalSavingsArrear: number;
  grandTotalSavingsDemand: number;
  grandTotalLoanAdvanceDemand: number;
  grandTotalLoanAdvanceOS: number;
  grandTotalCollected: number;
  grandTotalCollectedTillDate: number;
  grandTotalDemandAmount: number;
  grandTotalCollectedIncludingSavings: number;
  clients: DemandClientWiseReportClientRow[];
};

type AuthContext = {
  userId: string;
  role: string;
  branchId?: string;
  /** True only when branchId came from an explicit Admin/AM branch-switcher pick
   *  (X-Branch-Id header or the active-branch cookie) — never from the bare JWT
   *  default. Admin's default (no switcher use) must stay "all branches". */
  isExplicitBranchOverride?: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getMeetingDayName(dateStr: string): string {
  const dayStartKolkata = parseKolkataAttendanceDateYmd(dateStr);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(dayStartKolkata);
}

function formatDateFull(d: Date | null | undefined): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function formatDateTimeIst(d: Date | null | undefined): string {
  if (!d) return '';
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return `${date} ${time}`;
}

function formatMeetingDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function formatapprovedLevel2At(d: Date | null | undefined): string {
  if (!d) return '';
  return format(new Date(d), 'dd/MM/yyyy');
}

function safeNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const COLLECTED_REPAYMENT_BASE: Pick<Prisma.LoanTransactionWhereInput, 'type' | 'status' | 'isReversed'> = {
  type: 'REPAYMENT',
  status: { in: [TransactionStatus.APPROVED, TransactionStatus.PENDING] },
  isReversed: false,
};

function collectedRepaymentOnDateWhere(dayStart: Date, dayEnd: Date) {
  return {
    ...COLLECTED_REPAYMENT_BASE,
    transactionDate: { gte: dayStart, lte: dayEnd },
  };
}

const COLLECTION_TYPE_DEMAND = 'Demand Collection';

function demandSheetCollectionTypeWhere(): Prisma.LoanTransactionWhereInput {
  return {
    OR: [
      { collectionType: COLLECTION_TYPE_DEMAND },
      { collectionType: null },
      { collectionType: '' },
    ],
  };
}

function demandSheetRepaymentOnDateWhere(
  dayStart: Date,
  dayEnd: Date,
  scopeOr: Prisma.LoanTransactionWhereInput[]
): Prisma.LoanTransactionWhereInput {
  return {
    ...collectedRepaymentOnDateWhere(dayStart, dayEnd),
    AND: [demandSheetCollectionTypeWhere(), { OR: scopeOr }],
  };
}

// Excludes only WAIVED/CLOSED, not PAID — see NON_OUTSTANDING_SCHEDULE_STATUSES in
// app/lib/collections/demand-calculation.ts. `status` can drift from a schedule's
// real due-vs-paid amounts, so an include-list of PENDING/OVERDUE/PARTIALLY_PAID
// could silently exclude a center whose only "due today" installment was mismarked
// PAID. The caller (centerIdsWithInstallmentDueOnKolkataDate) already re-derives
// "pending > 0" from totalDue/totalPaid itself, so widening this query filter is safe.
const DEMAND_SHEET_SCHEDULE_STATUS_FILTER: Prisma.EnumScheduleStatusFilter = {
  notIn: NON_OUTSTANDING_SCHEDULE_STATUSES,
};

function formatClientName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

async function getAuthContext(): Promise<AuthContext | null> {
  try {
    const cookieStore = await cookies();
    let token = cookieStore.get('accessToken')?.value ?? null;
    const headerList = await headers();
    if (!token) {
      const auth = headerList.get('authorization');
      if (auth?.toLowerCase().startsWith('bearer ')) {
        token = auth.slice(7).trim();
      }
    }
    if (!token) return null;
    const payload = verifyAccessToken(token);
    let branchId = payload.branchId;
    // Branch context: X-Branch-Id header (apiClient calls) > httpOnly active-branch
    // cookie (set by the branch switcher; the only signal Server Actions actually
    // receive, since custom headers aren't forwarded on a direct action call).
    const branchOverride =
      headerList.get('x-branch-id') || cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;
    const isExplicitBranchOverride =
      !!branchOverride && (payload.role === 'ADMIN' || payload.role === 'AREA_MANAGER');
    if (isExplicitBranchOverride) {
      branchId = branchOverride;
    }
    return {
      userId: payload.userId,
      role: payload.role,
      branchId,
      isExplicitBranchOverride,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves auth with an explicit, page-local branch override — used by the Demand
 * Sheet's own branch filter so viewing another branch's report never touches the
 * session-wide active-branch cookie/InlineBranchSwitcher (which would also change
 * the user's logged-in branch context everywhere else in the app).
 * ADMIN may request any branch; AREA_MANAGER only one of their assigned branches
 * (verified against AreaManagerBranch) — an unassigned branchId is silently ignored.
 */
async function resolveAuthWithBranchOverride(requestedBranchId?: string): Promise<AuthContext | null> {
  const auth = await getAuthContext();
  if (!auth || !requestedBranchId) return auth;
  if (auth.role !== 'ADMIN' && auth.role !== 'AREA_MANAGER') return auth;
  if (auth.role === 'AREA_MANAGER') {
    const assigned = await prisma.areaManagerBranch.findFirst({
      where: { userId: auth.userId, branchId: requestedBranchId },
      select: { id: true },
    });
    if (!assigned) return auth;
  }
  return { ...auth, branchId: requestedBranchId, isExplicitBranchOverride: true };
}

function getDateRange(dateStr: string): { start: Date; end: Date } {
  const start = parseKolkataAttendanceDateYmd(dateStr);
  const end = new Date(getKolkataDayEndExclusiveUtc(start).getTime() - 1);
  return { start, end };
}

function dueDateToStr(dueDate: Date | string): string {
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  return getKolkataCalendarYmd(d);
}

/**
 * Batch-resolves each distinct branch's EOD-processed working date, but ONLY when the
 * report is being viewed for "today" — a historical/future dateStr must never be reconciled
 * against the branch's live working date (see resolveDemandSheetEffectiveCutoffYmd's doc
 * comment). Short-circuits (no BranchLock queries at all) for any non-today dateStr, which
 * is the common case for reprinting a past sheet. Mirrors the try/catch-per-branch pattern
 * in app/lib/actions/reports.ts's getMISDetailedAgewiseArrearData, since
 * getBranchWorkingDayWindow throws for a branch with no BranchLock row yet.
 */
async function resolveBranchWorkingYmdMap(
  branchIds: string[],
  dateStr: string,
  todayYmd: string
): Promise<Map<string, string>> {
  if (dateStr !== todayYmd) return new Map();
  const distinctBranchIds = [...new Set(branchIds)];
  const entries = await Promise.all(
    distinctBranchIds.map(async (branchId) => {
      try {
        const window = await getBranchWorkingDayWindow({ branchId });
        return [branchId, window.workingDateYmd] as const;
      } catch {
        return null; // no BranchLock row yet (new branch) — falls back to dateStr
      }
    })
  );
  return new Map(entries.filter((e): e is readonly [string, string] => e !== null));
}

const ZERO_PAID: SchedulePaidAmount = { principal: 0, interest: 0 };

function buildDemandSheetCenterBaseScope(fdoId: string, auth: AuthContext | null): Prisma.CenterWhereInput {
  const scope: Prisma.CenterWhereInput = {
    isActive: true,
    status: 'APPROVED',
  };
  if (auth?.role === 'BRANCH_MANAGER' || auth?.role === 'AREA_MANAGER') {
    if (auth.branchId) {
      scope.branchId = auth.branchId;
    }
  } else if (auth?.role === 'ADMIN' && auth.isExplicitBranchOverride && auth.branchId) {
    // Admin's default (no branch picked via the switcher) stays "all branches" —
    // only scope down once they've explicitly picked one.
    scope.branchId = auth.branchId;
  } else if (auth?.role === 'FDO') {
    scope.fdoId = auth.userId;
  }
  if (fdoId && fdoId !== 'all' && auth?.role !== 'FDO') {
    scope.fdoId = fdoId;
  }
  return scope;
}

function buildMeetingDayVariantOrFilter(meetingDayName: string): Prisma.CenterWhereInput {
  const canonical = meetingDayName.trim().toLowerCase();
  const VARIANTS_BY_DAY: Record<string, readonly string[]> = {
    sunday: ['Sunday', 'Sun'],
    monday: ['Monday', 'Mon'],
    tuesday: ['Tuesday', 'Tue', 'Tues'],
    wednesday: ['Wednesday', 'Wed'],
    thursday: ['Thursday', 'Thu', 'Thur', 'Thurs'],
    friday: ['Friday', 'Fri'],
    saturday: ['Saturday', 'Sat'],
  };
  const variants = VARIANTS_BY_DAY[canonical] ?? [meetingDayName];
  return {
    OR: variants.map(v => ({
      meetingDay: { equals: v, mode: 'insensitive' as const },
    })),
  };
}

const SCHEDULE_DUE_QUERY_PADDING_MS = 2 * 24 * 60 * 60 * 1000;

async function centerIdsWithInstallmentDueOnKolkataDate(
  dateStr: string,
  base: Prisma.CenterWhereInput,
  dayStart: Date,
  dayEnd: Date
): Promise<string[]> {
  const windowStart = new Date(dayStart.getTime() - SCHEDULE_DUE_QUERY_PADDING_MS);
  const windowEnd = new Date(dayEnd.getTime() + SCHEDULE_DUE_QUERY_PADDING_MS);
  const rows = await prisma.loanSchedule.findMany({
    where: {
      status: DEMAND_SHEET_SCHEDULE_STATUS_FILTER,
      dueDate: { gte: windowStart, lte: windowEnd },
      loan: {
        isActive: true,
        disbursementStatus: 'DISBURSED',
        NOT: { deathMarking: { some: { isReversed: false, demandRequired: false } } },
        client: {
          isActive: true,
          center: base,
        },
      },
    },
    select: {
      dueDate: true,
      totalDue: true,
      totalPaid: true,
      loan: {
        select: {
          client: {
            select: { centerId: true }
          }
        }
      },
    },
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of rows) {
    const pending = safeNum(s.totalDue) - safeNum(s.totalPaid);
    if (pending <= 0) continue;
    if (dueDateToStr(s.dueDate) !== dateStr) continue;
    const cid = s.loan.client.centerId;
    if (cid && !seen.has(cid)) {
      seen.add(cid);
      out.push(cid);
    }
  }
  return out;
}

async function resolveDemandSheetCenterWhere(
  dateStr: string,
  fdoId: string,
  auth: AuthContext | null,
  dayStart: Date,
  dayEnd: Date
): Promise<Prisma.CenterWhereInput> {
  const base = buildDemandSheetCenterBaseScope(fdoId, auth);
  const meetingDayOr = buildMeetingDayVariantOrFilter(getMeetingDayName(dateStr));
  const repaymentActivity = await prisma.loanTransaction.findMany({
    where: demandSheetRepaymentOnDateWhere(dayStart, dayEnd, [
      { centerId: { not: null }, center: base },
      { centerId: null, client: { center: base } },
    ]),
    select: {
      centerId: true,
      client: { select: { centerId: true } },
    },
  });
  const repaymentCenterIds = [
    ...new Set(
      repaymentActivity
        .map(r => r.centerId ?? r.client.centerId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const dueInstallmentCenterIds = await centerIdsWithInstallmentDueOnKolkataDate(dateStr, base, dayStart, dayEnd);
  return {
    AND: [
      base,
      {
        OR: [
          meetingDayOr,
          ...(repaymentCenterIds.length > 0 ? [{ id: { in: repaymentCenterIds } }] : []),
          ...(dueInstallmentCenterIds.length > 0 ? [{ id: { in: dueInstallmentCenterIds } }] : []),
        ],
      },
    ],
  };
}

/**
 * branchIds-array variant of buildDemandSheetCenterBaseScope() above, for callers with no
 * cookie/session AuthContext (the Request Report queue) — takes an already-resolved
 * `branchIds: string[] | null` directly instead of deriving scope from a role/session.
 */
function buildDemandSheetCenterBaseScopeForBranches(fdoId: string, branchIds: string[] | null): Prisma.CenterWhereInput {
  const scope: Prisma.CenterWhereInput = {
    isActive: true,
    status: 'APPROVED',
  };
  if (branchIds) {
    scope.branchId = { in: branchIds };
  }
  if (fdoId && fdoId !== 'all') {
    scope.fdoId = fdoId;
  }
  return scope;
}

/** branchIds-array variant of resolveDemandSheetCenterWhere() above — see buildDemandSheetCenterBaseScopeForBranches(). */
async function resolveDemandSheetCenterWhereForBranches(
  dateStr: string,
  fdoId: string,
  branchIds: string[] | null,
  dayStart: Date,
  dayEnd: Date
): Promise<Prisma.CenterWhereInput> {
  const base = buildDemandSheetCenterBaseScopeForBranches(fdoId, branchIds);
  const meetingDayOr = buildMeetingDayVariantOrFilter(getMeetingDayName(dateStr));
  const repaymentActivity = await prisma.loanTransaction.findMany({
    where: demandSheetRepaymentOnDateWhere(dayStart, dayEnd, [
      { centerId: { not: null }, center: base },
      { centerId: null, client: { center: base } },
    ]),
    select: {
      centerId: true,
      client: { select: { centerId: true } },
    },
  });
  const repaymentCenterIds = [
    ...new Set(
      repaymentActivity
        .map(r => r.centerId ?? r.client.centerId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const dueInstallmentCenterIds = await centerIdsWithInstallmentDueOnKolkataDate(dateStr, base, dayStart, dayEnd);
  return {
    AND: [
      base,
      {
        OR: [
          meetingDayOr,
          ...(repaymentCenterIds.length > 0 ? [{ id: { in: repaymentCenterIds } }] : []),
          ...(dueInstallmentCenterIds.length > 0 ? [{ id: { in: dueInstallmentCenterIds } }] : []),
        ],
      },
    ],
  };
}

// ─── Helper function to calculate loanOS from schedules ───────────────────
function calculateLoanOSFromSchedules(schedules: any[]): number {
  let totalOutstanding = 0;
  for (const schedule of schedules) {
    const totalDue = safeNum(schedule.totalDue);
    const totalPaid = safeNum(schedule.totalPaid);
    const pending = totalDue - totalPaid;
    if (pending > 0) {
      totalOutstanding += pending;
    }
  }
  return totalOutstanding;
}

// ─── FDO List ────────────────────────────────────────────────────────────────
export async function getFDOs(branchId?: string): Promise<FDOOption[]> {
  const auth = await resolveAuthWithBranchOverride(branchId);
  const where: { role: 'FDO'; isActive: true; branchId?: string; id?: string; } = {
    role: 'FDO',
    isActive: true,
  };
  if ((auth?.role === 'BRANCH_MANAGER' || auth?.role === 'AREA_MANAGER') && auth.branchId) {
    where.branchId = auth.branchId;
  } else if (auth?.role === 'ADMIN' && auth.isExplicitBranchOverride && auth.branchId) {
    where.branchId = auth.branchId;
  } else if (auth?.role === 'FDO') {
    where.id = auth.userId;
  }
  const fdos = await prisma.user.findMany({
    where,
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: 'asc' },
  });
  return fdos.map(fdo => ({
    id: fdo.id,
    name: `${fdo.firstName} ${fdo.lastName}`,
  }));
}

// ─── Branch Metadata ─────────────────────────────────────────────────────────
export async function getBranchMeta(branchId?: string): Promise<DemandSheetMeta> {
  const auth = await resolveAuthWithBranchOverride(branchId);
  const where: { isActive: true; id?: string; } = { isActive: true };
  if (auth?.branchId) {
    where.id = auth.branchId;
  }
  const branch = await prisma.branch.findFirst({
    where,
    select: { code: true, name: true },
    orderBy: { code: 'asc' },
  });
  return {
    branchCode: branch?.code || '',
    branchName: branch?.name || '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CENTERWISE DEMAND SHEET
// ═══════════════════════════════════════════════════════════════════════════════
export async function getDemandSheetData(
  dateStr: string,
  fdoId: string,
  _type: 'centerwise' | 'clientwise' = 'centerwise',
  branchId?: string
): Promise<DemandSheetData[]> {
  const auth = await resolveAuthWithBranchOverride(branchId);
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);
  const centerWhere = await resolveDemandSheetCenterWhere(dateStr, fdoId, auth, dayStart, dayEnd);
  return computeDemandSheetData(dateStr, centerWhere, dayStart, dayEnd);
}

/**
 * Cookie-free variant of getDemandSheetData() above, for the Request Report queue adapter
 * (app/lib/reports/report-registry.ts) — takes already-resolved branchIds directly instead
 * of deriving scope from a cookie-based AuthContext. Shares the same pure aggregation logic
 * via computeDemandSheetData() below, only the center-where resolution differs.
 */
export async function getDemandSheetDataForQueue(
  dateStr: string,
  fdoId: string,
  branchIds: string[] | null
): Promise<DemandSheetData[]> {
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);
  const centerWhere = await resolveDemandSheetCenterWhereForBranches(dateStr, fdoId, branchIds, dayStart, dayEnd);
  return computeDemandSheetData(dateStr, centerWhere, dayStart, dayEnd);
}

async function computeDemandSheetData(
  dateStr: string,
  centerWhere: Prisma.CenterWhereInput,
  dayStart: Date,
  dayEnd: Date
): Promise<DemandSheetData[]> {
  const referenceDate = parseKolkataAttendanceDateYmd(dateStr);
  const centers = await prisma.center.findMany({
    where: centerWhere,
    include: {
      clients: {
        where: { isActive: true },
        include: {
          loanApplications: {
            where: {
              OR: [
                { isActive: true, disbursementStatus: 'DISBURSED', NOT: { deathMarking: { some: { isReversed: false, demandRequired: false } } } },
                { applicationStatus: { in: ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED'] } },
              ],
            },
            include: {
              schedules: {
                orderBy: { dueDate: 'asc' }
              },
            },
          },
        },
      },
    },
    orderBy: { code: 'asc' },
  });
  
  const centerIds = centers.map(c => c.id);
  const collectedByCenter = await prisma.loanTransaction.groupBy({
    by: ['centerId'],
    where: {
      centerId: { in: centerIds },
      ...collectedRepaymentOnDateWhere(dayStart, dayEnd),
      AND: [demandSheetCollectionTypeWhere()],
    },
    _sum: { amount: true },
  });
  const collectedMap = new Map<string, number>(
    collectedByCenter.filter(g => g.centerId !== null).map(g => [g.centerId!, safeNum(g._sum?.amount)])
  );

  // Reconcile the arrear/current-demand cutoff against each branch's real EOD-processed
  // working date, but only when this report is being viewed for "today" — see
  // resolveDemandSheetEffectiveCutoffYmd's doc comment for why a historical/future dateStr
  // must stay unreconciled. Then batch-fetch ledger-derived (not cached-field) paid amounts
  // for every schedule, keyed by cutoff, so a stale LoanSchedule.principalPaid/interestPaid
  // can't understate Arrear OS the way it used to.
  const todayYmd = getKolkataCalendarYmd(new Date());
  const branchWorkingYmdMap = await resolveBranchWorkingYmdMap(centers.map(c => c.branchId), dateStr, todayYmd);
  const effectiveCutoffYmdByBranch = new Map<string, string>();
  for (const branchId of new Set(centers.map(c => c.branchId))) {
    effectiveCutoffYmdByBranch.set(
      branchId,
      resolveDemandSheetEffectiveCutoffYmd(dateStr, todayYmd, branchWorkingYmdMap.get(branchId) ?? null)
    );
  }

  const scheduleIdsByCutoffExclusiveYmd = new Map<string, string[]>();
  // Schedules due ON the demand day, keyed by that day: the exclusive bound makes the ledger lookup return
  // only payments made on EARLIER days (advance), which is what reduces the day's Current Demand.
  const advanceDueDayIdsByCutoffYmd = new Map<string, string[]>();
  for (const center of centers) {
    const effectiveCutoffYmd = effectiveCutoffYmdByBranch.get(center.branchId) ?? dateStr;
    const cutoffExclusiveYmd = addCalendarDaysToYmd(effectiveCutoffYmd, 1);
    const ids = scheduleIdsByCutoffExclusiveYmd.get(cutoffExclusiveYmd) ?? [];
    const dueDayIds = advanceDueDayIdsByCutoffYmd.get(effectiveCutoffYmd) ?? [];
    for (const client of center.clients) {
      for (const loan of client.loanApplications) {
        for (const schedule of loan.schedules) {
          ids.push(schedule.id);
          if (dueDateToStr(schedule.dueDate) === effectiveCutoffYmd) dueDayIds.push(schedule.id);
        }
      }
    }
    scheduleIdsByCutoffExclusiveYmd.set(cutoffExclusiveYmd, ids);
    advanceDueDayIdsByCutoffYmd.set(effectiveCutoffYmd, dueDayIds);
  }
  const ledgerPaidBySchedule = await getLedgerPaidByScheduleBatched(scheduleIdsByCutoffExclusiveYmd);
  const advancePaidBySchedule = await getLedgerPaidByScheduleBatched(advanceDueDayIdsByCutoffYmd);

  const results: DemandSheetData[] = centers.map(center => {
    const effectiveCutoffYmd = effectiveCutoffYmdByBranch.get(center.branchId) ?? dateStr;
    let noOfClients = 0;
    let loanOS = 0;
    let arrear = 0;
    let arrearPrincipal = 0;
    let arrearInterest = 0;
    let demand = 0;
    let demandPrincipal = 0;
    let demandInterest = 0;
    let savingsArrear = 0;
    let savingsDemand = 0;
    let loanAdvanceDemand = 0;
    let loanAdvanceOS = 0;
    let app = 0;
    let maxDaysOverdue = 0;
    let totalDueInstallments = 0;
    let totalDueLoans = 0;

    for (const client of center.clients) {
      const activeLoans = client.loanApplications.filter(
        l => l.isActive && l.disbursementStatus === 'DISBURSED'
      );
      const pendingApps = client.loanApplications.filter(l =>
        ['DRAFT', 'PENDING_VERIFICATION', 'VERIFIED'].includes(l.applicationStatus)
      );
      app += pendingApps.length;
      if (activeLoans.length > 0) {
        noOfClients++;
        loanAdvanceOS += safeNum((client as any).loanAdvance);
      }
      for (const loan of activeLoans) {
        // Calculate loanOS from schedules
        let loanLoanOS = 0;
        let loanHasDue = false;
        let loanDueInstallmentSum = 0;
        let loanDueCount = 0;

        for (const schedule of loan.schedules) {
          const schedDateStr = dueDateToStr(schedule.dueDate);
          const totalDue = safeNum(schedule.totalDue);
          const totalPaid = safeNum(schedule.totalPaid);
          const pendingAmount = totalDue - totalPaid;
          const ledgerPaid = ledgerPaidBySchedule.get(schedule.id) ?? ZERO_PAID;
          const principalRemaining = Math.max(0, safeNum(schedule.principalDue) - ledgerPaid.principal);
          const interestRemaining = Math.max(0, safeNum(schedule.interestDue) - ledgerPaid.interest);
          const savingsRemaining = Math.max(0, safeNum(schedule.savingsDue) - safeNum(schedule.savingsPaid));

          // A demand-day installment must still be evaluated when it is already fully paid: its Current
          // Demand is the day's target net of advance only, not of what is collected today.
          if (pendingAmount <= 0 && savingsRemaining <= 0 && schedDateStr !== effectiveCutoffYmd) continue;

          if (pendingAmount > 0) {
            // Add to loanOS
            loanLoanOS += pendingAmount;
            loanHasDue = true;
            loanDueInstallmentSum += schedule.installmentNo;
            loanDueCount++;
          }

          if (schedDateStr > effectiveCutoffYmd) continue; // not yet due

          const breakdown = classifyDemandBreakdown({
            principalRemaining,
            interestRemaining,
            feesRemaining: 0,
            penaltiesRemaining: 0,
            isOverdue: schedDateStr < effectiveCutoffYmd,
          });

          if (schedDateStr === effectiveCutoffYmd) {
            // Demand total is principal + interest only — savings/loan-advance is
            // tracked and shown separately via loanAdvanceDemand, so it must not
            // also be folded into this figure (would double-count it on screen).
            // Net of advance paid on earlier days; same-day collections are not subtracted.
            const netDemand = netCurrentDemand(
              { principalDue: safeNum(schedule.principalDue), interestDue: safeNum(schedule.interestDue) },
              advancePaidBySchedule.get(schedule.id) ?? ZERO_PAID
            );
            demand += netDemand.principal + netDemand.interest;
            demandPrincipal += netDemand.principal;
            demandInterest += netDemand.interest;
            savingsDemand += savingsRemaining;
            loanAdvanceDemand += savingsRemaining;
          } else {
            // Same principal+interest-only rule as demand above — savings arrear
            // is tracked separately and must not inflate this total.
            arrear += breakdown.arrearPrincipal + breakdown.arrearInterest;
            arrearPrincipal += breakdown.arrearPrincipal;
            arrearInterest += breakdown.arrearInterest;
            savingsArrear += savingsRemaining;
            const schedDate = new Date(schedule.dueDate);
            const daysOverdue = differenceInCalendarDays(referenceDate, schedDate);
            if (daysOverdue > maxDaysOverdue) {
              maxDaysOverdue = daysOverdue;
            }
          }
        }
        loanOS += loanLoanOS;

        if (loanHasDue) {
          totalDueLoans++;
          totalDueInstallments += loanDueCount > 0 ? Math.round(loanDueInstallmentSum / loanDueCount) : 0;
        }
      }
    }

    const wb = maxDaysOverdue > 0 ? Math.ceil(maxDaysOverdue / 7) : 0;
    const dueNo = totalDueLoans > 0 ? Math.round(totalDueInstallments / totalDueLoans) : 0;
    const collected = collectedMap.get(center.id) || 0;

    return {
      centerId: center.id,
      centerName: `${center.code} - ${center.name}`,
      phone: '',
      noOfClients,
      wb,
      app,
      dueNo,
      meetingTime: center.meetingTime || '',
      loanOS: Math.round(loanOS),
      arrear: Math.round(arrear),
      arrearPrincipal: Math.round(arrearPrincipal),
      arrearInterest: Math.round(arrearInterest),
      demand: Math.round(demand),
      demandPrincipal: Math.round(demandPrincipal),
      demandInterest: Math.round(demandInterest),
      savingsArrear: Math.round(savingsArrear),
      savingsDemand: Math.round(savingsDemand),
      loanAdvanceDemand: Math.round(loanAdvanceDemand),
      loanAdvanceOS: Math.round(loanAdvanceOS),
      collected: Math.round(collected),
      clSignature: '',
    };
  });
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTWISE TABLE DATA
// ═══════════════════════════════════════════════════════════════════════════════
export async function getDemandSheetClientWiseTableData(
  dateStr: string,
  fdoId: string,
  branchId?: string
): Promise<DemandClientTableRow[]> {
  const auth = await resolveAuthWithBranchOverride(branchId);
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);
  const centerWhere = await resolveDemandSheetCenterWhere(dateStr, fdoId, auth, dayStart, dayEnd);
  return computeDemandSheetClientWiseTableData(dateStr, centerWhere, dayStart, dayEnd);
}

/**
 * Cookie-free variant of getDemandSheetClientWiseTableData() above, for the Request
 * Report queue adapter (app/lib/reports/report-registry.ts) — mirrors how
 * getDemandSheetDataForQueue() was ported for the Centerwise sheet.
 */
export async function getDemandSheetClientWiseTableDataForQueue(
  dateStr: string,
  fdoId: string,
  branchIds: string[] | null
): Promise<DemandClientTableRow[]> {
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);
  const centerWhere = await resolveDemandSheetCenterWhereForBranches(dateStr, fdoId, branchIds, dayStart, dayEnd);
  return computeDemandSheetClientWiseTableData(dateStr, centerWhere, dayStart, dayEnd);
}

async function computeDemandSheetClientWiseTableData(
  dateStr: string,
  centerWhere: Prisma.CenterWhereInput,
  dayStart: Date,
  dayEnd: Date
): Promise<DemandClientTableRow[]> {
  const centers = await prisma.center.findMany({
    where: centerWhere,
    include: {
      branch: { select: { code: true, name: true } },
      fdo: { select: { firstName: true, lastName: true } },
      clients: {
        where: { isActive: true },
        include: {
          loanApplications: {
            where: { isActive: true, disbursementStatus: 'DISBURSED', NOT: { deathMarking: { some: { isReversed: false, demandRequired: false } } } },
            include: {
              schedules: {
                orderBy: { dueDate: 'asc' }
              },
              loanProduct: { select: { productName: true } },
              funder: { select: { funderName: true } },
            },
          },
        },
      },
    },
    orderBy: { code: 'asc' },
  });

  const centerIds = centers.map(c => c.id);
  const allClientCuids: string[] = [];
  for (const center of centers) {
    for (const client of center.clients) {
      allClientCuids.push(client.id);
    }
  }

  const collectedOr: Prisma.LoanTransactionWhereInput[] = [
    ...(centerIds.length > 0 ? [{ centerId: { in: centerIds } }] : []),
    ...(allClientCuids.length > 0 ? [{ clientId: { in: allClientCuids } }] : []),
  ];

  const collectionTxnsForClients = collectedOr.length > 0
    ? await prisma.loanTransaction.findMany({
        where: demandSheetRepaymentOnDateWhere(dayStart, dayEnd, collectedOr),
        select: { clientId: true, amount: true },
      })
    : [];

  const clientCollectedMap = new Map<string, number>();
  for (const t of collectionTxnsForClients) {
    const add = safeNum(t.amount);
    clientCollectedMap.set(t.clientId, (clientCollectedMap.get(t.clientId) ?? 0) + add);
  }

  // Group membership — one lookup covering every relevant client, keyed by
  // clientId (a client's first group membership wins if they somehow belong
  // to more than one, matching how the rest of the sheet treats "one group").
  const groupMembers = allClientCuids.length > 0
    ? await prisma.groupMember.findMany({
        where: { clientId: { in: allClientCuids } },
        select: { clientId: true, group: { select: { name: true, code: true } } },
      })
    : [];
  const groupNameByClient = new Map<string, string>();
  for (const gm of groupMembers) {
    if (groupNameByClient.has(gm.clientId)) continue;
    groupNameByClient.set(gm.clientId, gm.group.code ? `${gm.group.code} - ${gm.group.name}` : gm.group.name);
  }

  // Full collection picture for the day — unlike collectionTxnsForClients above
  // (loan P+I demand collection only, used for the legacy `collected` field),
  // this also includes PRECLOSURE and SAVINGS_COLLECTION so "Current Demand Coll
  // Amount" reflects everything actually collected from the member that meeting
  // (loan + loan advance/savings together) — this is a field collection sheet,
  // not the loan-only accounting figures used on the dashboard. Keyed by loanId
  // (always present on these transaction types) so multi-loan clients don't
  // conflate collections across their different loans.
  const allTxnsForDate = collectedOr.length > 0
    ? await prisma.loanTransaction.findMany({
        where: {
          transactionDate: { gte: dayStart, lte: dayEnd },
          status: { in: [TransactionStatus.APPROVED, TransactionStatus.PENDING] },
          isReversed: false,
          type: { in: ['REPAYMENT', 'PRECLOSURE', 'SAVINGS_COLLECTION'] } as any,
          OR: collectedOr,
        },
        select: { loanId: true, amount: true, type: true, collectionType: true, transactionDate: true },
        orderBy: { transactionDate: 'asc' },
      })
    : [];

  type LoanCollectionAgg = { total: number; lastDate: Date | null; status: string };
  const loanCollectionAggMap = new Map<string, LoanCollectionAgg>();
  for (const t of allTxnsForDate) {
    const prev = loanCollectionAggMap.get(t.loanId) ?? { total: 0, lastDate: null, status: '' };
    prev.total += safeNum(t.amount);
    if (!prev.lastDate || t.transactionDate > prev.lastDate) prev.lastDate = t.transactionDate;
    if (t.type === 'PRECLOSURE') {
      prev.status = 'Preclose';
    } else if (prev.status !== 'Preclose') {
      if (t.type === 'REPAYMENT' && t.collectionType === 'Non Demand Collection') {
        prev.status = 'Advance';
      } else if (!prev.status || prev.status === 'Demand') {
        prev.status = 'Demand';
      }
    }
    loanCollectionAggMap.set(t.loanId, prev);
  }

  // Reconcile the arrear cutoff against each branch's real EOD-processed working date
  // (only when viewing "today" — see resolveDemandSheetEffectiveCutoffYmd), and batch-fetch
  // ledger-derived paid amounts for every schedule so a stale cached
  // principalPaid/interestPaid can't understate Arrear OS. See computeDemandSheetData for
  // the identical pattern.
  const todayYmd = getKolkataCalendarYmd(new Date());
  const branchWorkingYmdMap = await resolveBranchWorkingYmdMap(centers.map(c => c.branchId), dateStr, todayYmd);
  const effectiveCutoffYmdByBranch = new Map<string, string>();
  for (const branchId of new Set(centers.map(c => c.branchId))) {
    effectiveCutoffYmdByBranch.set(
      branchId,
      resolveDemandSheetEffectiveCutoffYmd(dateStr, todayYmd, branchWorkingYmdMap.get(branchId) ?? null)
    );
  }

  const scheduleIdsByCutoffExclusiveYmd = new Map<string, string[]>();
  // Schedules due ON the demand day, keyed by that day: the exclusive bound makes the ledger lookup return
  // only payments made on EARLIER days (advance), which is what reduces the day's Current Demand.
  const advanceDueDayIdsByCutoffYmd = new Map<string, string[]>();
  for (const center of centers) {
    const effectiveCutoffYmd = effectiveCutoffYmdByBranch.get(center.branchId) ?? dateStr;
    const cutoffExclusiveYmd = addCalendarDaysToYmd(effectiveCutoffYmd, 1);
    const ids = scheduleIdsByCutoffExclusiveYmd.get(cutoffExclusiveYmd) ?? [];
    const dueDayIds = advanceDueDayIdsByCutoffYmd.get(effectiveCutoffYmd) ?? [];
    for (const client of center.clients) {
      for (const loan of client.loanApplications) {
        for (const schedule of loan.schedules) {
          ids.push(schedule.id);
          if (dueDateToStr(schedule.dueDate) === effectiveCutoffYmd) dueDayIds.push(schedule.id);
        }
      }
    }
    scheduleIdsByCutoffExclusiveYmd.set(cutoffExclusiveYmd, ids);
    advanceDueDayIdsByCutoffYmd.set(effectiveCutoffYmd, dueDayIds);
  }
  const ledgerPaidBySchedule = await getLedgerPaidByScheduleBatched(scheduleIdsByCutoffExclusiveYmd);
  const advancePaidBySchedule = await getLedgerPaidByScheduleBatched(advanceDueDayIdsByCutoffYmd);

  type LoanRowValues = {
    loanId: string;
    approvedLevel2At: string;
    productName: string;
    funderName: string;
    loanAmount: number;
    loanAmountInterest: number;
    loanAmountTotal: number;
    loanOS: number;
    loanOSPrincipal: number;
    loanOSInterest: number;
    curDue: number;
    collDue: number;
    demand: number;
    demandPrincipal: number;
    demandInterest: number;
    arrear: number;
    arrearPrincipal: number;
    arrearInterest: number;
    savingsArrear: number;
    savingsDemand: number;
    loanAdvanceDemand: number;
    totalDemandAmount: number;
    currentDemandCollAmount: number;
    collectionDate: string;
    collectionStatus: string;
  };

  const rows: DemandClientTableRow[] = [];
  for (const center of centers) {
    const centerName = `${center.code} - ${center.name}`;
    const meetingTime = center.meetingTime || '';
    const effectiveCutoffYmd = effectiveCutoffYmdByBranch.get(center.branchId) ?? dateStr;
    for (const client of center.clients) {
      const activeLoans = client.loanApplications?.filter(
        l => l.isActive && l.disbursementStatus === 'DISBURSED'
      ) ?? [];
      if (activeLoans.length === 0) {
        continue;
      }
      const clientLoanAdvanceOS = safeNum((client as any).loanAdvance);

      // Per-loan values (one entry per active loan) plus client-level totals
      // (used only to decide whether this client should appear at all).
      const loanRows: LoanRowValues[] = [];
      let clientDemand = 0;
      let clientArrear = 0;
      let clientSavingsArrear = 0;
      let clientSavingsDemand = 0;

      for (const loan of activeLoans) {
        let loanOSPrincipal = 0;
        let loanOSInterest = 0;
        let loanDemand = 0;
        let loanDemandPrincipal = 0;
        let loanDemandInterest = 0;
        let loanArrear = 0;
        let loanArrearPrincipal = 0;
        let loanArrearInterest = 0;
        let loanSavingsArrear = 0;
        let loanSavingsDemand = 0;
        let loanLoanAdvanceDemand = 0;

        // Loan OS = outstanding principal + outstanding interest only (excludes
        // the savings/loan-advance portion of each installment — see the matching
        // fix in getDemandSheetClientWiseCenterReport for why: totalDue-totalPaid
        // conflates the EMI due with the separately-tracked savings/advance due).
        for (const schedule of loan.schedules) {
          const ledgerPaidOS = ledgerPaidBySchedule.get(schedule.id) ?? ZERO_PAID;
          const principalPendingOS = safeNum(schedule.principalDue) - ledgerPaidOS.principal;
          const interestPendingOS = safeNum(schedule.interestDue) - ledgerPaidOS.interest;
          if (principalPendingOS > 0) loanOSPrincipal += principalPendingOS;
          if (interestPendingOS > 0) loanOSInterest += interestPendingOS;
        }

        for (const schedule of loan.schedules) {
          const schedDateStr = dueDateToStr(schedule.dueDate);

          if (schedDateStr === effectiveCutoffYmd) {
            // Current Demand is the day's target: the installment's principalDue/interestDue
            // minus advance already paid on EARLIER days. Collections made today are NOT
            // subtracted (that's the day's collection against this target), so an installment
            // paid today still shows its demand; one fully paid ahead shows 0.
            // Savings/loan-advance is tracked and shown separately via
            // loanAdvanceDemand, so it must not also be folded in here (would
            // double-count it on screen).
            const netDemand = netCurrentDemand(
              { principalDue: safeNum(schedule.principalDue), interestDue: safeNum(schedule.interestDue) },
              advancePaidBySchedule.get(schedule.id) ?? ZERO_PAID
            );
            const principalDueAmt = netDemand.principal;
            const interestDueAmt = netDemand.interest;
            const savingsDueAmt = safeNum(schedule.savingsDue);
            loanDemand += principalDueAmt + interestDueAmt;
            loanDemandPrincipal += principalDueAmt;
            loanDemandInterest += interestDueAmt;
            loanSavingsDemand += savingsDueAmt;
            loanLoanAdvanceDemand += savingsDueAmt;
          } else if (schedDateStr < effectiveCutoffYmd) {
            // Arrear is the still-outstanding balance from a PAST due date — once
            // paid off it's no longer an arrear, so (unlike current demand above)
            // this stays based on the unpaid remainder, derived from the ledger
            // (LoanTransactionLine) rather than the cached principalPaid/interestPaid
            // fields, which can drift from the approved-transaction history.
            const ledgerPaid = ledgerPaidBySchedule.get(schedule.id) ?? ZERO_PAID;
            const principalRemaining = Math.max(0, safeNum(schedule.principalDue) - ledgerPaid.principal);
            const interestRemaining = Math.max(0, safeNum(schedule.interestDue) - ledgerPaid.interest);
            const savingsRemaining = Math.max(0, safeNum(schedule.savingsDue) - safeNum(schedule.savingsPaid));
            if (principalRemaining <= 0 && interestRemaining <= 0 && savingsRemaining <= 0) continue;

            // Same principal+interest-only rule as demand above — savings arrear
            // is tracked separately and must not inflate this total.
            loanArrear += principalRemaining + interestRemaining;
            loanArrearPrincipal += principalRemaining;
            loanArrearInterest += interestRemaining;
            loanSavingsArrear += savingsRemaining;
          }
        }

        clientDemand += loanDemand;
        clientArrear += loanArrear;
        clientSavingsArrear += loanSavingsArrear;
        clientSavingsDemand += loanSavingsDemand;

        // BM final disbursement is the true "disbursed" moment for most loans
        // (disbursedLevel1At is often null once a loan reaches BM disbursement —
        // it only carries a date for the older Level-1-only flow), so it must be
        // checked first or "Disb Date" shows blank for the common case.
        const disbursedAtRaw = loan.disbursedByBMAt ?? loan.disbursedLevel1At;
        const disbursedAt = disbursedAtRaw ? new Date(disbursedAtRaw) : null;

        // Cur Due = installment number due today (falls back to "next unpaid
        // installment" for arrear-only rows with nothing due today); Coll Dues =
        // how many installments are already fully paid off.
        const todaySchedule = loan.schedules.find((s) => dueDateToStr(s.dueDate) === dateStr);
        const paidInstallmentCount = loan.schedules.filter((s) => s.status === ScheduleStatus.PAID).length;
        const curDue = todaySchedule ? todaySchedule.installmentNo : paidInstallmentCount + 1;

        const loanAmount = safeNum(loan.amount);
        const loanAmountInterest = loan.schedules.reduce((sum, s) => sum + safeNum(s.interestDue), 0);

        const collAgg = loanCollectionAggMap.get(loan.id);

        loanRows.push({
          loanId: loan.loanNumber,
          approvedLevel2At: formatDateFull(disbursedAt),
          productName: loan.loanProduct?.productName ?? '-',
          funderName: loan.funder?.funderName ?? 'Own Fund',
          loanAmount: Math.round(loanAmount),
          loanAmountInterest: Math.round(loanAmountInterest),
          loanAmountTotal: Math.round(loanAmount + loanAmountInterest),
          loanOS: Math.round(loanOSPrincipal + loanOSInterest),
          loanOSPrincipal: Math.round(loanOSPrincipal),
          loanOSInterest: Math.round(loanOSInterest),
          curDue,
          collDue: paidInstallmentCount,
          demand: Math.round(loanDemand),
          demandPrincipal: Math.round(loanDemandPrincipal),
          demandInterest: Math.round(loanDemandInterest),
          arrear: Math.round(loanArrear),
          arrearPrincipal: Math.round(loanArrearPrincipal),
          arrearInterest: Math.round(loanArrearInterest),
          savingsArrear: Math.round(loanSavingsArrear),
          savingsDemand: Math.round(loanSavingsDemand),
          loanAdvanceDemand: Math.round(loanLoanAdvanceDemand),
          // Total Demand Amount = Demand Total + Loan Savings (Arrear is shown as
          // its own column and deliberately excluded from this total).
          totalDemandAmount: Math.round(loanDemand + loanLoanAdvanceDemand),
          currentDemandCollAmount: Math.round(collAgg?.total ?? 0),
          collectionDate: formatDateTimeIst(collAgg?.lastDate ?? null),
          collectionStatus: collAgg?.status || 'Not Collected',
        });
      }

      const collected = Math.round(clientCollectedMap.get(client.id) || 0);
      const hasDues = clientDemand + clientArrear + clientSavingsArrear + clientSavingsDemand > 0;
      if (!hasDues && collected <= 0) {
        continue;
      }

      const clientName = formatClientName(client.firstName, client.lastName);
      const branchName = `${center.branch.code} - ${center.branch.name}`;
      const officerName = center.fdo
        ? formatClientName(center.fdo.firstName, center.fdo.lastName)
        : '-';
      const groupName = groupNameByClient.get(client.id) ?? '-';
      loanRows.forEach((loan, idx) => {
        rows.push({
          clientId: client.clientId,
          clientDbId: client.id,
          clientName,
          memberPhone: client.phone ?? '-',
          loanId: loan.loanId,
          branchName,
          centerId: center.id,
          centerName,
          groupName,
          productName: loan.productName,
          funderName: loan.funderName,
          meetingTime,
          approvedLevel2At: loan.approvedLevel2At,
          loanAmount: loan.loanAmount,
          loanAmountInterest: loan.loanAmountInterest,
          loanAmountTotal: loan.loanAmountTotal,
          loanOS: loan.loanOS,
          loanOSPrincipal: loan.loanOSPrincipal,
          loanOSInterest: loan.loanOSInterest,
          curDue: loan.curDue,
          collDue: loan.collDue,
          demandDate: formatDateFull(parseKolkataAttendanceDateYmd(dateStr)),
          demand: loan.demand,
          demandPrincipal: loan.demandPrincipal,
          demandInterest: loan.demandInterest,
          arrear: loan.arrear,
          arrearPrincipal: loan.arrearPrincipal,
          arrearInterest: loan.arrearInterest,
          savingsArrear: loan.savingsArrear,
          savingsDemand: loan.savingsDemand,
          loanAdvanceDemand: loan.loanAdvanceDemand,
          loanAdvanceOS: Math.round(clientLoanAdvanceOS),
          totalDemandAmount: loan.totalDemandAmount,
          officerName,
          // Client-level collected amount is only surfaced once, on the
          // client's first loan row, so summing the column doesn't double-count.
          collected: idx === 0 ? collected : 0,
          currentDemandCollAmount: loan.currentDemandCollAmount,
          collectionDate: loan.collectionDate,
          collectionStatus: loan.collectionStatus,
        });
      });
    }
  }
  
  rows.sort((a, b) => {
    const byCenter = a.centerName.localeCompare(b.centerName);
    if (byCenter !== 0) return byCenter;
    return compareMemberIds(a.clientId, b.clientId) || a.clientName.localeCompare(b.clientName);
  });
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTWISE COLLECTED TABLE DATA
// ═══════════════════════════════════════════════════════════════════════════════
export async function getDemandSheetClientWiseCollectedTableData(
  dateStr: string,
  fdoId: string
): Promise<DemandClientCollectedTableRow[]> {
  const auth = await getAuthContext();
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);
  const base = buildDemandSheetCenterBaseScope(fdoId, auth);
  
  const txns = await prisma.loanTransaction.findMany({
    where: demandSheetRepaymentOnDateWhere(dayStart, dayEnd, [
      { centerId: { not: null }, center: base },
      { centerId: null, client: { center: base } },
    ]),
    select: {
      centerId: true,
      status: true,
      amount: true,
      client: {
        select: {
          id: true,
          clientId: true,
          firstName: true,
          lastName: true,
          phone: true,
          mobileNumber: true,
          centerId: true,
        },
      },
    },
    orderBy: { transactionDate: 'asc' },
  });
  
  const centerIds = [
    ...new Set(
      txns.map(t => t.centerId ?? t.client.centerId).filter((id): id is string => Boolean(id))
    ),
  ];
  
  const centers = centerIds.length > 0
    ? await prisma.center.findMany({
        where: { id: { in: centerIds }, ...base },
        select: { id: true, code: true, name: true, meetingTime: true },
      })
    : [];
  
  const centerMeta = new Map(
    centers.map(c => [c.id, { centerName: `${c.code} - ${c.name}`, meetingTime: c.meetingTime || '' }])
  );
  
  const byKey = new Map<
    string,
    { clientDbId: string; clientId: string; clientName: string; centerId: string; collectedApproved: number; collectedPending: number; }
  >();
  
  for (const t of txns) {
    const resolvedCenterId = t.centerId ?? t.client.centerId;
    if (!resolvedCenterId) continue;
    const key = `${resolvedCenterId}:${t.client.id}`;
    const prev = byKey.get(key) ?? {
      clientDbId: t.client.id,
      clientId: t.client.clientId,
      clientName: formatClientName(t.client.firstName, t.client.lastName),
      centerId: resolvedCenterId,
      collectedApproved: 0,
      collectedPending: 0,
    };
    const add = safeNum(t.amount);
    if (t.status === TransactionStatus.APPROVED) prev.collectedApproved += add;
    if (t.status === TransactionStatus.PENDING) prev.collectedPending += add;
    byKey.set(key, prev);
  }
  
  const rows: DemandClientCollectedTableRow[] = [];
  for (const agg of byKey.values()) {
    const meta = centerMeta.get(agg.centerId);
    if (!meta) continue;
    const collectedApproved = Math.round(agg.collectedApproved);
    const collectedPending = Math.round(agg.collectedPending);
    const collectedTotal = Math.round(agg.collectedApproved + agg.collectedPending);
    if (collectedTotal <= 0) continue;
    rows.push({
      clientId: agg.clientId,
      clientDbId: agg.clientDbId,
      clientName: agg.clientName,
      centerId: agg.centerId,
      centerName: meta.centerName,
      meetingTime: meta.meetingTime,
      collectedApproved,
      collectedPending,
      collectedTotal,
    });
  }
  
  rows.sort((a, b) => {
    const byCenter = a.centerName.localeCompare(b.centerName);
    if (byCenter !== 0) return byCenter;
    return compareMemberIds(a.clientId, b.clientId) || a.clientName.localeCompare(b.clientName);
  });
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTWISE CENTER REPORT (detailed dialog per center)
// ═══════════════════════════════════════════════════════════════════════════════
/** Shared center-with-clients fetch for both getDemandSheetClientWiseCenterReport
 * and its ForQueue counterpart, so the include shape can't drift between them. */
async function fetchCenterForClientWiseReport(centerId: string) {
  return prisma.center.findUnique({
    where: { id: centerId },
    include: {
      branch: { select: { code: true, name: true } },
      clients: {
        where: { isActive: true },
        include: {
          loanApplications: {
            where: { isActive: true, disbursementStatus: 'DISBURSED', NOT: { deathMarking: { some: { isReversed: false, demandRequired: false } } } },
            include: {
              schedules: {
                orderBy: { dueDate: 'asc' }
              }
            },
          },
        },
      },
    },
  });
}

type CenterForClientWiseReport = NonNullable<Awaited<ReturnType<typeof fetchCenterForClientWiseReport>>>;

/**
 * Pure report computation shared by getDemandSheetClientWiseCenterReport (session-based,
 * used by the "Detailed report" dialog) and getDemandSheetClientWiseCenterReportForQueue
 * (branch-array-based, used by the Request Report background worker) — auth/scope
 * resolution differs between the two callers, but once a center has been fetched and
 * confirmed eligible for the date, the report itself is identical either way.
 */
async function computeDemandSheetClientWiseCenterReport(
  center: CenterForClientWiseReport,
  dateStr: string,
  fdoId: string
): Promise<DemandClientWiseReportData> {
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);

  // Get FDO name
  let fdoName = '';
  if (fdoId && fdoId !== 'all') {
    const fdoUser = await prisma.user.findUnique({
      where: { id: fdoId },
      select: { firstName: true, lastName: true },
    });
    fdoName = fdoUser ? formatClientName(fdoUser.firstName, fdoUser.lastName) : '';
  } else if (center.fdoId) {
    const fdoUser = await prisma.user.findUnique({
      where: { id: center.fdoId },
      select: { firstName: true, lastName: true },
    });
    fdoName = fdoUser ? formatClientName(fdoUser.firstName, fdoUser.lastName) : '';
  }
  
  const meetingDay = center.meetingDay || getMeetingDayName(dateStr);
  const meetingTime = center.meetingTime || '';
  const meetingDate = formatMeetingDate(dateStr);
  
  // Get collections
  const clientCuids = center.clients.map(c => c.id);
  const centerIdsSingle = [center.id];
  const collectedOrCenter: Prisma.LoanTransactionWhereInput[] = [
    { centerId: { in: centerIdsSingle } },
    ...(clientCuids.length > 0 ? [{ clientId: { in: clientCuids } }] : []),
  ];
  
  const collectionTxnsForCenter = collectedOrCenter.length > 0
    ? await prisma.loanTransaction.findMany({
        where: demandSheetRepaymentOnDateWhere(dayStart, dayEnd, collectedOrCenter),
        select: { clientId: true, amount: true },
      })
    : [];
  
  const collectedOnDateMap = new Map<string, number>();
  for (const t of collectionTxnsForCenter) {
    const add = safeNum(t.amount);
    collectedOnDateMap.set(t.clientId, (collectedOnDateMap.get(t.clientId) ?? 0) + add);
  }

  // "Coll Amount" on the sheet is everything actually collected from the member
  // that meeting — loan (P+I) AND savings/loan-advance together, unlike
  // collectedOnDateMap above (loan-only, kept for the legacy `collected` field).
  // Keyed by loanId (always present on these transaction types) so a multi-loan
  // client's collections don't get conflated across their different loans.
  const collectionTxnsWithSavings = collectedOrCenter.length > 0
    ? await prisma.loanTransaction.findMany({
        where: {
          transactionDate: { gte: dayStart, lte: dayEnd },
          status: { in: [TransactionStatus.APPROVED, TransactionStatus.PENDING] },
          isReversed: false,
          type: { in: ['REPAYMENT', 'PRECLOSURE', 'SAVINGS_COLLECTION'] } as any,
          OR: collectedOrCenter,
        },
        select: { loanId: true, amount: true },
      })
    : [];
  const loanCollectedWithSavingsMap = new Map<string, number>();
  for (const t of collectionTxnsWithSavings) {
    const add = safeNum(t.amount);
    loanCollectedWithSavingsMap.set(t.loanId, (loanCollectedWithSavingsMap.get(t.loanId) ?? 0) + add);
  }

  const collectedUpTo = clientCuids.length > 0
    ? await prisma.loanTransaction.groupBy({
        by: ['clientId'],
        where: {
          clientId: { in: clientCuids },
          ...COLLECTED_REPAYMENT_BASE,
          transactionDate: { lte: dayEnd },
        },
        _sum: { amount: true },
      })
    : [];
  
  const collectedTillDateMap = new Map<string, number>(
    collectedUpTo.map(g => [g.clientId, safeNum(g._sum?.amount)])
  );
  
  type LoanReportRowValues = {
    loanId: string;
    approvedLevel2At: string;
    loanAmount: number;
    loanOS: number;
    loanOSPrincipal: number;
    loanOSInterest: number;
    currentDueNo: number;
    collectionDueNo: number;
    dues: number;
    arrear: number;
    arrearPrincipal: number;
    arrearInterest: number;
    currentDemand: number;
    currentDemandPrincipal: number;
    currentDemandInterest: number;
    totalDemand: number;
    savingsArrear: number;
    savingsDemand: number;
    loanAdvanceDemand: number;
    totalDemandAmount: number;
    collectedIncludingSavings: number;
  };

  // Reconcile the arrear cutoff against this branch's real EOD-processed working date
  // (only when viewing "today" — see resolveDemandSheetEffectiveCutoffYmd), and batch-fetch
  // ledger-derived paid amounts for every schedule in this center so a stale cached
  // principalPaid/interestPaid can't understate Arrear OS. See computeDemandSheetData for
  // the identical (multi-branch) pattern — this modal is always scoped to one center/branch.
  const todayYmd = getKolkataCalendarYmd(new Date());
  const branchWorkingYmdMap = await resolveBranchWorkingYmdMap([center.branchId], dateStr, todayYmd);
  const effectiveCutoffYmd = resolveDemandSheetEffectiveCutoffYmd(
    dateStr,
    todayYmd,
    branchWorkingYmdMap.get(center.branchId) ?? null
  );
  const cutoffExclusiveYmd = addCalendarDaysToYmd(effectiveCutoffYmd, 1);
  const allScheduleIds: string[] = [];
  const dueDayScheduleIds: string[] = [];
  for (const client of center.clients) {
    for (const loan of client.loanApplications) {
      for (const schedule of loan.schedules) {
        allScheduleIds.push(schedule.id);
        if (dueDateToStr(schedule.dueDate) === effectiveCutoffYmd) dueDayScheduleIds.push(schedule.id);
      }
    }
  }
  const ledgerPaidBySchedule = await getLedgerPaidByScheduleBatched(
    new Map([[cutoffExclusiveYmd, allScheduleIds]])
  );
  // Advance = paid on days before the demand day (exclusive bound is the cutoff day itself).
  const advancePaidBySchedule = await getLedgerPaidByScheduleBatched(
    new Map([[effectiveCutoffYmd, dueDayScheduleIds]])
  );

  // Build client rows with CORRECT loanOS calculation from schedules
  const reportClientsUnsorted: Omit<DemandClientWiseReportClientRow, 'cid'>[] = [];

  for (const client of center.clients) {
    const activeLoans = client.loanApplications?.filter(
      l => l.isActive && l.disbursementStatus === 'DISBURSED'
    ) ?? [];
    if (activeLoans.length === 0) {
      continue;
    }

    const clientLoanAdvanceOS = safeNum((client as any).loanAdvance);
    const clientCollectedMeetingDate = collectedOnDateMap.get(client.id) || 0;
    const clientCollectedTillDate = collectedTillDateMap.get(client.id) || 0;

    // Per-loan values (one entry per active loan) plus client-level totals
    // (used only to decide whether this client should appear at all).
    const loanRows: LoanReportRowValues[] = [];
    let clientCurrentDemand = 0;
    let clientArrearDemand = 0;
    let clientSavingsArrear = 0;
    let clientSavingsDemand = 0;

    for (const loan of activeLoans) {
      let loanOSPrincipal = 0;
      let loanOSInterest = 0;
      let dues = 0;
      let currentDemand = 0;
      let currentDemandPrincipal = 0;
      let currentDemandInterest = 0;
      let arrearDemand = 0;
      let arrearDemandPrincipal = 0;
      let arrearDemandInterest = 0;
      let loanSavingsArrear = 0;
      let loanSavingsDemand = 0;
      let loanAdvanceDemand = 0;
      let currentDueNo = 0;
      let collectedDueNo = 0;

      // Loan OS = outstanding principal + outstanding interest only, across every
      // remaining installment for the full loan term — deliberately excludes the
      // savings/loan-advance portion of each installment (that's tracked and shown
      // separately via loanAdvanceDemand/loanAdvanceOS), so it doesn't inflate OS
      // with an amount that isn't part of the loan's principal+interest balance.
      for (const schedule of loan.schedules) {
        const ledgerPaidOS = ledgerPaidBySchedule.get(schedule.id) ?? ZERO_PAID;
        const principalPending = safeNum(schedule.principalDue) - ledgerPaidOS.principal;
        const interestPending = safeNum(schedule.interestDue) - ledgerPaidOS.interest;

        if (principalPending > 0) loanOSPrincipal += principalPending;
        if (interestPending > 0) loanOSInterest += interestPending;
      }
      const loanOS = loanOSPrincipal + loanOSInterest;

      // BM final disbursement is the true "disbursed" moment for most loans
      // (disbursedLevel1At is often null once a loan reaches BM disbursement).
      const disbursedAtRaw = loan.disbursedByBMAt ?? loan.disbursedLevel1At;
      const disbursedAt = disbursedAtRaw ? new Date(disbursedAtRaw) : null;

      // Calculate demands based on due dates
      for (const schedule of loan.schedules) {
        const schedDateStr = dueDateToStr(schedule.dueDate);
        const isDueByMeetingDate = schedDateStr <= dateStr;

        if (isDueByMeetingDate) {
          currentDueNo = Math.max(currentDueNo, schedule.installmentNo);
        }

        // Use the schedule's own authoritative status, not `pending <= 0` — `pending`
        // is totalDue minus totalPaid, and totalDue includes the savings/loan-advance
        // portion of the installment. A due whose EMI (principal+interest) was fully
        // collected and paid off (status PAID) can still show pending > 0 if the
        // savings/advance slice was never collected alongside it, which under-counted
        // "Coll" (e.g. showing 0 collected dues for a client with 3 paid installments).
        if (isDueByMeetingDate && schedule.status === 'PAID') {
          collectedDueNo = Math.max(collectedDueNo, schedule.installmentNo);
        }

        if (schedDateStr === effectiveCutoffYmd) {
          // Current Demand is the day's target: principalDue/interestDue minus advance paid on
          // EARLIER days. Today's own collections are not subtracted, so an installment paid
          // today still shows its demand; one fully paid ahead shows 0.
          const netDemand = netCurrentDemand(
            { principalDue: safeNum(schedule.principalDue), interestDue: safeNum(schedule.interestDue) },
            advancePaidBySchedule.get(schedule.id) ?? ZERO_PAID
          );
          const principalDueAmt = netDemand.principal;
          const interestDueAmt = netDemand.interest;
          const savingsDueAmt = safeNum(schedule.savingsDue);
          currentDemand += principalDueAmt + interestDueAmt;
          currentDemandPrincipal += principalDueAmt;
          currentDemandInterest += interestDueAmt;
          loanSavingsDemand += savingsDueAmt;
          loanAdvanceDemand += savingsDueAmt;
          dues += 1;
        } else if (schedDateStr < effectiveCutoffYmd) {
          // Arrear is the still-outstanding balance from a PAST due date — once
          // paid off it's no longer an arrear, so (unlike current demand above)
          // this stays based on the unpaid remainder, derived from the ledger
          // (LoanTransactionLine) rather than the cached principalPaid/interestPaid
          // fields, which can drift from the approved-transaction history.
          const ledgerPaid = ledgerPaidBySchedule.get(schedule.id) ?? ZERO_PAID;
          const principalRemaining = Math.max(0, safeNum(schedule.principalDue) - ledgerPaid.principal);
          const interestRemaining = Math.max(0, safeNum(schedule.interestDue) - ledgerPaid.interest);
          const savingsRemaining = Math.max(0, safeNum(schedule.savingsDue) - safeNum(schedule.savingsPaid));
          if (principalRemaining <= 0 && interestRemaining <= 0 && savingsRemaining <= 0) continue;

          arrearDemand += principalRemaining + interestRemaining;
          arrearDemandPrincipal += principalRemaining;
          arrearDemandInterest += interestRemaining;
          loanSavingsArrear += savingsRemaining;
          dues += 1;
        }
      }

      clientCurrentDemand += currentDemand;
      clientArrearDemand += arrearDemand;
      clientSavingsArrear += loanSavingsArrear;
      clientSavingsDemand += loanSavingsDemand;

      loanRows.push({
        loanId: loan.loanNumber,
        approvedLevel2At: formatapprovedLevel2At(disbursedAt),
        loanAmount: Math.round(safeNum(loan.amount)),
        loanOS: Math.round(loanOS),
        loanOSPrincipal: Math.round(loanOSPrincipal),
        loanOSInterest: Math.round(loanOSInterest),
        currentDueNo,
        collectionDueNo: Math.min(collectedDueNo, currentDueNo),
        dues,
        arrear: Math.round(arrearDemand),
        arrearPrincipal: Math.round(arrearDemandPrincipal),
        arrearInterest: Math.round(arrearDemandInterest),
        currentDemand: Math.round(currentDemand),
        currentDemandPrincipal: Math.round(currentDemandPrincipal),
        currentDemandInterest: Math.round(currentDemandInterest),
        totalDemand: Math.round(currentDemand + arrearDemand),
        savingsArrear: Math.round(loanSavingsArrear),
        savingsDemand: Math.round(loanSavingsDemand),
        loanAdvanceDemand: Math.round(loanAdvanceDemand),
        // Total Demand Amount = Current Demand Total + Loan Savings Due — Arrear
        // is its own column and deliberately excluded from this total.
        totalDemandAmount: Math.round(currentDemand + loanAdvanceDemand),
        collectedIncludingSavings: Math.round(loanCollectedWithSavingsMap.get(loan.id) ?? 0),
      });
    }

    const hasDues = clientCurrentDemand + clientArrearDemand + clientSavingsArrear + clientSavingsDemand > 0;

    if (!hasDues && clientCollectedMeetingDate <= 0) {
      continue;
    }

    const clientId = client.clientId;
    const clientName = formatClientName(client.firstName, client.lastName);
    const mobileNumber = client.mobileNumber || client.phone || '';

    loanRows.forEach((loan, idx) => {
      reportClientsUnsorted.push({
        clientId,
        clientName,
        loanId: loan.loanId,
        mobileNumber,
        approvedLevel2At: loan.approvedLevel2At,
        loanAmount: loan.loanAmount,
        loanOS: loan.loanOS,
        loanOSPrincipal: loan.loanOSPrincipal,
        loanOSInterest: loan.loanOSInterest,
        currentDueNo: loan.currentDueNo,
        collectionDueNo: loan.collectionDueNo,
        dues: loan.dues,
        arrear: loan.arrear,
        arrearPrincipal: loan.arrearPrincipal,
        arrearInterest: loan.arrearInterest,
        currentDemand: loan.currentDemand,
        currentDemandPrincipal: loan.currentDemandPrincipal,
        currentDemandInterest: loan.currentDemandInterest,
        totalDemand: loan.totalDemand,
        savingsArrear: loan.savingsArrear,
        savingsDemand: loan.savingsDemand,
        loanAdvanceDemand: loan.loanAdvanceDemand,
        // Client-level values (not additive across loans) are surfaced only
        // once, on the client's first loan row, so Grand Total sums don't
        // double-count for multi-loan clients.
        loanAdvanceOS: idx === 0 ? Math.round(clientLoanAdvanceOS) : 0,
        collected: idx === 0 ? Math.round(clientCollectedMeetingDate) : 0,
        collectedTillDate: idx === 0 ? Math.round(clientCollectedTillDate) : 0,
        totalDemandAmount: loan.totalDemandAmount,
        collectedIncludingSavings: loan.collectedIncludingSavings,
      });
    });
  }
  
  // Natural member-ID order (29-96-1-1, 29-96-1-2, ... 29-96-1-10, 29-96-2-1) — a numeric-suffix-only
  // sort ignored the group part and mis-ordered members across groups.
  reportClientsUnsorted.sort((a, b) => compareMemberIds(a.clientId, b.clientId));
  
  const reportClients: DemandClientWiseReportClientRow[] = reportClientsUnsorted.map((c, idx) => ({
    cid: `1.${idx + 1}`,
    ...c,
  }));
  
  const totals = reportClients.reduce(
    (acc, c) => {
      acc.grandTotalLoanAmount += c.loanAmount;
      acc.grandTotalLoanOS += c.loanOS;
      acc.grandTotalLoanOSPrincipal += c.loanOSPrincipal;
      acc.grandTotalLoanOSInterest += c.loanOSInterest;
      acc.grandTotalArrear += c.arrear;
      acc.grandTotalArrearPrincipal += c.arrearPrincipal;
      acc.grandTotalArrearInterest += c.arrearInterest;
      acc.grandTotalCurrentDemand += c.currentDemand;
      acc.grandTotalCurrentDemandPrincipal += c.currentDemandPrincipal;
      acc.grandTotalCurrentDemandInterest += c.currentDemandInterest;
      acc.grandTotalDemand += c.totalDemand;
      acc.grandTotalSavingsArrear += c.savingsArrear;
      acc.grandTotalSavingsDemand += c.savingsDemand;
      acc.grandTotalLoanAdvanceDemand += c.loanAdvanceDemand;
      acc.grandTotalLoanAdvanceOS += c.loanAdvanceOS;
      acc.grandTotalCollected += c.collected;
      acc.grandTotalCollectedTillDate += c.collectedTillDate;
      acc.grandTotalDemandAmount += c.totalDemandAmount;
      acc.grandTotalCollectedIncludingSavings += c.collectedIncludingSavings;
      return acc;
    },
    {
      grandTotalLoanAmount: 0,
      grandTotalLoanOS: 0,
      grandTotalLoanOSPrincipal: 0,
      grandTotalLoanOSInterest: 0,
      grandTotalArrear: 0,
      grandTotalArrearPrincipal: 0,
      grandTotalArrearInterest: 0,
      grandTotalCurrentDemand: 0,
      grandTotalCurrentDemandPrincipal: 0,
      grandTotalCurrentDemandInterest: 0,
      grandTotalDemand: 0,
      grandTotalSavingsArrear: 0,
      grandTotalSavingsDemand: 0,
      grandTotalLoanAdvanceDemand: 0,
      grandTotalLoanAdvanceOS: 0,
      grandTotalCollected: 0,
      grandTotalCollectedTillDate: 0,
      grandTotalDemandAmount: 0,
      grandTotalCollectedIncludingSavings: 0,
    }
  );

  return {
    branchCode: center.branch.code,
    branchName: center.branch.name,
    centerCode: center.code,
    centerName: center.name,
    fdoId: fdoId === 'all' ? (center.fdoId || '') : fdoId,
    fdoName,
    meetingDay,
    meetingTime,
    meetingDate,
    totalClients: reportClients.length,
    grandTotalLoanAmount: totals.grandTotalLoanAmount,
    grandTotalLoanOS: totals.grandTotalLoanOS,
    grandTotalLoanOSPrincipal: totals.grandTotalLoanOSPrincipal,
    grandTotalLoanOSInterest: totals.grandTotalLoanOSInterest,
    grandTotalArrear: totals.grandTotalArrear,
    grandTotalArrearPrincipal: totals.grandTotalArrearPrincipal,
    grandTotalArrearInterest: totals.grandTotalArrearInterest,
    grandTotalCurrentDemand: totals.grandTotalCurrentDemand,
    grandTotalCurrentDemandPrincipal: totals.grandTotalCurrentDemandPrincipal,
    grandTotalCurrentDemandInterest: totals.grandTotalCurrentDemandInterest,
    grandTotalDemand: totals.grandTotalDemand,
    grandTotalSavingsArrear: totals.grandTotalSavingsArrear,
    grandTotalSavingsDemand: totals.grandTotalSavingsDemand,
    grandTotalLoanAdvanceDemand: totals.grandTotalLoanAdvanceDemand,
    grandTotalLoanAdvanceOS: totals.grandTotalLoanAdvanceOS,
    grandTotalCollected: totals.grandTotalCollected,
    grandTotalCollectedTillDate: totals.grandTotalCollectedTillDate,
    grandTotalDemandAmount: totals.grandTotalDemandAmount,
    grandTotalCollectedIncludingSavings: totals.grandTotalCollectedIncludingSavings,
    clients: reportClients,
  };
}

export async function getDemandSheetClientWiseCenterReport(
  dateStr: string,
  fdoId: string,
  centerId: string,
  branchId?: string
): Promise<DemandClientWiseReportData> {
  const auth = await resolveAuthWithBranchOverride(branchId);
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);

  const center = await fetchCenterForClientWiseReport(centerId);

  if (!center) {
    throw new Error('Center not found');
  }

  // Authorization checks
  if ((auth?.role === 'BRANCH_MANAGER' || auth?.role === 'AREA_MANAGER') && auth.branchId && center.branchId !== auth.branchId) {
    throw new Error('Unauthorized center access');
  }
  if (auth?.role === 'FDO' && center.fdoId !== auth.userId) {
    throw new Error('Unauthorized center access');
  }

  const reportCenterWhere = await resolveDemandSheetCenterWhere(dateStr, fdoId, auth, dayStart, dayEnd);
  const eligibleForReportDate = await prisma.center.findFirst({
    where: { AND: [{ id: centerId }, reportCenterWhere] },
    select: { id: true },
  });

  if (!eligibleForReportDate) {
    throw new Error('No demand sheet for this center on the selected date');
  }

  return computeDemandSheetClientWiseCenterReport(center, dateStr, fdoId);
}

/**
 * branchIds-array variant of getDemandSheetClientWiseCenterReport() above, for callers
 * with no cookie/session AuthContext (the Request Report queue) — mirrors the
 * getDemandSheetData/getDemandSheetDataForQueue and getDemandSheetClientWiseTableData/
 * ...ForQueue pairs elsewhere in this file. `branchIds` is the caller's already-resolved,
 * pre-authorized scope (built upstream by the queue request-creation API from the
 * requester's permissions), so this only re-checks that the requested center actually
 * falls within it.
 */
export async function getDemandSheetClientWiseCenterReportForQueue(
  dateStr: string,
  fdoId: string,
  centerId: string,
  branchIds: string[] | null
): Promise<DemandClientWiseReportData> {
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);

  const center = await fetchCenterForClientWiseReport(centerId);

  if (!center) {
    throw new Error('Center not found');
  }

  if (branchIds && !branchIds.includes(center.branchId)) {
    throw new Error('Unauthorized center access');
  }

  const reportCenterWhere = await resolveDemandSheetCenterWhereForBranches(dateStr, fdoId, branchIds, dayStart, dayEnd);
  const eligibleForReportDate = await prisma.center.findFirst({
    where: { AND: [{ id: centerId }, reportCenterWhere] },
    select: { id: true },
  });

  if (!eligibleForReportDate) {
    throw new Error('No demand sheet for this center on the selected date');
  }

  return computeDemandSheetClientWiseCenterReport(center, dateStr, fdoId);
}
// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTWISE COLLECTED CENTER REPORT
// ═══════════════════════════════════════════════════════════════════════════════
export async function getDemandSheetClientWiseCollectedCenterReport(
  dateStr: string,
  fdoId: string,
  centerId: string
): Promise<DemandClientWiseCollectedReportData> {
  const auth = await getAuthContext();
  const { start: dayStart, end: dayEnd } = getDateRange(dateStr);
  const base = buildDemandSheetCenterBaseScope(fdoId, auth);
  
  const center = await prisma.center.findFirst({
    where: { id: centerId, ...base },
    select: {
      id: true,
      code: true,
      name: true,
      meetingDay: true,
      meetingTime: true,
      fdoId: true,
      branch: { select: { code: true, name: true } },
    },
  });
  
  if (!center) {
    throw new Error('Center not found');
  }
  
  const effectiveFdoId = fdoId === 'all' ? (center.fdoId || '') : fdoId;
  let fdoName = '';
  if (effectiveFdoId) {
    const fdoUser = await prisma.user.findUnique({
      where: { id: effectiveFdoId },
      select: { firstName: true, lastName: true },
    });
    fdoName = fdoUser ? formatClientName(fdoUser.firstName, fdoUser.lastName) : '';
  }
  
  const txns = await prisma.loanTransaction.findMany({
    where: demandSheetRepaymentOnDateWhere(dayStart, dayEnd, [
      { centerId },
      { centerId: null, client: { centerId } },
    ]),
    select: {
      status: true,
      amount: true,
      client: {
        select: {
          id: true,
          clientId: true,
          firstName: true,
          lastName: true,
          phone: true,
          mobileNumber: true,
        },
      },
    },
  });
  
  const byClient = new Map<string, { approved: number; pending: number; client: typeof txns[0]['client'] }>();
  for (const t of txns) {
    const prev = byClient.get(t.client.id) ?? { approved: 0, pending: 0, client: t.client };
    const add = safeNum(t.amount);
    if (t.status === TransactionStatus.APPROVED) prev.approved += add;
    if (t.status === TransactionStatus.PENDING) prev.pending += add;
    byClient.set(t.client.id, prev);
  }
  
  const unsorted = [...byClient.values()].map(v => {
    const approved = Math.round(v.approved);
    const pending = Math.round(v.pending);
    const total = Math.round(v.approved + v.pending);
    return {
      clientId: v.client.clientId,
      clientName: formatClientName(v.client.firstName, v.client.lastName),
      mobileNumber: v.client.mobileNumber || v.client.phone || '',
      collectedApproved: approved,
      collectedPending: pending,
      collectedTotal: total,
    };
  });
  
  const clients = unsorted
    .filter(r => r.collectedTotal > 0)
    .sort((a, b) => compareMemberIds(a.clientId, b.clientId) || a.clientName.localeCompare(b.clientName))
    .map((c, idx) => ({ cid: `1.${idx + 1}`, ...c }));
  
  const totals = clients.reduce(
    (acc, c) => {
      acc.approved += c.collectedApproved;
      acc.pending += c.collectedPending;
      acc.total += c.collectedTotal;
      return acc;
    },
    { approved: 0, pending: 0, total: 0 }
  );
  
  const meetingDay = center.meetingDay || getMeetingDayName(dateStr);
  const meetingTime = center.meetingTime || '';
  const meetingDate = formatMeetingDate(dateStr);
  
  return {
    branchCode: center.branch.code,
    branchName: center.branch.name,
    centerCode: center.code,
    centerName: center.name,
    fdoId: effectiveFdoId,
    fdoName,
    meetingDay,
    meetingTime,
    meetingDate,
    totalClients: clients.length,
    grandTotalCollectedApproved: totals.approved,
    grandTotalCollectedPending: totals.pending,
    grandTotalCollectedTotal: totals.total,
    clients,
  };
}

// ─── Arrear Demand Sheet ──────────────────────────────────────────────────────

export type ArrearDemandSheetRow = {
  sNo: number;
  clientId: string;
  clientName: string;
  loanId: string;
  loanDbId: string;
  arrearPrincipal: number;
  arrearInterest: number;
  feesDue: number;
  penaltiesDue: number;
  totalArrearDue: number;
  collectionDate: string;
  collectionStatus: 'Collected' | '';
  collectedAmount: number | null;
  collectionDateDisplay: string | null;
  collectionTimeDisplay: string | null;
  collectedBy: string | null;
};

export type ArrearDemandSheetMeta = {
  branchCode: string;
  branchName: string;
  centerCode: string;
  centerName: string;
  totalClients: number;
  totalArrearPrincipal: number;
  totalArrearInterest: number;
  totalFeesDue: number;
  totalPenaltiesDue: number;
  totalArrearDue: number;
};

export type ArrearDemandSheetResult = {
  rows: ArrearDemandSheetRow[];
  meta: ArrearDemandSheetMeta;
};

export async function getArrearDemandSheetData(
  arrearDateStr: string,
  centerId: string
): Promise<ArrearDemandSheetResult> {
  const ctx = await getAuthContext();
  if (!ctx) throw new Error('Unauthorized');

  const authCenter = await prisma.center.findUnique({
    where: { id: centerId },
    select: { branchId: true, fdoId: true },
  });
  if (!authCenter) throw new Error('Center not found');

  if (ctx.role === 'BRANCH_MANAGER') {
    const effectiveBranchId = ctx.branchId;
    if (!effectiveBranchId || effectiveBranchId !== authCenter.branchId) {
      throw new Error('You do not have access to this center');
    }
  }
  if (ctx.role === 'FDO' && authCenter.fdoId !== ctx.userId) {
    throw new Error('You do not have access to this center');
  }
  if (ctx.role === 'AREA_MANAGER') {
    const assignedBranchIds = await getAreaManagerBranchIds(ctx.userId);
    if (!assignedBranchIds.includes(authCenter.branchId)) {
      throw new Error('You do not have access to this center');
    }
  }

  return getArrearDemandSheetDataCore(arrearDateStr, centerId);
}

/**
 * Cookie-free core, split out of getArrearDemandSheetData() above so the Request Report
 * queue adapter (app/lib/reports/report-registry.ts) — which has no cookie/session context —
 * can call it directly after doing its own branchIds-scoped authorization check. The live
 * page's action above still does its full per-user ownership check before delegating here.
 */
export async function getArrearDemandSheetDataCore(
  arrearDateStr: string,
  centerId: string
): Promise<ArrearDemandSheetResult> {
  const arrearDate = parseKolkataAttendanceDateYmd(arrearDateStr);
  const arrearDayEndExclusive = getKolkataDayEndExclusiveUtc(arrearDate);
  const arrearCutoff = new Date(arrearDayEndExclusive.getTime() - 1);

  const center = await prisma.center.findUnique({
    where: { id: centerId },
    select: { id: true, code: true, name: true, branchId: true, fdoId: true, branch: { select: { id: true, code: true, name: true } } },
  });
  if (!center) throw new Error('Center not found');

  const loans = await prisma.loan.findMany({
    where: { centerId, isActive: true, disbursementStatus: 'DISBURSED' },
    select: {
      id: true,
      loanNumber: true,
      client: { select: { clientId: true, firstName: true, lastName: true } },
      schedules: {
        where: {
          dueDate: { lte: arrearCutoff },
          // Excludes only WAIVED/CLOSED, not PAID — see NON_OUTSTANDING_SCHEDULE_STATUSES:
          // `status` is a cached/derived field that can drift from the schedule's real
          // due-vs-paid amounts (e.g. a reversal recomputing it against a stale totalDue),
          // and excluding PAID here would silently drop that row's genuine outstanding
          // balance from the arrear total below.
          status: { notIn: NON_OUTSTANDING_SCHEDULE_STATUSES },
        },
        select: {
          principalDue: true,
          principalPaid: true,
          interestDue: true,
          interestPaid: true,
          feesDue: true,
          feesPaid: true,
          penaltiesDue: true,
          penaltiesPaid: true,
        },
      },
    },
  });

  const loanIds = loans.map(l => l.id);

  const arrearCollections = loanIds.length
    ? await prisma.loanTransaction.findMany({
        where: {
          loanId: { in: loanIds },
          collectionType: 'Arrear Collection',
          type: 'REPAYMENT',
          status: { in: ['PENDING', 'APPROVED'] as any },
          isReversed: false,
          transactionDate: { gte: arrearDate, lt: arrearDayEndExclusive },
        },
        select: {
          loanId: true,
          amount: true,
          transactionDate: true,
          collectedBy: { select: { firstName: true, lastName: true } },
        },
      })
    : [];

  const collectionMap = new Map<string, typeof arrearCollections[number]>();
  for (const tx of arrearCollections) {
    if (!collectionMap.has(tx.loanId)) collectionMap.set(tx.loanId, tx);
  }

  const rows: Omit<ArrearDemandSheetRow, 'sNo'>[] = [];
  for (const loan of loans) {
    let arrearPrincipal = 0;
    let arrearInterest = 0;
    let feesDue = 0;
    let penaltiesDue = 0;
    for (const s of loan.schedules) {
      arrearPrincipal += safeNum(s.principalDue) - safeNum(s.principalPaid);
      arrearInterest += safeNum(s.interestDue) - safeNum(s.interestPaid);
      feesDue += safeNum(s.feesDue) - safeNum(s.feesPaid);
      penaltiesDue += safeNum(s.penaltiesDue) - safeNum(s.penaltiesPaid);
    }
    arrearPrincipal = Math.max(0, Math.round(arrearPrincipal * 100) / 100);
    arrearInterest = Math.max(0, Math.round(arrearInterest * 100) / 100);
    feesDue = Math.max(0, Math.round(feesDue * 100) / 100);
    penaltiesDue = Math.max(0, Math.round(penaltiesDue * 100) / 100);
    const totalArrearDue = arrearPrincipal + arrearInterest + feesDue + penaltiesDue;
    if (totalArrearDue === 0) continue;

    const coll = collectionMap.get(loan.id) ?? null;
    let collectionDateDisplay: string | null = null;
    let collectionTimeDisplay: string | null = null;
    if (coll) {
      const ist = new Date(coll.transactionDate.getTime() + 5.5 * 60 * 60 * 1000);
      collectionDateDisplay = `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`;
      const h = ist.getUTCHours();
      const m = ist.getUTCMinutes();
      collectionTimeDisplay = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }

    rows.push({
      clientId: loan.client.clientId,
      clientName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
      loanId: loan.loanNumber,
      loanDbId: loan.id,
      arrearPrincipal,
      arrearInterest,
      feesDue,
      penaltiesDue,
      totalArrearDue,
      collectionDate: arrearDateStr,
      collectionStatus: coll ? 'Collected' : '',
      collectedAmount: coll ? Math.round(Number(coll.amount) * 100) / 100 : null,
      collectionDateDisplay,
      collectionTimeDisplay,
      collectedBy: coll?.collectedBy
        ? `${coll.collectedBy.firstName} ${coll.collectedBy.lastName}`.trim()
        : null,
    });
  }

  rows.sort((a, b) => compareMemberIds(a.clientId, b.clientId) || a.clientName.localeCompare(b.clientName) || a.loanId.localeCompare(b.loanId));
  const numbered = rows.map((r, i) => ({ ...r, sNo: i + 1 }));

  const uniqueClients = new Set(numbered.map(r => r.clientId)).size;
  const meta: ArrearDemandSheetMeta = {
    branchCode: center.branch.code,
    branchName: center.branch.name,
    centerCode: center.code,
    centerName: center.name,
    totalClients: uniqueClients,
    totalArrearPrincipal: numbered.reduce((s, r) => s + r.arrearPrincipal, 0),
    totalArrearInterest: numbered.reduce((s, r) => s + r.arrearInterest, 0),
    totalFeesDue: numbered.reduce((s, r) => s + r.feesDue, 0),
    totalPenaltiesDue: numbered.reduce((s, r) => s + r.penaltiesDue, 0),
    totalArrearDue: numbered.reduce((s, r) => s + r.totalArrearDue, 0),
  };

  return { rows: numbered, meta };
}