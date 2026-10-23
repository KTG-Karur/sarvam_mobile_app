'use server';

import { prisma } from '@/app/lib/prisma';
import { format } from 'date-fns';
import { toDisplayDate } from '@/app/lib/date-format';
import { getMemberContacts, buildMemberSearchWhere } from '@/app/lib/reports/member-contacts';
import type { MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { splitRepaymentForDcb } from '@/app/lib/dcb-advance-amount';
import { buildDcbIstReportWindow, formatDcbReportPeriodIst } from '@/app/lib/dcb-report-ist';
import { aggregateDcbLoansByMeetingDate, aggregateDcbLoansToCenterMetrics, aggregateDcbByCalendarDate, DcbLoanForAggregation, PrePeriodPaidMap  } from '@/app/lib/reports/dcb-aggregation';
import { getKolkataCalendarYmd, parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { addCalendarDaysToYmd } from '@/app/lib/branch-financial-day';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getServerActionUser } from '@/app/lib/permissions/server-action-auth';
import { SYSTEM_LEDGERS } from '@/app/lib/constants/ledgers';
import { buildFunderLabel, getFunderCoreName, isGoldLoanProduct } from '@/app/lib/gl-config';
import { getBranchOpeningContext, resolveSelfAccountBridges, selfAccountOpeningAmount } from '@/app/lib/services/ledger-opening-balance';

/**
 * Format a UTC Date as "dd/MM/yyyy" in Asia/Kolkata, regardless of server timezone.
 * `format()` from date-fns uses LOCAL time and gives wrong results on UTC servers.
 * Using noon IST (T12:00:00+05:30) guarantees the date component is always correct.
 */
function fmtIstDate(utcDate: Date): string {
    const ymd = getKolkataCalendarYmd(utcDate);          // e.g. "2026-06-06" (IST calendar)
    return format(new Date(`${ymd}T12:00:00+05:30`), 'dd/MM/yyyy'); // noon IST → safe on any server TZ
}

export type CCRRow = {
    transDate: string;
    centerName: string;
    clientName: string;
    loanAmt: number;
    loanAc: string;
    // Snapshot fields
    opnArrPri: number;
    opnArrInt: number;
    curDmdPri: number;
    curDmdInt: number;
    // Calculated
    totDmdPri: number;
    totDmdInt: number;
    // Collected
    totPriColl: number;
    totIntColl: number;
    savingsAmt: number;
    // Meta
    doneAt: string;
    collType: string;
    transType: string;
    refNo: string;
    empName: string;
} & MemberContactFields;

export type CCRPageResult = {
    rows: CCRRow[];
    totalCount: number;
    totalPages: number;
    page: number;
    pageSize: number;
};

export async function getCCRData(centerId: string, fromDate: string, tillDate: string, branchId?: string, page: number = 1, pageSize: number = 25, preResolvedBranchIds?: string[] | null, search?: string | null): Promise<CCRPageResult> {
    // Server Action — called directly from client components with no API
    // route / withAuth wrapper in front of it, so auth + branch scoping must
    // happen here. `preResolvedBranchIds` lets a caller that already has an
    // authenticated, scoped branch list (e.g. the Request Report background
    // worker, which has no HTTP request/cookies to read) skip the cookie-based
    // getServerActionUser() lookup — undefined (the default) preserves the
    // original client-component call path unchanged.
    let branchIds: string[] | null;
    if (preResolvedBranchIds !== undefined) {
        branchIds = preResolvedBranchIds;
    } else {
        const user = await getServerActionUser();
        if (!user) throw new Error('Authentication required');
        branchIds = await resolveScopedBranchIds(user, branchId ?? null);
    }

    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tillDate);
    endDate.setHours(23, 59, 59, 999);

    const baseWhere: any = {
        transactionDate: {
            gte: startDate,
            lte: endDate,
        },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
    };

    if (centerId && centerId !== 'all') {
        baseWhere.centerId = centerId;
    }

    // Member name / ID / Aadhaar / mobile / co-applicant mobile — rows only; the savings
    // aggregate below is keyed per batch+loan, so unmatched members simply never look it up.
    const memberSearch = buildMemberSearchWhere(search);
    const rowsWhere = { ...baseWhere, type: { in: ['REPAYMENT', 'PRECLOSURE'] as any }, ...(memberSearch ? { client: memberSearch } : {}) };
    const savingsWhere = { ...baseWhere, type: 'SAVINGS_COLLECTION' as any };

    const clampedPage = Math.max(1, page);
    const clampedPageSize = Math.min(5000, Math.max(1, pageSize));

    // Savings amounts are computed via a separate, unpaginated aggregate — scoped to the
    // same filters — so a batch's savings row is never split from its paired REPAYMENT/
    // PRECLOSURE row across a page boundary.
    const [totalCount, transactions, savingsGroups] = await Promise.all([
        prisma.loanTransaction.count({ where: rowsWhere }),
        prisma.loanTransaction.findMany({
            where: rowsWhere,
            include: {
                client: true,
                center: true,
                loan: true,
                collectedBy: true,
            },
            orderBy: [
                { transactionDate: 'desc' },
                { id: 'asc' },
            ],
            skip: (clampedPage - 1) * clampedPageSize,
            take: clampedPageSize,
        }),
        prisma.loanTransaction.groupBy({
            by: ['batchId', 'loanId'],
            where: savingsWhere,
            _sum: { amount: true },
        }),
    ]);

    // Build savings map: batchId:loanId → savings amount
    const savingsMap = new Map<string, number>();
    for (const s of savingsGroups) {
        const key = `${s.batchId || ''}:${s.loanId}`;
        savingsMap.set(key, (savingsMap.get(key) || 0) + Number(s._sum.amount || 0));
    }
    const contactOf = await getMemberContacts({ clientIds: transactions.map((t) => t.clientId), loanIds: transactions.map((t) => t.loanId) });

    const rows = transactions.map(tx => {
        // Safe access for new fields (handle potential distinct/undefined if schema not yet updated in runtime)
        const opnArrPri = Number((tx as any).openingArrearsPrincipal || 0);
        const opnArrInt = Number((tx as any).openingArrearsInterest || 0);
        const curDmdPri = Number((tx as any).currentDemandPrincipal || 0);
        const curDmdInt = Number((tx as any).currentDemandInterest || 0);

        const totDmdPri = opnArrPri + curDmdPri;
        const totDmdInt = opnArrInt + curDmdInt;

        const totPriColl = Number(tx.principalAmount || 0);
        const totIntColl = Number(tx.interestAmount || 0);

        // Date format: DD/MM/YYYY
        // Time format: HH:MM AM/PM
        const doneAtCheck = tx.createdAt ? new Date(tx.createdAt) : new Date(); // Use created time for "Done At"
        const doneAtStr = format(doneAtCheck, 'dd/MM/yyyy hh:mm a');

        const savingsKey = `${tx.batchId || ''}:${tx.loanId}`;
        return {
            transDate: format(new Date(tx.transactionDate), 'dd/MM/yyyy'),
            centerName: tx.center?.name || 'N/A',
            clientName: `${tx.client.firstName} ${tx.client.lastName}`,
            loanAmt: Number(tx.loan.amount),
            loanAc: tx.loan.loanNumber,
            opnArrPri,
            opnArrInt,
            curDmdPri,
            curDmdInt,
            totDmdPri,
            totDmdInt,
            totPriColl,
            totIntColl,
            savingsAmt: savingsMap.get(savingsKey) || 0,
            doneAt: doneAtStr,
            collType: (tx as any).collectionType || 'Demand Collection',
            transType: tx.paymentMode === 'CASH' ? 'CASH IN HAND' : tx.paymentMode,
            refNo: tx.transactionId,
            empName: `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}`,
            ...contactOf(tx.clientId, tx.loanId),
        };
    });

    return {
        rows,
        totalCount,
        totalPages: Math.ceil(totalCount / clampedPageSize),
        page: clampedPage,
        pageSize: clampedPageSize,
    };
}

/** Per-funder principal + interest breakdown inside a DCR row. */
export type DCRFunderBreakdown = {
    funderName: string;
    /** Regular repayment principal collected for this funder's loans. */
    principal: number;
    /** Regular repayment interest collected for this funder's loans. */
    interest: number;
    /** Preclosure / foreclosure principal collected for this funder's loans. */
    preclosurePrincipal: number;
    /** Preclosure / foreclosure interest collected for this funder's loans. */
    preclosureInterest: number;
    /** Write-off closure cash collected for this funder's non-gold loans — folded into totalPrincipal/totalInterest, not shown as its own column. */
    writeOffCashPrincipal: number;
    writeOffCashInterest: number;
    /** Write-off closure cash collected for this funder's gold loans. Gold is a loan-type flag,
     *  not a separate reporting dimension — also folded into totalPrincipal/totalInterest, not
     *  shown as its own "Gold Principal/Interest" column. Kept on the breakdown for callers that
     *  need the gold-only split internally. */
    writeOffGoldPrincipal: number;
    writeOffGoldInterest: number;
    /** principal + preclosurePrincipal + writeOffCashPrincipal + writeOffGoldPrincipal */
    totalPrincipal: number;
    /** interest + preclosureInterest + writeOffCashInterest + writeOffGoldInterest */
    totalInterest: number;
};

export type DCRRow = {
    centerId: string;
    centerCode: string;
    centerName: string;
    adminFees: number;
    docCharges: number;
    insFees: number;
    savings: number;
    /** Sum of all funders' regular repayment principal (backward compat). */
    principal: number;
    /** Sum of all funders' regular repayment interest (backward compat). */
    interest: number;
    /** Sum of all funders' preclosure principal. */
    preclosurePrincipal: number;
    /** Sum of all funders' preclosure interest. */
    preclosureInterest: number;
    /** Write-off closure: cash collected (principal paid at closure). */
    writeOffPrincipal: number;
    /** Write-off closure: cash collected (interest paid at closure). */
    writeOffInterest: number;
    /** Write-off closure: principal waived (book entry, not cash). */
    writeOffWaiverPrincipal: number;
    /** Write-off closure: interest waived (book entry, not cash). */
    writeOffWaiverInterest: number;
    totalAmount: number;
    /** Keyed by a canonical funder "core name" (see getFunderCoreName in app/lib/gl-config.ts) —
     *  the funder's stored name, uppercased. A Masters record named "Own Fund - Gold" is its own
     *  distinct funder here, separate from plain "Own Fund". */
    funderBreakdown: Record<string, DCRFunderBreakdown>;
};

/** Ordered list of funders that have activity for the day — used to render dynamic columns.
 *  `id` is the canonical core-name key (see funderBreakdown above), not a literal Funder.id. */
export type DCRFunderMeta = { id: string; name: string };

export type DCRResult = {
    rows: DCRRow[];
    /** Funders with activity on this day, sorted by name. */
    funders: DCRFunderMeta[];
};

const UNKNOWN_FUNDER_NAME = 'Own Fund';

export async function getDCRData(dateStr: string, branchId?: string, centerId?: string, preResolvedBranchIds?: string[] | null): Promise<DCRResult> {
    // Server Action — called directly from a client component with no API
    // route / withAuth wrapper in front of it, so auth + branch scoping must
    // happen here. `preResolvedBranchIds` lets a caller with no HTTP request
    // context (e.g. the Request Report background worker) skip the cookie-based
    // getServerActionUser() lookup — undefined (the default) is unchanged.
    let branchIds: string[] | null;
    if (preResolvedBranchIds !== undefined) {
        branchIds = preResolvedBranchIds;
    } else {
        const user = await getServerActionUser();
        if (!user) throw new Error('Authentication required');
        branchIds = await resolveScopedBranchIds(user, branchId ?? null);
    }

    // IST-aware day bounds
    const startOfDay = parseKolkataAttendanceDateYmd(dateStr);
    const endOfDay   = new Date(parseKolkataAttendanceDateYmd(
        addCalendarDaysToYmd(dateStr, 1)
    ).getTime() - 1);

    // Fetch REPAYMENT, PRECLOSURE, WRITEOFF, FEE and SAVINGS_COLLECTION transactions for the day.
    // Include loan → funder so we can split principal/interest per funder.
    const transactions = await prisma.loanTransaction.findMany({
        where: {
            transactionDate: { gte: startOfDay, lte: endOfDay },
            isReversed: false,
            status: 'APPROVED',
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF', 'FEE', 'SAVINGS_COLLECTION'] as any },
            // Exclude rows written by the backup / loan-history-edit tool: their balance
            // effect on Loan/Client aggregates is real, but no cash was ever collected
            // through this system, so they must not inflate a day's collection figures
            // (e.g. the "Loan Advance" column double-counting phantom SAVINGS_COLLECTION
            // rows on a fully-migrated branch). This is the transaction's own flag —
            // NOT loan.isBulkMemberImport, which would wrongly drop every genuine live
            // collection on a branch that was onboarded via import.
            excludeFromEodAllocation: false,
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(centerId && centerId !== 'all' ? { centerId } : {}),
        },
        include: {
            center: true,
            loan: {
                select: {
                    funder: { select: { id: true, funderName: true } },
                    loanClosureRecord: {
                        where: { isReversed: false },
                        select: { principalWaiver: true, interestWaiver: true },
                    },
                    loanProduct: { select: { loanProductType: { select: { name: true } } } },
                },
            },
        },
    });

    // ── helpers ──────────────────────────────────────────────────────────────
    const centerMap  = new Map<string, DCRRow>();
    const funderMeta = new Map<string, DCRFunderMeta>(); // core-name key → meta

    // Registers a funder by its canonical core-name key (see getFunderCoreName in
    // app/lib/gl-config.ts — the funder's stored name, uppercased) instead of its raw Funder.id.
    // A Masters record named "Own Fund - Gold" is its own funder column, separate from plain
    // "Own Fund". (Gold as a loan *product-type* flag is still not a reporting column — that
    // split is folded into totalPrincipal/totalInterest, see writeOffGold* above.)
    const registerFunder = (rawFunderName: string): string => {
        const key = getFunderCoreName(rawFunderName);
        if (!funderMeta.has(key)) {
            funderMeta.set(key, { id: key, name: rawFunderName });
        }
        return key;
    };

    const getRow = (centerId: string, center: any): DCRRow => {
        if (!centerMap.has(centerId)) {
            centerMap.set(centerId, {
                centerId,
                centerCode: center?.code || 'N/A',
                centerName: center?.name || 'Unknown',
                adminFees: 0,
                docCharges: 0,
                insFees: 0,
                savings: 0,
                principal: 0,
                interest: 0,
                preclosurePrincipal: 0,
                preclosureInterest: 0,
                writeOffPrincipal: 0,
                writeOffInterest: 0,
                writeOffWaiverPrincipal: 0,
                writeOffWaiverInterest: 0,
                totalAmount: 0,
                funderBreakdown: {},
            });
        }
        return centerMap.get(centerId)!;
    };

    const ensureFunderSlot = (row: DCRRow, funderId: string, funderName: string): DCRFunderBreakdown => {
        if (!row.funderBreakdown[funderId]) {
            row.funderBreakdown[funderId] = {
                funderName,
                principal: 0,
                interest: 0,
                preclosurePrincipal: 0,
                preclosureInterest: 0,
                writeOffCashPrincipal: 0,
                writeOffCashInterest: 0,
                writeOffGoldPrincipal: 0,
                writeOffGoldInterest: 0,
                totalPrincipal: 0,
                totalInterest: 0,
            };
        }
        return row.funderBreakdown[funderId];
    };

    // ── process transactions ──────────────────────────────────────────────────
    for (const tx of transactions) {
        if (!tx.centerId) continue;
        const row = getRow(tx.centerId, tx.center);

        // ── SAVINGS ────────────────────────────────────────────────────────
        if ((tx.type as string) === 'SAVINGS_COLLECTION') {
            row.savings += Number(tx.amount || 0);
            continue;
        }

        // ── FEE transactions ───────────────────────────────────────────────
        if ((tx.type as string) === 'FEE') {
            const feeAmount = Number((tx as any).feesAmount || tx.amount || 0);
            const desc = ((tx as any).description || '').trim();
            if (desc === 'Document Charge Income')  row.docCharges += feeAmount;
            else if (desc === 'Member Insurance Payable') row.insFees += feeAmount;
            else if (desc === 'Client Admission Fee')     row.adminFees += feeAmount;
            continue;
        }

        // ── WRITEOFF — write-off / death closure ──────────────────────────
        if ((tx.type as string) === 'WRITEOFF') {
            const txP = Number((tx as any).principalAmount || 0);
            const txI = Number((tx as any).interestAmount  || 0);
            const waiverP = Number((tx as any).loan?.loanClosureRecord?.[0]?.principalWaiver || 0);
            const waiverI = Number((tx as any).loan?.loanClosureRecord?.[0]?.interestWaiver  || 0);
            row.writeOffPrincipal       += txP;
            row.writeOffInterest        += txI;
            row.writeOffWaiverPrincipal += waiverP;
            row.writeOffWaiverInterest  += waiverI;

            const woFunder     = (tx as any).loan?.funder;
            const woFunderName = woFunder?.funderName ?? UNKNOWN_FUNDER_NAME;
            const woFunderId   = registerFunder(woFunderName);
            const woSlot = ensureFunderSlot(row, woFunderId, woFunderName);
            if (isGoldLoanProduct((tx as any).loan?.loanProduct?.loanProductType?.name)) {
                woSlot.writeOffGoldPrincipal += txP;
                woSlot.writeOffGoldInterest  += txI;
            } else {
                woSlot.writeOffCashPrincipal += txP;
                woSlot.writeOffCashInterest  += txI;
            }
            continue;
        }

        // ── REPAYMENT / PRECLOSURE — split by funder ───────────────────────
        const funder    = (tx as any).loan?.funder;
        const funderName = funder?.funderName ?? UNKNOWN_FUNDER_NAME;
        const funderId  = registerFunder(funderName);

        const slot = ensureFunderSlot(row, funderId, funderName);
        const txP  = Number((tx as any).principalAmount || 0);
        const txI  = Number((tx as any).interestAmount  || 0);

        if ((tx.type as string) === 'REPAYMENT') {
            slot.principal += txP;
            slot.interest  += txI;
            row.principal  += txP;
            row.interest   += txI;
        } else {
            // PRECLOSURE
            slot.preclosurePrincipal += txP;
            slot.preclosureInterest  += txI;
            row.preclosurePrincipal  += txP;
            row.preclosureInterest   += txI;
        }
    }

    // ── finalize ─────────────────────────────────────────────────────────────
    for (const row of centerMap.values()) {
        // Compute totalPrincipal / totalInterest per funder slot. Gold write-off cash is folded
        // in here too — gold is a loan-type flag, not a separate reporting column, so it must
        // show up under the same Principal/Interest total as any other collection.
        for (const slot of Object.values(row.funderBreakdown)) {
            slot.totalPrincipal = slot.principal + slot.preclosurePrincipal + slot.writeOffCashPrincipal + slot.writeOffGoldPrincipal;
            slot.totalInterest  = slot.interest  + slot.preclosureInterest  + slot.writeOffCashInterest  + slot.writeOffGoldInterest;
        }

        row.totalAmount = Math.round(
            row.adminFees + row.docCharges + row.insFees
            + row.principal + row.interest
            + row.preclosurePrincipal + row.preclosureInterest
            + row.writeOffPrincipal + row.writeOffInterest
            + row.savings
        );
    }

    const funders = Array.from(funderMeta.values()).sort((a, b) => a.name.localeCompare(b.name));
    const rows    = Array.from(centerMap.values()).sort((a, b) => a.centerName.localeCompare(b.centerName));

    return { rows, funders };
}

export type DCBRow = {
    branchCode: string;
    branchName: string;
    reportPeriodIst: string;
    meetingDate: string;
    centerCode: string;
    centerName: string;
    fdoName: string;

    // Opening Arrear
    openingArr: number;
    openingArrPrincipal: number;
    openingArrInterest: number;

    // Current Demand
    demand: number;
    demandPrincipal: number;
    demandInterest: number;

    // Collections — 5 categories P+I each
    arrearCollPrincipal: number;
    arrearCollInterest: number;
    currDemandCollPrincipal: number;
    currDemandCollInterest: number;
    advanceCollPrincipal: number;
    advanceCollInterest: number;
    preclosurePrincipal: number;
    preclosureInterest: number;
    odArrearCollPrincipal: number;
    odArrearCollInterest: number;
    totalCollPrincipal: number;
    totalCollInterest: number;

    // Current Arrear
    currArrearPrincipal: number;
    currArrearInterest: number;
    todayPendingPrincipal: number;
    todayPendingInterest: number;

    // Closing Arrear
    closingArrPrincipal: number;
    closingArrInterest: number;

    /** Write-off closure cash collected (principal paid at closure). */
    writeOffPrincipalColl: number;
    /** Write-off closure cash collected (interest paid at closure). */
    writeOffInterestColl: number;
    /** Write-off closure principal waived (book entry). */
    writeOffWaiverPrincipal: number;
    /** Write-off closure interest waived (book entry). */
    writeOffWaiverInterest: number;

    /** RR % = (Curr Demand Coll P+I) / (Current Demand P+I) × 100 */
    recPercentage: number;

    // Backward-compat combined fields (used by legacy export / print paths)
    currCollection: number;
    advanceColl: number;
    preclosure: number;
    totalColl: number;
    currArrear: number;
    todayPending: number;
    closingArr: number;
    currArrColl: number;
    opnArrColl: number;
    savingsColl: number;
};

async function getDcbReportAuthContext(
    requestedBranchId?: string | null,
    preResolvedBranchIds?: string[] | null
): Promise<{
    userId: string;
    role: string;
    /** Scoped branchIds for this caller (narrowed by requestedBranchId when permitted) — null means unrestricted (Head Office ADMIN, no branch requested). */
    branchIds: string[] | null;
} | null> {
    // `preResolvedBranchIds` lets a caller with no HTTP request context (e.g. the
    // Request Report background worker) skip the cookie-based getServerActionUser()
    // lookup — undefined (the default) preserves the original behavior unchanged.
    if (preResolvedBranchIds !== undefined) {
        return { userId: 'system', role: 'SYSTEM', branchIds: preResolvedBranchIds };
    }
    const payload = await getServerActionUser();
    if (!payload) return null;
    const branchIds = await resolveScopedBranchIds(payload, requestedBranchId ?? null);
    return { userId: payload.userId, role: payload.role, branchIds };
}

/**
 * DCB (Demand Collection Balance) by center for the logged-in branch.
 * Branch Managers and Area Managers are restricted to their resolved branch; data is DB-driven (IST window).
 */
export async function getDCBData1(fromDate: string, tillDate: string): Promise<DCBRow[]> {
    const ist = buildDcbIstReportWindow(fromDate, tillDate);
    const reportPeriodIst = formatDcbReportPeriodIst(ist.fromYmd, ist.tillYmd);

    /**
     * Fetch all active disbursed loans with schedules and approved transactions.
     * Transaction lines are included so the aggregation can determine per-installment
     * payment timing (needed to correctly classify currArrColl vs currCollection).
     */
    // Include loans that are active OR were closed via foreclosure within any period
    // (getDCBData1 has no date window on transactions, so we use closedDate as the proxy).
    // Foreclosure approval sets isActive=false; without this OR the preclosure row is invisible.
    const loans = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            OR: [
                { isActive: true },
                {
                    isActive: false,
                    transactions: {
                        some: {
                            type: 'PRECLOSURE',
                            isReversed: false,
                            status: 'APPROVED',
                        },
                    },
                },
            ],
        },
        include: {
            client: {
                include: {
                    center: {
                        include: {
                            branch: true,
                            fdo: true,
                        },
                    },
                },
            },
            schedules: {
                orderBy: { dueDate: 'asc' },
            },
            transactions: {
                where: {
                    isReversed: false,
                    status: 'APPROVED',
                    type: { in: ['REPAYMENT', 'PRECLOSURE', 'SAVINGS_COLLECTION'] },
                },
                orderBy: { transactionDate: 'asc' },
                include: {
                    // Per-installment lines — required for currArrColl and advance detection
                    lines: {
                        include: { schedule: true },
                    },
                },
            },
        },
    });

    // Delegate all aggregation logic to the canonical, tested module
    const centerMetrics = aggregateDcbLoansToCenterMetrics(loans, ist);

    // Map to the DCBRow shape (DcbCenterMetrics does not track P+I split — zero them)
    return centerMetrics.map((m) => ({
        branchCode: m.branchCode,
        branchName: m.branchName,
        reportPeriodIst,
        meetingDate: m.meetingDate,
        centerCode: m.centerCode,
        centerName: m.centerName,
        fdoName: m.fdoName,
        openingArr: m.openingArr, openingArrPrincipal: 0, openingArrInterest: 0,
        demand: m.demand, demandPrincipal: 0, demandInterest: 0,
        arrearCollPrincipal: 0, arrearCollInterest: 0,
        currDemandCollPrincipal: 0, currDemandCollInterest: 0,
        advanceCollPrincipal: 0, advanceCollInterest: 0,
        preclosurePrincipal: 0, preclosureInterest: 0,
        writeOffPrincipalColl: 0, writeOffInterestColl: 0,
        writeOffWaiverPrincipal: 0, writeOffWaiverInterest: 0,
        odArrearCollPrincipal: 0, odArrearCollInterest: 0,
        totalCollPrincipal: 0, totalCollInterest: 0,
        currArrearPrincipal: 0, currArrearInterest: 0,
        todayPendingPrincipal: 0, todayPendingInterest: 0,
        closingArrPrincipal: 0, closingArrInterest: 0,
        recPercentage: m.recPercentage,
        currCollection: m.currCollection,
        advanceColl: m.advanceColl,
        preclosure: m.preclosure,
        totalColl: m.totalColl,
        currArrear: m.currArrear,
        todayPending: m.todayPending,
        closingArr: m.closingArr,
        currArrColl: m.currArrColl,
        opnArrColl: m.opnArrColl,
        savingsColl: m.savingsColl,
    }));
}


