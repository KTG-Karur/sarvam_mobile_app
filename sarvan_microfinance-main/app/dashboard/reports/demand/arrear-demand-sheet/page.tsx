"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSpreadsheet, FileType, FileOutput, Printer, Filter, FileText, Loader2, AlertCircle, Eye, Users, Banknote, Scale, Wallet } from "lucide-react";
import { jsPDF } from "jspdf";
import { useReactToPrint } from "react-to-print";
import { cn } from "@/lib/utils";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getArrearDemandSheetData,
  type ArrearDemandSheetRow,
  type ArrearDemandSheetMeta,
} from "@/app/lib/actions/demand";
import { ClientWiseArrearDemandReportDialog } from "@/components/reports/ClientWiseArrearDemandReportDialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/app/hooks/usePermission";
import { branchStorage } from "@/app/lib/branch-storage";
import { tokenStorage } from "@/app/lib/token-storage";
import { apiClient } from "@/app/lib/api-client";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { drawArrearDemandSheetReport } from "@/app/lib/reports/arrear-demand-sheet-pdf";
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { exportToCSV, exportToWord, type WordExportOptions } from "@/app/lib/report-export-utils";
import { formatReportAmount, truncateReportAmount } from "@/app/lib/utils/format-amount";
import { DateInput } from '@/components/ui/date-input';

const formatCurrency = (amount: number) => formatReportAmount(amount);

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Branch = { id: string; name: string; code: string };
type Center = { id: string; name: string; code: string };

