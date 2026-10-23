import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { buildUcrfRecord, flagDuplicateAccounts, flagDuplicateMemberIds } from './build-record';
import { monthStartYmd, toKolkataYmd } from './format';
import type {
    UcrfConfig,
    UcrfDatasetSummary,
    UcrfFilters,
    UcrfLoanInput,
    UcrfPageParams,
    UcrfRecord,
} from './types';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

const BATCH = 500;
/** Parallel batches; each uses a few pooled connections, so keep this modest. */
const CONCURRENCY = 4;
/** Postgres caps a prepared statement at 32767 bind variables — keep `in` lists far below that. */
const IN_CHUNK = 20000;

function istStart(ymd: string): Date {
    return new Date(`${ymd}T00:00:00+05:30`);
}
function istEnd(ymd: string): Date {
    return new Date(`${ymd}T23:59:59.999+05:30`);
}
function addDays(ymd: string, n: number): string {
    const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n));
    return d.toISOString().slice(0, 10);
}

/** Eligible = disbursed on/before the report date, still open (or closed after it), or closed within the report month. */
export function buildEligibilityWhere(f: UcrfFilters): Prisma.LoanWhereInput {
    const reportEnd = istEnd(f.reportDate);
    const monthStart = istStart(monthStartYmd(f.reportDate));

    const open: Prisma.LoanWhereInput = {
        OR: [
            { disbursementStatus: 'DISBURSED', isActive: true },
            { disbursementStatus: 'CLOSED', closedDate: { gt: reportEnd } },
        ],
    };
    const closedInMonth: Prisma.LoanWhereInput = {
        disbursementStatus: 'CLOSED',
        closedDate: { gte: monthStart, lte: reportEnd },
    };
    const statusCond = f.loanStatus === 'ACTIVE' ? open : f.loanStatus === 'CLOSED' ? closedInMonth : { OR: [open, closedInMonth] };

    // A loan with no disbursal timestamp at all is kept in (and flagged invalid) rather than silently dropped.
    const disbursedByReportDate: Prisma.LoanWhereInput = {
        OR: [
            { disbursedByBMAt: { lte: reportEnd } },
            { disbursedByBMAt: null, disbursedLevel1At: { lte: reportEnd } },
            { disbursedByBMAt: null, disbursedLevel1At: null },
        ],
    };

    const and: Prisma.LoanWhereInput[] = [statusCond, disbursedByReportDate];
    if (f.branchId) and.push({ branchId: f.branchId });
    if (f.loanProductId) and.push({ loanProductId: f.loanProductId });
    if (f.search) {
        const q = f.search;
        and.push({
            OR: [
                { loanNumber: { contains: q, mode: 'insensitive' } },
                { client: { clientId: { contains: q, mode: 'insensitive' } } },
                { client: { firstName: { contains: q, mode: 'insensitive' } } },
                { client: { lastName: { contains: q, mode: 'insensitive' } } },
                ...loanMemberIdSearchConditions(q),
            ],
        });
    }
    return { AND: and };
}

const num = (v: Prisma.Decimal | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

const loanSelect = {
    id: true,
    loanNumber: true,
    clientId: true,
    amount: true,
    appliedAmount: true,
    frequency: true,
    disbursedByBMAt: true,
    disbursedLevel1At: true,
    closedDate: true,
    closureReason: true,
    disbursementStatus: true,
    createdAt: true,
    branch: { select: { id: true, code: true, name: true } },
    center: { select: { code: true, name: true } },
    loanProduct: { select: { productName: true, frequency: true } },
    loanPurpose: { select: { name: true } },
    schedules: {
        orderBy: { dueDate: 'asc' as const },
        select: { id: true, dueDate: true, principalDue: true, interestDue: true, status: true },
    },
    insuranceRecords: {
        orderBy: { startDate: 'desc' as const },
        take: 1,
        select: { policyType: true, coverageAmount: true },
    },
    client: {
        select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            maritalStatus: true,
            fatherName: true,
            motherName: true,
            spouseName: true,
            spouseGender: true,
            nomineeName: true,
            nomineeRelation: true,
            votersIdNo: true,
            otherIdNo: true,
            pancardNo: true,
            mobileNumber: true,
            phone: true,
            email: true,
            qualification: true,
            bankName: true,
            ifscCode: true,
            bankAcNo: true,
            monthlyFamilyIncome: true,
            monthlyFamilyExpense: true,
            religion: true,
            caste: true,
            permanentAddress: true,
            state: true,
            pincode: true,
            groupMemberships: {
                orderBy: { joinedAt: 'desc' as const },
                take: 1,
                select: { group: { select: { id: true, code: true, groupNumber: true, centerId: true } } },
            },
        },
    },
} satisfies Prisma.LoanSelect;

