// Mirrors app/dashboard/reports/demand/demand-sheet/page.tsx's
// buildDemandSheetWordOptions() (Clientwise) and buildDemandSheetCenterwiseWordOptions()
// (Centerwise). Mode is threaded through the same `filters.reportType` key that the
// registry's own fetchDemandSheet() already reads (see report-registry.ts) — 'clientwise' or
// default 'centerwise' — so a queued Demand Sheet request reconstructs the same mode the
// user actually requested, never defaulting silently to one or the other.
//
// Layout config (groupHeaders/subHeaders/columnAlignments/columnWidthWeights/pageSize) is
// reused verbatim from the client builders — fetchDemandSheet returns the exact same column
// order for both modes. totalsRow is reconstructed by summing the numeric columns across the
// fetched rows. reportInfo/summary are reconstructed from the ReportRequest's own resolved
// branchLabel/fromDate plus a Prisma lookup of the FDO name from filters.fdoId (the same id
// the client already sends) and the Center Name column when the data is scoped to one center.
import { prisma } from '@/app/lib/prisma';
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';
import { toDisplayDateTime } from '@/app/lib/date-format';

function sumCol(rows: (string | number)[][], colIndex: number): number {
    return rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
}

function formatCurrency(n: number): string {
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

async function resolveFdoName(fdoId: string | undefined): Promise<string> {
    if (!fdoId || fdoId === 'all') return 'All FDOs';
    const user = await prisma.user.findUnique({ where: { id: fdoId }, select: { firstName: true, lastName: true } });
    return user ? `${user.firstName} ${user.lastName}`.trim() : 'All FDOs';
}

function dayNameFor(dateStr: string | null): string {
    if (!dateStr) return '-';
    const d = new Date(`${dateStr}T00:00:00`);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN', { weekday: 'long' });
}

const buildClientwise: WordOptionsBuilder = async (headers, rows, ctx) => {
    const fdoName = await resolveFdoName(ctx.filters?.fdoId);
    const centerNames = new Set(rows.map((r) => String(r[5] ?? '')));
    const centerName = centerNames.size === 1 ? Array.from(centerNames)[0] : 'All Centers';

    // fetchDemandSheet (report-registry.ts) drops the "Loan Advance OS"/"Loan
    // Advance Demand" columns entirely when the feature is disabled — detect
    // that from the header list rather than hardcoding 33, so every index/width/
    // alignment array below stays in sync with the actual `rows` shape.
    const loanAdvanceEnabled = headers.includes('Loan Advance OS');
    // Columns from "Total Demand Amount" onward shift left by 2 when the two
    // Loan Advance columns are absent.
    const shift = loanAdvanceEnabled ? 0 : 2;

    const totals = {
        loanAmount: sumCol(rows, 9), loanAmountInterest: sumCol(rows, 10), loanAmountTotal: sumCol(rows, 11),
        loanOSPrincipal: sumCol(rows, 12), loanOSInterest: sumCol(rows, 13), loanOS: sumCol(rows, 14),
        curDue: sumCol(rows, 15), collDue: sumCol(rows, 16),
        arrearPrincipal: sumCol(rows, 18), arrearInterest: sumCol(rows, 19), arrear: sumCol(rows, 20),
        demandPrincipal: sumCol(rows, 21), demandInterest: sumCol(rows, 22), demand: sumCol(rows, 23),
        loanAdvanceOS: loanAdvanceEnabled ? sumCol(rows, 24) : 0,
        loanAdvanceDemand: loanAdvanceEnabled ? sumCol(rows, 25) : 0,
        totalDemandAmount: sumCol(rows, 26 - shift), currentDemandCollAmount: sumCol(rows, 28 - shift),
    };

    const totalsRow: (string | number)[] = [
        '', '', 'GRAND TOTAL', '', '', '', '',
        '', '',
        formatCurrency(totals.loanAmount), formatCurrency(totals.loanAmountInterest), formatCurrency(totals.loanAmountTotal),
        formatCurrency(totals.loanOSPrincipal), formatCurrency(totals.loanOSInterest), formatCurrency(totals.loanOS),
        totals.curDue, totals.collDue, '',
        formatCurrency(totals.arrearPrincipal), formatCurrency(totals.arrearInterest), formatCurrency(totals.arrear),
        formatCurrency(totals.demandPrincipal), formatCurrency(totals.demandInterest), formatCurrency(totals.demand),
        ...(loanAdvanceEnabled ? [formatCurrency(totals.loanAdvanceOS), formatCurrency(totals.loanAdvanceDemand)] : []),
        formatCurrency(totals.totalDemandAmount), '', formatCurrency(totals.currentDemandCollAmount),
        '', '', '', '',
    ];

    return {
        bodyRows: rows,
        options: {
            reportInfo: [
                { label: 'Branch', value: ctx.branchLabel },
                { label: 'Center', value: centerName },
                { label: 'FDO', value: fdoName },
                { label: 'Meeting Day', value: dayNameFor(ctx.fromDate) },
                { label: 'Report Date', value: ctx.fromDate ?? '-' },
                { label: 'Generated', value: toDisplayDateTime(new Date()) },
                { label: 'Total Clients', value: String(rows.length) },
            ],
            summary: [
                { label: 'Total Clients', value: String(rows.length) },
                { label: 'Total Demand', value: formatCurrency(totals.totalDemandAmount) },
                { label: 'Total Collected', value: formatCurrency(totals.currentDemandCollAmount) },
                { label: 'Outstanding', value: formatCurrency(totals.loanOS) },
            ],
            groupHeaders: [
                { label: 'CLIENT INFORMATION', span: 7 },
                { label: 'LOAN INFORMATION', span: 2 },
                { label: 'LOAN AMOUNT', span: 3 },
                { label: 'LOAN OUTSTANDING', span: 3 },
                { label: 'DUES', span: 2 },
                { label: 'Demand Date', span: 1 },
                { label: 'ARREAR DEMAND', span: 3 },
                { label: 'CURRENT DEMAND', span: 3 },
                ...(loanAdvanceEnabled ? [{ label: 'LOAN ADVANCE', span: 2 }] : []),
                { label: 'Total Demand Amount', span: 1 },
                { label: 'Officer Name', span: 1 },
                { label: 'COLLECTION', span: 5 },
            ],
            subHeaders: [
                'S.No', 'Member ID', 'Member Name', 'Phone', 'Branch', 'Center', 'Group',
                'Product', 'Disb. Date',
                'Principal', 'Interest', 'Total',
                'Principal', 'Interest', 'Total',
                'Current', 'Collection',
                'Principal', 'Interest', 'Total',
                'Principal', 'Interest', 'Total',
                ...(loanAdvanceEnabled ? ['O/S', 'Due'] : []),
                'Coll. Amount', 'Coll. Date', 'Status', 'Meet Time', 'Funder',
            ],
            columnAlignments: [
                'center', 'center', 'left', 'center', 'left', 'left', 'left',
                'left', 'center',
                'right', 'right', 'right',
                'right', 'right', 'right',
                'right', 'right',
                'center',
                'right', 'right', 'right',
                'right', 'right', 'right',
                ...(loanAdvanceEnabled ? (['right', 'right'] as const) : []),
                'right', 'left',
                'right',
                'center', 'center', 'center', 'left',
            ],
            totalsRow,
            columnWidthWeights: [
                4, 7, 16, 9, 10, 11, 9,
                11, 8,
                8, 7, 8,
                8, 7, 8,
                5, 5,
                8,
                7, 7, 7,
                7, 7, 7,
                ...(loanAdvanceEnabled ? [7, 7] : []),
                9, 11, 9,
                8, 8, 7, 10,
            ],
            pageSize: { widthMm: 297, heightMm: 420 },
            footerText: 'Demand Sheet — Clientwise',
        },
    };
};

const buildCenterwise: WordOptionsBuilder = async (headers, rows, ctx) => {
    const fdoName = await resolveFdoName(ctx.filters?.fdoId);

    // fetchDemandSheet drops "Loan Advance OS"/"Loan.AD Demand" when disabled —
    // detect from headers so column indices below stay in sync with `rows`.
    const loanAdvanceEnabled = headers.includes('Loan Advance OS');
    const shift = loanAdvanceEnabled ? 0 : 2;

    const totalClients = sumCol(rows, 3);
    const totalWB = sumCol(rows, 4);
    const totalDueNo = sumCol(rows, 5);
    const totalLoanOS = sumCol(rows, 7);
    const totalArrear = sumCol(rows, 8);
    const totalDemand = sumCol(rows, 9);
    const totalLoanAdvanceOS = loanAdvanceEnabled ? sumCol(rows, 10) : 0;
    const totalLoanAdvanceDemand = loanAdvanceEnabled ? sumCol(rows, 11) : 0;
    const totalCollected = sumCol(rows, 12 - shift);

    const totalsRow: (string | number)[] = [
        '', 'GRAND TOTAL', '', totalClients, totalWB,
        totalDueNo, '',
        formatCurrency(totalLoanOS), formatCurrency(totalArrear), formatCurrency(totalDemand),
        ...(loanAdvanceEnabled ? [formatCurrency(totalLoanAdvanceOS), formatCurrency(totalLoanAdvanceDemand)] : []),
        formatCurrency(totalCollected),
    ];

    return {
        bodyRows: rows,
        options: {
            reportInfo: [
                { label: 'Branch', value: ctx.branchLabel },
                { label: 'Meeting Day', value: dayNameFor(ctx.fromDate) },
                { label: 'FDO', value: fdoName },
                { label: 'Report Date', value: ctx.fromDate ?? '-' },
                { label: 'Generated', value: toDisplayDateTime(new Date()) },
                { label: 'Total Centers', value: String(rows.length) },
            ],
            summary: [
                { label: 'Total Centers', value: String(rows.length) },
                { label: 'Total Clients', value: String(totalClients) },
                { label: 'Total Demand', value: formatCurrency(totalDemand) },
                { label: 'Total Collected', value: formatCurrency(totalCollected) },
                { label: 'Outstanding', value: formatCurrency(totalLoanOS) },
            ],
            columnAlignments: [
                'center', 'left', 'center', 'right', 'center', 'center', 'center', 'right', 'right', 'right',
                ...(loanAdvanceEnabled ? (['right', 'right'] as const) : []),
                'right',
            ],
            columnWidthWeights: [4, 14, 8, 6, 5, 6, 7, 8, 8, 8, ...(loanAdvanceEnabled ? [9, 9] : []), 8],
            totalsRow,
            footerText: 'Demand Sheet — Centerwise',
        },
    };
};

export const buildDemandSheetWordExport: WordOptionsBuilder = (headers, rows, ctx) => {
    const reportType = ctx.filters?.reportType || 'centerwise';
    return reportType === 'clientwise' ? buildClientwise(headers, rows, ctx) : buildCenterwise(headers, rows, ctx);
};