export default function ArrearDemandSheetPage() {
  const { toast } = useToast();
  const { canExportReport, getReportExportMode } = usePermission();
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  // Read after mount, not during render — localStorage doesn't exist on the server, so a
  // render-time read made SSR and the client disagree on the branch picker (hydration
  // mismatch). `undefined` = not read yet; `null` = no stored user.
  const [storedUser, setStoredUser] = useState<ReturnType<typeof tokenStorage.getUser> | undefined>(undefined);
  useEffect(() => {
    setStoredUser(tokenStorage.getUser());
  }, []);
  const isAdminOrAM = storedUser?.role === "ADMIN" || storedUser?.role === "AREA_MANAGER";

  // Filter state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchDisplayName, setBranchDisplayName] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  const [centers, setCenters] = useState<Center[]>([]);
  const [selectedCenterId, setSelectedCenterId] = useState("");
  const [isLoadingCenters, setIsLoadingCenters] = useState(false);

  const [arrearDate, setArrearDate] = useState(getTodayStr());
  // Submitted (applied) snapshot — frozen until the next Generate click. Filenames,
  // PDF/print subtitles, on-screen labels, the Request-Queue exportParams, and the
  // "Detailed Report" dialog's fetch props all read these (not the live arrearDate/
  // selectedCenterId draft), so editing either input after Generate has no effect on
  // export/label/dialog-fetch output until Generate is clicked again. Both are snapshotted
  // together since handleGenerate's own fetch reads them as one pair.
  const [submittedArrearDate, setSubmittedArrearDate] = useState(arrearDate);
  const [submittedCenterId, setSubmittedCenterId] = useState(selectedCenterId);
  const [isGenerating, setIsGenerating] = useState(false);

  // Report data
  const [rows, setRows] = useState<ArrearDemandSheetRow[]>([]);
  const [meta, setMeta] = useState<ArrearDemandSheetMeta | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [selectedRow, setSelectedRow] = useState<ArrearDemandSheetRow | null>(null);
  const [clientReportOpen, setClientReportOpen] = useState(false);

  // ── Load branches on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (storedUser === undefined) return;
    const load = async () => {
      if (isAdminOrAM) {
        setIsLoadingBranches(true);
        try {
          const res = await fetch("/api/branches");
          const json = await res.json();
          const list: Branch[] = (json?.data ?? []).map((b: any) => ({
            id: b.id,
            name: b.name,
            code: b.code,
          }));
          setBranches(list);
          const activeBranch = branchStorage.getActiveBranch();
          const preferred = activeBranch?.id ?? storedUser?.branchId;
          const match = list.find((b) => b.id === preferred) ?? list[0];
          if (match) setSelectedBranchId(match.id);
        } catch {
          toast({ title: "Error", description: "Failed to load branches.", variant: "destructive" });
        } finally {
          setIsLoadingBranches(false);
        }
      } else {
        const activeBranch = branchStorage.getActiveBranch();
        const branchId = activeBranch?.id ?? storedUser?.branchId ?? "";
        setSelectedBranchId(branchId);
        setBranchDisplayName(activeBranch?.name ?? "");
      }
    };
    load();
  }, [storedUser]);

  // ── Load centers when branch changes ──────────────────────────────────
  useEffect(() => {
    if (!selectedBranchId) return;
    setSelectedCenterId("");
    setCenters([]);
    setRows([]);
    setMeta(null);
    setHasGenerated(false);
    const load = async () => {
      setIsLoadingCenters(true);
      try {
        const result = await apiClient.get<Center[]>(
          `/centers?branchId=${selectedBranchId}&includeInactive=false`
        );
        if (result.success && result.data) {
          setCenters(result.data);
        } else {
          toast({ title: "Error", description: result.error || "Failed to load centers.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Error", description: "Failed to load centers.", variant: "destructive" });
      } finally {
        setIsLoadingCenters(false);
      }
    };
    load();
  }, [selectedBranchId]);

  // ── Generate report ────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!selectedCenterId || !arrearDate) return;
    setIsGenerating(true);
    try {
      const result = await getArrearDemandSheetData(arrearDate, selectedCenterId);
      setRows(result.rows);
      setMeta(result.meta);
      setHasGenerated(true);
      setSubmittedArrearDate(arrearDate);
      setSubmittedCenterId(selectedCenterId);
      if (result.rows.length === 0) {
        toast({ title: "No Data", description: "No outstanding arrears found for the selected criteria." });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to generate report.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }, [selectedCenterId, arrearDate]);

  // ── PDF export ─────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    if (!meta || rows.length === 0) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const reportFont = await ensureReportFont(doc);
    const centerCode = meta.centerCode;
    const dateFormatted = format(new Date(submittedArrearDate + "T00:00:00"), "dd/MM/yyyy");

    await drawArrearDemandSheetReport(doc, rows, meta, dateFormatted, reportFont);

    doc.save(`Arrear_Demand_Sheet_${centerCode}_${submittedArrearDate}.pdf`);
  };

  // ── Excel export ───────────────────────────────────────────────────────
  const handleDownloadExcel = async () => {
    if (!meta || rows.length === 0) return;
    const XLSX = await import("xlsx-js-style");
    const headerRows = [
      ...reportHeaderRows("Arrear Demand Sheet"),
      [`Branch: ${meta.branchName} (${meta.branchCode})`],
      [`Center: ${meta.centerName} (${meta.centerCode})`],
      [`Arrear Date: ${submittedArrearDate}`],
      [],
      ["S.No", "Member ID", "Member Name", "Loan ID", "Arrear Principal", "Arrear Interest", "Fees Due", "Penalties Due", "Total Arrear Due", "Collection Status", "Collected Amount", "Collection Date", "Collection Time", "Collected By"],
    ];
    const dataRows = rows.map((r) => [
      r.sNo,
      r.clientId,
      r.clientName,
      r.loanId,
      truncateReportAmount(r.arrearPrincipal),
      truncateReportAmount(r.arrearInterest),
      truncateReportAmount(r.feesDue),
      truncateReportAmount(r.penaltiesDue),
      truncateReportAmount(r.totalArrearDue),
      r.collectionStatus,
      r.collectedAmount != null ? truncateReportAmount(r.collectedAmount) : "",
      r.collectionDateDisplay ?? "",
      r.collectionTimeDisplay ?? "",
      r.collectedBy ?? "",
    ]);
    const totalsRow = [
      "Total", "", "", "",
      truncateReportAmount(meta.totalArrearPrincipal),
      truncateReportAmount(meta.totalArrearInterest),
      truncateReportAmount(meta.totalFeesDue),
      truncateReportAmount(meta.totalPenaltiesDue),
      truncateReportAmount(meta.totalArrearDue),
      "", "", "", "", "",
    ];
    const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows, totalsRow]);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arrear Demand");
    XLSX.writeFile(wb, `Arrear_Demand_Sheet_${meta.centerCode}_${submittedArrearDate}.xlsx`);
  };

  // ── CSV / Word export (mirrors the same field mapping used by handleDownloadExcel
  // above, kept separate so handleDownloadExcel is left untouched) ────────────────
  const buildArrearDemandExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    if (!meta) return { headers: [], rows: [] };
    const headers = ["S.No", "Member ID", "Member Name", "Loan ID", "Arrear Principal", "Arrear Interest", "Fees Due", "Penalties Due", "Total Arrear Due", "Collection Status", "Collected Amount", "Collection Date", "Collection Time", "Collected By"];
    const exportRows: (string | number)[][] = rows.map((r) => [
      r.sNo, r.clientId, r.clientName, r.loanId,
      truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest), truncateReportAmount(r.feesDue), truncateReportAmount(r.penaltiesDue), truncateReportAmount(r.totalArrearDue),
      r.collectionStatus, r.collectedAmount != null ? truncateReportAmount(r.collectedAmount) : "", r.collectionDateDisplay ?? "", r.collectionTimeDisplay ?? "", r.collectedBy ?? "",
    ]);
    exportRows.push([
      "Total", "", "", "",
      truncateReportAmount(meta.totalArrearPrincipal), truncateReportAmount(meta.totalArrearInterest), truncateReportAmount(meta.totalFeesDue), truncateReportAmount(meta.totalPenaltiesDue), truncateReportAmount(meta.totalArrearDue),
      "", "", "", "", "",
    ]);
    return { headers, rows: exportRows };
  };

  const handleExportCSV = () => {
    if (!meta || rows.length === 0) return;
    const { headers, rows: exportRows } = buildArrearDemandExportRows();
    exportToCSV(`Arrear_Demand_Sheet_${meta.centerCode}_${submittedArrearDate}`, "ARREAR DEMAND SHEET", headers, exportRows);
  };

  // Word-only presentation: same rows as Excel/CSV above, but the trailing "Total" row
  // is split off for distinct styling, and the Arrear/Collection column clusters get a
  // 2-row grouped header — genuine related fields, not forced grouping.
  const buildArrearDemandWordOptions = (
    exportRows: (string | number)[][]
  ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
    bodyRows: exportRows.slice(0, -1),
    options: {
      groupHeaders: [
        { label: "S.No", span: 1 },
        { label: "Member ID", span: 1 },
        { label: "Member Name", span: 1 },
        { label: "Loan ID", span: 1 },
        { label: "ARREAR", span: 5 },
        { label: "COLLECTION", span: 5 },
      ],
      subHeaders: ["Principal", "Interest", "Fees Due", "Penalties Due", "Total Due", "Status", "Amount", "Date", "Time", "Collected By"],
      columnAlignments: ["center", "center", "left", "center", "right", "right", "right", "right", "right", "center", "right", "center", "center", "left"],
      columnWidthWeights: [4, 8, 16, 8, 8, 8, 7, 8, 9, 8, 8, 8, 8, 10],
      totalsRow: exportRows[exportRows.length - 1],
    },
  });

  const handleExportWord = async () => {
    if (!meta || rows.length === 0) return;
    const { headers, rows: exportRows } = buildArrearDemandExportRows();
    const { bodyRows, options } = buildArrearDemandWordOptions(exportRows);
    await exportToWord(`Arrear_Demand_Sheet_${meta.centerCode}_${submittedArrearDate}`, "ARREAR DEMAND SHEET", headers, bodyRows, options);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <ProtectedRoute>
      <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
        <div className="container mx-auto px-4 py-8 lg:px-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
              Arrear Demand Sheet
            </h1>
            <p className="text-muted-foreground">
              View and print outstanding arrears for a center up to the selected date
            </p>
          </div>

          {/* Filter Card */}
          <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl">
            <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                  <Filter className="h-5 w-5 text-primary dark:text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Report Filters</CardTitle>
                  <CardDescription>Select branch, center, and arrear date</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Branch */}
                {isAdminOrAM ? (
                  <div className="space-y-2">
                    <Label htmlFor="branch" className="text-sm font-medium">Branch</Label>
                    <Select
                      value={selectedBranchId}
                      onValueChange={setSelectedBranchId}
                      disabled={isLoadingBranches || branches.length === 0}
                    >
                      <SelectTrigger id="branch" className="h-11">
                        <SelectValue placeholder="-- SELECT BRANCH --" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{b.name}</span>
                              <span className="text-muted-foreground">({b.code})</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Branch</Label>
                    <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {branchDisplayName || "Current Branch"}
                    </div>
                  </div>
                )}

                {/* Center */}
                <div className="space-y-2">
                  <Label htmlFor="center" className="text-sm font-medium">Center</Label>
                  <Select
                    value={selectedCenterId}
                    onValueChange={setSelectedCenterId}
                    disabled={isLoadingCenters || centers.length === 0 || !selectedBranchId}
                  >
                    <SelectTrigger id="center" className="h-11">
                      <SelectValue placeholder="-- SELECT CENTER --" />
                    </SelectTrigger>
                    <SelectContent>
                      {centers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="text-muted-foreground">({c.code})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Arrear Date */}
                <div className="space-y-2">
                  <Label htmlFor="arrear-date" className="text-sm font-medium">Arrear Date</Label>
                  <DateInput
                    id="arrear-date"
                    value={arrearDate}
                    onChange={(e) => setArrearDate(e.target.value)}
                    max={getTodayStr()}
                    className="h-11"
                  />
                </div>

                {/* Generate button */}
                <div className="flex items-end">
                  <Button
                    onClick={handleGenerate}
                    disabled={!selectedCenterId || !arrearDate || isGenerating}
                    className="w-full h-11 bg-primary hover:bg-sidebar-accent text-white"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Filter className="mr-2 h-4 w-4" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          {hasGenerated && meta && (() => {
            const collectedRows = rows.filter((r) => r.collectionStatus === "Collected");
            const collectedAmount = collectedRows.reduce((sum, r) => sum + (r.collectedAmount ?? 0), 0);
            const collectedMembers = new Set(collectedRows.map((r) => r.clientId)).size;
            return (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-50/50 dark:border-purple-800/50 dark:from-purple-950/20 dark:to-purple-950/20">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Member Count</p>
                        <p className="mt-2 text-2xl font-bold text-foreground dark:text-purple-100">{meta.totalClients.toLocaleString("en-IN")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Arrear Loans: {rows.length.toLocaleString("en-IN")}</p>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                        <Users className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-2 border-red-200 bg-gradient-to-br from-red-50 to-red-50/50 dark:border-red-800/50 dark:from-red-950/20 dark:to-red-950/20">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">Arrear Amount</p>
                        <p className="mt-2 text-2xl font-bold text-foreground dark:text-red-100">{formatCurrency(meta.totalArrearPrincipal + meta.totalArrearInterest)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Principal: {formatCurrency(meta.totalArrearPrincipal)} · Interest: {formatCurrency(meta.totalArrearInterest)}
                        </p>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                        <Scale className="h-6 w-6 text-red-600 dark:text-red-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-amber-50/50 dark:border-amber-800/50 dark:from-amber-950/20 dark:to-amber-950/20">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Total Arrear Due</p>
                        <p className="mt-2 text-2xl font-bold text-foreground dark:text-amber-100">{formatCurrency(meta.totalArrearDue)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Fees: {formatCurrency(meta.totalFeesDue)} · Penalties: {formatCurrency(meta.totalPenaltiesDue)}
                        </p>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/50">
                        <Banknote className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-2 border-primary/20 bg-gradient-to-br from-green-50 to-green-50/50 dark:border-sidebar-accent/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">Collected</p>
                        <p className="mt-2 text-2xl font-bold text-foreground dark:text-green-100">{formatCurrency(collectedAmount)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Members: {collectedMembers.toLocaleString("en-IN")} · Loans: {collectedRows.length.toLocaleString("en-IN")}
                        </p>
                      </div>
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                        <Wallet className="h-6 w-6 text-primary" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          {/* Results */}
          {hasGenerated && meta && (
            <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl">
              <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
              <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                      <FileText className="h-5 w-5 text-primary dark:text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">
                        {meta.centerName} ({meta.centerCode}) — Arrear Report
                      </CardTitle>
                      <CardDescription>
                        Branch: {meta.branchName} | Date: {format(new Date(submittedArrearDate + "T00:00:00"), "dd/MM/yyyy")} | {meta.totalClients} Client(s) | {rows.length} Loan(s)
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setClientReportOpen(true)}
                      disabled={rows.length === 0}
                      className="gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      Detailed Report
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrint}
                      disabled={rows.length === 0}
                      className="gap-2"
                    >
                      <Printer className="h-4 w-4" />
                      Print
                    </Button>
                    <ExportDropdown
                      onExportPDF={rows.length > 0 ? handleDownloadPDF : undefined}
                      onExportExcel={rows.length > 0 ? handleDownloadExcel : undefined}
                      onExportCSV={rows.length > 0 ? handleExportCSV : undefined}
                      onExportWord={rows.length > 0 ? handleExportWord : undefined}
                      reportSlug={rows.length > 0 && submittedCenterId && getReportExportMode('arrear-demand-sheet') === 'REQUEST_QUEUE' ? 'arrear-demand-sheet' : undefined}
                      canExport={canExportReport('arrear-demand-sheet')}
                      exportParams={{
                        fromDate: submittedArrearDate,
                        branchIds: selectedBranchId ? [selectedBranchId] : 'ALL',
                        filters: { centerId: submittedCenterId },
                      }}
                    />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                    <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-muted-foreground">No outstanding arrears found for this center up to {format(new Date(submittedArrearDate + "T00:00:00"), "dd/MM/yyyy")}.</p>
                  </div>
                ) : (
                  <div ref={printRef} className="print:p-4">
                    {/* Print-only header */}
                    <div className="hidden print:block mb-6">
                      <ReportHeader
                        title="Arrear Demand Sheet"
                        subtitle={`Branch: ${meta.branchName} (${meta.branchCode}) | Center: ${meta.centerName} (${meta.centerCode})  •  Arrear Date: ${format(new Date(submittedArrearDate + "T00:00:00"), "dd/MM/yyyy")} | Total Clients: ${meta.totalClients}`}
                      />
                    </div>

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-green-50 dark:bg-brand-green-darker/40">
                            <TableHead className="w-12 text-center font-semibold">S.No</TableHead>
                            <TableHead className="font-semibold">Member ID</TableHead>
                            <TableHead className="font-semibold">Member Name</TableHead>
                            <TableHead className="font-semibold">Loan ID</TableHead>
                            <TableHead className="text-right font-semibold text-red-600">Arrear Principal</TableHead>
                            <TableHead className="text-right font-semibold text-red-600">Arrear Interest</TableHead>
                            <TableHead className="text-right font-semibold">Fees Due</TableHead>
                            <TableHead className="text-right font-semibold">Penalties</TableHead>
                            <TableHead className="text-right font-semibold text-primary">Total Arrear</TableHead>
                            <TableHead className="text-center font-semibold">Coll. Status</TableHead>
                            <TableHead className="text-right font-semibold">Coll. Amount</TableHead>
                            <TableHead className="text-center font-semibold">Coll. Date</TableHead>
                            <TableHead className="text-center font-semibold">Coll. Time</TableHead>
                            <TableHead className="font-semibold">Collected By</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                            <TableRow key={row.loanDbId} className="hover:bg-green-50/60 dark:hover:bg-brand-green-darker/20">
                              <TableCell className="text-center text-muted-foreground">{row.sNo}</TableCell>
                              <TableCell className="font-mono text-xs">{row.clientId}</TableCell>
                              <TableCell className="font-medium">{row.clientName}</TableCell>
                              <TableCell className="font-mono text-xs">{row.loanId}</TableCell>
                              <TableCell className="text-right text-red-600 font-medium">{formatCurrency(row.arrearPrincipal)}</TableCell>
                              <TableCell className="text-right text-red-600 font-medium">{formatCurrency(row.arrearInterest)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.feesDue)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.penaltiesDue)}</TableCell>
                              <TableCell className="text-right font-bold text-primary">{formatCurrency(row.totalArrearDue)}</TableCell>
                              <TableCell className="text-center">
                                {row.collectionStatus ? (
                                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                    {row.collectionStatus}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {row.collectedAmount != null ? formatCurrency(row.collectedAmount) : ""}
                              </TableCell>
                              <TableCell className="text-center text-xs text-muted-foreground">
                                {row.collectionDateDisplay ?? ""}
                              </TableCell>
                              <TableCell className="text-center text-xs text-muted-foreground">
                                {row.collectionTimeDisplay ?? ""}
                              </TableCell>
                              <TableCell className="text-xs">
                                {row.collectedBy ?? ""}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => setSelectedRow(row)}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Totals row */}
                          <TableRow className="bg-primary/10 dark:bg-brand-green-darker/40 font-bold border-t-2 border-primary/30">
                            <TableCell colSpan={4} className="font-bold text-foreground dark:text-green-200">
                              Total ({rows.length} loan{rows.length !== 1 ? "s" : ""}, {meta.totalClients} client{meta.totalClients !== 1 ? "s" : ""})
                            </TableCell>
                            <TableCell className="text-right text-red-600 font-bold">{formatCurrency(meta.totalArrearPrincipal)}</TableCell>
                            <TableCell className="text-right text-red-600 font-bold">{formatCurrency(meta.totalArrearInterest)}</TableCell>
                            <TableCell className="text-right font-bold">{formatCurrency(meta.totalFeesDue)}</TableCell>
                            <TableCell className="text-right font-bold">{formatCurrency(meta.totalPenaltiesDue)}</TableCell>
                            <TableCell className="text-right font-bold text-primary text-base">{formatCurrency(meta.totalArrearDue)}</TableCell>
                            <TableCell /><TableCell /><TableCell /><TableCell /><TableCell /><TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {/* Client-wise arrear detailed report dialog */}
      <ClientWiseArrearDemandReportDialog
        open={clientReportOpen}
        onOpenChange={setClientReportOpen}
        arrearDateStr={submittedArrearDate}
        centerId={submittedCenterId}
      />

      {/* Client-wise arrear detail modal */}
      <Dialog open={!!selectedRow} onOpenChange={() => setSelectedRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Client Arrear Detail</DialogTitle>
          </DialogHeader>
          {selectedRow && (
            <div className="space-y-4 text-sm">
              {/* Client & Loan info */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 bg-muted/30">
                <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground mb-1">Client & Loan</div>
                <div><span className="font-semibold">Member ID:</span> <span className="font-mono text-xs ml-1">{selectedRow.clientId}</span></div>
                <div><span className="font-semibold">Member Name:</span> <span className="ml-1">{selectedRow.clientName}</span></div>
                <div><span className="font-semibold">Loan ID:</span> <span className="font-mono text-xs ml-1">{selectedRow.loanId}</span></div>
              </div>

              {/* Arrear amounts */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 bg-red-50/50 dark:bg-red-950/20">
                <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground mb-1">Arrear Amounts</div>
                <div><span className="font-semibold text-red-600">Arrear Principal:</span> <span className="ml-1">{formatCurrency(selectedRow.arrearPrincipal)}</span></div>
                <div><span className="font-semibold text-red-600">Arrear Interest:</span> <span className="ml-1">{formatCurrency(selectedRow.arrearInterest)}</span></div>
                <div><span className="font-semibold">Fees Due:</span> <span className="ml-1">{formatCurrency(selectedRow.feesDue)}</span></div>
                <div><span className="font-semibold">Penalties:</span> <span className="ml-1">{formatCurrency(selectedRow.penaltiesDue)}</span></div>
                <div className="col-span-2 pt-1 border-t font-bold text-primary">
                  Total Arrear Due: {formatCurrency(selectedRow.totalArrearDue)}
                </div>
              </div>

              {/* Collection status */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 bg-green-50/60 dark:bg-brand-green-darker/20">
                <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground mb-1">Collection Details</div>
                <div>
                  <span className="font-semibold">Status:</span>
                  {selectedRow.collectionStatus ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      {selectedRow.collectionStatus}
                    </span>
                  ) : (
                    <span className="ml-2 text-muted-foreground">—</span>
                  )}
                </div>
                <div>
                  <span className="font-semibold">Collected Amount:</span>
                  <span className="ml-1">{selectedRow.collectedAmount != null ? formatCurrency(selectedRow.collectedAmount) : "—"}</span>
                </div>
                <div>
                  <span className="font-semibold">Collection Date:</span>
                  <span className="ml-1">{selectedRow.collectionDateDisplay ?? "—"}</span>
                </div>
                <div>
                  <span className="font-semibold">Collection Time:</span>
                  <span className="ml-1">{selectedRow.collectionTimeDisplay ?? "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold">Collected By:</span>
                  <span className="ml-1">{selectedRow.collectedBy ?? "—"}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  );
}
