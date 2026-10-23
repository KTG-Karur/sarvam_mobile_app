import { prisma } from '@/app/lib/prisma';
import { IncentiveConfigType } from '@prisma/client';
import { aggregateDcbLoansToCenterMetrics, type DcbLoanForAggregation } from '@/app/lib/reports/dcb-aggregation';
import { buildDcbIstReportWindow } from '@/app/lib/dcb-report-ist';
import { determineBranchType, type BranchIncentiveType } from '@/app/lib/branch-incentive-type';

// ─── Types ─────────────────────────────────────────────────────────────────

export type IncentiveReportParams = {
    fromDate: string; // YYYY-MM-DD (IST calendar day)
    toDate: string;
    /** Role-based branch scope resolved by the caller (resolveScopedBranchIds). null = unrestricted. */
    scopedBranchIds: string[] | null;
    branchId?: string;
    divisionId?: string;
    fdoId?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
    exportAll?: boolean;
};

export type IncentiveReportRow = {
    fdoId: string;
    division: string;
    branch: string;
    dateOfJoining: string | null;
    employeeId: string | null;
    staffName: string;
    fieldOfficerCategory: string | null;
    activeClients: number;
    goldLoanTarget: number;
    goldLoanAchievedMembers: number;
    goldLoanDisbursementAmount: number;
    achievementPercent: number;
    eligibleIncentive: number;
    goldWeightSlab1: number;
    goldWeightSlab2: number;
    goldWeightSlab3: number;
    goldWeightIncentive: number;
    jlgLoanMembers: number;
    jlgLoanDisbursement: number;
    jlgIncentive: number;
    totalDemand: number;
    demandCollection: number;
    arrearCollection: number;
    totalCollection: number;
    recoveryPercent: number;
    collectionIncentive: number;
    odCollection31to60: number;
    odCollection61to90: number;
    odCollection91to180: number;
    odCollectionAbove180: number;
    odCollectionIncentive: number;
    finalIncentive: number;
};

export type IncentiveReportResult = {
    data: IncentiveReportRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    summary: { fdoCount: number; totalFinalIncentive: number };
};

// ─── Config slab helpers ─────────────────────────────────────────────────────

type SlabRow = {
    slabOrder: number;
    label: string | null;
    category: string | null;
    minValue: unknown;
    maxValue: unknown;
    rate: unknown;
};

const n = (v: unknown): number => {
    const x = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(x) ? x : 0;
};

async function loadActiveSlabs(configType: IncentiveConfigType): Promise<SlabRow[]> {
    const config = await prisma.incentiveConfig.findFirst({
        where: { configType, isActive: true },
        include: { slabs: { orderBy: { slabOrder: 'asc' } } },
    });
    return config?.slabs ?? [];
}

function findBand(value: number, slabs: SlabRow[], category?: string): SlabRow | undefined {
    return slabs.find((s) => {
        if (category && s.category !== category) return false;
        if (s.minValue != null && value < n(s.minValue)) return false;
        if (s.maxValue != null && value > n(s.maxValue)) return false;
        return true;
    });
}

function resolveBandRate(value: number, slabs: SlabRow[], category?: string): number {
    const band = findBand(value, slabs, category);
    return band ? n(band.rate) : 0;
}

function resolveGoldWeight(grams: number[], slabs: SlabRow[]): { perSlab: number[]; total: number } {
    const perSlab = slabs.map(() => 0);
    for (const g of grams) {
        const idx = slabs.findIndex(
            (s) => (s.minValue == null || g >= n(s.minValue)) && (s.maxValue == null || g <= n(s.maxValue))
        );
        if (idx >= 0) perSlab[idx] += n(slabs[idx].rate);
    }
    return { perSlab, total: perSlab.reduce((a, b) => a + b, 0) };
}

