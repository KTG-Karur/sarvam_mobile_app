"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, FileType, FileOutput, Printer, Filter, FileText, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx-js-style";
import { useReactToPrint } from "react-to-print";
import { cn } from "@/lib/utils";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LocalBranchFilter } from "@/components/branch/LocalBranchFilter";
import { branchStorage } from "@/app/lib/branch-storage";
import { usePermission } from "@/app/hooks/usePermission";
import {
  getDemandSheetData,
  getDemandSheetClientWiseTableData,
  getDemandSheetClientWiseCenterReport,
  getFDOs,
  getBranchMeta,
  type DemandSheetData,
  type DemandClientTableRow,
  type DemandSheetMeta,
  type FDOOption,
} from "@/app/lib/actions/demand";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ClientWiseDemandReportDialog } from "@/components/reports/ClientWiseDemandReportDialog";
import { DemandSheetAllCentersDialog } from "@/components/reports/DemandSheetAllCentersDialog";
import { DemandSheetCenterwiseTable } from "@/components/reports/DemandSheetCenterwiseTable";
import { DemandSheetClientwiseTable } from "@/components/reports/DemandSheetClientwiseTable";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { drawDemandSheetDenominationBlock, buildDemandSheetDenominationRows } from "@/app/lib/reports/demand-sheet-denomination";
import { drawDemandSheetCenterwisePage } from "@/app/lib/reports/demand-sheet-centerwise-pdf";
import { buildClientWiseCenterReportPdf, buildClientWiseAllCentersPdf } from "@/app/lib/reports/client-wise-center-report";
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { exportToCSV, exportToWord, type WordExportOptions } from "@/app/lib/report-export-utils";
import { formatReportAmount } from "@/app/lib/utils/format-amount";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";
import { DateInput } from '@/components/ui/date-input';

// Demand types
const DEMAND_TYPES = [
  { id: "centerwise", name: "CENTERWISE" },
  { id: "clientwise", name: "CLIENTWISE" },
];

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

// Format time
const formatTime = (timeString: string) => {
  if (!timeString) return "";
  const time = timeString.replace("Z", "");
  return time.substring(0, 5);
};

