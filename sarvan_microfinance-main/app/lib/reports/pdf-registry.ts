import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { buildGlAllQueuePdf } from "@/app/lib/reports/gl-all-pdf-queue";
import { buildGlAccountLedgerQueuePdf } from "@/app/lib/reports/gl-account-ledger-pdf-queue";
import { buildOpeningBalanceQueuePdf } from "@/app/lib/reports/opening-balance-pdf-queue";
import { buildMisLedgerReportQueuePdf } from "@/app/lib/reports/mis-ledger-report-pdf-queue";
import { buildVoucherPrintQueuePdf } from "@/app/lib/reports/voucher-print-pdf-queue";
import { buildReceiptsPaymentsQueuePdf } from "@/app/lib/reports/receipts-payments-pdf-queue";
import { buildLoanIndexQueuePdf } from "@/app/lib/reports/loan-index-pdf-queue";
import { buildLoanLedgerQueuePdf } from "@/app/lib/reports/loan-ledger-pdf-queue";
import { buildTaskReportQueuePdf } from "@/app/lib/reports/task-report-pdf-queue";
import { buildOsBranchwiseQueuePdf } from "@/app/lib/reports/os-branchwise-pdf-queue";
import { buildBranchProfileQueuePdf } from "@/app/lib/reports/branch-profile-pdf-queue";
import { buildCompanyProfileQueuePdf } from "@/app/lib/reports/company-profile-pdf-queue";
import { buildDenominationCollectionQueuePdf } from "@/app/lib/reports/denomination-collection-pdf-queue";
import { buildDcbQueuePdf } from "@/app/lib/reports/dcb-pdf-queue";
import { buildParQueuePdf } from "@/app/lib/reports/par-pdf-queue";
import { buildDaybookQueuePdf } from "@/app/lib/reports/daybook-pdf-queue";
import { buildIncentiveReportQueuePdf } from "@/app/lib/reports/incentive-report-pdf-queue";
import { buildMisAllDcbQueuePdf } from "@/app/lib/reports/mis-all-dcb-pdf-queue";
import { buildCenterMasterSummaryQueuePdf } from "@/app/lib/reports/center-master-summary-pdf-queue";
import { buildNeftFormatQueuePdf } from "@/app/lib/reports/neft-format-pdf-queue";
import { buildCcrQueuePdf } from "@/app/lib/reports/ccr-pdf-queue";
import { buildMisDisbursementQueuePdf } from "@/app/lib/reports/mis-disbursement-pdf-queue";
import { buildClosedLoanReportQueuePdf } from "@/app/lib/reports/closed-loan-report-pdf-queue";
import { buildDeathMemberQueuePdf } from "@/app/lib/reports/death-member-pdf-queue";
import { buildLoanDisbursementQueuePdf } from "@/app/lib/reports/loan-disbursement-pdf-queue";
import { buildClientPortfolioReportQueuePdf } from "@/app/lib/reports/client-portfolio-report-pdf-queue";
import { buildAdditionDeletionQueuePdf } from "@/app/lib/reports/addition-deletion-pdf-queue";
import { buildAdditionDisbursedQueuePdf } from "@/app/lib/reports/addition-disbursed-pdf-queue";
import { buildArrearDemandSheetQueuePdf } from "@/app/lib/reports/arrear-demand-sheet-pdf-queue";
import { buildAttendanceDetailedQueuePdf } from "@/app/lib/reports/attendance-detailed-pdf-queue";
import { buildAttendanceSummaryQueuePdf } from "@/app/lib/reports/attendance-summary-pdf-queue";
import { buildBalanceInformationQueuePdf } from "@/app/lib/reports/balance-information-pdf-queue";
import { buildCenterMasterQueuePdf } from "@/app/lib/reports/center-master-pdf-queue";
import { buildCompareIlglQueuePdf } from "@/app/lib/reports/compare-ilgl-pdf-queue";
import { buildClientwiseDcbQueuePdf } from "@/app/lib/reports/clientwise-dcb-pdf-queue";
import { buildBranchDemandQueuePdf } from "@/app/lib/reports/branch-demand-pdf-queue";
import { buildDoubleClientsQueuePdf } from "@/app/lib/reports/double-clients-pdf-queue";
import { buildDcrQueuePdf } from "@/app/lib/reports/dcr-pdf-queue";
import { buildDropoutsQueuePdf } from "@/app/lib/reports/dropouts-pdf-queue";
import { buildMeetingCheckQueuePdf } from "@/app/lib/reports/meeting-check-pdf-queue";
import { buildOsCenterwiseQueuePdf } from "@/app/lib/reports/os-centerwise-pdf-queue";
import { buildMisBranchDemandQueuePdf } from "@/app/lib/reports/mis-branch-demand-pdf-queue";
import { buildFunderInterestQueuePdf } from "@/app/lib/reports/funder-interest-pdf-queue";
import { buildOsClientwiseQueuePdf } from "@/app/lib/reports/os-clientwise-pdf-queue";
import { buildPerformanceReportQueuePdf } from "@/app/lib/reports/performance-report-pdf-queue";
import { buildPreclosureQueuePdf } from "@/app/lib/reports/preclosure-pdf-queue";
import { buildTransferQueuePdf } from "@/app/lib/reports/transfer-pdf-queue";
import { buildAgewiseArrearQueuePdf } from "@/app/lib/reports/agewise-arrear-pdf-queue";
import { buildReceiptsQueuePdf } from "@/app/lib/reports/receipts-pdf-queue";
import { buildFdoPerformanceQueuePdf } from "@/app/lib/reports/fdo-performance-pdf-queue";
import { buildLoanPassbookQueuePdf } from "@/app/lib/reports/loan-passbook-pdf-queue";
import { buildLoanSavingsQueuePdf } from "@/app/lib/reports/loan-savings-pdf-queue";
import { buildLoanAdvanceLedgerQueuePdf } from "@/app/lib/reports/loan-advance-ledger-pdf-queue";
import { buildIndividualLedgerQueuePdf } from "@/app/lib/reports/individual-ledger-pdf-queue";
import { buildLoanOsDetailsQueuePdf } from "@/app/lib/reports/loan-os-details-pdf-queue";
import { buildInsuranceReportQueuePdf } from "@/app/lib/reports/insurance-report-pdf-queue";
import { buildMcrQueuePdf } from "@/app/lib/reports/mcr-pdf-queue";
import { buildFunderReportQueuePdf } from "@/app/lib/reports/funder-report-pdf-queue";
import { buildMeetingAttendanceQueuePdf } from "@/app/lib/reports/meeting-attendance-pdf-queue";
import { buildWaitingBorrowersQueuePdf } from "@/app/lib/reports/waiting-borrowers-pdf-queue";
import { buildLoanScheduleQueuePdf } from "@/app/lib/reports/loan-schedule-pdf-queue";
import { buildFutureDemandQueuePdf } from "@/app/lib/reports/future-demand-pdf-queue";
import { buildFutureReportQueuePdf } from "@/app/lib/reports/future-report-pdf-queue";
import { buildGoldTakenQueuePdf } from "@/app/lib/reports/gold-taken-pdf-queue";
import { buildGoldReturnedQueuePdf } from "@/app/lib/reports/gold-returned-pdf-queue";
import { buildMisAgewiseArrearQueuePdf } from "@/app/lib/reports/mis-agewise-arrear-pdf-queue";
import { buildTrialBalanceQueuePdf } from "@/app/lib/reports/trial-balance-pdf-queue";
import { buildPayslipQueuePdf } from "@/app/lib/reports/payslip-pdf-queue";

