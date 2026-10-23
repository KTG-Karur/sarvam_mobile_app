import { prisma } from '@/app/lib/prisma';
import { getPersonLabel } from '@/app/lib/person-label';
import { MEMBER_CONTACT_HEADERS, CO_APPLICANT_MOBILE_HEADER, memberContactValues } from '@/app/lib/reports/member-contact-columns';
import {
    buildMeetingAttendanceWhere,
    meetingAttendanceInclude,
    meetingAttendanceOrderBy,
    mapMeetingAttendanceRecord,
} from '@/app/lib/reports/queries/meeting-attendance';
import {
    getAdditionDeletionRows,
    getAttendanceSummaryRows,
    getAttendanceDetailedRows,
    getDropoutsRows,
    getDoubleClientsRows,
    getBalanceInformationRows,
} from '@/app/lib/reports/queries/batch1';
import { getPreclosureRows } from '@/app/lib/reports/queries/batch2';
import { getDenominationCollectionReport } from '@/app/lib/reports/denomination-collection';
import { getFutureDemandData } from '@/app/lib/actions/future-demand';
import { getFutureReportRows, getFdoPerformanceRows } from '@/app/lib/reports/queries/batch4';
import { getCenterMasterRows, getWaitingBorrowersDetailedRows, getWaitingBorrowersSummaryRows, getMeetingCheckRows } from '@/app/lib/reports/queries/batch3';
import {
    getClientAdditionDisbursedData,
    getClientTransferData,
    getCCRData,
    getGoldTakenReport,
    getGoldReturnedReport,
    getLoanOSDetailsData,
    getDCRData,
    getDCBData,
    type CCRRow,
    type DCBRow,
} from '@/app/lib/actions/reports';
import { queryInsuranceReportRows } from '@/app/api/reports/others/insurance-report/route';
import { queryLoans as queryClosedLoans, buildRow as buildClosedLoanRow } from '@/app/api/reports/client/closed-loan-report/route';
import { queryDeathMemberRows } from '@/app/api/reports/client/death-member/route';
import {
    queryLoans as queryMemberReportLoans,
    buildRows as buildMemberReportRows,
    buildGroupNameMap as buildMemberReportGroupNameMap,
    queryDraftClients as queryMemberReportDraftClients,
    buildDraftRows as buildMemberReportDraftRows,
} from '@/app/api/reports/client/member-report/route';
import { getIncentiveReportData } from '@/app/lib/services/incentive-report.service';
import { getPortfolioAtRiskData, getMISDetailedAgewiseArrearData, getMISAgewiseArrearData, type MISAgewiseReportType } from '@/app/lib/actions/reports';
import { queryLoans as queryPortfolioLoans, buildRows as buildPortfolioRows } from '@/app/api/admin-reports/portfolio/client-portfolio-report/route';
import { computeTrialBalanceRows, type TrialBalanceRow } from '@/app/api/reports/trial-balance/route';
import { computeLedgerReport } from '@/app/api/reports/ledger-report/route';
import { computeBranchProfile } from '@/app/api/reports/others/branch-profile/route';
import { computeTaskReport } from '@/app/api/reports/employee/task-report/route';
import { aggregateCollectionFromTransactionLines } from '@/app/lib/reports/loan-collection-aggregation';
import {
    getOSBranchwiseData,
    getAllBranchDCBData,
    getMISBranchDemandData,
    getIndividualLedgerData,
    getLoanDisbursementData,
    getOSCenterwiseData,
    getClientwiseDCBData,
    getAgewiseArrearData,
    getOSClientwiseData,
} from '@/app/lib/actions/reports';
import { startOfDay, endOfDay, format as formatDateFns, parse as parseDateFns } from 'date-fns';
import { highmarkService } from '@/app/lib/services/highmark.service';
import { getMeetingDayName, buildMeetingDayVariantOrFilter } from '@/app/lib/collections/meeting-day';
import { computeNextMeetingDateYmd, formatYmdToDmy } from '@/app/lib/collections/next-meeting-date';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { applicationFormClientSelect, mapClientToApplicationFormRecord } from '@/app/lib/reports/application-form-data';
import { formatDate as formatApplicationFormDate, maskAadhar } from '@/app/lib/reports/application-form-template';
import { getArrearDemandSheetDataCore, getDemandSheetDataForQueue, getDemandSheetClientWiseTableDataForQueue } from '@/app/lib/actions/demand';
import { getBranchDemandDataCore } from '@/app/lib/actions/branch-demand';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import { getBranchOpeningContext } from '@/app/lib/services/ledger-opening-balance';
import { getDaybookData } from '@/app/lib/actions/reports';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { getLoanAdvanceEnabled } from '@/app/lib/loan-advance-config';
import { computeGlAllAccounts } from '@/app/api/reports/gl-all/route';
import { computeGlOneAccount } from '@/app/api/reports/gl-one/route';
import { computeReceiptsPaymentsCore } from '@/app/api/reports/receipts-payments/route';
import { computeLoanIndexReport } from '@/app/api/reports/others/loan-index/route';
import { computeLoanLedgerDues } from '@/app/api/reports/client/loan-ledger-dues/route';
import { truncateReportAmount, formatReportAmount } from '@/app/lib/utils/format-amount';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';
import { loanMemberIdSearchConditions, memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

/**
 * Central catalog for the async "Request Report" export queue
 * (app/lib/reports/report-request-worker.ts). Existing report data functions
 * have inconsistent signatures (single-date vs range, paged vs array,
 * union-typed branch params) — every entry here normalizes its report behind
 * one shared `fetch` shape so the worker and the ReportPermission admin UI
 * only ever need to deal with one table.
 *
 * Add a report by lifting its existing `build*ExportRows()` mapper (already
 * present in most `components/reports/*Client.tsx` files) into a new entry's
 * `fetch`, sourced from the same Prisma query the report's own API route uses
 * (unpaginated — the worker always wants the full filtered set).
 */

export type ReportDateMode = 'RANGE' | 'SINGLE' | 'NONE';

export type ReportFetchParams = {
    fromDate: string | null;
    toDate: string | null;
    /** null = ALL branches (caller already scoped this to what the requester is permitted to see) */
    branchIds: string[] | null;
    /**
     * Report-specific filters beyond date/branch (centerId, product, status, FDO, etc.) —
     * shape varies per report; each fetch adapter reads the keys it needs. Stored verbatim
     * on ReportRequest.filters (Json) and included in the same-day duplicate-request match
     * key, so two exports differing only by e.g. center are never conflated.
     */
    filters: Record<string, string> | null;
};

export type ReportRows = {
    headers: string[];
    rows: (string | number)[][];
    totalCount: number;
};

export type ReportRegistryEntry = {
    slug: string;
    reportName: string;
    moduleSlug: 'reports';
    dateMode: ReportDateMode;
    requiresCenter: boolean;
    /**
     * Omitted (undefined) for reports catalogued here only so they get a
     * ReportPermission row (canView/canExport gating) — they have no
     * server-side export path and stay on their existing client-side
     * (immediate browser download) export flow. See isQueueCapable().
     */
    fetch?: (params: ReportFetchParams) => Promise<ReportRows>;
    /**
     * The existing report page's nav entry href (app/config/navigation.config.ts) —
     * used only by prisma/seed-report-permissions.ts to default-seed canExport
     * from that page's current `allowedRoles`, so wiring the ReportPermission
     * gate into a report doesn't silently revoke export from roles that could
     * already see the report today.
     */
    navHref: string;
};

async function fetchMeetingAttendance({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) {
        throw new Error('fromDate and toDate are required for the Meeting Attendance report');
    }

    const where = buildMeetingAttendanceWhere({
        fromDate,
        toDate,
        branchIds,
        centerId: filters?.centerId ?? null,
        search: filters?.search ?? null,
    });

    const records = await prisma.clientAttendance.findMany({
        where,
        include: meetingAttendanceInclude,
        orderBy: meetingAttendanceOrderBy,
    });
    const mapped = records.map(mapMeetingAttendanceRecord);

    const headers = ['Date', 'Center Name / Code', 'Name', 'ID', 'Member / Client', 'Phone', 'Status', 'Marked By', ...MEMBER_CONTACT_HEADERS];
    const rows: (string | number)[][] = mapped.map((record) => [
        toDisplayDate(new Date(record.date)),
        `${record.centerName} / ${record.centerCode}`,
        record.clientName,
        record.clientId,
        getPersonLabel(record.hasLoan).singular,
        record.phone,
        record.isPresent ? 'Present' : 'Absent',
        record.markedBy,
        ...memberContactValues(record),
    ]);

    return { headers, rows, totalCount: mapped.length };
}

async function fetchAdditionDeletion({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Addition & Deletion report');
    const data = await getAdditionDeletionRows({ fromDate, toDate, branchIds, centerId: filters?.centerId ?? null });
    const headers = ['Sl No', 'FDO', 'Center', 'Opening', 'Induction', 'Dropped', 'Closing', 'Admission Fees'];
    const rows = data.map((r, i) => [i + 1, r.fdo, r.centerName, r.opening, r.induction, r.dropped, r.closing, truncateReportAmount(r.admissionFees)]);
    return { headers, rows, totalCount: data.length };
}

/** Mirrors the per-branch fan-out already used by app/api/reports/client/addition-disbursed/route.ts. */
async function fetchAdditionDisbursed({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Addition Disbursed report');
    const centerId = filters?.centerId;
    const data = !branchIds
        ? await getClientAdditionDisbursedData(fromDate, toDate, centerId, undefined)
        : branchIds.length <= 1
            ? await getClientAdditionDisbursedData(fromDate, toDate, centerId, branchIds[0])
            : (await Promise.all(branchIds.map((bId) => getClientAdditionDisbursedData(fromDate, toDate, centerId, bId)))).flat();

    const headers = ['Center Id', 'Center Name', 'Client ID', 'Client Name', 'Joined Date', 'Disbursal Date', 'Loan A/c', 'Loan Amount', 'Total Dues', 'Funder', 'FDO Name', ...MEMBER_CONTACT_HEADERS];
    const rows: (string | number)[][] = data.map((r) => [r.centerId, r.centerName, r.clientId, r.clientName, r.joinedDate, r.disbursalDate, r.loanAc, truncateReportAmount(r.loanAmount), truncateReportAmount(r.totalDues), r.funder, r.fdoName, ...memberContactValues(r)]);
    // Mirrors AdditionDisbursedClient's buildAdditionDisbursedExportRows() "Grand Total" row
    // (shared by its own CSV/Excel/Word exports) — a plain reduce over the same
    // already-fetched `data`.
    if (data.length > 0) {
        const totalLoanAmount = data.reduce((s, r) => s + (r.loanAmount || 0), 0);
        rows.push(['Grand Total', '', '', '', '', '', '', truncateReportAmount(totalLoanAmount), '', '', '']);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchAttendanceSummary({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Attendance Summary report');
    const data = await getAttendanceSummaryRows({ fromDate, toDate, branchIds });
    const headers = ['Branch Name', 'Employee Name', 'Present', 'Absent', 'Half Day', 'Full Day'];
    const rows = data.map((r) => [r.branchName, r.employeeName, r.present, r.absent, r.halfDay, r.fullDay]);
    return { headers, rows, totalCount: data.length };
}

async function fetchAttendanceDetailed({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Attendance Detailed report');
    const data = await getAttendanceDetailedRows({ fromDate, toDate, branchIds });
    const headers = ['Date', 'Branch', 'Employee', 'Status', 'Check-In', 'Check-Out'];
    const rows = data.map((r) => [
        toDisplayDate(new Date(r.attendanceDate)),
        r.branchName,
        r.employeeName,
        r.attendance,
        r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-IN') : '',
        r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-IN') : '',
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchDropouts({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Dropouts report');
    const data = await getDropoutsRows({ fromDate, toDate, branchIds, centerId: filters?.centerId ?? null });
    const headers = ['Center Id', 'Center Name', 'ID', 'Name', 'Member / Client', 'Joined Date', 'Last Loan Disbursed Date', 'Loan A/c', 'Last Loan Closed Date', 'Inactive Date', 'Reason', 'FDO Name', ...MEMBER_CONTACT_HEADERS];
    const rows = data.map((r) => [
        r.centerId, r.centerName, r.clientId, r.clientName, getPersonLabel(r.hasLoan).singular,
        r.joinedDate ? toDisplayDate(new Date(r.joinedDate)) : '',
        r.lastLoanDisbursedDate ? toDisplayDate(new Date(r.lastLoanDisbursedDate)) : '',
        r.loanAc,
        r.lastLoanClosedDate ? toDisplayDate(new Date(r.lastLoanClosedDate)) : '',
        r.inactiveDate ? toDisplayDate(new Date(r.inactiveDate)) : '',
        r.reason, r.fdoName,
        ...memberContactValues(r),
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchDoubleClients({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const data = await getDoubleClientsRows({ branchIds, centerId: filters?.centerId ?? null, idType: filters?.idType ?? null });
    const headers = ['Sl No', 'Name', 'Member / Client', 'Smart Card No', 'PAN No', 'Voter ID No', 'Mobile No', 'Loan A/c No', 'Disbursal Date', 'Loan Balance', 'Match Field Value', ...MEMBER_CONTACT_HEADERS];
    const rows = data.map((r) => [
        r.slNo, r.clientName, getPersonLabel(r.hasLoan).singular, r.smartCardNo, r.pancardNo, r.votersIdNo, r.mobileNo,
        r.loanAcNo, r.disbursalDate ? toDisplayDate(new Date(r.disbursalDate)) : '', truncateReportAmount(r.loanBalance), r.matchValue ?? '',
        ...memberContactValues(r),
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchBalanceInformation({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const centerId = filters?.centerId;
    if (!centerId) throw new Error('centerId is required for the Balance Information report');
    if (!fromDate) throw new Error('An As-On date is required for the Balance Information report');

    // Simplified branch-scope check: the finer FDO-owns-this-center / AM-assigned-to-branch
    // authorization enforced by the live report page's route isn't available here (the worker
    // has no per-user identity) — POST /api/report-requests already clamps `branchIds` to what
    // the requester is permitted to see, so this verifies the requested center's branch falls
    // within that already-scoped set, the same branch-level guarantee every other report here relies on.
    if (branchIds) {
        const center = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
        if (!center || !branchIds.includes(center.branchId)) {
            throw new Error('You do not have access to this center');
        }
    }

    const data = await getBalanceInformationRows({ centerId, asOnDate: fromDate });
    const headers = ['Sl No', 'Branch', 'Center', 'FDO', 'Meeting Day', 'Client', 'Account ID', 'OS Principle', 'OS Interest', 'Arrear Pri', 'Arrear Int', 'Mobile', ...MEMBER_CONTACT_HEADERS];
    const rows = data.map((r, i) => [i + 1, r.branchName, r.centerName, r.fdo, r.meetingDay, r.clientName, r.accountId, truncateReportAmount(r.osPrinciple), truncateReportAmount(r.osInterest), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), r.mobile, ...memberContactValues(r)]);
    return { headers, rows, totalCount: data.length };
}

/** Mirrors the per-branch fan-out already used by app/api/reports/client/transfer/route.ts. */
async function fetchTransfer({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Client Transfer report');
    const centerId = filters?.centerId;
    const data = !branchIds
        ? await getClientTransferData(fromDate, toDate, centerId, undefined)
        : branchIds.length <= 1
            ? await getClientTransferData(fromDate, toDate, centerId, branchIds[0])
            : (await Promise.all(branchIds.map((bId) => getClientTransferData(fromDate, toDate, centerId, bId)))).flat();

    const headers = ['Client Name', 'Old Client ID', 'New Client ID', 'Old Center', 'New Center', 'From Date', 'Transfer Date', 'Performed By', 'Remarks'];
    const rows = data.map((r) => [r.clientName, r.oldClientId, r.newClientId, r.oldCenterName, r.newCenterName, r.fromDate, r.tillDate, r.performedBy, r.remarks]);
    return { headers, rows, totalCount: data.length };
}

/**
 * getCCRData/getGoldTakenReport/getGoldReturnedReport are paginated (server-side
 * page/pageSize, capped at 5,000 rows/page) — the worker wants the full filtered
 * set in one go, so this drives the same paginated function to completion and
 * concatenates every page instead of re-implementing an unpaginated variant.
 */
async function fetchAllPages<T>(fn: (page: number, pageSize: number) => Promise<{ rows: T[]; totalCount: number; totalPages: number }>): Promise<T[]> {
    const pageSize = 5000;
    const first = await fn(1, pageSize);
    const all = [...first.rows];
    for (let page = 2; page <= first.totalPages; page++) {
        const next = await fn(page, pageSize);
        all.push(...next.rows);
    }
    return all;
}

async function buildCcrExportRows(data: CCRRow[], refNoLabel: string): Promise<ReportRows> {
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const headers = [
        'Trans Date', 'Center Name', 'Client Name', 'Loan Amt', 'Loan A/c',
        'Opn Arr Pri', 'Opn Arr Int', 'Cur Dmd Pri', 'Cur Dmd Int',
        'Tot Dmd Pri', 'Tot Dmd Int', 'Tot Pri Coll', 'Tot Int Coll',
        ...(loanAdvanceEnabled ? ['Loan Advance'] : []),
        'Done At', 'Coll Type', 'Trans Type', refNoLabel, 'Emp Name',
        ...MEMBER_CONTACT_HEADERS,
    ];
    const rows: (string | number)[][] = data.map((row) => [
        row.transDate, row.centerName, row.clientName, truncateReportAmount(row.loanAmt), row.loanAc,
        truncateReportAmount(row.opnArrPri), truncateReportAmount(row.opnArrInt), truncateReportAmount(row.curDmdPri), truncateReportAmount(row.curDmdInt),
        truncateReportAmount(row.totDmdPri), truncateReportAmount(row.totDmdInt), truncateReportAmount(row.totPriColl), truncateReportAmount(row.totIntColl),
        ...(loanAdvanceEnabled ? [truncateReportAmount(row.savingsAmt)] : []),
        row.doneAt, row.collType, row.transType, row.refNo, row.empName,
        ...memberContactValues(row),
    ]);
    return { headers, rows, totalCount: data.length };
}

/** Client Collection Report — reuses the same getCCRData Server Action as the live CCR page. */
async function fetchCcr({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Client Collection Report');
    const centerId = filters?.centerId ?? 'all';
    const data = await fetchAllPages((page, pageSize) => getCCRData(centerId, fromDate, toDate, undefined, page, pageSize, branchIds, filters?.search));
    return await buildCcrExportRows(data, 'Ref No');
}

/** Meeting Collection Report — same underlying data/action as CCR, different report identity + a header label. */
async function fetchMcr({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Meeting Collection Report');
    const centerId = filters?.centerId ?? 'all';
    const data = await fetchAllPages((page, pageSize) => getCCRData(centerId, fromDate, toDate, undefined, page, pageSize, branchIds, filters?.search));
    return await buildCcrExportRows(data, 'Reference No');
}

async function fetchGoldTaken({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Gold Taken Report');
    const centerId = filters?.centerId;
    // Not routed through fetchAllPages() (shared with CCR/MCR) because that helper discards
    // each page's `.totals` — captured here from the first page instead (getGoldTakenReport
    // computes `.totals` over the whole filtered/unpaginated set regardless of page, same
    // authoritative source GoldReportPage's own Direct export uses). `branchIds` is passed
    // through as-is (never `?? undefined`) — preResolvedBranchIds must be explicit even when
    // null ("all branches"), or getGoldTakenReport falls back to a cookie-based auth lookup
    // that throws outside a request context.
    const pageSize = 5000;
    const first = await getGoldTakenReport(fromDate, toDate, undefined, centerId, 1, pageSize, branchIds);
    const data = [...first.rows];
    for (let page = 2; page <= first.totalPages; page++) {
        const next = await getGoldTakenReport(fromDate, toDate, undefined, centerId, page, pageSize, branchIds);
        data.push(...next.rows);
    }
    // Item/Reference No./Remark mirror GoldReportPage's buildGoldTakenExportRows() — these
    // three fields are already present on GoldTakenRow (itemDescription/goldTokenNo/remarks,
    // already Prisma-selected inside getGoldTakenReport's goldLoanDetail.select), so they're
    // mapped here directly rather than requiring a new query.
    const headers = ['Loan No', 'Client Name', 'Client ID', 'Center', 'Branch', 'Karat', 'Grams', 'Gold Value', 'Cash Given', 'Price/g', 'Disbursement Date', 'Item', 'Reference No.', 'Remark', ...MEMBER_CONTACT_HEADERS];
    const rows: (string | number)[][] = data.map((r) => [
        r.loanNumber, r.clientName, r.clientId, r.centerName, r.branchName, r.karatType,
        Number(r.gramCount.toFixed(3)), truncateReportAmount(r.goldTakenValue), truncateReportAmount(r.cashGiven), truncateReportAmount(r.pricePerGram), r.disbursementDate,
        r.itemDescription, r.goldTokenNo, r.remarks,
        ...memberContactValues(r),
    ]);
    if (data.length > 0) {
        rows.push(['', 'Total', '', '', '', '', Number(first.totals.gramCount.toFixed(3)), truncateReportAmount(first.totals.goldTakenValue), truncateReportAmount(first.totals.cashGiven), '', '', '', '', '']);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchGoldReturned({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Gold Returned Report');
    const centerId = filters?.centerId;
    // See fetchGoldTaken's comment above — same reasoning applies here (not using
    // fetchAllPages so `.totals` from the first page can be captured; branchIds passed
    // through as-is, never `?? undefined`).
    const pageSize = 5000;
    const first = await getGoldReturnedReport(fromDate, toDate, undefined, centerId, 1, pageSize, branchIds);
    const data = [...first.rows];
    for (let page = 2; page <= first.totalPages; page++) {
        const next = await getGoldReturnedReport(fromDate, toDate, undefined, centerId, page, pageSize, branchIds);
        data.push(...next.rows);
    }
    // Item/Reference No./Remark mirror GoldReportPage's buildGoldReturnedExportRows() — these
    // three fields are already present on GoldReturnedRow (itemDescription/goldTokenNo/remarks,
    // already Prisma-selected inside getGoldReturnedReport's goldLoanDetail select), so they're
    // mapped here directly rather than requiring a new query.
    const headers = [
        'S.No', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
        'Product Type', 'Loan Product', 'Loan ID', 'Member ID', 'Member Name',
        'Aadhaar Number', 'Phone Number', 'Loan Cycle', 'FDO Name',
        'Purpose Of Loan', 'Loan Index ID', 'LD Date', 'LD Time',
        'Start Date', 'End Date', 'Loan Principal', 'Loan Interest',
        'Loan Total Amount', 'Gold Weight (g)', 'Gold Value on Disbursement',
        'Funding Name', 'Loan Status', 'Loan Approve', 'Return Date', 'Hand Over To',
        'Item', 'Reference No.', 'Remark',
        // Aadhaar / member phone already appear above (Aadhaar Number / Phone Number).
        CO_APPLICANT_MOBILE_HEADER,
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.sNo, r.branchId, r.branchName, r.centreId, r.centerName,
        r.productType, r.loanProduct, r.loanId, r.memberId, r.memberName,
        r.aadhaarNumber, r.phoneNumber, r.loanCycle, r.fdoName,
        r.purposeOfLoan, r.loanIndexId, r.ldDate, r.ldTime,
        r.startDate, r.endDate, truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest),
        truncateReportAmount(r.loanTotalAmount), r.goldWeight, truncateReportAmount(r.goldValueOnDisbursement),
        r.fundingName, r.loanStatus, r.loanApprove, r.returnDate, r.handOverTo,
        r.itemDescription, r.goldTokenNo, r.remarks,
        r.coApplicantMobile || '-',
    ]);
    if (data.length > 0) {
        rows.push([
            `TOTAL (${data.length} records)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            truncateReportAmount(first.totals.loanPrincipal), truncateReportAmount(first.totals.loanInterest), truncateReportAmount(first.totals.loanTotalAmount),
            Number(first.totals.goldWeight.toFixed(3)), truncateReportAmount(first.totals.goldValueOnDisbursement),
            '', '', '', '', '', '', '', '',
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchPreclosure({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Preclosure report');
    const data = await getPreclosureRows({ fromDate, toDate, branchIds, centerId: filters?.centerId ?? null });
    const headers = ['Preclose Date', 'Branch Name', 'Center Name', 'Client Name', 'Loan A/c', 'Arrear Pri', 'Arrear Int', 'Curr Dmd Pri', 'Curr Dmd Int', 'Preclosure Pri', 'Preclosure Int', 'Total Amount', ...MEMBER_CONTACT_HEADERS];
    const rows: (string | number)[][] = data.map((r) => [
        r.precloseDate, r.branchName, r.centerName, r.clientName, r.loanAccount,
        truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.currDmdPri), truncateReportAmount(r.currDmdInt),
        truncateReportAmount(r.preclosurePri), truncateReportAmount(r.preclosureInt), truncateReportAmount(r.totalAmount),
        ...memberContactValues(r),
    ]);
    // Mirrors PreclosureClient's calculateSummary() — a plain reduce over the same
    // already-fetched `data`.
    if (data.length > 0) {
        const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
        rows.push([
            'Grand Total:', '', '', '', '',
            truncateReportAmount(sum((r) => r.arrearPri)), truncateReportAmount(sum((r) => r.arrearInt)), truncateReportAmount(sum((r) => r.currDmdPri)), truncateReportAmount(sum((r) => r.currDmdInt)),
            truncateReportAmount(sum((r) => r.preclosurePri)), truncateReportAmount(sum((r) => r.preclosureInt)), truncateReportAmount(sum((r) => r.totalAmount)),
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchLoanOsDetails({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Loan OS Details report');
    const data = await getLoanOSDetailsData(fromDate, branchIds ?? undefined, filters?.centerId);
    const headers = [
        'Branch Name', 'Center Name', 'Account ID', 'Client Name', 'Loan A/c', 'Disbursal Date',
        'Due Start Date', 'Maturity Date', 'Status', 'Loan Amount', 'Interest Amount', 'OS Principle',
        'OS Interest', 'Arrear Pri', 'Arrear Int', 'Total Dues', 'Completed Dues', 'Collected Dues',
        'Due Pri', 'Due Int', 'DPD', 'Ageing', 'Mobile', 'FDO Name', 'Meeting Day', 'Disbural Type',
        ...MEMBER_CONTACT_HEADERS,
    ];
    const rows: (string | number)[][] = data.map((item) => [
        item.branchName, item.centerName, item.accountId, item.clientName, item.loanAccount, item.disbursalDate,
        item.dueStartDate, item.maturityDate, item.status, truncateReportAmount(item.loanAmount), truncateReportAmount(item.interestAmount), truncateReportAmount(item.osPrinciple),
        truncateReportAmount(item.osInterest), truncateReportAmount(item.arrearPri), truncateReportAmount(item.arrearInt), truncateReportAmount(item.totalDues), truncateReportAmount(item.completedDues), truncateReportAmount(item.collectedDues),
        truncateReportAmount(item.duePri), truncateReportAmount(item.dueInt), item.dpd, item.ageing, item.mobile, item.fdoName, item.meetingDay, item.disbursalType,
        ...memberContactValues(item),
    ]);
    // Mirrors LoanOSDetailsClient's "Grand Total:" row — a plain reduce over the same
    // already-fetched `data`.
    if (data.length > 0) {
        const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
        rows.push([
            'Grand Total:', '', '', '', '', '', '', '', '',
            truncateReportAmount(sum((r) => r.loanAmount)), truncateReportAmount(sum((r) => r.interestAmount)), truncateReportAmount(sum((r) => r.osPrinciple)), truncateReportAmount(sum((r) => r.osInterest)),
            truncateReportAmount(sum((r) => r.arrearPri)), truncateReportAmount(sum((r) => r.arrearInt)), '', '', '',
            truncateReportAmount(sum((r) => r.duePri)), truncateReportAmount(sum((r) => r.dueInt)), '', '', '', '', '', '',
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

function zeroDcrBreakdown() {
    return {
        principal: 0, interest: 0, preclosurePrincipal: 0, preclosureInterest: 0,
        writeOffCashPrincipal: 0, writeOffCashInterest: 0, writeOffGoldPrincipal: 0, writeOffGoldInterest: 0,
        totalPrincipal: 0, totalInterest: 0,
    };
}

/** Daily Collection Report — funder columns are dynamic (only funders with activity that day), mirrored from DCRClient's buildDCRExportRows.
 *  Each funder's Principal/Interest include preclosure and all loan closures (write-offs), cash and gold alike — gold is a loan-type flag, not a separate column. */
async function fetchDcr({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Daily Collection Report');
    const centerId = filters?.centerId ?? 'all';
    const { rows: data, funders } = await getDCRData(fromDate, undefined, centerId, branchIds);
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();

    const headers = [
        'Center ID', 'Center Name',
        'Admin Fees', 'Doc. Charges', 'Ins. Fees',
        ...funders.flatMap((f) => [`${f.name} - Principal`, `${f.name} - Interest`]),
        'Total Principal', 'Total Interest',
        ...(loanAdvanceEnabled ? ['Loan Advance'] : []), 'Total Amount',
    ];
    const rows: (string | number)[][] = data.map((r) => {
        const funderRows = funders.map((f) => r.funderBreakdown[f.id] ?? zeroDcrBreakdown());
        const overallPrincipal = funderRows.reduce((s, b) => s + b.totalPrincipal, 0);
        const overallInterest = funderRows.reduce((s, b) => s + b.totalInterest, 0);
        return [
            r.centerCode, r.centerName,
            truncateReportAmount(r.adminFees), truncateReportAmount(r.docCharges), truncateReportAmount(r.insFees),
            ...funderRows.flatMap((b) => [truncateReportAmount(b.totalPrincipal), truncateReportAmount(b.totalInterest)]),
            truncateReportAmount(overallPrincipal), truncateReportAmount(overallInterest),
            ...(loanAdvanceEnabled ? [truncateReportAmount(r.savings)] : []), truncateReportAmount(r.totalAmount),
        ];
    });
    // Mirrors DCRClient's buildDCRExportRows() "Grand Total" row (shared by its own
    // CSV/Excel/Word exports) — a plain reduce over the same already-fetched `data`/`funders`.
    if (data.length > 0) {
        const sum = (key: 'adminFees' | 'docCharges' | 'insFees' | 'savings' | 'totalAmount') => data.reduce((s, r) => s + (r[key] as number), 0);
        const sumFunderField = (funderId: string, field: 'totalPrincipal' | 'totalInterest' | 'writeOffGoldPrincipal' | 'writeOffGoldInterest') =>
            data.reduce((s, r) => s + (r.funderBreakdown[funderId]?.[field] ?? 0), 0);
        const grandOverallPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalPrincipal'), 0);
        const grandOverallInterest = funders.reduce((s, f) => s + sumFunderField(f.id, 'totalInterest'), 0);
        const grandOverallGoldPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, 'writeOffGoldPrincipal'), 0);
        const grandOverallGoldInterest = funders.reduce((s, f) => s + sumFunderField(f.id, 'writeOffGoldInterest'), 0);
        rows.push([
            'Grand Total', '',
            truncateReportAmount(sum('adminFees')), truncateReportAmount(sum('docCharges')), truncateReportAmount(sum('insFees')),
            ...funders.flatMap((f) => [
                truncateReportAmount(sumFunderField(f.id, 'totalPrincipal')), truncateReportAmount(sumFunderField(f.id, 'totalInterest')),
                truncateReportAmount(sumFunderField(f.id, 'writeOffGoldPrincipal')), truncateReportAmount(sumFunderField(f.id, 'writeOffGoldInterest')),
            ]),
            truncateReportAmount(grandOverallPrincipal), truncateReportAmount(grandOverallInterest), truncateReportAmount(grandOverallGoldPrincipal), truncateReportAmount(grandOverallGoldInterest),
            ...(loanAdvanceEnabled ? [truncateReportAmount(sum('savings'))] : []), truncateReportAmount(sum('totalAmount')),
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

/** Demand Collection Balance Report — mirrors DCBClient's buildDCBExportRows. */
async function fetchDcb({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Demand Collection Balance report');
    const data = await getDCBData(fromDate, toDate, undefined, filters?.centerId, branchIds);

    const headers = [
        'Branch ID', 'Branch Name', 'Date', 'Center ID', 'Center Name', 'FDO Name',
        'Opening Arr (P)', 'Opening Arr (I)', 'Opening Arr (Total)',
        'Curr Demand (P)', 'Curr Demand (I)', 'Curr Demand (Total)',
        'Total Demand (P)', 'Total Demand (I)', 'Total Demand (Total)',
        'Arrear Coll (P)', 'Arrear Coll (I)',
        'Curr Demand Coll (P)', 'Curr Demand Coll (I)',
        'Advance Coll (P)', 'Advance Coll (I)',
        'Preclosure (P)', 'Preclosure (I)',
        'OD Arrear Coll (P)', 'OD Arrear Coll (I)',
        'Total Coll (P)', 'Total Coll (I)',
        'Curr Arrear (P)', 'Curr Arrear (I)',
        'Closing Arr (P)', 'Closing Arr (I)',
        'RR %',
    ];
    const rows: (string | number)[][] = data.map((row: DCBRow) => [
        row.branchCode, row.branchName, row.meetingDate, row.centerCode, row.centerName, row.fdoName,
        truncateReportAmount(row.openingArrPrincipal), truncateReportAmount(row.openingArrInterest), truncateReportAmount(row.openingArr),
        truncateReportAmount(row.demandPrincipal), truncateReportAmount(row.demandInterest), truncateReportAmount(row.demand),
        truncateReportAmount(row.openingArrPrincipal + row.demandPrincipal), truncateReportAmount(row.openingArrInterest + row.demandInterest), truncateReportAmount(row.openingArr + row.demand),
        truncateReportAmount(row.arrearCollPrincipal), truncateReportAmount(row.arrearCollInterest),
        truncateReportAmount(row.currDemandCollPrincipal), truncateReportAmount(row.currDemandCollInterest),
        truncateReportAmount(row.advanceCollPrincipal), truncateReportAmount(row.advanceCollInterest),
        truncateReportAmount(row.preclosurePrincipal), truncateReportAmount(row.preclosureInterest),
        truncateReportAmount(row.odArrearCollPrincipal), truncateReportAmount(row.odArrearCollInterest),
        truncateReportAmount(row.totalCollPrincipal), truncateReportAmount(row.totalCollInterest),
        truncateReportAmount(row.currArrearPrincipal + row.todayPendingPrincipal), truncateReportAmount(row.currArrearInterest + row.todayPendingInterest),
        truncateReportAmount(row.closingArrPrincipal), truncateReportAmount(row.closingArrInterest),
        Number(row.recPercentage.toFixed(2)),
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchCenterMaster({ fromDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Center Master report');
    const data = await getCenterMasterRows({ reportDate: fromDate, branchIds });
    const headers = [
        'Sl No', 'Branch ID', 'Center ID', 'Center Name', 'Employee Name', 'Meeting Day',
        'Meeting Time', 'KM From Branch', 'Contact Person', 'Contact Person No.', 'Clients',
        'Waiting Borrowers', 'Portfolio', 'Arrear', 'Advance', 'Adv Adjustment', 'Preclosure',
    ];
    const rows = data.map((row, index) => [
        index + 1, row.branchId, row.centerId, row.centerName, row.employeeName, row.meetingDay,
        row.meetingTime, row.kmFromBranch ?? '', row.contactPerson, row.contactPersonNumber, row.clients,
        row.waitingBorrowers, truncateReportAmount(row.portfolio), truncateReportAmount(row.arrear), truncateReportAmount(row.advance), truncateReportAmount(row.advAdjustment), truncateReportAmount(row.preclosure),
    ]);
    return { headers, rows, totalCount: data.length };
}

/** `filters.reportType` selects DETAILED vs SUMMARY — same two-shape pattern as double-clients' idType. */
async function fetchWaitingBorrowers({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const centerId = filters?.centerId ?? null;
    if ((filters?.reportType ?? 'DETAILED') === 'SUMMARY') {
        const data = await getWaitingBorrowersSummaryRows({ branchIds, centerId });
        const headers = ['Branch', 'Center', 'New/No OS', '4-Week Overdue', '4-Week OS', '10-Week Overdue', '10-Week OS', 'Total Defaults', 'Total OS'];
        const rows: (string | number)[][] = data.map((item) => [
            item.branchName, item.center, item.noOsNewClient, item.client4Weeks, truncateReportAmount(item.os4Weeks),
            item.client10Weeks, truncateReportAmount(item.os10Weeks), item.defaultClients, truncateReportAmount(item.osAmount),
        ]);
        // Mirrors WaitingBorrowersClient's "Grand Total:" row — a plain reduce over `data`.
        if (data.length > 0) {
            const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
            rows.push([
                'Grand Total:', '', sum((r) => r.noOsNewClient), sum((r) => r.client4Weeks), truncateReportAmount(sum((r) => r.os4Weeks)),
                sum((r) => r.client10Weeks), truncateReportAmount(sum((r) => r.os10Weeks)), sum((r) => r.defaultClients), truncateReportAmount(sum((r) => r.osAmount)),
            ]);
        }
        return { headers, rows, totalCount: data.length };
    }
    const data = await getWaitingBorrowersDetailedRows({ branchIds, centerId });
    const headers = ['Branch', 'Center', 'Account ID', 'Name', 'Member / Client', 'Phone', 'Joining Date', 'Disbursal', 'Balance', 'Arrear Type', ...MEMBER_CONTACT_HEADERS];
    const rows: (string | number)[][] = data.map((item) => [
        item.branch, item.center, item.accountId, item.clientName,
        getPersonLabel(item.hasLoan).singular, item.phone,
        toDisplayDate(new Date(item.dateOfJoining)), item.disbursalDate,
        truncateReportAmount(item.principleBalance), item.arrearType,
        ...memberContactValues(item),
    ]);
    // Mirrors WaitingBorrowersClient's "Grand Total:" row — a plain reduce over `data`.
    if (data.length > 0) {
        const totalBalance = data.reduce((s, r) => s + (r.principleBalance || 0), 0);
        rows.push(['Grand Total:', '', '', '', '', '', '', '', truncateReportAmount(totalBalance), '']);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchMeetingCheck({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Daily Meeting Check report');
    const { data } = await getMeetingCheckRows({ reportDate: fromDate, branchIds, centerId: filters?.centerId ?? null });
    const headers = ['Center Code', 'Center Name', 'FDO Name', 'Meeting Time', 'Clients', 'Status', 'Expected Collection', 'Actual Collection', 'Variance'];
    const rows = data.map((row) => [
        row.centerCode, row.centerName, row.fdoName, row.meetingTime,
        row.clientCount, row.meetingStatus, truncateReportAmount(row.expectedCollection), truncateReportAmount(row.actualCollection), truncateReportAmount(row.collectionVariance),
    ]);
    return { headers, rows, totalCount: data.length };
}

/** ₹200 notes are tracked by the underlying module but not shown on the live report page — mirrored here to match what the page actually displays. */
async function fetchDenominationCollection({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Denomination Collection report');
    const report = await getDenominationCollectionReport({
        fromDateYmd: fromDate,
        toDateYmd: toDate,
        branchIdParam: null,
        user: { userId: 'system', role: 'SYSTEM' },
        preResolvedBranchIds: branchIds,
    });
    const headers = ['Date', '₹500', '₹100', '₹50', '₹20', '₹10', 'Coins', 'Total'];
    const rows = report.dailyBreakdown.map((r) => [
        r.date, truncateReportAmount(r['500']), truncateReportAmount(r['100']), truncateReportAmount(r['50']), truncateReportAmount(r['20']), truncateReportAmount(r['10']), truncateReportAmount(r.coins), truncateReportAmount(r.total),
    ]);
    return { headers, rows, totalCount: report.dailyBreakdown.length };
}

/** `filters.reportType` selects OFFICERWISE / CENTERWISE / CLIENTWISE — mirrors FutureDemandClient's fetchFutureDemandExportRows. */
async function fetchFutureDemand({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Future Demand report');
    const reportType = (filters?.reportType as 'OFFICERWISE' | 'CENTERWISE' | 'CLIENTWISE') || 'OFFICERWISE';
    const result = await getFutureDemandData({
        fromDate,
        toDate,
        reportType,
        page: 1,
        pageSize: 1_000_000,
        branchId: branchIds ?? undefined,
        centerId: filters?.centerId,
        search: filters?.search ?? null,
    });

    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    let headers: string[];
    if (reportType === 'CENTERWISE') headers = ['Demand Date', 'Demand Day', 'Center Name', 'No. of Clients', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand'];
    else if (reportType === 'CLIENTWISE') headers = ['Demand Date', 'Demand Day', 'Client Name', 'Center Name', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand', ...MEMBER_CONTACT_HEADERS];
    else headers = ['Demand Date', 'Demand Day', 'FDO', 'No. of Centers', 'No. of Clients', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand'];

    const rows: (string | number)[][] = result.data.map((row) => {
        const rowData: (string | number)[] = [row.demandDate, row.demandDay];
        if (reportType === 'CENTERWISE') {
            rowData.push(row.centerName ?? '', row.noOfClients ?? '');
        } else if (reportType === 'CLIENTWISE') {
            rowData.push(row.clientName ?? '', row.centerName ?? '');
        } else {
            rowData.push(row.fdo ?? '', row.noOfCenters ?? '', row.noOfClients ?? '');
        }
        rowData.push(truncateReportAmount(row.demandPri), truncateReportAmount(row.demandInt));
        if (loanAdvanceEnabled) rowData.push(truncateReportAmount(row.demandSavings || 0));
        rowData.push(truncateReportAmount(row.totalDemand));
        if (reportType === 'CLIENTWISE') rowData.push(...memberContactValues(row));
        return rowData;
    });
    // getFutureDemandData already computes `totals` server-side (same authoritative
    // source FutureDemandClient's own export uses) — mirrors fetchFutureDemandExportRows'
    // totalsRow construction exactly, reusing it rather than re-summing `rows`.
    if (result.totals) {
        const totalsRow: (string | number)[] = ['TOTAL', ''];
        if (reportType === 'OFFICERWISE') totalsRow.push('', result.totals.noOfCenters, result.totals.noOfClients);
        else if (reportType === 'CENTERWISE') totalsRow.push('', result.totals.noOfClients);
        else totalsRow.push('', '');
        totalsRow.push(truncateReportAmount(result.totals.demandPri), truncateReportAmount(result.totals.demandInt));
        if (loanAdvanceEnabled) totalsRow.push(truncateReportAmount(result.totals.demandSavings || 0));
        totalsRow.push(truncateReportAmount(result.totals.totalDemand));
        rows.push(totalsRow);
    }
    return { headers, rows, totalCount: result.data.length };
}

function formatFutureReportDate(dateStr: string): string {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

/** Mirrors FutureReportClient's fetchFutureReportExportRows exactly. */
async function fetchFutureReport({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Future Report');
    const result = await getFutureReportRows({
        fromDate, toDate, branchIds, centerId: filters?.centerId, page: 1, pageSize: 1_000_000, search: filters?.search ?? null,
    });
    const headers = [
        'S.No', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
        'FDO Name', 'Loan ID', 'Member Unique ID', 'Member Name', 'Member Phone',
        'Member Aadhar', 'Meetup Time', 'Disbursement Date', '1st EMI Date',
        'Loan Maturity Date', 'Loan Amount', 'Outstanding Principal', 'Outstanding Interest',
        'Outstanding Total Amount', 'Due Date', 'Due No', 'Due Principal',
        'Due Interest', 'Total Due Amount', 'Funder Name',
        // Aadhaar / member phone already appear above (Member Aadhar / Member Phone).
        CO_APPLICANT_MOBILE_HEADER,
    ];
    const rows: (string | number)[][] = result.data.map((r) => [
        r.sNo, r.branchId, r.branchName, r.centreId, r.centerName, r.fdoName, r.loanId,
        r.memberUniqueId, r.memberName, r.memberPhone, r.memberAadhar, r.meetupTime,
        formatFutureReportDate(r.disbursementDate), formatFutureReportDate(r.firstEmiDate), formatFutureReportDate(r.loanMaturityDate),
        truncateReportAmount(r.loanAmount), truncateReportAmount(r.outstandingPrincipal), truncateReportAmount(r.outstandingInterest), truncateReportAmount(r.outstandingTotal),
        formatFutureReportDate(r.dueDate), r.dueNo, truncateReportAmount(r.duePrincipal), truncateReportAmount(r.dueInterest), truncateReportAmount(r.totalDueAmount), r.funderName,
        r.coApplicantMobile || '-',
    ]);
    // getFutureReportRows already computes `totals` server-side (same authoritative source
    // FutureReportClient's own export uses) — mirrors fetchFutureReportExportRows' TOTAL
    // row construction exactly, reusing it rather than re-summing `rows`.
    if (result.totals) {
        const t = result.totals;
        rows.push([
            'TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            truncateReportAmount(t.loanAmount), truncateReportAmount(t.outstandingPrincipal), truncateReportAmount(t.outstandingInterest), truncateReportAmount(t.outstandingTotal),
            '', '', truncateReportAmount(t.duePrincipal), truncateReportAmount(t.dueInterest), truncateReportAmount(t.totalDueAmount), '',
        ]);
    }
    return { headers, rows, totalCount: result.data.length };
}

async function fetchFdoPerformance({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the FDO Performance report');
    const data = await getFdoPerformanceRows({ fromDate, toDate, branchIds });
    const headers = ['SINO', 'BRANCH', 'FDO', 'TOTAL_CENTERS', 'TOTAL_MEMBERS', 'ACTIVE', 'WB', 'NEW_MEMBERS', 'DROPPED',
        'DISBURSED_COUNT', 'TOTAL_DISBURSED_AMT', 'TOTAL_COLL', 'TOTAL_DEMAND', 'TOTAL_COLLECTED', 'TOTAL_ARREARS',
        'LOAN_OS', 'OVERDUE_COUNT', 'PAID_COUNT', 'CLOSED_LOANS', 'ACTIVE_LOANS'];
    const rows: (string | number)[][] = data.map((r) => [
        r.sino, r.branch, r.fdo, r.totalCenters, r.totalMembers, r.active, r.wb, r.newMembers, r.dropped,
        r.disbursedCount, truncateReportAmount(r.totalDisbursedAmt), truncateReportAmount(r.totalColl), truncateReportAmount(r.totalDemand), truncateReportAmount(r.totalCollected), truncateReportAmount(r.totalArrears),
        truncateReportAmount(r.loanOs), r.overdueCount, r.paidCount, r.closedLoans, r.activeLoans,
    ]);
    // Mirrors FDOPerformanceClient's client-side `totals` useMemo (a plain reduce over the
    // same already-fetched `data` — getFdoPerformanceRows has no totals of its own).
    if (data.length > 0) {
        const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
        rows.push([
            '', '', 'TOTAL:', sum((r) => r.totalCenters), sum((r) => r.totalMembers), sum((r) => r.active), sum((r) => r.wb),
            sum((r) => r.newMembers), sum((r) => r.dropped), sum((r) => r.disbursedCount), truncateReportAmount(sum((r) => r.totalDisbursedAmt)),
            truncateReportAmount(sum((r) => r.totalColl)), truncateReportAmount(sum((r) => r.totalDemand)), truncateReportAmount(sum((r) => r.totalCollected)), truncateReportAmount(sum((r) => r.totalArrears)),
            truncateReportAmount(sum((r) => r.loanOs)), sum((r) => r.overdueCount), sum((r) => r.paidCount), sum((r) => r.closedLoans), sum((r) => r.activeLoans),
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

// ── Tier 1 (clean lift) ──────────────────────────────────────────────

const RECEIPT_MODE_LABEL: Record<string, string> = {
    CASH: 'Cash', BANK_TRANSFER: 'Bank Transfer', CHEQUE: 'Cheque', UPI: 'UPI', ADJUSTMENT: 'Adjustment',
};

async function fetchReceipts({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Receipts report');
    const startDate = new Date(fromDate); startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(toDate); endDate.setHours(23, 59, 59, 999);
    const baseWhere: any = { transactionDate: { gte: startDate, lte: endDate }, isReversed: false };
    if (branchIds) baseWhere.branchId = branchIds.length === 1 ? branchIds[0] : { in: branchIds };
    if (filters?.centerId) baseWhere.centerId = filters.centerId;
    if (filters?.officerId) baseWhere.collectedById = filters.officerId;
    const rowsWhere = { ...baseWhere, type: { in: ['REPAYMENT', 'PRECLOSURE'] } };
    const savingsWhere = { ...baseWhere, type: 'SAVINGS_COLLECTION' };

    const [transactions, savingsGroups, sumsAgg] = await Promise.all([
        prisma.loanTransaction.findMany({
            where: rowsWhere,
            include: {
                client: { select: { clientId: true, firstName: true, lastName: true } },
                center: { select: { code: true, name: true } },
                loan: { select: { loanNumber: true } },
                collectedBy: { select: { firstName: true, lastName: true } },
            },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        }),
        prisma.loanTransaction.groupBy({ by: ['batchId', 'loanId'], where: savingsWhere, _sum: { amount: true } }),
        prisma.loanTransaction.aggregate({
            where: rowsWhere,
            _sum: { principalAmount: true, interestAmount: true, currentDemandPrincipal: true, currentDemandInterest: true },
        }),
    ]);

    const savingsMap = new Map<string, number>();
    let totalSavings = 0;
    for (const g of savingsGroups) {
        const key = `${g.batchId || ''}:${g.loanId}`;
        const amt = Number(g._sum.amount || 0);
        savingsMap.set(key, (savingsMap.get(key) || 0) + amt);
        totalSavings += amt;
    }

    const headers = ['S.No', 'Center Name', 'Client Name', 'Account No', 'Loan A/c', 'Ref No', 'Receipt Date', 'Demand Pri', 'Demand Int', 'Coll. Pri', 'Coll. Int', 'Loan Advance', 'Total Collected', 'Mode', 'Collected By', 'Trans Type'];
    const rows: (string | number)[][] = transactions.map((tx, index) => {
        const principalCollected = Number(tx.principalAmount ?? 0);
        const interestCollected = Number(tx.interestAmount ?? 0);
        const savingsKey = `${tx.batchId || ''}:${tx.loanId}`;
        const collectedSavings = savingsMap.get(savingsKey) || 0;
        return [
            index + 1, tx.center ? `${tx.center.code} - ${tx.center.name}` : 'N/A', `${tx.client.firstName} ${tx.client.lastName}`, tx.client.clientId, tx.loan.loanNumber,
            tx.transactionId, toDisplayDate(new Date(tx.transactionDate)), truncateReportAmount((tx as any).currentDemandPrincipal ?? 0), truncateReportAmount((tx as any).currentDemandInterest ?? 0),
            truncateReportAmount(principalCollected), truncateReportAmount(interestCollected), truncateReportAmount(collectedSavings), truncateReportAmount(principalCollected + interestCollected + collectedSavings),
            RECEIPT_MODE_LABEL[tx.paymentMode] || tx.paymentMode, `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}`, tx.type,
        ];
    });
    rows.push([
        '', '', '', '', '', '', 'GRAND TOTAL',
        truncateReportAmount(Number(sumsAgg._sum.currentDemandPrincipal || 0)), truncateReportAmount(Number(sumsAgg._sum.currentDemandInterest || 0)),
        truncateReportAmount(Number(sumsAgg._sum.principalAmount || 0)), truncateReportAmount(Number(sumsAgg._sum.interestAmount || 0)), truncateReportAmount(totalSavings),
        truncateReportAmount(Number(sumsAgg._sum.principalAmount || 0) + Number(sumsAgg._sum.interestAmount || 0) + totalSavings), '', '', '',
    ]);
    return { headers, rows, totalCount: transactions.length };
}

async function fetchLoanSavings({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!(await getLoanAdvanceEnabled())) throw new Error('Loan Advance is disabled — this report is unavailable');
    const clientWhere: any = { isActive: true, loanAdvance: { gt: 0 } };
    if (branchIds) clientWhere.center = { branchId: branchIds.length === 1 ? branchIds[0] : { in: branchIds } };
    if (filters?.centerId) clientWhere.centerId = filters.centerId;

    const clients = await prisma.client.findMany({
        where: clientWhere,
        select: {
            clientId: true, firstName: true, lastName: true, phone: true, mobileNumber: true, otherIdNo: true, nomineeName: true, loanAdvance: true,
            center: { include: { branch: { include: { areas: { include: { division: { include: { region: true } } } } } }, fdo: true } },
        },
        orderBy: [{ center: { name: 'asc' } }, { firstName: 'asc' }],
    });

    const headers = ['S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'FDO Name', 'Member ID', 'Member Name', 'Nominee Name', 'Phone Number', 'Aadhaar Number', 'Loan Advance O/S'];
    let total = 0;
    const rows: (string | number)[][] = clients.map((c, i) => {
        const os = Number(c.loanAdvance ?? 0);
        total += os;
        return [
            i + 1, c.center?.branch?.areas?.[0]?.division?.region?.name ?? 'N/A', c.center?.branch?.areas?.[0]?.division?.name ?? 'N/A', c.center?.branch?.areas?.[0]?.name ?? 'N/A',
            c.center?.branch?.code ?? 'N/A', c.center?.branch?.name ?? 'N/A', c.center?.code ?? 'N/A', c.center?.name ?? 'N/A',
            c.center?.fdo ? `${c.center.fdo.firstName} ${c.center.fdo.lastName}`.trim() : 'N/A', c.clientId, `${c.firstName} ${c.lastName}`.trim(), c.nomineeName ?? '',
            c.phone || c.mobileNumber || 'N/A', c.otherIdNo || 'N/A', truncateReportAmount(os),
        ];
    });
    rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', truncateReportAmount(total)]);
    return { headers, rows, totalCount: clients.length };
}

const INSURANCE_COVER_TYPE_LABEL: Record<string, string> = { SINGLE_LIFE: 'Single Life', JOINT_LIFE: 'Joint Life' };
const INSURANCE_COVER_BASIS_LABEL: Record<string, string> = { LEVEL: 'Level', REDUCING: 'Reducing' };
const fmtInsCurrency = (n: number) => formatReportAmount(n);
const fmtInsDate = (d: string | Date) => toDisplayDate(new Date(d));
const insYesNo = (v: boolean) => (v ? 'Yes' : 'No');

async function fetchInsuranceReport({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const enriched = await queryInsuranceReportRows({ branchIds, status: filters?.status ?? null, search: filters?.search ?? null });

    const headers = [
        'Master Code', 'Agent code', 'Source', 'CAFOS Code', 'FSC/FSM code', 'Branch ID', 'Branch Name', 'Member Id', 'Loan ID', 'Member Name', 'Last Name', 'DOB', 'Salutation', 'Gender',
        'Address 1', 'Address 2', 'Address 3', 'Address 4', 'City', 'State', 'Country', 'Pincode', 'Loan Amount', 'Number Of Installments Per Month', 'Sum Assured', 'LD Date',
        'Type of Cover (Single Life / Joint Life)', 'Number Of Installments Per Month', 'Premium Amount', 'ADB SA', 'Accelerated TI Benefit', 'Type of cover (Level / Reducing)',
        'Nominee First Name', 'Nominee SurName', 'Nominee Gender', 'Nominee DOB', 'Nominee Relationship with LA', 'Occupation', 'Medical Questions YES/No', 'Member Consent to Split Payment',
        'Spouse/CoApplicant First Name', 'Spouse/CoApplicant Last Name', 'Spouse/CoApplicant DOB', 'Spouse/CoApplicant Gender', 'Spouse/CoApplicant Relationship with LA',
        'CoApplicant Hse/Flat', 'CoApplicant Street', 'CoApplicant Area', 'CoApplicant City', 'CoApplicant State', 'CoApplicant ZIPCODE', 'UTRN No.', 'Fund Transfer Date',
        'Appointee Name', 'Appointee SurName', 'Appointee Gender', 'Appointee DOB', 'Appointee Relationship with Nominee', 'Member Consent to Cover Continuation', 'Occupation',
        'Mobile No', 'COVID-19 tested/self-isolated (3mo)', 'COVID-19 advised isolation/symptoms (1mo)', 'Overseas travel post 1 Jan 2020 / next 6mo', 'Status',
    ];
    const rows: (string | number)[][] = enriched.map((r) => [
        r.masterCode, r.agentCode, r.source, r.cafosCode, r.fscFsmCode, r.branch?.code || '', r.branch?.name || '', r.client.clientId, r.loanNumber, r.client.firstName, r.client.lastName,
        r.client.dateOfBirth ? fmtInsDate(r.client.dateOfBirth) : '', r.salutation, r.client.gender || '', r.address1, r.address2, r.address3, r.address4, r.city, r.client.state || '',
        r.client.country || '', r.client.pincode || '', r.loanAmount != null ? fmtInsCurrency(r.loanAmount) : '', r.installmentsPerMonth ?? '', fmtInsCurrency(r.sumAssured),
        r.ldDate ? fmtInsDate(r.ldDate) : '', INSURANCE_COVER_TYPE_LABEL[r.coverType] || r.coverType, r.installmentsPerMonth ?? '', fmtInsCurrency(r.premiumAmount),
        r.adbSumAssured != null ? fmtInsCurrency(r.adbSumAssured) : '', r.acceleratedTiBenefit != null ? fmtInsCurrency(r.acceleratedTiBenefit) : '',
        INSURANCE_COVER_BASIS_LABEL[r.coverBasis] || r.coverBasis, r.nomineeFirstName, r.nomineeSurname, r.client.nomineeGender || '',
        r.client.nomineeDateOfBirth ? fmtInsDate(r.client.nomineeDateOfBirth) : '', r.nomineeRelationship || '', r.occupation, insYesNo(r.hasMedicalConditions), insYesNo(r.consentSplitPayment),
        r.coApplicantFirstName, r.coApplicantLastName, r.coApplicantDob ? fmtInsDate(r.coApplicantDob) : '', r.coApplicantGender, r.coApplicantRelation, r.coApplicantHouseFlat,
        r.coApplicantStreet, r.coApplicantArea, r.coApplicantCity, r.coApplicantState, r.coApplicantZip, r.utrnNumber || '', r.fundTransferDate ? fmtInsDate(r.fundTransferDate) : '',
        r.appointeeName || '', r.appointeeSurname || '', r.appointeeGender || '', r.appointeeDob ? fmtInsDate(r.appointeeDob) : '', r.appointeeRelationWithNominee || '',
        insYesNo(r.consentCoverContinuation), r.occupation, r.mobileNumber, insYesNo(r.covidTestedOrIsolated), insYesNo(r.covidAdvisedIsolationOrSymptoms), insYesNo(r.covidTravelOverseas),
        r.computedStatus,
    ]);
    return { headers, rows, totalCount: enriched.length };
}

async function fetchClosedLoanReport({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Closed Loan Report');
    const from = new Date(`${fromDate}T00:00:00+05:30`);
    const till = new Date(`${toDate}T23:59:59+05:30`);

    // Mirrors app/api/reports/client/closed-loan-report/route.ts's branchWhere/loanProductWhere construction.
    const branchWhere: any = {};
    if (branchIds) branchWhere.id = branchIds.length === 1 ? branchIds[0] : { in: branchIds };
    if (filters?.areaId) branchWhere.areas = { some: { id: filters.areaId } };
    else if (filters?.divisionId) branchWhere.areas = { some: { division: { id: filters.divisionId } } };
    else if (filters?.regionId) branchWhere.areas = { some: { division: { region: { id: filters.regionId } } } };

    const loanProductWhere: any = {};
    if (filters?.productTypeId) loanProductWhere.loanProductTypeId = filters.productTypeId;
    if (filters?.loanProductId) loanProductWhere.productId = filters.loanProductId;

    const where: any = {
        isActive: false,
        disbursementStatus: { in: ['DISBURSED', 'CLOSED'] },
        ...(filters?.centerId && { centerId: filters.centerId }),
        ...(filters?.funderId && { funderId: filters.funderId }),
        ...(Object.keys(loanProductWhere).length > 0 && { loanProduct: loanProductWhere }),
        ...(Object.keys(branchWhere).length > 0 && { center: { branch: branchWhere } }),
        AND: [{
            OR: [
                { closedDate: { gte: from, lte: till } },
                { transactions: { some: { type: 'PRECLOSURE', status: 'APPROVED', isReversed: false, transactionDate: { gte: from, lte: till } } } },
                { transactions: { some: { type: 'WRITEOFF', status: 'APPROVED', isReversed: false, transactionDate: { gte: from, lte: till } } } },
            ],
        }],
    };
    if (filters?.closureType === 'PRECLOSED') {
        where.AND.push({ transactions: { some: { type: 'PRECLOSURE', status: 'APPROVED', isReversed: false } } });
    } else if (filters?.closureType === 'WRITTEN_OFF') {
        where.AND.push({ transactions: { some: { type: 'WRITEOFF', status: 'APPROVED', isReversed: false } } });
    } else if (filters?.closureType === 'CLOSED') {
        where.AND.push({ NOT: { transactions: { some: { type: { in: ['PRECLOSURE', 'WRITEOFF'] }, status: 'APPROVED', isReversed: false } } } });
    }

    const loans = await queryClosedLoans(where, undefined, 5000);
    const data = loans.map((loan, i) => buildClosedLoanRow(loan, i + 1));
    const fmt = (d: Date | string | null) => (d ? toDisplayDate(new Date(d)) : '');
    const headers = [
        'S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name', 'Center ID', 'Center Name', 'FDO Name', 'Loan ID', 'Loan Type', 'Member ID', 'Member Name',
        'Reason', 'Funding Name', 'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date', 'PreClose Date', 'Close Date', 'Last EMI Date', 'Total Tenure',
        'OS Principal Before Close', 'OS Interest Before Close', 'Close Loan Waiver Interest', 'Loan Amount', 'Amount Outstanding', 'Interest', 'WriteOff Principal', 'WriteOff Interest',
        'Principal Waiver', 'Interest Waiver', 'Penalty Amount', 'Penalty Paid', 'Interest %', 'Next Inst No', 'Is Dead', 'Deceased Person Type', 'Deceased Person Name',
        'Death Certificate', 'HO Approval Document',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.sNo, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName, r.centerId, r.centerName, r.fdoName, r.loanId, r.loanType, r.memberId, r.memberName,
        r.reason, r.fundingName, fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate), fmt(r.preCloseDate), fmt(r.closeDate), fmt(r.lastEmiDate), r.totalTenure,
        truncateReportAmount(r.osPrincipalBeforeClose), truncateReportAmount(r.osInterestBeforeClose), truncateReportAmount(r.closeLoanWaiverInterest), truncateReportAmount(r.loanAmount), truncateReportAmount(r.amountOutstanding), truncateReportAmount(r.interest), truncateReportAmount(r.writeOffPrincipal), truncateReportAmount(r.writeOffInterest),
        truncateReportAmount(r.principalWaiver ?? 0), truncateReportAmount(r.interestWaiver ?? 0), truncateReportAmount(r.penaltyAmount ?? 0), truncateReportAmount(r.penaltyPaid ?? 0), r.interestPercent, r.nextInstNo ?? '', r.isDead ? 'Yes' : 'No',
        r.deceasedPersonType ?? '', r.deceasedPersonName ?? '', r.deathCertificateName ?? '—', r.approvalDocumentName ?? '—',
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchDeathMember({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Death Member Report');
    const data = await queryDeathMemberRows({
        fromDate, toDate, branchIds,
        centerId: filters?.centerId ?? null, areaId: filters?.areaId ?? null, divisionId: filters?.divisionId ?? null, regionId: filters?.regionId ?? null,
    });
    const fmt = (d: Date | string | null) => (d ? toDisplayDate(new Date(d)) : '');
    const headers = [
        'S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name', 'Center ID', 'Center Name', 'FDO Name', 'Date of Death', 'Death Person', 'Product Type',
        'Loan ID', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone Number', 'Aadhaar Number', 'Disbursement Date', '1st EMI Date', 'Loan Maturity Date',
        'Loan Principal', 'Loan Interest', 'Loan Amount', 'OS Principal', 'OS Interest', 'OS Total', 'Arrear Principal', 'Arrear Interest', 'Arrear Total', 'Interest Rate (%)',
        'Funding Name', 'Death Certificate',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.sNo, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName, r.centerId, r.centerName, r.fdoName, fmt(r.dateOfDeath), r.deathPerson, r.productType,
        r.loanId, r.memberId, r.memberName, r.nomineeName, r.address, r.district, r.phoneNumber, r.aadhaarNumber, fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
        truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanAmount), truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest), truncateReportAmount(r.osTotal), truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest), truncateReportAmount(r.arrearTotal), r.interestRate,
        r.fundingName, r.deathCertificateName ?? '—',
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchMemberReport({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    // Mirrors app/api/reports/client/member-report/route.ts's where-clause construction —
    // keep both in sync when either the live page or this queue adapter's filters change.
    const isDraftOnly = filters?.loanStatus === 'DRAFT';
    const loanStatus = filters?.loanStatus && !isDraftOnly ? filters.loanStatus : undefined;
    const where: any = {
        // Loan closure always sets isActive:false alongside disbursementStatus:'CLOSED' (see
        // app/lib/foreclosure-workflow.ts, app/api/collections/approve/route.ts), so a hardcoded
        // isActive:true would make a 'CLOSED' status filter self-contradicting.
        ...(loanStatus === 'CLOSED' ? { isActive: false } : loanStatus ? { isActive: true } : {}),
        ...(branchIds && { branchId: branchIds.length === 1 ? branchIds[0] : { in: branchIds } }),
        ...(filters?.centerId && { centerId: filters.centerId }),
        ...(filters?.search && {
            OR: [
                { loanNumber: { contains: filters.search, mode: 'insensitive' } },
                { client: { firstName: { contains: filters.search, mode: 'insensitive' } } },
                { client: { lastName: { contains: filters.search, mode: 'insensitive' } } },
                { client: { clientId: { contains: filters.search, mode: 'insensitive' } } },
                ...loanMemberIdSearchConditions(filters.search),
            ],
        }),
        ...(loanStatus && { disbursementStatus: loanStatus }),
        ...(filters?.loanTypeId && { loanProduct: { loanProductTypeId: filters.loanTypeId } }),
        ...(filters?.groupFilter === 'WITH' && { client: { groupId: { not: null } } }),
        ...(filters?.groupFilter === 'WITHOUT' && { client: { groupId: null } }),
        ...(filters?.funderId && { funderId: filters.funderId }),
        // +05:30, not Z — date inputs are IST business calendar days, not UTC midnight.
        ...(filters?.dateMode === 'AS_ON' && filters?.asOnDate && { disbursedByBMAt: { lte: new Date(`${filters.asOnDate}T23:59:59.999+05:30`) } }),
        ...(filters?.dateMode === 'RANGE' && filters?.fromDate && filters?.toDate && {
            disbursedByBMAt: { gte: new Date(`${filters.fromDate}T00:00:00.000+05:30`), lte: new Date(`${filters.toDate}T23:59:59.999+05:30`) },
        }),
    };

    // Loanless clients (true Drafts, and any later-stage client that simply has no
    // Loan row yet) have no loan yet, so any loan-only filter (a specific status,
    // center, funder) can never match one — same eligibility rule as the live route.
    const includeDrafts = !isDraftOnly
        ? (!filters?.centerId && filters?.groupFilter !== 'WITH' && !filters?.funderId && !loanStatus)
        : true;
    let draftWhere: any = null;
    if (includeDrafts) {
        draftWhere = {
            // The true criterion is "no loan yet" — approvalStatus:'DRAFT' was previously
            // used as a proxy, which incorrectly excluded any later-stage (e.g. SUBMITTED,
            // not-yet-grouped) client who also has no Loan row. Mirrors
            // app/api/reports/client/member-report/route.ts's draftWhere — keep in sync.
            loanApplications: { none: {} },
            ...(branchIds && { enrolledBy: { branchId: { in: branchIds } } }),
            ...(filters?.search && {
                OR: [
                    { firstName: { contains: filters.search, mode: 'insensitive' } },
                    { lastName: { contains: filters.search, mode: 'insensitive' } },
                    { clientId: { contains: filters.search, mode: 'insensitive' } },
                    { phone: { contains: filters.search, mode: 'insensitive' } },
                    { mobileNumber: { contains: filters.search, mode: 'insensitive' } },
                    ...memberIdSearchConditions(filters.search),
                ],
            }),
            ...(filters?.loanTypeId && { requestedLoanProductTypeId: filters.loanTypeId }),
            // 'WITH' already excludes drafts via includeDrafts above; 'WITHOUT' still needs its
            // own check since Client.groupId can be set pre-loan (group-assign only requires a
            // centerId, not a specific approvalStatus).
            ...(filters?.groupFilter === 'WITHOUT' && { groupId: null }),
            ...(filters?.dateMode === 'AS_ON' && filters?.asOnDate && { createdAt: { lte: new Date(`${filters.asOnDate}T23:59:59.999+05:30`) } }),
            ...(filters?.dateMode === 'RANGE' && filters?.fromDate && filters?.toDate && {
                createdAt: { gte: new Date(`${filters.fromDate}T00:00:00.000+05:30`), lte: new Date(`${filters.toDate}T23:59:59.999+05:30`) },
            }),
        };
    }

    // This runs in the background queue, so it isn't bound by the live route's 5,000-row
    // synchronous exportAll cap (which made every ALL-branch request fail). Rows are fetched
    // in batches and the raw loans (with their full schedules) are dropped after each batch,
    // so memory stays bounded; the ceiling below only guards against a runaway export.
    const EXPORT_MAX_RECORDS = 100000;
    const BATCH_SIZE = 2000;
    const [loanCount, draftCount] = await Promise.all([
        !isDraftOnly ? prisma.loan.count({ where }) : Promise.resolve(0),
        draftWhere ? prisma.client.count({ where: draftWhere }) : Promise.resolve(0),
    ]);
    if (loanCount + draftCount > EXPORT_MAX_RECORDS) {
        throw new Error(
            `Member Report export matched ${loanCount + draftCount} records, which exceeds the ${EXPORT_MAX_RECORDS} export limit. Narrow the branch, center, or date filters and try again.`
        );
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const data: Array<ReturnType<typeof buildMemberReportDraftRows>[number] | ReturnType<typeof buildMemberReportRows>[number]> = [];
    for (let skip = 0; skip < draftCount; skip += BATCH_SIZE) {
        const draftClients = await queryMemberReportDraftClients(draftWhere, skip, BATCH_SIZE);
        const groupNameById = await buildMemberReportGroupNameMap([], draftClients);
        data.push(...buildMemberReportDraftRows(draftClients, data.length, groupNameById));
    }
    for (let skip = 0; skip < loanCount; skip += BATCH_SIZE) {
        const loans = await queryMemberReportLoans(where, skip, BATCH_SIZE);
        const groupNameById = await buildMemberReportGroupNameMap(loans);
        data.push(...buildMemberReportRows(loans, data.length, today, groupNameById));
    }
    const fmtDate = (d: string | Date | null | undefined) => (d ? toDisplayDate(new Date(d)) : '-');
    const fmtNum = (n: number | null | undefined) => (n == null ? '-' : formatReportAmount(n));
    const orDash = (v: string | number | null | undefined) => (v === '' || v == null ? '-' : v);
    const headers = [
        'S.No.', 'MemberID', 'Loan ID', 'Loan Status', 'Name', 'Phone', 'Email', 'DOB', 'Age', 'Gender', 'Economic Activity Name', 'Branch', 'Center', 'Group', 'Officer Name',
        'Address', 'Local Area', 'State', 'Country', 'District', 'PinCode', 'House Latitude', 'House Longitude', 'Permanent Address', 'Center Location', 'Meeting Day', 'Meeting Time',
        'Meeting Center Name', 'PanCard', 'ID Proof', 'ID Proof No.', 'Caste', 'Spouse Name', 'Spouse DOB', 'Member Status', 'Member Active', 'Insurance', 'Insurance Policy Type',
        'Insurance Coverage Amount', 'Insurance Premium Amount', 'Insurance Start Date', 'Insurance End Date', 'MemberisVerified', 'Loan Cycle', 'Purpose of Loan', 'Product Type',
        'Product Name', 'Product Amount', 'Rate of Interest', 'No.Of Installments', 'Loan Disbursement Date', 'Loan Start Date', 'Loan End Date', 'Collection Day', 'Loan Principal',
        'Loan Interest', 'Total Amount', 'Actual OutStanding Principal', 'Actual OutStanding Interest', 'Actual OutStanding Total Amount', 'Outstanding Principal', 'Outstanding Interest',
        'OutStanding As On Date', 'Arrear Collection Principal', 'Arrear Collection Interest', 'Arrear Collection As On Date', 'Funding Line', 'Last RepayDate', 'LastRepay Principal',
        'LastRepay Interest', 'LastRepay DueAmount', 'Collected By', 'approved by', 'Pattern', 'Member Remark', 'Account Number', 'IFSC code', 'Bank Name', 'Bank Branch Name',
        'Account Type', 'Closed Date', 'CenterID', 'Dead Member', 'Loan Closure Reason', 'Admission Fees', 'Loan Advance', 'Requested Amount', 'Requested Product Type',
        'Requested Purpose', 'Requested Frequency', 'Monthly Family Income', 'Monthly Family Expense', 'Father Name', 'Mother Name', 'Marital Status', 'Qualification', 'Religion',
        'Community', 'No. Of Children', 'House Status', 'Post Office', 'Spouse Mobile Number', 'Spouse Economic Activity', 'Voter ID No.', 'Other ID No.', 'Smart Card No.',
        'Inactive Date', 'Dropout Reason', 'Applied Amount', 'Tenure (Months)', 'Interest Paid', 'Penalties Paid', 'Loan Rejection Reason', 'Loan Created By', 'Loan Verified By',
        'Loan Verified At', 'Co-Applicant Name', 'Co-Applicant Relation', 'Co-Applicant Gender', 'Co-Applicant DOB', 'Co-Applicant Age', 'Co-Applicant Mobile',
        'Co-Applicant Occupation', 'Co-Applicant PAN Card', 'Co-Applicant Voter ID No.',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.sNo, r.memberId, r.loanId, r.loanStatus, r.name, orDash(r.phone), orDash(r.email), fmtDate(r.dob), r.age ?? '-', orDash(r.gender), orDash(r.economicActivityName), r.branch,
        r.center, orDash(r.group), orDash(r.officerName), orDash(r.address), orDash(r.localArea), orDash(r.state), orDash(r.country), orDash(r.district), orDash(r.pinCode),
        r.houseLatitude ?? '-', r.houseLongitude ?? '-', orDash(r.permanentAddress), orDash(r.centerLocation), orDash(r.meetingDay), orDash(r.meetingTime), orDash(r.meetingCenterName),
        orDash(r.panCard), orDash(r.idProof), orDash(r.idProofNo), orDash(r.caste), orDash(r.spouseName), fmtDate(r.spouseDob), r.memberStatus, r.memberActive, orDash(r.insurance),
        orDash(r.insurancePolicyType), fmtNum(r.insuranceCoverageAmount), fmtNum(r.insurancePremiumAmount), fmtDate(r.insuranceStartDate), fmtDate(r.insuranceEndDate), r.memberIsVerified,
        r.loanCycleNo, orDash(r.purposeOfLoan), orDash(r.productType), orDash(r.productName), fmtNum(r.productAmount), r.rateOfInterest, r.noOfInstallments, fmtDate(r.loanDisbursementDate),
        fmtDate(r.loanStartDate), fmtDate(r.loanEndDate), orDash(r.collectionDay), fmtNum(r.loanPrincipal), fmtNum(r.loanInterest), fmtNum(r.totalAmount), fmtNum(r.actualOutstandingPrincipal),
        fmtNum(r.actualOutstandingInterest), fmtNum(r.actualOutstandingTotal), fmtNum(r.outstandingPrincipal), fmtNum(r.outstandingInterest), fmtDate(r.outstandingAsOnDate),
        fmtNum(r.arrearCollectionPrincipal), fmtNum(r.arrearCollectionInterest), fmtDate(r.arrearCollectionAsOnDate), orDash(r.fundingLine), fmtDate(r.lastRepayDate),
        fmtNum(r.lastRepayPrincipal), fmtNum(r.lastRepayInterest), fmtNum(r.lastRepayDueAmount), orDash(r.collectedBy), orDash(r.approvedBy), orDash(r.pattern), orDash(r.memberRemark),
        orDash(r.accountNumber), orDash(r.ifscCode), orDash(r.bankName), orDash(r.bankBranchName), orDash(r.accountType), fmtDate(r.closedDate), r.centerID, r.deadMember,
        orDash(r.loanClosureReason), fmtNum(r.admissionFees), fmtNum(r.loanAdvance), fmtNum(r.requestedAmount), orDash(r.requestedLoanProductType), orDash(r.requestedLoanPurpose),
        orDash(r.requestedLoanFrequency), fmtNum(r.monthlyFamilyIncome), fmtNum(r.monthlyFamilyExpense), orDash(r.fatherName), orDash(r.motherName), orDash(r.maritalStatus),
        orDash(r.qualification), orDash(r.religion), orDash(r.community), r.noOfChildren ?? '-', orDash(r.houseStatus), orDash(r.postOffice), orDash(r.spouseMobileNumber),
        orDash(r.spouseEconomicActivity), orDash(r.votersIdNo), orDash(r.otherIdNo), orDash(r.smartCardNo), fmtDate(r.inactiveDate), orDash(r.dropoutReason), fmtNum(r.appliedAmount),
        r.tenureMonths, fmtNum(r.interestPaid), fmtNum(r.penaltiesPaid), orDash(r.loanRejectionReason), orDash(r.loanCreatedBy), orDash(r.loanVerifiedBy), fmtDate(r.loanVerifiedAt),
        orDash(r.coApplicantName), orDash(r.coApplicantRelation), orDash(r.coApplicantGender), fmtDate(r.coApplicantDob), r.coApplicantAge ?? '-', orDash(r.coApplicantMobile),
        orDash(r.coApplicantOccupation), orDash(r.coApplicantPanCard), orDash(r.coApplicantVoterId),
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchOpeningBalance({ branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!branchIds || branchIds.length !== 1) throw new Error('A single branch is required for the Opening Balance report');
    const branchId = branchIds[0];
    const [ledgers, openingBalances] = await Promise.all([
        prisma.accountLedger.findMany({ where: { isActive: true }, select: { id: true, ledgerId: true, ledgerName: true } }),
        prisma.ledgerOpeningBalance.findMany({ where: { branchId } }),
    ]);
    ledgers.sort((a, b) => {
        const numA = parseInt(a.ledgerId, 10);
        const numB = parseInt(b.ledgerId, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.ledgerId.localeCompare(b.ledgerId);
    });
    const byLedgerId = new Map(openingBalances.map((ob) => [ob.ledgerId, ob]));
    const headers = ['S.No', 'Account Name', 'Account Code', 'Opening Balance Type', 'Opening Balance Amount'];
    const rows: (string | number)[][] = ledgers.map((ledger, i) => {
        const existing = byLedgerId.get(ledger.id);
        return [i + 1, ledger.ledgerName, ledger.ledgerId, (existing?.balanceType ?? 'CREDIT') === 'CREDIT' ? 'Credit' : 'Debit', truncateReportAmount(existing ? Number(existing.amount) : 0)];
    });
    return { headers, rows, totalCount: ledgers.length };
}

// ── Tier 2 (nontrivial but tabular) ──────────────────────────────────

const fmtIncDate = (d: string | null) => (d ? toDisplayDate(new Date(d)) : '—');

async function fetchIncentiveReport({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Incentive Report');
    const result = await getIncentiveReportData({
        fromDate, toDate, scopedBranchIds: branchIds,
        branchId: filters?.branchId, divisionId: filters?.divisionId, fdoId: filters?.fdoId, search: filters?.search,
        exportAll: true,
    });
    const headers = [
        'Division', 'Branch', 'DOJ', 'Emp ID', 'Staff Name', 'Category', 'Active Clients', 'Gold Target', 'Gold Achieved', 'Gold Disb. Amt', 'Achv %', 'Eligible Incentive',
        'Wt 0.500-0.640', 'Wt 0.990-1.030', 'Wt 1.050-2.020', 'Weight Incentive', 'JLG Members', 'JLG Disb. Amt', 'IGP Incentive', 'Total Demand', 'Demand Coll.', 'Arrear Coll.',
        'Total Coll.', 'Recovery %', 'Collection Incentive', 'OD 31-60', 'OD 61-90', 'OD 91-180', 'OD >180', 'OD Incentive', 'Final Incentive',
    ];
    const rows: (string | number)[][] = result.data.map((r) => [
        r.division || '—', r.branch || '—', fmtIncDate(r.dateOfJoining), r.employeeId ?? '—', r.staffName, r.fieldOfficerCategory ?? '—', r.activeClients,
        r.goldLoanTarget, r.goldLoanAchievedMembers, truncateReportAmount(r.goldLoanDisbursementAmount), `${r.achievementPercent}%`, truncateReportAmount(r.eligibleIncentive),
        truncateReportAmount(r.goldWeightSlab1), truncateReportAmount(r.goldWeightSlab2), truncateReportAmount(r.goldWeightSlab3), truncateReportAmount(r.goldWeightIncentive), r.jlgLoanMembers, truncateReportAmount(r.jlgLoanDisbursement), truncateReportAmount(r.jlgIncentive),
        truncateReportAmount(r.totalDemand), truncateReportAmount(r.demandCollection), truncateReportAmount(r.arrearCollection), truncateReportAmount(r.totalCollection), `${r.recoveryPercent}%`, truncateReportAmount(r.collectionIncentive),
        truncateReportAmount(r.odCollection31to60), truncateReportAmount(r.odCollection61to90), truncateReportAmount(r.odCollection91to180), truncateReportAmount(r.odCollectionAbove180), truncateReportAmount(r.odCollectionIncentive), truncateReportAmount(r.finalIncentive),
    ]);
    return { headers, rows, totalCount: result.data.length };
}

const DETAILEDWISE_HEADERS = [
    'S.No', 'Branch ID', 'Branch', 'Centre ID', 'Center', 'Product Type', 'Loan ID', 'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date',
    'Member ID', 'Member Name', 'Member Nominee Name', 'Address', 'District', 'Phone Number', 'Loan Amount', 'No of Installment', 'Last Repay Date', 'Last Repay Amount',
    'Collected Dues', 'Dues Left', 'Loan Age', 'Age Wise', 'DueDay', 'EMI', 'Loan Principal', 'Loan Interest', 'Loan Total',
    'Outstanding Principal', 'Outstanding Interest', 'Outstanding Total', 'Overdue Principal', 'Overdue Interest', 'Overdue Total',
    'Opening OD Principal', 'Opening OD Interest', 'Opening OD Total', 'Current Principal Collection', 'Current Interest Collection', 'Current Collection Total',
    'Principal Collection', 'Interest Collection', 'Closing OD Principal', 'Closing OD Interest', 'Closing OD Total', 'Funder', 'FDO Name',
    // Appended last so PAR's position-46 'PAR' insert (PAR_HEADERS) stays put.
    ...MEMBER_CONTACT_HEADERS,
];

function buildDetailedwiseRows(data: Awaited<ReturnType<typeof getMISDetailedAgewiseArrearData>>['data']): (string | number)[][] {
    // Amount columns are wrapped with truncateReportAmount (display-only, no-decimal truncation
    // per the project-wide report requirement); column order/count is unchanged so positional
    // parity with PAR's PAR%-column insertion (fetchPar below) and MIS Agewise Arrear's
    // DETAILEDWISE_HEADERS is preserved exactly — do not reorder or add/remove columns here.
    const rows: (string | number)[][] = data.map((r, idx) => [
        idx + 1, r.branchId, r.branchName, r.centreId, r.centreName, r.productType, r.loanId, r.loanDisbursementDate, r.firstEmiDate, r.loanMaturityDate,
        r.memberId, r.memberName, r.memberNomineeName, r.address, r.district, r.phoneNumber, truncateReportAmount(r.loanAmount), r.noOfInstallment, r.lastRepayDate, truncateReportAmount(r.lastRepayAmount),
        truncateReportAmount(r.collectedDues), truncateReportAmount(r.duesLeft), r.loanAge, r.ageWise, r.dueDay, truncateReportAmount(r.emi), truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanTotal),
        truncateReportAmount(r.outstandingPrincipal), truncateReportAmount(r.outstandingInterest), truncateReportAmount(r.outstandingTotal), truncateReportAmount(r.overduePrincipal), truncateReportAmount(r.overdueInterest), truncateReportAmount(r.overdueTotal),
        truncateReportAmount(r.openingOdPrincipal), truncateReportAmount(r.openingOdInterest), truncateReportAmount(r.openingOdTotal), truncateReportAmount(r.currentPrincipalCollection), truncateReportAmount(r.currentInterestCollection), truncateReportAmount(r.currentCollectionTotal),
        truncateReportAmount(r.principalCollection), truncateReportAmount(r.interestCollection), truncateReportAmount(r.closingOdPrincipal), truncateReportAmount(r.closingOdInterest), truncateReportAmount(r.closingOdTotal), r.funder, r.fdoName,
        ...memberContactValues(r),
    ]);
    if (data.length > 0) {
        const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
        const totalOutstandingPrincipal = sum((r) => r.outstandingPrincipal);
        const totalClosingOdPrincipal = sum((r) => r.closingOdPrincipal);
        rows.push([
            '', `Grand Total (${data.length} loans)`, '', '', '', '', '', '', '', '', '', '', '', '', '',
            truncateReportAmount(sum((r) => r.loanAmount)), '', '', '', '', '', '', '', '', '', truncateReportAmount(sum((r) => r.loanAmount)), '', truncateReportAmount(sum((r) => r.loanAmount)),
            truncateReportAmount(totalOutstandingPrincipal), truncateReportAmount(sum((r) => r.outstandingInterest)), truncateReportAmount(sum((r) => r.outstandingTotal)),
            truncateReportAmount(sum((r) => r.overduePrincipal)), truncateReportAmount(sum((r) => r.overdueInterest)), truncateReportAmount(sum((r) => r.overdueTotal)),
            truncateReportAmount(sum((r) => r.openingOdPrincipal)), truncateReportAmount(sum((r) => r.openingOdInterest)), truncateReportAmount(sum((r) => r.openingOdTotal)),
            truncateReportAmount(sum((r) => r.currentPrincipalCollection)), truncateReportAmount(sum((r) => r.currentInterestCollection)), truncateReportAmount(sum((r) => r.currentCollectionTotal)),
            truncateReportAmount(sum((r) => r.principalCollection)), truncateReportAmount(sum((r) => r.interestCollection)),
            truncateReportAmount(totalClosingOdPrincipal), truncateReportAmount(sum((r) => r.closingOdInterest)), truncateReportAmount(sum((r) => r.closingOdTotal)),
            Number((totalOutstandingPrincipal > 0 ? (totalClosingOdPrincipal / totalOutstandingPrincipal) * 100 : 0).toFixed(2)), '', '',
        ]);
    }
    return rows;
}

// PAR-specific extension of the shared DETAILEDWISE_HEADERS/buildDetailedwiseRows — NOT a
// change to that shared pair, since it's also used by the protected fetchMisAgewiseArrear
// DETAILEDWISE branch below, which intentionally has no PAR column ("DETAILEDWISE — same
// shape as Portfolio at Risk, minus its PAR% column", per AgewiseArrearClient.tsx's own
// comment). PAR = Closing OD Principal / Outstanding Principal * 100, inserted before
// 'Funder' — matching PortfolioAtRiskClient's computePar() and buildPARExportRows() exactly.
const PAR_HEADERS = [...DETAILEDWISE_HEADERS.slice(0, 46), 'PAR', ...DETAILEDWISE_HEADERS.slice(46)];

async function fetchPar({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const centerId = filters?.centerId || 'all';
    const result = await getPortfolioAtRiskData(centerId, branchIds ?? undefined);
    const detailRows = buildDetailedwiseRows(result.data);
    const rows: (string | number)[][] = result.data.map((r, idx) => {
        const row = detailRows[idx];
        const par = Number((r.outstandingPrincipal > 0 ? (r.closingOdPrincipal / r.outstandingPrincipal) * 100 : 0).toFixed(2));
        return [...row.slice(0, 46), par, ...row.slice(46)];
    });
    if (result.data.length > 0) {
        // Built independently of buildDetailedwiseRows's own totals row (which is a
        // 48-column DETAILEDWISE-shaped row with no PAR% column, and is left untouched here
        // since it's shared with fetchMisAgewiseArrear's DETAILEDWISE branch). PAR needs its
        // own 49-column total with PAR% inserted at the same position 46 as each data row
        // above. Mirrors the now-fixed PortfolioAtRiskClient.buildPARExportRows /
        // par-pdf.ts buildParExportRows grand-total shape exactly, so Direct and Queue align.
        const sum = (fn: (r: (typeof result.data)[number]) => number) => result.data.reduce((s, r) => s + fn(r), 0);
        const totalLoanAmount = sum((r) => r.loanAmount);
        const totalOutstandingPrincipal = sum((r) => r.outstandingPrincipal);
        const totalClosingOdPrincipal = sum((r) => r.closingOdPrincipal);
        const parPercentage = totalOutstandingPrincipal > 0 ? (totalClosingOdPrincipal / totalOutstandingPrincipal) * 100 : 0;
        rows.push([
            '', `Grand Total (${result.data.length} loans)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            truncateReportAmount(totalLoanAmount),
            '', '', '', '', '', '', '', '', '',
            truncateReportAmount(totalLoanAmount), '', truncateReportAmount(totalLoanAmount),
            truncateReportAmount(totalOutstandingPrincipal), truncateReportAmount(sum((r) => r.outstandingInterest)), truncateReportAmount(sum((r) => r.outstandingTotal)),
            truncateReportAmount(sum((r) => r.overduePrincipal)), truncateReportAmount(sum((r) => r.overdueInterest)), truncateReportAmount(sum((r) => r.overdueTotal)),
            truncateReportAmount(sum((r) => r.openingOdPrincipal)), truncateReportAmount(sum((r) => r.openingOdInterest)), truncateReportAmount(sum((r) => r.openingOdTotal)),
            truncateReportAmount(sum((r) => r.currentPrincipalCollection)), truncateReportAmount(sum((r) => r.currentInterestCollection)), truncateReportAmount(sum((r) => r.currentCollectionTotal)),
            truncateReportAmount(sum((r) => r.principalCollection)), truncateReportAmount(sum((r) => r.interestCollection)),
            truncateReportAmount(totalClosingOdPrincipal), truncateReportAmount(sum((r) => r.closingOdInterest)), truncateReportAmount(sum((r) => r.closingOdTotal)),
            Number(parPercentage.toFixed(2)), '', '',
        ]);
    }
    return { headers: PAR_HEADERS, rows, totalCount: result.data.length };
}

async function fetchMisAgewiseArrear({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the MIS Age-wise Arrear report');
    const reportType = filters?.reportType as MISAgewiseReportType | 'DETAILEDWISE' | undefined;
    if (!reportType) throw new Error('filters.reportType is required for the MIS Age-wise Arrear report (BRANCHWISE/CENTERWISE/FDOWISE/CLIENTWISE/DETAILEDWISE)');
    const centerId = filters?.centerId;
    const fdoId = filters?.fdoId;

    if (reportType === 'DETAILEDWISE') {
        const result = await getMISDetailedAgewiseArrearData(fromDate, branchIds ?? undefined, centerId, { fdoId });
        return { headers: DETAILEDWISE_HEADERS, rows: buildDetailedwiseRows(result.data), totalCount: result.data.length };
    }

    const result = await getMISAgewiseArrearData(fromDate, reportType, branchIds ?? undefined, centerId);
    const { data, totals } = result;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    switch (reportType) {
        case 'BRANCHWISE': {
            const rs = data as any[];
            headers = ['Branch', '# Centers', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
            rows = rs.map((r) => [
                r.branchName, r.numCenters, r.numClients, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180), truncateReportAmount(r.arrearAbove180),
                truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal),
            ]);
            if (rs.length > 0) rows.push([
                'Grand Total', totals.totalCenters, totals.totalClients, truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance),
                truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear),
            ]);
            break;
        }
        case 'CENTERWISE': {
            const rs = data as any[];
            headers = ['Branch', 'Center', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
            rows = rs.map((r) => [
                r.branchName, r.centerName, r.numClients, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180), truncateReportAmount(r.arrearAbove180),
                truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal),
            ]);
            if (rs.length > 0) rows.push([
                'Grand Total', '', totals.totalClients, truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance),
                truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear),
            ]);
            break;
        }
        case 'FDOWISE': {
            const rs = data as any[];
            headers = ['Branch', 'FDO', '# Centers', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
            rows = rs.map((r) => [
                r.branchName, r.fdoName, r.numCenters, r.numClients, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180), truncateReportAmount(r.arrearAbove180),
                truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal),
            ]);
            if (rs.length > 0) rows.push([
                'Grand Total', '', totals.totalCenters, totals.totalClients, truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance),
                truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear),
            ]);
            break;
        }
        case 'CLIENTWISE': {
            const rs = data as any[];
            headers = ['Branch', 'Center', 'Client', 'Phone', 'Loan A/C', 'Loan Amount', 'Pri. Balance', 'Total Dues', 'Disbursal Date', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Total Arrear', 'FDO'];
            rows = rs.map((r) => [
                r.branchName, r.centerName, r.clientName, r.phone, r.loanAccount, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance), truncateReportAmount(r.totalDues), r.disbursalDate,
                truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180), truncateReportAmount(r.arrearAbove180),
                truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal), r.fdoName,
            ]);
            if (rs.length > 0) rows.push([
                'Grand Total', '', '', '', '', truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance), '', '',
                truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear), '',
            ]);
            break;
        }
        default:
            throw new Error(`Unknown filters.reportType "${reportType}" for the MIS Age-wise Arrear report (expected BRANCHWISE/CENTERWISE/FDOWISE/CLIENTWISE/DETAILEDWISE)`);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchClientPortfolioReport({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    // Mirrors app/api/admin-reports/portfolio/client-portfolio-report/route.ts's branchWhere construction.
    const branchWhere: any = {};
    if (branchIds) branchWhere.id = branchIds.length === 1 ? branchIds[0] : { in: branchIds };
    if (filters?.areaId) branchWhere.areas = { some: { id: filters.areaId } };
    else if (filters?.divisionId) branchWhere.areas = { some: { division: { id: filters.divisionId } } };
    else if (filters?.regionId) branchWhere.areas = { some: { division: { region: { id: filters.regionId } } } };

    const loanProductWhere: any = {};
    if (filters?.productTypeId) loanProductWhere.loanProductTypeId = filters.productTypeId;
    if (filters?.loanProductId) loanProductWhere.productId = filters.loanProductId;

    const where: any = {
        disbursementStatus: 'DISBURSED',
        ...(filters?.centerId && { centerId: filters.centerId }),
        ...(filters?.funderId && { funderId: filters.funderId }),
        ...(Object.keys(loanProductWhere).length > 0 && { loanProduct: loanProductWhere }),
        ...(Object.keys(branchWhere).length > 0 && { center: { branch: branchWhere } }),
    };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const loans = await queryPortfolioLoans(where, undefined, 5000);
    const data = buildPortfolioRows(loans, 0, today);
    const fmt = (d: Date | string | null) => (d ? toDisplayDate(new Date(d)) : '');
    const headers = [
        'S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'FDO Name', 'Product Type', 'Loan ID', 'Member ID',
        'Member Name', 'Nominee Name', 'Address', 'District', 'Phone Number', 'Aadhaar Number', 'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date', 'Loan Principal',
        'Loan Interest', 'Loan Amount', 'OS Principal', 'OS Interest', 'OS Total', 'Arrear Principal', 'Arrear Interest', 'Arrear Total', 'Interest Rate (%)',
        'Funding Name', 'Is Dead', 'Deceased Person Type', 'Deceased Person Name',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.sNo, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName, r.centerId, r.centerName, r.fdoName, r.productType, r.loanId, r.memberId,
        r.memberName, r.nomineeName, r.address, r.district, r.phoneNumber, r.aadhaarNumber, fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
        truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanAmount), truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest), truncateReportAmount(r.osTotal), truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest), truncateReportAmount(r.arrearTotal), r.interestRate, r.fundingName,
        r.isDead ? 'Yes' : 'No', r.deceasedPersonType ?? '', r.deceasedPersonName ?? '',
    ]);
    if (data.length > 0) {
        const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
        rows.push([
            0, 'GRAND TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            '', '', '', truncateReportAmount(sum((r) => r.loanPrincipal)), truncateReportAmount(sum((r) => r.loanInterest)), truncateReportAmount(sum((r) => r.loanAmount)),
            truncateReportAmount(sum((r) => r.osPrincipal)), truncateReportAmount(sum((r) => r.osInterest)), truncateReportAmount(sum((r) => r.osTotal)),
            truncateReportAmount(sum((r) => r.arrearPrincipal)), truncateReportAmount(sum((r) => r.arrearInterest)), truncateReportAmount(sum((r) => r.arrearTotal)),
            0, '', '', '', '',
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

type TbTotals = { openingDebit: number; openingCredit: number; txnDebit: number; txnCredit: number; closingDebit: number; closingCredit: number };
const tbEmptyTotals = (): TbTotals => ({ openingDebit: 0, openingCredit: 0, txnDebit: 0, txnCredit: 0, closingDebit: 0, closingCredit: 0 });
const tbAddTotals = (a: TbTotals, r: TrialBalanceRow) => {
    a.openingDebit += r.openingDebit; a.openingCredit += r.openingCredit;
    a.txnDebit += r.txnDebit; a.txnCredit += r.txnCredit;
    a.closingDebit += r.closingDebit; a.closingCredit += r.closingCredit;
};

async function fetchTrialBalance({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const reportType = (filters?.reportType as 'RANGE' | 'AS_ON') || 'AS_ON';
    const viewType = (filters?.viewType as 'CONDENSED' | 'DETAILED') || 'DETAILED';
    if (reportType === 'RANGE' && (!fromDate || !toDate)) throw new Error('fromDate and toDate are required for a RANGE Trial Balance report');
    if (reportType === 'AS_ON' && !fromDate) throw new Error('An As-On date is required for the Trial Balance report');

    const rows = await computeTrialBalanceRows({
        reportType, fromDateStr: fromDate, toDateStr: toDate, asOnDateStr: fromDate, scopedBranchIds: branchIds,
    });

    // Interleave group-header rows (only depth-0 groups carry aggregate totals) —
    // mirrors buildDisplayRows() in components/accounts/TrialBalanceClient.tsx.
    const primaryTotals = new Map<string, TbTotals>();
    rows.forEach((r) => {
        const key = r.groupPath[0]?.groupName ?? 'UNCLASSIFIED';
        const t = primaryTotals.get(key) ?? tbEmptyTotals();
        tbAddTotals(t, r);
        primaryTotals.set(key, t);
    });

    const headers = viewType === 'DETAILED'
        ? ['S.No', 'Particulars', 'Account Code', 'Opening Debit', 'Opening Credit', 'Transaction Debit', 'Transaction Credit', 'Closing Debit', 'Closing Credit']
        : ['S.No', 'Particulars', 'Account Code', 'Closing Debit', 'Closing Credit'];

    const exportRows: (string | number)[][] = [];
    let sNo = 0;
    let prevPath: string[] = [];
    rows.forEach((r) => {
        const path = r.groupPath.map((p) => p.groupName);
        for (let depth = 0; depth < path.length; depth++) {
            if (path[depth] !== prevPath[depth]) {
                for (let d = depth; d < path.length; d++) {
                    const indent = '    '.repeat(d);
                    const label = `${indent}${path[d]}`;
                    if (d === 0) {
                        sNo += 1;
                        const t = primaryTotals.get(path[0]) ?? tbEmptyTotals();
                        exportRows.push(
                            viewType === 'DETAILED'
                                ? [sNo, label, '', truncateReportAmount(t.openingDebit), truncateReportAmount(t.openingCredit), truncateReportAmount(t.txnDebit), truncateReportAmount(t.txnCredit), truncateReportAmount(t.closingDebit), truncateReportAmount(t.closingCredit)]
                                : [sNo, label, '', truncateReportAmount(t.closingDebit), truncateReportAmount(t.closingCredit)]
                        );
                    } else {
                        exportRows.push(viewType === 'DETAILED' ? ['', label, '', '', '', '', '', '', ''] : ['', label, '', '', '']);
                    }
                }
                break;
            }
        }
        const indent = '    '.repeat(path.length);
        const label = `${indent}${r.ledgerName}`;
        exportRows.push(
            viewType === 'DETAILED'
                ? ['', label, r.ledgerCode, truncateReportAmount(r.openingDebit), truncateReportAmount(r.openingCredit), truncateReportAmount(r.txnDebit), truncateReportAmount(r.txnCredit), truncateReportAmount(r.closingDebit), truncateReportAmount(r.closingCredit)]
                : ['', label, r.ledgerCode, truncateReportAmount(r.closingDebit), truncateReportAmount(r.closingCredit)]
        );
        prevPath = path;
    });

    const grandTotal = rows.reduce((acc, r) => { tbAddTotals(acc, r); return acc; }, tbEmptyTotals());
    exportRows.push(
        viewType === 'DETAILED'
            ? ['', 'GRAND TOTAL', '', truncateReportAmount(grandTotal.openingDebit), truncateReportAmount(grandTotal.openingCredit), truncateReportAmount(grandTotal.txnDebit), truncateReportAmount(grandTotal.txnCredit), truncateReportAmount(grandTotal.closingDebit), truncateReportAmount(grandTotal.closingCredit)]
            : ['', 'GRAND TOTAL', '', truncateReportAmount(grandTotal.closingDebit), truncateReportAmount(grandTotal.closingCredit)]
    );

    return { headers, rows: exportRows, totalCount: rows.length };
}

async function fetchMisLedgerReport({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const ledgerId = filters?.ledgerId;
    if (!ledgerId) throw new Error('filters.ledgerId is required for the MIS Ledger report');
    const reportType = (filters?.reportType as 'RANGE' | 'AS_ON') || 'RANGE';
    const viewType = (filters?.viewType as 'CONDENSED' | 'DETAILED') || 'CONDENSED';
    if (reportType === 'RANGE' && (!fromDate || !toDate)) throw new Error('fromDate and toDate are required for a RANGE MIS Ledger report');
    if (reportType === 'AS_ON' && !fromDate) throw new Error('An As-On date is required for the MIS Ledger report');

    const data = await computeLedgerReport({
        ledgerId, reportType, fromDateStr: fromDate, toDateStr: toDate, asOnDateStr: fromDate, scopedBranchIds: branchIds,
    });

    const fmtLedgerDate = (d: string) => toDisplayDate(new Date(d));
    const headers = viewType === 'CONDENSED'
        ? ['S.No', 'Voucher Date', 'Branch Name', 'Particulars', 'Narration', 'Voucher No.', 'Debit', 'Credit', 'Balance', 'Dr/Cr']
        : ['S.No', 'Voucher Date', 'Branch Name', 'Particulars', 'Voucher Type', 'Voucher No.', 'Debit', 'Credit', 'Balance', 'Dr/Cr'];

    const rows: (string | number)[][] = [];
    rows.push(['', '', '', 'OPENING BALANCE:', '', '', '', '', truncateReportAmount(data.openingBalance), data.openingBalanceType]);
    data.rows.forEach((r, i) => {
        rows.push(viewType === 'CONDENSED'
            ? [i + 1, fmtLedgerDate(r.voucherDate), r.branchName, r.particulars, r.narration || '', r.voucherNo, r.debit ? truncateReportAmount(r.debit) : 0, r.credit ? truncateReportAmount(r.credit) : 0, truncateReportAmount(r.balance), r.balanceType]
            : [i + 1, fmtLedgerDate(r.voucherDate), r.branchName, r.particulars, r.voucherTypeLabel, r.voucherNo, r.debit ? truncateReportAmount(r.debit) : 0, r.credit ? truncateReportAmount(r.credit) : 0, truncateReportAmount(r.balance), r.balanceType]);
    });
    rows.push(['', '', '', 'TOTAL:', '', '', truncateReportAmount(data.totalDebit), truncateReportAmount(data.totalCredit), '', '']);
    const endDateLabel = fmtLedgerDate(reportType === 'RANGE' ? (toDate as string) : (fromDate as string));
    rows.push(['', '', '', `END DATE: ${endDateLabel} — CLOSING BALANCE:`, '', '', '', '', truncateReportAmount(data.closingBalance), data.closingBalanceType]);

    return { headers, rows, totalCount: data.rows.length };
}

async function fetchLoanAdvanceLedger({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!(await getLoanAdvanceEnabled())) throw new Error('Loan Advance is disabled — this report is unavailable');
    const where: any = { type: { in: ['SAVINGS_COLLECTION', 'SAVINGS_REFUND'] } };
    if (branchIds) where.branchId = branchIds.length === 1 ? branchIds[0] : { in: branchIds };
    if (filters?.centerId) where.centerId = filters.centerId;
    if (filters?.clientDbId) where.clientId = filters.clientDbId;
    if (fromDate || toDate) {
        where.transactionDate = {};
        if (fromDate) where.transactionDate.gte = new Date(`${fromDate}T00:00:00+05:30`);
        if (toDate) where.transactionDate.lte = new Date(`${toDate}T23:59:59+05:30`);
    }

    const transactions = await prisma.loanTransaction.findMany({
        where,
        select: {
            transactionId: true, amount: true, type: true, paymentMode: true, transactionDate: true, status: true, clientId: true,
            client: { select: { clientId: true, firstName: true, lastName: true, loanAdvance: true, center: { select: { name: true, code: true } } } },
            loan: { select: { loanNumber: true } },
        },
        orderBy: { transactionDate: 'desc' },
    });

    type LAClient = { clientCode: string; clientName: string; centerCode: string; centerName: string; currentBalance: number; totalCollected: number; totalRefunded: number; transactions: { transactionId: string; date: string; type: string; loanNumber: string; amount: number; paymentMode: string; status: string }[] };
    const clientMap = new Map<string, LAClient>();
    for (const tx of transactions) {
        const cId = tx.clientId;
        if (!clientMap.has(cId)) {
            clientMap.set(cId, {
                clientCode: tx.client.clientId, clientName: `${tx.client.firstName} ${tx.client.lastName}`,
                centerCode: tx.client.center?.code ?? '', centerName: tx.client.center?.name ?? '',
                currentBalance: Number(tx.client.loanAdvance ?? 0), totalCollected: 0, totalRefunded: 0, transactions: [],
            });
        }
        const entry = clientMap.get(cId)!;
        const amt = Number(tx.amount);
        if (tx.type === 'SAVINGS_COLLECTION') entry.totalCollected += amt; else if (tx.type === 'SAVINGS_REFUND') entry.totalRefunded += amt;
        entry.transactions.push({ transactionId: tx.transactionId, date: tx.transactionDate.toISOString(), type: tx.type, loanNumber: tx.loan?.loanNumber ?? '', amount: amt, paymentMode: tx.paymentMode, status: tx.status });
    }

    const data = Array.from(clientMap.values());
    const totals = { totalCollected: data.reduce((s, r) => s + r.totalCollected, 0), totalRefunded: data.reduce((s, r) => s + r.totalRefunded, 0), netBalance: data.reduce((s, r) => s + r.currentBalance, 0) };
    const typeLabel = (t: string) => (t === 'SAVINGS_COLLECTION' ? 'Collection' : 'Refund');
    const fmtDT = (iso: string) => toDisplayDateTime(new Date(iso));

    const headers = ['Client ID', 'Client Name', 'Center', 'Current Balance', 'Total Collected', 'Total Refunded', 'Tx Date', 'Tx ID', 'Type', 'Loan A/c', 'Amount', 'Mode', 'Status'];
    const rows: (string | number)[][] = [];
    for (const row of data) {
        const firstTx = row.transactions[0];
        rows.push([
            row.clientCode, row.clientName, `${row.centerCode} - ${row.centerName}`, truncateReportAmount(row.currentBalance), truncateReportAmount(row.totalCollected), truncateReportAmount(row.totalRefunded),
            firstTx ? fmtDT(firstTx.date) : '', firstTx?.transactionId ?? '', firstTx ? typeLabel(firstTx.type) : '', firstTx?.loanNumber ?? '',
            firstTx ? truncateReportAmount(firstTx.amount) : '', firstTx?.paymentMode ?? '', firstTx?.status ?? '',
        ]);
        for (let i = 1; i < row.transactions.length; i++) {
            const tx = row.transactions[i];
            rows.push(['', '', '', '', '', '', fmtDT(tx.date), tx.transactionId, typeLabel(tx.type), tx.loanNumber, truncateReportAmount(tx.amount), tx.paymentMode, tx.status]);
        }
    }
    if (data.length > 0) rows.push(['GRAND TOTAL', '', '', truncateReportAmount(totals.netBalance), truncateReportAmount(totals.totalCollected), truncateReportAmount(totals.totalRefunded), '', '', '', '', '', '', '']);
    return { headers, rows, totalCount: data.length };
}

async function fetchPerformanceReport({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Performance report');
    const from = new Date(fromDate); from.setHours(0, 0, 0, 0);
    const to = new Date(toDate); to.setHours(23, 59, 59, 999);

    const branches = await prisma.branch.findMany({
        where: { isActive: true, ...(branchIds ? { id: { in: branchIds } } : {}) },
        include: {
            centers: { include: { clients: { where: { isActive: true } }, fdo: true } },
            users: { where: { role: 'BRANCH_MANAGER' } },
        },
    });

    const data: Record<string, any>[] = [];
    let sno = 1;
    for (const branch of branches) {
        const totalCenters = branch.centers.length;
        let totalMembers = 0, active = 0, dropouts = 0, fdoName = 'UNASSIGNED';
        branch.centers.forEach((center: any) => {
            totalMembers += center.clients.length;
            active += center.clients.filter((c: any) => c.isActive).length;
            dropouts += center.clients.filter((c: any) => !c.isActive).length;
            if (center.fdo?.firstName) fdoName = `${center.fdo.firstName} ${center.fdo.lastName}`;
        });
        const txns = await prisma.loanTransaction.aggregate({
            where: { branchId: branch.id, transactionDate: { gte: from, lte: to }, isReversed: false },
            _sum: { amount: true, principalAmount: true, interestAmount: true, feesAmount: true },
        });
        const loans = await prisma.loan.aggregate({
            where: { branchId: branch.id, disbursementStatus: 'DISBURSED', disbursedLevel1At: { gte: from, lte: to } },
            _sum: { amount: true }, _count: { _all: true },
        });
        const bManager = branch.users[0] ? `${branch.users[0].firstName} ${branch.users[0].lastName}` : 'UNASSIGNED';
        data.push({
            sino: sno++, branch: `${branch.code} - ${branch.name}`, address: branch.address || 'N/A', totalCenters, totalMembers,
            attClients100: Math.floor(active * 0.95), active, nr: Math.floor(active * 0.05), newMembers: loans._count._all || 0,
            membersDropouts: dropouts, fdoSupervisor: fdoName, branchManager: bManager, newLoanDemand: 0, oldLoanDemand: 0,
            collection: Number(txns._sum.amount || 0), preclosure: 0, newMembersAmount: Number(loans._sum.amount || 0), oldMembersAmount: 0,
            totalAmount: Number(loans._sum.amount || 0), collected: Number(txns._sum.amount || 0), collectionAmount: Number(txns._sum.amount || 0),
            arrearAmount: 0, outstanding: Number(loans._sum.amount || 0) - Number(txns._sum.principalAmount || 0), advance: 0, arrPreAmount: 0,
            charges: Number(txns._sum.feesAmount || 0), bales: 0, lives: 0, rent: 0, chabeeb: 0, classic: 0,
            applCharges: Math.floor(Number(loans._sum.amount || 0) * 0.01), processingCharges: Math.floor(Number(loans._sum.amount || 0) * 0.02),
        });
    }

    const sum = (key: string) => data.reduce((s, r) => s + (r[key] as number), 0);
    const summary = {
        totalCenters: sum('totalCenters'), totalMembers: sum('totalMembers'), attClients100: sum('attClients100'), active: sum('active'),
        nr: sum('nr'), newMembers: sum('newMembers'), membersDropouts: sum('membersDropouts'), newLoanDemand: sum('newLoanDemand'),
        oldLoanDemand: sum('oldLoanDemand'), collection: sum('collection'), preclosure: sum('preclosure'), newMembersAmount: sum('newMembersAmount'),
        oldMembersAmount: sum('oldMembersAmount'), totalAmount: sum('totalAmount'), collected: sum('collected'), collectionAmount: sum('collectionAmount'),
        arrearAmount: sum('arrearAmount'), outstanding: sum('outstanding'), advance: sum('advance'), arrPreAmount: sum('arrPreAmount'), charges: sum('charges'),
        bales: sum('bales'), lives: sum('lives'), rent: sum('rent'), chabeeb: sum('chabeeb'), classic: sum('classic'),
        applCharges: sum('applCharges'), processingCharges: sum('processingCharges'),
    };

    const headers = [
        'SNO', 'Branch', 'Address', 'Total Centers', 'Total Members', '100% Att. Clients', 'Active', 'NR', 'New Members', 'Members Dropout', 'FDO', 'Supervisor',
        'New Loan Demand', 'Old Loan Demand', 'Collection', 'Preclosure', 'New Members Amount', 'Old Members Amount', 'Total Amount', 'Collected', 'Collection Amount',
        'Arrear Amount', 'Outstanding', 'Advance', 'Arr Pre Amount', 'Charges', 'Bales', 'Lives', 'Rent', 'Chabeeb', 'Classic', 'Appl. Charges', 'Processing Charges',
    ];
    const rows: (string | number)[][] = data.map((item) => [
        item.sino, item.branch, item.address, item.totalCenters, item.totalMembers, item.attClients100, item.active, item.nr, item.newMembers, item.membersDropouts,
        item.fdoSupervisor, item.branchManager, truncateReportAmount(item.newLoanDemand), truncateReportAmount(item.oldLoanDemand), truncateReportAmount(item.collection), truncateReportAmount(item.preclosure), truncateReportAmount(item.newMembersAmount), truncateReportAmount(item.oldMembersAmount),
        truncateReportAmount(item.totalAmount), truncateReportAmount(item.collected), truncateReportAmount(item.collectionAmount), truncateReportAmount(item.arrearAmount), truncateReportAmount(item.outstanding), truncateReportAmount(item.advance), truncateReportAmount(item.arrPreAmount), truncateReportAmount(item.charges), truncateReportAmount(item.bales),
        truncateReportAmount(item.lives), truncateReportAmount(item.rent), truncateReportAmount(item.chabeeb), truncateReportAmount(item.classic), truncateReportAmount(item.applCharges), truncateReportAmount(item.processingCharges),
    ]);
    if (data.length > 0) {
        rows.push([
            '', 'TOTAL', '', summary.totalCenters, summary.totalMembers, summary.attClients100, summary.active, summary.nr, summary.newMembers, summary.membersDropouts,
            '', '', truncateReportAmount(summary.newLoanDemand), truncateReportAmount(summary.oldLoanDemand), truncateReportAmount(summary.collection), truncateReportAmount(summary.preclosure), truncateReportAmount(summary.newMembersAmount), truncateReportAmount(summary.oldMembersAmount),
            truncateReportAmount(summary.totalAmount), truncateReportAmount(summary.collected), truncateReportAmount(summary.collectionAmount), truncateReportAmount(summary.arrearAmount), truncateReportAmount(summary.outstanding), truncateReportAmount(summary.advance), truncateReportAmount(summary.arrPreAmount),
            truncateReportAmount(summary.charges), truncateReportAmount(summary.bales), truncateReportAmount(summary.lives), truncateReportAmount(summary.rent), truncateReportAmount(summary.chabeeb), truncateReportAmount(summary.classic), truncateReportAmount(summary.applCharges), truncateReportAmount(summary.processingCharges),
        ]);
    }
    return { headers, rows, totalCount: data.length };
}

// ── Tier 3 (force-fit snapshots/drill-downs, per user's explicit request) ──

async function fetchPayslip({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const employeeId = filters?.employeeId;
    const month = filters?.month ? parseInt(filters.month, 10) : NaN;
    const year = filters?.year ? parseInt(filters.year, 10) : NaN;
    if (!employeeId) throw new Error('filters.employeeId is required for the Payslip report');
    if (isNaN(month) || month < 1 || month > 12) throw new Error('filters.month must be a number between 1 and 12');
    if (isNaN(year) || year < 2020) throw new Error('filters.year must be a valid year');

    const employee = await prisma.user.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true, employeeId: true, role: true, branchId: true, branch: { select: { name: true, code: true } } },
    });
    if (!employee) throw new Error('Employee not found');
    if (branchIds && (!employee.branchId || !branchIds.includes(employee.branchId))) throw new Error("You do not have access to this employee's payslip");

    const payRecord = await prisma.salaryPayRecord.findUnique({
        where: { employeeId_month_year: { employeeId, month, year } },
        include: { lineItems: { include: { salaryComponent: { select: { name: true, type: true } } }, orderBy: { salaryComponent: { salaryId: 'asc' } } } },
    });
    if (!payRecord) throw new Error(`No salary record found for ${employee.firstName} ${employee.lastName} for the selected period.`);

    const components = payRecord.lineItems.map((item) => ({ name: item.salaryComponent.name, type: item.salaryComponent.type, amount: Number(item.amount) }));
    const earnings = components.filter((c) => c.type === 'EARNINGS');
    const deductions = components.filter((c) => c.type === 'DEDUCTIONS');
    const maxRows = Math.max(earnings.length, deductions.length);
    const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });
    const paidDate = toDisplayDate(payRecord.createdAt);

    const headers = ['Field', 'Value', '', 'Field', 'Value'];
    const rows: (string | number)[][] = [
        ['Employee Name', `${employee.firstName} ${employee.lastName}`, '', 'Branch', `${employee.branch?.name ?? 'N/A'} (${employee.branch?.code ?? 'N/A'})`],
        ['Employee Code', employee.employeeId ?? 'N/A', '', 'Pay Period', `${monthName} ${year}`],
        ['Designation', employee.role, '', 'Payment Mode', payRecord.paymentType],
        ['Department', 'General', '', 'Paid On', paidDate],
        ['Status', payRecord.status, '', '', ''],
        ['', '', '', '', ''],
        ['EARNINGS', 'Amount (INR)', '', 'DEDUCTIONS', 'Amount (INR)'],
    ];
    for (let i = 0; i < maxRows; i++) {
        rows.push([
            earnings[i]?.name ?? '', earnings[i] ? truncateReportAmount(Number(earnings[i].amount)) : '',
            '', deductions[i]?.name ?? '', deductions[i] ? truncateReportAmount(Number(deductions[i].amount)) : '',
        ]);
    }
    rows.push(['', '', '', '', '']);
    rows.push(['Total Earnings', truncateReportAmount(Number(payRecord.totalEarnings)), '', 'Total Deductions', truncateReportAmount(Number(payRecord.totalDeductions))]);
    rows.push(['', '', '', '', '']);
    rows.push(['NET SALARY PAYABLE', truncateReportAmount(Number(payRecord.netPayable)), '', '', '']);
    return { headers, rows, totalCount: 1 };
}

async function fetchBranchProfile({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const branchId = filters?.branchId ?? (branchIds && branchIds.length === 1 ? branchIds[0] : undefined);
    if (!branchId) throw new Error('A single branch is required for the Branch Profile report');
    if (branchIds && !branchIds.includes(branchId)) throw new Error('You do not have access to this branch');

    const data = await computeBranchProfile(branchId, fromDate ?? null);
    const { branchInfo, reportMeta, sinceApril, currentDay } = data;
    const cdHeader = `On ${reportMeta.branchProfileDate} (${reportMeta.reportDayName})`;
    const headers = ['Field 1', 'Value 1', 'Field 2', 'Value 2', 'Field 3', 'Value 3'];
    const rows: (string | number)[][] = [
        ['Region', branchInfo.regionName, 'Division', branchInfo.divisionName, 'Area', branchInfo.areaName],
        ['Branch ID', branchInfo.branchId, 'Branch Name', branchInfo.branchName, '', ''],
        ['Branch Start Date', branchInfo.branchStartDate, 'Profile Date', reportMeta.branchProfileDate, '', ''],
        ['No. of Centers', branchInfo.noOfCenters, 'No. of Groups', branchInfo.noOfGroups, 'No. of FDOs', branchInfo.noOfFdo],
        ['No. of Members', sinceApril.closingMembers, 'Active Borrowers', sinceApril.activeMembers, 'Arrear Member Count', sinceApril.arrearMemberCount],
        ['Outstanding Balance', truncateReportAmount(currentDay.outstandingBalance), 'Cumulative Arrear', truncateReportAmount(sinceApril.cumulativeArrear), '', ''],
        ['', '', '', '', '', ''],
        ['Particulars', 'Since April', cdHeader, '', '', ''],
        ['Opening Members', sinceApril.openingMembers, currentDay.openingMembers, '', '', ''],
        ['New Members', sinceApril.newMembers, currentDay.newMembers, '', '', ''],
        ['Rejected Members', sinceApril.rejectedMembers, currentDay.rejectedMembers, '', '', ''],
        ['Closing Members', sinceApril.closingMembers, currentDay.closingMembers, '', '', ''],
        ['Waiting Borrowers', sinceApril.waitingBorrowers, currentDay.waitingBorrowers, '', '', ''],
        ['Active Members', sinceApril.activeMembers, currentDay.activeMembers, '', '', ''],
        ['Loan Disbursement (₹)', truncateReportAmount(sinceApril.loanDisbursement), truncateReportAmount(currentDay.loanDisbursement), '', '', ''],
        ['Loan Disbursement Member Count', sinceApril.loanDisbursementMemberCount, '—', '', '', ''],
        ['Outstanding Balance (₹)', '—', truncateReportAmount(currentDay.outstandingBalance), '', '', ''],
        ['Demand Principal (₹)', '—', truncateReportAmount(currentDay.demandPrincipal), '', '', ''],
        ['Demand Interest (₹)', '—', truncateReportAmount(currentDay.demandInterest), '', '', ''],
        ['Demand Total (₹)', '—', truncateReportAmount(currentDay.demandTotal), '', '', ''],
        ['Collected Principal (₹)', '—', truncateReportAmount(currentDay.collectionPrincipal), '', '', ''],
        ['Collected Interest (₹)', '—', truncateReportAmount(currentDay.collectionInterest), '', '', ''],
        ['Total Collection (₹)', '—', truncateReportAmount(currentDay.collectionTotal), '', '', ''],
        ['Cumulative Arrear (₹)', truncateReportAmount(sinceApril.cumulativeArrear), '—', '', '', ''],
        ['Arrear Member Count', sinceApril.arrearMemberCount, '—', '', '', ''],
        ['Arrear Principal (₹)', '—', truncateReportAmount(currentDay.arrearPrincipal), '', '', ''],
        ['Arrear Total (₹)', '—', truncateReportAmount(currentDay.arrearTotal), '', '', ''],
        ['PAR %', sinceApril.parPercent, '—', '', '', ''],
        ['Recovery Rate %', '—', currentDay.recoveryRate, '', '', ''],
        ['Arrear Collection (₹)', '—', truncateReportAmount(currentDay.arrearCollection), '', '', ''],
        ['Advance Collection (₹)', '—', truncateReportAmount(currentDay.advanceCollection), '', '', ''],
    ];
    return { headers, rows, totalCount: 1 };
}

async function fetchCompanyProfile({ fromDate }: ReportFetchParams): Promise<ReportRows> {
    const systemDate = fromDate ? new Date(fromDate) : new Date();
    const eodDate = new Date(systemDate); eodDate.setHours(23, 59, 59, 999);
    const currentYear = systemDate.getMonth() >= 3 ? systemDate.getFullYear() : systemDate.getFullYear() - 1;
    const fyStart = new Date(currentYear, 3, 1);

    const [noOfCenters, noOfGroups, noOfFdo] = await Promise.all([
        prisma.center.count({ where: { isActive: true, createdAt: { lte: eodDate } } }),
        prisma.group.count({ where: { isActive: true, createdAt: { lte: eodDate } } }),
        prisma.user.count({ where: { role: 'FDO', isActive: true, createdAt: { lte: eodDate } } }),
    ]);

    const allClients = await prisma.client.findMany({
        where: { createdAt: { lte: eodDate } },
        select: { createdAt: true, isActive: true, inactiveDate: true, id: true, verificationStatus: true },
    });

    let openingClients = 0, newClients = 0, dropouts = 0, activeClients = 0;
    const openingIds: string[] = [], newIds: string[] = [], dropoutIds: string[] = [];
    for (const client of allClients) {
        if (client.verificationStatus !== 'VERIFIED') continue;
        const isBeforeFY = client.createdAt < fyStart;
        const dropDate = client.inactiveDate;
        const isActiveAtDate = !dropDate || dropDate > eodDate;
        if (isBeforeFY) { if (!dropDate || dropDate >= fyStart) { openingClients++; openingIds.push(client.id); } }
        if (client.createdAt >= fyStart && client.createdAt <= eodDate) { newClients++; newIds.push(client.id); }
        if (dropDate && dropDate >= fyStart && dropDate <= eodDate) { dropouts++; dropoutIds.push(client.id); }
        if (isActiveAtDate) activeClients++;
    }
    const closingClients = activeClients;

    const activeLoansClients = await prisma.loan.groupBy({
        by: ['clientId'],
        where: { disbursementStatus: 'DISBURSED', createdAt: { lte: eodDate }, OR: [{ isActive: true }, { closedDate: { gt: eodDate } }] },
    });
    const clientsWithLoans = new Set(activeLoansClients.map((l) => l.clientId));

    let waitingBorrowers = 0;
    for (const c of allClients) {
        const isActiveAtDate = !c.inactiveDate || c.inactiveDate > eodDate;
        if (isActiveAtDate && c.verificationStatus === 'VERIFIED' && !clientsWithLoans.has(c.id)) waitingBorrowers++;
    }
    const countWithLoan = (ids: string[]) => ids.filter((id) => clientsWithLoans.has(id)).length;
    const openingClientsWithLoan = countWithLoan(openingIds);
    const newClientsWithLoan = countWithLoan(newIds);
    const dropoutClientsWithLoan = countWithLoan(dropoutIds);

    const loansSinceApril = await prisma.loan.aggregate({ where: { disbursementStatus: 'DISBURSED', createdAt: { gte: fyStart, lte: eodDate } }, _sum: { amount: true } });
    const loanDisbursementSinceApril = Number(loansSinceApril._sum.amount || 0);

    const allDisbursedLoansToDate = await prisma.loan.findMany({ where: { disbursementStatus: 'DISBURSED', createdAt: { lte: eodDate } }, select: { amount: true } });
    const totalDisbursedToDate = allDisbursedLoansToDate.reduce((acc, l) => acc + Number(l.amount), 0);
    const txsToDate = await prisma.loanTransaction.aggregate({ where: { transactionDate: { lte: eodDate }, type: 'REPAYMENT' }, _sum: { principalAmount: true } });
    const totalPrincipalCollectedToDate = Number(txsToDate._sum.principalAmount || 0);
    const portfolioOutstanding = totalDisbursedToDate - totalPrincipalCollectedToDate;

    const loansBeforeApril = await prisma.loan.findMany({ where: { createdAt: { lt: fyStart }, disbursementStatus: 'DISBURSED' }, select: { amount: true } });
    const disbursedBeforeApril = loansBeforeApril.reduce((acc, l) => acc + Number(l.amount), 0);
    const txsBeforeApril = await prisma.loanTransaction.aggregate({ where: { transactionDate: { lt: fyStart }, type: 'REPAYMENT' }, _sum: { principalAmount: true } });
    const collectedBeforeApril = Number(txsBeforeApril._sum.principalAmount || 0);
    void (disbursedBeforeApril - collectedBeforeApril); // openingPortfolio — computed for parity, unused downstream (matches live route)

    const fyCollection = await prisma.loanTransaction.aggregate({ where: { transactionDate: { gte: fyStart, lte: eodDate }, type: 'REPAYMENT' }, _sum: { amount: true } });
    const collection = Number(fyCollection._sum.amount || 0);
    const preclosureCount = await prisma.loan.count({ where: { isActive: false, closedDate: { gte: fyStart, lte: eodDate } } });
    const demand = collection > 0 ? collection : 0;
    const recoveryRate = demand > 0 ? (collection / demand) * 100 : 0;

    const functionalData = {
        openingPortfolio: Math.max(0, disbursedBeforeApril - collectedBeforeApril),
        loanDisbursementSinceApril, portfolioOutstanding: Math.max(0, portfolioOutstanding), demand, collection,
        recoveryRate: Number(recoveryRate.toFixed(2)), advance: 0, preclosure: preclosureCount, openingArrear: 0, currentArrear: 0, closingArrear: 0,
    };
    const operationalData = {
        noOfCenters, noOfGroups, noOfFdo, openingClients, openingMembers: openingClients - openingClientsWithLoan, openingClientsWithLoan,
        newClients, newMembers: newClients - newClientsWithLoan, newClientsWithLoan, dropouts, dropoutMembers: dropouts - dropoutClientsWithLoan,
        dropoutClientsWithLoan, closingClients, closingMembers: waitingBorrowers, closingClientsWithLoan: closingClients - waitingBorrowers,
        waitingBorrowers, activeClients,
    };

    const headers = ['Field', 'Value'];
    const rows: (string | number)[][] = [
        ['Report Date', toDisplayDate(systemDate)],
        ['', ''],
        ['Functional Data', ''],
        ['Opening Portfolio 1st April', truncateReportAmount(functionalData.openingPortfolio)],
        ['Loan Disbursement Since April', truncateReportAmount(functionalData.loanDisbursementSinceApril)],
        ['Portfolio Outstanding', truncateReportAmount(functionalData.portfolioOutstanding)],
        ['Demand', truncateReportAmount(functionalData.demand)],
        ['Collection', truncateReportAmount(functionalData.collection)],
        ['Recovery Rate %', functionalData.recoveryRate],
        ['Advance', truncateReportAmount(functionalData.advance)],
        ['Preclosure', functionalData.preclosure],
        ['Opening Arrear 1st April', truncateReportAmount(functionalData.openingArrear)],
        ['Current Arrear', truncateReportAmount(functionalData.currentArrear)],
        ['Closing Arrear', truncateReportAmount(functionalData.closingArrear)],
        ['', ''],
        ['Operational Data', ''],
        ['No. Of Centers', operationalData.noOfCenters],
        ['No. Of Groups', operationalData.noOfGroups],
        ['No. Of FDO', operationalData.noOfFdo],
        ['Opening (Total)', operationalData.openingClients],
        ['Opening Members', operationalData.openingMembers],
        ['Opening Clients', operationalData.openingClientsWithLoan],
        ['New (Total)', operationalData.newClients],
        ['New Members', operationalData.newMembers],
        ['New Clients', operationalData.newClientsWithLoan],
        ['Dropouts', operationalData.dropouts],
        ['Closing (Total)', operationalData.closingClients],
        ['Closing Members', operationalData.closingMembers],
        ['Closing Clients', operationalData.closingClientsWithLoan],
        ['Waiting Borrowers', operationalData.waitingBorrowers],
        ['Active Clients', operationalData.activeClients],
    ];
    return { headers, rows, totalCount: 1 };
}

async function fetchNeftFormat({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const indexIds = filters?.indexIds?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!indexIds || indexIds.length === 0) throw new Error('filters.indexIds is required for the NEFT Format report');

    const loans = await prisma.loan.findMany({
        where: { indexId: { in: indexIds }, isActive: true, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
        select: {
            loanNumber: true, amount: true,
            branch: { select: { code: true, name: true, areas: { select: { name: true, division: { select: { name: true, region: { select: { name: true } } } } } } } },
            center: { select: { code: true, name: true } },
            client: { select: { clientId: true, firstName: true, lastName: true, bankAcNo: true, bankName: true, bankBranch: true, ifscCode: true } },
        },
        orderBy: { client: { firstName: 'asc' } },
    });

    const headers = ['S NO', 'REGION NAME', 'DIVISION NAME', 'AREA NAME', 'BRANCH ID', 'BRANCH NAME', 'CENTRE ID', 'CENTER NAME', 'LOAN ID', 'MEMBER ID', 'IFSC CODE', 'ACCOUNT NUMBER', 'MEMBER NAME', 'BANK NAME', 'BANK BRANCH NAME', 'LOAN AMOUNT'];
    let totalLoanAmount = 0;
    const rows: (string | number)[][] = loans.map((loan, index) => {
        const amt = Number(loan.amount);
        totalLoanAmount += amt;
        return [
            index + 1, loan.branch?.areas?.[0]?.division?.region?.name || '', loan.branch?.areas?.[0]?.division?.name || '', loan.branch?.areas?.[0]?.name || '',
            loan.branch?.code || '', loan.branch?.name || '', loan.center?.code || '', loan.center?.name || '', loan.loanNumber, loan.client.clientId,
            loan.client.ifscCode || '', loan.client.bankAcNo || '', `${loan.client.firstName} ${loan.client.lastName}`, loan.client.bankName || '', loan.client.bankBranch || '', truncateReportAmount(amt),
        ];
    });
    if (loans.length > 0) rows.push(['', 'Grand Total', '', '', '', '', '', '', '', '', '', '', '', '', '', truncateReportAmount(totalLoanAmount)]);
    return { headers, rows, totalCount: loans.length };
}

function taskRowToObj(r: Record<string, any>) {
    return {
        'Employee ID': r.employeeId || '', 'Name': r.name, 'Branch': r.branch,
        'Enr. Target': r.enrollmentTarget, 'New Member Target': r.newMemberTarget, 'Renewal Target': r.renewalTarget, 'Disbmt Target (₹)': truncateReportAmount(r.loanDisbursementTarget),
        'Enr. Achieved': r.enrollmentAchieved, 'Enr. Balance': r.enrollmentBalance, 'New Member Achieved': r.newMemberAchieved, 'Renewal Achieved': r.renewalAchieved,
        'Disbmt Achieved (₹)': truncateReportAmount(r.loanDisbursementAchieved), 'Coll. Target %': r.collectionTargetPct, 'Actual Coll. %': r.actualCollectionPct, 'Coll. Diff %': r.collectionDifferencePct,
        'No. Centers': r.numberOfCenters, 'Active (Total)': r.activeClients, 'Active Members': r.activeMembers, 'Active Clients': r.activeClientsWithLoan,
        'Disbmt Members': r.totalDisbursementMembers, 'Gold Loan Members': r.goldLoanMembers, 'Gold Loan Amount (₹)': truncateReportAmount(r.goldLoanAmount), 'Gold Returns': r.goldReturn,
        'Portfolio Principal (₹)': truncateReportAmount(r.portfolioPrincipal), 'Portfolio Interest (₹)': truncateReportAmount(r.portfolioInterest), 'Arrear Clients': r.arrearClients,
        'Arrear Principal (₹)': truncateReportAmount(r.arrearPrincipal), 'Arrear Interest (₹)': truncateReportAmount(r.arrearInterest), 'Arrear Member %': r.arrearMemberPct,
    };
}

async function fetchTaskReport({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const month = filters?.month ? parseInt(filters.month, 10) : NaN;
    const year = filters?.year ? parseInt(filters.year, 10) : NaN;
    if (isNaN(month) || month < 1 || month > 12 || isNaN(year)) throw new Error('filters.month (1-12) and filters.year are required for the FDO Task Report');

    // computeTaskReport only accepts a single branchId — branchIds here is already
    // permission-scoped by the caller (POST /api/report-requests), so a restricted
    // (non-admin) requester always has at least one entry; use it rather than
    // silently falling through to "all branches" and leaking cross-branch data.
    const branchId = filters?.branchId ?? branchIds?.[0] ?? null;
    const data = await computeTaskReport(month, year, branchId, null);
    const sample = taskRowToObj(data.totals);
    const headers = ['Level', ...Object.keys(sample)];
    const levelGroups: [string, Record<string, any>[]][] = [
        ['FDO', data.fdo], ['Branch Manager', data.bm], ['Area Manager', data.am], ['Division Manager', data.dm],
    ];
    const rows: (string | number)[][] = [];
    for (const [label, group] of levelGroups) {
        for (const r of group) rows.push([label, ...Object.values(taskRowToObj(r))]);
    }
    rows.push(['Overall Summary', ...Object.values(sample)]);
    return { headers, rows, totalCount: data.fdo.length };
}

// Batch 4B: reuses computeLoanIndexReport() — the same cookie-free helper already shared by
// the live GET route and the Queue PDF renderer (loan-index-pdf-queue.ts) — instead of a
// separate, narrower set of Prisma queries. This closes the previously-documented gap (Excel/
// CSV/Word missing High Mark Score and using a simpler Purpose fallback than Direct) without
// adding any new query: computeLoanIndexReport already selects highmarkReports and computes
// the same purpose/O.S./arrear values Direct's own LoanIndexClient.buildLoanIndexExportRows()
// uses. No PDF impact — the PDF path calls computeLoanIndexReport directly and never went
// through this function.
async function fetchLoanIndex({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const indexId = filters?.indexId;
    if (!indexId) throw new Error('filters.indexId is required for the Loan Index report');

    const result = await computeLoanIndexReport(indexId);
    if (!result) throw new Error('Loan Index not found');
    if (branchIds && !branchIds.includes(result.branchId)) throw new Error('Loan Index not found');

    const loansData = result.reportData.loans;
    const headers = ['SL No', 'Client ID', 'Client Name', 'Nominee', 'High Mark Score', 'Loan O/S', 'Arrear', 'Cycle', 'Loan Amount', 'Tenure', 'Purpose'];
    const rows: (string | number)[][] = loansData.map((loan) => [
        loan.slNo, loan.clientId, loan.clientName, loan.nominee, loan.highmarkScore ?? loan.highmarkStatus ?? 'N/A',
        truncateReportAmount(loan.loanOs), truncateReportAmount(loan.arrear), loan.loanSlNo, truncateReportAmount(loan.loanAmount), loan.totalDues, loan.purpose,
    ]);
    if (loansData.length > 0) {
        const totalClientOs = loansData.reduce((s, l) => s + l.loanOs, 0);
        const totalClientArrear = loansData.reduce((s, l) => s + l.arrear, 0);
        const totalLoanAmount = loansData.reduce((s, l) => s + l.loanAmount, 0);
        rows.push(['TOTALS:', '', '', '', '', truncateReportAmount(totalClientOs), truncateReportAmount(totalClientArrear), '', truncateReportAmount(totalLoanAmount), '', '']);
    }
    return { headers, rows, totalCount: loansData.length };
}

function ledgerNum(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    if (value && typeof value === 'object' && 'toString' in value) return Number((value as { toString: () => string }).toString());
    return 0;
}

// Formats a date exactly like LoanLedgerReport.tsx's own formatDateTime() (DD-MM-YYYY
// HH:mm AM/PM) rather than the generic toLocaleString('en-IN') used elsewhere in this file —
// this report's Direct export uses that specific format, so it's reproduced verbatim here.
function fmtLoanLedgerDate(d: Date | string | null): string {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
    return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
}

// Batch 4B: reuses computeLoanLedgerDues() — the same cookie-free helper already shared by
// the live route and the Queue PDF renderer (loan-ledger-pdf-queue.ts) — instead of a
// separate, narrower set of Prisma queries. This closes the previously-documented 8-column
// gap (Arrear Amt, Penalty Pri, Penalty Int, Penalty Total, Group Officer, Collected By,
// Funder, Arrear Receive) without any new query: computeLoanLedgerDues already computes
// arrearTotal/collectedPenalty/collectedByName per row and groupOfficerName/funderName on
// its header, exactly mirroring LoanLedgerReport.buildLoanLedgerExportRows(). "Penalty Pri"/
// "Penalty Int" are hardcoded 0 here because Direct's own export hardcodes them too (no
// principal/interest split of collected penalty exists in either data source) — reproducing
// that faithfully rather than inventing a split. No PDF impact — the PDF path calls
// computeLoanLedgerDues directly and never went through this function.
async function fetchLoanLedger({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const { loanId, centerId, clientId } = filters ?? {};
    if (!loanId || !centerId || !clientId) throw new Error('filters.loanId, filters.centerId and filters.clientId are required for the Loan Ledger report');

    const result = await computeLoanLedgerDues(loanId, clientId, centerId);
    if (!result) throw new Error('Loan not found');
    if (branchIds && (!result.branchId || !branchIds.includes(result.branchId))) throw new Error('Unauthorized center access');

    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const { header, rows, totals } = result;
    const headers = [
        'Due No', 'Due Date', 'Coll Date', 'Due Pri Amt', 'Due Int Amt', 'Due Amt',
        ...(loanAdvanceEnabled ? ['Loan Adv Due'] : []),
        'Coll Pri', 'Coll Int', 'Coll Amt',
        ...(loanAdvanceEnabled ? ['Loan Adv Coll'] : []),
        'Due Balance', 'Arrear Amt',
        'Penalty Pri', 'Penalty Int', 'Penalty Total', 'Group Officer', 'Collected By', 'Funder', 'Arrear Receive',
    ];
    const exportRows: (string | number)[][] = rows.map((r) => [
        r.dueNo, fmtLoanLedgerDate(r.dueDate), fmtLoanLedgerDate(r.collectionDate),
        truncateReportAmount(r.duePrincipal), truncateReportAmount(r.dueInterest), truncateReportAmount(r.dueAmount),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.dueSavings)] : []),
        truncateReportAmount(r.collectedPrincipal), truncateReportAmount(r.collectedInterest), truncateReportAmount(r.collectedAmount),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.collectedSavings)] : []),
        truncateReportAmount(r.dueBalance), truncateReportAmount(r.arrearTotal),
        0, 0, truncateReportAmount(r.collectedPenalty), header.groupOfficerName ?? '', r.collectedByName ?? '', header.funderName ?? '', truncateReportAmount(r.arrearTotal),
    ]);
    if (rows.length > 0) {
        exportRows.push([
            'Total', '', '',
            truncateReportAmount(totals.duePrincipal), truncateReportAmount(totals.dueInterest), truncateReportAmount(totals.dueAmount),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.dueSavings)] : []),
            truncateReportAmount(totals.collectedPrincipal), truncateReportAmount(totals.collectedInterest), truncateReportAmount(totals.collectedAmount),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.collectedSavings)] : []),
            truncateReportAmount(totals.dueBalance),
            '', '', '', '', '', '', '', '',
        ]);
    }
    return { headers, rows: exportRows, totalCount: rows.length };
}

async function fetchLoanSchedule({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const loanId = filters?.loanId;
    if (!loanId) throw new Error('filters.loanId is required for the Loan Schedule report');

    const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
            client: { select: { clientId: true, firstName: true, lastName: true } },
            center: { select: { name: true } },
            schedules: {
                orderBy: { installmentNo: 'asc' },
                include: {
                    transactionLines: {
                        where: { transaction: { isReversed: false, status: { in: ['PENDING', 'APPROVED'] as any } } },
                        select: { lineTotal: true, principalAmount: true, interestAmount: true, transaction: { select: { transactionDate: true } } },
                    },
                },
            },
        },
    });
    if (!loan) throw new Error('Loan not found');
    if (branchIds && (!loan.branchId || !branchIds.includes(loan.branchId))) throw new Error('Unauthorized loan access');
    if (loan.schedules.length === 0) throw new Error('This loan has no saved repayment schedule to export');

    const disbursedDate = loan.disbursedByBMAt || loan.disbursedLevel1At || loan.createdAt;
    let runningBalance = Number(loan.amount);
    const schedule = loan.schedules.map((s) => {
        runningBalance -= Number(s.principalDue);
        const collection = aggregateCollectionFromTransactionLines(s.transactionLines as any);
        return {
            installmentNo: s.installmentNo, dueDate: s.dueDate, principal: Number(s.principalDue),
            interest: Number(s.interestDue), savingsDue: Number(s.savingsDue || 0), savingsPaid: Number(s.savingsPaid || 0),
            totalDue: Number(s.totalDue), balance: Math.max(0, runningBalance),
        };
    });

    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const fmtDT = (d: Date) => toDisplayDateTime(new Date(d));
    const headers = [
        'No.', 'Due Date', 'Principal', 'Interest',
        ...(loanAdvanceEnabled ? ['Loan Advance Due', 'Loan Advance Paid'] : []),
        'Total Due', 'Balance',
    ];
    const scheduleRows: (string | number)[][] = schedule.map((row) => [
        row.installmentNo, fmtDT(row.dueDate), truncateReportAmount(row.principal), truncateReportAmount(row.interest),
        ...(loanAdvanceEnabled ? [truncateReportAmount(row.savingsDue), truncateReportAmount(row.savingsPaid)] : []),
        truncateReportAmount(row.totalDue), truncateReportAmount(row.balance),
    ]);
    const totPri = schedule.reduce((s, r) => s + r.principal, 0);
    const totInt = schedule.reduce((s, r) => s + r.interest, 0);
    const totDue = schedule.reduce((s, r) => s + r.savingsDue, 0);
    const totPaid = schedule.reduce((s, r) => s + r.savingsPaid, 0);
    const totTotal = schedule.reduce((s, r) => s + r.totalDue, 0);
    scheduleRows.push([
        'Grand Total', '', truncateReportAmount(totPri), truncateReportAmount(totInt),
        ...(loanAdvanceEnabled ? [truncateReportAmount(totDue), truncateReportAmount(totPaid)] : []),
        truncateReportAmount(totTotal), 0,
    ]);

    const padWidth = headers.length;
    const blankRow = Array(padWidth).fill('');
    const rows: (string | number)[][] = [
        ['Client Name', `${loan.client.firstName} ${loan.client.lastName}`.trim(), 'Client ID', loan.client.clientId, ...Array(padWidth - 4).fill('')],
        ['Loan Account', loan.loanNumber, 'Center', loan.center?.name ?? '', ...Array(padWidth - 4).fill('')],
        ['Loan Amount', truncateReportAmount(Number(loan.amount)), 'Interest Rate', `${Number(loan.interestRate)}%`, ...Array(padWidth - 4).fill('')],
        ['Tenure', `${loan.tenureMonths} Months`, 'Frequency', loan.frequency ?? '', ...Array(padWidth - 4).fill('')],
        ['Disbursement Date', fmtDT(disbursedDate), 'Loan End Date', schedule.length > 0 ? fmtDT(schedule[schedule.length - 1].dueDate) : 'N/A', ...Array(padWidth - 4).fill('')],
        blankRow,
        ...scheduleRows,
    ];
    return { headers, rows, totalCount: schedule.length };
}

/**
 * Loan Passbook has no export mapper anywhere today — the live page is a bespoke
 * Tamil-formatted PDF generator (POST /api/generate-passbook), not a tabular report.
 * This produces a plain generic tabular history of the same underlying schedule
 * data instead of replicating that bespoke document.
 */
async function fetchLoanPassbook({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const loanId = filters?.loanId;
    if (!loanId) throw new Error('filters.loanId is required for the Loan Passbook report');

    const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: {
            branchId: true, loanNumber: true,
            client: { select: { clientId: true, firstName: true, lastName: true } },
            schedules: {
                orderBy: { installmentNo: 'asc' },
                select: {
                    installmentNo: true, dueDate: true, totalDue: true, paidAt: true,
                    transactionLines: {
                        where: { transaction: { isReversed: false, status: { in: ['PENDING', 'APPROVED'] as any } } },
                        select: { lineTotal: true, principalAmount: true, interestAmount: true, transaction: { select: { transactionDate: true } } },
                    },
                },
            },
        },
    });
    if (!loan) throw new Error('Loan not found');
    if (branchIds && (!loan.branchId || !branchIds.includes(loan.branchId))) throw new Error('Unauthorized loan access');

    let balance = 0;
    const rows: (string | number)[][] = [];
    for (const s of loan.schedules) {
        const dueAmount = Number(s.totalDue);
        const collection = aggregateCollectionFromTransactionLines(s.transactionLines as any);
        const paidAmount = collection.total || 0;
        const paidDate = s.paidAt ?? collection.latestTransactionDate;
        balance += dueAmount - paidAmount;
        rows.push([
            s.installmentNo, toDisplayDate(new Date(s.dueDate)), truncateReportAmount(dueAmount),
            paidDate ? toDisplayDate(new Date(paidDate)) : '', truncateReportAmount(paidAmount), truncateReportAmount(Math.max(0, balance)),
        ]);
    }
    const headers = ['Due No', 'Due Date', 'Due Amount', 'Paid Date', 'Paid Amount', 'Balance'];
    return { headers, rows, totalCount: loan.schedules.length };
}

// ── Queue adapters added for the 26 catalog-only reports (registered above but
// previously fetch-less, so "Request Report only" was permanently disabled for
// them). Grouped/commented per the implementation-pattern categories from the
// planning pass: clean lifts, then fresh-authored exports over an existing
// clean data function, then duplicated/extended query logic, then Server
// Action refactors. ──

async function fetchOSBranchwise({ fromDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Outstanding Branchwise report');
    const data = await getOSBranchwiseData(fromDate, branchIds ?? undefined);
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const headers = [
        'Branch Code', 'Branch Name', 'No. of Clients', 'OS Principal', 'OS Interest',
        ...(loanAdvanceEnabled ? ['OS Loan Advance'] : []),
        'Arr. Clients', 'Arrear Principal', 'Arrear Interest',
        ...(loanAdvanceEnabled ? ['Arrear Loan Advance'] : []),
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.branchCode, r.branchName, r.noOfClients, truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.osSavings ?? 0)] : []),
        r.arrClients, truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.arrearSavings ?? 0)] : []),
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchMisAllDcb({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the All Branch DCB report');
    const data = await getAllBranchDCBData(fromDate, toDate, branchIds ?? undefined);
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const headers = [
        'Branch Name', 'Meeting Date', '# Centers', '# Clients', 'Opening Arr', 'Demand', 'Current Coll', 'Rec %',
        'Curr Arr Coll', 'OD Arr Coll',
        ...(loanAdvanceEnabled ? ['Advance Coll'] : []),
        'Preclosure', 'Total Coll', 'Curr Arrear', 'Closing Arr',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.branchName, r.meetingDate, r.centers, r.clients, truncateReportAmount(r.openingArr), truncateReportAmount(r.demand), truncateReportAmount(r.currentColl),
        r.recPercentage, truncateReportAmount(r.currArrColl), truncateReportAmount(r.odArrColl),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.advanceColl)] : []),
        truncateReportAmount(r.preclosure),
        truncateReportAmount(r.totalColl), truncateReportAmount(r.currArrear), truncateReportAmount(r.closingArr),
    ]);
    return { headers, rows, totalCount: data.length };
}

