"use client";
import { useState, useEffect, useMemo, useRef } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx-js-style";
import { useReactToPrint } from "react-to-print";
import {
  Search,
  RotateCcw as RotateCcwIcon,
  FileText,
  Download,
  Building2,
  User,
  Loader2,
  Printer,
  FileDown,
  FileSpreadsheet,
  FileType,
  Clock,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getCentersForDropdown, CenterOption } from "@/app/lib/actions/centers";
import { cn } from "@/lib/utils";
import { usePermission } from "@/app/hooks/usePermission";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";
import { apiClient } from "@/app/lib/api-client";
import { RevertLocationPicker, type RevertLocationValue } from "@/components/revert/RevertLocationPicker";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { drawLoanLedgerReport } from "@/app/lib/reports/loan-ledger-pdf";
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { formatReportAmount, truncateReportAmount } from "@/app/lib/utils/format-amount";
import { exportToWord, type WordExportOptions } from "@/app/lib/report-export-utils";

type ClientOption = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
};

type LoanOption = {
  id: string;
  loanNumber: string;
  amount: number;
  loanStatus: string;
  disbursementStatus: string;
};

type LedgerTransaction = {
  isOpeningBalance: boolean;
  date: string | null;
  transactionId?: string;
  type: string;
  description?: string;
  paymentMode?: string;
  loanAc: string;
  productName: string;
  principal: number;
  disbursementAmount?: number;
  interest: number;
  fee: number;
  total: number;
  balance: number;
};

type LedgerData = {
  clientDetails: {
    clientId: string;
    clientName: string;
    centerName: string;
    centerCode: string;
  };
  loanDetails?: {
    loanAc: string;
    loanStatus: string;
    productName: string;
    disbursedAmount: number;
    disbursedDate: string | null;
    interestRate: number;
    tenure: string;
    outstandingBalance: number;
  };
  ledger: LedgerTransaction[];
};

type DuesRow = {
  dueNo: number;
  dueDate: string | null;
  collectionDate: string | null;
  duePrincipal: number;
  dueInterest: number;
  dueAmount: number;
  dueSavings: number;
  collectedPrincipal: number;
  collectedInterest: number;
  collectedPenalty: number;
  collectedAmount: number;
  collectedSavings: number;
  dueBalance: number;
  arrearPrincipal: number;
  arrearInterest: number;
  arrearTotal: number;
  transactionDbId: string | null;
  collectionBatchId: string | null;
  transactionStatus: string | null;
  collectedByName: string | null;
  isEodLocked: boolean;
};

type DeathMarkingInfo = {
  deceasedPersonType: string;
  deceasedPersonName: string;
  deathDate: string;
  placeOfDeath: string;
  deathReason: string;
  demandRequired: boolean;
};

type DuesLedgerData = {
  header: {
    branchLabel: string;
    centerLabel: string;
    clientId: string;
    clientName: string;
    loanAccount: string;
    loanAmount: number;
    disbursalDate: string | null;
    loanEndDate?: string | null;
    totalDues: number;
    interestAmount: number;
    totalAmount: number;
    isDead?: boolean;
    deathMarking?: DeathMarkingInfo | null;
    groupOfficerName?: string | null;
    funderName?: string | null;
  };
  rows: DuesRow[];
  totals: {
    duePrincipal: number;
    dueInterest: number;
    dueAmount: number;
    dueSavings: number;
    collectedPrincipal: number;
    collectedInterest: number;
    collectedAmount: number;
    collectedSavings: number;
    dueBalance: number;
  };
};

// Format date as "DD/MM/YYYY"
const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) return dateString;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateString;
  }
};

// Format date as "DD-MM-YYYY hh:mm A"
const formatDateTime = (dateString: string | null | undefined): string => {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = date.getHours() >= 12 ? "PM" : "AM";
    return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
  } catch {
    return dateString;
  }
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatLegacyNumber = (amount: number): string => formatReportAmount(amount);