type LoanRow = Prisma.LoanGetPayload<{ select: typeof loanSelect }>;

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
    for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

/** Ledger-derived paid-as-of amounts (approved, non-reversed REPAYMENT/PRECLOSURE lines) — same source as the PAR/arrear reports. */
async function loadLedger(loanIds: string[], cutoffExclusive: Date) {
    const paid = new Map<string, { principal: number; interest: number }>();
    for (const chunk of chunks(loanIds, IN_CHUNK)) {
        const rows = await prisma.loanTransactionLine.groupBy({
            by: ['scheduleId'],
            where: {
                transaction: {
                    loanId: { in: chunk },
                    transactionDate: { lt: cutoffExclusive },
                    status: 'APPROVED',
                    isReversed: false,
                    type: { in: ['REPAYMENT', 'PRECLOSURE'] },
                },
            },
            _sum: { principalAmount: true, interestAmount: true },
        });
        for (const r of rows) {
            if (r.scheduleId) paid.set(r.scheduleId, { principal: num(r._sum.principalAmount), interest: num(r._sum.interestAmount) });
        }
    }
    return paid;
}

async function loadBatchExtras(rows: LoanRow[], cutoffExclusive: Date) {
    const loanIds = rows.map((r) => r.id);
    const clientIds = [...new Set(rows.map((r) => r.clientId))];

    const [ledger, lastPayments, writeOffs, clientLoans] = await Promise.all([
        loadLedger(loanIds, cutoffExclusive),
        prisma.loanTransaction.groupBy({
            by: ['loanId'],
            where: {
                loanId: { in: loanIds },
                status: 'APPROVED',
                isReversed: false,
                type: { in: ['REPAYMENT', 'PRECLOSURE'] },
                transactionDate: { lt: cutoffExclusive },
            },
            _max: { transactionDate: true },
        }),
        prisma.loanTransaction.findMany({
            where: { loanId: { in: loanIds }, type: 'WRITEOFF', status: 'APPROVED', isReversed: false },
            orderBy: { transactionDate: 'desc' },
            select: { loanId: true, amount: true, transactionDate: true },
        }),
        prisma.loan.findMany({
            where: { clientId: { in: clientIds }, disbursementStatus: { in: ['DISBURSED', 'CLOSED'] } },
            select: { id: true, clientId: true, disbursedByBMAt: true, disbursedLevel1At: true, createdAt: true },
        }),
    ]);

    const lastPay = new Map(lastPayments.map((l) => [l.loanId, toKolkataYmd(l._max.transactionDate)]));
    const writeOff = new Map<string, { amount: number; ymd: string }>();
    for (const w of writeOffs) {
        if (!writeOff.has(w.loanId)) writeOff.set(w.loanId, { amount: num(w.amount), ymd: toKolkataYmd(w.transactionDate)! });
    }

    // Loan cycle = ordinal of this loan among the client's disbursed loans (by disbursal, then creation).
    const byClient = new Map<string, Array<{ id: string; key: string }>>();
    for (const l of clientLoans) {
        const when = l.disbursedByBMAt ?? l.disbursedLevel1At ?? l.createdAt;
        const arr = byClient.get(l.clientId) ?? [];
        arr.push({ id: l.id, key: `${when.toISOString()}|${l.createdAt.toISOString()}|${l.id}` });
        byClient.set(l.clientId, arr);
    }
    const cycle = new Map<string, number>();
    for (const arr of byClient.values()) {
        arr.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        arr.forEach((l, i) => cycle.set(l.id, i + 1));
    }
    return { ledger, lastPay, writeOff, cycle };
}

function groupIdentifierOf(row: LoanRow): string | null {
    const g = row.client.groupMemberships[0]?.group;
    if (!g) return null;
    const label = g.code ?? (g.groupNumber !== null ? String(g.groupNumber) : g.id);
    return `${row.branch.code}/${row.center.code}/${label}`;
}