export default function DemandSheetPage() {
  const { toast } = useToast();
  const { hasRole, canExportReport, getReportExportMode } = usePermission();
  const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
  const isFDO = hasRole("fdo");
  const [demandDate, setDemandDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [selectedFDO, setSelectedFDO] = useState<string>("");
  /** Page-local report filter only — deliberately NOT the session-wide active
   *  branch. Changing it must never change the user's logged-in branch context
   *  elsewhere in the app (see LocalBranchFilter). */
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [demandType, setDemandType] = useState<"centerwise" | "clientwise">(
    "clientwise"
  );
  // Submitted (applied) snapshot — frozen until the next Submit click. demandDate,
  // selectedFDO, selectedBranchId, and demandType are all read TOGETHER by every
  // fetch/re-fetch call site below (the main report fetch, the Clientwise PDF's
  // per-center re-fetch, the "Detailed report" and "Download All Centers" dialogs'
  // own internal fetches, and the Request-Queue exportParams), so all four are
  // snapshotted as one atomic unit — snapshotting demandDate alone would still let
  // an edited-but-unsubmitted FDO/branch/type leak into a later re-fetch.
  // clientViewCenterFilter is deliberately NOT part of this snapshot — it's a
  // client-side view filter over already-fetched rows that's meant to apply
  // immediately, not a "must click Submit" input.
  const [submittedDemandDate, setSubmittedDemandDate] = useState(demandDate);
  const [submittedSelectedFDO, setSubmittedSelectedFDO] = useState(selectedFDO);
  const [submittedSelectedBranchId, setSubmittedSelectedBranchId] = useState(selectedBranchId);
  const [submittedDemandType, setSubmittedDemandType] = useState(demandType);
  const [isLoading, setIsLoading] = useState(false);
  const [demandData, setDemandData] = useState<DemandSheetData[]>([]);
  const [clientRows, setClientRows] = useState<DemandClientTableRow[]>([]);
  const [fdoList, setFdoList] = useState<FDOOption[]>([]);
  const [branchMeta, setBranchMeta] = useState<DemandSheetMeta>({
    branchCode: "",
    branchName: "",
  });
  const [dateError, setDateError] = useState<string | null>(null);
  const [clientReportOpen, setClientReportOpen] = useState(false);
  const [selectedClientReportCenterId, setSelectedClientReportCenterId] =
    useState<string>("");
  /** Client view: show clients for one center or all centers (from loaded sheet only). */
  const [clientViewCenterFilter, setClientViewCenterFilter] =
    useState<string>("all");
  /** "Download All Centers" — direct-download preview modal (never REQUEST_QUEUE). */
  const [allCentersPreviewOpen, setAllCentersPreviewOpen] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const selectedBranchIdRef = useRef(selectedBranchId);
  selectedBranchIdRef.current = selectedBranchId;

  const centerOptionsForClientView = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of clientRows) {
      if (!byId.has(row.centerId)) byId.set(row.centerId, row.centerName);
    }
    return [...byId.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" })
    );
  }, [clientRows]);

  const filteredClientRows = useMemo(() => {
    if (clientViewCenterFilter === "all") return clientRows;
    return clientRows.filter((r) => r.centerId === clientViewCenterFilter);
  }, [clientRows, clientViewCenterFilter]);

  const handleClientViewCenterFilterChange = useCallback((value: string) => {
    setClientViewCenterFilter(value);
  }, []);

  const fetchInitialData = useCallback(async (branchId?: string) => {
    try {
      const [fdoData, branchData] = await Promise.all([
        getFDOs(branchId || undefined),
        getBranchMeta(branchId || undefined),
      ]);

      setFdoList(fdoData);
      setBranchMeta(branchData);

      // FDO users only ever see their own name; default it directly.
      // Other roles default to "all" FDOs.
      setSelectedFDO(isFDO && fdoData.length > 0 ? fdoData[0].id : "all");
    } catch (error) {
      console.error("Failed to fetch initial data", error);
      toast({
        title: "Error",
        description: "Failed to load initial data.",
        variant: "destructive",
      });
    }
  }, [toast, isFDO]);

  // Admin/Area Manager picked a different branch to VIEW in this report — this is a
  // page-local filter (see selectedBranchId), not a switch of the logged-in branch.
  // Stale report data from the previous branch must not linger, and FDO/branch meta
  // need reloading for the newly selected one.
  const handleBranchFilterChange = useCallback((branchId: string) => {
    setSelectedBranchId(branchId);
    setDemandData([]);
    setClientRows([]);
    setClientViewCenterFilter("all");
    void fetchInitialData(branchId);
  }, [fetchInitialData]);

  // Initial load: Fetch FDOs, branch meta. Defaults the filter to the user's current
  // session branch purely as a starting point — after this, it's independent. Also
  // re-runs if fetchInitialData's identity changes (e.g. isFDO resolving from
  // usePermission after mount), reusing whatever branch is currently selected.
  useEffect(() => {
    if (!selectedBranchIdRef.current) {
      const initialBranchId = branchStorage.getActiveBranch()?.id ?? "";
      setSelectedBranchId(initialBranchId);
    }
    fetchInitialData(selectedBranchIdRef.current || undefined);

    // Set default demand date to today
    const today = new Date();
    setDemandDate(format(today, "yyyy-MM-dd"));
  }, [fetchInitialData]);

  const handleGenerateReport = async () => {
    if (!selectedFDO) {
      toast({
        title: "Validation Error",
        description: "Please select an FDO.",
        variant: "destructive",
      });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Rolling 7-day-ahead window (e.g. today Tue -> visible through next Tue),
    // not a fixed Mon-Sun calendar week.
    const maxFutureDate = new Date(today);
    maxFutureDate.setDate(maxFutureDate.getDate() + 7);
    const selectedDate = new Date(demandDate);
    selectedDate.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      // Past dates are allowed
      // Continue
    } else if (selectedDate > maxFutureDate) {
      setDateError("You can only view demand sheets up to 7 days ahead");
      toast({
        title: "Date Not Allowed",
        description: "You can only view demand sheets up to 7 days ahead",
        variant: "destructive",
      });
      return;
    } else {
      setDateError(null);
    }

    // Freeze the current draft filters as the "submitted" snapshot — every export/re-fetch
    // path below (and the "Detailed report" / "Download All Centers" dialogs) reads this
    // snapshot, not the live draft state, so further edits to the filters have no effect
    // until Submit is clicked again.
    setSubmittedDemandDate(demandDate);
    setSubmittedSelectedFDO(selectedFDO);
    setSubmittedSelectedBranchId(selectedBranchId);
    setSubmittedDemandType(demandType);

    setIsLoading(true);
    try {
      if (demandType === "centerwise") {
        const data = await getDemandSheetData(
          demandDate,
          selectedFDO,
          "centerwise",
          selectedBranchId || undefined
        );
        setDemandData(data);
        setClientRows([]);

        if (data.length === 0) {
          toast({
            title: "No Data",
            description:
              "No centers found for the selected criteria (check Meeting Day or collections).",
            variant: "default",
          });
        }
      } else {
        const rows = await getDemandSheetClientWiseTableData(
          demandDate,
          selectedFDO,
          selectedBranchId || undefined
        );
        setClientRows(rows);
        setClientViewCenterFilter("all");
        setDemandData([]);

        if (rows.length === 0) {
          toast({
            title: "No Data",
            description:
              "No clients with dues or collections on this date for the selected criteria.",
            variant: "default",
          });
        }
      }
    } catch (error) {
      console.error("Error generating report", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate demand sheet.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Derived variables for calculations and display
  const totalClients = demandData.reduce((sum, e) => sum + e.noOfClients, 0);
  const totalWB = demandData.reduce((sum, e) => sum + e.wb, 0);
  const totalAPP = demandData.reduce((sum, e) => sum + e.app, 0);
  const totalLoanOS = demandData.reduce((sum, e) => sum + e.loanOS, 0);
  const totalArrear = demandData.reduce((sum, e) => sum + e.arrear, 0);
  const totalDemand = demandData.reduce((sum, e) => sum + e.demand, 0);
  const totalCollected = demandData.reduce((sum, e) => sum + e.collected, 0);

  // Derived from the SUBMITTED snapshot (not live draft state) — these feed the displayed
  // report header, export filenames/labels, and the child dialogs, all of which must keep
  // showing the last-submitted report until Submit is clicked again.
  const fdoName =
    submittedSelectedFDO === "all"
      ? "ALL"
      : fdoList.find((f) => f.id === submittedSelectedFDO)?.name || "-";
  const parsedDemandDate = new Date(`${submittedDemandDate}T00:00:00`);
  const isDemandDateValid = submittedDemandDate.length > 0 && !Number.isNaN(parsedDemandDate.getTime());
  const dayName = isDemandDateValid ? format(parsedDemandDate, "EEEE").toUpperCase() : "-";
  const formattedDate = isDemandDateValid ? format(parsedDemandDate, "dd/MM/yyyy") : "-";
  const branchLabel = branchMeta.branchCode
    ? `${branchMeta.branchCode} - ${branchMeta.branchName.toUpperCase()}`
    : "-";

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Demand_Sheet_${fdoName}_${submittedDemandDate}`,
  });

  const canPrintExport =
    submittedDemandType === "centerwise"
      ? demandData.length > 0
      : filteredClientRows.length > 0;

  // "Download All Centers" is only ever shown when the currently loaded table is
  // already unfiltered to a single center — Centerwise has no center drill-down at
  // all (always every center), Clientwise only when the Center filter is "all".
  // Gated on submittedDemandType (not live demandType) so this stays in sync with
  // whichever report section is actually being displayed (see the two render-gate
  // conditions below).
  const showAllCentersButtonCenterwise = submittedDemandType === "centerwise" && demandData.length > 0;
  const showAllCentersButtonClientwise =
    submittedDemandType === "clientwise" && clientViewCenterFilter === "all" && clientRows.length > 0;

  // includeDenomination: only ever true when invoked from the "Download All
  // Centers" preview — the main toolbar's ExportDropdown always calls this with
  // no arguments, so its output is byte-for-byte unchanged.
  const handleExportPdf = async (includeDenomination: boolean = false) => {
    if (!canPrintExport) return;

    if (submittedDemandType === "clientwise") {
      // Reuses the same rendering already proven correct by the "Detailed
      // report" dialog / "Download All Centers" / Request Queue — see
      // client-wise-center-report.ts. Replaces the old inline flat 16-column
      // builder that used to live here, which produced a different-looking
      // PDF than those three paths.
      // Uses the SUBMITTED snapshot, not live draft state — this re-fetches fresh
      // per-center data from the server (unlike the Excel/CSV/Word exports below,
      // which reuse already-fetched filteredClientRows), so an edited-but-unsubmitted
      // date/FDO/branch must not leak into this query.
      try {
        if (clientViewCenterFilter !== "all") {
          const report = await getDemandSheetClientWiseCenterReport(
            submittedDemandDate,
            submittedSelectedFDO,
            clientViewCenterFilter,
            submittedSelectedBranchId || undefined
          );
          await buildClientWiseCenterReportPdf(report, submittedDemandDate, loanAdvanceEnabled);
        } else {
          const reports = await Promise.all(
            centerOptionsForClientView.map(([centerId]) =>
              getDemandSheetClientWiseCenterReport(submittedDemandDate, submittedSelectedFDO, centerId, submittedSelectedBranchId || undefined)
            )
          );
          await buildClientWiseAllCentersPdf(
            reports,
            submittedDemandDate,
            `Demand_ClientWise_${fdoName}_${submittedDemandDate}.pdf`,
            loanAdvanceEnabled
          );
        }
      } catch (error) {
        console.error("Export Error", error);
        toast({
          title: "Export Failed",
          description: error instanceof Error ? error.message : "There was an error generating the PDF.",
          variant: "destructive",
        });
      }
      return;
    }

    if (demandData.length === 0) return;

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    const reportFont = await ensureReportFont(doc);

    try {
      await drawDemandSheetCenterwisePage(
        doc,
        demandData,
        { branchLabel, fdoName, dayName, formattedDate },
        reportFont,
        undefined,
        loanAdvanceEnabled
      );

      if (includeDenomination) {
        const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;
        await drawDemandSheetDenominationBlock(doc, finalY, reportFont);
      }

      doc.save(`Demand_Sheet_${fdoName}_${submittedDemandDate}.pdf`);
    } catch (error) {
      console.error("Export Error", error);
      toast({
        title: "Export Failed",
        description: "There was an error generating the PDF.",
        variant: "destructive",
      });
    }
  };

  // ── Excel / CSV / Word export — mirrors the same field mapping used by
  // handleExportPdf above for BOTH demand views (kept separate so
  // handleExportPdf is left untouched) ──────────────────────────────────────

  // includeDenomination: only ever true when invoked from the "Download All
  // Centers" preview's Excel/CSV export (handleExportWord never passes this —
  // see its own comment for why Word can't cleanly support an appended section).
  const buildDemandSheetExportRows = (includeDenomination: boolean = false): { headers: string[]; rows: (string | number)[][] } => {
    if (submittedDemandType === "clientwise") {
      const headers = [
        "S.No", "Member ID", "Member Name", "Member Phone", "Branch Name", "Center Name",
        "Group Name", "Product Name", "Disb Date",
        "Loan Amount Principal", "Loan Amount Interest", "Loan Amount Total",
        "Loan OS Principal", "Loan OS Interest", "Loan OS Total",
        "Cur Due", "Coll Dues", "Demand Date",
        "Arrear Principal", "Arrear Interest", "Arrear Total",
        "Demand Principal", "Demand Interest", "Demand Total",
        ...(loanAdvanceEnabled ? ["Loan Advance OS", "Loan Advance Due"] : []),
        "Total Demand Amount", "Officer Name", "Current Demand Coll Amount",
        "Collection Date", "Collection Status", "MeetUp Time", "Funder Name",
      ];
      const rows: (string | number)[][] = filteredClientRows.map((r, index) => [
        index + 1, r.clientId, r.clientName, r.memberPhone || "-", r.branchName, r.centerName,
        r.groupName, r.productName, r.approvedLevel2At || "-",
        formatCurrency(r.loanAmount), formatCurrency(r.loanAmountInterest), formatCurrency(r.loanAmountTotal),
        formatCurrency(r.loanOSPrincipal), formatCurrency(r.loanOSInterest), formatCurrency(r.loanOS),
        r.curDue, r.collDue, r.demandDate,
        formatCurrency(r.arrearPrincipal), formatCurrency(r.arrearInterest), formatCurrency(r.arrear),
        formatCurrency(r.demandPrincipal), formatCurrency(r.demandInterest), formatCurrency(r.demand),
        ...(loanAdvanceEnabled ? [formatCurrency(r.loanAdvanceOS), formatCurrency(r.loanAdvanceDemand)] : []),
        formatCurrency(r.totalDemandAmount), r.officerName, formatCurrency(r.currentDemandCollAmount),
        r.collectionDate || "-", r.collectionStatus, formatTime(r.meetingTime), r.funderName,
      ]);
      if (includeDenomination) rows.push(...buildDemandSheetDenominationRows(headers.length));
      return { headers, rows };
    }

    const headers = [
      "Sl No", "Center Name", "Phone", "Clients", "WB", "Due No", "Time",
      "Loan OS", "Arrear", "Demand",
      ...(loanAdvanceEnabled ? ["Loan Advance OS", "Loan.AD Demand"] : []),
      "Collected",
    ];
    const rows: (string | number)[][] = demandData.map((entry, index) => [
      index + 1, entry.centerName, entry.phone || "-", entry.noOfClients, entry.wb,
      entry.dueNo, formatTime(entry.meetingTime), formatCurrency(entry.loanOS),
      formatCurrency(entry.arrear), formatCurrency(entry.demand),
      ...(loanAdvanceEnabled ? [formatCurrency(entry.loanAdvanceOS), formatCurrency(entry.savingsDemand)] : []),
      formatCurrency(entry.collected),
    ]);
    rows.push([
      "", "GRAND TOTAL", "", totalClients, totalWB,
      demandData.reduce((sum, e) => sum + e.dueNo, 0), "",
      formatCurrency(totalLoanOS), formatCurrency(totalArrear), formatCurrency(totalDemand),
      ...(loanAdvanceEnabled ? [
        formatCurrency(demandData.reduce((s, e) => s + e.loanAdvanceOS, 0)),
        formatCurrency(demandData.reduce((s, e) => s + e.savingsDemand, 0)),
      ] : []),
      formatCurrency(totalCollected),
    ]);
    if (includeDenomination) rows.push(...buildDemandSheetDenominationRows(headers.length));
    return { headers, rows };
  };

  // ── Word-only presentation layer for the Clientwise report: grouped 2-row
  // headers, report-info/summary blocks, zebra striping, and a distinct grand
  // total row — mirrors the on-screen table's own column grouping (lines
  // ~1144-1166 below) and reuses the same field values as buildDemandSheetExportRows
  // / the clientwise PDF's `pdfTotals` reduce. Does not affect Excel/CSV/PDF. ──────
  const buildDemandSheetWordOptions = (): WordExportOptions => {
    const totals = filteredClientRows.reduce(
      (acc, r) => ({
        loanAmount: acc.loanAmount + r.loanAmount,
        loanAmountInterest: acc.loanAmountInterest + r.loanAmountInterest,
        loanAmountTotal: acc.loanAmountTotal + r.loanAmountTotal,
        loanOSPrincipal: acc.loanOSPrincipal + r.loanOSPrincipal,
        loanOSInterest: acc.loanOSInterest + r.loanOSInterest,
        loanOS: acc.loanOS + r.loanOS,
        curDue: acc.curDue + r.curDue,
        collDue: acc.collDue + r.collDue,
        arrearPrincipal: acc.arrearPrincipal + r.arrearPrincipal,
        arrearInterest: acc.arrearInterest + r.arrearInterest,
        arrear: acc.arrear + r.arrear,
        demandPrincipal: acc.demandPrincipal + r.demandPrincipal,
        demandInterest: acc.demandInterest + r.demandInterest,
        demand: acc.demand + r.demand,
        loanAdvanceOS: acc.loanAdvanceOS + (loanAdvanceEnabled ? r.loanAdvanceOS : 0),
        loanAdvanceDemand: acc.loanAdvanceDemand + (loanAdvanceEnabled ? r.loanAdvanceDemand : 0),
        totalDemandAmount: acc.totalDemandAmount + r.totalDemandAmount,
        currentDemandCollAmount: acc.currentDemandCollAmount + r.currentDemandCollAmount,
      }),
      {
        loanAmount: 0, loanAmountInterest: 0, loanAmountTotal: 0,
        loanOSPrincipal: 0, loanOSInterest: 0, loanOS: 0,
        curDue: 0, collDue: 0,
        arrearPrincipal: 0, arrearInterest: 0, arrear: 0,
        demandPrincipal: 0, demandInterest: 0, demand: 0,
        loanAdvanceOS: 0, loanAdvanceDemand: 0,
        totalDemandAmount: 0, currentDemandCollAmount: 0,
      }
    );

    const centerName =
      clientViewCenterFilter === "all"
        ? "All Centers"
        : centerOptionsForClientView.find(([id]) => id === clientViewCenterFilter)?.[1] || "-";

    const totalsRow: (string | number)[] = [
      "", "", "GRAND TOTAL", "", "", "", "",
      "", "",
      formatCurrency(totals.loanAmount), formatCurrency(totals.loanAmountInterest), formatCurrency(totals.loanAmountTotal),
      formatCurrency(totals.loanOSPrincipal), formatCurrency(totals.loanOSInterest), formatCurrency(totals.loanOS),
      totals.curDue, totals.collDue, "",
      formatCurrency(totals.arrearPrincipal), formatCurrency(totals.arrearInterest), formatCurrency(totals.arrear),
      formatCurrency(totals.demandPrincipal), formatCurrency(totals.demandInterest), formatCurrency(totals.demand),
      ...(loanAdvanceEnabled ? [formatCurrency(totals.loanAdvanceOS), formatCurrency(totals.loanAdvanceDemand)] : []),
      formatCurrency(totals.totalDemandAmount), "", formatCurrency(totals.currentDemandCollAmount),
      "", "", "", "",
    ];

    return {
      reportInfo: [
        { label: "Branch", value: branchLabel },
        { label: "Center", value: centerName },
        { label: "FDO", value: fdoName },
        { label: "Meeting Day", value: dayName },
        { label: "Report Date", value: formattedDate },
        { label: "Generated", value: format(new Date(), "dd/MM/yyyy hh:mm a") },
        { label: "Total Clients", value: String(filteredClientRows.length) },
      ],
      summary: [
        { label: "Total Clients", value: String(filteredClientRows.length) },
        { label: "Total Demand", value: formatCurrency(totals.totalDemandAmount) },
        { label: "Total Collected", value: formatCurrency(totals.currentDemandCollAmount) },
        { label: "Outstanding", value: formatCurrency(totals.loanOS) },
      ],
      groupHeaders: [
        { label: "CLIENT INFORMATION", span: 7 },
        { label: "LOAN INFORMATION", span: 2 },
        { label: "LOAN AMOUNT", span: 3 },
        { label: "LOAN OUTSTANDING", span: 3 },
        { label: "DUES", span: 2 },
        { label: "Demand Date", span: 1 },
        { label: "ARREAR DEMAND", span: 3 },
        { label: "CURRENT DEMAND", span: 3 },
        ...(loanAdvanceEnabled ? [{ label: "LOAN ADVANCE", span: 2 }] : []),
        { label: "Total Demand Amount", span: 1 },
        { label: "Officer Name", span: 1 },
        { label: "COLLECTION", span: 5 },
      ],
      subHeaders: [
        "S.No", "Member ID", "Member Name", "Phone", "Branch", "Center", "Group",
        "Product", "Disb. Date",
        "Principal", "Interest", "Total",
        "Principal", "Interest", "Total",
        "Current", "Collection",
        "Principal", "Interest", "Total",
        "Principal", "Interest", "Total",
        ...(loanAdvanceEnabled ? ["O/S", "Due"] : []),
        "Coll. Amount", "Coll. Date", "Status", "Meet Time", "Funder",
      ],
      columnAlignments: [
        "center", "center", "left", "center", "left", "left", "left",
        "left", "center",
        "right", "right", "right",
        "right", "right", "right",
        "right", "right",
        "center",
        "right", "right", "right",
        "right", "right", "right",
        ...(loanAdvanceEnabled ? (["right", "right"] as const) : []),
        "right", "left",
        "right",
        "center", "center", "center", "left",
      ],
      totalsRow,
      // Relative widths so names/branches/officers get real breathing room and short numeric
      // columns (S.No, Cur Due, Coll Dues) don't waste space — proportioned to fill the full
      // A3-landscape usable width instead of 33 equal-width columns.
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
      footerText: "Demand Sheet — Clientwise",
    };
  };

  // ── Word-only presentation layer for the Centerwise report: flat header (matches
  // the on-screen table, which has no column groups), zebra striping, and a distinct
  // grand total row — reuses the same aggregate values as buildDemandSheetExportRows'
  // inline GRAND TOTAL row. Does not affect Excel/CSV/PDF. ──────
  const buildDemandSheetCenterwiseWordOptions = (): WordExportOptions => {
    const totalsRow: (string | number)[] = [
      "", "GRAND TOTAL", "", totalClients, totalWB,
      demandData.reduce((sum, e) => sum + e.dueNo, 0), "",
      formatCurrency(totalLoanOS), formatCurrency(totalArrear), formatCurrency(totalDemand),
      ...(loanAdvanceEnabled ? [
        formatCurrency(demandData.reduce((s, e) => s + e.loanAdvanceOS, 0)),
        formatCurrency(demandData.reduce((s, e) => s + e.savingsDemand, 0)),
      ] : []),
      formatCurrency(totalCollected),
    ];

    return {
      reportInfo: [
        { label: "Branch", value: branchLabel },
        { label: "Meeting Day", value: dayName },
        { label: "FDO", value: fdoName },
        { label: "Report Date", value: formattedDate },
        { label: "Generated", value: format(new Date(), "dd/MM/yyyy hh:mm a") },
        { label: "Total Centers", value: String(demandData.length) },
      ],
      summary: [
        { label: "Total Centers", value: String(demandData.length) },
        { label: "Total Clients", value: String(totalClients) },
        { label: "Total Demand", value: formatCurrency(totalDemand) },
        { label: "Total Collected", value: formatCurrency(totalCollected) },
        { label: "Outstanding", value: formatCurrency(totalLoanOS) },
      ],
      columnAlignments: [
        "center", "left", "center", "right", "center",
        "center", "center", "right", "right", "right",
        ...(loanAdvanceEnabled ? (["right", "right"] as const) : []),
        "right",
      ],
      columnWidthWeights: [4, 14, 8, 6, 5, 6, 7, 8, 8, 8, ...(loanAdvanceEnabled ? [9, 9] : []), 8],
      totalsRow,
      footerText: "Demand Sheet — Centerwise",
    };
  };

  const handleExportExcel = (includeDenomination: boolean = false) => {
    if (!canPrintExport) return;
    const { headers, rows } = buildDemandSheetExportRows(includeDenomination);
    const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    const title = submittedDemandType === "clientwise" ? "Demand Sheet — Clientwise" : "Demand Sheet";
    const ws = buildReportSheet(title, excelRows);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Demand Sheet");
    const fileName = submittedDemandType === "clientwise"
      ? `Demand_ClientWise_${fdoName}_${submittedDemandDate}.xlsx`
      : `Demand_Sheet_${fdoName}_${submittedDemandDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportCSV = (includeDenomination: boolean = false) => {
    if (!canPrintExport) return;
    const { headers, rows } = buildDemandSheetExportRows(includeDenomination);
    const title = submittedDemandType === "clientwise" ? "DEMAND SHEET — CLIENTWISE" : "DEMAND SHEET";
    const fileName = submittedDemandType === "clientwise"
      ? `Demand_ClientWise_${fdoName}_${submittedDemandDate}`
      : `Demand_Sheet_${fdoName}_${submittedDemandDate}`;
    exportToCSV(fileName, title, headers, rows);
  };

  // Deliberately has no includeDenomination param/usage — the shared Word builder
  // (app/lib/reports/word/docx-core.ts, also used by the REQUEST_QUEUE Word path)
  // always renders `options.totalsRow` as the table's last row, so appending a
  // denomination section to `rows` would render it ABOVE the grand total instead
  // of below it, and there's no other hook to add content after the table.
  // Fixing that would mean touching the shared/queue Word builder, which is out of
  // scope here — the "Download All Centers" dialog simply doesn't offer a Word
  // option (see DemandSheetAllCentersDialog), so this function's behavior and the
  // main toolbar's Word export are both completely unaffected by this change.
  const handleExportWord = async () => {
    if (!canPrintExport) return;
    const { headers, rows } = buildDemandSheetExportRows();
    const title = submittedDemandType === "clientwise" ? "DEMAND SHEET — CLIENTWISE" : "DEMAND SHEET";
    const fileName = submittedDemandType === "clientwise"
      ? `Demand_ClientWise_${fdoName}_${submittedDemandDate}`
      : `Demand_Sheet_${fdoName}_${submittedDemandDate}`;
    const options = submittedDemandType === "clientwise" ? buildDemandSheetWordOptions() : buildDemandSheetCenterwiseWordOptions();
    // Centerwise's `rows` already ends with an inline GRAND TOTAL row (see buildDemandSheetExportRows) —
    // sliced off here since it's rendered as the distinct options.totalsRow instead for Word.
    const bodyRows = submittedDemandType === "clientwise" ? rows : rows.slice(0, -1);
    await exportToWord(fileName, title, headers, bodyRows, options);
  };

  return (
    <ProtectedRoute requiredPermission="DEMAND_SHEET">
      <div className="relative min-h-screen bg-background">
        <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
          {/* Header Section - Hidden on Print */}
          <div className="mb-8 print:hidden">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
                <FileSpreadsheet className="h-7 w-7 text-white" />
              </div>
              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                  Demand Sheet
                </h1>
                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                  Generate field collection sheets for FDOs
                </p>
              </div>
            </div>
          </div>

          {/* Filters Card - Hidden on Print */}
          <Card className="border shadow-md mb-6 print:hidden bg-white dark:bg-brand-green-darker">
            <CardHeader className="bg-green-50 dark:bg-sidebar-accent/50 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Report Criteria</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <ExportDropdown
                    onExportPDF={canPrintExport ? handleExportPdf : undefined}
                    onExportExcel={canPrintExport ? handleExportExcel : undefined}
                    onExportCSV={canPrintExport ? handleExportCSV : undefined}
                    onExportWord={canPrintExport ? handleExportWord : undefined}
                    reportSlug={canPrintExport && getReportExportMode('demand-sheet') === 'REQUEST_QUEUE' ? 'demand-sheet' : undefined}
                    canExport={canExportReport('demand-sheet')}
                    exportParams={{
                      fromDate: submittedDemandDate,
                      toDate: submittedDemandDate,
                      branchIds: submittedSelectedBranchId ? [submittedSelectedBranchId] : 'ALL',
                      filters: {
                        reportType: submittedDemandType,
                        ...(submittedSelectedFDO ? { fdoId: submittedSelectedFDO } : {}),
                        // Lets a queued PDF reproduce the same specific-center
                        // "Detailed report" structure the Direct Download PDF
                        // uses when one center is selected — omitted (→ "all
                        // centers") whenever the filter is "all", matching the
                        // Direct Download's own scope exactly. clientViewCenterFilter
                        // stays live (not submitted) — it's an immediate view filter
                        // over already-fetched rows, meant to match whatever the
                        // user currently has selected, not something gated by Submit.
                        ...(submittedDemandType === 'clientwise' && clientViewCenterFilter !== 'all'
                          ? { centerId: clientViewCenterFilter }
                          : {}),
                      },
                    }}
                    className="gap-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                  />
                  {showAllCentersButtonCenterwise && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAllCentersPreviewOpen(true)}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Download All Centers
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrint}
                    disabled={!canPrintExport}
                    className="gap-2"
                  >
                    <Printer className="h-4 w-4" />
                    Print Sheet
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  {/* Branch — Admin/Area Manager only. Page-local report filter,
                      not the session-wide active branch. */}
                  <LocalBranchFilter
                    value={selectedBranchId}
                    onChange={handleBranchFilterChange}
                  />

                  {/* Demand Date */}
                  <div className="space-y-2">
                    <Label
                      htmlFor="demandDate"
                      className="flex items-center gap-1"
                    >
                      Demand Date
                      <span className="text-xs text-primary font-normal leading-none">
                        (Any date)
                      </span>
                    </Label>
                    <DateInput
                      id="demandDate"
                      value={demandDate}
                      onChange={(e) => {
                        setDemandDate(e.target.value);
                        setDateError(null);
                      }}
                      max={(() => {
                        const maxFutureDate = new Date();
                        maxFutureDate.setDate(maxFutureDate.getDate() + 7);
                        return maxFutureDate.toISOString().split('T')[0];
                      })()}
                      className={cn("h-10", dateError && "border-red-500")}
                    />
                    {dateError && (
                      <p className="text-xs text-red-500 mt-1">{dateError}</p>
                    )}
                  </div>

                  {/* FDO Name */}
                  <div className="space-y-2">
                    <Label htmlFor="fdoName">FDO Name</Label>
                    <Select value={selectedFDO} onValueChange={setSelectedFDO}>
                      <SelectTrigger id="fdoName" className="h-10">
                        <SelectValue placeholder="Select FDO" />
                      </SelectTrigger>
                      <SelectContent>
                        {!isFDO && (
                          <SelectItem value="all">
                            ALL FDOs
                          </SelectItem>
                        )}
                        {fdoList.map((fdo) => (
                          <SelectItem key={fdo.id} value={fdo.id}>
                            {fdo.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Demand Type */}
                  <div className="space-y-2">
                    <Label htmlFor="demandType">Demand Type</Label>
                    <Select
                      value={demandType}
                      onValueChange={(value) =>
                        setDemandType(value as "centerwise" | "clientwise")
                      }
                    >
                      <SelectTrigger id="demandType" className="h-10">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEMAND_TYPES.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Submit Button */}
                  <div className="space-y-2">
                    <Label className="invisible">Submit</Label>
                    <Button
                      onClick={handleGenerateReport}
                      disabled={isLoading}
                      className="h-10 w-full bg-primary hover:bg-primary text-white"
                    >
                      {isLoading ? "Processing..." : "Submit"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Report Content */}
          <div className="bg-white dark:bg-brand-green-darker">
            {submittedDemandType === "centerwise" && demandData.length > 0 && (
              <div
                ref={printRef}
                className="p-8 print:p-0 bg-white min-h-[297mm]"
              >
                {/* Header */}
                <div className="mb-6 space-y-4">
                  <ReportHeader title="Demand Sheet" subtitle="Enterprise Microfinance System" />

                  {/* Branch and Meeting Info */}
                  <div className="grid grid-cols-4 gap-6 bg-green-50/80 rounded-2xl p-6 border border-primary/20 shadow-sm mb-8">
                    <div className="flex flex-col border-r border-primary/20 pr-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Branch</span>
                      <span className="text-base font-bold text-sidebar-accent uppercase">{branchLabel}</span>
                    </div>
                    <div className="flex flex-col border-r border-primary/20 px-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Meeting Day</span>
                      <span className="text-base font-bold text-sidebar-accent uppercase">{dayName}</span>
                    </div>
                    <div className="flex flex-col border-r border-primary/20 px-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">FDO Name</span>
                      <span className="text-base font-bold text-sidebar-accent uppercase">{fdoName}</span>
                    </div>
                    <div className="flex flex-col pl-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Meeting Date</span>
                      <span className="text-base font-bold text-sidebar-accent">{formattedDate}</span>
                    </div>
                  </div>
                </div>

                <DemandSheetCenterwiseTable rows={demandData} />

                {/* Signatures Footer */}
                <div className="mt-10 flex justify-between px-10 pb-10 print:mt-16 print:pb-0">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-px w-48 bg-slate-400 print:bg-black"></div>
                    <span className="font-bold text-sm uppercase">
                      BM Signature
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-px w-48 bg-slate-400 print:bg-black"></div>
                    <span className="font-bold text-sm uppercase">
                      AM Signature
                    </span>
                  </div>
                </div>
              </div>
            )}

            {submittedDemandType === "clientwise" && clientRows.length > 0 && (
              <div
                ref={printRef}
                className="p-8 print:p-0 bg-white min-h-[297mm]"
              >
                <div className="mb-4 flex w-full flex-col gap-3 print:hidden sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                  <div className="min-w-0 max-w-md space-y-2">
                    <Label htmlFor="clientViewCenterFilter">Center</Label>
                    <Select
                      value={clientViewCenterFilter}
                      onValueChange={handleClientViewCenterFilterChange}
                    >
                      <SelectTrigger
                        id="clientViewCenterFilter"
                        className="h-10"
                      >
                        <SelectValue placeholder="All centers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All centers</SelectItem>
                        {centerOptionsForClientView.map(([id, name]) => (
                          <SelectItem key={id} value={id}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {showAllCentersButtonClientwise ? (
                    <Button
                      type="button"
                      variant="default"
                      className="h-11 shrink-0 gap-2 self-stretch bg-primary px-5 font-semibold text-white shadow-md shadow-primary/35 transition hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:shadow-none disabled:ring-0 sm:self-auto dark:focus-visible:ring-offset-green-950"
                      onClick={() => setAllCentersPreviewOpen(true)}
                    >
                      <Download className="h-4 w-4 shrink-0" />
                      Download All Centers
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      className="h-11 shrink-0 gap-2 self-stretch bg-primary px-5 font-semibold text-white shadow-md shadow-primary/35 transition hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 disabled:shadow-none disabled:ring-0 sm:self-auto dark:focus-visible:ring-offset-green-950"
                      disabled={
                        clientViewCenterFilter === "all" ||
                        filteredClientRows.length === 0
                      }
                      title={
                        clientViewCenterFilter === "all"
                          ? "Choose one center above to open its full client-wise demand report"
                          : undefined
                      }
                      onClick={() => {
                        setSelectedClientReportCenterId(clientViewCenterFilter);
                        setClientReportOpen(true);
                      }}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      Detailed report
                    </Button>
                  )}
                </div>

                <div className="mb-6 space-y-4">
                  <ReportHeader title="Demand Sheet — Clientwise" subtitle="Enterprise Microfinance System" />

                  <div className="grid grid-cols-4 gap-6 bg-green-50/80 rounded-2xl p-6 border border-primary/20 shadow-sm mb-8">
                    <div className="flex flex-col border-r border-primary/20 pr-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Branch</span>
                      <span className="text-base font-bold text-sidebar-accent uppercase">{branchLabel}</span>
                    </div>
                    <div className="flex flex-col border-r border-primary/20 px-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Meeting Day</span>
                      <span className="text-base font-bold text-sidebar-accent uppercase">{dayName}</span>
                    </div>
                    <div className="flex flex-col border-r border-primary/20 px-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">FDO Name</span>
                      <span className="text-base font-bold text-sidebar-accent uppercase">{fdoName}</span>
                    </div>
                    <div className="flex flex-col pl-4">
                      <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">Meeting Date</span>
                      <span className="text-base font-bold text-sidebar-accent">{formattedDate}</span>
                    </div>
                  </div>
                </div>

                <DemandSheetClientwiseTable rows={filteredClientRows} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Both dialogs below fetch internally (their own useEffect, keyed on these props)
          using dateStr/fdoId/branchId — passing the SUBMITTED snapshot, not live draft
          state, so opening either dialog after an unsubmitted filter edit still reflects
          the last-generated report, not the edited-but-not-yet-submitted filters. */}
      <ClientWiseDemandReportDialog
        open={clientReportOpen}
        onOpenChange={setClientReportOpen}
        dateStr={submittedDemandDate}
        fdoId={submittedSelectedFDO}
        centerId={selectedClientReportCenterId}
        branchId={submittedSelectedBranchId || undefined}
      />

      <DemandSheetAllCentersDialog
        open={allCentersPreviewOpen}
        onOpenChange={setAllCentersPreviewOpen}
        demandType={submittedDemandType}
        centerRows={demandData}
        clientRows={clientRows}
        branchLabel={branchLabel}
        fdoName={fdoName}
        formattedDate={formattedDate}
        dayName={dayName}
        canExport={canExportReport('demand-sheet')}
        dateStr={submittedDemandDate}
        fdoId={submittedSelectedFDO}
        branchId={submittedSelectedBranchId || undefined}
        onExportPDF={() => handleExportPdf(true)}
        onExportExcel={() => handleExportExcel(true)}
        onExportCSV={() => handleExportCSV(true)}
      />

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 5mm;
            size: ${submittedDemandType === "clientwise" ? "portrait" : "landscape"};
          }
          body {
            background: white !important;
          }

          /* Hide non-print elements definitively */
          .print\\:hidden,
          header,
          aside,
          nav,
          footer,
          button,
          .filters-container {
            display: none !important;
          }

          /* Reset container for print */
          .container {
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          main {
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
          }
        }
      `}</style>
    </ProtectedRoute>
  );
}