function resolveOdRate(minThreshold: number, slabs: SlabRow[]): number {
    const s = slabs.find((sl) => sl.minValue != null && n(sl.minValue) === minThreshold);
    return s ? n(s.rate) : 0;
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function getIncentiveReportData(params: IncentiveReportParams): Promise<IncentiveReportResult> {
    const ist = buildDcbIstReportWindow(params.fromDate, params.toDate);

    // ── Resolve final branch scope (role scope ∩ branch filter ∩ division filter) ──
    let finalBranchIds: string[] | undefined;
    {
        let ids = params.scopedBranchIds;
        if (params.branchId) {
            ids = ids ? (ids.includes(params.branchId) ? [params.branchId] : []) : [params.branchId];
        }
        if (params.divisionId) {
            const divisionBranches = await prisma.branch.findMany({
                where: {
                    areas: { some: { divisionId: params.divisionId } },
                    ...(ids ? { id: { in: ids } } : {}),
                },
                select: { id: true },
            });
            ids = divisionBranches.map((b) => b.id);
        }
        finalBranchIds = ids ?? undefined;
    }

    // ── FDO list ──
    const fdos = await prisma.user.findMany({
        where: {
            role: 'FDO',
            isActive: true,
            ...(finalBranchIds ? { branchId: { in: finalBranchIds } } : {}),
            ...(params.fdoId ? { id: params.fdoId } : {}),
        },
        select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            dateOfJoining: true,
            branch: {
                select: {
                    id: true,
                    name: true,
                    areas: { select: { division: { select: { name: true } } }, take: 1 },
                },
            },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const emptySummary = { fdoCount: 0, totalFinalIncentive: 0 };
    if (fdos.length === 0) {
        return { data: [], total: 0, page: params.page ?? 1, pageSize: params.pageSize ?? 20, totalPages: 1, summary: emptySummary };
    }

    const fdoIds = fdos.map((f) => f.id);
    const branchIdsInScope = Array.from(
        new Set(fdos.map((f) => f.branch?.id).filter((id): id is string => !!id))
    );

    // ── Config slabs (loaded once per request, reused for every FDO row) ──
    const [
        categorySlabs,
        goldTargetSlabs,
        goldAchievementExistingSlabs,
        goldAchievementNewSlabs,
        goldWeightSlabs,
        jlgSlabs,
        collectionSlabs,
        odSlabs,
    ] = await Promise.all([
        loadActiveSlabs(IncentiveConfigType.CATEGORY_RULE),
        loadActiveSlabs(IncentiveConfigType.GOLD_TARGET),
        loadActiveSlabs(IncentiveConfigType.GOLD_ACHIEVEMENT_EXISTING),
        loadActiveSlabs(IncentiveConfigType.GOLD_ACHIEVEMENT_NEW),
        loadActiveSlabs(IncentiveConfigType.GOLD_WEIGHT_SLAB),
        loadActiveSlabs(IncentiveConfigType.JLG_INCENTIVE),
        loadActiveSlabs(IncentiveConfigType.COLLECTION_INCENTIVE),
        loadActiveSlabs(IncentiveConfigType.OD_COLLECTION_RATE),
    ]);
    const jlgRate = jlgSlabs.length > 0 ? n(jlgSlabs[0].rate) : 0;

    // ── Branch type (New/Existing), computed once per distinct branch ──
    const branchTypeEntries = await Promise.all(
        branchIdsInScope.map(async (id) => [id, await determineBranchType(id)] as const)
    );
    const branchTypeMap = new Map<string, BranchIncentiveType>(branchTypeEntries);

    // ── Loans disbursed in the period (single query, feeds Gold + JLG) ──
    const disbursedLoans = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            branchId: { in: branchIdsInScope },
            OR: [
                { disbursedByBMAt: { gte: ist.rangeStartUtc, lt: ist.rangeEndExclusiveUtc } },
                {
                    disbursedByBMAt: null,
                    disbursedLevel1At: { gte: ist.rangeStartUtc, lt: ist.rangeEndExclusiveUtc },
                },
            ],
        },
        select: {
            id: true,
            clientId: true,
            amount: true,
            client: { select: { center: { select: { fdoId: true } } } },
            goldLoanDetail: { select: { gramCount: true } },
        },
    });

    type LoanAgg = {
        goldMembers: Set<string>;
        goldAmount: number;
        goldGrams: number[];
        jlgMembers: Set<string>;
        jlgAmount: number;
    };
    const loanAggByFdo = new Map<string, LoanAgg>();
    for (const loan of disbursedLoans) {
        const fdoId = loan.client?.center?.fdoId;
        if (!fdoId) continue;
        if (!loanAggByFdo.has(fdoId)) {
            loanAggByFdo.set(fdoId, { goldMembers: new Set(), goldAmount: 0, goldGrams: [], jlgMembers: new Set(), jlgAmount: 0 });
        }
        const agg = loanAggByFdo.get(fdoId)!;
        if (loan.goldLoanDetail) {
            agg.goldMembers.add(loan.clientId);
            agg.goldAmount += n(loan.amount);
            agg.goldGrams.push(n(loan.goldLoanDetail.gramCount));
        } else {
            agg.jlgMembers.add(loan.clientId);
            agg.jlgAmount += n(loan.amount);
        }
    }

    // ── Demand / Collection / Recovery% + OD arrear buckets ──
    // Reuses the same DCB aggregation engine as getAllBranchDCBData (app/lib/actions/reports.ts),
    // re-keyed by FDO instead of branch. OD buckets are computed from the same loan/schedule fetch
    // using the identical daysPastDue bucketing formula as getAgewiseArrearData (31-60/61-90/91-180/>180),
    // avoiding a second full report query.
    // Only the columns the DCB aggregation and the arrear buckets below actually read (DcbLoanForAggregation in
    // app/lib/reports/dcb-aggregation.ts) - NOT whole loan/client/center/branch/user rows plus every schedule and
    // transaction column. This query loads a branch's entire active loan book, so trimming the columns is what keeps
    // the payroll preview (one run per branch) fast.
    const dcbLoans = await prisma.loan.findMany({
        where: { disbursementStatus: 'DISBURSED', isActive: true, branchId: { in: branchIdsInScope } },
        select: {
            id: true,
            clientId: true,
            client: {
                select: {
                    center: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            meetingDay: true,
                            nextMeetingDate: true,
                            fdoId: true,
                            branch: { select: { name: true, code: true } },
                            fdo: { select: { firstName: true, lastName: true } },
                        },
                    },
                },
            },
            schedules: {
                where: { dueDate: { lte: ist.scheduleFetchDueLteUtc } },
                orderBy: { dueDate: 'asc' },
                select: {
                    id: true,
                    dueDate: true,
                    principalDue: true,
                    principalPaid: true,
                    interestDue: true,
                    interestPaid: true,
                    savingsDue: true,
                    savingsPaid: true,
                },
            },
            transactions: {
                where: {
                    transactionDate: { gte: ist.rangeStartUtc, lt: ist.rangeEndExclusiveUtc },
                    isReversed: false,
                    status: 'APPROVED',
                },
                orderBy: { transactionDate: 'asc' },
                select: {
                    type: true,
                    transactionDate: true,
                    principalAmount: true,
                    interestAmount: true,
                    amount: true,
                    collectionType: true,
                    openingArrearsPrincipal: true,
                    openingArrearsInterest: true,
                    currentDemandPrincipal: true,
                    currentDemandInterest: true,
                    lines: {
                        select: {
                            principalAmount: true,
                            interestAmount: true,
                            lineTotal: true,
                            schedule: { select: { dueDate: true } },
                        },
                    },
                },
            },
        },
    });

    const centerFdoMap = new Map<string, string | null>();
    for (const loan of dcbLoans) {
        const center = loan.client?.center;
        if (center && !centerFdoMap.has(center.id)) centerFdoMap.set(center.id, center.fdoId ?? null);
    }

    const centerRows = aggregateDcbLoansToCenterMetrics(dcbLoans as unknown as DcbLoanForAggregation[], ist);
    type DemandAgg = { demand: number; currCollection: number; opnArrColl: number; totalColl: number };
    const demandByFdo = new Map<string, DemandAgg>();
    for (const row of centerRows) {
        const fdoId = centerFdoMap.get(row.centerId);
        if (!fdoId) continue;
        if (!demandByFdo.has(fdoId)) demandByFdo.set(fdoId, { demand: 0, currCollection: 0, opnArrColl: 0, totalColl: 0 });
        const d = demandByFdo.get(fdoId)!;
        d.demand += row.demand;
        d.currCollection += row.currCollection;
        d.opnArrColl += row.opnArrColl;
        d.totalColl += row.totalColl;
    }

    type OdAgg = { b31to60: number; b61to90: number; b91to180: number; bAbove180: number };
    const odByFdo = new Map<string, OdAgg>();
    // Any client with an unpaid installment past its due date (any age, not just 31+) is
    // excluded from "Active Clients" for category purposes — "Current Active Members
    // (Not included Arrear Mem)" per the Collection Incentive category table.
    const clientsWithArrear = new Set<string>();
    const asOfMs = ist.scheduleFetchDueLteUtc.getTime();
    for (const loan of dcbLoans) {
        const fdoId = loan.client?.center?.fdoId;
        if (!fdoId) continue;
        if (!odByFdo.has(fdoId)) odByFdo.set(fdoId, { b31to60: 0, b61to90: 0, b91to180: 0, bAbove180: 0 });
        const bucket = odByFdo.get(fdoId)!;
        for (const sch of loan.schedules) {
            const unpaid = Math.max(0, n(sch.principalDue) - n(sch.principalPaid)) + Math.max(0, n(sch.interestDue) - n(sch.interestPaid));
            if (unpaid <= 0) continue;
            const daysPastDue = Math.floor((asOfMs - new Date(sch.dueDate).getTime()) / 86400000);
            if (daysPastDue < 1) continue;
            clientsWithArrear.add(loan.clientId);
            if (daysPastDue < 31) continue;
            if (daysPastDue <= 60) bucket.b31to60 += unpaid;
            else if (daysPastDue <= 90) bucket.b61to90 += unpaid;
            else if (daysPastDue <= 180) bucket.b91to180 += unpaid;
            else bucket.bAbove180 += unpaid;
        }
    }

    // ── Active Clients per FDO — active clients minus anyone currently in arrears ──
    const activeClientRows = await prisma.client.findMany({
        where: { isActive: true, center: { fdoId: { in: fdoIds } } },
        select: { id: true, center: { select: { fdoId: true } } },
    });
    const activeClientsByFdo = new Map<string, number>();
    for (const c of activeClientRows) {
        const fdoId = c.center?.fdoId;
        if (!fdoId) continue;
        if (clientsWithArrear.has(c.id)) continue;
        activeClientsByFdo.set(fdoId, (activeClientsByFdo.get(fdoId) ?? 0) + 1);
    }

    const od31to60Rate = resolveOdRate(31, odSlabs);
    const od61to90Rate = resolveOdRate(61, odSlabs);
    const od91to180Rate = resolveOdRate(91, odSlabs);
    const odAbove180Rate = resolveOdRate(181, odSlabs);

    // ── Assemble rows ──
    const round2 = (v: number) => Math.round(v * 100) / 100;

    const rows: IncentiveReportRow[] = fdos.map((fdo) => {
        const activeClients = activeClientsByFdo.get(fdo.id) ?? 0;
        const categoryBand = findBand(activeClients, categorySlabs);
        const category = categoryBand?.category ?? null;

        const branchType: BranchIncentiveType = fdo.branch ? branchTypeMap.get(fdo.branch.id) ?? 'NEW' : 'NEW';
        const goldTargetBand = goldTargetSlabs.find((s) => s.category === branchType);
        const goldLoanTarget = goldTargetBand ? n(goldTargetBand.rate) : branchType === 'EXISTING' ? 30 : 40;

        const loanAgg = loanAggByFdo.get(fdo.id);
        const goldLoanAchievedMembers = loanAgg?.goldMembers.size ?? 0;
        const goldLoanDisbursementAmount = loanAgg?.goldAmount ?? 0;
        const achievementPercent = goldLoanTarget > 0 ? round2((goldLoanAchievedMembers / goldLoanTarget) * 100) : 0;

        const achievementSlabs = branchType === 'EXISTING' ? goldAchievementExistingSlabs : goldAchievementNewSlabs;
        const eligibleIncentive = resolveBandRate(goldLoanAchievedMembers, achievementSlabs);

        const weight = resolveGoldWeight(loanAgg?.goldGrams ?? [], goldWeightSlabs);

        const jlgLoanMembers = loanAgg?.jlgMembers.size ?? 0;
        const jlgLoanDisbursement = loanAgg?.jlgAmount ?? 0;
        const jlgIncentive = jlgLoanMembers * jlgRate;

        const demandAgg = demandByFdo.get(fdo.id) ?? { demand: 0, currCollection: 0, opnArrColl: 0, totalColl: 0 };
        const recoveryPercent = demandAgg.demand > 0 ? Math.min(100, round2((demandAgg.currCollection / demandAgg.demand) * 100)) : 0;
        const collectionIncentive = category ? resolveBandRate(recoveryPercent, collectionSlabs, category) : 0;

        const od = odByFdo.get(fdo.id) ?? { b31to60: 0, b61to90: 0, b91to180: 0, bAbove180: 0 };
        const odCollectionIncentive = round2(
            (od.b31to60 * od31to60Rate) / 100 +
            (od.b61to90 * od61to90Rate) / 100 +
            (od.b91to180 * od91to180Rate) / 100 +
            (od.bAbove180 * odAbove180Rate) / 100
        );

        const finalIncentive = round2(eligibleIncentive + weight.total + jlgIncentive + collectionIncentive + odCollectionIncentive);

        return {
            fdoId: fdo.id,
            division: fdo.branch?.areas?.[0]?.division?.name ?? '',
            branch: fdo.branch?.name ?? '',
            dateOfJoining: fdo.dateOfJoining ? fdo.dateOfJoining.toISOString().slice(0, 10) : null,
            employeeId: fdo.employeeId,
            staffName: `${fdo.firstName} ${fdo.lastName}`.trim(),
            fieldOfficerCategory: category,
            activeClients,
            goldLoanTarget,
            goldLoanAchievedMembers,
            goldLoanDisbursementAmount: round2(goldLoanDisbursementAmount),
            achievementPercent,
            eligibleIncentive,
            goldWeightSlab1: weight.perSlab[0] ?? 0,
            goldWeightSlab2: weight.perSlab[1] ?? 0,
            goldWeightSlab3: weight.perSlab[2] ?? 0,
            goldWeightIncentive: round2(weight.total),
            jlgLoanMembers,
            jlgLoanDisbursement: round2(jlgLoanDisbursement),
            jlgIncentive: round2(jlgIncentive),
            totalDemand: round2(demandAgg.demand),
            demandCollection: round2(demandAgg.currCollection),
            arrearCollection: round2(demandAgg.opnArrColl),
            totalCollection: round2(demandAgg.totalColl),
            recoveryPercent,
            collectionIncentive,
            odCollection31to60: round2(od.b31to60),
            odCollection61to90: round2(od.b61to90),
            odCollection91to180: round2(od.b91to180),
            odCollectionAbove180: round2(od.bAbove180),
            odCollectionIncentive,
            finalIncentive,
        };
    });

    // ── Search ──
    let filtered = rows;
    if (params.search) {
        const q = params.search.trim().toLowerCase();
        filtered = filtered.filter(
            (r) => r.staffName.toLowerCase().includes(q) || (r.employeeId ?? '').toLowerCase().includes(q)
        );
    }

    // ── Sort ──
    const sortBy = params.sortBy as keyof IncentiveReportRow | undefined;
    filtered = [...filtered].sort((a, b) => {
        if (sortBy && sortBy in a) {
            const av = a[sortBy];
            const bv = b[sortBy];
            const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
            return params.sortOrder === 'desc' ? -cmp : cmp;
        }
        return a.branch.localeCompare(b.branch) || a.staffName.localeCompare(b.staffName);
    });

    const total = filtered.length;
    const summary = {
        fdoCount: total,
        totalFinalIncentive: round2(filtered.reduce((s, r) => s + r.finalIncentive, 0)),
    };

    if (params.exportAll) {
        return { data: filtered, total, page: 1, pageSize: total || 1, totalPages: 1, summary };
    }

    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, params.pageSize ?? 20);
    const start = (page - 1) * pageSize;
    const data = filtered.slice(start, start + pageSize);

    return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), summary };
}