/** Route caps this at a 90-day range (a wider window drives an expensive per-calendar-day JS loop) — replicated here since the underlying action has no such guard itself. */
async function fetchMisBranchDemand({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the MIS Branch Demand report');
    const days = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000;
    if (days > 90) throw new Error('Date range cannot exceed 90 days for the MIS Branch Demand report');
    const result = await getMISBranchDemandData(fromDate, toDate, branchIds ?? undefined);
    const headers = ['Meeting Date', 'Branch Code', 'Branch Name', 'FDO Code', 'FDO Name', 'Centers', 'Loan OS', 'Arrear', 'Curr Demand', 'Total Demand'];
    const rows: (string | number)[][] = result.data.map((r) => [
        r.meetingDate, r.branchCode, r.branchName, r.fdoCode, r.fdoName, r.centers,
        truncateReportAmount(r.loanOS), truncateReportAmount(r.arrear), truncateReportAmount(r.currDemand), truncateReportAmount(r.totalDemand),
    ]);
    // getMISBranchDemandData already computes `totals` server-side (same authoritative
    // source the Direct page's own TOTAL row uses) — reused rather than re-summing `rows`.
    if (result.totals) {
        rows.push([
            'TOTAL', '', '', '', '',
            result.totals.totalCenters, truncateReportAmount(result.totals.totalLoanOS), truncateReportAmount(result.totals.totalArrear),
            truncateReportAmount(result.totals.totalCurrDemand), truncateReportAmount(result.totals.totalDemand),
        ]);
    }
    return { headers, rows, totalCount: result.data.length };
}

async function fetchIndividualLedger({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Individual Ledger report');
    const data = await getIndividualLedgerData(fromDate, toDate, branchIds ?? undefined);
    const headers = ['BRANCH ID', 'CENTER ID', 'CENTER NAME', 'OS_OWNFUND', 'CL_OWNFUND'];
    const rows: (string | number)[][] = data.map((r) => [r.branchId, r.centerId, r.centerName, truncateReportAmount(r.osOwnFund), truncateReportAmount(r.clOwnFund)]);
    // Mirrors the Direct page's TOTAL row — a plain reduce over the same already-fetched `data`.
    if (data.length > 0) {
        rows.push(['TOTAL', '', '', truncateReportAmount(data.reduce((s, r) => s + r.osOwnFund, 0)), truncateReportAmount(data.reduce((s, r) => s + r.clOwnFund, 0))]);
    }
    return { headers, rows, totalCount: data.length };
}

async function fetchLoanDisbursement({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Loan Disbursement report');
    const centerId = filters?.centerId || 'all';
    const data = await getLoanDisbursementData(centerId, fromDate, toDate, branchIds ?? undefined);
    const headers = [
        'S.No.', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Product Type', 'Loan Product',
        'Loan ID', 'Member ID', 'Member Name', 'Aadhaar Number', 'Phone Number', 'Loan Cycle', 'FDO Name', 'Purpose Of Loan', 'Loan Index ID', 'LD Date',
        'LD Time', 'Start Date', 'End Date', 'Admission Fee', 'Processing Fees', 'CGST', 'SGST', 'Insurance Fee', 'Installment Type', 'Number Of Installments',
        'Rate Of Interest', 'Loan Principal', 'Loan Interest', 'Loan Total Amount', 'Gold Weight', 'Gold Value on Date of Disbursement', 'Funding Name',
        'Loan Status', 'Loan Approval', 'Center Transfer',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.slNo, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName, r.centreId, r.centerName, r.productType, r.loanProduct,
        r.loanId, r.memberId, r.memberName, r.aadhaarNumber, r.phoneNumber, r.loanCycle, r.fdoName, r.purposeOfLoan, r.loanIndexId, r.ldDate,
        r.ldTime, r.startDate, r.endDate, truncateReportAmount(r.admissionFee), truncateReportAmount(r.processingFees), truncateReportAmount(r.cgst),
        truncateReportAmount(r.sgst), truncateReportAmount(r.insuranceFee), r.installmentType, r.numberOfInstallments,
        r.rateOfInterest, truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanTotalAmount), r.goldWeight,
        truncateReportAmount(r.goldValuePerGram), r.fundingName,
        r.loanStatus, r.loanApproval, r.centerTransfer,
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchOSCenterwise({ fromDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Loan OS Center report');
    const result = await getOSCenterwiseData(fromDate, branchIds ?? undefined);
    const headers = ['Branch Name', 'Center Name', 'No. of Clients', 'OS Principal', 'OS Interest', 'Arrear Clients', 'Arrear Principal', 'Arrear Interest'];
    const rows: (string | number)[][] = result.data.map((r) => [
        r.branchName, r.centerName, r.noOfClients, truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest), r.arrClients,
        truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt),
    ]);
    // getOSCenterwiseData already computes `totals` server-side (same authoritative source
    // the Direct page's own TOTAL row uses) — reused rather than re-summing `rows`.
    if (result.totals) {
        rows.push([
            'TOTAL', '', result.totals.totalClients, truncateReportAmount(result.totals.totalOSPrincipal), truncateReportAmount(result.totals.totalOSInterest),
            result.totals.totalArrClients, truncateReportAmount(result.totals.totalArrearPri), truncateReportAmount(result.totals.totalArrearInt),
        ]);
    }
    return { headers, rows, totalCount: result.data.length };
}

async function fetchClientwiseDcb({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Clientwise DCB report');
    const centerId = filters?.centerId || 'all';
    const data = await getClientwiseDCBData(fromDate, toDate, centerId, branchIds ?? undefined);
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const headers = [
        'Branch', 'Center', 'FDO Name', 'A/C No', 'Client Name', 'Phone', 'Loan A/C', 'Meeting Date',
        'Opening Due', 'Curr Demand', 'Curr Collection', 'Curr Arr', 'OS Arr Call',
        ...(loanAdvanceEnabled ? ['Adv'] : []),
        'Preclosure', 'Total Call', 'Curr Arr Amt', 'Closing Arr',
    ];
    const rows: (string | number)[][] = data.map((r) => [
        r.branchName, r.centerName, r.fdoName, r.accountNo, r.clientName, r.phone, r.loanAc, r.meetingDate,
        truncateReportAmount(r.openingDue), truncateReportAmount(r.currentDemand), truncateReportAmount(r.currentCollection),
        truncateReportAmount(r.currentArrear), truncateReportAmount(r.osArrearCall),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.advance)] : []),
        truncateReportAmount(r.preclosure),
        truncateReportAmount(r.totalCall), truncateReportAmount(r.currentArrearAmount), truncateReportAmount(r.closingArrear),
    ]);
    return { headers, rows, totalCount: data.length };
}

// fetchPortfolioAgewiseArrear (PAR / Agewise Arrear variant) — business logic/parity untouched
// per that report's exclusion; only the new amount-truncation display requirement is applied.
async function fetchPortfolioAgewiseArrear({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Agewise Arrear report');
    const centerId = filters?.centerId || 'all';
    const data = await getAgewiseArrearData(fromDate, centerId, branchIds ?? undefined);
    const headers = ['Branch', 'Center', 'Client Name', 'Phone', 'Loan A/C', 'Loan Amt', 'Pri Balance', 'Total Dues', 'Disbursal', '1-30 Days', '31-60 Days', '61-90 Days', '91-180 Days', '>180 Days', 'Arrear Pri', 'Arrear Int', 'Total Arrear', 'FDO'];
    const rows: (string | number)[][] = data.map((r) => [
        r.branchName, r.centerName, r.clientName, r.phone, r.loanAccount, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance), truncateReportAmount(r.totalDues), r.disbursalDate,
        truncateReportAmount(r.days1to30), truncateReportAmount(r.days31to60), truncateReportAmount(r.days61to90), truncateReportAmount(r.days91to180), truncateReportAmount(r.above180),
        truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.totalArrear), r.fdoName,
    ]);
    return { headers, rows, totalCount: data.length };
}

