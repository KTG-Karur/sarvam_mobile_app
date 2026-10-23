/**
 * Pure (no Prisma / no I/O) recomputation of one row of the org's Payroll
 * excel sheet, shared by the Bulk Payroll grid (live recalculation as cells
 * are edited) and by the bulk-run API (which re-applies the client's sparse
 * `edits` on top of its own freshly computed baseline, so the server — not
 * the browser — produces every saved figure).
 *
 * Formula chain (matches the sheet's yellow "formula" cells):
 *   S  Prorated CTC   = ROUND(N / 30 * P)              N = Total Paid Days, P = Month CTC Pay
 *   Q  Basic          = S * basic%      R HRA = S * hra%
 *   T  Working days   = N - LOP
 *   W  Actual Gross   = ROUND(T / 30 * S)
 *   U  Actual Basic   = ROUND(W * basic%)   V Actual HRA = W - U
 *   PF/ESI (percent components) = ROUND(base * % / 100), capped at maxAmount,
 *       0 when Month CTC Pay > ctcEligibilityLimit
 *   Z  Total Earnings = sum of EARNINGS components (Basic/HRA = U/V)
 *   AF Total Deduction= sum of DEDUCTIONS components
 *   AG Net Salary With Incentive = Z - AF
 *   AH Net Pay        = AG - Monthly Incentive
 * Any cell can be overridden through `edits`; everything downstream of an
 * overridden cell recomputes from the overriding value.
 */

/** Payroll treats every month as 30 days (matches the sheet's "/30"). */
export const PAYROLL_MONTH_DAYS = 30;

export type GridComponentKind = 'BASIC' | 'HRA' | 'PERCENT' | 'FREE';

export type GridPercentRule = {
    percent: number;
    basis: 'BASIC' | 'GROSS';
    maxAmount: number | null;
    ctcEligibilityLimit: number | null;
};

export type GridComponent = {
    id: string;
    salaryId: number;
    name: string;
    type: 'EARNINGS' | 'DEDUCTIONS';
    kind: GridComponentKind;
    /** Server-computed default (the value before any edit). */
    amount: number;
    percentRule?: GridPercentRule;
    /** Backed by another module's schedule (Staff Loan / Staff Advance). */
    systemBacked?: boolean;
};

/** Sparse user overrides. Keys for scalar cells are fixed; component
 * amounts (everything except Basic/HRA, which are `actualBasic`/`actualHra`)
 * are keyed by component id. */
export type GridEdits = {
    totalPaidDays?: number;
    lopDays?: number;
    monthlyCtc?: number;
    proratedCtc?: number;
    basic?: number;
    hra?: number;
    actualGross?: number;
    actualBasic?: number;
    actualHra?: number;
    components?: Record<string, number>;
};

export type GridRowBase = {
    totalPaidDays: number;
    lopDays: number;
    monthlyCtc: number;
    basicPercent: number;
    hraPercent: number;
    components: GridComponent[];
};

export type GridRowComputed = {
    totalPaidDays: number;
    lopDays: number;
    monthlyCtc: number;
    proratedCtc: number;
    basic: number;
    hra: number;
    workingDays: number;
    actualGross: number;
    actualBasic: number;
    actualHra: number;
    /** Final amount per component id (Basic/HRA included). */
    amounts: Record<string, number>;
    totalEarnings: number;
    totalDeductions: number;
    incentive: number;
    netWithIncentive: number;
    netPay: number;
};

/** Round to whole rupees, tolerant of float noise right at a .5 boundary. */
export function roundRupee(x: number): number {
    return Math.round(Number(x.toFixed(6)));
}

function round2(x: number): number {
    return Math.round(Number((x * 100).toFixed(4))) / 100;
}

const isIncentiveName = (name: string) => /incentive/i.test(name);

/**
 * One percentage-based deduction (PF/ESI/...): % of Actual Basic or Actual
 * Gross, whole-rupee rounded (the org's sheet carries whole rupees — e.g.
 * 12% of 8,085 = 970.2 -> 970), capped at maxAmount, 0 when Month CTC Pay is
 * above the eligibility limit.
 */