// ========== MAIN EXPORT FUNCTION ==========
export async function getDCBData(fromDate: string, tillDate: string, branchId?: string, centerId?: string, preResolvedBranchIds?: string[] | null): Promise<DCBRow[]> {
  try {
    // Validate input format (expected: yyyy-MM-dd, IST calendar date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(tillDate)) {
      throw new Error('Invalid date format — expected yyyy-MM-dd');
    }

    // Branch scoping — this Server Action is called directly from the client
    // (no API route / withAuth wrapper in front of it), so auth + branch
    // restriction must happen here. BM/FDO: own branch only. AREA_MANAGER:
    // their assigned branches. ADMIN: unrestricted unless on an active branch.
    const authContext = await getDcbReportAuthContext(branchId ?? null, preResolvedBranchIds);
    if (!authContext) {
      throw new Error('Authentication required');
    }
    const branchIds = authContext.branchIds;

    // IST-aware UTC bounds:
    //   new Date('2026-06-17') = 2026-06-17T00:00:00Z (UTC midnight) which is 05:30 IST,
    //   so a plain "midnight UTC lte" cuts off all IST transactions made after 05:30 IST.
    //   Fix: anchor to IST midnight (UTC-5:30) for start and IST 23:59:59 for end.
    const from = new Date(`${fromDate}T00:00:00+05:30`);         // IST day start → UTC
    const till = new Date(`${tillDate}T23:59:59.999+05:30`);     // IST day end   → UTC

    if (isNaN(from.getTime()) || isNaN(till.getTime())) {
      throw new Error('Invalid date value');
    }

    // Use the raw IST yyyy-MM-dd strings for schedule/aggregation comparisons
    // (scheduleDueKolkataYmd and getKolkataCalendarYmd already return yyyy-MM-dd in IST)
    const fromYmd = fromDate;
    const tillYmd = tillDate;
    
    // ── Pre-period paid: how much was paid toward each schedule BEFORE fromYmd ─
    // schedule.principalPaid is all-time total (includes period payments), so we
    // can't use it directly for opening arrear. This groupBy gives exact per-schedule
    // amounts paid in approved transactions that pre-date the report start.
    const prePeriodLineRows = await prisma.loanTransactionLine.groupBy({
      by: ['scheduleId'],
      where: {
        // no scheduleId filter here — null rows filtered out in JS below
        transaction: {
          isReversed: false,
          status: 'APPROVED',
          type: { in: ['REPAYMENT', 'PRECLOSURE'] },
          transactionDate: { lt: from },   // strictly BEFORE the period
          // Include foreclosed loans (isActive=false) — foreclosure sets isActive=false but
          // their pre-period REPAYMENT lines are still valid for opening arrear computation.
          loan: {
            disbursementStatus: 'DISBURSED',
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(centerId && centerId !== 'all' ? { centerId } : {}),
          },
        },
      },
      _sum: { principalAmount: true, interestAmount: true },
    });
    const prePeriodPaidBySchedule: PrePeriodPaidMap = new Map(
      prePeriodLineRows
        .filter(r => r.scheduleId != null)
        .map(r => [
          r.scheduleId!,
          {
            P: Number(r._sum?.principalAmount ?? 0),
            I: Number(r._sum?.interestAmount ?? 0),
          },
        ])
    );

    // Fetch loans data.
    // Include loans that are currently active (isActive: true) OR loans that were closed
    // during this report period — either via foreclosure (isActive: false, disbursementStatus
    // still DISBURSED, APPROVED PRECLOSURE transaction within [from, till]) or via the Close
    // Loans tab with any reason — DEAD, OTHERS, or WRITEOFF (isActive: false, disbursementStatus
    // CLOSED, APPROVED WRITEOFF transaction within [from, till]). Whatever cash was actually
    // collected at closure (regardless of reason) is split into Arrear Coll + Preclosure the
    // same way a true Pre-Closure is — see splitPreclosureArrearVsBalance in
    // dcb-aggregation.ts; only the waiver portion (never part of the transaction's own amount)
    // is tracked separately below via writeOffTxns.
    // Without this, closed loans are invisible in DCB because closure sets isActive=false.
    const loans = await prisma.loan.findMany({
      where: {
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(centerId && centerId !== 'all' ? { centerId } : {}),
        OR: [
          { disbursementStatus: 'DISBURSED', isActive: true },
          {
            disbursementStatus: 'DISBURSED',
            isActive: false,
            transactions: {
              some: {
                type: 'PRECLOSURE',
                isReversed: false,
                status: 'APPROVED',
                transactionDate: { gte: from, lte: till },
              },
            },
          },
          {
            disbursementStatus: 'CLOSED',
            isActive: false,
            transactions: {
              some: {
                type: 'WRITEOFF',
                isReversed: false,
                status: 'APPROVED',
                transactionDate: { gte: from, lte: till },
              },
            },
          },
        ],
      },
      include: {
        client: {
          include: {
            center: {
              include: {
                branch: true,
                fdo: true,
              },
            },
          },
        },
        schedules: {
          orderBy: { dueDate: 'asc' },
        },
        transactions: {
          where: {
            isReversed: false,
            status: 'APPROVED',
            type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
            transactionDate: {
              gte: from,
              lte: till,
            },
          },
          orderBy: { transactionDate: 'asc' },
          include: {
            lines: {
              include: { schedule: true },
            },
          },
        },
      },
    });

    // Transform to DcbLoanForAggregation format
    const formattedLoans: DcbLoanForAggregation[] = loans.map(loan => ({
      schedules: loan.schedules.map(s => ({
        id: s.id,          // required for accurate opening-arrear via prePeriodPaidBySchedule
        dueDate: s.dueDate,
        principalDue: s.principalDue,
        principalPaid: s.principalPaid,
        interestDue: s.interestDue,
        interestPaid: s.interestPaid,
      })),
      transactions: loan.transactions.map(t => ({
        type: t.type,
        transactionDate: t.transactionDate,
        principalAmount: t.principalAmount,
        interestAmount: t.interestAmount,
        amount: t.amount,
        collectionType: t.collectionType,
        lines: t.lines.map(l => ({
          principalAmount: l.principalAmount,
          interestAmount: l.interestAmount,
          schedule: l.schedule ? {
            dueDate: l.schedule.dueDate
          } : null,
        })),
      })),
      client: {
        center: loan.client.center ? {
          id: loan.client.center?.id,
          code: loan.client.center?.code,
          name: loan.client.center?.name,
          meetingDay: loan.client.center?.meetingDay,
          nextMeetingDate: loan.client.center?.nextMeetingDate,
          branch: loan.client.center?.branch ? { name: loan.client.center?.branch.name, code: loan.client.center?.branch.code } : null,
          fdo: loan.client.center?.fdo ? {
            firstName: loan.client.center?.fdo.firstName,
            lastName: loan.client.center?.fdo.lastName,
          } : null,
        } : null,
      },
    }));
    
    // Aggregate by actual calendar due/collection date
    const dateWiseMetrics = aggregateDcbByCalendarDate(formattedLoans, fromYmd, tillYmd, prePeriodPaidBySchedule);

    // ── Write-off amounts: query loanTransaction (same source as DCR) ──────────
    // Previous approach queried loan.closedDate and built a woMap keyed by
    // "centerName::yyyy-MM-dd" but the lookup used the formatted "code - name"
    // centerName and dd/MM/yyyy date — so woMap.get() always returned undefined
    // and all four WO columns were always 0.  Now we query the transaction table
    // directly (matching DCR) and key by centerId::dd/MM/yyyy.
    const writeOffTxns = await prisma.loanTransaction.findMany({
      where: {
        transactionDate: { gte: from, lte: till },
        isReversed: false,
        status: 'APPROVED',
        type: 'WRITEOFF' as any,
      },
      select: {
        principalAmount: true,
        interestAmount: true,
        transactionDate: true,
        center: {
          select: {
            id: true,
            code: true,
            name: true,
            branch: { select: { name: true, code: true } },
            fdo: { select: { firstName: true, lastName: true } },
          },
        },
        loan: {
          select: {
            loanClosureRecord: {
              where: { isReversed: false },
              select: { principalWaiver: true, interestWaiver: true },
            },
          },
        },
      },
    });

    // Convert UTC Date → "dd/MM/yyyy" in IST — matches DateWiseMetrics.meetingDate format.
    const istDdMmYyyy = (dt: Date): string => {
      const ist = new Date(dt.getTime() + 5.5 * 3600 * 1000);
      const dd  = String(ist.getUTCDate()).padStart(2, '0');
      const mm  = String(ist.getUTCMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${ist.getUTCFullYear()}`;
    };

    type WriteOffEntry = {
      paidP: number; paidI: number; waiverP: number; waiverI: number;
      branchCode: string; branchName: string; fdoName: string; centerCode: string; centerName: string; meetingDate: string;
    };
    const woMap = new Map<string, WriteOffEntry>();
    for (const wt of writeOffTxns) {
      if (!wt.center) continue;
      const dateStr = istDdMmYyyy(wt.transactionDate);
      // Key: centerId::dd/MM/yyyy — matches m.centerId and m.meetingDate in DateWiseMetrics
      const key   = `${wt.center.id}::${dateStr}`;
      const entry = woMap.get(key) ?? {
        paidP: 0, paidI: 0, waiverP: 0, waiverI: 0,
        branchCode:  wt.center.branch?.code ?? 'N/A',
        branchName:  wt.center.branch?.name ?? 'N/A',
        fdoName:     wt.center.fdo
                       ? `${wt.center.fdo.firstName} ${wt.center.fdo.lastName}`
                       : 'Unassigned',
        centerCode:  wt.center.code || 'N/A',
        centerName:  `${wt.center.code || ''} - ${wt.center.name || 'Unknown'}`,
        meetingDate: dateStr,
      };
      // Cash actually collected at closure — any reason (DEAD/OTHERS/WRITEOFF) — is split
      // into Arrear Coll + Preclosure by aggregateDcbByCalendarDate, same treatment as a
      // true Pre-Closure, so it's intentionally NOT added to entry.paidP/paidI here (this
      // column now only ever holds the waiver). The waiver always means "not collected"
      // regardless of reason, so it still stays in this column for all three.
      entry.waiverP += Number(wt.loan?.loanClosureRecord?.[0]?.principalWaiver ?? 0);
      entry.waiverI += Number(wt.loan?.loanClosureRecord?.[0]?.interestWaiver  ?? 0);
      woMap.set(key, entry);
    }

    // Build base rows from aggregated demand/collection data; merge write-off amounts.
    // Track consumed write-off keys so we can emit orphan rows below.
    const usedWoKeys = new Set<string>();
    const baseRows = dateWiseMetrics.map((m) => {
      const woKey = `${m.centerId}::${m.meetingDate}`;
      const wo = woMap.get(woKey) ?? { paidP: 0, paidI: 0, waiverP: 0, waiverI: 0 };
      if (woMap.has(woKey)) usedWoKeys.add(woKey);
      return {
        branchCode: m.branchCode,
        branchName: m.branchName,
        reportPeriodIst: m.meetingDate,
        meetingDate: m.meetingDate,
        centerCode: m.centerCode,
        centerName: m.centerName,
        fdoName: m.fdoName,
        openingArr: m.openingArr,
        openingArrPrincipal: m.openingArrPrincipal,
        openingArrInterest: m.openingArrInterest,
        demand: m.demand,
        demandPrincipal: m.demandPrincipal,
        demandInterest: m.demandInterest,
        arrearCollPrincipal: m.arrearCollPrincipal,
        arrearCollInterest: m.arrearCollInterest,
        currDemandCollPrincipal: m.currDemandCollPrincipal,
        currDemandCollInterest: m.currDemandCollInterest,
        advanceCollPrincipal: m.advanceCollPrincipal,
        advanceCollInterest: m.advanceCollInterest,
        preclosurePrincipal: m.preclosurePrincipal,
        preclosureInterest: m.preclosureInterest,
        odArrearCollPrincipal: m.odArrearCollPrincipal,
        odArrearCollInterest: m.odArrearCollInterest,
        totalCollPrincipal: m.totalCollPrincipal,
        totalCollInterest: m.totalCollInterest,
        currArrearPrincipal: m.currArrearPrincipal,
        currArrearInterest: m.currArrearInterest,
        todayPendingPrincipal: m.todayPendingPrincipal,
        todayPendingInterest: m.todayPendingInterest,
        closingArrPrincipal: m.closingArrPrincipal,
        closingArrInterest: m.closingArrInterest,
        writeOffPrincipalColl: wo.paidP,
        writeOffInterestColl: wo.paidI,
        writeOffWaiverPrincipal: wo.waiverP,
        writeOffWaiverInterest: wo.waiverI,
        recPercentage: Number(m.recPercentage.toFixed(2)),
        // Combined backward-compat
        currCollection: m.currCollection,
        advanceColl: m.advanceColl,
        preclosure: m.preclosure,
        totalColl: m.totalColl,
        currArrear: m.currArrear,
        todayPending: m.todayPending,
        closingArr: m.closingArr,
        currArrColl: m.currArrColl,
        opnArrColl: m.opnArrColl,
        savingsColl: 0,
      };
    });

    // Emit standalone rows for write-offs whose center had no DISBURSED-loan
    // schedule or collection on the closure date (no base row to merge into).
    const extraRows: (typeof baseRows)[number][] = [];
    for (const [mapKey, wo] of woMap) {
      if (usedWoKeys.has(mapKey)) continue;
      extraRows.push({
        branchCode: wo.branchCode,
        branchName: wo.branchName,
        reportPeriodIst: wo.meetingDate,
        meetingDate: wo.meetingDate,
        centerCode: wo.centerCode,
        centerName: wo.centerName,
        fdoName: wo.fdoName,
        openingArr: 0, openingArrPrincipal: 0, openingArrInterest: 0,
        demand: 0, demandPrincipal: 0, demandInterest: 0,
        arrearCollPrincipal: 0, arrearCollInterest: 0,
        currDemandCollPrincipal: 0, currDemandCollInterest: 0,
        advanceCollPrincipal: 0, advanceCollInterest: 0, advanceColl: 0,
        preclosurePrincipal: 0, preclosureInterest: 0, preclosure: 0,
        odArrearCollPrincipal: 0, odArrearCollInterest: 0,
        totalCollPrincipal: 0, totalCollInterest: 0, totalColl: 0,
        currCollection: 0, currArrColl: 0, opnArrColl: 0,
        currArrear: 0, currArrearPrincipal: 0, currArrearInterest: 0,
        todayPending: 0, todayPendingPrincipal: 0, todayPendingInterest: 0,
        closingArr: 0, closingArrPrincipal: 0, closingArrInterest: 0,
        writeOffPrincipalColl: wo.paidP,
        writeOffInterestColl: wo.paidI,
        writeOffWaiverPrincipal: wo.waiverP,
        writeOffWaiverInterest: wo.waiverI,
        recPercentage: 0,
        savingsColl: 0,
      });
    }

    return [...baseRows, ...extraRows];
    
  } catch (error) {
    console.error('Error in getDCBData:', error);
    throw new Error(`Failed to fetch DCB report data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}


export type AgewiseArrearRow = {
    branchName: string;
    centerName: string;
    /** Client's internal id — for distinct member counting (one client can have several loans). */
    clientId: string;
    clientName: string;
    phone: string;
    loanAccount: string;
    loanAmount: number;
    priBalance: number;
    totalDues: number;
    disbursalDate: string;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days91to180: number;
    above180: number;
    arrearPri: number;
    arrearInt: number;
    totalArrear: number;
    fdoName: string;
};

export async function getAgewiseArrearData(
    reportDate: string,
    centerId?: string,
    branchId?: string | string[]
): Promise<AgewiseArrearRow[]> {
    // IST-anchored boundary — avoids server-timezone drift from a bare `new Date(reportDate)`.
    const asOfDate = new Date(`${reportDate}T23:59:59.999+05:30`);

    // Build where clause for loans
    const whereClause: any = {
        disbursementStatus: 'DISBURSED',
        isActive: true,
    };

    if (centerId && centerId !== 'all') {
        whereClause.centerId = centerId;
    }

    if (branchId && (!Array.isArray(branchId) || branchId.length > 0)) {
        whereClause.branchId = Array.isArray(branchId) ? { in: branchId } : branchId;
    }

    // Fetch all disbursed loans with ALL their schedules (not just overdue ones) —
    // needed so principal collected-to-date (below) can include payments applied
    // against not-yet-due schedules (advance/early collection), same as PAR.
    const loans = await prisma.loan.findMany({
        where: whereClause,
        include: {
            client: {
                include: {
                    center: {
                        include: {
                            branch: true,
                            fdo: true,
                        },
                    },
                },
            },
            schedules: {
                orderBy: {
                    dueDate: 'asc',
                },
            },
        },
    });

    // Resolve each distinct branch's EOD-processed working date. A branch's
    // `currentWorkingDate` is its still-open business day — dues before it are
    // genuinely closed-out arrears, dues on or after it are still current demand
    // until that branch's EOD closes them out. Capped at reportDate (never pushed
    // later), so picking a historical reportDate is unaffected by today's EOD status.
    const distinctBranchIds = [...new Set(loans.map((l) => l.branchId))];
    const branchEntries = await Promise.all(
        distinctBranchIds.map(async (bId) => {
            try {
                const window = await getBranchWorkingDayWindow({ branchId: bId });
                return [bId, window.workingDateYmd] as const;
            } catch {
                return null; // no BranchLock row yet (new branch) — falls back to reportDate
            }
        })
    );
    const branchWorkingYmdMap = new Map(
        branchEntries.filter((e): e is readonly [string, string] => e !== null)
    );

    // Per-loan effective "as of" ymd, capped by this loan's branch EOD cutoff.
    const loanEffectiveYmd = new Map<string, string>();
    const scheduleIdsByCutoffExclusiveYmd = new Map<string, string[]>();
    for (const loan of loans) {
        const branchWorkingYmd = branchWorkingYmdMap.get(loan.branchId);
        const effectiveYmd = branchWorkingYmd && branchWorkingYmd < reportDate ? branchWorkingYmd : reportDate;
        loanEffectiveYmd.set(loan.id, effectiveYmd);
        const cutoffExclusiveYmd = addCalendarDaysToYmd(effectiveYmd, 1);
        const ids = scheduleIdsByCutoffExclusiveYmd.get(cutoffExclusiveYmd) ?? [];
        for (const s of loan.schedules) ids.push(s.id);
        scheduleIdsByCutoffExclusiveYmd.set(cutoffExclusiveYmd, ids);
    }

    // Ledger-derived "paid as of" amounts per schedule, from LoanTransactionLine
    // (the source of truth) rather than LoanSchedule.principalPaid/interestPaid —
    // those live cumulative fields can drift from the actual transaction-line
    // history (same confirmed drift PAR/getMISDetailedAgewiseArrearData works
    // around). One groupBy per distinct effective cutoff, batched.
    // Postgres caps a prepared statement at 32767 bind variables — a single cutoff bucket
    // can hold every schedule of every currently-disbursed loan (they all share today's
    // effectiveYmd), which comfortably exceeds that once the portfolio grows large enough.
    // Chunk the `in` list so no single query's bind count can approach the limit.
    const SCHEDULE_ID_CHUNK_SIZE = 20000;
    const ledgerPaidBySchedule = new Map<string, { principal: number; interest: number }>();
    for (const [cutoffExclusiveYmd, scheduleIds] of scheduleIdsByCutoffExclusiveYmd) {
        if (scheduleIds.length === 0) continue;
        const cutoffExclusiveUtc = parseKolkataAttendanceDateYmd(cutoffExclusiveYmd);
        for (let i = 0; i < scheduleIds.length; i += SCHEDULE_ID_CHUNK_SIZE) {
            const chunk = scheduleIds.slice(i, i + SCHEDULE_ID_CHUNK_SIZE);
            const lineSums = await prisma.loanTransactionLine.groupBy({
                by: ['scheduleId'],
                where: {
                    scheduleId: { in: chunk },
                    transaction: {
                        transactionDate: { lt: cutoffExclusiveUtc },
                        status: 'APPROVED',
                        isReversed: false,
                        type: { in: ['REPAYMENT', 'PRECLOSURE'] },
                    },
                },
                _sum: { principalAmount: true, interestAmount: true },
            });
            for (const r of lineSums) {
                if (!r.scheduleId) continue;
                ledgerPaidBySchedule.set(r.scheduleId, {
                    principal: Number(r._sum.principalAmount ?? 0),
                    interest: Number(r._sum.interestAmount ?? 0),
                });
            }
        }
    }

    const arrearRows: AgewiseArrearRow[] = [];

    for (const loan of loans) {
        // Skip if no schedules at all
        if (loan.schedules.length === 0) continue;

        // This branch's EOD-processed cutoff, capped at reportDate.
        const effectiveYmd = loanEffectiveYmd.get(loan.id)!;
        const asOfLoanDate = effectiveYmd === reportDate ? asOfDate : new Date(`${effectiveYmd}T23:59:59.999+05:30`);

        // Calculate arrears by aging buckets
        let days1to30 = 0;
        let days31to60 = 0;
        let days61to90 = 0;
        let days91to180 = 0;
        let above180 = 0;
        let arrearPri = 0;
        let arrearInt = 0;
        let principalCollected = 0;

        for (const schedule of loan.schedules) {
            const ledgerPaid = ledgerPaidBySchedule.get(schedule.id) ?? { principal: 0, interest: 0 };
            principalCollected += ledgerPaid.principal;

            const dueDate = new Date(schedule.dueDate);
            const daysPastDue = Math.floor(
                (asOfLoanDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
            );

            // Skip today's (or not-yet-due) schedule — it is not yet an arrear
            // (daysPastDue <= 0). A schedule becomes an arrear only after the due
            // date has fully passed (daysPastDue >= 1).
            if (daysPastDue < 1) continue;

            // Calculate unpaid amounts from the ledger-derived paid amounts
            const unpaidPrincipal = Number(schedule.principalDue) - ledgerPaid.principal;
            const unpaidInterest = Number(schedule.interestDue) - ledgerPaid.interest;
            const totalUnpaid = unpaidPrincipal + unpaidInterest;

            // Skip if fully paid
            if (totalUnpaid <= 0) continue;

            // Accumulate total arrears
            arrearPri += unpaidPrincipal;
            arrearInt += unpaidInterest;

            // Categorize by aging bucket
            if (daysPastDue >= 1 && daysPastDue <= 30) {
                days1to30 += totalUnpaid;
            } else if (daysPastDue >= 31 && daysPastDue <= 60) {
                days31to60 += totalUnpaid;
            } else if (daysPastDue >= 61 && daysPastDue <= 90) {
                days61to90 += totalUnpaid;
            } else if (daysPastDue >= 91 && daysPastDue <= 180) {
                days91to180 += totalUnpaid;
            } else if (daysPastDue > 180) {
                above180 += totalUnpaid;
            }
        }

        // Only include loans with actual arrears
        const totalArrear = arrearPri + arrearInt;
        if (totalArrear <= 0) continue;

        // Calculate principal balance (loan amount - ledger-derived principal collected to date)
        const priBalance = Number(loan.amount) - principalCollected;

        // Get disbursement date from the first transaction or use a default
        const disbursalDate = loan.disbursedLevel1At
            ? format(new Date(loan.disbursedLevel1At), 'dd/MM/yyyy')
            : 'N/A';

        arrearRows.push({
            branchName: `${loan.client.center?.branch.code} - ${loan.client.center?.branch.name}`,
            centerName: `${loan.client.center?.code} - ${loan.client.center?.name}`,
            clientId: loan.client.id,
            clientName: `${loan.client.clientId} - ${loan.client.firstName} ${loan.client.lastName}`,
            phone: loan.client.phone || loan.client.mobileNumber || 'N/A',
            loanAccount: loan.loanNumber,
            loanAmount: Number(loan.amount),
            priBalance: priBalance,
            totalDues: loan.tenureMonths,
            disbursalDate: disbursalDate,
            days1to30: Math.round(days1to30),
            days31to60: Math.round(days31to60),
            days61to90: Math.round(days61to90),
            days91to180: Math.round(days91to180),
            above180: Math.round(above180),
            arrearPri: Math.round(arrearPri),
            arrearInt: Math.round(arrearInt),
            totalArrear: Math.round(totalArrear),
            fdoName: loan.client.center?.fdo
                ? `${loan.client.center?.fdo.firstName} ${loan.client.center?.fdo.lastName}`
                : 'Unassigned',
        });
    }

    // Sort by total arrear descending (highest arrears first)
    return arrearRows.sort((a, b) => b.totalArrear - a.totalArrear);
}

// ─── MIS AGEWISE ARREAR (Aggregated views) ───────────────────────────────────

export type MISAgewiseReportType = 'BRANCHWISE' | 'CENTERWISE' | 'FDOWISE' | 'CLIENTWISE';

export type MISAgewiseBaseRow = {
    branchName: string;
    loanAmount: number;
    priBalance: number;
    arrear1To30: number;
    arrear31To60: number;
    arrear61To90: number;
    arrear91To180: number;
    arrearAbove180: number;
    arrearPri: number;
    arrearInt: number;
    arrearTotal: number;
};

export type MISAgewiseBranchwiseRow = MISAgewiseBaseRow & {
    numCenters: number;
    numClients: number;
};

export type MISAgewiseCenterwiseRow = MISAgewiseBaseRow & {
    centerName: string;
    numClients: number;
};

export type MISAgewiseFDOwiseRow = MISAgewiseBaseRow & {
    fdoName: string;
    numCenters: number;
    numClients: number;
};

export type MISAgewiseClientwiseRow = MISAgewiseBaseRow & {
    centerName: string;
    clientName: string;
    phone: string;
    loanAccount: string;
    totalDues: number;
    disbursalDate: string;
    fdoName: string;
};

export type MISAgewiseArrearTotals = {
    totalLoanAmount: number;
    totalPriBalance: number;
    total1To30: number;
    total31To60: number;
    total61To90: number;
    total91To180: number;
    totalAbove180: number;
    totalArrearPri: number;
    totalArrearInt: number;
    totalArrear: number;
    totalCenters: number;
    totalClients: number;
};

export type MISAgewiseArrearResult = {
    data: (MISAgewiseBranchwiseRow | MISAgewiseCenterwiseRow | MISAgewiseFDOwiseRow | MISAgewiseClientwiseRow)[];
    totals: MISAgewiseArrearTotals;
    reportType: MISAgewiseReportType;
};

/**
 * Get Agewise Arrear data aggregated by the requested report type.
 * Reuses the existing getAgewiseArrearData (client-level) and aggregates in-memory.
 */
export async function getMISAgewiseArrearData(
    reportDate: string,
    reportType: MISAgewiseReportType,
    branchId?: string | string[],
    centerId?: string
): Promise<MISAgewiseArrearResult> {
    // Fetch all client-level arrear data
    const clientRows = await getAgewiseArrearData(reportDate, centerId, branchId);

    // Helper to compute totals from any array of base rows
    const computeTotals = (rows: MISAgewiseBaseRow[], centerCount: number, clientCount: number): MISAgewiseArrearTotals => ({
        totalLoanAmount: rows.reduce((s, r) => s + r.loanAmount, 0),
        totalPriBalance: rows.reduce((s, r) => s + r.priBalance, 0),
        total1To30: rows.reduce((s, r) => s + r.arrear1To30, 0),
        total31To60: rows.reduce((s, r) => s + r.arrear31To60, 0),
        total61To90: rows.reduce((s, r) => s + r.arrear61To90, 0),
        total91To180: rows.reduce((s, r) => s + r.arrear91To180, 0),
        totalAbove180: rows.reduce((s, r) => s + r.arrearAbove180, 0),
        totalArrearPri: rows.reduce((s, r) => s + r.arrearPri, 0),
        totalArrearInt: rows.reduce((s, r) => s + r.arrearInt, 0),
        totalArrear: rows.reduce((s, r) => s + r.arrearTotal, 0),
        totalCenters: centerCount,
        totalClients: clientCount,
    });

    if (reportType === 'CLIENTWISE') {
        // Map directly from raw rows
        const data: MISAgewiseClientwiseRow[] = clientRows.map(r => ({
            branchName: r.branchName,
            centerName: r.centerName,
            clientName: r.clientName,
            phone: r.phone,
            loanAccount: r.loanAccount,
            loanAmount: r.loanAmount,
            priBalance: r.priBalance,
            totalDues: r.totalDues,
            disbursalDate: r.disbursalDate,
            arrear1To30: r.days1to30,
            arrear31To60: r.days31to60,
            arrear61To90: r.days61to90,
            arrear91To180: r.days91to180,
            arrearAbove180: r.above180,
            arrearPri: r.arrearPri,
            arrearInt: r.arrearInt,
            arrearTotal: r.totalArrear,
            fdoName: r.fdoName,
        }));

        const uniqueCenters = new Set(clientRows.map(r => r.centerName)).size;
        return { data, totals: computeTotals(data, uniqueCenters, data.length), reportType };
    }

    if (reportType === 'BRANCHWISE') {
        const branchMap = new Map<string, {
            row: MISAgewiseBranchwiseRow;
            centerSet: Set<string>;
            clientSet: Set<string>;
        }>();

        for (const r of clientRows) {
            const key = r.branchName;
            if (!branchMap.has(key)) {
                branchMap.set(key, {
                    row: {
                        branchName: r.branchName,
                        numCenters: 0,
                        numClients: 0,
                        loanAmount: 0, priBalance: 0,
                        arrear1To30: 0, arrear31To60: 0, arrear61To90: 0, arrear91To180: 0, arrearAbove180: 0,
                        arrearPri: 0, arrearInt: 0, arrearTotal: 0,
                    },
                    centerSet: new Set(),
                    clientSet: new Set(),
                });
            }
            const entry = branchMap.get(key)!;
            entry.centerSet.add(r.centerName);
            entry.clientSet.add(r.clientName);
            entry.row.loanAmount += r.loanAmount;
            entry.row.priBalance += r.priBalance;
            entry.row.arrear1To30 += r.days1to30;
            entry.row.arrear31To60 += r.days31to60;
            entry.row.arrear61To90 += r.days61to90;
            entry.row.arrear91To180 += r.days91to180;
            entry.row.arrearAbove180 += r.above180;
            entry.row.arrearPri += r.arrearPri;
            entry.row.arrearInt += r.arrearInt;
            entry.row.arrearTotal += r.totalArrear;
        }

        const data: MISAgewiseBranchwiseRow[] = [];
        let totalCenters = 0;
        let totalClients = 0;
        for (const entry of branchMap.values()) {
            entry.row.numCenters = entry.centerSet.size;
            entry.row.numClients = entry.clientSet.size;
            totalCenters += entry.row.numCenters;
            totalClients += entry.row.numClients;
            data.push(entry.row);
        }
        data.sort((a, b) => a.branchName.localeCompare(b.branchName));

        return { data, totals: computeTotals(data, totalCenters, totalClients), reportType };
    }

    if (reportType === 'CENTERWISE') {
        const centerMap = new Map<string, {
            row: MISAgewiseCenterwiseRow;
            clientSet: Set<string>;
        }>();

        for (const r of clientRows) {
            const key = `${r.branchName}|${r.centerName}`;
            if (!centerMap.has(key)) {
                centerMap.set(key, {
                    row: {
                        branchName: r.branchName,
                        centerName: r.centerName,
                        numClients: 0,
                        loanAmount: 0, priBalance: 0,
                        arrear1To30: 0, arrear31To60: 0, arrear61To90: 0, arrear91To180: 0, arrearAbove180: 0,
                        arrearPri: 0, arrearInt: 0, arrearTotal: 0,
                    },
                    clientSet: new Set(),
                });
            }
            const entry = centerMap.get(key)!;
            entry.clientSet.add(r.clientName);
            entry.row.loanAmount += r.loanAmount;
            entry.row.priBalance += r.priBalance;
            entry.row.arrear1To30 += r.days1to30;
            entry.row.arrear31To60 += r.days31to60;
            entry.row.arrear61To90 += r.days61to90;
            entry.row.arrear91To180 += r.days91to180;
            entry.row.arrearAbove180 += r.above180;
            entry.row.arrearPri += r.arrearPri;
            entry.row.arrearInt += r.arrearInt;
            entry.row.arrearTotal += r.totalArrear;
        }

        const data: MISAgewiseCenterwiseRow[] = [];
        let totalClients = 0;
        for (const entry of centerMap.values()) {
            entry.row.numClients = entry.clientSet.size;
            totalClients += entry.row.numClients;
            data.push(entry.row);
        }
        data.sort((a, b) => a.branchName.localeCompare(b.branchName) || a.centerName.localeCompare(b.centerName));

        return { data, totals: computeTotals(data, data.length, totalClients), reportType };
    }

    // FDOWISE
    const fdoMap = new Map<string, {
        row: MISAgewiseFDOwiseRow;
        centerSet: Set<string>;
        clientSet: Set<string>;
    }>();

    for (const r of clientRows) {
        const key = `${r.branchName}|${r.fdoName}`;
        if (!fdoMap.has(key)) {
            fdoMap.set(key, {
                row: {
                    branchName: r.branchName,
                    fdoName: r.fdoName,
                    numCenters: 0,
                    numClients: 0,
                    loanAmount: 0, priBalance: 0,
                    arrear1To30: 0, arrear31To60: 0, arrear61To90: 0, arrear91To180: 0, arrearAbove180: 0,
                    arrearPri: 0, arrearInt: 0, arrearTotal: 0,
                },
                centerSet: new Set(),
                clientSet: new Set(),
            });
        }
        const entry = fdoMap.get(key)!;
        entry.centerSet.add(r.centerName);
        entry.clientSet.add(r.clientName);
        entry.row.loanAmount += r.loanAmount;
        entry.row.priBalance += r.priBalance;
        entry.row.arrear1To30 += r.days1to30;
        entry.row.arrear31To60 += r.days31to60;
        entry.row.arrear61To90 += r.days61to90;
        entry.row.arrear91To180 += r.days91to180;
        entry.row.arrearAbove180 += r.above180;
        entry.row.arrearPri += r.arrearPri;
        entry.row.arrearInt += r.arrearInt;
        entry.row.arrearTotal += r.totalArrear;
    }

    const data: MISAgewiseFDOwiseRow[] = [];
    let totalCenters = 0;
    let totalClients = 0;
    for (const entry of fdoMap.values()) {
        entry.row.numCenters = entry.centerSet.size;
        entry.row.numClients = entry.clientSet.size;
        totalCenters += entry.row.numCenters;
        totalClients += entry.row.numClients;
        data.push(entry.row);
    }
    data.sort((a, b) => a.branchName.localeCompare(b.branchName) || a.fdoName.localeCompare(b.fdoName));

    return { data, totals: computeTotals(data, totalCenters, totalClients), reportType };
}

// ─── MIS AGEWISE ARREAR — DETAILED (per-loan, 48 columns) ────────────────────

export type MISDetailedArrearRow = {
    branchId: string;
    branchName: string;
    centreId: string;
    centreName: string;
    productType: string;
    loanId: string;
    loanDisbursementDate: string;
    firstEmiDate: string;
    loanMaturityDate: string;
    memberId: string;
    memberName: string;
    memberNomineeName: string;
    address: string;
    district: string;
    phoneNumber: string;
    loanAmount: number;
    noOfInstallment: number;
    lastRepayDate: string;
    lastRepayAmount: number;
    collectedDues: number;
    duesLeft: number;
    loanAge: number;
    ageWise: string;
    dueDay: number;
    emi: number;
    loanPrincipal: number;
    loanInterest: number;
    loanTotal: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingTotal: number;
    overduePrincipal: number;
    overdueInterest: number;
    overdueTotal: number;
    openingOdPrincipal: number;
    openingOdInterest: number;
    openingOdTotal: number;
    currentPrincipalCollection: number;
    currentInterestCollection: number;
    currentCollectionTotal: number;
    principalCollection: number;
    interestCollection: number;
    closingOdPrincipal: number;
    closingOdInterest: number;
    closingOdTotal: number;
    funder: string;
    fdoName: string;
} & MemberContactFields;

export type MISDetailedArrearTotals = {
    totalLoans: number;
    totalLoanAmount: number;
    totalOutstandingPrincipal: number;
    totalOutstandingInterest: number;
    totalOutstandingTotal: number;
    totalOverduePrincipal: number;
    totalOverdueInterest: number;
    totalOverdueTotal: number;
    totalOpeningOdTotal: number;
    totalCurrentCollection: number;
    totalPrincipalCollection: number;
    totalInterestCollection: number;
    totalClosingOdTotal: number;
};

export type MISDetailedArrearResult = {
    data: MISDetailedArrearRow[];
    totals: MISDetailedArrearTotals;
};

/**
 * Detailed per-loan agewise arrear report (48 columns).
 * Includes only loans that have overdue (opening OD > 0) as of the report date.
 */
export async function getMISDetailedAgewiseArrearData(
    reportDate: string,
    branchId?: string | string[],
    centerId?: string,
    options?: {
        useBranchEodCutoff?: boolean;
        fdoId?: string;
        /**
         * Count the report date's own unpaid demand as arrear (default true — matches
         * the Arrear Demand Sheet). PAR passes false: it measures only genuinely
         * past-due installments.
         */
        includeReportDateDemand?: boolean;
    }
): Promise<MISDetailedArrearResult> {
    // IST-anchored boundaries
    const asOfDate = new Date(`${reportDate}T23:59:59.999+05:30`);
    const startOfReportDate = new Date(`${reportDate}T00:00:00+05:30`);

    const loans = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            isActive: true,
            ...(branchId && (!Array.isArray(branchId) || branchId.length > 0)
                ? { branchId: Array.isArray(branchId) ? { in: branchId } : branchId }
                : {}),
            ...(centerId && centerId !== 'all' ? { centerId } : {}),
            // FDO filter — scoped through client.center.fdo, the same relation the
            // `fdoName` column below is derived from.
            ...(options?.fdoId ? { client: { center: { fdoId: options.fdoId } } } : {}),
        },
        include: {
            client: {
                select: {
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                    nomineeName: true,         // fallback if coApplicant is absent
                    permanentAddress: true,
                    district: true,
                    // A client may have several co-applicants over time — this
                    // report uses the Primary one (first-ever created), same as before.
                    coApplicants: {
                        where: { isPrimary: true },
                        take: 1,
                        select: {
                            name: true,
                            relationWithClient: true,
                        },
                    },
                    center: {
                        include: {
                            branch: { select: { id: true, code: true, name: true } },
                            fdo: { select: { firstName: true, lastName: true } },
                        },
                    },
                },
            },
            schedules: { orderBy: { dueDate: 'asc' } },
            transactions: {
                where: {
                    type: { in: ['REPAYMENT', 'PRECLOSURE'] as any },
                    isReversed: false,
                    status: 'APPROVED',
                },
                orderBy: { transactionDate: 'desc' },
                select: {
                    transactionDate: true,
                    amount: true,
                    principalAmount: true,
                    interestAmount: true,
                    type: true,
                },
            },
            loanProduct: { select: { productName: true } },
            funder: { select: { funderName: true } },
        },
    });

    // Resolve each distinct branch's EOD-processed working date once, only when the
    // caller wants a live "as of right now" cutoff (PAR) rather than a fixed historical
    // reportDate (MIS Detailed Agewise Arrear). A branch's `currentWorkingDate` is its
    // still-open business day — dues before it are genuinely closed-out arrears, dues on
    // or after it are still current demand until that branch's EOD closes them.
    let branchWorkingYmdMap = new Map<string, string>();
    if (options?.useBranchEodCutoff) {
        const distinctBranchIds = [...new Set(loans.map(l => l.branchId))];
        const entries = await Promise.all(
            distinctBranchIds.map(async (bId) => {
                try {
                    const window = await getBranchWorkingDayWindow({ branchId: bId });
                    return [bId, window.workingDateYmd] as const;
                } catch {
                    return null; // no BranchLock row yet (new branch) — falls back to reportDate
                }
            })
        );
        branchWorkingYmdMap = new Map(
            entries.filter((e): e is readonly [string, string] => e !== null)
        );
    }

    // Ledger-derived "paid as of" amounts per schedule, from LoanTransactionLine
    // (the source of truth) rather than LoanSchedule.principalPaid/interestPaid —
    // those live cumulative fields can drift from the actual transaction-line
    // history (confirmed on real data: a schedule with an approved, non-reversed
    // transaction line paying part of its interest, yet interestPaid never
    // incremented to reflect it). Same pattern already used for DCB opening-arrear
    // (prePeriodLineRows above). One groupBy per distinct effective cutoff (usually
    // just 1-2 — one per distinct branch working date) so it stays batched.
    const loanEffectiveYmd = new Map<string, string>();
    const scheduleIdsByCutoffExclusiveYmd = new Map<string, string[]>();
    for (const loan of loans) {
        const effectiveYmd = options?.useBranchEodCutoff
            ? (branchWorkingYmdMap.get(loan.branchId) ?? reportDate)
            : reportDate;
        loanEffectiveYmd.set(loan.id, effectiveYmd);
        const cutoffExclusiveYmd = addCalendarDaysToYmd(effectiveYmd, 1);
        const ids = scheduleIdsByCutoffExclusiveYmd.get(cutoffExclusiveYmd) ?? [];
        for (const s of loan.schedules) ids.push(s.id);
        scheduleIdsByCutoffExclusiveYmd.set(cutoffExclusiveYmd, ids);
    }

    // Postgres caps a prepared statement at 32767 bind variables — a single cutoff bucket
    // can hold every schedule of every currently-disbursed loan (they all share today's
    // effectiveYmd), which comfortably exceeds that once the portfolio grows large enough.
    // Chunk the `in` list so no single query's bind count can approach the limit.
    const SCHEDULE_ID_CHUNK_SIZE = 20000;
    const ledgerPaidBySchedule = new Map<string, { principal: number; interest: number }>();
    for (const [cutoffExclusiveYmd, scheduleIds] of scheduleIdsByCutoffExclusiveYmd) {
        if (scheduleIds.length === 0) continue;
        const cutoffExclusiveUtc = parseKolkataAttendanceDateYmd(cutoffExclusiveYmd);
        for (let i = 0; i < scheduleIds.length; i += SCHEDULE_ID_CHUNK_SIZE) {
            const chunk = scheduleIds.slice(i, i + SCHEDULE_ID_CHUNK_SIZE);
            const lineSums = await prisma.loanTransactionLine.groupBy({
                by: ['scheduleId'],
                where: {
                    scheduleId: { in: chunk },
                    transaction: {
                        transactionDate: { lt: cutoffExclusiveUtc },
                        status: 'APPROVED',
                        isReversed: false,
                        type: { in: ['REPAYMENT', 'PRECLOSURE'] },
                    },
                },
                _sum: { principalAmount: true, interestAmount: true },
            });
            for (const r of lineSums) {
                if (!r.scheduleId) continue;
                ledgerPaidBySchedule.set(r.scheduleId, {
                    principal: Number(r._sum.principalAmount ?? 0),
                    interest: Number(r._sum.interestAmount ?? 0),
                });
            }
        }
    }

    const rows: MISDetailedArrearRow[] = [];
    const arrearContactOf = await getMemberContacts({ clientIds: loans.map((l) => l.clientId), loanIds: loans.map((l) => l.id) });

    for (const loan of loans) {
        const schedules = loan.schedules;
        if (schedules.length === 0) continue;

        // Effective "as of" date for this loan's branch: its own EOD-processed working
        // date when useBranchEodCutoff is on, otherwise the global reportDate (unchanged
        // behavior for historical/fixed-date callers).
        const effectiveYmd = loanEffectiveYmd.get(loan.id)!;
        const startOfLoanReportDate =
            effectiveYmd === reportDate ? startOfReportDate : parseKolkataAttendanceDateYmd(effectiveYmd);
        const asOfLoanDate =
            effectiveYmd === reportDate ? asOfDate : new Date(`${effectiveYmd}T23:59:59.999+05:30`);

        // ── Opening OD: past-due unpaid schedules before report date ────────
        let openingOdPrincipal = 0;
        let openingOdInterest = 0;
        let maxDaysPastDue = 0;

        for (const s of schedules) {
            const due = new Date(s.dueDate);
            if (due >= startOfLoanReportDate) continue; // only strictly before report date
            const ledgerPaid = ledgerPaidBySchedule.get(s.id) ?? { principal: 0, interest: 0 };
            const unpaidP = Math.max(0, Number(s.principalDue) - ledgerPaid.principal);
            const unpaidI = Math.max(0, Number(s.interestDue) - ledgerPaid.interest);
            if (unpaidP + unpaidI <= 0) continue;
            openingOdPrincipal += unpaidP;
            openingOdInterest += unpaidI;
            const daysPast = Math.floor(
                (asOfLoanDate.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
            );
            if (daysPast > maxDaysPastDue) maxDaysPastDue = daysPast;
        }

        // Skip loans with no overdue
        if (openingOdPrincipal + openingOdInterest <= 0) continue;

        // ── Current day collections (on report date) ────────────────────────
        let currentPrincipalCollection = 0;
        let currentInterestCollection = 0;
        for (const tx of loan.transactions) {
            const txYmd = getKolkataCalendarYmd(new Date(tx.transactionDate));
            if (txYmd === effectiveYmd) {
                currentPrincipalCollection += Number(tx.principalAmount || 0);
                currentInterestCollection += Number(tx.interestAmount || 0);
            }
        }

        // ── Closing OD ───────────────────────────────────────────────────────
        const closingOdPrincipal = Math.max(0, openingOdPrincipal - currentPrincipalCollection);
        const closingOdInterest = Math.max(0, openingOdInterest - currentInterestCollection);

        // ── Overdue (same as opening OD for single-date snapshot) ───────────
        const overduePrincipal = openingOdPrincipal;
        const overdueInterest = openingOdInterest;

        // ── Age wise bucket label ────────────────────────────────────────────
        let ageWise = '';
        if (maxDaysPastDue >= 1 && maxDaysPastDue <= 30) ageWise = '1-30';
        else if (maxDaysPastDue <= 60) ageWise = '31-60';
        else if (maxDaysPastDue <= 90) ageWise = '61-90';
        else if (maxDaysPastDue <= 180) ageWise = '91-180';
        else ageWise = 'Above 180';

        // ── Schedule-derived fields ──────────────────────────────────────────
        const firstSchedule = schedules[0];
        const lastSchedule = schedules[schedules.length - 1];
        const firstEmiDate = fmtIstDate(new Date(firstSchedule.dueDate));
        const loanMaturityDate = fmtIstDate(new Date(lastSchedule.dueDate));
        const loanInterest = schedules.reduce((s, sch) => s + Number(sch.interestDue), 0);
        const loanPrincipal = Number(loan.amount);
        const emi = Math.round(
            Number(firstSchedule.principalDue) + Number(firstSchedule.interestDue)
        );
        const collectedDues = schedules.filter(s => {
            const paid = ledgerPaidBySchedule.get(s.id) ?? { principal: 0, interest: 0 };
            return paid.principal >= Number(s.principalDue) && paid.interest >= Number(s.interestDue);
        }).length;

        // ── Outstanding ──────────────────────────────────────────────────────
        // Ledger-derived (sum of LoanTransactionLine across all of this loan's
        // schedules), not loan.principalPaid/interestPaid — those whole-loan
        // cumulative fields can drift from the ledger too (confirmed on real data:
        // a loan whose principalPaid was 485 higher than its approved, non-reversed
        // transaction total), same class of bug as the per-schedule drift above.
        const principalCollection = schedules.reduce(
            (s, sch) => s + (ledgerPaidBySchedule.get(sch.id)?.principal ?? 0),
            0
        );
        const interestCollection = schedules.reduce(
            (s, sch) => s + (ledgerPaidBySchedule.get(sch.id)?.interest ?? 0),
            0
        );
        const outstandingPrincipal = loanPrincipal - principalCollection;
        const outstandingInterest = schedules.reduce((s, sch) => {
            const paid = ledgerPaidBySchedule.get(sch.id) ?? { principal: 0, interest: 0 };
            return s + Math.max(0, Number(sch.interestDue) - paid.interest);
        }, 0);

        // ── Dates & meta ─────────────────────────────────────────────────────
        const disbursementDate = loan.disbursedLevel1At
            ? fmtIstDate(new Date(loan.disbursedLevel1At))
            : 'N/A';
        const loanAge = loan.disbursedLevel1At
            ? Math.floor(
                  (asOfLoanDate.getTime() - new Date(loan.disbursedLevel1At).getTime()) /
                      (1000 * 60 * 60 * 24)
              )
            : 0;
        const lastTx = loan.transactions[0]; // desc order → most recent first
        const lastRepayDate = lastTx ? fmtIstDate(new Date(lastTx.transactionDate)) : '';
        const lastRepayAmount = lastTx
            ? Math.round(
                  Number(lastTx.amount || 0) ||
                      Number(lastTx.principalAmount || 0) + Number(lastTx.interestAmount || 0)
              )
            : 0;

        // ── Relations ────────────────────────────────────────────────────────
        const center = loan.client.center;
        const branch = center?.branch;
        const fdo = center?.fdo;

        rows.push({
            branchId: branch?.code ?? '',
            branchName: branch?.name ?? 'N/A',
            centreId: center?.code ?? '',
            centreName: center?.name ?? 'N/A',
            productType: loan.loanProduct?.productName ?? '',
            loanId: loan.loanNumber,
            loanDisbursementDate: disbursementDate,
            firstEmiDate,
            loanMaturityDate,
            memberId: loan.client.clientId,
            memberName: `${loan.client.firstName} ${loan.client.lastName}`,
            // CoApplicant.name is the primary source; nomineeName is a fallback
            memberNomineeName: loan.client.coApplicants[0]?.name || loan.client.nomineeName || '',
            address: loan.client.permanentAddress ?? '',
            district: loan.client.district ?? '',
            phoneNumber: loan.client.phone || loan.client.mobileNumber || '',
            loanAmount: loanPrincipal,
            noOfInstallment: loan.tenureMonths,
            lastRepayDate,
            lastRepayAmount,
            collectedDues,
            duesLeft: schedules.length - collectedDues,
            loanAge,
            ageWise,
            dueDay: maxDaysPastDue,
            emi,
            loanPrincipal,
            loanInterest: Math.round(loanInterest),
            loanTotal: Math.round(loanPrincipal + loanInterest),
            outstandingPrincipal: Math.round(outstandingPrincipal),
            outstandingInterest: Math.round(outstandingInterest),
            outstandingTotal: Math.round(outstandingPrincipal + outstandingInterest),
            overduePrincipal: Math.round(overduePrincipal),
            overdueInterest: Math.round(overdueInterest),
            overdueTotal: Math.round(overduePrincipal + overdueInterest),
            openingOdPrincipal: Math.round(openingOdPrincipal),
            openingOdInterest: Math.round(openingOdInterest),
            openingOdTotal: Math.round(openingOdPrincipal + openingOdInterest),
            currentPrincipalCollection: Math.round(currentPrincipalCollection),
            currentInterestCollection: Math.round(currentInterestCollection),
            currentCollectionTotal: Math.round(
                currentPrincipalCollection + currentInterestCollection
            ),
            principalCollection: Math.round(principalCollection),
            interestCollection: Math.round(interestCollection),
            closingOdPrincipal: Math.round(closingOdPrincipal),
            closingOdInterest: Math.round(closingOdInterest),
            closingOdTotal: Math.round(closingOdPrincipal + closingOdInterest),
            funder: loan.funder?.funderName ?? 'Own Fund',
            fdoName: fdo ? `${fdo.firstName} ${fdo.lastName}` : 'Unassigned',
            ...arrearContactOf(loan.clientId, loan.id),
        });
    }

    rows.sort(
        (a, b) =>
            a.branchName.localeCompare(b.branchName) ||
            a.centreName.localeCompare(b.centreName) ||
            a.memberName.localeCompare(b.memberName)
    );

    const totals: MISDetailedArrearTotals = {
        totalLoans: rows.length,
        totalLoanAmount: rows.reduce((s, r) => s + r.loanAmount, 0),
        totalOutstandingPrincipal: rows.reduce((s, r) => s + r.outstandingPrincipal, 0),
        totalOutstandingInterest: rows.reduce((s, r) => s + r.outstandingInterest, 0),
        totalOutstandingTotal: rows.reduce((s, r) => s + r.outstandingTotal, 0),
        totalOverduePrincipal: rows.reduce((s, r) => s + r.overduePrincipal, 0),
        totalOverdueInterest: rows.reduce((s, r) => s + r.overdueInterest, 0),
        totalOverdueTotal: rows.reduce((s, r) => s + r.overdueTotal, 0),
        totalOpeningOdTotal: rows.reduce((s, r) => s + r.openingOdTotal, 0),
        totalCurrentCollection: rows.reduce((s, r) => s + r.currentCollectionTotal, 0),
        totalPrincipalCollection: rows.reduce((s, r) => s + r.principalCollection, 0),
        totalInterestCollection: rows.reduce((s, r) => s + r.interestCollection, 0),
        totalClosingOdTotal: rows.reduce((s, r) => s + r.closingOdTotal, 0),
    };

    return { data: rows, totals };
}

export type ClientwiseDCBRow = {
    branchId: string;
    centerId: string;
    branchName: string;
    centerName: string;
    fdoName: string;
    accountNo: string;
    clientName: string;
    phone: string;
    loanAc: string;
    meetingDate: string;
    openingDue: number;
    currentDemand: number;
    currentCollection: number;
    /** Past-period demand not yet collected (true arrear, due date < today). */
    currentArrear: number;
    /** Today's scheduled demand not yet collected — pending, NOT arrear. */
    todayPending: number;
    osArrearCall: number;
    advance: number;
    preclosure: number;
    totalCall: number;
    currentArrearAmount: number;
    closingArrear: number;
};

export async function getClientwiseDCBData(
    fromDate: string,
    toDate: string,
    centerId?: string,
    branchId?: string | string[]
): Promise<ClientwiseDCBRow[]> {
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(toDate);
    endDate.setHours(23, 59, 59, 999);

    // Build where clause for loans
    const whereClause: any = {
        disbursementStatus: 'DISBURSED',
        isActive: true,
    };

    if (centerId && centerId !== 'all') {
        whereClause.centerId = centerId;
    }

    if (branchId && (!Array.isArray(branchId) || branchId.length > 0)) {
        whereClause.branchId = Array.isArray(branchId) ? { in: branchId } : branchId;
    }

    // Fetch all disbursed loans with their schedules and transactions
    const loans = await prisma.loan.findMany({
        where: whereClause,
        include: {
            client: {
                include: {
                    center: {
                        include: {
                            branch: true,
                            fdo: true,
                        },
                    },
                },
            },
            schedules: {
                where: {
                    dueDate: {
                        lte: endDate,
                    },
                },
                orderBy: {
                    dueDate: 'asc',
                },
            },
            transactions: {
                where: {
                    transactionDate: {
                        gte: startDate,
                        lte: endDate,
                    },
                    isReversed: false,
                    status: 'APPROVED',
                },
                orderBy: {
                    transactionDate: 'asc',
                },
                include: {
                    lines: {
                        include: {
                            schedule: {
                                select: { dueDate: true },
                            },
                        },
                    },
                },
            },
        },
    });

    const dcbRows: ClientwiseDCBRow[] = [];

    for (const loan of loans) {
        // Calculate opening due (arrears before the start date)
        let openingDue = 0;
        for (const schedule of loan.schedules) {
            if (new Date(schedule.dueDate) < startDate) {
                const unpaidPrincipal = Number(schedule.principalDue) - Number(schedule.principalPaid);
                const unpaidInterest = Number(schedule.interestDue) - Number(schedule.interestPaid);
                openingDue += unpaidPrincipal + unpaidInterest;
            }
        }

        // Calculate current demand (schedules due within the date range)
        let currentDemand = 0;
        for (const schedule of loan.schedules) {
            const dueDate = new Date(schedule.dueDate);
            if (dueDate >= startDate && dueDate <= endDate) {
                currentDemand += Number(schedule.principalDue) + Number(schedule.interestDue);
            }
        }

        // Calculate collections within the date range
        let currentCollection = 0;
        let osArrearCall = 0;
        let advance = 0;
        let preclosure = 0;

        for (const transaction of loan.transactions) {
            const txPi = Number(transaction.principalAmount || 0) + Number(transaction.interestAmount || 0);
            const txGross =
                Number(transaction.amount || 0) > 0 ? Number(transaction.amount) : txPi;

            if (transaction.type === 'REPAYMENT') {
                currentCollection += txPi;

                const split = splitRepaymentForDcb({
                    transactionDate: transaction.transactionDate,
                    lines: transaction.lines,
                    principalAmount: transaction.principalAmount,
                    interestAmount: transaction.interestAmount,
                    amount: transaction.amount,
                    collectionType: transaction.collectionType,
                });
                advance += split.advanceFromEarlyInstallments;

                const opnArrPri = Number(transaction.openingArrearsPrincipal || 0);
                const opnArrInt = Number(transaction.openingArrearsInterest || 0);
                const demandSidePi = split.demandSidePrincipalInterest;
                if (opnArrPri > 0 || opnArrInt > 0) {
                    osArrearCall += Math.min(demandSidePi, opnArrPri + opnArrInt);
                }
            } else if (transaction.type === 'PRECLOSURE') {
                preclosure += txGross;
                currentCollection += txPi;
            }
        }

        // Calculate total call (all collections)
        const totalCall = currentCollection;

        // Split unmet demand into "today's pending" vs "true past arrear"
        // Rule: dueDate === today → pending (NOT yet an arrear). dueDate < today → arrear.
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        let todayScheduledDemand = 0;
        for (const schedule of loan.schedules) {
            const dueStr = format(new Date(schedule.dueDate), 'yyyy-MM-dd');
            if (dueStr === todayStr && dueStr >= fromDate && dueStr <= toDate) {
                todayScheduledDemand +=
                    Number(schedule.principalDue) + Number(schedule.interestDue);
            }
        }
        const totalUnmet = Math.max(0, currentDemand - currentCollection);
        const todayPending  = Math.max(0, Math.min(totalUnmet, todayScheduledDemand));
        // currentArrear = only past-day demand that was NOT collected (true arrear)
        const currentArrear = Math.max(0, totalUnmet - todayPending);

        // Calculate current arrear amount (unpaid from current demand)
        const currentArrearAmount = currentArrear;

        // Calculate closing arrear (opening + total unmet demand)
        const closingArrear = Math.max(0, openingDue + totalUnmet);

        // Get meeting date (use center's next meeting date or first schedule due date in range)
        let meetingDate = 'N/A';
        if (loan.client.center?.nextMeetingDate) {
            meetingDate = format(new Date(loan.client.center?.nextMeetingDate), 'dd/MM/yyyy');
        } else {
            const firstScheduleInRange = loan.schedules.find(s => {
                const dueDate = new Date(s.dueDate);
                return dueDate >= startDate && dueDate <= endDate;
            });
            if (firstScheduleInRange) {
                meetingDate = format(new Date(firstScheduleInRange.dueDate), 'dd/MM/yyyy');
            }
        }

        // Only include if there's activity (demand or collection or arrears)
        if (currentDemand > 0 || currentCollection > 0 || openingDue > 0 || closingArrear > 0) {
            dcbRows.push({
                branchId: loan.client.center?.branch.id ?? '',
                centerId: loan.client.center?.id ?? '',
                branchName: loan.client.center?.branch.name ?? '',
                centerName: loan.client.center?.name ?? 'Unassigned',
                fdoName: loan.client.center?.fdo
                    ? `${loan.client.center?.fdo.firstName} ${loan.client.center?.fdo.lastName}`
                    : 'Unassigned',
                accountNo: loan.client.clientId,
                clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                phone: loan.client.phone || loan.client.mobileNumber || 'N/A',
                loanAc: loan.loanNumber,
                meetingDate: meetingDate,
                openingDue: Math.round(openingDue),
                currentDemand: Math.round(currentDemand),
                currentCollection: Math.round(currentCollection),
                currentArrear: Math.round(currentArrear),
                todayPending: Math.round(todayPending),
                osArrearCall: Math.round(osArrearCall),
                advance: Math.round(advance),
                preclosure: Math.round(preclosure),
                totalCall: Math.round(totalCall),
                currentArrearAmount: Math.round(currentArrearAmount),
                closingArrear: Math.round(closingArrear),
            });
        }
    }

    // Sort by center, then by client name
    return dcbRows.sort((a, b) => {
        if (a.centerName !== b.centerName) {
            return a.centerName.localeCompare(b.centerName);
        }
        return a.clientName.localeCompare(b.clientName);
    });
}

export type OSBranchwiseRow = {
    branchCode: string;
    branchName: string;
    noOfClients: number;
    osPrincipal: number;
    osInterest: number;
    osSavings: number;
    arrClients: number;
    arrearPri: number;
    arrearInt: number;
    arrearSavings: number;
};

export async function getOSBranchwiseData(
    reportDate: string,
    branchIds?: string[]
): Promise<OSBranchwiseRow[]> {
    const asOfDate = new Date(reportDate);
    asOfDate.setHours(23, 59, 59, 999);

    // Fetch all branches (or only the caller's permitted branches) with their loans
    const branches = await prisma.branch.findMany({
        where: branchIds && branchIds.length > 0 ? { id: { in: branchIds } } : undefined,
        include: {
            loans: {
                where: {
                    disbursementStatus: 'DISBURSED',
                    isActive: true,
                    disbursedLevel1At: {
                        lte: asOfDate,
                    },
                },
                include: {
                    schedules: {
                        where: {
                            dueDate: {
                                lte: asOfDate,
                            },
                        },
                    },
                    client: true,
                },
            },
        },
        orderBy: {
            code: 'asc',
        },
    });

    const osRows: OSBranchwiseRow[] = [];

    for (const branch of branches) {
        let noOfClients = 0;
        let osPrincipal = 0;
        let osInterest = 0;
        let osSavings = 0;
        let arrClients = 0;
        let arrearPri = 0;
        let arrearInt = 0;
        let arrearSavings = 0;

        // Track unique clients
        const clientSet = new Set<string>();
        const arrearClientSet = new Set<string>();

        for (const loan of branch.loans) {
            // Add to client count
            clientSet.add(loan.clientId);

            // Calculate outstanding principal, interest, and savings
            const loanOSPrincipal = Number(loan.amount) - Number(loan.principalPaid);
            let loanOSInterest = 0;
            let loanOSSavings = 0;

            for (const schedule of loan.schedules) {
                loanOSInterest += Number(schedule.interestDue) - Number(schedule.interestPaid);
                loanOSSavings += Math.max(0, Number(schedule.savingsDue || 0) - Number(schedule.savingsPaid || 0));
            }

            osPrincipal += loanOSPrincipal;
            osInterest += loanOSInterest;
            osSavings += loanOSSavings;

            // Calculate arrears (overdue amounts)
            let loanArrearPri = 0;
            let loanArrearInt = 0;
            let loanArrearSavings = 0;

            for (const schedule of loan.schedules) {
                const unpaidPrincipal = Number(schedule.principalDue) - Number(schedule.principalPaid);
                const unpaidInterest = Number(schedule.interestDue) - Number(schedule.interestPaid);
                const unpaidSavings = Math.max(0, Number(schedule.savingsDue || 0) - Number(schedule.savingsPaid || 0));

                if (unpaidPrincipal > 0 || unpaidInterest > 0 || unpaidSavings > 0) {
                    loanArrearPri += unpaidPrincipal;
                    loanArrearInt += unpaidInterest;
                    loanArrearSavings += unpaidSavings;
                }
            }

            // If loan has arrears, add to arrear client count
            if (loanArrearPri > 0 || loanArrearInt > 0 || loanArrearSavings > 0) {
                arrearClientSet.add(loan.clientId);
                arrearPri += loanArrearPri;
                arrearInt += loanArrearInt;
                arrearSavings += loanArrearSavings;
            }
        }

        noOfClients = clientSet.size;
        arrClients = arrearClientSet.size;

        // Only include branches with active loans
        if (noOfClients > 0) {
            osRows.push({
                branchCode: branch.code,
                branchName: branch.name,
                noOfClients: noOfClients,
                osPrincipal: Math.round(osPrincipal),
                osInterest: Math.round(osInterest),
                osSavings: Math.round(osSavings),
                arrClients: arrClients,
                arrearPri: Math.round(arrearPri),
                arrearInt: Math.round(arrearInt),
                arrearSavings: Math.round(arrearSavings),
            });
        }
    }

    return osRows;
}

/**
 * Portfolio-wide outstanding (principal + interest), same schedule-based calc as
 * getOSBranchwiseData above (osPrincipal = full remaining loan principal regardless of
 * due date; osInterest = interest due so far only), collapsed to a single total instead
 * of per-branch rows. Used by the dashboard's "Portfolio OS" stat so it never diverges
 * from what the OS Branchwise report shows — the previous dashboard calc (disbursed
 * amount of currently-active loans minus all-time repayment total) undercounted once any
 * loans closed, since a closed loan's principal dropped out of the "disbursed" side while
 * its repayment history stayed in the "repaid" side.
 */
export async function getPortfolioOutstanding(
    reportDate: string,
    branchIds?: string[],
    centerId?: string,
    funderId?: string
): Promise<{ osPrincipal: number; osInterest: number }> {
    const asOfDate = new Date(reportDate);
    asOfDate.setHours(23, 59, 59, 999);

    const loans = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            isActive: true,
            disbursedLevel1At: { lte: asOfDate },
            ...(branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
            ...(centerId ? { centerId } : {}),
            ...(funderId ? { funderId } : {}),
        },
        select: {
            amount: true,
            principalPaid: true,
            schedules: {
                where: { dueDate: { lte: asOfDate } },
                select: { interestDue: true, interestPaid: true },
            },
        },
    });

    let osPrincipal = 0;
    let osInterest = 0;
    for (const loan of loans) {
        osPrincipal += Number(loan.amount) - Number(loan.principalPaid);
        for (const schedule of loan.schedules) {
            osInterest += Number(schedule.interestDue) - Number(schedule.interestPaid);
        }
    }

    return { osPrincipal: Math.round(osPrincipal), osInterest: Math.round(osInterest) };
}

