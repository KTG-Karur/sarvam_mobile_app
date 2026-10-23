"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { jsPDF } from "jspdf";
import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx-js-style";
import {
  Download,
  FileDown,
  FileType,
  FileOutput,
  Printer,
  Building2,
  Loader2,
  Search,
  MapPin,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/app/lib/api-client";
import { usePermission } from "@/app/hooks/usePermission";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { drawBranchProfileReport } from "@/app/lib/reports/branch-profile-pdf";
import { reportHeaderRows, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { exportToCSV, exportToWord, type WordExportOptions } from "@/app/lib/report-export-utils";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BranchOption {
  id: string;
  name: string;
  code: string;
}

interface SinceAprilData {
  openingMembers: number;
  newMembers: number;
  rejectedMembers: number;
  closingMembers: number;
  waitingBorrowers: number;
  activeMembers: number;
  loanDisbursement: number;
  loanDisbursementMemberCount: number;
  cumulativeArrear: number;
  arrearMemberCount: number;
  parPercent: number;
}

interface CurrentDayData {
  openingMembers: number;
  newMembers: number;
  rejectedMembers: number;
  closingMembers: number;
  waitingBorrowers: number;
  activeMembers: number;
  loanDisbursement: number;
  outstandingBalance: number;
  demandPrincipal: number;
  demandInterest: number;
  demandTotal: number;
  collectionPrincipal: number;
  collectionInterest: number;
  collectionTotal: number;
  arrearPrincipal: number;
  arrearTotal: number;
  recoveryRate: number;
  arrearCollection: number;
  advanceCollection: number;
}

interface BranchProfileData {
  branchInfo: {
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    branchStartDate: string;
    noOfCenters: number;
    noOfGroups: number;
    noOfFdo: number;
  };
  reportMeta: {
    branchProfileDate: string;
    reportDayName: string;
    reportYmd: string;
  };
  sinceApril: SinceAprilData;
  currentDay: CurrentDayData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayYmd(): string {
  return toDisplayDate(new Date());
}

function fmtAmt(n: number): string {
  return `₹ ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.trunc(n))}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-IN");
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value, accent }: { label: string; value: string | number; accent?: "red" | "green" | "amber" }) {
  const valClass =
    accent === "red"
      ? "text-red-600 dark:text-red-400"
      : accent === "green"
      ? "text-primary dark:text-primary"
      : accent === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground dark:text-white";

  return (
    <li className="flex items-center justify-between py-2.5 px-4 border-b border-primary/10 dark:border-sidebar-accent last:border-0 hover:bg-green-50/40 dark:hover:bg-sidebar-accent/30 transition-colors">
      <span className="text-sm font-medium text-sidebar-accent dark:text-slate-400 pr-2">
        {label}
      </span>
      <span className={`text-sm font-bold text-right ${valClass}`}>{value}</span>
    </li>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <li className="px-4 py-1.5 bg-brand-green-tint dark:bg-sidebar-accent/40 border-y border-primary/15 dark:border-sidebar-accent">
      <span className="text-xs font-bold uppercase tracking-wider text-primary dark:text-primary">
        {label}
      </span>
    </li>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BranchProfileClient() {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const { hasRole, canExportReport, getReportExportMode } = usePermission();

  const isAdmin = hasRole("admin");
  const isAreaManager = hasRole("area-manager");
  const canSelectBranch = isAdmin || isAreaManager;

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [reportDate, setReportDate] = useState(todayYmd());
  // Submitted (applied) date snapshot — frozen until the next Generate Report click, so the
  // Request-Queue exportParams keeps using the last-generated date even if reportDate is
  // edited afterward without clicking Generate Report again.
  const [submittedReportDate, setSubmittedReportDate] = useState(reportDate);
  const [isLoading, setIsLoading] = useState(false);
  const [isBranchLoading, setIsBranchLoading] = useState(false);
  const [data, setData] = useState<BranchProfileData | null>(null);

  useEffect(() => {
    if (!canSelectBranch) return;
    setIsBranchLoading(true);
    apiClient
      .get<BranchOption[]>("/reports/others/branch-profile/branches")
      .then((res) => {
        if (res.success && res.data) setBranches(res.data);
      })
      .finally(() => setIsBranchLoading(false));
  }, [canSelectBranch]);

  const handleGenerate = async () => {
    if (canSelectBranch && !selectedBranch) {
      toast({ title: "Branch is required", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ reportDate });
      if (canSelectBranch && selectedBranch) params.set("branchId", selectedBranch);
      const result = await apiClient.get<BranchProfileData>(
        `/reports/others/branch-profile?${params}`
      );
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to load report");
      }
      setSubmittedReportDate(reportDate);
      setData(result.data);
      toast({ title: "Branch Profile generated" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "Branch_Profile_Report",
  });

  // ─── Excel Export ──────────────────────────────────────────────────────────

  const handleExportExcel = () => {
    if (!data) return;
    const { branchInfo, reportMeta, sinceApril, currentDay } = data;
    const cdHeader = `On ${reportMeta.branchProfileDate} (${reportMeta.reportDayName})`;

    const ws_data: (string | number)[][] = [
      ...reportHeaderRows("Branch Profile"),
      ["Region", branchInfo.regionName, "Division", branchInfo.divisionName, "Area", branchInfo.areaName],
      ["Branch ID", branchInfo.branchId, "Branch Name", branchInfo.branchName],
      ["Branch Start Date", branchInfo.branchStartDate, "Profile Date", reportMeta.branchProfileDate],
      ["No. of Centers", branchInfo.noOfCenters, "No. of Groups", branchInfo.noOfGroups, "No. of FDOs", branchInfo.noOfFdo],
      ["No. of Members", sinceApril.closingMembers, "Active Borrowers", sinceApril.activeMembers, "Arrear Member Count", sinceApril.arrearMemberCount],
      ["Outstanding Balance", truncateReportAmount(currentDay.outstandingBalance), "Cumulative Arrear", truncateReportAmount(sinceApril.cumulativeArrear)],
      [],
      ["Particulars", "Since April", cdHeader],
      ["Opening Members", sinceApril.openingMembers, currentDay.openingMembers],
      ["New Members", sinceApril.newMembers, currentDay.newMembers],
      ["Rejected Members", sinceApril.rejectedMembers, currentDay.rejectedMembers],
      ["Closing Members", sinceApril.closingMembers, currentDay.closingMembers],
      ["Waiting Borrowers", sinceApril.waitingBorrowers, currentDay.waitingBorrowers],
      ["Active Members", sinceApril.activeMembers, currentDay.activeMembers],
      ["Loan Disbursement (₹)", truncateReportAmount(sinceApril.loanDisbursement), truncateReportAmount(currentDay.loanDisbursement)],
      ["Loan Disbursement Member Count", sinceApril.loanDisbursementMemberCount, "—"],
      ["Outstanding Balance (₹)", "—", truncateReportAmount(currentDay.outstandingBalance)],
      ["Demand Principal (₹)", "—", truncateReportAmount(currentDay.demandPrincipal)],
      ["Demand Interest (₹)", "—", truncateReportAmount(currentDay.demandInterest)],
      ["Demand Total (₹)", "—", truncateReportAmount(currentDay.demandTotal)],
      ["Collected Principal (₹)", "—", truncateReportAmount(currentDay.collectionPrincipal)],
      ["Collected Interest (₹)", "—", truncateReportAmount(currentDay.collectionInterest)],
      ["Total Collection (₹)", "—", truncateReportAmount(currentDay.collectionTotal)],
      ["Cumulative Arrear (₹)", truncateReportAmount(sinceApril.cumulativeArrear), "—"],
      ["Arrear Member Count", sinceApril.arrearMemberCount, "—"],
      ["Arrear Principal (₹)", "—", truncateReportAmount(currentDay.arrearPrincipal)],
      ["Arrear Total (₹)", "—", truncateReportAmount(currentDay.arrearTotal)],
      ["PAR %", sinceApril.parPercent, "—"],
      ["Recovery Rate %", "—", currentDay.recoveryRate],
      ["Arrear Collection (₹)", "—", truncateReportAmount(currentDay.arrearCollection)],
      ["Advance Collection (₹)", "—", truncateReportAmount(currentDay.advanceCollection)],
    ];

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 28 }];
    applyExcelReportFont(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Branch Profile");
    XLSX.writeFile(wb, `Branch_Profile_${branchInfo.branchName}_${reportMeta.branchProfileDate}.xlsx`);
    toast({ title: "Excel exported" });
  };

  // ─── PDF Export ────────────────────────────────────────────────────────────

  const handlePdfExport = async () => {
    if (!data) return;
    const { branchInfo, reportMeta } = data;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const reportFont = await ensureReportFont(doc);

    try {
      await drawBranchProfileReport(doc, data, reportFont);

      doc.save(`Branch_Profile_${branchInfo.branchName}_${reportMeta.branchProfileDate}.pdf`);
      toast({ title: "PDF exported" });
    } catch {
      toast({ title: "Export Failed", variant: "destructive" });
    }
  };

  // ── CSV / Word export (mirrors the same field mapping used by handleExportExcel
  // above, kept separate so handleExportExcel is left untouched) ────────────────

  const buildBranchProfileExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    if (!data) return { headers: [], rows: [] };
    const { branchInfo, reportMeta, sinceApril, currentDay } = data;
    const cdHeader = `On ${reportMeta.branchProfileDate} (${reportMeta.reportDayName})`;

    const headers = ["Field 1", "Value 1", "Field 2", "Value 2", "Field 3", "Value 3"];
    const rows: (string | number)[][] = [
      ["Region", branchInfo.regionName, "Division", branchInfo.divisionName, "Area", branchInfo.areaName],
      ["Branch ID", branchInfo.branchId, "Branch Name", branchInfo.branchName, "", ""],
      ["Branch Start Date", branchInfo.branchStartDate, "Profile Date", reportMeta.branchProfileDate, "", ""],
      ["No. of Centers", branchInfo.noOfCenters, "No. of Groups", branchInfo.noOfGroups, "No. of FDOs", branchInfo.noOfFdo],
      ["No. of Members", sinceApril.closingMembers, "Active Borrowers", sinceApril.activeMembers, "Arrear Member Count", sinceApril.arrearMemberCount],
      ["Outstanding Balance", truncateReportAmount(currentDay.outstandingBalance), "Cumulative Arrear", truncateReportAmount(sinceApril.cumulativeArrear), "", ""],
      ["", "", "", "", "", ""],
      ["Particulars", "Since April", cdHeader, "", "", ""],
      ["Opening Members", sinceApril.openingMembers, currentDay.openingMembers, "", "", ""],
      ["New Members", sinceApril.newMembers, currentDay.newMembers, "", "", ""],
      ["Rejected Members", sinceApril.rejectedMembers, currentDay.rejectedMembers, "", "", ""],
      ["Closing Members", sinceApril.closingMembers, currentDay.closingMembers, "", "", ""],
      ["Waiting Borrowers", sinceApril.waitingBorrowers, currentDay.waitingBorrowers, "", "", ""],
      ["Active Members", sinceApril.activeMembers, currentDay.activeMembers, "", "", ""],
      ["Loan Disbursement (₹)", truncateReportAmount(sinceApril.loanDisbursement), truncateReportAmount(currentDay.loanDisbursement), "", "", ""],
      ["Loan Disbursement Member Count", sinceApril.loanDisbursementMemberCount, "—", "", "", ""],
      ["Outstanding Balance (₹)", "—", truncateReportAmount(currentDay.outstandingBalance), "", "", ""],
      ["Demand Principal (₹)", "—", truncateReportAmount(currentDay.demandPrincipal), "", "", ""],
      ["Demand Interest (₹)", "—", truncateReportAmount(currentDay.demandInterest), "", "", ""],
      ["Demand Total (₹)", "—", truncateReportAmount(currentDay.demandTotal), "", "", ""],
      ["Collected Principal (₹)", "—", truncateReportAmount(currentDay.collectionPrincipal), "", "", ""],
      ["Collected Interest (₹)", "—", truncateReportAmount(currentDay.collectionInterest), "", "", ""],
      ["Total Collection (₹)", "—", truncateReportAmount(currentDay.collectionTotal), "", "", ""],
      ["Cumulative Arrear (₹)", truncateReportAmount(sinceApril.cumulativeArrear), "—", "", "", ""],
      ["Arrear Member Count", sinceApril.arrearMemberCount, "—", "", "", ""],
      ["Arrear Principal (₹)", "—", truncateReportAmount(currentDay.arrearPrincipal), "", "", ""],
      ["Arrear Total (₹)", "—", truncateReportAmount(currentDay.arrearTotal), "", "", ""],
      ["PAR %", sinceApril.parPercent, "—", "", "", ""],
      ["Recovery Rate %", "—", currentDay.recoveryRate, "", "", ""],
      ["Arrear Collection (₹)", "—", truncateReportAmount(currentDay.arrearCollection), "", "", ""],
      ["Advance Collection (₹)", "—", truncateReportAmount(currentDay.advanceCollection), "", "", ""],
    ];
    return { headers, rows };
  };

  const handleExportCSV = () => {
    if (!data) return;
    const { branchInfo, reportMeta } = data;
    const { headers, rows } = buildBranchProfileExportRows();
    exportToCSV(`Branch_Profile_${branchInfo.branchName}_${reportMeta.branchProfileDate}`, "BRANCH PROFILE", headers, rows);
    toast({ title: "CSV exported" });
  };

  // Word-only presentation: same rows as Excel/CSV above. This is a freeform label/value
  // profile sheet (not a uniform record grid), so no grouped headers and no distinct
  // totals row — just professional header/zebra/alignment/width styling.
  const wordOptions: WordExportOptions = {
    columnAlignments: ["left", "right", "left", "right", "left", "right"],
    columnWidthWeights: [10, 8, 10, 8, 10, 8],
  };

  const handleExportWord = async () => {
    if (!data) return;
    const { branchInfo, reportMeta } = data;
    const { headers, rows } = buildBranchProfileExportRows();
    await exportToWord(`Branch_Profile_${branchInfo.branchName}_${reportMeta.branchProfileDate}`, "BRANCH PROFILE", headers, rows, wordOptions);
    toast({ title: "Word exported" });
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const { branchInfo, reportMeta, sinceApril, currentDay } = data ?? {};
  const cdHeader = reportMeta
    ? `On ${reportMeta.branchProfileDate} (${reportMeta.reportDayName})`
    : "Current Day";

  return (
    <div className="space-y-5">
      {/* Filter Card */}
      <Card className="border border-primary/20 dark:border-sidebar-accent shadow-sm rounded-2xl dark:bg-brand-green-darker/60">
        <CardHeader className="pb-3 pt-5 px-6">
          <CardTitle className="text-sm font-bold text-sidebar-accent dark:text-white flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            Branch Profile Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-5">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            {canSelectBranch && (
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-sidebar-accent dark:text-slate-300 mb-1.5">
                  Branch <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => { setSelectedBranch(e.target.value); setData(null); }}
                  disabled={isBranchLoading}
                  className="w-full h-10 px-3 rounded-xl border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sm text-foreground dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                >
                  <option value="">
                    {isBranchLoading ? "Loading..." : "Select Branch"}
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-semibold text-sidebar-accent dark:text-slate-300 mb-1.5">
                Report Date
              </label>
              <DateInput
                value={reportDate}
                onChange={(e) => { setReportDate(e.target.value); setData(null); }}
                className="w-full h-10 px-3 rounded-xl border border-primary/30 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-sm text-foreground dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={isLoading || (canSelectBranch && !selectedBranch)}
              className="h-10 px-6 bg-primary hover:bg-sidebar-accent text-white font-bold rounded-xl shadow-sm transition-all active:scale-95 whitespace-nowrap"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report */}
      {data && branchInfo && reportMeta && sinceApril && currentDay && (
        <div ref={printRef} className="space-y-5 print:space-y-3">
          {/* Export buttons */}
          <div className="flex items-center justify-end gap-2 print:hidden">
            <Button onClick={() => handlePrint()} className="h-9 px-4 bg-primary hover:bg-sidebar-accent text-white font-bold rounded-xl text-sm">
              <Printer className="h-4 w-4 mr-1.5" /> Print
            </Button>
            <ExportDropdown
              onExportPDF={handlePdfExport}
              onExportExcel={handleExportExcel}
              onExportCSV={handleExportCSV}
              canExport={canExportReport('branch-profile')}
              onExportWord={handleExportWord}
              reportSlug={getReportExportMode('branch-profile') === 'REQUEST_QUEUE' ? 'branch-profile' : undefined}
              exportParams={{
                fromDate: submittedReportDate,
                toDate: null,
                branchIds: canSelectBranch && selectedBranch ? [selectedBranch] : 'ALL',
                filters: null,
              }}
              className="h-9 px-4 border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-400/10 font-bold rounded-xl text-sm"
            />
          </div>

          {/* Branch Basic Info Card */}
          <Card className="border border-primary/20 dark:border-sidebar-accent shadow-md rounded-2xl overflow-hidden dark:bg-brand-green-darker/60 print:rounded-none print:shadow-none">
            <div className="h-1.5 bg-primary" />
            <CardContent className="py-5 px-6">
              {/* Header */}
              <ReportHeader title="Branch Profile" />
              <div className="flex justify-end mb-4">
                <div className="text-right space-y-0.5">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Profile Date</p>
                  <p className="text-sm font-bold text-foreground dark:text-white">{reportMeta.branchProfileDate}</p>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mt-1">Branch Start Date</p>
                  <p className="text-sm font-bold text-foreground dark:text-white">{branchInfo.branchStartDate}</p>
                </div>
              </div>

              {/* Hierarchy + counts */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { icon: <MapPin className="w-3 h-3" />, label: "Region", value: branchInfo.regionName },
                  { label: "Division", value: branchInfo.divisionName },
                  { label: "Area", value: branchInfo.areaName },
                  { label: "Branch ID", value: branchInfo.branchId },
                  { label: "Branch Name", value: branchInfo.branchName },
                  { label: "Start Date", value: branchInfo.branchStartDate },
                ].map((item, i) => (
                  <div key={i} className="bg-green-50 dark:bg-sidebar-accent/30 rounded-xl p-2.5">
                    <p className="text-xs font-semibold text-primary dark:text-primary uppercase tracking-wide flex items-center gap-1">
                      {item.icon} {item.label}
                    </p>
                    <p className="text-sm font-bold text-foreground dark:text-white mt-0.5 truncate">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 mt-3">
                {[
                  { label: "No. of Centers", value: branchInfo.noOfCenters },
                  { label: "No. of Groups", value: branchInfo.noOfGroups },
                  { label: "No. of FDOs", value: branchInfo.noOfFdo },
                ].map((item, i) => (
                  <div key={i} className="bg-primary dark:bg-sidebar-accent rounded-xl p-2.5 text-white">
                    <p className="text-xs font-semibold opacity-80 uppercase tracking-wide">{item.label}</p>
                    <p className="text-lg font-bold mt-0.5">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
                {[
                  { label: "No. of Members", value: fmtNum(sinceApril.closingMembers) },
                  { label: "Active Borrowers", value: fmtNum(sinceApril.activeMembers) },
                  { label: "Arrear Member Count", value: fmtNum(sinceApril.arrearMemberCount) },
                  { label: "Outstanding Balance", value: fmtAmt(currentDay.outstandingBalance) },
                  { label: "Cumulative Arrear", value: fmtAmt(sinceApril.cumulativeArrear) },
                ].map((item, i) => (
                  <div key={i} className="bg-primary dark:bg-sidebar-accent rounded-xl p-2.5 text-white">
                    <p className="text-xs font-semibold opacity-80 uppercase tracking-wide">{item.label}</p>
                    <p className="text-sm font-bold mt-0.5">{item.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Side-by-side: Since April + Current Day */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {/* LEFT — Since April */}
            <Card className="border border-primary/20 dark:border-sidebar-accent shadow-md rounded-2xl overflow-hidden dark:bg-brand-green-darker/60 print:rounded-none print:shadow-none">
              <CardHeader className="py-3 px-4 bg-primary dark:bg-sidebar-accent">
                <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Since April
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  <SectionDivider label="Members" />
                  <InfoRow label="Opening Members" value={fmtNum(sinceApril.openingMembers)} />
                  <InfoRow label="New Members" value={fmtNum(sinceApril.newMembers)} accent="green" />
                  <InfoRow label="Rejected Members" value={fmtNum(sinceApril.rejectedMembers)} accent="red" />
                  <InfoRow label="Closing Members" value={fmtNum(sinceApril.closingMembers)} />
                  <InfoRow label="Waiting Borrowers" value={fmtNum(sinceApril.waitingBorrowers)} accent="amber" />
                  <InfoRow label="Active Members" value={fmtNum(sinceApril.activeMembers)} accent="green" />

                  <SectionDivider label="Loan Disbursement" />
                  <InfoRow label="Loan Disbursement" value={fmtAmt(sinceApril.loanDisbursement)} accent="green" />
                  <InfoRow label="Disbursement Member Count" value={fmtNum(sinceApril.loanDisbursementMemberCount)} />

                  <SectionDivider label="Arrear" />
                  <InfoRow label="Cumulative Arrear" value={fmtAmt(sinceApril.cumulativeArrear)} accent="red" />
                  <InfoRow label="Arrear Member Count" value={fmtNum(sinceApril.arrearMemberCount)} accent="red" />
                  <InfoRow label="PAR %" value={fmtPct(sinceApril.parPercent)} accent="red" />
                </ul>
              </CardContent>
            </Card>

            {/* RIGHT — Current Day */}
            <Card className="border border-primary/20 dark:border-sidebar-accent shadow-md rounded-2xl overflow-hidden dark:bg-brand-green-darker/60 print:rounded-none print:shadow-none">
              <CardHeader className="py-3 px-4 bg-sidebar-accent dark:bg-brand-green-darker border-b border-primary/20 dark:border-sidebar-accent">
                <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  {cdHeader}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  <SectionDivider label="Members" />
                  <InfoRow label="Opening Members" value={fmtNum(currentDay.openingMembers)} />
                  <InfoRow label="New Members" value={fmtNum(currentDay.newMembers)} accent="green" />
                  <InfoRow label="Rejected Members" value={fmtNum(currentDay.rejectedMembers)} accent="red" />
                  <InfoRow label="Closing Members" value={fmtNum(currentDay.closingMembers)} />
                  <InfoRow label="Waiting Borrowers" value={fmtNum(currentDay.waitingBorrowers)} accent="amber" />
                  <InfoRow label="Active Members" value={fmtNum(currentDay.activeMembers)} accent="green" />

                  <SectionDivider label="Loans" />
                  <InfoRow label="Loan Disbursement" value={fmtAmt(currentDay.loanDisbursement)} accent="green" />
                  <InfoRow label="Outstanding Balance" value={fmtAmt(currentDay.outstandingBalance)} />

                  <SectionDivider label="Demand" />
                  <InfoRow label="Demand Principal" value={fmtAmt(currentDay.demandPrincipal)} />
                  <InfoRow label="Demand Interest" value={fmtAmt(currentDay.demandInterest)} />
                  <InfoRow label="Demand Total" value={fmtAmt(currentDay.demandTotal)} />

                  <SectionDivider label="Collection" />
                  <InfoRow label="Collected Principal" value={fmtAmt(currentDay.collectionPrincipal)} accent="green" />
                  <InfoRow label="Collected Interest" value={fmtAmt(currentDay.collectionInterest)} accent="green" />
                  <InfoRow label="Total Collection" value={fmtAmt(currentDay.collectionTotal)} accent="green" />

                  <SectionDivider label="Arrear" />
                  <InfoRow label="Arrear Principal" value={fmtAmt(currentDay.arrearPrincipal)} accent="red" />
                  <InfoRow label="Arrear Total" value={fmtAmt(currentDay.arrearTotal)} accent="red" />

                  <SectionDivider label="Performance" />
                  <InfoRow label="Recovery Rate" value={fmtPct(currentDay.recoveryRate)} accent={currentDay.recoveryRate >= 95 ? "green" : currentDay.recoveryRate >= 70 ? "amber" : "red"} />
                  <InfoRow label="Arrear Collection" value={fmtAmt(currentDay.arrearCollection)} />
                  <InfoRow label="Advance Collection" value={fmtAmt(currentDay.advanceCollection)} />
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!data && !isLoading && (
        <div className="flex flex-col items-center justify-center min-h-[240px] rounded-2xl border border-dashed border-primary/30 dark:border-sidebar-accent bg-green-50/20 dark:bg-brand-green-darker/30">
          <Building2 className="h-11 w-11 text-primary/30 mb-3" />
          <p className="text-sm font-semibold text-sidebar-accent/60 dark:text-slate-500">
            {canSelectBranch
              ? "Select a branch and date, then click Generate Report"
              : "Select a report date and click Generate Report"}
          </p>
        </div>
      )}
    </div>
  );
}