const OS_CLIENTWISE_HEADERS = ['Branch Name', 'Center Name', 'Client Name', 'Disbursal Date', 'Loan Amount', 'Due Start Date', 'Tenure', 'Loan A/c', 'OS Principle', 'OS Interest', 'Arrear Pri', 'Arrear Int', 'Funder', 'Mobile #'];
function osClientwiseRowsOf(data: Awaited<ReturnType<typeof getOSClientwiseData>>['data']): (string | number)[][] {
    return data.map((r) => [
        r.branchName, r.centerName, r.clientName, r.disbursalDate, truncateReportAmount(r.loanAmount), r.dueStartDate, r.tenure, r.loanAc,
        truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), r.funder, r.mobileNo,
    ]);
}

/** Shared by both `os-clientwise-admin` and `loan-os-client` — two separate page UIs over the same `getOSClientwiseData` query/columns (see report-registry planning notes). */
async function fetchOSClientwiseCore({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the OS Clientwise report');
    const result = await getOSClientwiseData(
        fromDate, 1, 0,
        { centerId: filters?.centerId, funderId: filters?.funderId, search: undefined, branchId: branchIds ?? undefined },
        true
    );
    return { headers: OS_CLIENTWISE_HEADERS, rows: osClientwiseRowsOf(result.data), totalCount: result.data.length };
}

async function fetchHighmarkLog({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    // Matches app/api/highmark/register/route.ts's own literal-UTC boundary construction
    // (this report's dates are stored/filtered as plain UTC instants, not IST business
    // days like most other reports) so results match what the live page shows exactly.
    const result = await highmarkService.getRegister({
        branchIds: branchIds ?? undefined,
        centerId: filters?.centerId,
        fromDate: fromDate ? new Date(`${fromDate}T00:00:00.000Z`) : undefined,
        toDate: toDate ? new Date(`${toDate}T23:59:59.999Z`) : undefined,
        skip: 0,
        take: 100000, // no unpaginated mode on the service — pass an explicit large cap instead
    });
    const headers = ['Pulled at', 'Subject', 'Aadhaar', 'Client', 'Requested by', 'Branch', 'Score', 'Status', 'Cost'];
    const rows: (string | number)[][] = result.items.map((r) => [
        toDisplayDateTime(new Date(r.pulledAt)),
        `${r.firstName} ${r.lastName ?? ''}`.trim(),
        r.aadhaarMasked,
        r.client ? `${r.client.firstName} ${r.client.lastName} (${r.client.clientId})` : '',
        r.requestedBy ? `${r.requestedBy.firstName} ${r.requestedBy.lastName}` : '',
        r.branch ? `${r.branch.name} (${r.branch.code})` : '',
        r.creditScore ?? '',
        r.status,
        truncateReportAmount(Number(r.creditsCharged)),
    ]);
    return { headers, rows, totalCount: result.items.length };
}

/**
 * Duplicates app/api/reports/others/pending-items/route.ts's 6-way issueType switch —
 * that route has no reusable pure function to import, and its queries are all
 * single-branch (scalar branchId), so unlike most other reports there's no "all
 * branches" aggregate here either; the caller must resolve to exactly one branch.
 */
async function fetchPendingItems({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!branchIds || branchIds.length !== 1) throw new Error('Select exactly one branch for the Pending Items report');
    const branchId = branchIds[0];
    const issueType = filters?.issueType;
    if (!issueType) throw new Error('filters.issueType is required for the Pending Items report');

    const branchLock = await prisma.branchLock.findUnique({ where: { branchId } });
    const workingDate = branchLock ? startOfDay(new Date(branchLock.currentWorkingDate)) : startOfDay(new Date());
    const dayStart = startOfDay(workingDate);
    const dayEnd = endOfDay(workingDate);

    let results: { centerId: string; centerName: string; fdo: string; meetingDay: string | null; meetingTime: string | null; nextMeetingDate: string }[] = [];

    switch (issueType) {
        case 'center_meeting': {
            const meetingDayName = getMeetingDayName(getKolkataCalendarYmd(workingDate));
            const scheduledCenters = await prisma.center.findMany({
                where: { branchId, isActive: true, status: 'APPROVED', ...buildMeetingDayVariantOrFilter(meetingDayName) },
                include: { fdo: { select: { firstName: true, lastName: true } } },
            });
            const centerIds = scheduledCenters.map((c) => c.id);
            const centersWithTransactions = await prisma.loanTransaction.findMany({
                where: { centerId: { in: centerIds }, transactionDate: { gte: dayStart, lte: dayEnd }, type: { in: ['REPAYMENT', 'INTEREST_POSTING'] } },
                select: { centerId: true },
                distinct: ['centerId'],
            });
            const centersWithActionIds = new Set(centersWithTransactions.map((t) => t.centerId));
            results = scheduledCenters
                .filter((c) => !centersWithActionIds.has(c.id))
                .map((c) => ({
                    centerId: c.code,
                    centerName: c.name,
                    fdo: c.fdo ? `${c.fdo.firstName} ${c.fdo.lastName}` : 'Unassigned',
                    meetingDay: c.meetingDay,
                    meetingTime: c.meetingTime,
                    nextMeetingDate: (() => {
                        const ymd = computeNextMeetingDateYmd(c.meetingDay, workingDate);
                        return ymd ? formatYmdToDmy(ymd) : 'N/A';
                    })(),
                }));
            break;
        }
        case 'center_approval': {
            const pendingCenters = await prisma.center.findMany({
                where: { branchId, status: 'PENDING_APPROVAL' },
                include: { createdBy: { select: { firstName: true, lastName: true } } },
            });
            results = pendingCenters.map((c) => ({
                centerId: c.code,
                centerName: c.name,
                fdo: `${c.createdBy.firstName} ${c.createdBy.lastName}`,
                meetingDay: c.meetingDay,
                meetingTime: c.meetingTime,
                nextMeetingDate: c.createdAt ? formatDateFns(c.createdAt, 'dd/MM/yyyy') : 'N/A',
            }));
            break;
        }
        case 'member_approval': {
            const pendingClients = await prisma.client.findMany({
                where: { center: { branchId }, verificationStatus: 'PENDING_VERIFICATION' },
                include: { center: true, enrolledBy: true },
            });
            results = pendingClients.map((c) => ({
                centerId: c.clientId,
                centerName: c.firstName + ' ' + c.lastName,
                fdo: `${c.enrolledBy.firstName} ${c.enrolledBy.lastName}`,
                meetingDay: c.center?.name ?? '',
                meetingTime: 'N/A',
                nextMeetingDate: c.createdAt ? formatDateFns(c.createdAt, 'dd/MM/yyyy') : 'N/A',
            }));
            break;
        }
        case 'loan_disbursement': {
            const pendingLoans = await prisma.loan.findMany({
                where: { branchId, disbursementStatus: { in: ['PENDING_LEVEL1', 'PENDING_LEVEL2'] } },
                include: { client: true, center: true },
            });
            results = pendingLoans.map((l) => ({
                centerId: l.loanNumber,
                centerName: l.client.firstName + ' ' + l.client.lastName,
                fdo: l.center?.name ?? '',
                meetingDay: formatReportAmount(l.amount.toNumber()),
                meetingTime: l.disbursementStatus,
                nextMeetingDate: l.createdAt ? formatDateFns(l.createdAt, 'dd/MM/yyyy') : 'N/A',
            }));
            break;
        }
        case 'session_out': {
            const activeSessions = await prisma.attendance.findMany({
                where: { date: { gte: dayStart, lte: dayEnd }, status: { in: ['PRESENT', 'HALF_DAY'] }, checkOut: null, user: { branchId } },
                include: { user: true },
            });
            results = activeSessions.map((s) => ({
                centerId: (s.user.email ?? '').split('@')[0],
                centerName: `${s.user.firstName} ${s.user.lastName}`,
                fdo: s.user.role,
                meetingDay: s.checkIn ? formatDateFns(s.checkIn, 'hh:mm a') : 'N/A',
                meetingTime: s.status,
                nextMeetingDate: formatDateFns(s.date, 'dd/MM/yyyy'),
            }));
            break;
        }
        case 'preclosure_approval':
        default:
            results = []; // unimplemented upstream (route.ts:199-203) — replicated as-is
    }

    const headers =
        issueType === 'member_approval' ? ['CLIENT ID', 'CLIENT NAME', 'ENROLLED BY', 'CENTER', '---', 'ENROLL DATE']
        : issueType === 'loan_disbursement' ? ['LOAN NO', 'CLIENT NAME', 'CENTER', 'AMOUNT', 'STATUS', 'APPLY DATE']
        : issueType === 'session_out' ? ['USER ID', 'USER NAME', 'ROLE', 'LOGIN TIME', 'STATUS', 'DATE']
        : ['CENTERID', 'CENTERNAME', 'FDO', 'MEETINGDAY', 'MEETINGTIME', 'NEXTMEETINGDATE'];
    const rows: (string | number)[][] = results.map((r) => [r.centerId, r.centerName, r.fdo, r.meetingDay ?? '', r.meetingTime ?? '', r.nextMeetingDate]);
    return { headers, rows, totalCount: results.length };
}

/** Skips resolveApplicationFormKycUrls() (the live route's GCS signed-URL resolution) — the export never uses kycDocuments. */
async function fetchApplicationForm({ branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const centerId = filters?.centerId;
    if (!centerId) throw new Error('centerId is required for the Client Loan Application report');

    if (branchIds) {
        const center = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
        if (!center || !branchIds.includes(center.branchId)) {
            throw new Error('You do not have access to this center');
        }
    }

    const clients = await prisma.client.findMany({
        where: { centerId, isActive: true },
        select: applicationFormClientSelect,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const records = clients.map(mapClientToApplicationFormRecord);

    const headers = [
        'Client Account Number', 'Branch', 'Center', 'Center Code', 'Name', 'Member / Client', 'ID', 'Nominee', 'Nominee Relation', 'Father Name',
        'Mother Name', 'Spouse Name', 'Spouse DOB', 'Spouse Gender', 'Age', 'Gender', 'Marital Status', 'Date of Joining', 'Permanent Address',
        'Phone 1', 'Phone 2', 'Voter ID', 'PAN Card', 'Smart Card No', 'Unique ID (Aadhar Masked)', 'Nominee UID (Masked)', 'Nominee VID',
        'Nominee PAN', 'Nominee DOB', 'Nominee Age', 'Nominee Gender', 'Qualification', 'Occupation', 'Economic Activity Type', 'Economic Activity',
        'Spouse Economic Activity Type', 'Spouse Economic Activity', 'Monthly Income', 'Monthly Expense', 'Requested Loan Amount',
        'Loan Tenure (Weeks)', 'Loan Frequency', 'Loan Product Type', 'Loan Product', 'Loan Product Amount', 'House Status', 'Bank Account No',
        'Bank Account Type', 'Bank Name', 'Bank Branch', 'IFSC Code', 'Co-Applicant Name', 'Co-Applicant Age', 'Co-Applicant Relation',
        'Co-Applicant Phone', 'Co-Applicant DOB', 'Co-Applicant Gender', 'Co-Applicant Economic Activity Type', 'Co-Applicant Economic Activity',
        'Religion', 'Caste', 'Purpose of Loan',
    ];
    // Co-Applicant DOB/Gender and Purpose of Loan reuse nomineeDob/nomineeGender/occupation, matching
    // the live page's own prepareExcelData() mapping verbatim (components/reports/ApplicationFormReport.tsx) —
    // not fixed here, out of scope for this task.
    const rows: (string | number)[][] = records.map((r) => [
        r.account, r.branchName, r.centerName, r.centerCode, r.clientName, getPersonLabel(r.hasLoan).singular, r.clientId, r.nomineeName, r.nomineeRelation, r.fatherName,
        r.motherName, r.spouseName, r.spouseDob ? formatApplicationFormDate(r.spouseDob) : '', r.spouseGender, r.age, r.gender, r.maritalStatus, formatApplicationFormDate(r.dateOfJoining), r.permanentAddress,
        r.phone, r.mobile2, r.voterId, r.panCard, r.smartCard, maskAadhar(r.voterId), r.coOtherId ? maskAadhar(r.coOtherId) : '', r.coApplicantVoterId,
        r.coApplicantPanCard, r.nomineeDob ? formatApplicationFormDate(r.nomineeDob) : '', r.nomineeAge, r.nomineeGender, r.qualification, r.occupation, r.economicActivityType, r.economicActivity,
        r.spouseEconomicActivityType, r.spouseEconomicActivity, truncateReportAmount(r.monthlyIncome), truncateReportAmount(r.monthlyExpense), truncateReportAmount(r.requestedAmount),
        r.loanTenure, r.loanFrequency, r.loanProductTypeName, r.loanProductName, truncateReportAmount(r.loanProductAmount), r.houseStatus, r.bankAcNo,
        r.bankAccountType, r.bankName, r.bankBranch, r.ifscCode, r.coApplicantName, r.coApplicantAge, r.coApplicantRelation,
        r.coApplicantPhone, r.nomineeDob ? formatApplicationFormDate(r.nomineeDob) : '', r.nomineeGender, r.coApplicantEconomicActivityType, r.coApplicantEconomicActivity,
        r.religion, r.caste, r.occupation,
    ]);
    return { headers, rows, totalCount: records.length };
}

async function fetchArrearDemandSheet({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    const centerId = filters?.centerId;
    if (!centerId) throw new Error('centerId is required for the Arrear Demand Sheet report');
    if (!fromDate) throw new Error('An arrear date is required for the Arrear Demand Sheet report');

    if (branchIds) {
        const center = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
        if (!center || !branchIds.includes(center.branchId)) {
            throw new Error('You do not have access to this center');
        }
    }

    const { rows: data } = await getArrearDemandSheetDataCore(fromDate, centerId);
    const headers = ['S.No', 'Member ID', 'Member Name', 'Loan ID', 'Arrear Principal', 'Arrear Interest', 'Fees Due', 'Penalties Due', 'Total Arrear Due', 'Collection Status', 'Collected Amount', 'Collection Date', 'Collection Time', 'Collected By'];
    const rows: (string | number)[][] = data.map((r) => [
        r.sNo, r.clientId, r.clientName, r.loanId, truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest),
        truncateReportAmount(r.feesDue), truncateReportAmount(r.penaltiesDue), truncateReportAmount(r.totalArrearDue),
        r.collectionStatus, r.collectedAmount !== null && r.collectedAmount !== undefined ? truncateReportAmount(r.collectedAmount) : '',
        r.collectionDateDisplay ?? '', r.collectionTimeDisplay ?? '', r.collectedBy ?? '',
    ]);
    return { headers, rows, totalCount: data.length };
}

async function fetchBranchDemandField({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A demand date is required for the Branch Demand report');
    const centerId = filters?.centerId || 'all';
    const result = await getBranchDemandDataCore(fromDate, 1, 999999, branchIds, centerId);
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();
    const headers = [
        'Sl No', 'FDO', 'Center', 'Meeting Time', '# Clients', 'WB', 'OS Pri', 'OS Int', 'Arrear Pri', 'Arrear Int',
        ...(loanAdvanceEnabled ? ['Arrear Sav'] : []),
        'Demand Pri', 'Demand Int',
        ...(loanAdvanceEnabled ? ['Demand Sav'] : []),
        'Total Demand',
    ];
    const rows: (string | number)[][] = result.data.map((r, i) => [
        i + 1, r.fdo, r.center, r.meetingTime, r.noOfClients, r.wb,
        truncateReportAmount(r.osPri), truncateReportAmount(r.osInt), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.arrearSavings)] : []),
        truncateReportAmount(r.demandPri), truncateReportAmount(r.demandInt),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.demandSavings)] : []),
        truncateReportAmount(r.totalDemand),
    ]);
    return { headers, rows, totalCount: result.data.length };
}