export type FunderOSReportRow = {
    funderId: string;
    funderCode: string;
    funderName: string;
    loanCount: number;
    totalDisbursed: number;
    totalInterest: number;
    collectedPrincipal: number;
    collectedInterest: number;
    osPrincipal: number;
    osInterest: number;
};

const FUNDER_OS_UNASSIGNED_KEY = 'UNASSIGNED';

/**
 * Funder OS Report — one row per funder (plus an "Unassigned" bucket for loans with no
 * funder, only when viewing all funders).
 *
 * - Total Disbursed / Total Interest / Loan Count are lifetime cumulative as of
 *   `asOnDate` — every DISBURSED loan disbursed by that date, active or closed (a loan
 *   that has since foreclosed/closed still represents money genuinely disbursed).
 * - OS Principal / OS Interest are restricted to loans still `isActive: true` as of now
 *   — a closed loan's outstanding is 0 by definition regardless of the raw
 *   amount-minus-paid arithmetic (see the isActive check below for why this must be an
 *   explicit gate rather than implied by the numbers, e.g. write-off closures).
 *   osPrincipal uses the same amount-minus-principalPaid formula as
 *   getPortfolioOutstanding/getOSBranchwiseData; osInterest deliberately does NOT use
 *   their due-so-far/arrears basis — see the inline comment below.
 * - Collected Principal / Collected Interest are approved, non-reversed REPAYMENT /
 *   PRECLOSURE / WRITEOFF transactions up to `asOnDate` — cumulative since inception when
 *   `fromDate` is omitted (the report's default "As On Date" view), or restricted to
 *   [fromDate, asOnDate] when the caller opts into the "From - To Date" period view.
 *
 * Caveat: a loan closed via a death/"Others" waiver or a write-off forgives some
 * principal/interest that was never actually collected (LoanClosureRecord.principalWaiver
 * /interestWaiver) — that forgiven amount is neither "outstanding" (the loan is closed)
 * nor "collected" (no cash moved), so for a funder with waived loans, Total Disbursed can
 * be slightly more than OS Principal + Collected Principal (same for interest). This is
 * expected, not a bug — the report has no separate "Waived" column.
 */