function toInput(row: LoanRow, extras: Awaited<ReturnType<typeof loadBatchExtras>>): UcrfLoanInput {
    const c = row.client;
    const ins = row.insuranceRecords[0];
    return {
        loanId: row.id,
        loanNumber: row.loanNumber,
        client: {
            dbId: c.id,
            clientId: c.clientId,
            firstName: c.firstName,
            lastName: c.lastName,
            gender: c.gender,
            dobYmd: toKolkataYmd(c.dateOfBirth),
            maritalStatus: c.maritalStatus,
            fatherName: c.fatherName,
            motherName: c.motherName,
            spouseName: c.spouseName,
            spouseGender: c.spouseGender,
            nomineeName: c.nomineeName,
            nomineeRelation: c.nomineeRelation,
            votersIdNo: c.votersIdNo,
            aadhaar: c.otherIdNo,
            pancardNo: c.pancardNo,
            mobileNumber: c.mobileNumber,
            phone: c.phone,
            email: c.email,
            qualification: c.qualification,
            bankName: c.bankName,
            ifscCode: c.ifscCode,
            bankAcNo: c.bankAcNo,
            monthlyFamilyIncome: numOrNull(c.monthlyFamilyIncome),
            monthlyFamilyExpense: numOrNull(c.monthlyFamilyExpense),
            religion: c.religion,
            caste: c.caste,
            permanentAddress: c.permanentAddress,
            state: c.state,
            pincode: c.pincode,
        },
        branch: row.branch,
        center: row.center,
        groupIdentifier: groupIdentifierOf(row),
        productName: row.loanProduct?.productName ?? null,
        purposeName: row.loanPurpose?.name ?? null,
        // Some migrated loans carry no frequency of their own; the product defines it.
        frequency: row.frequency ?? row.loanProduct?.frequency ?? null,
        appliedAmount: numOrNull(row.appliedAmount),
        amount: num(row.amount),
        disbursedYmd: toKolkataYmd(row.disbursedByBMAt ?? row.disbursedLevel1At),
        closedYmd: toKolkataYmd(row.closedDate),
        disbursementStatus: row.disbursementStatus,
        closureReason: row.closureReason,
        schedules: row.schedules.map((s) => {
            const paid = extras.ledger.get(s.id);
            return {
                dueYmd: toKolkataYmd(s.dueDate)!,
                principalDue: num(s.principalDue),
                interestDue: num(s.interestDue),
                status: s.status,
                principalPaid: paid?.principal ?? 0,
                interestPaid: paid?.interest ?? 0,
            };
        }),
        lastPaymentYmd: extras.lastPay.get(row.id) ?? null,
        writeOff: extras.writeOff.get(row.id) ?? null,
        loanCycle: extras.cycle.get(row.id) ?? null,
        insurance: ins ? { policyType: ins.policyType, coverageAmount: num(ins.coverageAmount) } : null,
    };
}

/**
 * The single source of UCRF records for the summary, preview and every export format: filtered
 * loans → normalised inputs (ledger-based financials) → mapped + validated records.
 * Loans are processed in id-ordered batches so memory stays bounded to the lightweight records.
 */
export interface UcrfLoadOptions {
    /** Parallel batches (default CONCURRENCY). The background job uses 1 so other API calls keep their DB connections. */
    concurrency?: number;
    batchSize?: number;
    /** Sleep after each batch, so other requests get the event loop and the database. */
    pauseMs?: number;
    onProgress?: (doneLoans: number, totalLoans: number) => void;
}

export async function loadUcrfRecords(filters: UcrfFilters, config: UcrfConfig, opts: UcrfLoadOptions = {}): Promise<UcrfRecord[]> {
    const where = buildEligibilityWhere(filters);
    const cutoffExclusive = istStart(addDays(filters.reportDate, 1));

    // Cheap id-only pass first, then heavy batches (nested select + ledger aggregation) run with
    // bounded concurrency — sequential batches took ~3s each, minutes on a full portfolio.
    const ids = (await prisma.loan.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } })).map((l) => l.id);
    const batches = Array.from(chunks(ids, opts.batchSize ?? BATCH));
    let doneLoans = 0;
    opts.onProgress?.(0, ids.length);
    const results: UcrfRecord[][] = new Array(batches.length);
    let next = 0;
    const worker = async () => {
        for (let i = next++; i < batches.length; i = next++) {
            const rows: LoanRow[] = await prisma.loan.findMany({
                where: { id: { in: batches[i] } },
                select: loanSelect,
                orderBy: { id: 'asc' },
            });
            const extras = await loadBatchExtras(rows, cutoffExclusive);
            results[i] = rows.map((row) => buildUcrfRecord(toInput(row, extras), config, filters.reportDate));
            doneLoans += rows.length;
            opts.onProgress?.(doneLoans, ids.length);
            if (opts.pauseMs) await new Promise((resolve) => setTimeout(resolve, opts.pauseMs));
        }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? CONCURRENCY, batches.length) }, worker));

    const records = results.flat();
    flagDuplicateAccounts(records);
    flagDuplicateMemberIds(records);
    return records;
}