async function fetchDemandSheet({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A demand date is required for the Demand Sheet report');
    const reportType = filters?.reportType || 'centerwise';
    const fdoId = filters?.fdoId || 'all';
    const loanAdvanceEnabled = await getLoanAdvanceEnabled();

    if (reportType === 'clientwise') {
        const clientRows = await getDemandSheetClientWiseTableDataForQueue(fromDate, fdoId, branchIds ?? null);
        const headers = [
            'S.No', 'Member ID', 'Member Name', 'Member Phone', 'Branch Name', 'Center Name',
            'Group Name', 'Product Name', 'Disb Date',
            'Loan Amount Principal', 'Loan Amount Interest', 'Loan Amount Total',
            'Loan OS Principal', 'Loan OS Interest', 'Loan OS Total',
            'Cur Due', 'Coll Dues', 'Demand Date',
            'Arrear Principal', 'Arrear Interest', 'Arrear Total',
            'Demand Principal', 'Demand Interest', 'Demand Total',
            ...(loanAdvanceEnabled ? ['Loan Advance OS', 'Loan Advance Demand'] : []),
            'Total Demand Amount', 'Officer Name', 'Current Demand Coll Amount',
            'Collection Date', 'Collection Status', 'MeetUp Time', 'Funder Name',
        ];
        const rows: (string | number)[][] = clientRows.map((r, i) => [
            i + 1, r.clientId, r.clientName, r.memberPhone || '-', r.branchName, r.centerName,
            r.groupName, r.productName, r.approvedLevel2At || '-',
            truncateReportAmount(r.loanAmount), truncateReportAmount(r.loanAmountInterest), truncateReportAmount(r.loanAmountTotal),
            truncateReportAmount(r.loanOSPrincipal), truncateReportAmount(r.loanOSInterest), truncateReportAmount(r.loanOS),
            truncateReportAmount(r.curDue), truncateReportAmount(r.collDue), r.demandDate,
            truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest), truncateReportAmount(r.arrear),
            truncateReportAmount(r.demandPrincipal), truncateReportAmount(r.demandInterest), truncateReportAmount(r.demand),
            ...(loanAdvanceEnabled ? [truncateReportAmount(r.loanAdvanceOS), truncateReportAmount(r.loanAdvanceDemand)] : []),
            truncateReportAmount(r.totalDemandAmount), r.officerName, truncateReportAmount(r.currentDemandCollAmount),
            r.collectionDate || '-', r.collectionStatus, r.meetingTime, r.funderName,
        ]);
        return { headers, rows, totalCount: clientRows.length };
    }

    const data = await getDemandSheetDataForQueue(fromDate, fdoId, branchIds ?? null);
    const headers = [
        'Sl No', 'Center Name', 'Phone', 'Clients', 'WB', 'Due No', 'Time', 'Loan OS', 'Arrear', 'Demand',
        ...(loanAdvanceEnabled ? ['Loan Advance OS', 'Loan.AD Demand'] : []),
        'Collected',
    ];
    const rows: (string | number)[][] = data.map((r, i) => [
        i + 1, r.centerName, r.phone, r.noOfClients, r.wb, r.dueNo, r.meetingTime,
        truncateReportAmount(r.loanOS), truncateReportAmount(r.arrear), truncateReportAmount(r.demand),
        ...(loanAdvanceEnabled ? [truncateReportAmount(r.loanAdvanceOS), truncateReportAmount(r.loanAdvanceDemand)] : []),
        truncateReportAmount(r.collected),
    ]);
    return { headers, rows, totalCount: data.length };
}