export async function getFunderOSReportData(
    asOnDate: string,
    fromDate: string | null | undefined,
    branchIds?: string[] | null,
    funderId?: string
): Promise<FunderOSReportRow[]> {
    const asOfDate = new Date(asOnDate);
    asOfDate.setHours(23, 59, 59, 999);
    let periodStart: Date | null = null;
    if (fromDate) {
        periodStart = new Date(fromDate);
        periodStart.setHours(0, 0, 0, 0);
    }

    const branchWhere = branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {};

    const [funders, loans, transactions] = await Promise.all([
        prisma.funder.findMany({
            where: funderId ? { id: funderId } : {},
            select: { id: true, funderId: true, funderName: true },
            orderBy: { funderName: 'asc' },
        }),
        prisma.loan.findMany({
            where: {
                disbursementStatus: 'DISBURSED',
                disbursedLevel1At: { lte: asOfDate },
                ...branchWhere,
                ...(funderId ? { funderId } : {}),
            },
            select: {
                funderId: true,
                amount: true,
                principalPaid: true,
                isActive: true,
                loanProduct: { select: { interestAmount: true } },
                schedules: {
                    select: { interestDue: true, interestPaid: true },
                },
            },
        }),
        prisma.loanTransaction.findMany({
            where: {
                // REPAYMENT covers ordinary collections; PRECLOSURE/WRITEOFF also carry
                // genuine cash collected (a foreclosure payoff, or the collected-before-
                // waiver portion of a write-off — see loan-writeoff-closure/route.ts) that
                // would otherwise be silently excluded from Collected Principal/Interest.
                type: { in: ['REPAYMENT', 'PRECLOSURE', 'WRITEOFF'] },
                status: 'APPROVED',
                isReversed: false,
                transactionDate: periodStart ? { gte: periodStart, lte: asOfDate } : { lte: asOfDate },
                ...branchWhere,
                ...(funderId ? { loan: { funderId } } : {}),
            },
            select: {
                principalAmount: true,
                interestAmount: true,
                loan: { select: { funderId: true } },
            },
        }),
    ]);

    type Acc = {
        loanCount: number;
        totalDisbursed: number;
        totalInterest: number;
        collectedPrincipal: number;
        collectedInterest: number;
        osPrincipal: number;
        osInterest: number;
    };
    const acc = new Map<string, Acc>();
    const ensure = (key: string): Acc => {
        let a = acc.get(key);
        if (!a) {
            a = { loanCount: 0, totalDisbursed: 0, totalInterest: 0, collectedPrincipal: 0, collectedInterest: 0, osPrincipal: 0, osInterest: 0 };
            acc.set(key, a);
        }
        return a;
    };

    for (const loan of loans) {
        const a = ensure(loan.funderId ?? FUNDER_OS_UNASSIGNED_KEY);
        a.loanCount += 1;
        a.totalDisbursed += Number(loan.amount);
        // Full-tenure interest expected on this loan (not restricted to installments
        // already due) — same fallback (product flat interest, else sum of every
        // schedule's interestDue) used by getLoanOSDetailsData's "Interest Amount"
        // column, so the two reports agree.
        const totalInterestForLoan = loan.loanProduct?.interestAmount
            ? Number(loan.loanProduct.interestAmount)
            : loan.schedules.reduce((s, sc) => s + Number(sc.interestDue), 0);
        a.totalInterest += totalInterestForLoan;

        // OS Principal/Interest only ever apply to a loan still carrying a live balance
        // (isActive: true) — once closed (foreclosed, fully repaid, death/write-off
        // waiver, ...) its outstanding is by definition 0 regardless of the raw
        // amount-minus-paid arithmetic. This matters specifically for a WRITEOFF closure:
        // unlike foreclosure/death closure (which force principalPaid/interestPaid up to
        // the full amount, so the naive calc already nets to ~0), a write-off leaves
        // Loan.principalPaid and LoanSchedule.interestPaid frozen at their pre-writeoff
        // values — see finalizeClosureCoveredLoan's WRITEOFF branch in
        // foreclosure-workflow.ts — so without this isActive gate a written-off loan
        // would wrongly inflate OS Principal/OS Interest by its waived amount.
        if (loan.isActive) {
            a.osPrincipal += Number(loan.amount) - Number(loan.principalPaid);
            // OS Interest mirrors OS Principal's "full remaining balance" basis (amount -
            // principalPaid, not just principal already due) rather than the
            // due-so-far/arrears basis getOSBranchwiseData uses — so Total Interest, OS
            // Interest and Collected Interest reconcile on this funder-facing report
            // (Total Interest = OS Interest + interest paid to date) instead of OS
            // Interest silently excluding every not-yet-due installment's interest.
            const interestPaidForLoan = loan.schedules.reduce((s, sc) => s + Number(sc.interestPaid), 0);
            a.osInterest += totalInterestForLoan - interestPaidForLoan;
        }
    }

    for (const txn of transactions) {
        const a = ensure(txn.loan.funderId ?? FUNDER_OS_UNASSIGNED_KEY);
        a.collectedPrincipal += Number(txn.principalAmount || 0);
        a.collectedInterest += Number(txn.interestAmount || 0);
    }

    const rows: FunderOSReportRow[] = funders.map((f) => {
        const a = acc.get(f.id) ?? ensure(f.id);
        return {
            funderId: f.id,
            funderCode: f.funderId,
            funderName: f.funderName,
            loanCount: a.loanCount,
            totalDisbursed: Math.round(a.totalDisbursed),
            totalInterest: Math.round(a.totalInterest),
            collectedPrincipal: Math.round(a.collectedPrincipal),
            collectedInterest: Math.round(a.collectedInterest),
            osPrincipal: Math.round(a.osPrincipal),
            osInterest: Math.round(a.osInterest),
        };
    });

    // "No Funder" bucket is only meaningful in the All Funders view — a specific funderId
    // filter already excludes every unassigned loan from `loans`/`transactions` above.
    if (!funderId) {
        const unassigned = acc.get(FUNDER_OS_UNASSIGNED_KEY);
        if (unassigned && unassigned.loanCount > 0) {
            rows.push({
                funderId: FUNDER_OS_UNASSIGNED_KEY,
                funderCode: '-',
                funderName: 'Unassigned / No Funder',
                loanCount: unassigned.loanCount,
                totalDisbursed: Math.round(unassigned.totalDisbursed),
                totalInterest: Math.round(unassigned.totalInterest),
                collectedPrincipal: Math.round(unassigned.collectedPrincipal),
                collectedInterest: Math.round(unassigned.collectedInterest),
                osPrincipal: Math.round(unassigned.osPrincipal),
                osInterest: Math.round(unassigned.osInterest),
            });
        }
    }

    // Only funders with loan activity in scope — keeps the report focused instead of
    // padding it with zero-rows for every funder unrelated to the selected branch(es).
    return rows.filter((r) => r.loanCount > 0);
}

export type OSClientwiseRow = {
    branchName: string;
    centerName: string;
    clientName: string;
    clientId: string;
    disbursalDate: string;
    loanAmount: number;
    dueStartDate: string;
    loanEndDate: string;
    tenure: number;
    loanAc: string;
    osPrincipal: number;
    osInterest: number;
    arrearPri: number;
    arrearInt: number;
    funder: string;
    mobileNo: string;
    goldDetails: { karatType: string; gramCount: number; goldTakenValue: number } | null;
};

export type OSClientwiseResult = {
    data: OSClientwiseRow[];
    totalCount: number;
    totalPages: number;
};

