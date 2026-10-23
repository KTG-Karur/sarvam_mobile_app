// ============================================================
// SERVER-SIDE WORD OPTIONS REGISTRY
// app/lib/reports/word/options-registry.ts
//
// Maps a reportSlug to a pure function that reconstructs the SAME WordExportOptions
// its direct (client-side) export builds — grouped headers, alignments, column
// widths, totals row, page size, footer text — from the flat {headers, rows} the
// report's registry `fetch()` adapter already returns for the queue. This is how
// queued Word gets the identical design to direct Word without duplicating each
// report's layout logic: the layout config itself (groupHeaders/subHeaders/
// columnAlignments/columnWidthWeights/pageSize/footerText) is static and
// data-independent, so it's reproduced verbatim here; only the data-derived pieces
// (totalsRow, reportInfo, summary) are recomputed from the already-fetched rows.
//
// A reportSlug with no entry here falls back to the flat/legacy layout (same as
// what a report gets today if its own exportToWord() call omits `options`) — see
// generic-file-builder.ts's buildWord(). As of this writing, 4 reports fall back
// intentionally because the registry's `fetch()` returns a genuinely different
// column shape than the direct export (gold-taken, gold-returned, loan-index,
// loan-ledger — each documented in their investigation as missing specific
// columns server-side), and `par` similarly (48 vs 49 columns) — these were left
// unmapped rather than force-matched, per explicit instruction not to invent data.
// `member-report` has no Word export at all in any mode. `loan-passbook` uses a
// registry fetch that's an intentional generic substitute for a bespoke PDF, not
// a mirror of the direct Word layout.
// ============================================================

import type { CellValue, WordExportOptions } from '@/app/lib/reports/word/docx-core';

export type WordOptionsBuilderContext = {
    /** Raw filters bag from the ReportRequest row (e.g. { reportType: 'clientwise' }). */
    filters: Record<string, string> | null;
    /** Denormalized branch label already resolved for display (ReportRequest.branchLabel). */
    branchLabel: string;
    fromDate: string | null;
    toDate: string | null;
};

export type WordOptionsResult = { bodyRows: CellValue[][]; options?: WordExportOptions };

export type WordOptionsBuilder = (
    headers: CellValue[],
    rows: CellValue[][],
    ctx: WordOptionsBuilderContext
) => WordOptionsResult | Promise<WordOptionsResult>;