const FUNDER_INTEREST_FY_MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const;
type FunderInterestFYMonth = typeof FUNDER_INTEREST_FY_MONTHS[number];

/** Company-wide report (no branch/GL scoping by design — see app/api/reports/funder-interest/route.ts); branchIds is ignored. */
async function fetchFunderInterest({ filters }: ReportFetchParams): Promise<ReportRows> {
    const year = parseInt(filters?.year || '', 10);
    if (!year || year < 2000 || year > 2100) throw new Error('A valid financial year (filters.year) is required for the Funder Interest report');
    const start = new Date(year, 3, 1, 0, 0, 0, 0);
    const end = new Date(year + 1, 2, 31, 23, 59, 59, 999);

    const funders = await prisma.funder.findMany({
        where: { isActive: true },
        include: { interestGL: { select: { glName: true } } },
        orderBy: { funderName: 'asc' },
    });
    const glNameToMonthKey = (d: Date): FunderInterestFYMonth | null => {
        const map: Record<number, FunderInterestFYMonth> = { 3: 'apr', 4: 'may', 5: 'jun', 6: 'jul', 7: 'aug', 8: 'sep', 9: 'oct', 10: 'nov', 11: 'dec', 0: 'jan', 1: 'feb', 2: 'mar' };
        return map[d.getMonth()] ?? null;
    };
    const interestGLNames = funders.map((f) => f.interestGL.glName);
    const transactions = interestGLNames.length
        ? await prisma.financialTransaction.findMany({
            where: { isActive: true, approvalStatus: 'APPROVED' as any, transactionDate: { gte: start, lte: end }, type: { in: ['BANK_PAYMENT', 'CASH_PAYMENT'] }, ledger: { ledgerName: { in: interestGLNames } } },
            select: { transactionDate: true, amount: true, ledger: { select: { ledgerName: true } } },
        })
        : [];
    const ledgerMonthMap: Record<string, Record<FunderInterestFYMonth, number>> = {};
    for (const tx of transactions) {
        const name = tx.ledger?.ledgerName;
        if (!name) continue;
        const monthKey = glNameToMonthKey(new Date(tx.transactionDate));
        if (!monthKey) continue;
        if (!ledgerMonthMap[name]) ledgerMonthMap[name] = Object.fromEntries(FUNDER_INTEREST_FY_MONTHS.map((m) => [m, 0])) as Record<FunderInterestFYMonth, number>;
        ledgerMonthMap[name][monthKey] += Number(tx.amount);
    }

    const headers = ['Funder Name', ...FUNDER_INTEREST_FY_MONTHS, 'Total Payment'];
    const rows: (string | number)[][] = funders.map((funder) => {
        const monthData = ledgerMonthMap[funder.interestGL.glName] ?? Object.fromEntries(FUNDER_INTEREST_FY_MONTHS.map((m) => [m, 0]));
        const totalPayment = FUNDER_INTEREST_FY_MONTHS.reduce((s, m) => s + (monthData[m] ?? 0), 0);
        return [funder.funderName, ...FUNDER_INTEREST_FY_MONTHS.map((m) => truncateReportAmount(monthData[m] ?? 0)), truncateReportAmount(totalPayment)];
    });
    // Direct's grandTotals/grandTotal come from a separately-duplicated query in
    // app/api/reports/funder-interest/route.ts (same where-clause/date-matching, confirmed
    // in sync) — mathematically identical to column-summing the per-funder rows already
    // computed above, so reused that way here rather than issuing a second query.
    const funderCount = rows.length;
    if (funderCount > 0) {
        const sumMonth = (m: FunderInterestFYMonth) => rows.reduce((s, r) => s + Number(r[FUNDER_INTEREST_FY_MONTHS.indexOf(m) + 1] ?? 0), 0);
        const grandTotals = FUNDER_INTEREST_FY_MONTHS.map((m) => truncateReportAmount(sumMonth(m)));
        const grandTotal = truncateReportAmount(grandTotals.reduce((s, v) => s + v, 0));
        rows.push(['TOTAL', ...grandTotals, grandTotal]);
    }
    return { headers, rows, totalCount: funderCount };
}