export async function getOSClientwiseData(
    reportDate: string,
    page: number = 1,
    pageSize: number = 10,
    filters: {
        centerId?: string;
        funderId?: string;
        search?: string;
        branchId?: string | string[];
    } = {},
    exportAll: boolean = false
): Promise<OSClientwiseResult> {
    const asOfDate = new Date(reportDate);
    asOfDate.setHours(23, 59, 59, 999);

    // Build where clause
    const whereClause: any = {
        disbursementStatus: 'DISBURSED',
        isActive: true,
        disbursedLevel1At: {
            lte: asOfDate,
        },
    };

    if (filters.centerId && filters.centerId !== 'all') {
        whereClause.centerId = filters.centerId;
    }

    if (filters.branchId && (!Array.isArray(filters.branchId) || filters.branchId.length > 0)) {
        whereClause.branchId = Array.isArray(filters.branchId) ? { in: filters.branchId } : filters.branchId;
    }

    if (filters.search) {
        whereClause.OR = [
            { client: { firstName: { contains: filters.search, mode: 'insensitive' } } },
            { client: { lastName: { contains: filters.search, mode: 'insensitive' } } },
            { client: { clientId: { contains: filters.search, mode: 'insensitive' } } },
            { loanNumber: { contains: filters.search, mode: 'insensitive' } },
        ];
    }

    const totalCount = await prisma.loan.count({ where: whereClause });

    const loans = await prisma.loan.findMany({
        where: whereClause,
        include: {
            client: {
                include: {
                    center: {
                        include: {
                            branch: true,
                        },
                    },
                },
            },
            schedules: true,
            funder: { select: { funderName: true } },
            goldLoanDetail: { select: { karatType: true, gramCount: true, goldTakenValue: true } },
        },
        ...(exportAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        orderBy: [
            {
                client: {
                    firstName: 'asc',
                },
            },
            { id: 'asc' },
        ],
    });

    // Start-of-day boundary: schedules due STRICTLY before this are overdue (arrear).
    // Schedules due ON the report date are "today's pending" — not yet an arrear.
    const startOfAsOfDate = new Date(asOfDate);
    startOfAsOfDate.setHours(0, 0, 0, 0);

    const rows: OSClientwiseRow[] = loans.map(loan => {
        const osPrincipal = Number(loan.amount) - Number(loan.principalPaid);
        const osInterest = loan.schedules.reduce((sum, s) => sum + (Number(s.interestDue) - Number(s.interestPaid)), 0);

        // Only schedules due BEFORE the report date are true arrears (exclude today's pending)
        const overdueSchedules = loan.schedules.filter(s => new Date(s.dueDate) < startOfAsOfDate);
        const arrearPri = overdueSchedules.reduce((sum, s) => sum + (Number(s.principalDue) - Number(s.principalPaid)), 0);
        const arrearInt = overdueSchedules.reduce((sum, s) => sum + (Number(s.interestDue) - Number(s.interestPaid)), 0);

        const sortedSchedules = [...loan.schedules].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        const firstSchedule = sortedSchedules[0];
        const lastSchedule = sortedSchedules[sortedSchedules.length - 1];
        const dueStartDate = firstSchedule ? format(new Date(firstSchedule.dueDate), 'dd/MM/yyyy') : 'N/A';
        const loanEndDate = lastSchedule ? format(new Date(lastSchedule.dueDate), 'dd/MM/yyyy') : 'N/A';
        const formattedDisbursalDate = loan.disbursedLevel1At ? format(new Date(loan.disbursedLevel1At), 'dd/MM/yyyy') : 'N/A';

        return {
            branchName: `${loan.client.center?.branch.code} - ${loan.client.center?.branch.name}`,
            centerName: `${loan.client.center?.code} - ${loan.client.center?.name}`,
            clientName: `${loan.client.clientId} - ${loan.client.firstName} ${loan.client.lastName}`,
            clientId: loan.client.clientId,
            disbursalDate: formattedDisbursalDate,
            loanAmount: Number(loan.amount),
            dueStartDate: dueStartDate,
            loanEndDate: loanEndDate,
            tenure: loan.tenureMonths,
            loanAc: loan.loanNumber,
            osPrincipal: Math.round(osPrincipal),
            osInterest: Math.round(osInterest),
            arrearPri: Math.round(arrearPri),
            arrearInt: Math.round(arrearInt),
            funder: loan.funder?.funderName || 'N/A',
            mobileNo: loan.client.mobileNumber || loan.client.phone || 'N/A',
            goldDetails: loan.goldLoanDetail ? {
                karatType: loan.goldLoanDetail.karatType,
                gramCount: Number(loan.goldLoanDetail.gramCount),
                goldTakenValue: Number(loan.goldLoanDetail.goldTakenValue),
            } : null,
        };
    });

    return {
        data: rows,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
    };
}

export type DaybookEntry = {
    date: string;
    type: string;
    particulars: string;
    description?: string;
    credit: number;
    debit: number;
    paymentMode: string;
    refNo: string;
};

export type DaybookResult = {
    openingBalance: number;
    transactions: DaybookEntry[];
    closingBalance: number;
    totalCredits: number;
    totalDebits: number;
    summary: {
        totalTxns: number;
        creditCount: number;
        debitCount: number;
    };
};

type DaybookEntryWithMeta = DaybookEntry & {
    _rawDate: number;
};

const DAYBOOK_PAYMENT_MODE_CASH = 'CASH';

/** Voucher-number prefixes that are pure GL echoes of loan / admission events.
 *  We must NEVER include these in the daybook because the source event is
 *  already captured via prisma.loanTransaction / prisma.client. */
const GL_SHADOW_PREFIXES = ['GLSYNC-', 'POSTING:'];

/**
 * Description-based markers written by AccountingPostingService into the
 * financialTransaction.description field.  These GL echo rows must be
 * excluded from the daybook because the underlying cash movement is already
 * captured elsewhere (ADMISSION_FEE: client.admissionFees).
 *
 * Format:  "[POSTING:ADMISSION_FEE:…]  …"
 *
 * `[POSTING:DISBURSEMENT:` is deliberately NOT listed here (it was previously,
 * back when disbursement was also synthesized directly from the loanTransaction
 * row below — see the removed DISBURSEMENT branch — making the real GL leg a
 * redundant echo of that row). Now that synthesis is gone, per-loan
 * `[POSTING:DISBURSEMENT:…]` CASH_PAYMENT rows against the funder-ledger
 * ("{FUNDER} FUND [GOLD] PRINCIPAL") are the ONLY representation of a
 * disbursement in the Day Book and must surface via finMap, sourced from the
 * real AccountLedger — same treatment as collections. `[POSTING:EOD_COLLECTION:`
 * is excluded for the same reason: collections should only appear in the Day
 * Book once they've actually been posted via "Allocate for EOD" (and, for
 * non-Admin posters, GL-approved) — i.e. sourced from the real AccountLedger,
 * not synthesized immediately from loanTransaction the moment a collection is
 * approved. See the REPAYMENT/SAVINGS_COLLECTION/DISBURSEMENT handling below
 * (all skipped entirely — no loanTransaction-based row) and
 * CREDIT_LOAN_TYPES/DEBIT_LOAN_TYPES (all three excluded from the
 * loanTransaction-based opening/closing balance sums, to avoid double
 * counting once their real GL leg is included).
 */
const GL_SHADOW_DESCRIPTION_MARKERS = ['[POSTING:ADMISSION_FEE:'];

/**
 * Returns true when a financialTransaction row is a pure accounting/GL echo
 * of a cash event that is already reflected in loanTransaction or client.admissionFees.
 *
 * Two detection layers:
 *   1. voucherNo prefix  – legacy GLSYNC- and POSTING: prefixed vouchers
 *   2. description marker – [POSTING:ADMISSION_FEE:…]
 *      written by AccountingPostingService (voucherNo is a standard CP-/CR- number)
 */
const isGlShadow = (
    voucherNo: string | null | undefined,
    description?: string | null
): boolean => {
    if (voucherNo && GL_SHADOW_PREFIXES.some((p) => voucherNo.startsWith(p))) return true;
    if (description && GL_SHADOW_DESCRIPTION_MARKERS.some((m) => description.includes(m))) return true;
    return false;
};

const formatCenterLabel = (
    center?: { code?: string | null; name?: string | null } | null
): string => {
    const code = (center?.code ?? '').trim();
    const name = (center?.name ?? '').trim();
    if (code && name) return `${code} - ${name}`;
    if (name) return name;
    if (code) return code;
    return 'Center: N/A';
};
const daybookRowTypeFromAmounts = (credit: number, debit: number) => (debit > 0 ? 'CP' : 'CR');


const pushAggregated = (
    map: Map<
        string,
        {
            entry: DaybookEntryWithMeta;
            count: number;
        }
    >,
    key: string,
    base: DaybookEntryWithMeta
) => {
    const existing = map.get(key);
    if (!existing) {
        map.set(key, { entry: base, count: 1 });
        return;
    }

    existing.entry.credit += base.credit;
    existing.entry.debit += base.debit;
    existing.entry._rawDate = Math.min(existing.entry._rawDate, base._rawDate);
    existing.count += 1;
};

type EntryWithMeta = DaybookEntry & { _rawDate: number };

type AggBucket = { entry: EntryWithMeta; count: number };

const pushAgg = (map: Map<string, AggBucket>, key: string, base: EntryWithMeta) => {
    const existing = map.get(key);
    if (!existing) {
        map.set(key, { entry: { ...base }, count: 1 });
        return;
    }
    existing.entry.credit += base.credit;
    existing.entry.debit += base.debit;
    existing.entry._rawDate = Math.min(existing.entry._rawDate, base._rawDate);
    existing.count += 1;
};

const finalizeAgg = (map: Map<string, AggBucket>): EntryWithMeta[] => {
    const out: EntryWithMeta[] = [];
    for (const { entry, count } of map.values()) {
        entry.type = entry.debit > 0 ? 'DR' : 'CR';
        if (count > 1) {
            entry.description = `${(entry.description ?? '').trim()} (Members: ${count})`.trim();
        }
        out.push(entry);
    }
    return out;
};

// finMap-only merge helpers. Unlike the other buckets above (where one row
// already corresponds to ~one real event), a single FinancialTransaction row
// sourced from postIndexDisbursementAggregate can already represent several
// loan members bundled into one voucher (bulk HO Borrow / funder / fee legs —
// see accounting-posting.service.ts). So when the Day Book merges several such
// rows into one display line, "count of merged rows" is not a member count.
// HO Borrow and funder-leg descriptions carry a real embedded "(Members: N)"
// (added at posting time); fee-leg descriptions deliberately don't — they're
// exact-matched by app/lib/denomination-entry.ts's cash-reconciliation filter,
// so their text can't be touched. Sum the embedded counts when every merged
// row has one; otherwise label the merge honestly as postings, not members.
// Either way, every merged row's own voucher number/description is kept
// instead of only the first one's, so a loan-index reference is never
// silently dropped from the report.
const MEMBERS_SUFFIX_RE = / \(Members: (\d+)\)$/;

type FinAggBucket = {
    entry: EntryWithMeta;
    count: number;
    voucherNos: string[];
    rawDescriptions: string[];
};

const pushFin = (
    map: Map<string, FinAggBucket>,
    key: string,
    base: EntryWithMeta,
    voucherNo: string,
    rawDescription: string
) => {
    const existing = map.get(key);
    if (!existing) {
        map.set(key, { entry: { ...base }, count: 1, voucherNos: [voucherNo], rawDescriptions: [rawDescription] });
        return;
    }
    existing.entry.credit += base.credit;
    existing.entry.debit += base.debit;
    existing.entry._rawDate = Math.min(existing.entry._rawDate, base._rawDate);
    existing.count += 1;
    existing.voucherNos.push(voucherNo);
    existing.rawDescriptions.push(rawDescription);
};

const finalizeFinMap = (map: Map<string, FinAggBucket>): EntryWithMeta[] => {
    const out: EntryWithMeta[] = [];
    for (const { entry, count, voucherNos, rawDescriptions } of map.values()) {
        entry.type = entry.debit > 0 ? 'DR' : 'CR';
        if (count > 1) {
            const counts = rawDescriptions.map((d) => {
                const m = d.match(MEMBERS_SUFFIX_RE);
                return m ? Number(m[1]) : null;
            });
            const allKnown = counts.every((c): c is number => c !== null);
            const baseDescriptions = Array.from(
                new Set(rawDescriptions.map((d) => d.replace(MEMBERS_SUFFIX_RE, '').trim()))
            );
            const suffix = allKnown
                ? ` (Members: ${counts.reduce((s, c) => s + c, 0)})`
                : ` (${count} postings)`;
            entry.description = `${baseDescriptions.join(' | ')}${suffix}`.trim();
            entry.refNo = voucherNos.join(', ');
        }
        out.push(entry);
    }
    return out;
};

const finalizeAggregatedEntries = (
    map: Map<
        string,
        {
            entry: DaybookEntryWithMeta;
            count: number;
        }
    >
): DaybookEntryWithMeta[] => {
    const out: DaybookEntryWithMeta[] = [];
    for (const { entry, count } of map.values()) {
        // Make the "Type" column consistent after aggregation
        entry.type = daybookRowTypeFromAmounts(entry.credit, entry.debit);
        if (count > 1) {
            const suffix = ` (Members: ${count})`;
            entry.description = `${(entry.description || '').trim()}${suffix}`.trim();
        }
        out.push(entry);
    }
    return out;
};

export async function getDaybookData(
    fromDate: string,
    toDate?: string,
    branchId?: string,
    page: number = 1,
    pageSize: number = 20,
    isHODaybook: boolean = false,
    exportAll: boolean = false
): Promise<DaybookResult & { totalPages: number }> {
    // IST-aware day bounds — independent of server timezone.
    // Using setHours(0,0,0,0) would shift by 5h30m on UTC servers and produce wrong dates.
    const effectiveToDate = toDate || fromDate;
    const start = parseKolkataAttendanceDateYmd(fromDate);                              // IST 00:00 of fromDate
    const end   = new Date(parseKolkataAttendanceDateYmd(
        addCalendarDaysToYmd(effectiveToDate, 1)
    ).getTime() - 1);                                                                   // IST 23:59:59.999 of toDate

    // Day Book's opening balance is a cash position, bridged from the branch's "Cash in
    // Hand" ledger opening balance (Day Book only ever deals in CASH_RECEIPT/CASH_PAYMENT
    // — never bank — so only the Cash in Hand bridge applies here, not Bank). Only
    // meaningful for a single concrete branch (both the HO path's branchId and the normal
    // path's branchId are one real branch) — the 'all' aggregate view has no single branch
    // to anchor against and keeps its existing naive/since-inception behavior.
    let cashOpeningContext: { openingDate: Date; configuredAmount: number } | null = null;
    if (branchId && branchId !== 'head_office' && branchId !== 'all') {
        const [branchContexts, selfBridges] = await Promise.all([
            getBranchOpeningContext([branchId]),
            resolveSelfAccountBridges(),
        ]);
        const context = branchContexts.get(branchId);
        // Prefer a direct SelfAccountOpeningBalance row for the Cash in Hand self account;
        // fall back to the legacy name→ledger bridge for branches configured only that way.
        const cashSelfAccountId = selfBridges.cashInHand?.selfAccountId ?? null;
        const bridgeLedgerId = selfBridges.cashInHand?.bridgeLedgerId ?? null;
        if (context) {
            const amt = selfAccountOpeningAmount(context, cashSelfAccountId ?? '', bridgeLedgerId);
            if (amt !== null) {
                cashOpeningContext = { openingDate: context.openingDate, configuredAmount: amt };
            }
        }
    }
    // Lower bound for every "before start" opening-balance query below — the branch's
    // configured opening date when bridged, otherwise unbounded (naive/since-inception,
    // unchanged from before).
    const beforeStartRange = cashOpeningContext
        ? { gte: cashOpeningContext.openingDate, lt: start }
        : { lt: start };

    // ── HO DAYBOOK PATH ───────────────────────────────────────────────────────
    // When viewing the Head Office branch the daybook shows ONLY:
    //   (1) HO's own direct receipts / payments  (branchId = HO)
    //   (2) Inter-branch transfers the HO made to sub-branches
    //       → shown as "CP  BRANCH NAME"  /  "Being Amount Given To …"
    //   (3) Branch HO Remittance entries  (branch CASH_PAYMENTs whose ledger
    //       name contains "HO REMITTANCE" — covers old and new ledger names)
    //       → shown as "CR  BRANCH NAME"  /  "Being Amount From …"
    // Loan portfolio transactions from all branches are NOT included.
    if (isHODaybook && branchId) {
        // PostgreSQL: NOT (NULL LIKE '%X%') = NOT NULL = NULL → row excluded.
        // Transactions with a NULL description are NEVER GL shadows, so we must
        // explicitly allow them with the OR: [{ description: null }, ...] guard.
        const glShadowFilter = GL_SHADOW_DESCRIPTION_MARKERS.map((m) => ({
            OR: [
                { description: null },
                { NOT: { description: { contains: m } } },
            ],
        }));

        // ── Resolve HO ledger IDs ─────────────────────────────────────────────
        // HO REMITTANCE variants: "HO Remittance", "HO REMITTANCE CASH", "HO REMITTANCE BANK", etc.
        // HO BORROW variants:     "HO Borrow", "HO BORROWINGS", etc.
        const [hoRemittanceLedgers, hoBorrowLedgers] = await Promise.all([
            prisma.accountLedger.findMany({
                where: { isActive: true, ledgerName: { contains: 'HO REMITTANCE', mode: 'insensitive' } },
                select: { id: true },
            }),
            prisma.accountLedger.findMany({
                where: { isActive: true, ledgerName: { contains: 'HO BORROW', mode: 'insensitive' } },
                select: { id: true },
            }),
        ]);
        const hoRemittanceLedgerIds = hoRemittanceLedgers.map((l) => l.id);
        const hoBorrowLedgerIds     = hoBorrowLedgers.map((l) => l.id);

        const noRemittFilter = hoRemittanceLedgerIds.length > 0
            ? { ledgerId: { in: hoRemittanceLedgerIds } }
            : null;
        const noBorrowFilter = hoBorrowLedgerIds.length > 0
            ? { ledgerId: { in: hoBorrowLedgerIds } }
            : null;

        // ── Opening Balance ───────────────────────────────────────────────────
        //
        // HO CASH INFLOWS  (+)
        //   1. HO own CASH_RECEIPT  (excl. any with HO Borrow ledger — those are debits)
        //   2. Branch CASH_PAYMENT  with HO Remittance ledger  (branches remitting to HO)
        //
        // HO CASH OUTFLOWS (-)
        //   3. HO own CASH_PAYMENT  (all — inter-branch IBT payments + direct expenses)
        //   4. HO own CASH_RECEIPT  with HO Borrow ledger      (wrong entry type; HO gave to branch)
        //   5. non-HO CASH_RECEIPT  with HO Borrow ledger AND no IBT link
        //      (branch received via ho-transaction route; formal IBT toTxns excluded — already
        //       counted via the matching HO CASH_PAYMENT in item 3)

        const [hoAllRcptBefore, hoPayBefore, branchRemittBefore] = await Promise.all([
            prisma.financialTransaction.aggregate({
                where: { branchId, isActive: true, type: 'CASH_RECEIPT', transactionDate: beforeStartRange, AND: glShadowFilter },
                _sum: { amount: true },
            }),
            prisma.financialTransaction.aggregate({
                where: { branchId, isActive: true, type: 'CASH_PAYMENT', transactionDate: beforeStartRange, AND: glShadowFilter },
                _sum: { amount: true },
            }),
            noRemittFilter
                ? prisma.financialTransaction.aggregate({
                    // These are OTHER branches' remittances to HO — bridging them by HO's
                    // own opening date would truncate Branch B's history by a cutover that
                    // has nothing to do with Branch B (it may have its own, different, date
                    // or none at all). HO's configured opening amount is assumed to already
                    // embody whatever cross-branch flows happened before its own cutover;
                    // this stays naive/since-inception regardless of HO's bridge.
                    where: { isActive: true, type: 'CASH_PAYMENT', branchId: { not: branchId }, ...noRemittFilter, transactionDate: { lt: start } },
                    _sum: { amount: true },
                })
                : Promise.resolve({ _sum: { amount: null as any } }),
        ]);

        // HO own CASH_RECEIPT that are HO Borrow (treat as debit — cash went to branch)
        const hoBorrowRcptOnHOBefore = noBorrowFilter
            ? await prisma.financialTransaction.aggregate({
                where: { branchId, isActive: true, type: 'CASH_RECEIPT', ...noBorrowFilter, transactionDate: beforeStartRange },
                _sum: { amount: true },
            })
            : { _sum: { amount: null as any } };

        // non-HO CASH_RECEIPT with HO Borrow ledger, NO formal IBT link — another branch's
        // rows, same reasoning as branchRemittBefore above: stays naive, not bridged by HO's
        // own opening date.
        const branchBorrowBeforeRows = noBorrowFilter
            ? await prisma.financialTransaction.findMany({
                where: {
                    isActive: true, type: 'CASH_RECEIPT',
                    branchId: { not: branchId },
                    ...noBorrowFilter,
                    transactionDate: { lt: start },
                    interBranchTransferTo: null,   // formal IBT branch-side already counted via HO CASH_PAYMENT
                },
                select: { amount: true },
            })
            : [];
        const branchBorrowBeforeSum = branchBorrowBeforeRows.reduce((s, t) => s + Number(t.amount), 0);

        // Credits to HO: (all HO receipts) − (HO Borrow receipts) + (branch remittances)
        // Debits from HO: (HO payments) + (HO Borrow receipts) + (branch borrow via ho-txn)
        const hoCredBefore = Number(hoAllRcptBefore._sum.amount ?? 0)
                           - Number(hoBorrowRcptOnHOBefore._sum.amount ?? 0)   // remove from credits
                           + Number(branchRemittBefore._sum.amount ?? 0);
        const hoDebBefore  = Number(hoPayBefore._sum.amount ?? 0)
                           + Number(hoBorrowRcptOnHOBefore._sum.amount ?? 0)   // add as debit
                           + branchBorrowBeforeSum;
        // Seeded with the branch's configured Cash in Hand opening balance when bridged
        // (0 otherwise) — hoCredBefore/hoDebBefore are already restricted to the bridge
        // window (openingDate..start) in that case, exactly like every other report.
        const openingBalance = (cashOpeningContext?.configuredAmount ?? 0) + hoCredBefore - hoDebBefore;

        // ── Period Totals ─────────────────────────────────────────────────────
        const [hoAllRcptPeriod, hoPayPeriod, branchRemittPeriod] = await Promise.all([
            prisma.financialTransaction.aggregate({
                where: { branchId, isActive: true, type: 'CASH_RECEIPT', transactionDate: { gte: start, lte: end }, AND: glShadowFilter },
                _sum: { amount: true },
            }),
            prisma.financialTransaction.aggregate({
                where: { branchId, isActive: true, type: 'CASH_PAYMENT', transactionDate: { gte: start, lte: end }, AND: glShadowFilter },
                _sum: { amount: true },
            }),
            noRemittFilter
                ? prisma.financialTransaction.aggregate({
                    where: { isActive: true, type: 'CASH_PAYMENT', branchId: { not: branchId }, ...noRemittFilter, transactionDate: { gte: start, lte: end } },
                    _sum: { amount: true },
                })
                : Promise.resolve({ _sum: { amount: null as any } }),
        ]);

        const hoBorrowRcptOnHOPeriod = noBorrowFilter
            ? await prisma.financialTransaction.aggregate({
                where: { branchId, isActive: true, type: 'CASH_RECEIPT', ...noBorrowFilter, transactionDate: { gte: start, lte: end } },
                _sum: { amount: true },
            })
            : { _sum: { amount: null as any } };

        // non-HO CASH_RECEIPT with HO Borrow ledger, no IBT (branch received via ho-txn route)
        const branchBorrowPeriodTxns = noBorrowFilter
            ? await prisma.financialTransaction.findMany({
                where: {
                    isActive: true, type: 'CASH_RECEIPT',
                    branchId: { not: branchId },
                    ...noBorrowFilter,
                    transactionDate: { gte: start, lte: end },
                    interBranchTransferTo: null,
                },
                select: {
                    voucherNo: true, transactionDate: true, amount: true, description: true,
                    branch: { select: { id: true, name: true, code: true } },
                },
                orderBy: { transactionDate: 'asc' },
            })
            : [];
        const branchBorrowPeriodSum = branchBorrowPeriodTxns.reduce((s, t) => s + Number(t.amount), 0);

        const totalCredits =
            (Number(hoAllRcptPeriod._sum.amount ?? 0) - Number(hoBorrowRcptOnHOPeriod._sum.amount ?? 0))
            + Number(branchRemittPeriod._sum.amount ?? 0);
        const totalDebits =
            Number(hoPayPeriod._sum.amount ?? 0)
            + Number(hoBorrowRcptOnHOPeriod._sum.amount ?? 0)
            + branchBorrowPeriodSum;

        // ── Fetch Period Entries ──────────────────────────────────────────────

        // 1. HO's own financial transactions
        const hoOwnTxns = await prisma.financialTransaction.findMany({
            where: {
                branchId, isActive: true,
                type: { in: ['CASH_RECEIPT', 'CASH_PAYMENT'] },
                transactionDate: { gte: start, lte: end },
                AND: glShadowFilter,
            },
            select: {
                voucherNo: true, transactionDate: true, type: true,
                amount: true, description: true,
                ledgerId: true,                                      // needed for HO Borrow detection
                ledger: { select: { ledgerName: true } },
                interBranchTransferFrom: {                           // link → destination branch
                    select: { toBranch: { select: { name: true, code: true } } },
                },
            },
            orderBy: { transactionDate: 'asc' },
        });

        // 2. Branch HO Remittance payments (branches remitting cash to HO)
        const branchRemittTxns = hoRemittanceLedgerIds.length > 0
            ? await prisma.financialTransaction.findMany({
                where: {
                    isActive: true, type: 'CASH_PAYMENT',
                    branchId: { not: branchId },
                    ledgerId: { in: hoRemittanceLedgerIds },
                    transactionDate: { gte: start, lte: end },
                },
                select: {
                    voucherNo: true, transactionDate: true, amount: true, description: true,
                    branch: { select: { id: true, name: true, code: true } },
                },
                orderBy: { transactionDate: 'asc' },
            })
            : [];

        // ── Build Aggregation Maps ────────────────────────────────────────────
        // We manage type explicitly — don't use finalizeAgg (it would overwrite type).
        const finalizeHOMap = (map: Map<string, AggBucket>): EntryWithMeta[] => {
            const out: EntryWithMeta[] = [];
            for (const { entry, count } of map.values()) {
                if (count > 1) {
                    entry.description = `${(entry.description ?? '').trim()} (×${count})`.trim();
                }
                out.push(entry);
            }
            return out;
        };

        const hoInterBranchMap = new Map<string, AggBucket>(); // HO → Branch via IBT CASH_PAYMENT
        const hoDirectMap      = new Map<string, AggBucket>(); // Direct HO income/expenses
        const branchRemittMap  = new Map<string, AggBucket>(); // Branch → HO remittances (CR)
        const hoBorrowGivenMap = new Map<string, AggBucket>(); // HO → Branch via ho-txn (CP, branch side)

        for (const tx of hoOwnTxns) {
            if (isGlShadow(tx.voucherNo, tx.description)) continue;
            const rawDate    = new Date(tx.transactionDate).getTime();
            const txDateStr  = fmtIstDate(new Date(tx.transactionDate));
            const amt        = Number(tx.amount);
            const isReceipt  = tx.type === 'CASH_RECEIPT';
            const destBranch = tx.interBranchTransferFrom?.toBranch;

            // CASH_RECEIPT with HO Borrow ledger = HO gave money to branch (wrong entry type)
            const isHOBorrowRcpt = isReceipt && hoBorrowLedgerIds.includes(tx.ledgerId ?? '');

            if (!isReceipt && destBranch) {
                // Formal inter-branch transfer: HO paid cash to branch → CP [branch] BORROW
                pushAgg(hoInterBranchMap, `HO→${destBranch.code}|${txDateStr}`, {
                    date: txDateStr, type: 'CP',
                    particulars: `${destBranch.name.toUpperCase()} BORROW`,
                    description: `Being Amount Given To ${destBranch.code} - ${destBranch.name}`,
                    credit: 0, debit: amt,
                    paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                    refNo: tx.voucherNo ?? '', _rawDate: rawDate,
                });
            } else if (isHOBorrowRcpt) {
                // CASH_RECEIPT on HO with HO Borrow ledger = cash went out to branch
                // Treat as debit (CP) — this fixes the wrong-type display.
                const ledgerName = (tx.ledger?.ledgerName ?? 'HO BORROW').trim().toUpperCase();
                pushAgg(hoDirectMap, `HO_BORROW_RCPT|${ledgerName}|${txDateStr}`, {
                    date: txDateStr, type: 'CP',
                    particulars: ledgerName,
                    description: tx.description || 'Cash Given to Branch',
                    credit: 0, debit: amt,
                    paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                    refNo: tx.voucherNo ?? '', _rawDate: rawDate,
                });
            } else {
                // All other HO transactions — direct income (CR) or direct expense/payment (CP)
                const ledgerName = (tx.ledger?.ledgerName ?? 'Manual Entry').trim().toUpperCase();
                pushAgg(hoDirectMap, `DIRECT|${ledgerName}|${isReceipt ? 'CR' : 'CP'}|${txDateStr}`, {
                    date: txDateStr, type: isReceipt ? 'CR' : 'CP',
                    particulars: ledgerName,
                    description: tx.description || (isReceipt ? 'Cash Receipt' : 'Cash Payment'),
                    credit: isReceipt ? amt : 0,
                    debit:  isReceipt ? 0   : amt,
                    paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                    refNo: tx.voucherNo ?? '', _rawDate: rawDate,
                });
            }
        }

        for (const tx of branchRemittTxns) {
            const rawDate   = new Date(tx.transactionDate).getTime();
            const txDateStr = fmtIstDate(new Date(tx.transactionDate));
            const amt       = Number(tx.amount);
            const b         = tx.branch;
            // Particulars: "BRANCH NAME REMITTANCE" so the HO can distinguish
            // remittances from borrows at a glance.
            const remittParticulars = b
                ? `${b.name.toUpperCase()} REMITTANCE`
                : 'BRANCH REMITTANCE';
            pushAgg(branchRemittMap, `REMITT|${b?.id ?? 'UNK'}|${txDateStr}`, {
                date: txDateStr, type: 'CR',
                particulars: remittParticulars,
                description: b
                    ? `Being Amount From ${b.code} - ${b.name}`
                    : tx.description || 'Branch Remittance',
                credit: amt, debit: 0,
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: tx.voucherNo ?? '', _rawDate: rawDate,
            });
        }

        // Branch received from HO via ho-transaction route (no formal IBT)
        // These are the missing HO debits when the branch records HO_BORROW.
        for (const tx of branchBorrowPeriodTxns) {
            const rawDate   = new Date(tx.transactionDate).getTime();
            const txDateStr = fmtIstDate(new Date(tx.transactionDate));
            const amt       = Number(tx.amount);
            const b         = tx.branch;
            // Particulars: "BRANCH NAME BORROW" to mirror the Remittance naming.
            const borrowParticulars = b
                ? `${b.name.toUpperCase()} BORROW`
                : 'BRANCH BORROW';
            pushAgg(hoBorrowGivenMap, `HOBORROW_GIVEN|${b?.id ?? 'UNK'}|${txDateStr}`, {
                date: txDateStr, type: 'CP',
                particulars: borrowParticulars,
                description: b
                    ? `Being Amount Given To ${b.code} - ${b.name}`
                    : tx.description || 'Cash Given to Branch',
                credit: 0, debit: amt,
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: tx.voucherNo ?? '', _rawDate: rawDate,
            });
        }

        const allHOEntries: EntryWithMeta[] = [
            ...finalizeHOMap(branchRemittMap),
            ...finalizeHOMap(hoInterBranchMap),
            ...finalizeHOMap(hoBorrowGivenMap),
            ...finalizeHOMap(hoDirectMap),
        ];

        allHOEntries.sort((a, b) => a._rawDate - b._rawDate);

        const finalEntries = allHOEntries.map(({ _rawDate, ...rest }) => rest);
        const totalCount   = finalEntries.length;
        const paginatedEntries = exportAll ? finalEntries : finalEntries.slice((page - 1) * pageSize, page * pageSize);
        const closingBalance   = openingBalance + totalCredits - totalDebits;

        return {
            openingBalance,
            transactions: paginatedEntries,
            closingBalance,
            totalCredits,
            totalDebits,
            summary: {
                totalTxns:   totalCount,
                creditCount: finalEntries.filter((e) => e.credit > 0).length,
                debitCount:  finalEntries.filter((e) => e.debit  > 0).length,
            },
            totalPages: Math.ceil(totalCount / pageSize) || 1,
        };
    }
    // ── END HO DAYBOOK PATH ───────────────────────────────────────────────────

    const loanTxWhere: any = {
        paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
        isReversed: false,
        status: 'APPROVED',
        // Migrated history from the bulk "Ongoing Loan Backup" Excel import
        // (/dashboard/masters/uploan/member) never gets a real GL voucher — it's excluded
        // from Day Book display here so it doesn't read as live cash activity, without
        // touching the transaction ledger itself (PAR/CCR/DCB still see it normally).
        loan: { isBulkMemberImport: false },
        // 'Client Admission Fee' / SYSTEM_LEDGERS.DOC_CHARGES.name ('Document Charge
        // Income') loanTransaction FEE rows are created exclusively by bm-disburse
        // alongside the loan itself, and ALWAYS get a paired real GL leg from
        // postIndexDisbursementAggregate's bulk Admission Fees / Processing Fees
        // CASH_RECEIPT vouchers (ledgers "Admission & Training Charges" / "Processing
        // Fees", picked up below via finMap). Excluding them here — same rule as
        // DISBURSEMENT/REPAYMENT/SAVINGS_COLLECTION — keeps both the row list and the
        // CREDIT_LOAN_TYPES balance sum from double-counting them once their real GL
        // leg is included.
        NOT: { AND: [{ type: 'FEE' }, { description: { in: ['Document Charge Income', 'Client Admission Fee'] } }] },
    };
    if (branchId && branchId !== 'head_office' && branchId !== 'all') {
        loanTxWhere.branchId = branchId;
    }

    // Financial-transaction scope (genuine manual cash entries only — no GL shadows).
    //
    // Layer 1 (DB-level): exclude rows whose description contains the well-known
    // AccountingPostingService marker prefix.  This prevents GL echo rows from
    // ever reaching the application layer regardless of their voucherNo format.
    //
    // Layer 2 (JS-level): isGlShadow() double-checks both voucherNo and
    // description inside the loop below as a defence-in-depth measure.
    const finTxWhere: any = {
        isActive: true,
        type: { in: ['CASH_RECEIPT', 'CASH_PAYMENT'] },
        AND: GL_SHADOW_DESCRIPTION_MARKERS.map((marker) => ({
            OR: [
                { description: null },
                { NOT: { description: { contains: marker } } },
            ],
        })),
    };
    if (branchId && branchId !== 'head_office' && branchId !== 'all') {
        Object.assign(finTxWhere, buildFinancialTransactionBranchScope({ branchId }));
    }

    // ── 1. Opening balance ────────────────────────────────────────────────────

    // Loan transactions before `start`
    const prevLoanGroups = await prisma.loanTransaction.groupBy({
        by: ['type'],
        where: { ...loanTxWhere, transactionDate: beforeStartRange },
        _sum: { principalAmount: true, interestAmount: true, feesAmount: true, amount: true },
    });

    // REPAYMENT and SAVINGS_COLLECTION are intentionally excluded — their cash is only counted
    // once actually posted to GL via "Allocate for EOD" (picked up through the
    // financialTransaction sums below, now that EOD_COLLECTION/EOD_LOAN_ADVANCE postings aren't
    // shadow-filtered). Counting them here too would double them while still pending allocation.
    // DISBURSEMENT is excluded for the same reason: postIndexDisbursementAggregate posts the real
    // funder-ledger CASH_PAYMENT ("{FUNDER} FUND [GOLD] PRINCIPAL") at final disbursement, which
    // is picked up via the financialTransaction sums below — counting it again from the raw
    // loanTransaction row here would double the cash outflow.
    // PRECLOSURE removed from this generic bucket — like REPAYMENT/SAVINGS_COLLECTION, a *new*
    // (post-cutover) pre-closure's cash is only counted once actually posted to GL via "Allocate
    // for EOD" (postEodClosureAllocation), picked up through the financialTransaction sums below;
    // counting it here too would double it while pending allocation. This groupBy has no way to
    // distinguish an old (pre-cutover, permanently unallocatable) PRECLOSURE row from a new
    // pending one, so historical PRECLOSURE recognition moved to its own dedicated,
    // precisely-scoped block below (see "Pre-cutover PRECLOSURE/WRITEOFF cash"). WRITEOFF is
    // provably dead in DEBIT_LOAN_TYPES below (loanTxWhere already excludes
    // paymentMode:'ADJUSTMENT' rows, and every real WRITEOFF row uses that mode), kept as
    // harmless legacy rather than removed to avoid touching unrelated code in this change.
    // SAVINGS_REFUND is excluded for the same reason REPAYMENT/SAVINGS_COLLECTION/DISBURSEMENT
    // are: approving a refund now posts a real Cash Payment voucher against the LOAN ADVANCE
    // ledger (accounting-posting.service.ts's postSavingsRefundPayment), picked up through the
    // financialTransaction sums below — counting it again from the raw loanTransaction row here
    // would double the cash outflow.
    const CREDIT_LOAN_TYPES = ['FEE', 'PENALTY', 'ADJUSTMENT'];
    const DEBIT_LOAN_TYPES  = ['WRITEOFF'];

    // Seeded with the branch's configured Cash in Hand opening balance when bridged (0
    // otherwise) — every "before start" query above/below is already restricted to the
    // bridge window (openingDate..start) in that case, so this sums cleanly on top.
    let openingBalance = cashOpeningContext?.configuredAmount ?? 0;
    for (const g of prevLoanGroups) {
        // For REPAYMENT we use principalAmount + interestAmount (cash collected).
        // For DISBURSEMENT we use amount.
        let cashAmt = 0;
        if (g.type === 'REPAYMENT' || g.type === 'PRECLOSURE') {
            cashAmt =
                Number(g._sum.principalAmount ?? 0) + Number(g._sum.interestAmount ?? 0);
        } else if (g.type === 'FEE') {
            cashAmt = Number(g._sum.feesAmount ?? g._sum.amount ?? 0);
        } else {
            cashAmt = Number(g._sum.amount ?? 0);
        }
        if (CREDIT_LOAN_TYPES.includes(g.type)) openingBalance += cashAmt;
        else if (DEBIT_LOAN_TYPES.includes(g.type)) openingBalance -= cashAmt;
    }

    // Pre-cutover PRECLOSURE/WRITEOFF cash: rows approved (and, for WRITEOFF, loan already
    // closed) *before* this branch's EOD-deferral change existed. Those loans finalized
    // immediately at approval under the old model and — since the eodAllocatedAt gate didn't
    // exist yet — will never go through "Allocate for EOD" and never get a real GL voucher, so
    // without this dedicated recognition their cash would silently vanish from historical
    // Daybook/Trial Balance figures for periods that were already closed and reported on.
    //
    // Scoped to `eodAllocatedAt: null AND loan.isActive: false` — this combination can only be
    // true for a pre-cutover row: a *new* pending closure has eodAllocatedAt:null but
    // loan.isActive:true (not finalized yet), and a new *finalized* closure always has
    // eodAllocatedAt set (postEodClosureAllocation stamps it in the same transaction as
    // finalization) — so this can never match a post-cutover row, live or historical, and never
    // double-counts against the financialTransaction sums below.
    //
    // Hoisted (not a one-off inline query) — reused for the period-totals block and the itemized
    // display rows further below, all needing the identical eligibility scope.
    const preCutoverClosureWhere = (type: 'PRECLOSURE' | 'WRITEOFF', dateRange: any): any => {
        const where: any = {
            type,
            isReversed: false,
            status: 'APPROVED',
            eodAllocatedAt: null,
            // isBulkMemberImport: false mirrors loanTxWhere's own exclusion (see its comment) —
            // without it, a bulk-imported migrated loan's pre-cutover PRECLOSURE/WRITEOFF cash
            // was being added to totalCredits/closingBalance here while staying permanently
            // invisible in the displayed row list (loanTxWhere excludes such loans from the
            // `loanTxns` query that builds every visible row), so the Day Book's printed Total
            // silently exceeded the sum of its own itemized rows by exactly that loan's amount.
            loan: { isActive: false, isBulkMemberImport: false },
            transactionDate: dateRange,
            // Mirrors the paymentMode scope each type's *original* pre-this-change recognition
            // path used, so the historical totals being preserved actually match what was
            // reported before: PRECLOSURE went through loanTxWhere (paymentMode:CASH only — the
            // foreclosure submit schema allows CASH/BANK_TRANSFER/CHEQUE/UPI/ADJUSTMENT, so a
            // non-cash pre-closure was never in the cash-book figures to begin with); WRITEOFF
            // always used paymentMode:'ADJUSTMENT' (loan-writeoff-closure/route.ts always creates
            // it that way). Without this, PRECLOSURE here would newly include non-cash rows the
            // old code never counted — moving historical totals in the opposite direction from
            // the vanishing this restoration is meant to prevent.
            paymentMode: type === 'WRITEOFF' ? 'ADJUSTMENT' : DAYBOOK_PAYMENT_MODE_CASH,
        };
        if (branchId && branchId !== 'head_office' && branchId !== 'all') where.branchId = branchId;
        return where;
    };
    {
        const [prevPreCutoverPreclosure, prevPreCutoverWriteoff] = await Promise.all([
            prisma.loanTransaction.aggregate({ where: preCutoverClosureWhere('PRECLOSURE', beforeStartRange), _sum: { principalAmount: true, interestAmount: true } }),
            prisma.loanTransaction.aggregate({ where: preCutoverClosureWhere('WRITEOFF', beforeStartRange), _sum: { principalAmount: true, interestAmount: true } }),
        ]);
        openingBalance += Number(prevPreCutoverPreclosure._sum.principalAmount ?? 0) + Number(prevPreCutoverPreclosure._sum.interestAmount ?? 0);
        openingBalance += Number(prevPreCutoverWriteoff._sum.principalAmount ?? 0) + Number(prevPreCutoverWriteoff._sum.interestAmount ?? 0);
    }

    // Genuine financial transactions before `start`.
    // Use aggregate (not groupBy) to avoid potential issues with OR + nested-relation
    // filters in some Prisma/DB configurations.
    // NULL-safe GL shadow filter:
    // NOT (NULL LIKE '%X%') = NULL in PostgreSQL → rows with NULL description would be
    // excluded.  We explicitly allow NULL descriptions because they can never be GL shadows.
    const finTxBranchOnly: any = {
        isActive: true,
        // Manual vouchers only count once fully approved (3-level maker-checker) —
        // otherwise a PENDING_APPROVAL/PENDING_AM_APPROVAL/REJECTED voucher would
        // show in the Cash Book / Daybook and move the closing balance before any
        // approver has signed off on it.
        approvalStatus: 'APPROVED',
        AND: GL_SHADOW_DESCRIPTION_MARKERS.map((m) => ({
            OR: [
                { description: null },
                { NOT: { description: { contains: m } } },
            ],
        })),
    };
    if (branchId && branchId !== 'head_office' && branchId !== 'all') {
        // Simple direct branchId filter for aggregates (avoids nested-relation groupBy issues).
        // The legacy createdBy fallback is handled by the findMany display query below.
        finTxBranchOnly.branchId = branchId;
    }

    const [prevFinRcptAgg, prevFinPayAgg] = await Promise.all([
        prisma.financialTransaction.aggregate({
            where: { ...finTxBranchOnly, type: 'CASH_RECEIPT', transactionDate: beforeStartRange },
            _sum: { amount: true },
        }),
        prisma.financialTransaction.aggregate({
            where: { ...finTxBranchOnly, type: 'CASH_PAYMENT', transactionDate: beforeStartRange },
            _sum: { amount: true },
        }),
    ]);
    openingBalance += Number(prevFinRcptAgg._sum.amount ?? 0) - Number(prevFinPayAgg._sum.amount ?? 0);

    // Branch-scoped admission fees filter (prevents cross-branch contamination)
    const clientBranchFilter: any =
        branchId && branchId !== 'head_office' && branchId !== 'all'
            ? { center: { branchId } }
            : {};

    // Admission fees before `start` — bridged the same way as every other cash source
    // above, since admission fees are also part of the branch's physical cash position.
    const prevAdmission = await prisma.client.aggregate({
        where: { createdAt: beforeStartRange, admissionFees: { gt: 0 }, ...clientBranchFilter },
        _sum: { admissionFees: true },
    });
    openingBalance += Number(prevAdmission._sum.admissionFees ?? 0);

    // ── 2. Period totals (for summary cards) ─────────────────────────────────

    const periodLoanGroups = await prisma.loanTransaction.groupBy({
        by: ['type'],
        where: { ...loanTxWhere, transactionDate: { gte: start, lte: end } },
        _sum: { principalAmount: true, interestAmount: true, feesAmount: true, amount: true },
    });

    let totalCredits = 0;
    let totalDebits  = 0;

    for (const g of periodLoanGroups) {
        let cashAmt = 0;
        if (g.type === 'REPAYMENT' || g.type === 'PRECLOSURE') {
            cashAmt =
                Number(g._sum.principalAmount ?? 0) + Number(g._sum.interestAmount ?? 0);
        } else if (g.type === 'FEE') {
            cashAmt = Number(g._sum.feesAmount ?? g._sum.amount ?? 0);
        } else {
            cashAmt = Number(g._sum.amount ?? 0);
        }
        if (CREDIT_LOAN_TYPES.includes(g.type)) totalCredits += cashAmt;
        else if (DEBIT_LOAN_TYPES.includes(g.type)) totalDebits += cashAmt;
    }

    // Genuine financial transactions in period — use aggregate for reliability.
    const [periodFinRcptAgg, periodFinPayAgg] = await Promise.all([
        prisma.financialTransaction.aggregate({
            where: { ...finTxBranchOnly, type: 'CASH_RECEIPT', transactionDate: { gte: start, lte: end } },
            _sum: { amount: true },
        }),
        prisma.financialTransaction.aggregate({
            where: { ...finTxBranchOnly, type: 'CASH_PAYMENT', transactionDate: { gte: start, lte: end } },
            _sum: { amount: true },
        }),
    ]);
    totalCredits += Number(periodFinRcptAgg._sum.amount ?? 0);
    totalDebits  += Number(periodFinPayAgg._sum.amount  ?? 0);

    // Admission fees in period (branch-scoped)
    const periodAdmission = await prisma.client.aggregate({
        where: { createdAt: { gte: start, lte: end }, admissionFees: { gt: 0 }, ...clientBranchFilter },
        _sum: { admissionFees: true },
    });
    totalCredits += Number(periodAdmission._sum.admissionFees ?? 0);

    // Pre-cutover PRECLOSURE/WRITEOFF cash in period — see the matching comment and
    // preCutoverClosureWhere definition above the opening-balance block.
    {
        const periodRange = { gte: start, lte: end };
        const [periodPreCutoverPreclosure, periodPreCutoverWriteoff] = await Promise.all([
            prisma.loanTransaction.aggregate({ where: preCutoverClosureWhere('PRECLOSURE', periodRange), _sum: { principalAmount: true, interestAmount: true } }),
            prisma.loanTransaction.aggregate({ where: preCutoverClosureWhere('WRITEOFF', periodRange), _sum: { principalAmount: true, interestAmount: true } }),
        ]);
        totalCredits += Number(periodPreCutoverPreclosure._sum.principalAmount ?? 0) + Number(periodPreCutoverPreclosure._sum.interestAmount ?? 0);
        totalCredits += Number(periodPreCutoverWriteoff._sum.principalAmount ?? 0) + Number(periodPreCutoverWriteoff._sum.interestAmount ?? 0);
    }

    // ── 3. Fetch raw rows for the selected date ───────────────────────────────

    const loanTxns = await prisma.loanTransaction.findMany({
        where: { ...loanTxWhere, transactionDate: { gte: start, lte: end } },
        include: {
            client: { include: { center: true } },
            // Pull funder name (daybook rows are funder-wise, e.g. "OWN FUND", "JOHN FUNDER")
            // and loan product type (for the gold-loan flag, via isGoldLoanProduct) so Gold
            // rows read "{FUNDER} FUND GOLD ..." — matching the funder+type GL ledgers created
            // by accounting-posting.service.ts.
            loan: {
                select: {
                    isActive: true,
                    funder: { select: { funderName: true } },
                    loanProduct: { select: { loanProductType: { select: { name: true } } } },
                },
            },
        },
        orderBy: { transactionDate: 'asc' },
    });

    // Pre-cutover write-off (Loan Closing) loan transactions — see preCutoverClosureWhere above.
    // A *post-cutover* write-off's cash is finMap-sourced only (real posted voucher via
    // postEodClosureAllocation), once allocated — synthesizing it here too would double it (see
    // the push-loop below). A pre-cutover row can never be allocated, so it's fetched and
    // synthesized here exactly as the old code always did, to keep historical figures unchanged.
    const writeOffLoanTxns = await prisma.loanTransaction.findMany({
        where: preCutoverClosureWhere('WRITEOFF', { gte: start, lte: end }),
        select: {
            transactionId: true, transactionDate: true,
            principalAmount: true, interestAmount: true,
            loan: {
                select: {
                    funder: { select: { funderName: true } },
                    loanProduct: { select: { loanProductType: { select: { name: true } } } },
                },
            },
        },
        orderBy: { transactionDate: 'asc' },
    });

    // Admission fees display — branch-scoped to prevent cross-branch contamination
    const newClients = await prisma.client.findMany({
        where: { createdAt: { gte: start, lte: end }, admissionFees: { gt: 0 }, ...clientBranchFilter },
        include: { center: true },
    });

    // Use the same simple branchId filter used for aggregates above.
    // The previous finTxWhere (with OR + nested createdBy relation) caused Prisma
    // to silently miss rows in both findMany and groupBy for some DB configurations.
    const financialTxns = await prisma.financialTransaction.findMany({
        where: {
            ...finTxBranchOnly,
            type: { in: ['CASH_RECEIPT', 'CASH_PAYMENT'] },
            transactionDate: { gte: start, lte: end },
        },
        select: {
            voucherNo: true,
            transactionDate: true,
            type: true,
            amount: true,
            description: true,
            ledger: { select: { ledgerName: true } },
        },
        orderBy: { transactionDate: 'asc' },
    });

    // ── 4. Build aggregation maps ─────────────────────────────────────────────

    // One bucket per transaction TYPE per date — no center codes in keys or particulars.
    // Including date in the key ensures each day's rows appear separately in multi-date ranges.
    const repayPriMap   = new Map<string, AggBucket>(); // REPAYMENT principal, per date
    const repayIntMap   = new Map<string, AggBucket>(); // REPAYMENT interest, per date
    const preclosureMap = new Map<string, AggBucket>(); // PRECLOSURE, per date
    const feeDocMap     = new Map<string, AggBucket>(); // FEE: Document Charges, per date
    const feeInsMap     = new Map<string, AggBucket>(); // FEE: Insurance, per date
    const feeOtherMap   = new Map<string, AggBucket>(); // FEE: Other, per date + desc
    // No disbMap — DISBURSEMENT is GL-sourced via finMap (real funder-ledger CASH_PAYMENT
    // posted by postIndexDisbursementAggregate), same pattern as REPAYMENT/SAVINGS_COLLECTION.
    const savingsRefundMap = new Map<string, AggBucket>(); // SAVINGS_REFUND, per date
    const otherLoanMap  = new Map<string, AggBucket>(); // anything else

    for (const tx of loanTxns) {
        const rawDate   = new Date(tx.transactionDate).getTime();
        const txDateStr = fmtIstDate(new Date(tx.transactionDate));

        if (tx.type === 'REPAYMENT') {
            // Deliberately not synthesized here — a collection only appears in the Day Book
            // once it's actually posted to GL via "Allocate for EOD" (see finMap below, which
            // reads the real AccountLedger name/amount off financialTransaction). Until then
            // it's pending allocation and correctly absent from both the row list and the
            // opening/closing balance (see CREDIT_LOAN_TYPES above).
            continue;
        }

        if (tx.type === 'SAVINGS_COLLECTION') {
            // Deliberately not synthesized here — same rule as REPAYMENT above: a Loan Advance
            // collection only appears in the Day Book once it's actually posted to GL via
            // "Allocate for EOD" (see postEodLoanAdvanceAllocation), read off the real
            // AccountLedger name ("LOAN ADVANCE") through finMap below.
            continue;
        }

        if (tx.type === 'SAVINGS_REFUND') {
            // Deliberately not synthesized here — same rule as REPAYMENT/SAVINGS_COLLECTION
            // above: approving a refund now posts a real Cash Payment voucher against the real
            // "LOAN ADVANCE" ledger (accounting-posting.service.ts's postSavingsRefundPayment),
            // which surfaces below via finMap, sourced from the real AccountLedger. Synthesizing
            // a second row from this raw loanTransaction would double-count the cash outflow.
            continue;
        }

        if (tx.type === 'PRECLOSURE') {
            // A *post-cutover* pre-closure is deliberately not synthesized here — same rule as
            // REPAYMENT/SAVINGS_COLLECTION above: it only appears in the Day Book once actually
            // posted to GL via "Allocate for EOD" (postEodClosureAllocation), read off the real
            // funder ledger through finMap below. Until then it's pending allocation and
            // correctly absent from both the row list and the opening/closing balance.
            //
            // A *pre-cutover* row (loan already finalized under the old immediate-finalization
            // model, eodAllocatedAt never stamped — see preCutoverClosureWhere above) will never
            // reach finMap, since it can never be allocated. Synthesize it here instead, exactly
            // as the old code always did, so historical Daybook figures for already-reported
            // periods don't silently change.
            const isPreCutover = tx.eodAllocatedAt === null && (tx as any).loan?.isActive === false;
            if (!isPreCutover) continue;

            const pri   = Number(tx.principalAmount ?? 0);
            const int   = Number(tx.interestAmount  ?? 0);
            const total = pri + int > 0 ? pri + int : Number(tx.amount ?? 0);

            const funderLabel = buildFunderLabel((tx as any).loan?.funder?.funderName, false);
            const funderKey   = funderLabel.replace(/\s+/g, '_');

            pushAgg(preclosureMap, `PRE|${funderKey}|${txDateStr}`, {
                date: txDateStr,
                type: 'CR',
                particulars: `${funderLabel} PRE-CLOSURE`,
                description: `Pre-closure Amount Collected on ${txDateStr}`,
                credit: total,
                debit: 0,
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: tx.transactionId,
                _rawDate: rawDate,
            });
            continue;
        }

        if (tx.type === 'DISBURSEMENT') {
            // Deliberately not synthesized here — same rule as REPAYMENT/SAVINGS_COLLECTION
            // above: the real cash-payment voucher (Dr "{FUNDER} FUND [GOLD] PRINCIPAL", the
            // same funder/gold-scoped ledger collections credit) is posted by
            // postIndexDisbursementAggregate at final disbursement and picked up below via
            // finMap, sourced from the real AccountLedger. Synthesizing a second generic
            // "LOAN DISBURSEMENT" row from this raw loanTransaction would double-count the
            // cash outflow and hide the actual funder ledger it posted against.
            continue;
        }

        if (tx.type === 'FEE') {
            const feeAmt = Number(tx.feesAmount ?? tx.amount ?? 0);
            const desc   = (tx.description ?? '').trim();

            // 'Document Charge Income' / 'Client Admission Fee' never reach here —
            // loanTxWhere excludes them at the query level (see its comment), since
            // both always carry a paired real GL leg from postIndexDisbursementAggregate.

            if (desc === 'Member Insurance Payable') {
                pushAgg(feeInsMap, `INS|${txDateStr}`, {
                    date: txDateStr,
                    type: 'CR',
                    particulars: 'Member Insurance',
                    description: 'Insurance Premium Collected',
                    credit: feeAmt,
                    debit: 0,
                    paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                    refNo: tx.transactionId,
                    _rawDate: rawDate,
                });
                continue;
            }

            // Other fee types (e.g. processing fee, admission fee via loan tx)
            pushAgg(feeOtherMap, `FEEOTHER|${desc}|${txDateStr}`, {
                date: txDateStr,
                type: 'CR',
                particulars: desc || 'Fee Collection',
                description: 'Fee Collected',
                credit: feeAmt,
                debit: 0,
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: tx.transactionId,
                _rawDate: rawDate,
            });
            continue;
        }

        // Anything else (PENALTY, ADJUSTMENT, WRITEOFF, …)
        const isCredit = CREDIT_LOAN_TYPES.includes(tx.type);
        const amt      = Number(tx.amount ?? 0);
        pushAgg(otherLoanMap, `OTHER|${tx.type}|${txDateStr}`, {
            date: txDateStr,
            type: isCredit ? 'CR' : 'CP',
            particulars: tx.type.replace(/_/g, ' '),
            description: tx.description?.trim() || tx.type,
            credit: isCredit ? amt : 0,
            debit:  isCredit ? 0 : amt,
            paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
            refNo: tx.transactionId,
            _rawDate: rawDate,
        });
    }

    // Pre-cutover write-off closure: merge cash collected into funder-wise principal/interest
    // rows — safe from the finMap double-count a post-cutover row would risk (see
    // writeOffLoanTxns above) because preCutoverClosureWhere structurally excludes any row that
    // could ever be allocated/posted through postEodClosureAllocation.
    for (const wo of writeOffLoanTxns) {
        const rawDate   = new Date(wo.transactionDate).getTime();
        const txDateStr = fmtIstDate(new Date(wo.transactionDate));
        const paidP = Number(wo.principalAmount ?? 0);
        const paidI = Number(wo.interestAmount  ?? 0);

        const isGold = isGoldLoanProduct((wo as any).loan?.loanProduct?.loanProductType?.name);
        const funderLabel = buildFunderLabel((wo as any).loan?.funder?.funderName, isGold);
        const funderKey   = funderLabel.replace(/\s+/g, '_');

        if (paidP > 0) {
            pushAgg(repayPriMap, `PRI|${funderKey}|${txDateStr}`, {
                date: txDateStr, type: 'CR',
                particulars: `${funderLabel} PRINCIPAL`,
                description: `Principal Amount Collected on ${txDateStr}`,
                credit: paidP, debit: 0,
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: wo.transactionId,
                _rawDate: rawDate,
            });
        }
        if (paidI > 0) {
            pushAgg(repayIntMap, `INT|${funderKey}|${txDateStr}`, {
                date: txDateStr, type: 'CR',
                particulars: `${funderLabel} INTEREST`,
                description: `Interest Amount Collected on ${txDateStr}`,
                credit: paidI, debit: 0,
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: wo.transactionId,
                _rawDate: rawDate,
            });
        }
        // Waivers intentionally omitted — GL-only book entry, not a cash movement
    }

    // Admission fees (from client model) — keyed by date only (no center code)
    const admissionMap = new Map<string, AggBucket>();
    for (const c of newClients) {
        const createdDateStr = fmtIstDate(new Date(c.createdAt));
        const feeAmt         = Number(c.admissionFees ?? 0);
        pushAgg(admissionMap, `ADM|${createdDateStr}`, {
            date: createdDateStr,
            type: 'CR',
            particulars: 'Client Admission Fee',
            description: `Admission Fee Collected`,
            credit: feeAmt,
            debit: 0,
            paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
            refNo: `ADM-${c.clientId}`,
            _rawDate: new Date(c.createdAt).getTime(),
        });
    }

    // Manual financial transactions (genuine — no GL shadows).
    // Primary exclusion is done at DB query time via finTxWhere; this loop
    // provides a defence-in-depth check on both voucherNo and description.
    const finMap = new Map<string, FinAggBucket>();
    for (const tx of financialTxns) {
        // Skip GL echo rows that survived the DB filter (e.g. legacy records).
        if (isGlShadow(tx.voucherNo, tx.description)) continue;

        const isCredit   = tx.type === 'CASH_RECEIPT';
        const ledgerName = (tx.ledger?.ledgerName ?? 'Manual Entry').trim();
        const txDateStr  = fmtIstDate(new Date(tx.transactionDate));

        // EOD-allocated collections/loan-advances carry the internal
        // [POSTING:EOD_COLLECTION:...] / [POSTING:EOD_LOAN_ADVANCE:...] marker plus a repeat of
        // the ledger name before the human-readable sentence (see postEodCollectionAllocation /
        // postEodLoanAdvanceAllocation) — strip that for display since `particulars` above
        // already shows the real ledger name.
        const eodMarkerMatch = tx.description?.match(/^\[POSTING:EOD_(?:COLLECTION|LOAN_ADVANCE|PRECLOSURE|WRITEOFF):[^\]]*\]\s*.*?\n\n([\s\S]*)$/);
        let cleanDescription = eodMarkerMatch ? eodMarkerMatch[1].trim() : tx.description;
        // postEodFunderAllocation's merged "Allocate for EOD" voucher has no bracket marker in
        // the description at all — its marker lives in the postingMarker column instead — so
        // its description starts directly with the ledger name repeated (see
        // accounting-posting.service.ts). Strip that leading repeat too, regardless of whether
        // a bracket marker was already stripped above, since `particulars` already shows it.
        if (cleanDescription) {
            const leadingLineMatch = cleanDescription.match(/^([^\n]+)\n+([\s\S]*)$/);
            if (leadingLineMatch && leadingLineMatch[1].trim().toLowerCase() === ledgerName.toLowerCase()) {
                cleanDescription = leadingLineMatch[2].trim();
            }
        }
        const displayDescription = cleanDescription || (isCredit ? 'Cash Receipt' : 'Cash Payment');

        // One row per voucher — vouchers are never merged, so each keeps its own
        // voucher number, description and amount (e.g. every HO Borrow receipt is listed
        // separately instead of being summed into one line).
        pushFin(
            finMap,
            `FIN|${tx.voucherNo}`,
            {
                date: txDateStr,
                type: isCredit ? 'CR' : 'CP',
                particulars: ledgerName,
                description: displayDescription,
                credit: isCredit ? Number(tx.amount) : 0,
                debit:  isCredit ? 0 : Number(tx.amount),
                paymentMode: DAYBOOK_PAYMENT_MODE_CASH,
                refNo: tx.voucherNo ?? '',
                _rawDate: new Date(tx.transactionDate).getTime(),
            },
            tx.voucherNo ?? '',
            displayDescription
        );
    }

    // ── 5. Merge, sort, paginate ──────────────────────────────────────────────

    const allWithMeta: EntryWithMeta[] = [
        ...finalizeAgg(repayPriMap),
        ...finalizeAgg(repayIntMap),
        ...finalizeAgg(savingsRefundMap),
        ...finalizeAgg(preclosureMap),
        ...finalizeAgg(feeDocMap),
        ...finalizeAgg(feeInsMap),
        ...finalizeAgg(feeOtherMap),
        ...finalizeAgg(otherLoanMap),
        ...finalizeAgg(admissionMap),
        ...finalizeFinMap(finMap),
    ];

    allWithMeta.sort((a, b) => a._rawDate - b._rawDate);

    const finalEntries: DaybookEntry[] = allWithMeta.map(({ _rawDate, ...rest }) => rest);

    const totalCount     = finalEntries.length;
    const paginatedEntries = exportAll ? finalEntries : finalEntries.slice((page - 1) * pageSize, page * pageSize);
    const closingBalance = openingBalance + totalCredits - totalDebits;

    return {
        openingBalance,
        transactions: paginatedEntries,
        closingBalance,
        totalCredits,
        totalDebits,
        summary: {
            totalTxns:   totalCount,
            creditCount: finalEntries.filter((e) => e.credit > 0).length,
            debitCount:  finalEntries.filter((e) => e.debit  > 0).length,
        },
        totalPages: Math.ceil(totalCount / pageSize) || 1,
    };
}