export type PdfRenderer = (ctx: BuildReportFileContext) => Promise<Buffer>;

/**
 * Per-report PDF renderers that reproduce their own Direct Download PDF's
 * structure (rather than the generic flat-table Puppeteer layout every
 * unregistered report slug falls back to — see generic-file-builder.ts's
 * buildReportFile() PDF case, which checks this registry first).
 *
 * A reportSlug with no entry here falls straight through to the generic PDF
 * renderer, unchanged — adding a report here is the only step a future
 * migration needs in generic-file-builder.ts itself.
 *
 * Note: "demand-sheet" predates this registry and is intentionally NOT listed
 * here — it is still handled by its own dedicated check directly inside
 * generic-file-builder.ts, left untouched by this file.
 */
export const pdfRegistry: Record<string, PdfRenderer> = {
  "gl-all": buildGlAllQueuePdf,
  "gl-account-ledger": buildGlAccountLedgerQueuePdf,
  "opening-balance": buildOpeningBalanceQueuePdf,
  "mis-ledger-report": buildMisLedgerReportQueuePdf,
  "voucher-print": buildVoucherPrintQueuePdf,
  "receipts-payments": buildReceiptsPaymentsQueuePdf,
  "loan-index": buildLoanIndexQueuePdf,
  "loan-ledger": buildLoanLedgerQueuePdf,
  "task-report": buildTaskReportQueuePdf,
  "os-branchwise": buildOsBranchwiseQueuePdf,
  "branch-profile": buildBranchProfileQueuePdf,
  "company-profile": buildCompanyProfileQueuePdf,
  "denomination-collection": buildDenominationCollectionQueuePdf,
  "dcb": buildDcbQueuePdf,
  "par": buildParQueuePdf,
  "daybook": buildDaybookQueuePdf,
  "incentive-report": buildIncentiveReportQueuePdf,
  "mis-all-dcb": buildMisAllDcbQueuePdf,
  "center-master-summary": buildCenterMasterSummaryQueuePdf,
  "neft-format": buildNeftFormatQueuePdf,
  "ccr": buildCcrQueuePdf,
  "mis-disbursement": buildMisDisbursementQueuePdf,
  "closed-loan-report": buildClosedLoanReportQueuePdf,
  "death-member": buildDeathMemberQueuePdf,
  "loan-disbursement": buildLoanDisbursementQueuePdf,
  "client-portfolio-report": buildClientPortfolioReportQueuePdf,
  "addition-deletion": buildAdditionDeletionQueuePdf,
  "addition-disbursed": buildAdditionDisbursedQueuePdf,
  "arrear-demand-sheet": buildArrearDemandSheetQueuePdf,
  "attendance-detailed": buildAttendanceDetailedQueuePdf,
  "attendance-summary": buildAttendanceSummaryQueuePdf,
  "balance-information": buildBalanceInformationQueuePdf,
  "center-master": buildCenterMasterQueuePdf,
  "compare-ilgl": buildCompareIlglQueuePdf,
  "clientwise-dcb": buildClientwiseDcbQueuePdf,
  "branch-demand": buildBranchDemandQueuePdf,
  "double-clients": buildDoubleClientsQueuePdf,
  "dcr": buildDcrQueuePdf,
  "dropouts": buildDropoutsQueuePdf,
  "meeting-check": buildMeetingCheckQueuePdf,
  "os-centerwise": buildOsCenterwiseQueuePdf,
  "mis-branch-demand": buildMisBranchDemandQueuePdf,
  "funder-interest": buildFunderInterestQueuePdf,
  "os-clientwise-admin": buildOsClientwiseQueuePdf,
  // "loan-os-client" shares fetchOSClientwiseCore (same getOSClientwiseData query/columns) with
  // os-clientwise-admin by design (see report-registry.ts's comment on fetchOSClientwiseCore) —
  // its own page has no working Direct PDF of its own (stub handleExport, mock data), so the
  // shared os-clientwise-admin renderer is the correct parity target.
  "loan-os-client": buildOsClientwiseQueuePdf,
  "performance-report": buildPerformanceReportQueuePdf,
  "preclosure": buildPreclosureQueuePdf,
  "transfer": buildTransferQueuePdf,
  "portfolio-agewise-arrear": buildAgewiseArrearQueuePdf,
  "receipts": buildReceiptsQueuePdf,
  "fdo-performance": buildFdoPerformanceQueuePdf,
  "loan-passbook": buildLoanPassbookQueuePdf,
  "loan-savings": buildLoanSavingsQueuePdf,
  "loan-advance-ledger": buildLoanAdvanceLedgerQueuePdf,
  "individual-ledger": buildIndividualLedgerQueuePdf,
  "loan-os-details": buildLoanOsDetailsQueuePdf,
  "insurance-report": buildInsuranceReportQueuePdf,
  "mcr": buildMcrQueuePdf,
  "funder-report": buildFunderReportQueuePdf,
  "meeting-attendance": buildMeetingAttendanceQueuePdf,
  "waiting-borrowers": buildWaitingBorrowersQueuePdf,
  "loan-schedule": buildLoanScheduleQueuePdf,
  "future-demand": buildFutureDemandQueuePdf,
  "future-report": buildFutureReportQueuePdf,
  "gold-taken": buildGoldTakenQueuePdf,
  "gold-returned": buildGoldReturnedQueuePdf,
  "mis-agewise-arrear": buildMisAgewiseArrearQueuePdf,
  "trial-balance": buildTrialBalanceQueuePdf,
  "payslip": buildPayslipQueuePdf,
};