export function LoanLedgerReport() {
  const { toast } = useToast();
  const { hasRole, canExportReport, getReportExportMode } = usePermission();
  const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
  const isAdmin = hasRole('admin');
  const isBM = hasRole('branch-manager');
  const printRef = useRef<HTMLDivElement>(null);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [centers, setCenters] = useState<CenterOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loans, setLoans] = useState<LoanOption[]>([]);
  const [selectedCenter, setSelectedCenter] = useState<string>("");

  const filteredCenters = selectedBranch === "all"
    ? centers
    : centers.filter((c) => c.branchId === selectedBranch);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [selectedLoan, setSelectedLoan] = useState<string>("all");
  const [loanType, setLoanType] = useState<string>("all"); // "all", "open", "closed"
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingClients, setIsFetchingClients] = useState(false);
  const [isFetchingLoans, setIsFetchingLoans] = useState(false);
  const [duesData, setDuesData] = useState<DuesLedgerData | null>(null);
  const [revertDialog, setRevertDialog] = useState<{ open: boolean; row: DuesRow | null }>({ open: false, row: null });
  const [revertLocation, setRevertLocation] = useState<RevertLocationValue | null>(null);
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; batchId: string | null }>({ open: false, batchId: null });
  const [actionLoading, setActionLoading] = useState(false);

  const canShowDuesReport = useMemo(
    () => selectedLoan !== "all",
    [selectedLoan]
  );

  useEffect(() => {
    const fetchCenters = async () => {
      try {
        const centerOptions = await getCentersForDropdown();
        setCenters(centerOptions);
      } catch (error) {
        console.error("Failed to fetch centers:", error);
        toast({
          title: "Error",
          description: "Failed to load centers list.",
          variant: "destructive",
        });
      }
    };
    fetchCenters();

    fetch('/api/branches')
      .then((r) => r.json())
      .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
      .catch(() => {});
  }, [toast]);

  useEffect(() => {
    const fetchClients = async () => {
      if (!selectedCenter) {
        setClients([]);
        return;
      }
      setIsFetchingClients(true);
      try {
        const data = await apiClient.get<{ clients: any[] }>(
          `/clients?centerId=${selectedCenter}&pageSize=1000&includeInactive=false`
        );
        if (!data.success) throw new Error(data.error || "Failed to fetch clients");
        if (data.data && data.data.clients) {
          setClients(
            data.data.clients.map((c: any) => ({
              id: c.id,
              clientId: c.clientId,
              firstName: c.firstName || "",
              lastName: c.lastName || "",
            }))
          );
        } else {
          setClients([]);
        }
      } catch (error) {
        console.error("Error fetching clients:", error);
        toast({
          title: "Error fetching clients",
          description: "Please try again later.",
          variant: "destructive",
        });
      } finally {
        setIsFetchingClients(false);
      }
    };
    fetchClients();
  }, [selectedCenter, toast]);

  useEffect(() => {
    const fetchLoans = async () => {
      if (!selectedClient) {
        setLoans([]);
        return;
      }
      setIsFetchingLoans(true);
      try {
        // "open" only needs active loans (default API behavior); "closed"/"all" need
        // includeInactive so foreclosed/written-off/auto-closed loans are returned too.
        const includeInactiveParam = loanType === "open" ? "" : "&includeInactive=true";
        const data = await apiClient.get<{ loans: any[] }>(
          `/loans?clientId=${selectedClient}&centerId=${selectedCenter}&pageSize=50${includeInactiveParam}`
        );
        if (!data.success) throw new Error(data.error || "Failed to fetch loans");
        if (data.data && data.data.loans) {
          let filteredLoans = data.data.loans.map((l: any) => ({
            id: l.id,
            loanNumber: l.loanNumber,
            amount: Number(l.amount),
            loanStatus: l.loanStatus || "OPEN",
            disbursementStatus: l.disbursementStatus || "",
          }));

          // Apply loan type filter with proper typing
          if (loanType === "open") {
            filteredLoans = filteredLoans.filter(
              (loan: LoanOption) =>
                loan.loanStatus === "ACTIVE" || loan.loanStatus === "OPEN"
            );
          } else if (loanType === "closed") {
            filteredLoans = filteredLoans.filter(
              (loan: LoanOption) => loan.loanStatus === "CLOSED"
            );
          }
          setLoans(filteredLoans);
        } else {
          setLoans([]);
        }
      } catch (error) {
        console.error("Error fetching loans:", error);
        toast({
          title: "Error fetching loans",
          variant: "destructive",
        });
      } finally {
        setIsFetchingLoans(false);
      }
    };
    fetchLoans();
  }, [selectedClient, loanType, toast]);

  const handleShow = async () => {
    if (!selectedCenter) {
      toast({
        title: "Center Required",
        description: "Please select a center",
        variant: "destructive",
      });
      return;
    }
    if (!selectedClient) {
      toast({
        title: "Client Required",
        description: "Please select a client",
        variant: "destructive",
      });
      return;
    }
    if (!canShowDuesReport) {
      toast({
        title: "Loan Account Required",
        description: "Please select a specific loan account.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        centerId: selectedCenter,
        clientId: selectedClient,
      });
      if (selectedLoan && selectedLoan !== "all") {
        queryParams.append("loanId", selectedLoan);
      }

      const result = await apiClient.get<DuesLedgerData>(
        `/reports/client/loan-ledger-dues?${queryParams}`
      );
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to fetch ledger");
      }
      const data = result.data;
      setDuesData(data);

      if (data.rows.length === 0) {
        toast({
          title: "No Data",
          description: "No dues found for the selected loan account.",
        });
      } else {
        toast({
          title: "Success",
          description: `Report loaded successfully.`,
        });
      }
    } catch (error: any) {
      console.error("Error generating ledger:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to generate ledger.",
        variant: "destructive",
      });
      setDuesData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshDuesData = async () => {
    if (!selectedCenter || !selectedClient || !selectedLoan || selectedLoan === "all") return;
    const queryParams = new URLSearchParams({ centerId: selectedCenter, clientId: selectedClient, loanId: selectedLoan });
    const result = await apiClient.get<DuesLedgerData>(`/reports/client/loan-ledger-dues?${queryParams}`);
    if (result.success && result.data) {
      setDuesData(result.data);
    }
  };

  const handleRevert = async (row: DuesRow) => {
    if (!row.transactionDbId || !revertLocation) return;
    setActionLoading(true);
    const res = await apiClient.post<null>('/collections/client/reverse', {
      transactionId: row.transactionDbId,
      remarks: 'Reverted from Loan Ledger',
      latitude: revertLocation.latitude,
      longitude: revertLocation.longitude,
    });
    setActionLoading(false);
    setRevertDialog({ open: false, row: null });
    setRevertLocation(null);
    if (res.success) {
      toast({ title: 'Reverted', description: 'Transaction reversed successfully.' });
      await refreshDuesData();
    } else {
      toast({ title: 'Error', description: (res as any).error || 'Failed to reverse.', variant: 'destructive' });
    }
  };

  const handleApprove = async (batchId: string) => {
    setActionLoading(true);
    const res = await apiClient.post<null>('/collections/approve', { batchId, action: 'APPROVE' });
    setActionLoading(false);
    setApproveDialog({ open: false, batchId: null });
    if (res.success) {
      toast({ title: 'Approved', description: 'Collection approved successfully.' });
      await refreshDuesData();
    } else {
      toast({ title: 'Error', description: (res as any).error || 'Failed to approve.', variant: 'destructive' });
    }
  };

  const handleReset = () => {
    setSelectedBranch("all");
    setSelectedCenter("");
    setSelectedClient("");
    setSelectedLoan("all");
    setLoanType("all");
    setDuesData(null);
  };

  const handleExport = () => {
    if (!duesData || duesData.rows.length === 0) return;

    try {
      const headers = [
        "Due No",
        "Due Date",
        "Coll Date",
        "Due Pri Amt",
        "Due Int Amt",
        "Due Amt",
        ...(loanAdvanceEnabled ? ["Loan Adv Due"] : []),
        "Coll Pri",
        "Coll Int",
        "Coll Amt",
        ...(loanAdvanceEnabled ? ["Loan Adv Coll"] : []),
        "Due Balance",
        "Arrear Amt",
        "Penalty Pri",
        "Penalty Int",
        "Penalty Total",
        "Group Officer",
        "Collected By",
        "Funder",
        "Arrear Receive",
      ];

      const csvContent = [
        headers.join(","),
        ...duesData.rows.map((r) =>
          [
            r.dueNo,
            formatDateTime(r.dueDate),
            formatDateTime(r.collectionDate),
            r.duePrincipal,
            r.dueInterest,
            r.dueAmount,
            ...(loanAdvanceEnabled ? [r.dueSavings] : []),
            r.collectedPrincipal,
            r.collectedInterest,
            r.collectedAmount,
            ...(loanAdvanceEnabled ? [r.collectedSavings] : []),
            r.dueBalance,
            r.arrearTotal,
            0,
            0,
            r.collectedPenalty,
            duesData.header.groupOfficerName ?? "",
            r.collectedByName ?? "",
            duesData.header.funderName ?? "",
            r.arrearTotal,
          ]
            .map((v) => (typeof v === "string" && v.includes(",") ? `"${v.replace(/"/g, '""')}"` : v))
            .join(",")
        ),
        [
          "Total", "", "",
          duesData.totals.duePrincipal, duesData.totals.dueInterest, duesData.totals.dueAmount,
          ...(loanAdvanceEnabled ? [duesData.totals.dueSavings] : []),
          duesData.totals.collectedPrincipal, duesData.totals.collectedInterest, duesData.totals.collectedAmount,
          ...(loanAdvanceEnabled ? [duesData.totals.collectedSavings] : []),
          duesData.totals.dueBalance,
          "", "", "", "", "", "", "", "",
        ].join(","),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `Loan_Dues_Ledger_${duesData.header.loanAccount}.csv`
      );
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Success",
        description: "Dues ledger exported successfully.",
      });
    } catch (error) {
      console.error("Export Error:", error);
      toast({
        title: "Export Failed",
        description: "Could not export dues ledger.",
        variant: "destructive",
      });
    }
  };

  const buildLoanLedgerExportRows = (): { headers: (string | number)[]; rows: (string | number)[][] } => {
    const headers = [
      "Due No",
      "Due Date",
      "Coll Date",
      "Due Pri Amt",
      "Due Int Amt",
      "Due Amt",
      ...(loanAdvanceEnabled ? ["Loan Adv Due"] : []),
      "Coll Pri",
      "Coll Int",
      "Coll Amt",
      ...(loanAdvanceEnabled ? ["Loan Adv Coll"] : []),
      "Due Balance",
      "Arrear Amt",
      "Penalty Pri",
      "Penalty Int",
      "Penalty Total",
      "Group Officer",
      "Collected By",
      "Funder",
      "Arrear Receive",
    ];
    const rows = (duesData?.rows ?? []).map((r) => [
      r.dueNo,
      formatDateTime(r.dueDate),
      formatDateTime(r.collectionDate),
      truncateReportAmount(r.duePrincipal),
      truncateReportAmount(r.dueInterest),
      truncateReportAmount(r.dueAmount),
      ...(loanAdvanceEnabled ? [truncateReportAmount(r.dueSavings)] : []),
      truncateReportAmount(r.collectedPrincipal),
      truncateReportAmount(r.collectedInterest),
      truncateReportAmount(r.collectedAmount),
      ...(loanAdvanceEnabled ? [truncateReportAmount(r.collectedSavings)] : []),
      truncateReportAmount(r.dueBalance),
      truncateReportAmount(r.arrearTotal),
      0,
      0,
      truncateReportAmount(r.collectedPenalty),
      duesData?.header.groupOfficerName ?? "",
      r.collectedByName ?? "",
      duesData?.header.funderName ?? "",
      truncateReportAmount(r.arrearTotal),
    ]);
    if (duesData && duesData.rows.length > 0) {
      const t = duesData.totals;
      rows.push([
        "Total", "", "",
        truncateReportAmount(t.duePrincipal), truncateReportAmount(t.dueInterest), truncateReportAmount(t.dueAmount),
        ...(loanAdvanceEnabled ? [truncateReportAmount(t.dueSavings)] : []),
        truncateReportAmount(t.collectedPrincipal), truncateReportAmount(t.collectedInterest), truncateReportAmount(t.collectedAmount),
        ...(loanAdvanceEnabled ? [truncateReportAmount(t.collectedSavings)] : []),
        truncateReportAmount(t.dueBalance),
        "", "", "", "", "", "", "", "",
      ]);
    }
    return { headers, rows };
  };

  const handleExportExcel = () => {
    if (!duesData || duesData.rows.length === 0) return;
    const { headers, rows } = buildLoanLedgerExportRows();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ...reportHeaderRows(`Loan Dues Ledger: ${duesData.header.loanAccount}`),
      headers,
      ...rows,
    ]);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    XLSX.writeFile(wb, `Loan_Dues_Ledger_${duesData.header.loanAccount}.xlsx`);
  };

  // Word-only presentation: same rows as Excel above, but the trailing "Total" row
  // (when present) is split off for distinct styling, and the Due/Collected/Penalty
  // Principal-Interest-Total triads get a 2-row grouped header — genuine related fields.
  const buildLoanLedgerWordOptions = (
    rows: (string | number)[][]
  ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
    bodyRows: rows.slice(0, -1),
    options: {
      groupHeaders: [
        { label: "Due No", span: 1 }, { label: "Due Date", span: 1 }, { label: "Coll Date", span: 1 },
        { label: "DUE", span: 3 },
        ...(loanAdvanceEnabled ? [{ label: "Loan Adv Due", span: 1 }] : []),
        { label: "COLLECTED", span: 3 },
        ...(loanAdvanceEnabled ? [{ label: "Loan Adv Coll", span: 1 }] : []),
        { label: "Due Balance", span: 1 }, { label: "Arrear Amt", span: 1 },
        { label: "PENALTY", span: 3 }, { label: "Group Officer", span: 1 }, { label: "Collected By", span: 1 },
        { label: "Funder", span: 1 }, { label: "Arrear Receive", span: 1 },
      ],
      subHeaders: ["Principal", "Interest", "Total", "Principal", "Interest", "Total", "Principal", "Interest", "Total"],
      columnAlignments: [
        "center", "center", "center", "right", "right", "right",
        ...(loanAdvanceEnabled ? (["right"] as const) : []),
        "right", "right", "right",
        ...(loanAdvanceEnabled ? (["right"] as const) : []),
        "right", "right", "right", "right", "right", "left", "left", "left", "right",
      ],
      columnWidthWeights: [
        6, 8, 8, 7, 7, 7,
        ...(loanAdvanceEnabled ? [8] : []),
        7, 7, 7,
        ...(loanAdvanceEnabled ? [8] : []),
        7, 7, 7, 7, 7, 9, 9, 8, 8,
      ],
      totalsRow: rows[rows.length - 1],
    },
  });

  const handleExportWord = async () => {
    if (!duesData || duesData.rows.length === 0) return;
    const { headers, rows } = buildLoanLedgerExportRows();
    const { bodyRows, options } = buildLoanLedgerWordOptions(rows);
    await exportToWord(
      `Loan_Dues_Ledger_${duesData.header.loanAccount}`,
      `LOAN DUES LEDGER: ${duesData.header.loanAccount}`,
      headers,
      bodyRows,
      options
    );
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Loan_Dues_Ledger_${duesData?.header.loanAccount || "Report"}`,
  });

  const handlePdfExport = async () => {
    if (!duesData || duesData.rows.length === 0) return;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const reportFont = await ensureReportFont(doc);

    try {
      await drawLoanLedgerReport(doc, duesData, reportFont, undefined, loanAdvanceEnabled);

      doc.save(`Loan_Dues_Ledger_${duesData.header.loanAccount}.pdf`);
      toast({
        title: "PDF Exported",
        description: "Dues ledger PDF downloaded successfully.",
      });
    } catch (error) {
      console.error("PDF Export error:", error);
      toast({
        title: "Export Failed",
        description: "Failed to generate dues ledger PDF.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 print:space-y-0">
      {/* Filter Card - Hidden during print */}
      <Card className="border-0 shadow-2xl bg-white/90 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden group transition-all duration-500 hover:shadow-primary/10 print:hidden hidden-print">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary to-primary" />
        <CardHeader className="px-6 py-5 border-b border-slate-100 dark:border-sidebar-accent/50">
          <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-white dark:to-slate-400 flex items-center gap-3">
            <div className="p-2 bg-brand-green-tint dark:bg-brand-green-darker/40 rounded-lg">
              <FileText className="w-5 h-5 text-primary dark:text-primary" />
            </div>
            Loan Ledger Filter
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-x-8 gap-y-6">
            {/* Branch Selection - Span 2 */}
            <div className="lg:col-span-2 space-y-2.5 min-w-0">
              <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200">
                BRANCH
              </Label>
              <div className="relative group/input">
                <Select
                  value={selectedBranch}
                  onValueChange={(val) => {
                    setSelectedBranch(val);
                    setSelectedCenter("");
                    setSelectedClient("");
                    setSelectedLoan("all");
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                    <div className="truncate text-left w-full pr-4">
                      <SelectValue placeholder="-- ALL BRANCHES --" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-primary/20 shadow-2xl">
                    <SelectItem value="all" className="py-3">-- ALL BRANCHES --</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="py-3">
                        {b.code} - {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-hover/input:text-primary transition-colors pointer-events-none" />
              </div>
            </div>

            {/* Center Selection - Span 3 */}
            <div className="lg:col-span-3 space-y-2.5 min-w-0">
              <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                CENTER NAME
                <span className="text-red-500">*</span>
              </Label>
              <div className="relative group/input">
                <Select
                  value={selectedCenter}
                  onValueChange={(val) => {
                    setSelectedCenter(val);
                    setSelectedClient("");
                    setSelectedLoan("all");
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                    <div className="truncate text-left w-full pr-4">
                      <SelectValue placeholder="Select Center" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-primary/20 shadow-2xl">
                    {filteredCenters.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="py-3">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-hover/input:text-primary transition-colors pointer-events-none" />
              </div>
            </div>

            {/* Client Selection - Span 5 */}
            <div className="lg:col-span-5 space-y-2.5 min-w-0">
              <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                CLIENT NAME
                <span className="text-red-500">*</span>
              </Label>
              <div className="relative group/input">
                <Select
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  disabled={!selectedCenter || isLoading || isFetchingClients}
                >
                  <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                    {isFetchingClients ? (
                      <div className="flex items-center gap-3 text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="font-medium">Syncing...</span>
                      </div>
                    ) : (
                      <div className="truncate text-left w-full pr-6 font-medium">
                        <SelectValue placeholder="Select Client" />
                      </div>
                    )}
                  </SelectTrigger>
                  <SelectContent className="max-h-[400px] rounded-xl border-primary/20 shadow-2xl">
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="py-3">
                        <div className="flex items-center gap-2 max-w-full">
                          <span className="font-bold text-primary dark:text-primary flex-shrink-0">
                            {c.clientId}
                          </span>
                          <span className="text-slate-300">|</span>
                          <span className="font-medium text-sidebar-accent dark:text-slate-200 truncate">
                            {c.firstName} {c.lastName}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-hover/input:text-primary transition-colors pointer-events-none" />
              </div>
            </div>

            {/* Loan Type Selection - Span 2 */}
            <div className="lg:col-span-2 space-y-2.5 min-w-0">
              <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                LOAN TYPE
              </Label>
              <div className="relative group/input">
                <Select
                  value={loanType}
                  onValueChange={setLoanType}
                  disabled={!selectedClient || isLoading}
                >
                  <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                    <div className="truncate text-left w-full pr-4">
                      <SelectValue placeholder="Select Loan Type" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-primary/20 shadow-2xl">
                    <SelectItem value="all" className="py-3">
                      All Loans
                    </SelectItem>
                    <SelectItem value="open" className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        Open Loans (Active)
                      </div>
                    </SelectItem>
                    <SelectItem value="closed" className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500"></div>
                        Closed Loans
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-hover/input:text-primary transition-colors pointer-events-none" />
              </div>
            </div>

            {/* Loan Account Selection - Span 2 */}
            <div className="lg:col-span-2 space-y-2.5 min-w-0">
              <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                LOAN ACCOUNT
              </Label>
              <div className="relative group/input">
                <Select
                  value={selectedLoan}
                  onValueChange={setSelectedLoan}
                  disabled={
                    !selectedClient ||
                    isLoading ||
                    isFetchingLoans ||
                    loans.length === 0
                  }
                >
                  <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                    {isFetchingLoans ? (
                      <div className="flex items-center gap-3 text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="font-medium">Syncing...</span>
                      </div>
                    ) : (
                      <div className="truncate text-left w-full pr-6 font-medium">
                        <SelectValue placeholder="Select Loan" />
                      </div>
                    )}
                  </SelectTrigger>
                  <SelectContent className="max-h-[400px] rounded-xl border-primary/20 shadow-2xl">
                    <SelectItem value="all" className="py-3 text-slate-500 italic">
                      -- All Loans --
                    </SelectItem>
                    {loans.map((l) => (
                      <SelectItem key={l.id} value={l.id} className="py-3">
                        <div className="flex items-center justify-between w-full pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-primary dark:text-primary">
                              {l.loanNumber}
                            </span>
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                                l.loanStatus === "CLOSED"
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                              )}
                            >
                              {l.loanStatus === "CLOSED" ? "CLOSED" : "ACTIVE"}
                            </span>
                          </div>
                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            ₹{l.amount.toLocaleString("en-IN")}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FileText className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-hover/input:text-primary transition-colors pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mt-10 pt-8 border-t border-slate-100 dark:border-sidebar-accent/50">
            <div className="flex items-center gap-4 w-full md:w-auto">
              <Button
                onClick={handleShow}
                disabled={isLoading}
                className="flex-1 md:flex-none h-12 px-10 bg-brand-green-darker hover:bg-black text-white dark:bg-primary dark:hover:bg-primary shadow-xl shadow-primary/10 transition-all active:scale-95 font-bold tracking-tight rounded-xl"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-3 h-5 w-5 animate-spin" /> FETCHING...
                  </>
                ) : (
                  <>
                    <Search className="mr-3 h-5 w-5" /> SHOW LEDGER
                  </>
                )}
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                disabled={isLoading}
                className="flex-1 md:flex-none h-12 px-10 border-primary/20 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-sidebar-accent font-bold tracking-tight rounded-xl transition-all"
              >
                <RotateCcwIcon className="mr-3 h-5 w-5" /> RESET
              </Button>
            </div>

            {duesData && (
              <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto p-1 bg-green-50 dark:bg-sidebar-accent/50 rounded-2xl">
                <ExportDropdown
                  onExportPDF={handlePdfExport}
                  onExportExcel={handleExportExcel}
                  onExportCSV={handleExport}
                  canExport={canExportReport('loan-ledger')}
                  onExportWord={handleExportWord}
                  reportSlug={selectedLoan !== 'all' && getReportExportMode('loan-ledger') === 'REQUEST_QUEUE' ? 'loan-ledger' : undefined}
                  exportParams={{
                    fromDate: null,
                    toDate: null,
                    branchIds: 'ALL',
                    filters: { centerId: selectedCenter, clientId: selectedClient, loanId: selectedLoan },
                  }}
                  className="h-11 px-6 text-emerald-600 hover:bg-emerald-100/50 dark:text-emerald-400 dark:hover:bg-emerald-400/10 font-bold rounded-xl whitespace-nowrap"
                />
                <div className="w-px h-6 bg-brand-green-tint dark:bg-sidebar-accent hidden md:block" />
                <Button
                  onClick={handlePrint}
                  variant="ghost"
                  className="h-11 px-6 text-primary hover:bg-brand-green-tint/50 dark:text-primary dark:hover:bg-primary/10 font-bold rounded-xl whitespace-nowrap"
                >
                  <Printer className="mr-2 h-4 w-4" /> PRINT
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report Display */}
      {duesData && (
        <div className="space-y-6 print:space-y-4 print:m-0 print:p-0" ref={printRef}>
          {/* Print Header */}
          <div className="hidden print:block mb-6">
            <ReportHeader title="Loan Dues Ledger" />
          </div>

          {/* Client Info Banner */}
          <Card className="border border-primary/20 bg-gradient-to-r from-green-50 to-green-50/50 dark:bg-brand-green-darker/40 dark:border-sidebar-accent shadow-sm print:border-primary/30 print:shadow-none print:bg-transparent">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Client Name
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {duesData.header.clientName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Client ID
                  </p>
                  <p className="text-lg font-bold text-sidebar-accent dark:text-primary mt-1 uppercase tracking-wide">
                    {duesData.header.clientId}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Center
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {duesData.header.centerLabel}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Loan Account
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-lg font-bold text-foreground dark:text-white">
                      {duesData.header.loanAccount}
                    </p>
                    {duesData.header.isDead && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 rounded uppercase tracking-wider">
                        DEAD
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-2 md:col-span-4 mt-2">
                  <hr className="border-primary/20/60 dark:border-sidebar-accent" />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Loan Amount
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {formatLegacyNumber(duesData.header.loanAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Disbursal Date
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {formatDateTime(duesData.header.disbursalDate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Loan End Date
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {duesData.header.loanEndDate ? formatDateTime(duesData.header.loanEndDate) : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Total Dues
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {duesData.header.totalDues}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Interest Amount
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {formatLegacyNumber(duesData.header.interestAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    Total Amount
                  </p>
                  <p className="text-lg font-bold text-foreground dark:text-white mt-1">
                    {formatLegacyNumber(duesData.header.totalAmount)}
                  </p>
                </div>
                {duesData.header.isDead && duesData.header.deathMarking && (
                  <div className="col-span-2 md:col-span-4 mt-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider mb-3">
                      ⚠ Death Marking
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-red-500 dark:text-red-400">Deceased Person</p>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {duesData.header.deathMarking.deceasedPersonType}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-500 dark:text-red-400">Name</p>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {duesData.header.deathMarking.deceasedPersonName}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-500 dark:text-red-400">Death Date</p>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {formatDate(duesData.header.deathMarking.deathDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-500 dark:text-red-400">Place of Death</p>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {duesData.header.deathMarking.placeOfDeath}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-500 dark:text-red-400">Death Reason</p>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {duesData.header.deathMarking.deathReason}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-500 dark:text-red-400">Demand Required</p>
                        <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {duesData.header.deathMarking.demandRequired ? 'Yes' : 'No'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Ledger Table — full wide format */}
          <Card className="border-0 shadow-xl ring-1 ring-slate-200 dark:ring-sidebar-accent overflow-hidden print:shadow-none print:ring-1 print:ring-slate-300">
            <div className="overflow-x-auto print:overflow-visible">
              <table className="min-w-max w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-brand-green-tint dark:bg-sidebar-accent/80 border-b border-primary/20">
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Due Date</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Due No</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Date Of Payment</th>
                    <th colSpan={3} className="border border-primary/20 px-2 py-1.5 text-center font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30">EMI Amount</th>
                    {loanAdvanceEnabled && (
                      <th colSpan={2} className="border border-primary/20 px-2 py-1.5 text-center font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">Loan Advance</th>
                    )}
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-amber-700 dark:text-amber-400 text-center">Arrear Amt</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Due Receive</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-red-600 dark:text-red-400 text-center">Penalty</th>
                    <th colSpan={3} className="border border-primary/20 px-2 py-1.5 text-center font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30">EMI Received</th>
                    <th colSpan={2} className="border border-primary/20 px-2 py-1.5 text-center font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30">Amount Received</th>
                    {loanAdvanceEnabled && (
                      <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-emerald-700 dark:text-emerald-400 text-center">Loan Adv Recd</th>
                    )}
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-foreground dark:text-white text-center">Loan Balance</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Group Officer</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Collected By</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-sidebar-accent dark:text-slate-200 text-center">Funder</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-amber-600 dark:text-amber-400 text-center">Arrear Receive</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 text-center print:hidden">Revert</th>
                    <th rowSpan={2} className="border border-primary/20 px-2 py-2 whitespace-nowrap font-bold text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/20 text-center print:hidden">Approve</th>
                  </tr>
                  <tr className="bg-green-50 dark:bg-sidebar-accent/60">
                    <th className="border border-primary/20 px-2 py-1 font-medium text-blue-600 dark:text-blue-400 text-center bg-blue-50 dark:bg-blue-950/20">Pri</th>
                    <th className="border border-primary/20 px-2 py-1 font-medium text-blue-600 dark:text-blue-400 text-center bg-blue-50 dark:bg-blue-950/20">Int</th>
                    <th className="border border-primary/20 px-2 py-1 font-medium text-blue-600 dark:text-blue-400 text-center bg-blue-50 dark:bg-blue-950/20">Total</th>
                    {loanAdvanceEnabled && (
                      <>
                        <th className="border border-primary/20 px-2 py-1 font-medium text-emerald-600 dark:text-emerald-400 text-center bg-emerald-50 dark:bg-emerald-950/20">Adv Amt</th>
                        <th className="border border-primary/20 px-2 py-1 font-medium text-emerald-600 dark:text-emerald-400 text-center bg-emerald-50 dark:bg-emerald-950/20">Total Amt</th>
                      </>
                    )}
                    <th className="border border-primary/20 px-2 py-1 font-medium text-orange-600 dark:text-orange-400 text-center bg-orange-50 dark:bg-orange-950/20">Pen P</th>
                    <th className="border border-primary/20 px-2 py-1 font-medium text-orange-600 dark:text-orange-400 text-center bg-orange-50 dark:bg-orange-950/20">Pen I</th>
                    <th className="border border-primary/20 px-2 py-1 font-medium text-orange-600 dark:text-orange-400 text-center bg-orange-50 dark:bg-orange-950/20">Pen T</th>
                    <th className="border border-primary/20 px-2 py-1 font-medium text-green-600 dark:text-green-400 text-center bg-green-50 dark:bg-green-950/20">Amount</th>
                    <th className="border border-primary/20 px-2 py-1 font-medium text-green-600 dark:text-green-400 text-center bg-green-50 dark:bg-green-950/20">Paid Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {duesData.rows.map((r) => {
                    const isPaid = r.collectedAmount > 0;
                    const canRevert = isPaid && r.transactionDbId && (isAdmin || !r.isEodLocked);
                    const canApprove = isPaid && !r.isEodLocked && isBM && r.transactionStatus === 'PENDING' && r.collectionBatchId;
                    return (
                      <tr
                        key={r.dueNo}
                        className={`border-b border-slate-100 dark:border-sidebar-accent hover:bg-green-50/50 dark:hover:bg-sidebar-accent/30 ${isPaid ? 'bg-green-50/30 dark:bg-green-950/10' : ''}`}
                      >
                        <td className="border border-primary/10 px-2 py-1.5 whitespace-nowrap text-center">{formatDate(r.dueDate)}</td>
                        <td className="border border-primary/10 px-2 py-1.5 text-center font-semibold text-sidebar-accent dark:text-slate-200">{r.dueNo}</td>
                        <td className="border border-primary/10 px-2 py-1.5 whitespace-nowrap text-center text-slate-600 dark:text-slate-400">
                          {r.collectionDate ? formatDateTime(r.collectionDate) : '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums">{formatLegacyNumber(r.duePrincipal)}</td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums">{formatLegacyNumber(r.dueInterest)}</td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums font-medium text-sidebar-accent dark:text-primary">{formatLegacyNumber(r.dueAmount)}</td>
                        {loanAdvanceEnabled && (
                          <>
                            <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.dueSavings > 0 ? formatLegacyNumber(r.dueSavings) : '—'}</td>
                            <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">—</td>
                          </>
                        )}
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                          {r.arrearTotal > 0 ? formatLegacyNumber(r.arrearTotal) : '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums">{formatLegacyNumber(r.dueAmount)}</td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">
                          {r.collectedPenalty > 0 ? formatLegacyNumber(r.collectedPenalty) : '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-orange-600 dark:text-orange-400">0</td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-orange-600 dark:text-orange-400">0</td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-orange-600 dark:text-orange-400">
                          {r.collectedPenalty > 0 ? formatLegacyNumber(r.collectedPenalty) : '0'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums font-medium text-green-700 dark:text-green-400">
                          {isPaid ? formatLegacyNumber(r.collectedAmount) : '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums font-medium text-green-700 dark:text-green-400">
                          {isPaid ? formatLegacyNumber(r.collectedAmount) : '—'}
                        </td>
                        {loanAdvanceEnabled && (
                          <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {r.collectedSavings > 0 ? formatLegacyNumber(r.collectedSavings) : '—'}
                          </td>
                        )}
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums font-bold text-foreground dark:text-white">
                          {formatLegacyNumber(r.dueBalance)}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 whitespace-nowrap text-sidebar-accent dark:text-slate-300">
                          {duesData.header.groupOfficerName ?? '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 whitespace-nowrap text-sidebar-accent dark:text-slate-300">
                          {r.collectedByName ?? '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 whitespace-nowrap text-sidebar-accent dark:text-slate-300">
                          {duesData.header.funderName ?? '—'}
                        </td>
                        <td className="border border-primary/10 px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                          {r.arrearTotal > 0 ? formatLegacyNumber(r.arrearTotal) : '0'}
                        </td>
                        {/* Revert */}
                        <td className="border border-primary/10 px-2 py-1.5 text-center print:hidden">
                          {isPaid && r.transactionDbId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] gap-1 border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20"
                              disabled={!canRevert}
                              onClick={() => canRevert && setRevertDialog({ open: true, row: r })}
                              title={!canRevert ? 'EOD Done — only Admin can revert' : 'Revert transaction'}
                            >
                              <RotateCcwIcon className="h-3 w-3" />
                              Revert
                            </Button>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        {/* Approve */}
                        <td className="border border-primary/10 px-2 py-1.5 text-center print:hidden">
                          {isPaid ? (
                            r.isEodLocked ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 whitespace-nowrap">
                                EOD Done
                              </span>
                            ) : r.transactionStatus === 'APPROVED' ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                Approved
                              </span>
                            ) : canApprove ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] gap-1 border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/20"
                                onClick={() => setApproveDialog({ open: true, batchId: r.collectionBatchId! })}
                              >
                                <CheckCircle className="h-3 w-3" />
                                Approve
                              </Button>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400 whitespace-nowrap">
                                Pending
                              </span>
                            )
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-green-50/80 dark:bg-brand-green-darker/60 border-t-2 border-primary/30">
                    <td colSpan={3} className="px-2 py-2 font-bold text-foreground dark:text-white">Total</td>
                    <td className="px-2 py-2 text-right font-bold">{formatLegacyNumber(duesData.totals.duePrincipal)}</td>
                    <td className="px-2 py-2 text-right font-bold">{formatLegacyNumber(duesData.totals.dueInterest)}</td>
                    <td className="px-2 py-2 text-right font-bold">{formatLegacyNumber(duesData.totals.dueAmount)}</td>
                    {loanAdvanceEnabled && (
                      <>
                        <td className="px-2 py-2 text-right font-bold text-emerald-700">{formatLegacyNumber(duesData.totals.dueSavings)}</td>
                        <td className="px-2 py-2"></td>
                      </>
                    )}
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2 text-right font-bold text-green-700">{formatLegacyNumber(duesData.totals.collectedAmount)}</td>
                    <td className="px-2 py-2 text-right font-bold text-green-700">{formatLegacyNumber(duesData.totals.collectedAmount)}</td>
                    {loanAdvanceEnabled && (
                      <td className="px-2 py-2 text-right font-bold text-emerald-700">{formatLegacyNumber(duesData.totals.collectedSavings)}</td>
                    )}
                    <td className="px-2 py-2 text-right font-bold text-foreground dark:text-white">{formatLegacyNumber(duesData.totals.dueBalance)}</td>
                    <td colSpan={6} className="px-2 py-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Print Footer */}
          <div className="hidden print:flex justify-between mt-12 pt-8 border-t border-primary/30">
            <div className="text-center">
              <div className="w-48 border-b-2 border-slate-400 mb-2"></div>
              <p className="text-sm font-semibold text-sidebar-accent">
                Client Signature
              </p>
            </div>
            <div className="text-center">
              <div className="w-48 border-b-2 border-slate-400 mb-2"></div>
              <p className="text-sm font-semibold text-sidebar-accent">
                Branch Manager / Authorised Signatory
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Premium Styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: landscape;
                margin: 10mm;
              }
              /* Hide everything else and standard UI chrome */
              body {
                background-color: white !important;
                -webkit-print-color-adjust: exact;
              }
              nav, header, footer, aside, .print\\:hidden, .hidden-print {
                display: none !important;
              }
              .print\\:block {
                display: block !important;
              }
              .print\\:flex {
                display: flex !important;
              }
              .print\\:m-0 {
                margin: 0 !important;
              }
              .print\\:p-0 {
                padding: 0 !important;
              }
              /* For accurate table printing */
              table {
                page-break-inside: auto;
                width: 100% !important;
                border-collapse: collapse !important;
              }
              tr {
                page-break-inside: avoid;
                page-break-after: auto;
              }
              thead {
                display: table-header-group;
              }
              tfoot {
                display: table-footer-group;
              }
              /* Ensure text visibility */
              .text-foreground {
                color: #0f172a !important;
              }
              .text-slate-500 {
                color: #64748b !important;
              }
              .bg-primary {
                background-color: #2563eb !important;
                color: white !important;
              }
            }
          `,
        }}
      />

      {/* Revert Dialog */}
      <Dialog open={revertDialog.open} onOpenChange={(v) => { if (!v) { setRevertDialog({ open: false, row: null }); setRevertLocation(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <RotateCcwIcon className="h-5 w-5" />
              Revert Transaction
            </DialogTitle>
          </DialogHeader>
          {revertDialog.row && (
            <div className="space-y-3 py-2 text-sm">
              <p className="text-muted-foreground">Are you sure you want to reverse this transaction?</p>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due No:</span>
                  <span className="font-medium">{revertDialog.row.dueNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due Date:</span>
                  <span className="font-medium">{formatDate(revertDialog.row.dueDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collection Date:</span>
                  <span className="font-medium">{formatDateTime(revertDialog.row.collectionDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Paid:</span>
                  <span className="font-semibold text-red-600">₹{formatLegacyNumber(revertDialog.row.collectedAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collected By:</span>
                  <span className="font-medium">{revertDialog.row.collectedByName ?? '—'}</span>
                </div>
              </div>
              <p className="text-xs text-red-600 dark:text-red-400">
                This will permanently reverse the payment and restore the schedule to unpaid status.
              </p>
            </div>
          )}
          {revertDialog.open && (
            <RevertLocationPicker value={revertLocation} onChange={setRevertLocation} disabled={actionLoading} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevertDialog({ open: false, row: null })} disabled={actionLoading}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={actionLoading || !revertLocation}
              onClick={() => revertDialog.row && handleRevert(revertDialog.row)}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcwIcon className="h-4 w-4 mr-2" />}
              Confirm Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={approveDialog.open} onOpenChange={(v) => !v && setApproveDialog({ open: false, batchId: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              Approve Collection
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Approve this collection batch? All pending transactions in this batch will be approved.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog({ open: false, batchId: null })} disabled={actionLoading}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={actionLoading || !approveDialog.batchId}
              onClick={() => approveDialog.batchId && handleApprove(approveDialog.batchId)}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}