export type IndividualLedgerRow = {
    branchId: string;
    centerId: string;
    centerName: string;
    osOwnFund: number;
    clOwnFund: number;
};

export async function getIndividualLedgerData(fromDate: string, tillDate: string, branchId?: string | string[]): Promise<IndividualLedgerRow[]> {
    const start = new Date(fromDate);
    const end = new Date(tillDate);

    // Ensure dates are valid
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return [];
    }

    const branchIds = branchId ? (Array.isArray(branchId) ? branchId : [branchId]) : null;
    const hasBranchFilter = !!(branchIds && branchIds.length > 0);

    const results = await prisma.$queryRawUnsafe<any[]>(`
        SELECT 
            b.code as "branchId",
            c.code as "centerId",
            c.name as "centerName",
            -- Opening Outstanding (values before fromDate)
            (
                SELECT COALESCE(SUM(l.amount), 0) 
                FROM "loans" l 
                WHERE l."centerId" = c.id 
                AND l."disbursementStatus" = 'DISBURSED'
                AND l."disbursedLevel1At" < $1
                AND l."isActive" = true
            ) - (
                SELECT COALESCE(SUM(lt."principalAmount"), 0) 
                FROM "loan_transactions" lt 
                WHERE lt."centerId" = c.id 
                AND lt."transactionDate" < $1 
                AND lt."isReversed" = false
            ) as "osOwnFund",
            -- Closing Outstanding (values as of tillDate)
            (
                SELECT COALESCE(SUM(l.amount), 0) 
                FROM "loans" l 
                WHERE l."centerId" = c.id 
                AND l."disbursementStatus" = 'DISBURSED'
                AND l."disbursedLevel1At" <= $2
                AND l."isActive" = true
            ) - (
                SELECT COALESCE(SUM(lt."principalAmount"), 0) 
                FROM "loan_transactions" lt 
                WHERE lt."centerId" = c.id 
                AND lt."transactionDate" <= $2 
                AND lt."isReversed" = false
            ) as "clOwnFund"
        FROM "centers" c
        JOIN "branches" b ON c."branchId" = b.id
        WHERE c."isActive" = true
        ${hasBranchFilter ? 'AND c."branchId" = ANY($3::text[])' : ''}
        ORDER BY b.code, c.code
    `, start, end, ...(hasBranchFilter ? [branchIds] : []));

    return results.map(row => ({
        branchId: String(row.branchId || ''),
        centerId: String(row.centerId || ''),
        centerName: String(row.centerName || ''),
        osOwnFund: Number(row.osOwnFund || 0),
        clOwnFund: Number(row.clOwnFund || 0)
    }));
}

export type DisbursementRow = {
    slNo: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centreId: string;
    centerName: string;
    productType: string;
    loanProduct: string;
    loanId: string;
    memberId: string;
    memberName: string;
    aadhaarNumber: string;
    phoneNumber: string;
    loanCycle: number;
    fdoName: string;
    purposeOfLoan: string;
    loanIndexId: string;
    ldDate: string;
    ldTime: string;
    startDate: string;
    endDate: string;
    admissionFee: number;
    processingFees: number;
    cgst: number;
    sgst: number;
    insuranceFee: number;
    installmentType: string;
    numberOfInstallments: number;
    rateOfInterest: number;
    loanPrincipal: number;
    loanInterest: number;
    loanTotalAmount: number;
    goldWeight: number;
    goldValuePerGram: number;
    fundingName: string;
    loanStatus: string;
    loanApproval: string;
    centerTransfer: string;
}

export type PARResult = MISDetailedArrearResult;

export interface PreclosureReportRow {
    sNo: number;
    region: string;
    division: string;
    area: string;
    branchId: string;
    branchName: string;
    centerId: string;
    centerName: string;
    fdoName: string;
    loanId: string;
    loanType: string;
    productName: string;
    memberId: string;
    memberName: string;
    phoneNumber: string;
    aadhaarNumber: string;
    noOfInstallments: number;
    reason: string;
    fundingName: string;
    distributionDate: string;
    preClosedDate: string;
    preCloseDay: number;
    isMeetingDay: string;
    loanPrincipal: number;
    loanInterest: number;
    loanTotalAmount: number;
    preClosePrincipal: number;
    preCloseInterest: number;
    preCloseAmount: number;
    interestWaiverAmount: number;
    coApplicantMobile: string;
}

function mapDisbursementStatusToApprovalLabel(status: string): string {
    switch (status) {
        case 'PENDING_LEVEL1':  return 'Pending Level 1 Approval';
        case 'APPROVED_LEVEL1': return 'Approved (Level 1)';
        case 'PENDING_LEVEL2':  return 'Pending Level 2 Approval';
        case 'APPROVED_LEVEL2': return 'Approved (Level 2)';
        case 'DISBURSED':       return 'Approved / Disbursed';
        case 'REJECTED':        return 'Rejected';
        case 'CLOSED':          return 'Closed';
        default:                return status;
    }
}

/** HH:mm:ss in Asia/Kolkata — server-timezone independent (date-fns format() uses server-local time). */
const istTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function formatIstTime(value: Date | string | number): string {
    return istTimeFormatter.format(new Date(value));
}