export function resolvePercentAmount(params: {
    percent: number;
    basis: 'BASIC' | 'GROSS';
    actualBasic: number;
    actualGross: number;
    monthlyCtc: number;
    maxAmount?: number | null;
    ctcEligibilityLimit?: number | null;
}): number {
    if (params.ctcEligibilityLimit != null && params.monthlyCtc > params.ctcEligibilityLimit) return 0;
    const base = params.basis === 'GROSS' ? params.actualGross : params.actualBasic;
    const computed = roundRupee((base * params.percent) / 100);
    return params.maxAmount != null ? Math.min(computed, params.maxAmount) : computed;
}

export function computeGridRow(base: GridRowBase, edits: GridEdits = {}): GridRowComputed {
    const totalPaidDays = edits.totalPaidDays ?? base.totalPaidDays;
    const lopDays = edits.lopDays ?? base.lopDays;
    const monthlyCtc = edits.monthlyCtc ?? base.monthlyCtc;
    const workingDays = Math.max(0, totalPaidDays - lopDays);

    const proratedCtc = edits.proratedCtc ?? roundRupee((totalPaidDays / PAYROLL_MONTH_DAYS) * monthlyCtc);
    const basic = edits.basic ?? round2((proratedCtc * base.basicPercent) / 100);
    const hra = edits.hra ?? round2((proratedCtc * base.hraPercent) / 100);

    const actualGross = edits.actualGross ?? roundRupee((workingDays / PAYROLL_MONTH_DAYS) * proratedCtc);
    const actualBasic = edits.actualBasic ?? roundRupee((actualGross * base.basicPercent) / 100);
    const actualHra = edits.actualHra ?? actualGross - actualBasic;

    const amounts: Record<string, number> = {};
    for (const c of base.components) {
        const override = edits.components?.[c.id];
        if (c.kind === 'BASIC') amounts[c.id] = actualBasic;
        else if (c.kind === 'HRA') amounts[c.id] = actualHra;
        else if (override !== undefined) amounts[c.id] = override;
        else if (c.kind === 'PERCENT' && c.percentRule) {
            amounts[c.id] = resolvePercentAmount({ ...c.percentRule, actualBasic, actualGross, monthlyCtc });
        } else amounts[c.id] = c.amount;
    }

    let totalEarnings = 0;
    let totalDeductions = 0;
    let incentive = 0;
    for (const c of base.components) {
        const amount = amounts[c.id];
        if (c.type === 'EARNINGS') {
            totalEarnings += amount;
            if (isIncentiveName(c.name)) incentive += amount;
        } else totalDeductions += amount;
    }
    const netWithIncentive = totalEarnings - totalDeductions;

    return {
        totalPaidDays, lopDays, monthlyCtc, proratedCtc, basic, hra, workingDays,
        actualGross, actualBasic, actualHra, amounts,
        totalEarnings, totalDeductions, incentive,
        netWithIncentive, netPay: netWithIncentive - incentive,
    };
}

/** A scalar cell key, or `c:<componentId>` for a component amount. */
export type GridEditKey = Exclude<keyof GridEdits, 'components'> | `c:${string}`;

/** Returns `edits` with one cell set (or, when `value` is null, cleared back
 * to its computed default). Pure — never mutates the input. */
export function setGridEdit(edits: GridEdits, key: GridEditKey, value: number | null): GridEdits {
    if (key.startsWith('c:')) {
        const id = key.slice(2);
        const components = { ...(edits.components ?? {}) };
        if (value === null) delete components[id];
        else components[id] = value;
        const next: GridEdits = { ...edits, components };
        if (Object.keys(components).length === 0) delete next.components;
        return next;
    }
    const scalar = key as Exclude<keyof GridEdits, 'components'>;
    const next: GridEdits = { ...edits };
    if (value === null) delete next[scalar];
    else next[scalar] = value;
    return next;
}

export function isGridEditEmpty(edits: GridEdits | undefined): boolean {
    return !edits || Object.keys(edits).length === 0;
}