import { buildAttendanceSummaryWordExport } from '@/app/lib/reports/word/options/attendance-summary';
import { buildLoanDisbursementWordExport } from '@/app/lib/reports/word/options/loan-disbursement';
import { buildDemandSheetWordExport } from '@/app/lib/reports/word/options/demand-sheet';
import { buildCompareIlglWordExport } from '@/app/lib/reports/word/options/compare-ilgl';
import { buildDaybookWordExport } from '@/app/lib/reports/word/options/daybook';
import { buildGlAllWordExport } from '@/app/lib/reports/word/options/gl-all';
import { buildGlAccountLedgerWordExport } from '@/app/lib/reports/word/options/gl-account-ledger';
import { buildReceiptsPaymentsWordExport } from '@/app/lib/reports/word/options/receipts-payments';
import { buildVoucherPrintWordExport } from '@/app/lib/reports/word/options/voucher-print';
import { buildFunderInterestWordExport } from '@/app/lib/reports/word/options/funder-interest';
import { buildFunderReportWordExport } from '@/app/lib/reports/word/options/funder-report';
import { buildCenterMasterSummaryWordExport } from '@/app/lib/reports/word/options/center-master-summary';
import { buildOsBranchwiseWordExport } from '@/app/lib/reports/word/options/os-branchwise';
import { buildOsClientwiseAdminWordExport } from '@/app/lib/reports/word/options/os-clientwise-admin';
import { buildMisAllDcbWordExport } from '@/app/lib/reports/word/options/mis-all-dcb';
import { buildMisBranchDemandWordExport } from '@/app/lib/reports/word/options/mis-branch-demand';
import { buildMisDisbursementWordExport } from '@/app/lib/reports/word/options/mis-disbursement';
import { buildArrearDemandSheetWordExport } from '@/app/lib/reports/word/options/arrear-demand-sheet';
import { buildIndividualLedgerWordExport } from '@/app/lib/reports/word/options/individual-ledger';
import { buildOsCenterwiseWordExport } from '@/app/lib/reports/word/options/os-centerwise';
import { buildOpeningBalanceWordExport } from '@/app/lib/reports/word/options/opening-balance';
import { buildTrialBalanceWordExport } from '@/app/lib/reports/word/options/trial-balance';
import { buildMisAgewiseArrearWordExport } from '@/app/lib/reports/word/options/mis-agewise-arrear';
import { buildMisLedgerReportWordExport } from '@/app/lib/reports/word/options/mis-ledger-report';
import { buildLoanOsDetailsWordExport } from '@/app/lib/reports/word/options/loan-os-details';
import { buildPerformanceReportWordExport } from '@/app/lib/reports/word/options/performance-report';
import { buildPreclosureWordExport } from '@/app/lib/reports/word/options/preclosure';
import { buildAdditionDeletionWordExport } from '@/app/lib/reports/word/options/addition-deletion';
import { buildAdditionDisbursedWordExport } from '@/app/lib/reports/word/options/addition-disbursed';
import { buildApplicationFormWordExport } from '@/app/lib/reports/word/options/application-form';
import { buildAttendanceDetailedWordExport } from '@/app/lib/reports/word/options/attendance-detailed';
import { buildBalanceInformationWordExport } from '@/app/lib/reports/word/options/balance-information';
import { buildBranchDemandWordExport } from '@/app/lib/reports/word/options/branch-demand';
import { buildBranchProfileWordExport } from '@/app/lib/reports/word/options/branch-profile';
import { buildCcrWordExport } from '@/app/lib/reports/word/options/ccr';
import { buildCenterMasterWordExport } from '@/app/lib/reports/word/options/center-master';
import { buildClientPortfolioReportWordExport } from '@/app/lib/reports/word/options/client-portfolio-report';
import { buildClosedLoanReportWordExport } from '@/app/lib/reports/word/options/closed-loan-report';
import { buildCompanyProfileWordExport } from '@/app/lib/reports/word/options/company-profile';
import { buildDcbWordExport } from '@/app/lib/reports/word/options/dcb';
import { buildDcrWordExport } from '@/app/lib/reports/word/options/dcr';
import { buildDeathMemberWordExport } from '@/app/lib/reports/word/options/death-member';
import { buildDenominationCollectionWordExport } from '@/app/lib/reports/word/options/denomination-collection';
import { buildDoubleClientsWordExport } from '@/app/lib/reports/word/options/double-clients';
import { buildDropoutsWordExport } from '@/app/lib/reports/word/options/dropouts';
import { buildFdoPerformanceWordExport } from '@/app/lib/reports/word/options/fdo-performance';
import { buildFutureDemandWordExport } from '@/app/lib/reports/word/options/future-demand';
import { buildFutureReportWordExport } from '@/app/lib/reports/word/options/future-report';
import { buildIncentiveReportWordExport } from '@/app/lib/reports/word/options/incentive-report';
import { buildInsuranceReportWordExport } from '@/app/lib/reports/word/options/insurance-report';
import { buildLoanAdvanceLedgerWordExport } from '@/app/lib/reports/word/options/loan-advance-ledger';
import { buildLoanSavingsWordExport } from '@/app/lib/reports/word/options/loan-savings';
import { buildLoanScheduleWordExport } from '@/app/lib/reports/word/options/loan-schedule';
import { buildMcrWordExport } from '@/app/lib/reports/word/options/mcr';
import { buildMeetingAttendanceWordExport } from '@/app/lib/reports/word/options/meeting-attendance';
import { buildMeetingCheckWordExport } from '@/app/lib/reports/word/options/meeting-check';
import { buildNeftFormatWordExport } from '@/app/lib/reports/word/options/neft-format';
import { buildPayslipWordExport } from '@/app/lib/reports/word/options/payslip';
import { buildReceiptsWordExport } from '@/app/lib/reports/word/options/receipts';
import { buildTaskReportWordExport } from '@/app/lib/reports/word/options/task-report';
import { buildTransferWordExport } from '@/app/lib/reports/word/options/transfer';
import { buildWaitingBorrowersWordExport } from '@/app/lib/reports/word/options/waiting-borrowers';