export async function getLoanDisbursementData(
    centerId: string,
    fromDate: string,
    tillDate: string,
    branchId?: string | string[]
): Promise<DisbursementRow[]> {
    // Inclusive IST calendar range as half-open UTC bounds (same-day From/Till works).
    const ist = buildDcbIstReportWindow(fromDate, tillDate);
    const istRange = { gte: ist.rangeStartUtc, lt: ist.rangeEndExclusiveUtc };

    const whereClause: any = {
        disbursementStatus: 'DISBURSED',
        isActive: true,
        // Real disbursement time is disbursedByBMAt (the "LD Date" column); imported/legacy
        // loans without it fall back to the Level-1 approval time.
        OR: [
            { disbursedByBMAt: istRange },
            { disbursedByBMAt: null, disbursedLevel1At: istRange },
        ],
    };

    if (centerId && centerId !== 'all') {
        whereClause.centerId = centerId;
    }

    if (branchId && (!Array.isArray(branchId) || branchId.length > 0)) {
        whereClause.branchId = Array.isArray(branchId) ? { in: branchId } : branchId;
    }

    const loans = await prisma.loan.findMany({
        where: whereClause,
        include: {
            client: {
                include: {
                    transferHistory: { select: { id: true }, take: 1 },
                },
            },
            center: {
                include: {
                    branch: {
                        include: {
                            areas: {
                                include: {
                                    division: {
                                        include: { region: true },
                                    },
                                },
                            },
                        },
                    },
                    fdo: true,
                },
            },
            loanProduct: {
                include: {
                    loanProductType: true,
                },
            },
            loanPurpose: true,
            loanIndex: true,
            disbursedLevel1By: true,
            funder: { select: { funderName: true } },
            schedules: {
                orderBy: { installmentNo: 'asc' },
            },
            transactions: {
                where: {
                    OR: [{ type: 'DISBURSEMENT' }, { type: 'FEE' }],
                },
            },
            goldLoanDetail: {
                select: { karatType: true, gramCount: true, goldTakenValue: true },
            },
        },
        orderBy: [{ disbursedByBMAt: 'asc' }, { disbursedLevel1At: 'asc' }],
    });

    // Build loan cycle map: clientId → sorted loan ids by disbursement date
    const clientIds = [...new Set(loans.map((l) => l.clientId))];
    const allClientDisbursements = await prisma.loan.findMany({
        where: { clientId: { in: clientIds }, disbursementStatus: 'DISBURSED' },
        select: { id: true, clientId: true, disbursedLevel1At: true },
        orderBy: [{ clientId: 'asc' }, { disbursedByBMAt: 'asc' }, { disbursedLevel1At: 'asc' }],
    });
    const clientLoanOrder = new Map<string, string[]>();
    for (const l of allClientDisbursements) {
        if (!clientLoanOrder.has(l.clientId)) clientLoanOrder.set(l.clientId, []);
        clientLoanOrder.get(l.clientId)!.push(l.id);
    }

    return loans.map((loan, index) => {
        const firstSchedule = loan.schedules[0];
        const lastSchedule = loan.schedules[loan.schedules.length - 1];

        const disbursalTimestamp = loan.disbursedByBMAt ?? loan.disbursedLevel1At;

        const loanInterest = loan.schedules.reduce(
            (sum, sch) => sum + Number(sch.interestDue),
            0
        );
        const loanPrincipal = Number(loan.amount);

        const gramCount = loan.goldLoanDetail ? Number(loan.goldLoanDetail.gramCount) : 0;
        const goldTakenValue = loan.goldLoanDetail ? Number(loan.goldLoanDetail.goldTakenValue) : 0;

        const cgstTx = loan.transactions.find(
            (t) => t.type === 'FEE' && t.description?.toUpperCase().includes('CGST')
        );
        const sgstTx = loan.transactions.find(
            (t) => t.type === 'FEE' && t.description?.toUpperCase().includes('SGST')
        );
        const admissionFeeTx = loan.transactions.find(
            (t) => t.type === 'FEE' && t.description === 'Client Admission Fee'
        );
        const insuranceFeeTx = loan.transactions.find(
            (t) => t.type === 'FEE' && t.description === SYSTEM_LEDGERS.INSURANCE_PAYABLE.name
        );

        const loanOrderList = clientLoanOrder.get(loan.clientId) ?? [];
        const loanCycle = loanOrderList.indexOf(loan.id) + 1;

        return {
            slNo: index + 1,
            regionName:   loan.center?.branch?.areas?.[0]?.division?.region?.name ?? 'N/A',
            divisionName: loan.center?.branch?.areas?.[0]?.division?.name         ?? 'N/A',
            areaName:     loan.center?.branch?.areas?.[0]?.name                   ?? 'N/A',
            branchId: loan.center?.branch.code ?? 'N/A',
            branchName: loan.center?.branch.name ?? 'N/A',
            centreId: loan.center?.code ?? 'N/A',
            centerName: loan.center?.name ?? 'N/A',
            productType: loan.loanProduct?.loanProductType?.name ?? 'N/A',
            loanProduct: loan.loanProduct?.productName ?? 'N/A',
            loanId: loan.loanNumber,
            memberId: loan.client.clientId,
            memberName: `${loan.client.firstName} ${loan.client.lastName}`,
            aadhaarNumber: loan.client.otherIdNo || 'N/A',
            phoneNumber: loan.client.phone || loan.client.mobileNumber || 'N/A',
            loanCycle,
            fdoName: loan.center?.fdo
                ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`
                : 'N/A',
            purposeOfLoan: loan.loanPurpose?.name ?? 'N/A',
            loanIndexId: loan.loanIndex?.indexNo ?? loan.indexId ?? 'N/A',
            ldDate: disbursalTimestamp ? toDisplayDate(disbursalTimestamp) : 'N/A',
            ldTime: disbursalTimestamp ? formatIstTime(disbursalTimestamp) : 'N/A',
            startDate: firstSchedule
                ? format(new Date(firstSchedule.dueDate), 'dd/MM/yyyy')
                : 'N/A',
            endDate: lastSchedule
                ? format(new Date(lastSchedule.dueDate), 'dd/MM/yyyy')
                : 'N/A',
            admissionFee: admissionFeeTx ? Number(admissionFeeTx.feesAmount ?? admissionFeeTx.amount) || 0 : 0,
            processingFees: Number(loan.loanProduct?.documentCharges) || 0,
            cgst: cgstTx ? Number(cgstTx.feesAmount) || 0 : 0,
            sgst: sgstTx ? Number(sgstTx.feesAmount) || 0 : 0,
            insuranceFee: insuranceFeeTx ? Number(insuranceFeeTx.feesAmount ?? insuranceFeeTx.amount) || 0 : 0,
            installmentType:
                loan.frequency ?? loan.loanProduct?.frequency ?? 'N/A',
            numberOfInstallments: loan.loanProduct?.numberOfDues ?? 0,
            rateOfInterest: Number(loan.interestRate),
            loanPrincipal,
            loanInterest,
            loanTotalAmount: loanPrincipal + loanInterest,
            goldWeight: gramCount,
            goldValuePerGram: gramCount > 0 ? goldTakenValue / gramCount : 0,
            fundingName: loan.funder?.funderName ?? 'N/A',
            loanStatus: loan.disbursementStatus,
            loanApproval: mapDisbursementStatusToApprovalLabel(loan.disbursementStatus),
            centerTransfer: (loan.client.transferHistory?.length ?? 0) > 0 ? 'Yes' : 'No',
        };
    });
}

/**
 * Get Portfolio At Risk (PAR) report data — full per-loan detail (36 columns),
 * as of today (IST). Reuses the MIS Detailed Agewise Arrear engine since both
 * reports share the same "loans with overdue" semantics.
 */
export async function getPortfolioAtRiskData(
    centerId: string,
    branchId?: string | string[]
): Promise<PARResult> {
    const reportDate = getKolkataCalendarYmd(new Date());
    return getMISDetailedAgewiseArrearData(reportDate, branchId, centerId, {
        useBranchEodCutoff: true,
    });
}

/**
 * Get Preclosure Report data
 */
export async function getPreclosureReportData(
    branchId: string | string[],
    fromDate: string,
    tillDate: string
): Promise<PreclosureReportRow[]> {
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tillDate);
    endDate.setHours(23, 59, 59, 999);

    const whereClause: any = {
        type: 'PRECLOSURE',
        isReversed: false,
        transactionDate: {
            gte: startDate,
            lte: endDate,
        },
    };

    if (branchId && branchId !== 'all' && (!Array.isArray(branchId) || branchId.length > 0)) {
        whereClause.branchId = Array.isArray(branchId) ? { in: branchId } : branchId;
    }

    const transactions = await prisma.loanTransaction.findMany({
        where: whereClause,
        include: {
            client: {
                select: {
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                    otherIdNo: true,
                },
            },
            foreclosureRequest: {
                select: { remarks: true },
            },
            loan: {
                include: {
                    center: {
                        include: {
                            branch: {
                                include: {
                                    areas: {
                                        include: {
                                            division: {
                                                include: { region: true },
                                            },
                                        },
                                    },
                                },
                            },
                            fdo: { select: { firstName: true, lastName: true } },
                        },
                    },
                    loanProduct: {
                        include: { loanProductType: true },
                    },
                    funder: { select: { funderName: true } },
                    schedules: {
                        select: {
                            interestDue: true,
                            interestPaid: true,
                            status: true,
                        },
                    },
                    foreclosureRequests: {
                        select: { remarks: true },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            },
        },
        orderBy: {
            transactionDate: 'asc',
        },
    });

    const preclosureContactOf = await getMemberContacts({ clientIds: transactions.map((t) => t.clientId), loanIds: transactions.map((t) => t.loanId) });
    return transactions.map((tx, index) => {
        const loan = tx.loan;
        const center = loan.center;
        const branch = center?.branch;

        const loanPrincipal = Number(loan.amount);
        const loanInterest = loan.schedules.reduce((sum, sch) => sum + Number(sch.interestDue), 0);
        const preClosePrincipal = Number(tx.principalAmount || 0);
        const preCloseInterest = Number(tx.interestAmount || 0);
        const interestWaiverAmount = loan.schedules
            .filter(sch => sch.status === 'WAIVED')
            .reduce((sum, sch) => sum + (Number(sch.interestDue) - Number(sch.interestPaid)), 0);

        const disbursementDate = loan.disbursedByBMAt ?? loan.disbursedLevel1At;
        const preCloseDay = disbursementDate
            ? Math.round((new Date(tx.transactionDate).getTime() - new Date(disbursementDate).getTime()) / 86400000)
            : 0;

        const txDayName = format(new Date(tx.transactionDate), 'EEEE').toUpperCase();
        const isMeetingDay = center?.meetingDay?.toUpperCase() === txDayName ? 'Yes' : 'No';

        const reason = tx.foreclosureRequest?.remarks
            || loan.foreclosureRequests?.[0]?.remarks
            || 'N/A';

        return {
            sNo: index + 1,
            region: branch?.areas?.[0]?.division?.region?.name ?? 'N/A',
            division: branch?.areas?.[0]?.division?.name ?? 'N/A',
            area: branch?.areas?.[0]?.name ?? 'N/A',
            branchId: branch?.code ?? 'N/A',
            branchName: branch?.name ?? 'N/A',
            centerId: center?.code ?? 'N/A',
            centerName: center?.name ?? 'N/A',
            fdoName: center?.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : 'N/A',
            loanId: loan.loanNumber,
            loanType: loan.loanProduct?.loanProductType?.name ?? 'N/A',
            productName: loan.loanProduct?.productName ?? 'N/A',
            memberId: tx.client.clientId,
            memberName: `${tx.client.firstName} ${tx.client.lastName}`,
            phoneNumber: tx.client.phone || tx.client.mobileNumber || 'N/A',
            aadhaarNumber: tx.client.otherIdNo || 'N/A',
            noOfInstallments: loan.tenureMonths,
            reason,
            fundingName: loan.funder?.funderName ?? 'N/A',
            distributionDate: disbursementDate ? format(new Date(disbursementDate), 'dd/MM/yyyy') : 'N/A',
            preClosedDate: format(new Date(tx.transactionDate), 'dd/MM/yyyy'),
            preCloseDay,
            isMeetingDay,
            loanPrincipal,
            loanInterest,
            loanTotalAmount: loanPrincipal + loanInterest,
            preClosePrincipal,
            preCloseInterest,
            preCloseAmount: preClosePrincipal + preCloseInterest,
            interestWaiverAmount,
            coApplicantMobile: preclosureContactOf(tx.clientId, tx.loanId).coApplicantMobile,
        };
    });
}

export type AllBranchDCBRow = {
    branchCode: string;
    branchName: string;
    meetingDate: string;
    centers: number;
    clients: number;
    openingArr: number;
    demand: number;
    currentColl: number;
    recPercentage: number;
    currArrColl: number;
    odArrColl: number;
    advanceColl: number;
    preclosure: number;
    totalColl: number;
    /** Past-period unmet demand (true arrear). */
    currArrear: number;
    /** Today's scheduled demand not yet collected — pending, NOT arrear. */
    todayPending: number;
    closingArr: number;
};

export async function getAllBranchDCBData(fromDate: string, tillDate: string, branchIds?: string[]): Promise<AllBranchDCBRow[]> {
    const ist = buildDcbIstReportWindow(fromDate, tillDate);

    // Fetch active disbursed loans across all branches (or only the caller's permitted branches).
    const loans = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            isActive: true,
            ...(branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        },
        include: {
            client: {
                include: {
                    center: { include: { branch: true, fdo: true } },
                },
            },
            schedules: {
                where: { dueDate: { lte: ist.scheduleFetchDueLteUtc } },
                orderBy: { dueDate: 'asc' },
            },
            transactions: {
                where: {
                    transactionDate: { gte: ist.rangeStartUtc, lt: ist.rangeEndExclusiveUtc },
                    isReversed: false,
                    status: 'APPROVED',
                },
                orderBy: { transactionDate: 'asc' },
                include: {
                    lines: {
                        include: { schedule: { select: { dueDate: true } } },
                    },
                },
            },
        },
    });

    // Use the same schedule-driven aggregation engine as getDCBData
    const centerRows = aggregateDcbLoansToCenterMetrics(loans, ist);

    // Roll up center-level metrics to branch-level
    const branchMap = new Map<string, {
        branchCode: string;
        branchName: string;
        openingArr: number;
        demand: number;
        currentColl: number;
        currArrColl: number;
        odArrColl: number;
        advanceColl: number;
        preclosure: number;
        totalColl: number;
        currArrear: number;
        closingArr: number;
        centerSet: Set<string>;
        clientSet: Set<string>;
    }>();

    // Build a mapping of centerId → branchCode/branchName from the loaded loan data
    const centerBranchMap = new Map<string, { code: string; name: string }>();
    for (const loan of loans) {
        const center = loan.client?.center;
        if (!center?.branch) continue;
        if (!centerBranchMap.has(center.id)) {
            centerBranchMap.set(center.id, {
                code: center.branch.code ?? 'N/A',
                name: center.branch.name ?? 'N/A',
            });
        }
    }

    for (const row of centerRows) {
        const branchInfo = centerBranchMap.get(row.centerId);
        const branchCode = branchInfo?.code ?? 'N/A';
        const branchName = branchInfo?.name ?? row.branchName;

        if (!branchMap.has(branchCode)) {
            branchMap.set(branchCode, {
                branchCode,
                branchName,
                openingArr: 0,
                demand: 0,
                currentColl: 0,
                currArrColl: 0,
                odArrColl: 0,
                advanceColl: 0,
                preclosure: 0,
                totalColl: 0,
                currArrear: 0,
                todayPending: 0,
                closingArr: 0,
                centerSet: new Set(),
                clientSet: new Set(),
            } as any);
        }

        const br = branchMap.get(branchCode)!;
        br.centerSet.add(row.centerId);
        br.openingArr += row.openingArr;
        br.demand += row.demand;
        br.currentColl += row.currCollection;
        br.currArrColl += row.currArrColl;
        br.odArrColl += row.opnArrColl;
        br.advanceColl += row.advanceColl;
        br.preclosure += row.preclosure;
        br.totalColl += row.totalColl;
        br.currArrear += row.currArrear;
        br.closingArr += row.closingArr;
        (br as any).todayPending = ((br as any).todayPending ?? 0) + row.todayPending;
    }

    // Count unique clients per branch from the loan data
    for (const loan of loans) {
        const center = loan.client?.center;
        if (!center?.branch) continue;
        const branchCode = center.branch.code ?? 'N/A';
        const br = branchMap.get(branchCode);
        if (br) {
            br.clientSet.add(loan.client.id ?? '');
        }
    }

    const result: AllBranchDCBRow[] = Array.from(branchMap.values()).map(br => ({
        branchCode: br.branchCode,
        branchName: br.branchName,
        meetingDate: formatDcbReportPeriodIst(ist.fromYmd, ist.tillYmd),
        centers: br.centerSet.size,
        clients: br.clientSet.size,
        openingArr: br.openingArr,
        demand: br.demand,
        currentColl: br.currentColl,
        recPercentage: br.demand > 0 ? Math.min(100, (br.currentColl / br.demand) * 100) : 0,
        currArrColl: br.currArrColl,
        odArrColl: br.odArrColl,
        advanceColl: br.advanceColl,
        preclosure: br.preclosure,
        totalColl: br.totalColl,
        currArrear: br.currArrear,
        todayPending: (br as any).todayPending ?? 0,
        closingArr: br.closingArr,
    }));

    return result.sort((a, b) => a.branchCode.localeCompare(b.branchCode));
}

export type LoanOSDetailsRow = {
    branchName: string;
    centerName: string;
    accountId: string;
    clientName: string;
    loanAccount: string;
    disbursalDate: string;
    dueStartDate: string;
    maturityDate: string;
    status: string;
    loanAmount: number;
    interestAmount: number;
    osPrinciple: number;
    osInterest: number;
    arrearPri: number;
    arrearInt: number;
    totalDues: number;
    completedDues: number;
    collectedDues: number;
    duePri: number;
    dueInt: number;
    dpd: number;
    ageing: string;
    mobile: string;
    fdoName: string;
    meetingDay: string;
    disbursalType: string;
} & MemberContactFields;

export async function getLoanOSDetailsData(reportDate: string, branchId?: string | string[], centerId?: string): Promise<LoanOSDetailsRow[]> {
    const asOfDate = new Date(reportDate);
    asOfDate.setHours(23, 59, 59, 999);

    const loans = await prisma.loan.findMany({
        where: {
            disbursementStatus: 'DISBURSED',
            isActive: true,
            ...(branchId && (!Array.isArray(branchId) || branchId.length > 0)
                ? { branchId: Array.isArray(branchId) ? { in: branchId } : branchId }
                : {}),
            ...(centerId && centerId !== 'all' ? { centerId } : {}),
        },
        include: {
            client: {
                select: {
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                },
            },
            center: {
                include: {
                    fdo: true,
                },
            },
            branch: true,
            schedules: {
                orderBy: { installmentNo: 'asc' as const },
            },
            loanProduct: {
                select: {
                    interestAmount: true,
                    numberOfDues: true,
                },
            },
        },
    });

    const results: LoanOSDetailsRow[] = [];
    const osContactOf = await getMemberContacts({ clientIds: loans.map((l) => l.clientId), loanIds: loans.map((l) => l.id) });

    for (const loan of loans) {
        const schedules = loan.schedules;
        if (!schedules || schedules.length === 0) continue;

        const totalDues = schedules.length;
        const loanAmountNum = Number(loan.amount);

        const totalInterest = loan.loanProduct?.interestAmount
            ? Number(loan.loanProduct.interestAmount)
            : schedules.reduce((s, sc) => s + Number(sc.interestDue), 0);

        const firstDueDate = schedules[0].dueDate;
        const lastDueDate = schedules[schedules.length - 1].dueDate;

        let osPrincipal = 0;
        let osInterest = 0;
        let arrearPri = 0;
        let arrearInt = 0;
        let completedDues = 0;
        let collectedDues = 0;
        let duePri = 0;
        let dueInt = 0;
        let maxOverdueDays = 0;

        for (const sc of schedules) {
            const priDue = Number(sc.principalDue);
            const intDue = Number(sc.interestDue);
            const priPaid = Number(sc.principalPaid);
            const intPaid = Number(sc.interestPaid);

            const priRemaining = priDue - priPaid;
            const intRemaining = intDue - intPaid;

            if (sc.status === 'PAID') {
                completedDues++;
                collectedDues++;
            } else if (sc.status === 'PARTIALLY_PAID') {
                collectedDues++;
            }

            if (new Date(sc.dueDate) <= asOfDate) {
                if (sc.status === 'PENDING' || sc.status === 'PARTIALLY_PAID' || sc.status === 'OVERDUE') {
                    arrearPri += Math.max(0, priRemaining);
                    arrearInt += Math.max(0, intRemaining);
                    duePri = priDue;
                    dueInt = intDue;

                    const overdueDays = Math.floor(
                        (asOfDate.getTime() - new Date(sc.dueDate).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    if (overdueDays > maxOverdueDays) {
                        maxOverdueDays = overdueDays;
                    }
                }
            }

            if (sc.status !== 'PAID') {
                osPrincipal += Math.max(0, priRemaining);
                osInterest += Math.max(0, intRemaining);
            }
        }

        if (duePri === 0 && duePri === 0 && totalDues > 0) {
            const firstPending = schedules.find(
                (s) => s.status === 'PENDING' || s.status === 'PARTIALLY_PAID'
            );
            if (firstPending) {
                duePri = Number(firstPending.principalDue);
                dueInt = Number(firstPending.interestDue);
            }
        }

        let ageing = '';
        if (maxOverdueDays === 0) ageing = '0';
        else if (maxOverdueDays <= 30) ageing = '1-30';
        else if (maxOverdueDays <= 60) ageing = '31-60';
        else if (maxOverdueDays <= 90) ageing = '61-90';
        else if (maxOverdueDays <= 180) ageing = '91-180';
        else ageing = 'ABOVE 180';

        const disbursalDate = loan.disbursedLevel1At
            ? format(new Date(loan.disbursedLevel1At), 'dd/MM/yyyy')
            : '';

        const clientMobile = loan.client.mobileNumber || loan.client.phone || '';

        const fdoLabel = loan.center?.fdo
            ? `${loan.center?.fdo.firstName} ${loan.center?.fdo.lastName}`.trim()
            : '';

        let status = 'CA';
        if (loan.closedDate) status = 'CL';

        const disbTx = await prisma.loanTransaction.findFirst({
            where: { loanId: loan.id, type: 'DISBURSEMENT' },
            select: { paymentMode: true },
            orderBy: { transactionDate: 'asc' },
        });
        const disbursalType = disbTx?.paymentMode || 'CASH';

        results.push({
            branchName: `${loan.branch.code} - ${loan.branch.name}`,
            centerName: `${loan.center?.code} - ${loan.center?.name}`,
            accountId: loan.client.clientId,
            clientName: `${loan.client.firstName} ${loan.client.lastName}`,
            loanAccount: loan.loanNumber,
            disbursalDate,
            dueStartDate: format(new Date(firstDueDate), 'dd/MM/yyyy'),
            maturityDate: format(new Date(lastDueDate), 'dd/MM/yyyy'),
            status,
            loanAmount: loanAmountNum,
            interestAmount: totalInterest,
            osPrinciple: Math.round(osPrincipal),
            osInterest: Math.round(osInterest),
            arrearPri: Math.round(arrearPri),
            arrearInt: Math.round(arrearInt),
            totalDues,
            completedDues,
            collectedDues,
            duePri: Math.round(duePri),
            dueInt: Math.round(dueInt),
            dpd: maxOverdueDays,
            ageing,
            mobile: clientMobile,
            fdoName: fdoLabel,
            meetingDay: (loan.center?.meetingDay || '').toUpperCase(),
            disbursalType,
            ...osContactOf(loan.clientId, loan.id),
        });
    }

    return results.sort((a, b) => {
        if (a.branchName !== b.branchName) return a.branchName.localeCompare(b.branchName);
        if (a.centerName !== b.centerName) return a.centerName.localeCompare(b.centerName, undefined, { numeric: true });
        return a.clientName.localeCompare(b.clientName);
    });
}

// ─── OS CENTERWISE ────────────────────────────────────────────────────────────

export type OSCenterwiseRow = {
    branchCode: string;
    branchName: string;
    centerCode: string;
    centerName: string;
    noOfClients: number;
    osPrincipal: number;
    osInterest: number;
    arrClients: number;
    arrearPri: number;
    arrearInt: number;
};

export type OSCenterwiseResult = {
    data: OSCenterwiseRow[];
    totalCount: number;
    totals: {
        totalCenters: number;
        totalClients: number;
        totalOSPrincipal: number;
        totalOSInterest: number;
        totalArrClients: number;
        totalArrearPri: number;
        totalArrearInt: number;
    };
};

export async function getOSCenterwiseData(
    reportDate: string,
    branchId?: string | string[]
): Promise<OSCenterwiseResult> {
    const asOfDate = new Date(reportDate);
    asOfDate.setHours(23, 59, 59, 999);

    // Build where clause for centers
    const centerWhere: any = {
        isActive: true,
    };
    if (branchId && branchId !== 'all') {
        centerWhere.branchId = Array.isArray(branchId) ? { in: branchId } : branchId;
    }

    // Fetch all active centers with their associated loans
    const centers = await prisma.center?.findMany({
        where: centerWhere,
        include: {
            branch: true,
            loans: {
                where: {
                    disbursementStatus: 'DISBURSED',
                    isActive: true,
                    disbursedLevel1At: {
                        lte: asOfDate,
                    },
                },
                include: {
                    schedules: {
                        where: {
                            dueDate: {
                                lte: asOfDate,
                            },
                        },
                    },
                },
            },
        },
        orderBy: [
            { branch: { code: 'asc' } },
            { code: 'asc' },
        ],
    });

    const osRows: OSCenterwiseRow[] = [];

    let totalCenters = 0;
    let grandTotalClients = 0;
    let grandTotalOSPri = 0;
    let grandTotalOSInt = 0;
    let grandTotalArrClients = 0;
    let grandTotalArrPri = 0;
    let grandTotalArrInt = 0;

    for (const center of centers) {
        // Skip centers with no loans
        if (center.loans.length === 0) continue;

        let osPrincipal = 0;
        let osInterest = 0;
        let arrearPri = 0;
        let arrearInt = 0;

        // Track unique clients
        const clientSet = new Set<string>();
        const arrearClientSet = new Set<string>();

        for (const loan of center.loans) {
            // Add to client count
            clientSet.add(loan.clientId);

            // Calculate outstanding principal: loanAmount - principalPaid
            const loanOSPrincipal = Number(loan.amount) - Number(loan.principalPaid);
            osPrincipal += loanOSPrincipal;

            // Calculate outstanding interest from schedules
            const loanOSInterest = loan.schedules.reduce((sum, schedule) => {
                return sum + (Number(schedule.interestDue) - Number(schedule.interestPaid));
            }, 0);
            osInterest += loanOSInterest;

            // Calculate arrears (overdue unpaid amounts)
            let loanArrearPri = 0;
            let loanArrearInt = 0;

            for (const schedule of loan.schedules) {
                const unpaidPrincipal = Number(schedule.principalDue) - Number(schedule.principalPaid);
                const unpaidInterest = Number(schedule.interestDue) - Number(schedule.interestPaid);

                if (unpaidPrincipal > 0) {
                    loanArrearPri += unpaidPrincipal;
                }
                if (unpaidInterest > 0) {
                    loanArrearInt += unpaidInterest;
                }
            }

            // If loan has arrears, add to arrear client count
            if (loanArrearPri > 0 || loanArrearInt > 0) {
                arrearClientSet.add(loan.clientId);
                arrearPri += loanArrearPri;
                arrearInt += loanArrearInt;
            }
        }

        const noOfClients = clientSet.size;
        const arrClients = arrearClientSet.size;

        // Only include centers with active clients
        if (noOfClients > 0) {
            totalCenters++;
            grandTotalClients += noOfClients;
            grandTotalOSPri += osPrincipal;
            grandTotalOSInt += osInterest;
            grandTotalArrClients += arrClients;
            grandTotalArrPri += arrearPri;
            grandTotalArrInt += arrearInt;

            osRows.push({
                branchCode: center.branch.code,
                branchName: `${center.branch.code} - ${center.branch.name}`,
                centerCode: center.code,
                centerName: `${center.code} - ${center.name}`,
                noOfClients,
                osPrincipal: Math.round(osPrincipal),
                osInterest: Math.round(osInterest),
                arrClients,
                arrearPri: Math.round(arrearPri),
                arrearInt: Math.round(arrearInt),
            });
        }
    }

    return {
        data: osRows,
        totalCount: osRows.length,
        totals: {
            totalCenters,
            totalClients: grandTotalClients,
            totalOSPrincipal: Math.round(grandTotalOSPri),
            totalOSInterest: Math.round(grandTotalOSInt),
            totalArrClients: grandTotalArrClients,
            totalArrearPri: Math.round(grandTotalArrPri),
            totalArrearInt: Math.round(grandTotalArrInt),
        },
    };
}

// ─── MIS BRANCH DEMAND ───────────────────────────────────────────────────────

export type MISBranchDemandRow = {
    meetingDate: string;       // dd/MM/yyyy
    branchCode: string;
    branchName: string;
    fdoCode: string;
    fdoName: string;
    centers: number;
    loanOS: number;            // outstanding principal + interest
    arrear: number;            // arrear principal + interest
    currDemand: number;        // current day demand principal + interest
    totalDemand: number;       // arrear + currDemand
};

export type MISBranchDemandTotals = {
    totalRows: number;
    totalCenters: number;
    totalLoanOS: number;
    totalArrear: number;
    totalCurrDemand: number;
    totalDemand: number;
    uniqueBranches: number;
    uniqueFDOs: number;
};

export type MISBranchDemandResult = {
    data: MISBranchDemandRow[];
    totals: MISBranchDemandTotals;
};

export async function getMISBranchDemandData(
    fromDate: string,
    tillDate: string,
    branchId?: string | string[]
): Promise<MISBranchDemandResult> {
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tillDate);
    endDate.setHours(23, 59, 59, 999);

    // Collect unique day names in the date range
    const dayNamesInRange = new Set<string>();
    const datesToProcess: { date: Date; dayName: string; dateStr: string }[] = [];

    const cursor = new Date(startDate);
    while (cursor <= endDate) {
        const dayName = DAYS[cursor.getDay()];
        dayNamesInRange.add(dayName);
        datesToProcess.push({
            date: new Date(cursor),
            dayName,
            dateStr: format(cursor, 'dd/MM/yyyy'),
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    // Fetch all centers whose meetingDay is in the range, with their loans
    const centers = await prisma.center?.findMany({
        where: {
            isActive: true,
            status: 'APPROVED',
            meetingDay: {
                in: Array.from(dayNamesInRange),
                mode: 'insensitive',
            },
            ...(branchId && (!Array.isArray(branchId) || branchId.length > 0)
                ? { branchId: Array.isArray(branchId) ? { in: branchId } : branchId }
                : {}),
        },
        include: {
            branch: true,
            fdo: {
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                },
            },
            loans: {
                where: {
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                    disbursedLevel1At: {
                        lte: endDate,
                    },
                },
                include: {
                    schedules: {
                        where: {
                            dueDate: {
                                lte: endDate,
                            },
                        },
                        orderBy: {
                            dueDate: 'asc',
                        },
                    },
                },
            },
        },
    });

    // Build a lookup: dayName (lowercase) -> centers
    const centersByDay = new Map<string, typeof centers>();
    for (const center of centers) {
        const key = (center.meetingDay || '').toLowerCase();
        if (!centersByDay.has(key)) {
            centersByDay.set(key, []);
        }
        centersByDay.get(key)!.push(center);
    }

    // For each date → find matching centers → aggregate by branch+FDO
    const rows: MISBranchDemandRow[] = [];

    for (const { date, dayName, dateStr } of datesToProcess) {
        const matchingCenters = centersByDay.get(dayName.toLowerCase()) || [];
        if (matchingCenters.length === 0) continue;

        // Group by branchCode + fdoId
        const groupKey = (branchCode: string, fdoId: string) => `${branchCode}|${fdoId}`;
        const groups = new Map<
            string,
            {
                branchCode: string;
                branchName: string;
                fdoCode: string;
                fdoName: string;
                centers: number;
                loanOS: number;
                arrear: number;
                currDemand: number;
            }
        >();

        for (const center of matchingCenters) {
            const fdoId = center.fdo?.id || 'UNASSIGNED';
            const fdoCode = center.fdo?.employeeId || 'N/A';
            const fdoName = center.fdo
                ? `${center.fdo.firstName} ${center.fdo.lastName}`
                : 'UNASSIGNED';

            const key = groupKey(center.branch.code, fdoId);

            if (!groups.has(key)) {
                groups.set(key, {
                    branchCode: center.branch.code,
                    branchName: center.branch.name,
                    fdoCode,
                    fdoName,
                    centers: 0,
                    loanOS: 0,
                    arrear: 0,
                    currDemand: 0,
                });
            }

            const group = groups.get(key)!;

            // Count this center if it has any active loans
            if (center.loans.length > 0) {
                group.centers += 1;
            }

            // Process each loan
            for (const loan of center.loans) {
                // Outstanding = total loan amount - principal paid + unpaid interest from due schedules
                const osPrincipal = Number(loan.amount) - Number(loan.principalPaid);
                const osInterest = loan.schedules.reduce(
                    (sum, s) => sum + Math.max(0, Number(s.interestDue) - Number(s.interestPaid)),
                    0
                );
                group.loanOS += osPrincipal + osInterest;

                // Process schedules for arrear and current demand
                for (const schedule of loan.schedules) {
                    const dueDate = new Date(schedule.dueDate);
                    const dueDateStr = format(dueDate, 'yyyy-MM-dd');
                    const currentDateStr = format(date, 'yyyy-MM-dd');

                    const pendingPri = Math.max(0, Number(schedule.principalDue) - Number(schedule.principalPaid));
                    const pendingInt = Math.max(0, Number(schedule.interestDue) - Number(schedule.interestPaid));
                    const totalPending = pendingPri + pendingInt;

                    if (totalPending <= 0) continue;

                    if (dueDateStr === currentDateStr) {
                        // Current day demand
                        group.currDemand += totalPending;
                    } else if (dueDate < date) {
                        // Arrear (overdue before this meeting date)
                        group.arrear += totalPending;
                    }
                }
            }
        }

        // Emit rows for this date
        for (const group of groups.values()) {
            // Only include groups with actual data
            if (group.centers === 0 && group.loanOS === 0) continue;

            rows.push({
                meetingDate: dateStr,
                branchCode: group.branchCode,
                branchName: group.branchName,
                fdoCode: group.fdoCode,
                fdoName: group.fdoName,
                centers: group.centers,
                loanOS: Math.round(group.loanOS),
                arrear: Math.round(group.arrear),
                currDemand: Math.round(group.currDemand),
                totalDemand: Math.round(group.arrear + group.currDemand),
            });
        }
    }

    // Sort by date, then branch, then FDO
    rows.sort((a, b) => {
        // Parse dd/MM/yyyy to compare dates
        const [dA, mA, yA] = a.meetingDate.split('/').map(Number);
        const [dB, mB, yB] = b.meetingDate.split('/').map(Number);
        const dateA = new Date(yA, mA - 1, dA).getTime();
        const dateB = new Date(yB, mB - 1, dB).getTime();
        if (dateA !== dateB) return dateA - dateB;
        if (a.branchCode !== b.branchCode) return a.branchCode.localeCompare(b.branchCode);
        return a.fdoName.localeCompare(b.fdoName);
    });

    // Compute totals
    const branchSet = new Set<string>();
    const fdoSet = new Set<string>();
    let totalCenters = 0;
    let totalLoanOS = 0;
    let totalArrear = 0;
    let totalCurrDemand = 0;
    let totalDemand = 0;

    for (const row of rows) {
        branchSet.add(row.branchCode);
        fdoSet.add(row.fdoCode);
        totalCenters += row.centers;
        totalLoanOS += row.loanOS;
        totalArrear += row.arrear;
        totalCurrDemand += row.currDemand;
        totalDemand += row.totalDemand;
    }


    return {
        data: rows,
        totals: {
            totalRows: rows.length,
            totalCenters,
            totalLoanOS: Math.round(totalLoanOS),
            totalArrear: Math.round(totalArrear),
            totalCurrDemand: Math.round(totalCurrDemand),
            totalDemand: Math.round(totalDemand),
            uniqueBranches: branchSet.size,
            uniqueFDOs: fdoSet.size,
        },
    };
}

export type AdditionDisbursedRow = {
    centerId: string;
    centerName: string;
    clientId: string;
    clientName: string;
    joinedDate: string;
    disbursalDate: string;
    loanAc: string;
    loanAmount: number;
    totalDues: number;
    funder: string;
    fdoName: string;
} & MemberContactFields;

/**
 * Get client addition and disbursement report data
 * This includes clients who joined in the period AND clients who received a disbursement in the period.
 */
export async function getClientAdditionDisbursedData(
    fromDate: string,
    tillDate: string,
    centerId?: string,
    branchId?: string
): Promise<AdditionDisbursedRow[]> {
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tillDate);
    endDate.setHours(23, 59, 59, 999);

    // 1. Fetch Clients joined in the period
    const clientsQuery: any = {
        createdAt: {
            gte: startDate,
            lte: endDate,
        },
        isActive: true,
    };

    if (centerId && centerId !== 'all') {
        clientsQuery.centerId = centerId;
    } else if (branchId) {
        clientsQuery.center = { branchId: branchId };
    }

    const newClients = await prisma.client.findMany({
        where: clientsQuery,
        include: {
            center: {
                include: {
                    fdo: true,
                }
            },
            loanApplications: {
                where: {
                    disbursementStatus: 'DISBURSED',
                },
                include: {
                    schedules: true,
                    funder: { select: { funderName: true } },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            }
        }
    });

    // 2. Fetch Loans disbursed in the period
    const loansQuery: any = {
        disbursedLevel1At: {
            gte: startDate,
            lte: endDate,
        },
        disbursementStatus: 'DISBURSED',
        isActive: true,
    };

    if (centerId && centerId !== 'all') {
        loansQuery.centerId = centerId;
    } else if (branchId) {
        loansQuery.branchId = branchId;
    }

    const disbursedLoans = await prisma.loan.findMany({
        where: loansQuery,
        include: {
            client: {
                include: {
                    center: {
                        include: {
                            fdo: true,
                        }
                    }
                }
            },
            schedules: true,
            funder: { select: { funderName: true } },
        }
    });

    // Merge logic: Start with a map keyed by clientId
    const clientMap = new Map<string, AdditionDisbursedRow>();
    // Loan shown on each row — for the loan-level co-applicant mobile.
    const loanIdByClient = new Map<string, string | undefined>();

    // Process new clients first
    for (const client of newClients) {
        // Find the most recent disbursed loan for this client (if any)
        const activeLoan = client.loanApplications[0];
        const fdo = client.center?.fdo;
        loanIdByClient.set(client.id, activeLoan?.id);

        clientMap.set(client.id, { // Using client.id as internal key
            centerId: client.center?.code || 'N/A',
            centerName: client.center?.name || 'N/A',
            clientId: client.clientId,
            clientName: `${client.firstName} ${client.lastName}`,
            joinedDate: format(new Date(client.createdAt), 'dd/MM/yyyy'),
            disbursalDate: activeLoan?.disbursedLevel1At ? format(new Date(activeLoan.disbursedLevel1At), 'dd/MM/yyyy') : '',
            loanAc: activeLoan?.loanNumber || '',
            loanAmount: activeLoan ? Number(activeLoan.amount) : 0,
            totalDues: activeLoan ? activeLoan.schedules.reduce((sum, s) => sum + Number(s.totalDue), 0) : 0,
            funder: activeLoan?.funder?.funderName || 'N/A',
            fdoName: fdo ? `${fdo.firstName} ${fdo.lastName}` : 'N/A',
        });
    }

    // Process disbursed loans (to catch ones who joined before but disbursed now, or update if already present)
    for (const loan of disbursedLoans) {
        const existingRow = clientMap.get(loan.clientId);
        loanIdByClient.set(loan.clientId, loan.id);

        if (existingRow) {
            // Update the disbursement details if they are for this period
            existingRow.disbursalDate = format(new Date(loan.disbursedLevel1At!), 'dd/MM/yyyy');
            existingRow.loanAc = loan.loanNumber;
            existingRow.loanAmount = Number(loan.amount);
            existingRow.totalDues = loan.schedules.reduce((sum, s) => sum + Number(s.totalDue), 0);
            existingRow.funder = loan.funder?.funderName || 'N/A';
        } else {
            // Add new row for previously joined client who was disbursed in this period
            const client = loan.client;
            const fdo = client.center?.fdo;
            
            clientMap.set(client.id, {
                centerId: client.center?.code || 'N/A',
                centerName: client.center?.name || 'N/A',
                clientId: client.clientId,
                clientName: `${client.firstName} ${client.lastName}`,
                joinedDate: format(new Date(client.createdAt), 'dd/MM/yyyy'),
                disbursalDate: loan.disbursedLevel1At ? format(new Date(loan.disbursedLevel1At), 'dd/MM/yyyy') : '',
                loanAc: loan.loanNumber,
                loanAmount: Number(loan.amount),
                totalDues: loan.schedules.reduce((sum, s) => sum + Number(s.totalDue), 0),
                funder: loan.funder?.funderName || 'N/A',
                fdoName: fdo ? `${fdo.firstName} ${fdo.lastName}` : 'N/A',
            });
        }
    }

    const contactOf = await getMemberContacts({ clientIds: clientMap.keys(), loanIds: loanIdByClient.values() });
    for (const [internalClientId, row] of clientMap) {
        Object.assign(row, contactOf(internalClientId, loanIdByClient.get(internalClientId)));
    }

    return Array.from(clientMap.values()).sort((a, b) =>
        a.centerName.localeCompare(b.centerName) ||
        a.clientName.localeCompare(b.clientName)
    );
}

export type ClientTransferRow = {
    clientName: string;
    oldCenterName: string;
    fromDate: string;
    tillDate: string;
    newCenterName: string;
    oldClientId: string;
    newClientId: string;
    performedBy: string;
    remarks: string;
}

/**
 * Get client transfer history report data
 */
export async function getClientTransferData(
    fromDate: string,
    tillDate: string,
    centerId?: string,
    branchId?: string
): Promise<ClientTransferRow[]> {
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tillDate);
    endDate.setHours(23, 59, 59, 999);

    const query: any = {
        transferDate: {
            gte: startDate,
            lte: endDate,
        },
    };

    if (centerId && centerId !== 'all') {
        query.oldCenterId = centerId;
    }

    if (branchId) {
        // If filtering by branch, we need to ensure either old or new center is in that branch
        // For simplicity and common use cases, we check the old center's branch
        query.oldCenter = {
            branchId: branchId
        };
    }

    const transfers = await prisma.clientTransfer.findMany({
        where: query,
        include: {
            client: true,
            oldCenter: true,
            newCenter: true,
            transferredBy: true,
        },
        orderBy: {
            transferDate: 'desc',
        },
    });

    const rows: ClientTransferRow[] = [];

    for (const transfer of transfers) {
        // To find "fromDate", we need to look for the previous event for this client
        // Either her joining date or her last transfer date
        const previousTransfer = await prisma.clientTransfer.findFirst({
            where: {
                clientId: transfer.clientId,
                transferDate: {
                    lt: transfer.transferDate,
                },
            },
            orderBy: {
                transferDate: 'desc',
            },
        });

        const startDt = previousTransfer ? previousTransfer.transferDate : transfer.client.createdAt;

        rows.push({
            clientName: `${transfer.client.firstName} ${transfer.client.lastName}`,
            oldCenterName: `${transfer.oldCenter.code} - ${transfer.oldCenter.name}`,
            newCenterName: `${transfer.newCenter.code} - ${transfer.newCenter.name}`,
            fromDate: format(new Date(startDt), 'dd/MM/yyyy'),
            tillDate: format(new Date(transfer.transferDate), 'dd/MM/yyyy'),
            oldClientId: transfer.oldClientId,
            newClientId: transfer.newClientId,
            performedBy: `${transfer.transferredBy.firstName} ${transfer.transferredBy.lastName}`,
            remarks: transfer.remarks || '',
        });
    }

    return rows;
}

export type CenterTransferHistoryRow = {
    branchName: string;
    centerName: string;
    previousFdoName: string;
    currentFdoName: string;
    date: string;
    approvedBy: string;
};

/**
 * Shared query shape for both Center Transfer History and Center Assignment History —
 * RANGE lists every qualifying event whose start date falls in [fromDate, tillDate];
 * AS_ON instead resolves the single state that was in effect on that one date.
 * `branchIds: null` means unrestricted (Head Office admin, no branch filter).
 *
 * `fdoId`, when set, switches both reports into "officer timeline" mode: every
 * period that officer was ever assigned somewhere, across all time — mode/
 * fromDate/tillDate/asOnDate are ignored entirely. This is what answers "what's
 * the full assignment history of officer X" regardless of which date window
 * happens to be selected.
 */
export type CenterHistoryQueryOptions = {
    mode: 'RANGE' | 'AS_ON';
    fromDate?: string;
    tillDate?: string;
    asOnDate?: string;
    branchIds?: string[] | null;
    centerId?: string;
    fdoId?: string;
};

function buildCenterFilter(branchIds: string[] | null | undefined, centerId: string | undefined): Record<string, any> {
    const filter: Record<string, any> = {};
    if (branchIds && branchIds.length > 0) {
        filter.branchId = branchIds.length === 1 ? branchIds[0] : { in: branchIds };
    }
    if (centerId) {
        filter.id = centerId;
    }
    return filter;
}

/**
 * Get center-to-FDO transfer history report data (CenterTransfer events only —
 * see getCenterAssignmentHistoryData for the fuller timeline including the
 * initial assignment made at center creation). One row per transfer event —
 * both sides of the handover (who held it before, who holds it now) plus who
 * approved the move and on what date.
 */
export async function getCenterTransferHistoryData(
    options: CenterHistoryQueryOptions
): Promise<CenterTransferHistoryRow[]> {
    const centerFilter = buildCenterFilter(options.branchIds, options.centerId);

    const query: any = { isReverted: false };
    if (Object.keys(centerFilter).length > 0) {
        query.center = centerFilter;
    }

    if (options.fdoId) {
        // Officer timeline — every transfer this FDO was party to, ever, on either
        // side of the handover (incoming OR outgoing). No date bound at all: this
        // is "full history for this person", not a window.
        query.OR = [
            { transferredToFdoId: options.fdoId },
            { previousFdoId: options.fdoId },
        ];
    } else if (options.mode === 'AS_ON') {
        const asOnEnd = new Date(options.asOnDate as string);
        asOnEnd.setHours(23, 59, 59, 999);
        query.createdAt = { lte: asOnEnd };
    } else {
        const startDate = new Date(options.fromDate as string);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(options.tillDate as string);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt = { gte: startDate, lte: endDate };
    }

    const transfers = await prisma.centerTransfer.findMany({
        where: query,
        include: {
            center: { include: { branch: { select: { code: true, name: true } } } },
            previousFdo: { select: { firstName: true, lastName: true } },
            transferredToFdo: { select: { firstName: true, lastName: true } },
            transferredBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    // AS_ON (no officer selected): keep only the latest qualifying transfer per
    // center (list is already sorted desc, so the first occurrence of a centerId
    // is its latest one). Officer-timeline mode and RANGE mode want every event.
    let eventsToRender = transfers;
    if (!options.fdoId && options.mode === 'AS_ON') {
        const seenCenterIds = new Set<string>();
        eventsToRender = transfers.filter((t) => {
            if (seenCenterIds.has(t.centerId)) return false;
            seenCenterIds.add(t.centerId);
            return true;
        });
    }

    return eventsToRender.map((transfer) => ({
        branchName: `${transfer.center.branch.code} - ${transfer.center.branch.name}`,
        centerName: `${transfer.center.code} - ${transfer.center.name}`,
        previousFdoName: transfer.previousFdo
            ? `${transfer.previousFdo.firstName} ${transfer.previousFdo.lastName}`
            : 'Unassigned',
        currentFdoName: `${transfer.transferredToFdo.firstName} ${transfer.transferredToFdo.lastName}`,
        date: format(new Date(transfer.createdAt), 'dd/MM/yyyy'),
        approvedBy: `${transfer.transferredBy.firstName} ${transfer.transferredBy.lastName}`,
    }));
}

export type CenterAssignmentHistoryRow = {
    branchName: string;
    centerName: string;
    meetingDay: string;
    meetingSchedule: string;
    previousFdoName: string;
    previousFrom: string;
    previousTill: string;
    currentFdoName: string;
    currentFrom: string;
    assignedBy: string;
};

/**
 * Get the full center-to-FDO assignment history — unlike getCenterTransferHistoryData
 * (which only surfaces reassignment *events* from CenterTransfer), this reconstructs
 * every assignment period per center, including the very first one made at center
 * creation (Center.fdoId set on `POST /api/centers`), which has no CenterTransfer row
 * of its own. Built entirely from existing data (Center + CenterTransfer) — no new
 * tables, no change to the creation/edit/transfer workflows.
 *
 * For each center, the timeline is:
 *   segment 0:  [center.createdAt      → first transfer.createdAt]  fdo = first transfer.previousFdoId (or center.fdoId if no transfers at all)
 *   segment i:  [transfer[i].createdAt → transfer[i+1].createdAt]   fdo = transfer[i].transferredToFdoId
 *   last segment's tillDate is blank — it's the center's current assignment.
 * Reverted transfers are excluded (they never took effect operationally), matching
 * the convention already used by the transfer-history endpoint.
 */
export async function getCenterAssignmentHistoryData(
    options: CenterHistoryQueryOptions
): Promise<CenterAssignmentHistoryRow[]> {
    // RANGE: a segment qualifies if it started inside [startDate, endDate].
    // AS_ON: a segment qualifies if it was the one in effect at the end of that day.
    // Neither applies in officer-timeline mode (options.fdoId set) — dates are ignored there.
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let asOnInstant: Date | null = null;
    if (!options.fdoId) {
        if (options.mode === 'AS_ON') {
            asOnInstant = new Date(options.asOnDate as string);
            asOnInstant.setHours(23, 59, 59, 999);
        } else {
            startDate = new Date(options.fromDate as string);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(options.tillDate as string);
            endDate.setHours(23, 59, 59, 999);
        }
    }

    const centerQuery = buildCenterFilter(options.branchIds, options.centerId);

    const centers = await prisma.center.findMany({
        where: centerQuery,
        select: {
            id: true,
            code: true,
            name: true,
            fdoId: true,
            createdAt: true,
            meetingDay: true,
            meetingTime: true,
            fdo: { select: { firstName: true, lastName: true } },
            branch: { select: { code: true, name: true } },
            createdBy: { select: { firstName: true, lastName: true } },
            approvedBy: { select: { firstName: true, lastName: true } },
            transferHistory: {
                where: { isReverted: false },
                orderBy: { createdAt: 'asc' },
                select: {
                    createdAt: true,
                    previousFdoId: true,
                    previousFdo: { select: { firstName: true, lastName: true } },
                    transferredToFdo: { select: { id: true, firstName: true, lastName: true } },
                    transferredBy: { select: { firstName: true, lastName: true } },
                },
            },
        },
    });

    type RawRow = {
        branchName: string;
        centerName: string;
        meetingDay: string;
        meetingSchedule: string;
        previousFdoName: string;
        previousFrom: Date | null;
        previousTill: Date | null;
        currentFdoName: string;
        currentFrom: Date;
        assignedBy: string;
    };
    const rawRows: RawRow[] = [];

    for (const center of centers) {
        const branchName = `${center.branch.code} - ${center.branch.name}`;
        const centerName = `${center.code} - ${center.name}`;
        const meetingDay = center.meetingDay || '-';
        const meetingSchedule = center.meetingTime ? normalizeMeetingTime(center.meetingTime) : '-';
        const assignedByAtCreation = center.approvedBy
            ? `${center.approvedBy.firstName} ${center.approvedBy.lastName}`
            : `${center.createdBy.firstName} ${center.createdBy.lastName}`;

        type Segment = { fdoId: string | null; fdoName: string; from: Date; till: Date | null; assignedBy: string };
        const segments: Segment[] = [];

        if (center.transferHistory.length === 0) {
            // Never transferred — the only period is the one from creation, still ongoing.
            segments.push({
                fdoId: center.fdoId,
                fdoName: center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : 'Unassigned',
                from: center.createdAt,
                till: null,
                assignedBy: assignedByAtCreation,
            });
        } else {
            const first = center.transferHistory[0];
            segments.push({
                fdoId: first.previousFdoId,
                fdoName: first.previousFdo
                    ? `${first.previousFdo.firstName} ${first.previousFdo.lastName}`
                    : 'Unassigned',
                from: center.createdAt,
                till: first.createdAt,
                assignedBy: assignedByAtCreation,
            });

            for (let i = 0; i < center.transferHistory.length; i++) {
                const t = center.transferHistory[i];
                const next = center.transferHistory[i + 1];
                segments.push({
                    fdoId: t.transferredToFdo.id,
                    fdoName: `${t.transferredToFdo.firstName} ${t.transferredToFdo.lastName}`,
                    from: t.createdAt,
                    till: next ? next.createdAt : null,
                    assignedBy: `${t.transferredBy.firstName} ${t.transferredBy.lastName}`,
                });
            }
        }

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const qualifies = options.fdoId
                // Officer timeline — every period this specific FDO held this (or any)
                // center, ever. No date bound: "full history for this person".
                ? seg.fdoId === options.fdoId
                : options.mode === 'AS_ON'
                    ? seg.from <= asOnInstant! && (seg.till === null || seg.till > asOnInstant!)
                    : seg.from >= startDate! && seg.from <= endDate!;
            if (!qualifies) continue;

            // The prior segment (if any) is who held this center right before this
            // assignment started — its own from/till shows how long they served.
            const previous = i > 0 ? segments[i - 1] : null;
            rawRows.push({
                branchName,
                centerName,
                meetingDay,
                meetingSchedule,
                previousFdoName: previous ? previous.fdoName : '-',
                previousFrom: previous ? previous.from : null,
                previousTill: previous ? previous.till : null,
                currentFdoName: seg.fdoName,
                currentFrom: seg.from,
                assignedBy: seg.assignedBy,
            });
        }
    }

    rawRows.sort((a, b) => b.currentFrom.getTime() - a.currentFrom.getTime());

    return rawRows.map((r) => ({
        branchName: r.branchName,
        centerName: r.centerName,
        meetingDay: r.meetingDay,
        meetingSchedule: r.meetingSchedule,
        previousFdoName: r.previousFdoName,
        previousFrom: r.previousFrom ? format(new Date(r.previousFrom), 'dd/MM/yyyy') : '',
        previousTill: r.previousTill ? format(new Date(r.previousTill), 'dd/MM/yyyy') : '',
        currentFdoName: r.currentFdoName,
        currentFrom: format(new Date(r.currentFrom), 'dd/MM/yyyy'),
        assignedBy: r.assignedBy,
    }));
}

// ── Gold Loan Reports ─────────────────────────────────────────────────────────

export type GoldTakenRow = {
    loanId: string;
    loanNumber: string;
    clientName: string;
    clientId: string;
    centerName: string;
    branchName: string;
    karatType: string;
    gramCount: number;
    goldTakenValue: number;
    cashGiven: number;
    disbursementDate: string;
    pricePerGram: number;
    itemDescription: string;
    goldTokenNo: string;
    remarks: string;
    photoCount: number;
} & MemberContactFields;

export type GoldReturnedRow = {
    // ── Detail-modal support fields ───────────────────────────────────────────
    internalLoanId: string;
    txnId: string;
    karatType: string;
    pricePerGram: number;
    photos: { id: string; photoUrl: string; photoKey: string | null }[];
    recipientName: string | null;
    recipientMobile: string | null;
    recipientRelation: string | null;
    recipientPhotoUrl: string | null;
    recipientPhotoKey: string | null;
    // ── New detailed fields ─────────────────────────────────────────────────
    sNo: number;
    branchId: string;
    branchName: string;
    centreId: string;
    centerName: string;
    productType: string;
    loanProduct: string;
    loanId: string;
    memberId: string;
    memberName: string;
    aadhaarNumber: string;
    phoneNumber: string;
    loanCycle: number;
    fdoName: string;
    purposeOfLoan: string;
    loanIndexId: string;
    ldDate: string;
    ldTime: string;
    startDate: string;
    endDate: string;
    loanPrincipal: number;
    loanInterest: number;
    loanTotalAmount: number;
    goldWeight: number;
    goldValueOnDisbursement: number;
    fundingName: string;
    loanStatus: string;
    loanApprove: string;
    returnDate: string;
    handOverTo: string;
    itemDescription: string;
    goldTokenNo: string;
    remarks: string;
    // ── Legacy fields kept for backward-compat with existing CSV export ──────
    loanNumber: string;
    clientName: string;
    clientId: string;
    gramsReturned: number;
    goldValue: number;
    approvedBy: string;
    initiatedBy: string;
    /** Loan-level co-applicant mobile (Aadhaar / member mobile are aadhaarNumber / phoneNumber above). */
    coApplicantMobile: string;
};

/** memberCount = distinct clients (a client with several gold loans counts once). */
export type GoldTakenTotals = { gramCount: number; goldTakenValue: number; cashGiven: number; memberCount: number };

export type GoldTakenPageResult = {
    rows: GoldTakenRow[];
    totalCount: number;
    totalPages: number;
    page: number;
    pageSize: number;
    totals: GoldTakenTotals;
};

export async function getGoldTakenReport(fromDate: string, toDate: string, branchId?: string, centerId?: string, page: number = 1, pageSize: number = 25, preResolvedBranchIds?: string[] | null, search?: string): Promise<GoldTakenPageResult> {
    // Server Action — called directly from a client component with no API
    // route / withAuth wrapper in front of it, so auth + branch scoping must
    // happen here. The caller-supplied branchId is only honored if it's
    // within the authenticated user's permitted set. `preResolvedBranchIds` lets
    // a caller with no HTTP request context (e.g. the Request Report background
    // worker) skip the cookie-based getServerActionUser() lookup.
    let branchIds: string[] | null;
    if (preResolvedBranchIds !== undefined) {
        branchIds = preResolvedBranchIds;
    } else {
        const user = await getServerActionUser();
        if (!user) throw new Error('Authentication required');
        branchIds = await resolveScopedBranchIds(user, branchId);
    }

    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(toDate);
    endDate.setHours(23, 59, 59, 999);

    const where: any = {
        type: 'TAKE',
        status: 'APPROVED',
    };
    // From/To is the loan's Disbursement Date (BM disbursement), not the gold entry's createdAt.
    const loanFilter: any = { disbursedByBMAt: { gte: startDate, lte: endDate } };
    if (branchIds) loanFilter.branchId = { in: branchIds };
    if (centerId && centerId !== 'all') loanFilter.centerId = centerId;
    if (Object.keys(loanFilter).length > 0) where.loan = loanFilter;

    if (search?.trim()) {
        const s = search.trim();
        where.OR = [
            { loan: { loanNumber: { contains: s, mode: 'insensitive' } } },
            { loan: { client: { firstName: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { lastName: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { clientId: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { otherIdNo: { contains: s } } } },
            { loan: { client: { mobileNumber: { contains: s } } } },
            { loan: { client: { coApplicants: { some: { mobileNumber: { contains: s } } } } } },
            { loan: { center: { name: { contains: s, mode: 'insensitive' } } } },
            { loan: { branch: { name: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { itemDescription: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { goldTokenNo: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { remarks: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { karatType: { contains: s, mode: 'insensitive' } } } },
        ];
    }

    const clampedPage = Math.max(1, page);
    const clampedPageSize = Math.min(5000, Math.max(1, pageSize));

    // Grand totals are computed via a separate, unpaginated (but lightweight —
    // no client/center/branch joins) pass over every matching row, decoupled
    // from the paginated detail rows below, so totals always reflect the full
    // filtered set rather than just the current page.
    const [totalCount, transactions, totalsRows] = await Promise.all([
        prisma.goldTransaction.count({ where }),
        prisma.goldTransaction.findMany({
            where,
            orderBy: [
                { loan: { disbursedByBMAt: 'asc' } },
                { id: 'asc' },
            ],
            include: {
                loan: {
                    select: {
                        loanNumber: true,
                        disbursedByBMAt: true,
                        client: { select: { id: true, firstName: true, lastName: true, clientId: true } },
                        center: { select: { name: true } },
                        branch: { select: { name: true } },
                        goldLoanDetail: { select: { karatType: true, gramCount: true, goldTakenValue: true, cashGiven: true, itemDescription: true, goldTokenNo: true, remarks: true } },
                    },
                },
            },
            skip: (clampedPage - 1) * clampedPageSize,
            take: clampedPageSize,
        }),
        prisma.goldTransaction.findMany({
            where,
            select: {
                loan: { select: { clientId: true, goldLoanDetail: { select: { gramCount: true, goldTakenValue: true, cashGiven: true } } } },
            },
        }),
    ]);

    const photoCounts = await prisma.goldLoanDetailPhoto.groupBy({
        by: ['loanId'],
        where: { loanId: { in: transactions.map((txn) => txn.loanId) } },
        _count: true,
    });
    const photoCountByLoanId = new Map(photoCounts.map((p) => [p.loanId, p._count]));

    const takenContactOf = await getMemberContacts({ clientIds: transactions.map((t) => t.loan.client.id), loanIds: transactions.map((t) => t.loanId) });
    const rows = transactions.map((txn) => {
        const gd = txn.loan.goldLoanDetail;
        const gramCount = Number(gd?.gramCount ?? 0);
        const goldTakenValue = Number(gd?.goldTakenValue ?? 0);
        return {
            loanId: txn.loanId,
            loanNumber: txn.loan.loanNumber,
            clientName: `${txn.loan.client.firstName} ${txn.loan.client.lastName}`,
            clientId: txn.loan.client.clientId,
            centerName: txn.loan.center?.name,
            branchName: txn.loan.branch.name,
            karatType: gd?.karatType ?? '',
            gramCount,
            goldTakenValue,
            cashGiven: Number(gd?.cashGiven ?? 0),
            disbursementDate: txn.loan.disbursedByBMAt ? format(new Date(txn.loan.disbursedByBMAt), 'dd/MM/yyyy') : '',
            pricePerGram: gramCount > 0 ? parseFloat((goldTakenValue / gramCount).toFixed(2)) : 0,
            itemDescription: gd?.itemDescription ?? '',
            goldTokenNo: gd?.goldTokenNo ?? '',
            remarks: gd?.remarks ?? '',
            photoCount: photoCountByLoanId.get(txn.loanId) ?? 0,
            ...takenContactOf(txn.loan.client.id, txn.loanId),
        };
    });

    const totals = totalsRows.reduce<GoldTakenTotals>(
        (acc, t) => {
            const gd = t.loan.goldLoanDetail;
            acc.gramCount += Number(gd?.gramCount ?? 0);
            acc.goldTakenValue += Number(gd?.goldTakenValue ?? 0);
            acc.cashGiven += Number(gd?.cashGiven ?? 0);
            return acc;
        },
        { gramCount: 0, goldTakenValue: 0, cashGiven: 0, memberCount: new Set(totalsRows.map((t) => t.loan.clientId)).size }
    );

    return {
        rows,
        totalCount,
        totalPages: Math.ceil(totalCount / clampedPageSize),
        page: clampedPage,
        pageSize: clampedPageSize,
        totals,
    };
}

export type GoldReturnedTotals = {
    loanPrincipal: number;
    loanInterest: number;
    loanTotalAmount: number;
    goldWeight: number;
    goldValueOnDisbursement: number;
    /** Distinct clients (a client with several gold loans counts once). */
    memberCount: number;
};

export type GoldReturnedPageResult = {
    rows: GoldReturnedRow[];
    totalCount: number;
    totalPages: number;
    page: number;
    pageSize: number;
    totals: GoldReturnedTotals;
};

export async function getGoldReturnedReport(fromDate: string, toDate: string, branchId?: string, centerId?: string, page: number = 1, pageSize: number = 25, preResolvedBranchIds?: string[] | null, search?: string): Promise<GoldReturnedPageResult> {
    // Server Action — called directly from a client component with no API
    // route / withAuth wrapper in front of it, so auth + branch scoping must
    // happen here. The caller-supplied branchId is only honored if it's
    // within the authenticated user's permitted set. `preResolvedBranchIds` lets
    // a caller with no HTTP request context (e.g. the Request Report background
    // worker) skip the cookie-based getServerActionUser() lookup.
    let branchIds: string[] | null;
    if (preResolvedBranchIds !== undefined) {
        branchIds = preResolvedBranchIds;
    } else {
        const user = await getServerActionUser();
        if (!user) throw new Error('Authentication required');
        branchIds = await resolveScopedBranchIds(user, branchId);
    }

    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(toDate);
    endDate.setHours(23, 59, 59, 999);

    const where: any = {
        type: 'GIVE',
        status: 'APPROVED',
        approvedAt: { gte: startDate, lte: endDate },
    };
    const loanFilter: any = {};
    if (branchIds) loanFilter.branchId = { in: branchIds };
    if (centerId && centerId !== 'all') loanFilter.centerId = centerId;
    if (Object.keys(loanFilter).length > 0) where.loan = loanFilter;

    if (search?.trim()) {
        const s = search.trim();
        where.OR = [
            { loan: { loanNumber: { contains: s, mode: 'insensitive' } } },
            { loan: { client: { firstName: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { lastName: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { clientId: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { otherIdNo: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { mobileNumber: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { phone: { contains: s, mode: 'insensitive' } } } },
            { loan: { client: { coApplicants: { some: { mobileNumber: { contains: s } } } } } },
            { loan: { center: { name: { contains: s, mode: 'insensitive' } } } },
            { loan: { branch: { name: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { itemDescription: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { goldTokenNo: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { remarks: { contains: s, mode: 'insensitive' } } } },
            { loan: { goldLoanDetail: { karatType: { contains: s, mode: 'insensitive' } } } },
            { loan: { loanProduct: { productName: { contains: s, mode: 'insensitive' } } } },
            { loan: { loanProduct: { loanProductType: { name: { contains: s, mode: 'insensitive' } } } } },
            { loan: { loanPurpose: { name: { contains: s, mode: 'insensitive' } } } },
            { loan: { loanIndex: { indexNo: { contains: s, mode: 'insensitive' } } } },
            { loan: { funder: { funderName: { contains: s, mode: 'insensitive' } } } },
            { loan: { center: { fdo: { firstName: { contains: s, mode: 'insensitive' } } } } },
            { loan: { center: { fdo: { lastName: { contains: s, mode: 'insensitive' } } } } },
            { recipientName: { contains: s, mode: 'insensitive' } },
            { recipientMobile: { contains: s, mode: 'insensitive' } },
            { recipientRelation: { contains: s, mode: 'insensitive' } },
        ];
    }

    const clampedPage = Math.max(1, page);
    const clampedPageSize = Math.min(5000, Math.max(1, pageSize));

    // Grand totals are computed via a separate, unpaginated (but lightweight —
    // no client/center/branch joins) pass over every matching row, decoupled
    // from the paginated detail rows below, so totals always reflect the full
    // filtered set rather than just the current page.
    const [totalCount, transactions, totalsRows] = await Promise.all([
        prisma.goldTransaction.count({ where }),
        prisma.goldTransaction.findMany({
        where,
        orderBy: [
            { approvedAt: 'asc' },
            { id: 'asc' },
        ],
        skip: (clampedPage - 1) * clampedPageSize,
        take: clampedPageSize,
        include: {
            loan: {
                include: {
                    branch: { select: { code: true, name: true } },
                    center: {
                        select: {
                            code: true,
                            name: true,
                            fdo: { select: { firstName: true, lastName: true } },
                        },
                    },
                    client: {
                        select: {
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            mobileNumber: true,
                            phone: true,
                            otherIdNo: true,
                        },
                    },
                    loanProduct: {
                        include: { loanProductType: { select: { name: true } } },
                    },
                    loanPurpose: { select: { name: true } },
                    loanIndex: { select: { indexNo: true } },
                    schedules: {
                        select: { installmentNo: true, dueDate: true, interestDue: true },
                        orderBy: { installmentNo: 'asc' },
                    },
                    goldLoanDetail: {
                        select: { karatType: true, gramCount: true, goldTakenValue: true, cashGiven: true, itemDescription: true, goldTokenNo: true, remarks: true },
                    },
                    funder: { select: { funderName: true } },
                },
            },
            initiatedBy: { select: { firstName: true, lastName: true } },
            approvedBy: { select: { firstName: true, lastName: true } },
            returnPhotos: { select: { id: true, photoUrl: true, photoKey: true } },
        },
        }),
        prisma.goldTransaction.findMany({
            where,
            select: {
                gramCount: true,
                goldValue: true,
                loan: {
                    select: {
                        clientId: true,
                        amount: true,
                        schedules: { select: { interestDue: true } },
                        goldLoanDetail: { select: { gramCount: true, goldTakenValue: true } },
                    },
                },
            },
        }),
    ]);

    const totals = totalsRows.reduce<GoldReturnedTotals>(
        (acc, t) => {
            const loanPrincipal = Number(t.loan.amount);
            const loanInterest = t.loan.schedules.reduce((sum, s) => sum + Number(s.interestDue), 0);
            const gramCount = Number(t.loan.goldLoanDetail?.gramCount ?? t.gramCount);
            const goldTakenValue = Number(t.loan.goldLoanDetail?.goldTakenValue ?? t.goldValue);
            acc.loanPrincipal += loanPrincipal;
            acc.loanInterest += loanInterest;
            acc.loanTotalAmount += loanPrincipal + loanInterest;
            acc.goldWeight += gramCount;
            acc.goldValueOnDisbursement += goldTakenValue;
            return acc;
        },
        { loanPrincipal: 0, loanInterest: 0, loanTotalAmount: 0, goldWeight: 0, goldValueOnDisbursement: 0, memberCount: new Set(totalsRows.map((t) => t.loan.clientId)).size }
    );

    // Build loan-cycle map: for each client, sort their disbursed loans by date
    const clientIds = [...new Set(transactions.map((t) => t.loan.clientId))];
    const allClientDisbursements = await prisma.loan.findMany({
        where: { clientId: { in: clientIds }, disbursementStatus: 'DISBURSED' },
        select: { id: true, clientId: true, disbursedLevel1At: true },
        orderBy: [{ clientId: 'asc' }, { disbursedLevel1At: 'asc' }],
    });
    const clientLoanOrder = new Map<string, string[]>();
    for (const l of allClientDisbursements) {
        if (!clientLoanOrder.has(l.clientId)) clientLoanOrder.set(l.clientId, []);
        clientLoanOrder.get(l.clientId)!.push(l.id);
    }

    const returnedContactOf = await getMemberContacts({ clientIds: transactions.map((t) => t.loan.clientId), loanIds: transactions.map((t) => t.loanId) });
    const rows = transactions.map((txn, index) => {
        const loan = txn.loan;
        const allSchedules = loan.schedules;
        const firstSchedule = allSchedules[0];
        const lastSchedule = allSchedules[allSchedules.length - 1];

        const disbursalTimestamp = loan.disbursedByBMAt ?? loan.disbursedLevel1At;

        const loanPrincipal = Number(loan.amount);
        const loanInterest = allSchedules.reduce((sum, s) => sum + Number(s.interestDue), 0);

        const loanOrderList = clientLoanOrder.get(loan.clientId) ?? [];
        const loanCycle = loanOrderList.indexOf(loan.id) + 1;

        const gramCount = Number(loan.goldLoanDetail?.gramCount ?? txn.gramCount);
        const goldTakenValue = Number(loan.goldLoanDetail?.goldTakenValue ?? txn.goldValue);

        const initiatedByName = txn.initiatedBy
            ? `${txn.initiatedBy.firstName} ${txn.initiatedBy.lastName}`
            : 'N/A';
        const approvedByName = txn.approvedBy
            ? `${txn.approvedBy.firstName} ${txn.approvedBy.lastName}`
            : '—';

        const txnGramCount = Number(txn.gramCount);
        const txnGoldValue = Number(txn.goldValue);

        return {
            // ── Detail-modal support fields ──────────────────────────────────────
            internalLoanId: loan.id,
            txnId: txn.id,
            karatType: loan.goldLoanDetail?.karatType ?? '',
            pricePerGram: txnGramCount > 0 ? parseFloat((txnGoldValue / txnGramCount).toFixed(2)) : 0,
            photos: txn.returnPhotos.map((p) => ({ id: p.id, photoUrl: p.photoUrl, photoKey: p.photoKey })),
            recipientName: txn.recipientName ?? null,
            recipientMobile: txn.recipientMobile ?? null,
            recipientRelation: txn.recipientRelation ?? null,
            recipientPhotoUrl: txn.recipientPhotoUrl ?? null,
            recipientPhotoKey: txn.recipientPhotoKey ?? null,
            // ── New detailed fields ──────────────────────────────────────────────
            sNo: (clampedPage - 1) * clampedPageSize + index + 1,
            branchId: loan.branch?.code ?? 'N/A',
            branchName: loan.branch?.name ?? 'N/A',
            centreId: loan.center?.code ?? 'N/A',
            centerName: loan.center?.name ?? 'N/A',
            productType: loan.loanProduct?.loanProductType?.name ?? 'N/A',
            loanProduct: loan.loanProduct?.productName ?? 'N/A',
            loanId: loan.loanNumber,
            memberId: loan.client.clientId,
            memberName: `${loan.client.firstName} ${loan.client.lastName}`,
            aadhaarNumber: loan.client.otherIdNo ?? 'N/A',
            phoneNumber: loan.client.mobileNumber || loan.client.phone || 'N/A',
            loanCycle: loanCycle || 1,
            fdoName: loan.center?.fdo
                ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`
                : 'N/A',
            purposeOfLoan: loan.loanPurpose?.name ?? 'N/A',
            loanIndexId: loan.loanIndex?.indexNo ?? loan.indexId ?? 'N/A',
            ldDate: disbursalTimestamp
                ? format(new Date(disbursalTimestamp), 'dd/MM/yyyy')
                : 'N/A',
            ldTime: disbursalTimestamp
                ? format(new Date(disbursalTimestamp), 'HH:mm:ss')
                : 'N/A',
            startDate: firstSchedule
                ? format(new Date(firstSchedule.dueDate), 'dd/MM/yyyy')
                : 'N/A',
            endDate: lastSchedule
                ? format(new Date(lastSchedule.dueDate), 'dd/MM/yyyy')
                : 'N/A',
            loanPrincipal,
            loanInterest,
            loanTotalAmount: loanPrincipal + loanInterest,
            goldWeight: gramCount,
            goldValueOnDisbursement: goldTakenValue,
            fundingName: loan.funder?.funderName ?? 'Own Fund',
            loanStatus: loan.disbursementStatus,
            loanApprove: loan.applicationStatus,
            returnDate: txn.approvedAt ? format(new Date(txn.approvedAt), 'dd/MM/yyyy') : 'N/A',
            handOverTo: initiatedByName,  // BM who physically handed over the gold
            itemDescription: loan.goldLoanDetail?.itemDescription ?? '',
            goldTokenNo: loan.goldLoanDetail?.goldTokenNo ?? '',
            remarks: loan.goldLoanDetail?.remarks ?? '',
            // ── Legacy backward-compat fields ────────────────────────────────────
            loanNumber: loan.loanNumber,
            clientName: `${loan.client.firstName} ${loan.client.lastName}`,
            clientId: loan.client.clientId,
            gramsReturned: Number(txn.gramCount),
            goldValue: Number(txn.goldValue),
            approvedBy: approvedByName,
            initiatedBy: initiatedByName,
            coApplicantMobile: returnedContactOf(loan.clientId, loan.id).coApplicantMobile,
        };
    });

    return {
        rows,
        totalCount,
        totalPages: Math.ceil(totalCount / clampedPageSize),
        page: clampedPage,
        pageSize: clampedPageSize,
        totals,
    };
}