/** Company-wide report (no branch scoping — see app/api/reports/funder-report/route.ts); branchIds is ignored. Route is ADMIN-only at the HTTP layer; here the ReportPermission gate is the sole access control. */
async function fetchFunderReport({ fromDate, toDate }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Funder Report');
    const periodStart = new Date(fromDate);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(toDate);
    periodEnd.setHours(23, 59, 59, 999);

    const funders = await prisma.funder.findMany({
        where: { isActive: true },
        include: { principalGL: { select: { glName: true } } },
        orderBy: { funderName: 'asc' },
    });
    const glNames = [...new Set(funders.map((f) => f.principalGL.glName))];
    const ledgers = glNames.length
        ? await prisma.accountLedger.findMany({ where: { ledgerName: { in: glNames }, isActive: true }, select: { id: true, ledgerName: true } })
        : [];
    const ledgerByGLName = new Map(ledgers.map((l) => [l.ledgerName, l]));

    const rows = await Promise.all(funders.map(async (funder) => {
        const glName = funder.principalGL.glName;
        const ledger = ledgerByGLName.get(glName);
        if (!ledger) return { funderName: glName, openingBalance: 0, debit: 0, credit: 0, closingBalance: 0 };

        const approvedOnly = { approvalStatus: 'APPROVED' as any };
        const [priorDebits, priorCredits, periodDebits, periodCredits] = await Promise.all([
            prisma.financialTransaction.aggregate({ where: { ledgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { lt: periodStart } }, _sum: { amount: true } }),
            prisma.financialTransaction.aggregate({ where: { creditLedgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { lt: periodStart } }, _sum: { amount: true } }),
            prisma.financialTransaction.aggregate({ where: { ledgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { gte: periodStart, lte: periodEnd } }, _sum: { amount: true } }),
            prisma.financialTransaction.aggregate({ where: { creditLedgerId: ledger.id, isActive: true, ...approvedOnly, transactionDate: { gte: periodStart, lte: periodEnd } }, _sum: { amount: true } }),
        ]);
        const openingBalance = Number(priorCredits._sum.amount ?? 0) - Number(priorDebits._sum.amount ?? 0);
        const debit = Number(periodDebits._sum.amount ?? 0);
        const credit = Number(periodCredits._sum.amount ?? 0);
        return { funderName: glName, openingBalance, debit, credit, closingBalance: openingBalance + credit - debit };
    }));

    const headers = ['Funder Name', 'Opening Balance', 'Debit Rs.', 'Credit Rs.', 'Closing Balance'];
    const dataRows: (string | number)[][] = rows.map((r) => [
        r.funderName, truncateReportAmount(r.openingBalance), truncateReportAmount(r.debit), truncateReportAmount(r.credit), truncateReportAmount(r.closingBalance),
    ]);
    // Mirrors the Direct page's TOTAL row (itself app/api/reports/funder-report/route.ts's own
    // `rows.reduce(...)` over these same 4 numeric fields) — a plain reduce over `rows`.
    if (rows.length > 0) {
        const sum = (fn: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + fn(r), 0);
        dataRows.push([
            'TOTAL', truncateReportAmount(sum((r) => r.openingBalance)), truncateReportAmount(sum((r) => r.debit)),
            truncateReportAmount(sum((r) => r.credit)), truncateReportAmount(sum((r) => r.closingBalance)),
        ]);
    }
    return { headers, rows: dataRows, totalCount: rows.length };
}