export const WORD_OPTIONS_REGISTRY: Record<string, WordOptionsBuilder> = {
    'attendance-summary': buildAttendanceSummaryWordExport,
    'loan-disbursement': buildLoanDisbursementWordExport,
    'demand-sheet': buildDemandSheetWordExport,
    'compare-ilgl': buildCompareIlglWordExport,
    'daybook': buildDaybookWordExport,
    'gl-all': buildGlAllWordExport,
    'gl-account-ledger': buildGlAccountLedgerWordExport,
    'receipts-payments': buildReceiptsPaymentsWordExport,
    'voucher-print': buildVoucherPrintWordExport,
    'funder-interest': buildFunderInterestWordExport,
    'funder-report': buildFunderReportWordExport,
    'center-master-summary': buildCenterMasterSummaryWordExport,
    'os-branchwise': buildOsBranchwiseWordExport,
    'os-clientwise-admin': buildOsClientwiseAdminWordExport,
    'mis-all-dcb': buildMisAllDcbWordExport,
    'mis-branch-demand': buildMisBranchDemandWordExport,
    'mis-disbursement': buildMisDisbursementWordExport,
    'arrear-demand-sheet': buildArrearDemandSheetWordExport,
    'individual-ledger': buildIndividualLedgerWordExport,
    'os-centerwise': buildOsCenterwiseWordExport,
    'opening-balance': buildOpeningBalanceWordExport,
    'trial-balance': buildTrialBalanceWordExport,
    'mis-agewise-arrear': buildMisAgewiseArrearWordExport,
    'mis-ledger-report': buildMisLedgerReportWordExport,
    'loan-os-details': buildLoanOsDetailsWordExport,
    'performance-report': buildPerformanceReportWordExport,
    'preclosure': buildPreclosureWordExport,
    'addition-deletion': buildAdditionDeletionWordExport,
    'addition-disbursed': buildAdditionDisbursedWordExport,
    'application-form': buildApplicationFormWordExport,
    'attendance-detailed': buildAttendanceDetailedWordExport,
    'balance-information': buildBalanceInformationWordExport,
    'branch-demand': buildBranchDemandWordExport,
    'branch-profile': buildBranchProfileWordExport,
    'ccr': buildCcrWordExport,
    'center-master': buildCenterMasterWordExport,
    'client-portfolio-report': buildClientPortfolioReportWordExport,
    'closed-loan-report': buildClosedLoanReportWordExport,
    'company-profile': buildCompanyProfileWordExport,
    'dcb': buildDcbWordExport,
    'dcr': buildDcrWordExport,
    'death-member': buildDeathMemberWordExport,
    'denomination-collection': buildDenominationCollectionWordExport,
    'double-clients': buildDoubleClientsWordExport,
    'dropouts': buildDropoutsWordExport,
    'fdo-performance': buildFdoPerformanceWordExport,
    'future-demand': buildFutureDemandWordExport,
    'future-report': buildFutureReportWordExport,
    'incentive-report': buildIncentiveReportWordExport,
    'insurance-report': buildInsuranceReportWordExport,
    'loan-advance-ledger': buildLoanAdvanceLedgerWordExport,
    'loan-savings': buildLoanSavingsWordExport,
    'loan-schedule': buildLoanScheduleWordExport,
    'mcr': buildMcrWordExport,
    'meeting-attendance': buildMeetingAttendanceWordExport,
    'meeting-check': buildMeetingCheckWordExport,
    'neft-format': buildNeftFormatWordExport,
    'payslip': buildPayslipWordExport,
    'receipts': buildReceiptsWordExport,
    'task-report': buildTaskReportWordExport,
    'transfer': buildTransferWordExport,
    'waiting-borrowers': buildWaitingBorrowersWordExport,
};

export function getWordOptionsBuilder(reportSlug: string): WordOptionsBuilder | undefined {
    return WORD_OPTIONS_REGISTRY[reportSlug];
}