// ── Loan Advance Refund report ──────────────────────────────────────────────

export type LoanAdvanceRefundStatusFilter = 'ALL' | 'INITIATED' | 'GIVEN' | 'REJECTED';

export type LoanAdvanceRefundFilters = {
    centerId?: string;
    status?: LoanAdvanceRefundStatusFilter;
    /** One range; the date field it applies to depends on each row's status (see below). */
    fromDate: string;
    tillDate: string;
};

export type LoanAdvanceRefundRow = {
    slNo: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centreId: string;
    centerName: string;
    fdoName: string;
    memberId: string;
    memberName: string;
    phoneNumber: string;
    aadhaarNumber: string;
    loanId: string;
    advanceAtInitiation: number;
    refundAmount: number;
    /** null until the refund is Given (approved) */
    balanceAfterRefund: number | null;
    currentAdvanceBalance: number;
    status: 'Initiated' | 'Given' | 'Rejected';
    initiatedBy: string;
    initiatedDate: string;
    initiatedTime: string;
    reviewedBy: string;
    reviewedDate: string;
    reviewedTime: string;
    remarks: string;
    reviewRemarks: string;
    revertedBy: string;
    revertedDate: string;
    revertReason: string;
    voucherNo: string;
};

const personName = (u: { firstName: string; lastName: string } | null | undefined): string =>
    u ? `${u.firstName} ${u.lastName}`.trim() : '';

export async function getLoanAdvanceRefundData(
    filters: LoanAdvanceRefundFilters,
    branchId?: string | string[]
): Promise<LoanAdvanceRefundRow[]> {
    const where: any = {};
    const and: any[] = [];

    if (filters.centerId && filters.centerId !== 'all') where.centerId = filters.centerId;
    if (branchId && (!Array.isArray(branchId) || branchId.length > 0)) {
        where.branchId = Array.isArray(branchId) ? { in: branchId } : branchId;
    }

    // One IST date range, applied to the date that belongs to each row's status:
    // Initiated → initiated date, Given → approved date, Rejected → rejected date. Reverted refunds are not listed.
    const w = buildDcbIstReportWindow(filters.fromDate, filters.tillDate);
    const range = { gte: w.rangeStartUtc, lt: w.rangeEndExclusiveUtc };
    const byStatus = {
        INITIATED: { status: 'PENDING_APPROVAL', isReversed: false, initiatedAt: range },
        GIVEN: { status: 'APPROVED', isReversed: false, reviewedAt: range },
        REJECTED: { status: 'REJECTED', isReversed: false, reviewedAt: range },
    } as const;
    const status = filters.status ?? 'ALL';
    // Reverted refunds are excluded: every branch requires isReversed=false (a reverted request can end up REJECTED with isReversed=true).
    and.push(status === 'ALL' ? { OR: Object.values(byStatus) } : byStatus[status]);
    where.AND = and;

    const requests = await prisma.savingsRefundRequest.findMany({
        where,
        include: {
            loan: { select: { loanNumber: true } },
            client: { select: { clientId: true, firstName: true, lastName: true, phone: true, mobileNumber: true, otherIdNo: true, loanAdvance: true } },
            center: {
                select: {
                    code: true,
                    name: true,
                    fdo: { select: { firstName: true, lastName: true } },
                    branch: {
                        select: {
                            code: true,
                            name: true,
                            areas: { select: { name: true, division: { select: { name: true, region: { select: { name: true } } } } } },
                        },
                    },
                },
            },
            initiatedBy: { select: { firstName: true, lastName: true } },
            reviewedBy: { select: { firstName: true, lastName: true } },
            revertedBy: { select: { firstName: true, lastName: true } },
            financialTransaction: { select: { voucherNo: true } },
        },
        orderBy: [{ initiatedAt: 'asc' }, { createdAt: 'asc' }],
    });

    return requests.map((r, index) => {
        const area = r.center?.branch?.areas?.[0];
        // Reverted requests are filtered out in the query, so only these three states reach here.
        const rowStatus: LoanAdvanceRefundRow['status'] =
            r.status === 'APPROVED' ? 'Given' : r.status === 'REJECTED' ? 'Rejected' : 'Initiated';
        const totalSavings = Number(r.totalSavings);
        const refundAmount = Number(r.refundAmount);
        const reviewed = r.reviewedAt && r.status !== 'PENDING_APPROVAL';

        return {
            slNo: index + 1,
            regionName: area?.division?.region?.name ?? 'N/A',
            divisionName: area?.division?.name ?? 'N/A',
            areaName: area?.name ?? 'N/A',
            branchId: r.center?.branch?.code ?? 'N/A',
            branchName: r.center?.branch?.name ?? 'N/A',
            centreId: r.center?.code ?? 'N/A',
            centerName: r.center?.name ?? 'N/A',
            fdoName: personName(r.center?.fdo) || 'N/A',
            memberId: r.client.clientId,
            memberName: `${r.client.firstName} ${r.client.lastName}`.trim(),
            phoneNumber: r.client.phone || r.client.mobileNumber || 'N/A',
            aadhaarNumber: r.client.otherIdNo || 'N/A',
            loanId: r.loan?.loanNumber ?? 'N/A',
            advanceAtInitiation: totalSavings,
            refundAmount,
            balanceAfterRefund: rowStatus === 'Given' ? Math.max(0, totalSavings - refundAmount) : null,
            currentAdvanceBalance: Number(r.client.loanAdvance ?? 0),
            status: rowStatus,
            initiatedBy: personName(r.initiatedBy) || 'N/A',
            initiatedDate: toDisplayDate(r.initiatedAt),
            initiatedTime: formatIstTime(r.initiatedAt),
            reviewedBy: reviewed ? personName(r.reviewedBy) : '',
            reviewedDate: reviewed ? toDisplayDate(r.reviewedAt) : '',
            reviewedTime: reviewed ? formatIstTime(r.reviewedAt!) : '',
            remarks: r.remarks ?? '',
            reviewRemarks: r.reviewRemarks ?? '',
            revertedBy: r.isReversed ? personName(r.revertedBy) : '',
            revertedDate: r.isReversed && r.revertedAt ? toDisplayDate(r.revertedAt) : '',
            revertReason: r.isReversed ? (r.revertReason ?? '') : '',
            voucherNo: r.financialTransaction?.voucherNo ?? '',
        };
    });
}