export function applyValidityFilter(records: UcrfRecord[], validity: UcrfFilters['validity']): UcrfRecord[] {
    if (validity === 'VALID') return records.filter((r) => r.isValid);
    if (validity === 'INVALID') return records.filter((r) => !r.isValid);
    return records;
}

export function summarize(records: UcrfRecord[], reportDate: string): UcrfDatasetSummary {
    const valid = records.filter((r) => r.isValid).length;
    return {
        reportDate,
        totalMembers: new Set(records.map((r) => r.clientDbId)).size,
        totalRecords: records.length,
        validRecords: valid,
        invalidRecords: records.length - valid,
        warningRecords: records.filter((r) => r.issues.some((i) => i.severity === 'warning')).length,
    };
}

const SORTERS: Record<UcrfPageParams['sortBy'], (r: UcrfRecord) => string | number> = {
    memberId: (r) => r.memberId,
    memberName: (r) => r.memberName.toLowerCase(),
    branchName: (r) => r.branchName.toLowerCase(),
    loanNumber: (r) => r.loanNumber,
    disbursementDate: (r) => r.disbursementDate ?? '',
    disbursedAmount: (r) => r.disbursedAmount,
    outstandingBalance: (r) => r.outstandingBalance,
    overdueAmount: (r) => r.overdueAmount,
    dpd: (r) => r.dpd,
    status: (r) => (r.isValid ? 1 : 0),
};

/** Drops the 100 positional fields (PII) before a record is sent to the browser. */
function omitFields(r: UcrfRecord): Omit<UcrfRecord, "fields"> {
    const { fields, ...rest } = r;
    void fields;
    return rest;
}

export function pageRecords(records: UcrfRecord[], p: UcrfPageParams) {
    const key = SORTERS[p.sortBy];
    const dir = p.sortDir === 'desc' ? -1 : 1;
    const sorted = [...records].sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return x < y ? -dir : x > y ? dir : a.loanNumber < b.loanNumber ? -1 : 1;
    });
    const start = (p.page - 1) * p.pageSize;
    return {
        total: sorted.length,
        page: p.page,
        pageSize: p.pageSize,
        totalPages: Math.max(1, Math.ceil(sorted.length / p.pageSize)),
        // The 100 positional fields are never sent to the browser (PII); only the display columns + issues.
        rows: sorted.slice(start, start + p.pageSize).map((r) => omitFields(r)),
    };
}

// ── Result cache ─────────────────────────────────────────────────────────────────────
// Filled only by the background job (job.service.ts); summary, preview and export just read it, so none
// of them can start a full-portfolio load. Expiry slides on every read while the admin is working.
const CACHE_TTL_MS = 30 * 60_000;
// Held on globalThis: Next.js can bundle each API route separately, and the job, summary, preview and export
// routes must all see the same cache.
const g = globalThis as unknown as { __ucrfCache?: Map<string, { at: number; records: UcrfRecord[] }> };
const cache = (g.__ucrfCache ??= new Map());

export function ucrfCacheKey(filters: UcrfFilters, configVersion: string): string {
    // validity is applied after loading, so it is not part of the key.
    return JSON.stringify([{ ...filters, validity: 'ALL' }, configVersion]);
}

export function getCachedUcrfRecords(filters: UcrfFilters, configVersion: string): UcrfRecord[] | null {
    const hit = cache.get(ucrfCacheKey(filters, configVersion));
    if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) return null;
    hit.at = Date.now();
    return hit.records;
}

export function setCachedUcrfRecords(key: string, records: UcrfRecord[]): void {
    cache.set(key, { at: Date.now(), records });
    for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_TTL_MS) cache.delete(k);
    while (cache.size > 2) cache.delete(cache.keys().next().value as string);
}

export class UcrfDataNotReadyError extends Error {
    constructor() {
        super('The report data has expired or was never calculated. Click Apply Filters to calculate it again.');
    }
}