/**
 * Duplicates app/api/reports/disbursement/route.ts's where-clause/mapping — that route has no
 * reusable pure function (buildBranchWhereClause() needs a request-scoped user, so it's bypassed
 * here in favor of a direct branchId filter). 'Total Dues' really is tenureMonths and 'Funder' is
 * hardcoded 'OWN FUND' in the source route — replicated verbatim, not fixed here.
 */
async function fetchMisDisbursement({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the MIS Disbursement report');
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(toDate);
    endDate.setHours(23, 59, 59, 999);
    const centerId = filters?.centerId;

    const loans = await prisma.loan.findMany({
        where: {
            disbursementStatus: { in: ['DISBURSED', 'APPROVED_LEVEL1'] },
            disbursedLevel1At: { gte: startDate, lte: endDate },
            isActive: true,
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(centerId && centerId !== 'all' ? { centerId } : {}),
        },
        include: {
            client: true,
            center: { include: { branch: true, fdo: true } },
            loanProduct: true,
            loanPurpose: { select: { name: true, loanPurposeType: { select: { name: true } } } },
            schedules: { orderBy: { installmentNo: 'asc' } },
            createdBy: true,
        },
        orderBy: { disbursedLevel1At: 'asc' },
    });

    const headers = ['Branch ID', 'Branch Name', 'Disbursal Date', 'Center ID', 'Center Name', 'Member ID', 'Member Name', 'Funder', 'Loan A/C No', 'Loan Amount', 'Total Dues', 'Purpose', 'Emp ID', 'FDO', 'Due Start Date', 'Loan Sl No', 'Phone', 'Meeting Day'];
    const rows: (string | number)[][] = loans.map((loan, index) => {
        const disbursalDate = loan.disbursedLevel1At ? formatDateFns(new Date(loan.disbursedLevel1At), 'dd/MM/yyyy') : 'N/A';
        const dueStartDate = loan.schedules.length > 0 ? formatDateFns(new Date(loan.schedules[0].dueDate), 'dd/MM/yyyy') : 'N/A';
        let purpose = 'N/A';
        if (loan.loanPurpose?.name) {
            purpose = loan.loanPurpose.loanPurposeType?.name ? `${loan.loanPurpose.name} (${loan.loanPurpose.loanPurposeType.name})` : loan.loanPurpose.name;
        } else if (loan.loanProduct?.productName) {
            purpose = loan.loanProduct.productName;
        }
        return [
            loan.center?.branch?.code || 'N/A', loan.center?.branch?.name || 'N/A', disbursalDate, loan.center?.code || 'N/A', loan.center?.name || 'N/A',
            loan.client?.clientId || 'N/A', `${loan.client?.firstName || ''} ${loan.client?.lastName || ''}`.trim(), 'OWN FUND', loan.loanNumber || 'N/A',
            truncateReportAmount(Number(loan.amount || 0)), loan.tenureMonths || 0, purpose, loan.center?.fdo?.id || loan.createdBy?.id || 'N/A',
            loan.center?.fdo ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`.trim() : (loan.createdBy ? `${loan.createdBy.firstName} ${loan.createdBy.lastName}`.trim() : 'Unassigned'),
            dueStartDate, index + 1, loan.client?.phone || loan.client?.mobileNumber || 'N/A', loan.center?.meetingDay || 'N/A',
        ];
    });
    return { headers, rows, totalCount: loans.length };
}

/**
 * Duplicates app/api/reports/portfolio/center-master/route.ts's per-center query — that route
 * has no reusable pure function, and is single-branch by construction (a center master listing
 * is inherently one branch's own centers), so the caller must resolve to exactly one branch.
 * Not to be confused with the unrelated, already-registered 'center-master' entry (a different
 * report/page, different column set).
 */
async function fetchCenterMasterSummary({ fromDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A report date is required for the Center Master Summary report');
    if (!branchIds || branchIds.length !== 1) throw new Error('Select exactly one branch for the Center Master Summary report');
    const branchId = branchIds[0];
    const reportDate = new Date(`${fromDate}T23:59:59.999`);

    const centers = await prisma.center.findMany({
        where: { branchId, isActive: true, status: 'APPROVED' },
        include: {
            branch: { select: { code: true, name: true } },
            fdo: { select: { firstName: true, lastName: true } },
        },
        orderBy: { code: 'asc' },
    });

    const reportData = await Promise.all(centers.map(async (center) => {
        const clients = await prisma.client.findMany({
            where: { centerId: center.id, isActive: true },
            select: {
                id: true,
                loanApplications: {
                    where: { isActive: true, disbursementStatus: 'DISBURSED', createdAt: { lte: reportDate } },
                    select: {
                        amount: true, principalPaid: true,
                        schedules: { where: { dueDate: { lte: reportDate } }, select: { status: true, principalDue: true, principalPaid: true, interestDue: true, interestPaid: true } },
                    },
                },
            },
        });

        let activeClients = 0, waitingBorrower = 0, osPrincipal = 0, arrearMembers = 0, arrearAmount = 0, arrearMemOS = 0;
        for (const client of clients) {
            const activeLoans = client.loanApplications ?? [];
            if (activeLoans.length > 0) activeClients++; else waitingBorrower++;
            let clientOS = 0, clientArrear = 0;
            for (const loan of activeLoans) {
                const loanOS = Math.max(0, Number(loan.amount) - Number(loan.principalPaid ?? 0));
                clientOS += loanOS;
                osPrincipal += loanOS;
                for (const sch of loan.schedules ?? []) {
                    if (sch.status !== 'PAID') {
                        clientArrear += Math.max(0, Number(sch.principalDue) - Number(sch.principalPaid ?? 0)) + Math.max(0, Number(sch.interestDue) - Number(sch.interestPaid ?? 0));
                    }
                }
            }
            if (clientArrear > 0) { arrearMembers++; arrearAmount += clientArrear; arrearMemOS += clientOS; }
        }
        const par = osPrincipal > 0 ? (arrearMemOS / osPrincipal) * 100 : 0;
        const fdoName = center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}`.trim() : 'Unassigned';

        return {
            ourBranchID: center.branch.code, centreID: center.code, centreName: center.name,
            visitDate: center.nextMeetingDate ? new Date(center.nextMeetingDate).toISOString().split('T')[0] : fromDate,
            fdoName, meetingDay: center.meetingDay || '-', meetingTime: center.meetingTime || '-', fromBranch: center.branch.name, fromDO: fdoName,
            contactPerson: center.contactPerson ?? '', contactPersonNumber: center.contactNumber ?? '', kmFromBranch: center.kmFromBranch ?? '',
            noOfMember: clients.length, activeClients, osPrincipal: truncateReportAmount(osPrincipal), arrearMembers, arrearAmount: truncateReportAmount(arrearAmount),
            arrearMemOS: truncateReportAmount(arrearMemOS), waitingBorrower, par: parseFloat(par.toFixed(2)),
        };
    }));

    const headers = ['Branch ID', 'Centre ID', 'Centre Name', 'Visit Date', 'FDO Name', 'Meeting Day', 'Meeting Time', 'From Branch', 'From DO', 'Contact Person', 'Contact Number', 'Distance from Branch (KM)', 'No. of Members', 'Active Clients', 'OS Principal', 'Arrear Members', 'Arrear Amount', 'Arrear Mem OS', 'Waiting Borrowers', 'PAR (%)'];
    const rows: (string | number)[][] = reportData.map((r) => [
        r.ourBranchID, r.centreID, r.centreName, r.visitDate, r.fdoName, r.meetingDay, r.meetingTime, r.fromBranch, r.fromDO, r.contactPerson, r.contactPersonNumber,
        r.kmFromBranch, r.noOfMember, r.activeClients, r.osPrincipal, r.arrearMembers, r.arrearAmount, r.arrearMemOS, r.waitingBorrower, r.par,
    ]);
    return { headers, rows, totalCount: rows.length };
}

/**
 * Duplicates app/api/reports/voucher-print/route.ts's where-clause/mapping — the live route
 * derives branch scope from the request's own user/role (getPermittedBranchIds(user)), which
 * the queue has no equivalent of; branchIds (already scoped by the caller) is used directly
 * instead. approvalStatus is NOT filtered in the source route (pending/rejected vouchers show
 * too) — replicated as-is, not a gap introduced here.
 */
async function fetchVoucherPrint({ fromDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A voucher date is required for the Voucher Print report');
    const startOfDay = new Date(`${fromDate}T00:00:00`);
    const endOfDay = new Date(`${fromDate}T23:59:59.999`);
    const typeFilter = filters?.type;

    const whereClause: any = {
        isActive: true,
        transactionDate: { gte: startOfDay, lte: endOfDay },
        ...(typeFilter && typeFilter !== 'ALL' ? { type: typeFilter } : {}),
    };
    if (branchIds) {
        const ors = branchIds.flatMap((id) => (buildFinancialTransactionBranchScope({ branchId: id }) as any).OR ?? []);
        Object.assign(whereClause, ors.length > 0 ? { OR: ors } : { branchId: '__NO_PERMITTED_BRANCH__' });
    }

    const transactions = await prisma.financialTransaction.findMany({
        where: whereClause,
        include: {
            selfAccount: { select: { name: true } },
            ledger: { select: { ledgerName: true } },
            createdBy: { select: { firstName: true, lastName: true, branch: { select: { name: true } } } },
        },
        orderBy: [{ type: 'asc' }, { voucherNo: 'asc' }],
    });

    const VOUCHER_TYPE_LABEL: Record<string, string> = { BANK_RECEIPT: 'Bank Receipt', BANK_PAYMENT: 'Bank Payment', CASH_RECEIPT: 'Cash Receipt', CASH_PAYMENT: 'Cash Payment', CONTRA: 'Contra', JOURNAL: 'Journal' };
    const headers = ['Voucher No', 'Type', 'Date', 'Dr Account', 'Cr Account', 'Amount (₹)', 'Narration', 'Instrument No', 'Bank Name', 'Created By', 'Branch'];
    const rows: (string | number)[][] = transactions.map((tx) => {
        const amount = Number(tx.amount);
        let drAccount = '', crAccount = '';
        switch (tx.type) {
            case 'BANK_RECEIPT': case 'CASH_RECEIPT': case 'CONTRA':
                drAccount = tx.selfAccount?.name ?? ''; crAccount = tx.ledger?.ledgerName ?? ''; break;
            default:
                drAccount = tx.ledger?.ledgerName ?? ''; crAccount = tx.selfAccount?.name ?? '';
        }
        return [
            tx.voucherNo, VOUCHER_TYPE_LABEL[tx.type] ?? tx.type, toDisplayDate(tx.transactionDate), drAccount, crAccount, truncateReportAmount(amount),
            tx.description ?? '', tx.instrumentNo ?? '', tx.bankName ?? '', `${tx.createdBy.firstName} ${tx.createdBy.lastName}`, tx.createdBy.branch?.name ?? '',
        ];
    });
    return { headers, rows, totalCount: transactions.length };
}

/**
 * Duplicates app/api/admin-reports/account/compare-ilgl/route.ts's GL-vs-IL reconciliation —
 * that route has no reusable pure function, and is single-branch by construction (there is no
 * "consolidated" concept for this comparison), so the caller must resolve to exactly one branch.
 */
async function fetchCompareIlgl({ fromDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate) throw new Error('A comparison date is required for the Compare IL GL Values report');
    if (!branchIds || branchIds.length !== 1) throw new Error('Select exactly one branch for the Compare IL GL Values report');
    const branchId = branchIds[0];
    const cutoffDate = new Date(`${fromDate}T23:59:59.999`);

    const branchContexts = await getBranchOpeningContext([branchId]);
    const openingContext = branchContexts.get(branchId);
    const glDateFilter = openingContext ? { gte: openingContext.openingDate, lte: cutoffDate } : { lte: cutoffDate };

    const [glTransactions, glCreditTransactions] = await Promise.all([
        prisma.financialTransaction.groupBy({
            by: ['ledgerId'],
            where: { isActive: true, approvalStatus: 'APPROVED' as any, transactionDate: glDateFilter, createdBy: { branchId } },
            _sum: { amount: true },
        }),
        prisma.financialTransaction.groupBy({
            by: ['creditLedgerId'],
            where: { isActive: true, approvalStatus: 'APPROVED' as any, transactionDate: glDateFilter, createdBy: { branchId }, creditLedgerId: { not: null } },
            _sum: { amount: true },
        }),
    ]);

    const glBalances: Record<string, number> = {};
    for (const txn of glTransactions) {
        if (txn.ledgerId) glBalances[txn.ledgerId] = (glBalances[txn.ledgerId] || 0) + Number(txn._sum.amount || 0);
    }
    for (const txn of glCreditTransactions) {
        if (txn.creditLedgerId) glBalances[txn.creditLedgerId] = (glBalances[txn.creditLedgerId] || 0) - Number(txn._sum.amount || 0);
    }
    if (openingContext) {
        for (const [ledgerId, amt] of openingContext.ledgerAmounts) {
            glBalances[ledgerId] = (glBalances[ledgerId] || 0) + amt;
        }
    }

    const ledgerIds = Object.keys(glBalances);
    const ledgers = ledgerIds.length ? await prisma.accountLedger.findMany({ where: { id: { in: ledgerIds } } }) : [];
    const ledgerMap: Record<string, string> = {};
    ledgers.forEach((l) => { ledgerMap[l.id] = l.ledgerName; });

    const ilTransactions = await prisma.loanTransaction.aggregate({
        where: { branchId, transactionDate: { lte: cutoffDate }, isReversed: false },
        _sum: { principalAmount: true, interestAmount: true, feesAmount: true, penaltyAmount: true },
    });

    const results: { ledger: string; tb: number; il: number; difference: number }[] = [];
    for (const [ledgerId, tbAmount] of Object.entries(glBalances)) {
        const ledgerName = ledgerMap[ledgerId] || 'Unknown Ledger';
        const nameUpper = ledgerName.toUpperCase();
        let ilAmount = 0;
        if (nameUpper.includes('PRINCIPAL') || nameUpper.includes('LOAN RECEIVABLE')) ilAmount = Number(ilTransactions._sum.principalAmount || 0);
        else if (nameUpper.includes('INTEREST')) ilAmount = Number(ilTransactions._sum.interestAmount || 0);
        else if (nameUpper.includes('FEE') || nameUpper.includes('DOCUMENT')) ilAmount = Number(ilTransactions._sum.feesAmount || 0);
        else if (nameUpper.includes('PENALTY')) ilAmount = Number(ilTransactions._sum.penaltyAmount || 0);
        else ilAmount = tbAmount;
        results.push({ ledger: ledgerName, tb: tbAmount, il: ilAmount, difference: tbAmount - ilAmount });
    }
    const hasPrincipalLedger = results.some((r) => r.ledger.toUpperCase().includes('PRINCIPAL') || r.ledger.toUpperCase().includes('LOAN RECEIVABLE'));
    if (!hasPrincipalLedger && Number(ilTransactions._sum.principalAmount || 0) > 0) {
        const ilAmt = Number(ilTransactions._sum.principalAmount || 0);
        results.push({ ledger: 'LOAN PORTFOLIO PRINCIPAL (Missing GL mapping)', tb: 0, il: ilAmt, difference: -ilAmt });
    }
    const hasInterestLedger = results.some((r) => r.ledger.toUpperCase().includes('INTEREST'));
    if (!hasInterestLedger && Number(ilTransactions._sum.interestAmount || 0) > 0) {
        const ilAmt = Number(ilTransactions._sum.interestAmount || 0);
        results.push({ ledger: 'INTEREST INCOME (Missing GL mapping)', tb: 0, il: ilAmt, difference: -ilAmt });
    }

    const headers = ['Ledger', 'Trial Balance (TB) INR', 'Individual Ledger (IL) INR', 'Difference INR'];
    const rows: (string | number)[][] = results.map((r) => [r.ledger, truncateReportAmount(r.tb), truncateReportAmount(r.il), truncateReportAmount(r.difference)]);
    return { headers, rows, totalCount: rows.length };
}

const DAYBOOK_VOUCHER_TYPE_LABEL = (type: string): string => {
    const t = (type ?? '').toUpperCase();
    if (t === 'CR') return 'Cash Receipt';
    if (t === 'CP' || t === 'DR') return 'Cash Payment';
    return type;
};

/**
 * Calls the existing getDaybookData() directly (already cookie-free, plain-param) with
 * exportAll:true. Single-branch only — a daybook's opening/closing balance is inherently
 * one branch's own cash book, so the caller must resolve to exactly one branch. Drops the
 * live page's separate EOD denomination-entry reconciliation section (a different dataset,
 * not part of the daybook query itself — see report-registry planning notes).
 */
async function fetchDaybook({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Daybook report');
    if (!branchIds || branchIds.length !== 1) throw new Error('Select exactly one branch for the Daybook report');
    const branchId = branchIds[0];
    const isHODaybook = await isHeadOfficeBranch(branchId);

    const full = await getDaybookData(fromDate, toDate, branchId, 1, 1, isHODaybook, true);
    // full.transactions[].date is a pre-formatted "dd/MM/yyyy" IST string (see fmtIstDate() in
    // app/lib/actions/reports.ts), not ISO — must go through date-fns parse(), not new Date(),
    // to match the live page's own sorting/display exactly.
    const parseDaybookDate = (d: string) => parseDateFns(d, 'dd/MM/yyyy', new Date());
    const sorted = full.transactions.slice().sort((a, b) => {
        const da = parseDaybookDate(a.date).getTime();
        const db = parseDaybookDate(b.date).getTime();
        if (da !== db) return da - db;
        const aR = a.credit > 0, bR = b.credit > 0;
        if (aR && !bR) return -1;
        if (!aR && bR) return 1;
        return (a.particulars || '').localeCompare(b.particulars || '');
    });
    const drTotal = full.openingBalance + full.totalCredits;
    const crTotal = full.totalDebits;
    const cbNegative = full.closingBalance < 0;

    const headers = ['S.No', 'Date', 'Voucher Type', 'Voucher No', 'Particulars', 'Debit Rs.', 'Credit Rs.'];
    const rows: (string | number)[][] = [];
    rows.push(['', formatDateFns(new Date(fromDate), 'dd/MM/yyyy'), 'Opening Balance', '', '', truncateReportAmount(full.openingBalance), '']);
    sorted.forEach((tx, i) => {
        const isRcpt = tx.credit > 0;
        rows.push([
            i + 1, formatDateFns(parseDaybookDate(tx.date), 'dd/MM/yyyy'), DAYBOOK_VOUCHER_TYPE_LABEL(tx.type), tx.refNo || '',
            (tx.particulars || '') + (tx.description ? ` - ${tx.description}` : ''),
            isRcpt ? truncateReportAmount(tx.credit) : '', !isRcpt ? truncateReportAmount(tx.debit) : '',
        ]);
    });
    rows.push(['', '', 'Total', '', '', truncateReportAmount(drTotal), truncateReportAmount(crTotal)]);
    rows.push(cbNegative
        ? ['', formatDateFns(new Date(toDate), 'dd/MM/yyyy'), 'Closing Balance (Overdraft)', '', '', '', truncateReportAmount(Math.abs(full.closingBalance))]
        : ['', formatDateFns(new Date(toDate), 'dd/MM/yyyy'), 'Closing Balance', '', '', truncateReportAmount(full.closingBalance), '']);
    return { headers, rows, totalCount: rows.length };
}

/** branchIds null = consolidated (unrestricted), matching computeGlAllAccounts()'s own contract — no single-branch restriction needed here, unlike Compare IL GL/Daybook/Center Master. */
async function fetchGlAll({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the General Ledger - All Accounts report');
    const startDate = new Date(fromDate);
    const endDate = new Date(`${toDate}T23:59:59.999`);
    const accounts = await computeGlAllAccounts(branchIds, startDate, endDate);

    const headers = ['Date', 'Voucher Type', 'Voucher No', 'Particulars', 'Debit', 'Credit'];
    const rows: (string | number)[][] = [];
    for (const acc of accounts) {
        rows.push([`Account: ${acc.name}`, '', '', '', '', '']);
        rows.push(['', 'Opening Balance', '', '', acc.openingBalance > 0 ? truncateReportAmount(acc.openingBalance) : '', acc.openingBalance < 0 ? truncateReportAmount(Math.abs(acc.openingBalance)) : '']);
        for (const tx of acc.transactions) {
            rows.push([tx.date, tx.type, tx.voucherNo, tx.particulars, tx.debit ? truncateReportAmount(tx.debit) : '', tx.credit ? truncateReportAmount(tx.credit) : '']);
        }
        rows.push(['', 'Closing Balance', '', '', acc.closingBalance > 0 ? truncateReportAmount(acc.closingBalance) : '', acc.closingBalance < 0 ? truncateReportAmount(Math.abs(acc.closingBalance)) : '']);
        rows.push(['', '', '', '', '', '']);
    }
    return { headers, rows, totalCount: accounts.length };
}

/** branchIds null = consolidated, same contract as fetchGlAll. Requires filters.accountId (an AccountLedger or SelfAccount id — the account picker on the live page). */
async function fetchGlOne({ fromDate, toDate, branchIds, filters }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the GL Account Ledger report');
    const accountId = filters?.accountId;
    if (!accountId) throw new Error('filters.accountId is required for the GL Account Ledger report');
    const startDate = new Date(fromDate);
    const endDate = new Date(`${toDate}T23:59:59.999`);
    const result = await computeGlOneAccount(accountId, startDate, endDate, branchIds);
    if (!result) throw new Error('Account not found');

    const headers = ['Date', 'Particulars', 'Debit', 'Credit', 'Balance'];
    const rows: (string | number)[][] = [];
    rows.push([`Account: ${result.accountName}`, '', '', '', '']);
    rows.push([
        '', 'Opening Balance', result.openingBalance > 0 ? truncateReportAmount(result.openingBalance) : '',
        result.openingBalance < 0 ? truncateReportAmount(Math.abs(result.openingBalance)) : '', truncateReportAmount(result.openingBalance),
    ]);
    for (const tx of result.transactions) {
        rows.push([tx.date, tx.particulars, tx.debit ? truncateReportAmount(tx.debit) : '', tx.credit ? truncateReportAmount(tx.credit) : '', truncateReportAmount(tx.balance)]);
    }
    rows.push([
        '', 'Closing Balance', result.closingBalance > 0 ? truncateReportAmount(result.closingBalance) : '',
        result.closingBalance < 0 ? truncateReportAmount(Math.abs(result.closingBalance)) : '', truncateReportAmount(result.closingBalance),
    ]);
    return { headers, rows, totalCount: result.transactions.length };
}

/**
 * Only RANGE mode (the registry's dateMode and the page's default) — AS_ON is a page-only UI
 * toggle not modeled by ReportFetchParams' fromDate/toDate shape (see report-registry planning
 * notes). branchIds null = consolidated, matching buildFinancialTransactionBranchScope()'s
 * contract (same pattern as fetchGlAll/fetchGlOne).
 */
async function fetchReceiptsPayments({ fromDate, toDate, branchIds }: ReportFetchParams): Promise<ReportRows> {
    if (!fromDate || !toDate) throw new Error('fromDate and toDate are required for the Receipts & Payments report');
    const startDate = new Date(fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(`${toDate}T23:59:59.999`);
    const branchFilter = buildFinancialTransactionBranchScope({ branchId: branchIds ?? undefined });
    const data = await computeReceiptsPaymentsCore(branchFilter, branchIds, 'RANGE', startDate, endDate);

    const headers = ['Receipts - Ledger Name', 'Receipts - Amount (₹)', 'Payments - Ledger Name', 'Payments - Amount (₹)'];
    const receiptsContent: { ledgerName: string; amount: number }[] = [{ ledgerName: 'OPENING BALANCE:', amount: data.openingBalance }, ...data.receipts];
    const paymentsContent: { ledgerName: string; amount: number }[] = [...data.payments, { ledgerName: 'CLOSING BALANCE:', amount: data.closingBalance }];
    const maxRows = Math.max(receiptsContent.length, paymentsContent.length);
    const rows: (string | number)[][] = [];
    for (let i = 0; i < maxRows; i++) {
        const r = receiptsContent[i];
        const p = paymentsContent[i];
        rows.push([r ? r.ledgerName : '', r ? truncateReportAmount(r.amount) : '', p ? p.ledgerName : '', p ? truncateReportAmount(p.amount) : '']);
    }
    rows.push([
        'TOTAL RECEIPTS', truncateReportAmount(data.openingBalance + data.totalReceipts),
        'TOTAL PAYMENTS', truncateReportAmount(data.totalPayments + data.closingBalance),
    ]);
    return { headers, rows, totalCount: maxRows };
}

export const REPORT_REGISTRY: Record<string, ReportRegistryEntry> = {
    'meeting-attendance': {
        slug: 'meeting-attendance',
        reportName: 'Meeting Attendance Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false, // centerId is an optional narrowing filter here, not mandatory
        fetch: fetchMeetingAttendance,
        navHref: '/dashboard/reports/client/meeting-attendance',
    },
    'addition-deletion': {
        slug: 'addition-deletion',
        reportName: 'Member Addition & Deletion Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchAdditionDeletion,
        navHref: '/dashboard/reports/client/addition-deletion',
    },
    'addition-disbursed': {
        slug: 'addition-disbursed',
        reportName: 'Client Addition & Disbursed Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchAdditionDisbursed,
        navHref: '/dashboard/reports/client/addition-disbursed',
    },
    'attendance-summary': {
        slug: 'attendance-summary',
        reportName: 'Employee Attendance Summary Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchAttendanceSummary,
        navHref: '/dashboard/reports/employee/attendance-summary',
    },
    'attendance-detailed': {
        slug: 'attendance-detailed',
        reportName: 'Employee Attendance Detailed Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchAttendanceDetailed,
        navHref: '/dashboard/reports/employee/attendance-detailed',
    },
    'dropouts': {
        slug: 'dropouts',
        reportName: 'Member / Client Dropouts Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchDropouts,
        navHref: '/dashboard/reports/client/dropouts',
    },
    'double-clients': {
        slug: 'double-clients',
        reportName: 'Double Clients Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchDoubleClients,
        navHref: '/dashboard/reports/client/double-clients',
    },
    'balance-information': {
        slug: 'balance-information',
        reportName: 'Client Balance Information Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: true,
        fetch: fetchBalanceInformation,
        navHref: '/dashboard/reports/client/balance-information',
    },
    'transfer': {
        slug: 'transfer',
        reportName: 'Client Transfer Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchTransfer,
        navHref: '/dashboard/reports/client/transfer',
    },
    'ccr': {
        slug: 'ccr',
        reportName: 'Client Collection Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false, // centerId is an optional narrowing filter here, not mandatory
        fetch: fetchCcr,
        navHref: '/dashboard/reports/collection/ccr',
    },
    'mcr': {
        slug: 'mcr',
        reportName: 'Meeting Collection Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchMcr,
        navHref: '/dashboard/reports/collection/mcr',
    },
    'gold-taken': {
        slug: 'gold-taken',
        reportName: 'Gold Taken Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchGoldTaken,
        navHref: '/dashboard/reports/gold',
    },
    'gold-returned': {
        slug: 'gold-returned',
        reportName: 'Gold Returned Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchGoldReturned,
        navHref: '/dashboard/reports/gold',
    },
    'preclosure': {
        slug: 'preclosure',
        reportName: 'Preclosure Report Consolidated',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchPreclosure,
        navHref: '/dashboard/mis-reports/preclosure',
    },
    'loan-os-details': {
        slug: 'loan-os-details',
        reportName: 'Loan OS Details Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchLoanOsDetails,
        navHref: '/dashboard/mis-reports/loan-os-details',
    },
    'dcr': {
        slug: 'dcr',
        reportName: 'Daily Collection Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchDcr,
        navHref: '/dashboard/reports/collection/dcr',
    },
    'dcb': {
        slug: 'dcb',
        reportName: 'Demand Collection Balance Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchDcb,
        navHref: '/dashboard/reports/collection/dcb',
    },
    'center-master': {
        slug: 'center-master',
        reportName: 'Center Master Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchCenterMaster,
        navHref: '/dashboard/reports/others/center-master',
    },
    'waiting-borrowers': {
        slug: 'waiting-borrowers',
        reportName: 'Waiting Borrowers Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchWaitingBorrowers,
        navHref: '/dashboard/reports/client/waiting-borrowers',
    },
    'meeting-check': {
        slug: 'meeting-check',
        reportName: 'Daily Meeting Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchMeetingCheck,
        navHref: '/dashboard/reports/collection/meeting-check',
    },
    'denomination-collection': {
        slug: 'denomination-collection',
        reportName: 'Denomination Collection Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchDenominationCollection,
        navHref: '/dashboard/reports/others/denomination-collection',
    },
    'future-demand': {
        slug: 'future-demand',
        reportName: 'Future Demand Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchFutureDemand,
        navHref: '/dashboard/reports/demand/future-demand',
    },
    'future-report': {
        slug: 'future-report',
        reportName: 'Future Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchFutureReport,
        navHref: '/dashboard/reports/collection/future-report',
    },
    'fdo-performance': {
        slug: 'fdo-performance',
        reportName: 'FDO Performance Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchFdoPerformance,
        navHref: '/dashboard/reports/employee/fdo-performance',
    },

    'trial-balance': {
        slug: 'trial-balance',
        reportName: 'Trial Balance',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchTrialBalance,
        navHref: '/dashboard/admin-reports/account/trial-balance',
    },
    'opening-balance': {
        slug: 'opening-balance',
        reportName: 'Opening Balance',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchOpeningBalance,
        navHref: '/dashboard/accounts/opening-balance',
    },
    'incentive-report': {
        slug: 'incentive-report',
        reportName: 'Incentive Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchIncentiveReport,
        navHref: '/dashboard/reports/employee/incentive-report',
    },
    'insurance-report': {
        slug: 'insurance-report',
        reportName: 'Insurance Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchInsuranceReport,
        navHref: '/dashboard/reports/others/insurance',
    },
    'par': {
        slug: 'par',
        reportName: 'Portfolio At Risk (PAR) Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: true,
        fetch: fetchPar,
        navHref: '/dashboard/reports/portfolio/par',
    },
    'loan-index': {
        slug: 'loan-index',
        reportName: 'Loan Index Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: true,
        fetch: fetchLoanIndex,
        navHref: '/dashboard/reports/others/loan-index',
    },
    'neft-format': {
        slug: 'neft-format',
        reportName: 'NEFT Format',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchNeftFormat,
        navHref: '/dashboard/reports/others/neft-format',
    },
    'branch-profile': {
        slug: 'branch-profile',
        reportName: 'Branch Profile',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchBranchProfile,
        navHref: '/dashboard/reports/others/branch-profile',
    },
    'payslip': {
        slug: 'payslip',
        reportName: 'Payslip Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchPayslip,
        navHref: '/dashboard/reports/employee/payslip',
    },
    'receipts': {
        slug: 'receipts',
        reportName: 'Collection Receipts',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchReceipts,
        navHref: '/dashboard/reports/collection/receipts',
    },
    'loan-savings': {
        slug: 'loan-savings',
        reportName: 'Loan Savings Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchLoanSavings,
        navHref: '/dashboard/reports/collection/loan-savings',
    },
    'loan-ledger': {
        slug: 'loan-ledger',
        reportName: 'Loan Ledger Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchLoanLedger,
        navHref: '/dashboard/reports/client/loan-ledger',
    },
    'loan-passbook': {
        slug: 'loan-passbook',
        reportName: 'Loan Passbook',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchLoanPassbook,
        navHref: '/dashboard/reports/client/loan-passbook',
    },
    'loan-schedule': {
        slug: 'loan-schedule',
        reportName: 'Loan Schedule Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchLoanSchedule,
        navHref: '/dashboard/reports/client/loan-schedule',
    },
    'closed-loan-report': {
        slug: 'closed-loan-report',
        reportName: 'Closed Loan Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchClosedLoanReport,
        navHref: '/dashboard/reports/client/closed-loan-report',
    },
    'death-member': {
        slug: 'death-member',
        reportName: 'Death Member Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchDeathMember,
        navHref: '/dashboard/reports/client/death-member',
    },
    'client-portfolio-report': {
        slug: 'client-portfolio-report',
        reportName: 'Client Portfolio Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchClientPortfolioReport,
        navHref: '/dashboard/admin-reports/portfolio/client-portfolio-report',
    },
    'task-report': {
        slug: 'task-report',
        reportName: 'FDO Task Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchTaskReport,
        navHref: '/dashboard/reports/employee/task-report',
    },
    'mis-agewise-arrear': {
        slug: 'mis-agewise-arrear',
        reportName: 'Arrear Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchMisAgewiseArrear,
        navHref: '/dashboard/mis-reports/agewise-arrear',
    },
    'mis-ledger-report': {
        slug: 'mis-ledger-report',
        reportName: 'MIS Ledger Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchMisLedgerReport,
        navHref: '/dashboard/mis-reports/ledger-report',
    },
    'performance-report': {
        slug: 'performance-report',
        reportName: 'Performance Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchPerformanceReport,
        navHref: '/dashboard/mis-reports/performance',
    },
    'loan-advance-ledger': {
        slug: 'loan-advance-ledger',
        reportName: 'Loan Advance Ledger Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchLoanAdvanceLedger,
        navHref: '/dashboard/reports/client/loan-advance',
    },
    'company-profile': {
        slug: 'company-profile',
        reportName: 'Company Profile',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchCompanyProfile,
        navHref: '/dashboard/mis-reports/company-profile',
    },
    'member-report': {
        slug: 'member-report',
        reportName: 'Member Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchMemberReport,
        navHref: '/dashboard/reports/client/member-report',
    },

    // ── Catalog-only entries (no `fetch`) — these reports keep their existing
    // client-side direct-download export; they're registered here only so they
    // get a ReportPermission row and show up in /dashboard/admin/report-permissions. ──
    'compare-ilgl': {
        slug: 'compare-ilgl',
        reportName: 'Compare IL GL Values',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchCompareIlgl,
        navHref: '/dashboard/admin-reports/account/compare-ilgl',
    },
    'gl-all': {
        slug: 'gl-all',
        reportName: 'General Ledger - All Accounts',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchGlAll,
        navHref: '/dashboard/admin-reports/account/gl-all',
    },
    'gl-account-ledger': {
        slug: 'gl-account-ledger',
        reportName: 'GL Account Ledger Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchGlOne,
        navHref: '/dashboard/admin-reports/account/gl-one',
    },
    'receipts-payments': {
        slug: 'receipts-payments',
        reportName: 'Receipts & Payments Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false, // stale flag fixed — no center filter exists anywhere in the underlying query
        fetch: fetchReceiptsPayments,
        navHref: '/dashboard/admin-reports/account/receipts-payments',
    },
    'voucher-print': {
        slug: 'voucher-print',
        reportName: 'Voucher Print',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchVoucherPrint,
        navHref: '/dashboard/admin-reports/account/voucher-print',
    },
    'daybook': {
        slug: 'daybook',
        reportName: 'Daybook Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false, // stale flag fixed — no center filter exists anywhere in the underlying query
        fetch: fetchDaybook,
        navHref: '/dashboard/admin-reports/account/daybook',
    },
    'funder-interest': {
        slug: 'funder-interest',
        reportName: 'Funder Interest Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchFunderInterest,
        navHref: '/dashboard/admin-reports/funders/funder-interest',
    },
    'funder-report': {
        slug: 'funder-report',
        reportName: 'Funder Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchFunderReport,
        navHref: '/dashboard/admin-reports/funders/funder-report',
    },
    'os-branchwise': {
        slug: 'os-branchwise',
        reportName: 'Outstanding Branchwise Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchOSBranchwise,
        navHref: '/dashboard/admin-reports/portfolio/os-branchwise',
    },
    'clientwise-dcb': {
        slug: 'clientwise-dcb',
        reportName: 'Clientwise DCB Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: true,
        fetch: fetchClientwiseDcb,
        navHref: '/dashboard/admin-reports/portfolio/clientwise-dcb',
    },
    'center-master-summary': {
        slug: 'center-master-summary',
        reportName: 'Center Master Summary Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchCenterMasterSummary,
        navHref: '/dashboard/admin-reports/portfolio/center-master-report',
    },
    'portfolio-agewise-arrear': {
        slug: 'portfolio-agewise-arrear',
        reportName: 'Portfolio Age-wise Arrear Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: true,
        fetch: fetchPortfolioAgewiseArrear,
        navHref: '/dashboard/admin-reports/portfolio/agewise-arrear',
    },
    'os-clientwise-admin': {
        slug: 'os-clientwise-admin',
        reportName: 'OS Clientwise Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchOSClientwiseCore,
        navHref: '/dashboard/admin-reports/portfolio/os-clientwise',
    },
    'highmark-log': {
        slug: 'highmark-log',
        reportName: 'Highmark Log',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: true,
        fetch: fetchHighmarkLog,
        navHref: '/dashboard/reports/others/highmark-log',
    },
    'pending-items': {
        slug: 'pending-items',
        reportName: 'Pending Items',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: false,
        fetch: fetchPendingItems,
        navHref: '/dashboard/reports/others/pending-items',
    },
    'individual-ledger': {
        slug: 'individual-ledger',
        reportName: 'Individual Ledger Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchIndividualLedger,
        navHref: '/dashboard/reports/portfolio/individual-ledger',
    },
    'loan-disbursement': {
        slug: 'loan-disbursement',
        reportName: 'Loan Disbursement Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: true,
        fetch: fetchLoanDisbursement,
        navHref: '/dashboard/reports/portfolio/loan-disbursement',
    },
    'loan-os-client': {
        slug: 'loan-os-client',
        reportName: 'Loan OS Client Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: true,
        fetch: fetchOSClientwiseCore,
        navHref: '/dashboard/reports/portfolio/os-clientwise',
    },
    'os-centerwise': {
        slug: 'os-centerwise',
        reportName: 'Loan OS Center Report',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchOSCenterwise,
        navHref: '/dashboard/reports/portfolio/os-centerwise',
    },
    'arrear-demand-sheet': {
        slug: 'arrear-demand-sheet',
        reportName: 'Arrear Demand Sheet',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: true,
        fetch: fetchArrearDemandSheet,
        navHref: '/dashboard/reports/demand/arrear-demand-sheet',
    },
    'branch-demand': {
        slug: 'branch-demand',
        reportName: 'Branch Demand',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: true,
        fetch: fetchBranchDemandField,
        navHref: '/dashboard/reports/demand/branch-demand',
    },
    'demand-sheet': {
        slug: 'demand-sheet',
        reportName: 'Demand Sheet',
        moduleSlug: 'reports',
        dateMode: 'SINGLE',
        requiresCenter: false,
        fetch: fetchDemandSheet,
        navHref: '/dashboard/reports/demand/demand-sheet',
    },
    'application-form': {
        slug: 'application-form',
        reportName: 'Client Loan Application Report',
        moduleSlug: 'reports',
        dateMode: 'NONE',
        requiresCenter: true,
        fetch: fetchApplicationForm,
        navHref: '/dashboard/reports/client/application-form',
    },
    'mis-all-dcb': {
        slug: 'mis-all-dcb',
        reportName: 'MIS All Branch DCB Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchMisAllDcb,
        navHref: '/dashboard/mis-reports/all-dcb',
    },
    'mis-disbursement': {
        slug: 'mis-disbursement',
        reportName: 'MIS Disbursement Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: true,
        fetch: fetchMisDisbursement,
        navHref: '/dashboard/mis-reports/disbursement',
    },
    'mis-branch-demand': {
        slug: 'mis-branch-demand',
        reportName: 'MIS Branch Demand Report',
        moduleSlug: 'reports',
        dateMode: 'RANGE',
        requiresCenter: false,
        fetch: fetchMisBranchDemand,
        navHref: '/dashboard/mis-reports/branch-demand',
    },
};

export function getReportEntry(slug: string): ReportRegistryEntry | undefined {
    return REPORT_REGISTRY[slug];
}

export function listReportEntries(): ReportRegistryEntry[] {
    return Object.values(REPORT_REGISTRY);
}

/** True only for reports with a working `fetch` adapter — i.e. capable of the async Request Report queue. Everything else is DIRECT-only regardless of what exportMode is stored. */
export function isQueueCapable(slug: string): boolean {
    return typeof REPORT_REGISTRY[slug]?.fetch === 'function';
}
