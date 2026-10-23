"use client";

import { useState, useEffect, useCallback } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useBrandNames, getBrandNamesGlobal } from "@/app/lib/brand-context";
import {
  RefreshCw,
  Loader2,
  FileText,
  FileSpreadsheet,
  FileType,
  FileOutput,
  TrendingUp,
  TrendingDown,
  Wallet,
  Building2,
  User,
  Calendar,
  Download,
  AlertCircle,
  BadgeCheck,
} from "lucide-react";
import * as XLSX from "xlsx-js-style";
import { jsPDF } from "jspdf";
import { apiClient } from "@/app/lib/api-client";
import { branchStorage } from "@/app/lib/branch-storage";
import { tokenStorage } from "@/app/lib/token-storage";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { drawPayslipReport } from "@/app/lib/reports/payslip-pdf";
import { reportHeaderRows, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { exportToCSV, exportToWord, type WordExportOptions } from "@/app/lib/report-export-utils";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { usePermission } from "@/app/hooks/usePermission";
import { formatReportAmount, truncateReportAmount } from "@/app/lib/utils/format-amount";
import { toDisplayDate } from '@/app/lib/date-format';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BranchOption = { id: string; name: string; code: string };
type Center = { id: string; name: string; code: string };
type Employee = {
  id: string;
  name: string;
  employeeId?: string;
  role?: string;
};

type SalaryLineItem = {
  name: string;
  type: "EARNINGS" | "DEDUCTIONS";
  amount: number;
};

type PayslipData = {
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  branchName: string;
  branchCode: string;
  month: number;
  year: number;
  paymentType: string;
  status: string;
  paidOn: string;
  components: SalaryLineItem[];
  totalEarnings: number;
  totalDeductions: number;
  netPayable: number;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const CURRENT_YEAR = new Date().getFullYear();

const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => {
  const y = CURRENT_YEAR - i;
  return { value: String(y), label: String(y) };
});

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const fmt = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.trunc(v));

const fmtRaw = (v: number) => formatReportAmount(v);

// ─── PDF HTML Template ──────────────────────────────────────────────────────────

function buildPayslipHTML(d: PayslipData): string {
  const { companyNameShort } = getBrandNamesGlobal();
  const earnings = d.components.filter((c) => c.type === "EARNINGS");
  const deductions = d.components.filter((c) => c.type === "DEDUCTIONS");
  const maxRows = Math.max(earnings.length, deductions.length, 1);

  const bodyRows = Array.from({ length: maxRows }, (_, i) => {
    const e = earnings[i];
    const ded = deductions[i];
    return `
            <tr>
                <td class="item">${e ? e.name : ""}</td>
                <td class="amt">${e ? "&#8377;&nbsp;" + fmtRaw(e.amount) : ""}</td>
                <td class="item bdr">${ded ? ded.name : ""}</td>
                <td class="amt">${ded ? "&#8377;&nbsp;" + fmtRaw(ded.amount) : ""}</td>
            </tr>`;
  }).join("");

  const paidDate = d.paidOn
    ? toDisplayDate(new Date(d.paidOn))
    : "N/A";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
  <title>Payslip – ${d.employeeName} – ${MONTH_NAMES[d.month]} ${d.year}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;color:#0f172a;background:#fff;font-size:10.5pt}
    @page{size:A4;margin:18mm}
    /* === HEADER === */
    .hdr{display:flex;align-items:center;justify-content:space-between;
         background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#4f46e5 100%);
         padding:18px 24px;border-radius:8px 8px 0 0;color:#fff}
    .logo-wrap{display:flex;align-items:center;gap:14px}
    .logo-circle{width:50px;height:50px;background:rgba(255,255,255,.18);
                 border:2px solid rgba(255,255,255,.35);border-radius:50%;
                 display:flex;align-items:center;justify-content:center;
                 font-size:21px;font-weight:800;letter-spacing:-.5px}
    .co-name{font-size:19px;font-weight:800;letter-spacing:-.4px}
    .co-sub{font-size:9.5px;color:rgba(255,255,255,.72);
            margin-top:3px;text-transform:uppercase;letter-spacing:1px}
    .hdr-right{text-align:right}
    .hdr-right h2{font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
    .hdr-right p{font-size:10px;color:rgba(255,255,255,.78);margin-top:4px}
    /* === INFO GRID === */
    .info-grid{display:grid;grid-template-columns:1fr 1fr;
               border:1px solid #e2e8f0;border-top:none;background:#f8fafc}
    .info-col{padding:13px 20px}
    .info-col:first-child{border-right:1px solid #e2e8f0}
    .info-row{display:flex;gap:8px;margin-bottom:5px;align-items:baseline}
    .lbl{font-size:9.5px;font-weight:600;color:#64748b;text-transform:uppercase;
         letter-spacing:.4px;min-width:112px}
    .val{font-size:10.5px;font-weight:600;color:#1e293b}
    /* === TABLE === */
    .sec-hdr{background:#1e3a8a;color:#fff;font-size:10px;font-weight:700;
             padding:7px 20px;text-transform:uppercase;letter-spacing:.8px;
             border:1px solid #1e3a8a;border-top:none}
    table{width:100%;border-collapse:collapse;
          border:1px solid #e2e8f0;border-top:none}
    thead th{background:#f1f5f9;font-size:9.5px;font-weight:700;
             text-transform:uppercase;letter-spacing:.5px;padding:7px 14px;
             border-bottom:2px solid #e2e8f0}
    .th-e{color:#059669}.th-d{color:#dc2626}
    tbody tr:nth-child(even) td{background:#f9fafb}
    td{padding:6.5px 14px;font-size:10.5px;border-bottom:1px solid #f1f5f9}
    .item{color:#334155}
    .amt{text-align:right;font-weight:600;color:#1e293b}
    .bdr{border-left:1px solid #e2e8f0}
    .total-row td{background:#f1f5f9!important;border-top:2px solid #cbd5e1;
                  font-weight:700;font-size:11px;padding:9px 14px}
    .te{color:#059669;text-align:right}
    .td{color:#dc2626;text-align:right}
    /* === NET PAY === */
    .net{display:flex;align-items:center;justify-content:space-between;
         background:linear-gradient(135deg,#1e3a8a 0%,#4f46e5 100%);
         padding:14px 24px;color:#fff;border-radius:0 0 8px 8px;
         margin-top:0;border-top:none}
    .net-label{font-size:12px;font-weight:600}
    .net-sub{font-size:9px;opacity:.75;margin-top:3px}
    .net-amt{font-size:22px;font-weight:800;text-align:right}
    /* === FOOTER === */
    .sigs{display:flex;justify-content:space-between;margin-top:28px;
          padding-top:14px;border-top:1px dashed #cbd5e1}
    .sig{text-align:center}
    .sig-line{width:150px;border-top:1px solid #334155;margin-bottom:6px}
    .sig-lbl{font-size:9px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.4px}
    .note{font-size:8.5px;color:#94a3b8;margin-top:16px;text-align:center;
          border-top:1px solid #f1f5f9;padding-top:10px}
    .badge{display:inline-block;background:#dcfce7;color:#166534;
           border:1px solid #86efac;font-size:9px;font-weight:700;
           padding:2px 8px;border-radius:99px;text-transform:uppercase}
  </style>
</head>
<body>
  <!-- Header -->
  <div class="hdr">
    <div class="logo-wrap">
      <div class="logo-circle">${companyNameShort}</div>
      <div>
        <div class="co-name">${companyNameShort} Microfinance</div>
        <div class="co-sub">Premium Financial Inclusion Program</div>
      </div>
    </div>
    <div class="hdr-right">
      <h2>Salary Payslip</h2>
      <p>${MONTH_NAMES[d.month]} ${d.year} &nbsp;|&nbsp; <span class="badge">${d.status}</span></p>
    </div>
  </div>

  <!-- Employee Info -->
  <div class="info-grid">
    <div class="info-col">
      <div class="info-row"><span class="lbl">Employee Name</span><span class="val">${d.employeeName}</span></div>
      <div class="info-row"><span class="lbl">Employee Code</span><span class="val">${d.employeeCode}</span></div>
      <div class="info-row"><span class="lbl">Designation</span><span class="val">${d.designation}</span></div>
      <div class="info-row"><span class="lbl">Department</span><span class="val">${d.department}</span></div>
    </div>
    <div class="info-col">
      <div class="info-row"><span class="lbl">Branch</span><span class="val">${d.branchName} (${d.branchCode})</span></div>
      <div class="info-row"><span class="lbl">Pay Period</span><span class="val">${MONTH_NAMES[d.month]} ${d.year}</span></div>
      <div class="info-row"><span class="lbl">Payment Mode</span><span class="val">${d.paymentType}</span></div>
      <div class="info-row"><span class="lbl">Paid On</span><span class="val">${paidDate}</span></div>
    </div>
  </div>

  <!-- Salary Table -->
  <div class="sec-hdr">Earnings &amp; Deductions</div>
  <table>
    <thead>
      <tr>
        <th class="th-e">Earnings</th>
        <th class="th-e" style="text-align:right">Amount (&#8377;)</th>
        <th class="th-d bdr">Deductions</th>
        <th class="th-d" style="text-align:right">Amount (&#8377;)</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total-row">
        <td>Total Earnings</td>
        <td class="te">&#8377;&nbsp;${fmtRaw(d.totalEarnings)}</td>
        <td class="bdr">Total Deductions</td>
        <td class="td">&#8377;&nbsp;${fmtRaw(d.totalDeductions)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Net Pay -->
  <div class="net">
    <div>
      <div class="net-label">Net Salary Payable</div>
      <div class="net-sub">Total Earnings &#8722; Total Deductions</div>
    </div>
    <div class="net-amt">&#8377;&nbsp;${fmtRaw(d.netPayable)}</div>
  </div>

  <!-- Signatures -->
  <div class="sigs">
    <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Employee Signature</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Prepared By</div></div>
    <div class="sig"><div class="sig-line"></div><div class="sig-lbl">Authorized Signatory</div></div>
  </div>
  <div class="note">
    This is a computer-generated payslip and does not require a physical signature.&ensp;|&ensp;${companyNameShort} Microfinance – Confidential
  </div>
</body>
</html>`;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function PayslipClient() {
  const { toast } = useToast();
  const { companyNameShort, companyNameFull } = useBrandNames();
  const { canExportReport, getReportExportMode } = usePermission();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [centers, setCenters] = useState<Center[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedCenter, setSelectedCenter] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(
    String(new Date().getMonth() + 1),
  );
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));

  // Submitted snapshot — updated only when "Generate Payslip" succeeds.
  // exportParams reads these, not the live draft state above.
  const [submittedBranch, setSubmittedBranch] = useState(selectedBranch);
  const [submittedEmployee, setSubmittedEmployee] = useState(selectedEmployee);
  const [submittedMonth, setSubmittedMonth] = useState(selectedMonth);
  const [submittedYear, setSubmittedYear] = useState(selectedYear);

  // ── Loading & UI state ────────────────────────────────────────────────────
  const [isLoadingCenters, setIsLoadingCenters] = useState(true);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Payslip data ──────────────────────────────────────────────────────────
  const [payslipData, setPayslipData] = useState<PayslipData | null>(null);
  const [showPayslip, setShowPayslip] = useState(false);

  // ── Fetch branches on mount, default to the caller's active/own branch.
  //    AREA_MANAGER's list is scoped to their assigned branches. ────────────
  useEffect(() => {
    const storedUser = tokenStorage.getUser();
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        let list: BranchOption[] = Array.isArray(d) ? d : (d.data ?? []);
        if (storedUser?.role === "AREA_MANAGER") {
          const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
          if (assignedBranchIds.length > 0) {
            list = list.filter((b) => assignedBranchIds.includes(b.id));
          }
        }
        setBranches(list);
      })
      .catch(() => {});

    const activeBranch = branchStorage.getActiveBranch();
    const defaultBranchId = activeBranch?.id || storedUser?.branchId;
    if (defaultBranchId) {
      setSelectedBranch(defaultBranchId);
    }
  }, []);

  // ── Fetch centers whenever the selected branch changes ────────────────────
  useEffect(() => {
    if (!selectedBranch) {
      setCenters([]);
      return;
    }

    const fetchCenters = async () => {
      setIsLoadingCenters(true);
      setSelectedCenter("");
      try {
        const result = await apiClient.get<Center[]>(
          `/centers?branchId=${selectedBranch}&includeInactive=false`,
        );
        if (result.success && result.data) {
          setCenters(result.data);
        } else {
          toast({
            title: "Error",
            description: result.error ?? "Failed to load centers.",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Error",
          description: "Could not connect to server.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingCenters(false);
      }
    };
    fetchCenters();
  }, [selectedBranch, toast]);

  // ── Fetch employees when center changes ───────────────────────────────────
  // NOTE: employees in this schema are branch-scoped (not center-scoped).
  // The center dropdown acts as a visual grouping filter but all branch employees are loaded.
  useEffect(() => {
    if (!selectedCenter) {
      setEmployees([]);
      setSelectedEmployee("");
      return;
    }

    const fetchEmployees = async () => {
      setIsLoadingEmployees(true);
      setSelectedEmployee("");
      setShowPayslip(false);
      setPayslipData(null);
      setErrorMsg(null);
      try {
        const result = await apiClient.get<Employee[]>(
          `/employees?branchScoped=true&branchId=${selectedBranch}`,
        );
        if (result.success && result.data) {
          setEmployees(result.data);
        } else {
          toast({
            title: "Error",
            description: result.error ?? "Failed to load employees.",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Error",
          description: "Could not load employees.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    fetchEmployees();
  }, [selectedCenter, selectedBranch, toast]);

  // ── Generate payslip ──────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!selectedCenter) {
      toast({
        title: "Center Required",
        description: "Please select a centre.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedEmployee) {
      toast({
        title: "Employee Required",
        description: "Please select an employee.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedMonth || !selectedYear) {
      toast({
        title: "Period Required",
        description: "Please select month and year.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setShowPayslip(false);
    setPayslipData(null);
    setErrorMsg(null);

    try {
      const url = `/payroll/payslip?employeeId=${selectedEmployee}&month=${selectedMonth}&year=${selectedYear}`;
      const result = await apiClient.get<PayslipData>(url);

      if (result.success && result.data) {
        setPayslipData(result.data);
        setShowPayslip(true);
        setSubmittedBranch(selectedBranch);
        setSubmittedEmployee(selectedEmployee);
        setSubmittedMonth(selectedMonth);
        setSubmittedYear(selectedYear);
        toast({
          title: "Payslip Generated",
          description: `Payslip for ${MONTH_NAMES[parseInt(selectedMonth)]} ${selectedYear} loaded.`,
        });
      } else {
        // Surface the server-side "not found" error clearly
        const msg =
          result.error ?? "No payslip record found for the selected period.";
        setErrorMsg(msg);
        toast({
          title: "No Record Found",
          description: msg,
          variant: "destructive",
        });
      }
    } catch {
      const msg = "Failed to connect to server. Please try again.";
      setErrorMsg(msg);
      toast({
        title: "Connection Error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [selectedBranch, selectedCenter, selectedEmployee, selectedMonth, selectedYear, toast]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = () => {
    const activeBranch = branchStorage.getActiveBranch();
    const storedUser = tokenStorage.getUser();
    const resetBranch = activeBranch?.id || storedUser?.branchId || "";
    const resetMonth = String(new Date().getMonth() + 1);
    const resetYear = String(CURRENT_YEAR);
    setSelectedBranch(resetBranch);
    setSelectedCenter("");
    setSelectedEmployee("");
    setSelectedMonth(resetMonth);
    setSelectedYear(resetYear);
    setSubmittedBranch(resetBranch);
    setSubmittedEmployee("");
    setSubmittedMonth(resetMonth);
    setSubmittedYear(resetYear);
    setShowPayslip(false);
    setPayslipData(null);
    setErrorMsg(null);
    setEmployees([]);
    toast({ title: "Form Reset", description: "All selections cleared." });
  };

  // ── PDF direct download (jsPDF) ───────────────────────────────────────────
  const handleExportPDF = async () => {
    if (!payslipData) return;

    const data = payslipData;

    try {
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });
      const reportFont = await ensureReportFont(doc);
      await drawPayslipReport(doc, data, companyNameFull, reportFont);

      // ── Save ────────────────────────────────────────────────────────
      const fileName = `Payslip_${data.employeeName.replace(/\s+/g, "_")}_${MONTH_NAMES[data.month]}_${data.year}.pdf`;
      doc.save(fileName);

      toast({ title: "PDF Downloaded", description: `Saved as ${fileName}` });
    } catch (err: unknown) {
      console.error("[Payslip PDF] Error:", err);
      toast({
        title: "Export Failed",
        description: "Could not generate PDF. Please try again.",
        variant: "destructive",
      });
    }
  };

  // ── Excel export ──────────────────────────────────────────────────────────
  const handleExportExcel = () => {
    if (!payslipData) return;
    setIsExportingExcel(true);

    try {
      const data = payslipData;
      const earnings = data.components.filter((c) => c.type === "EARNINGS");
      const deductions = data.components.filter((c) => c.type === "DEDUCTIONS");
      const maxRows = Math.max(earnings.length, deductions.length);

      const paidDate = data.paidOn
        ? toDisplayDate(new Date(data.paidOn))
        : "N/A";

      const rows: (string | number)[][] = [
        ...reportHeaderRows("Salary Payslip"),
        [
          "Employee Name",
          data.employeeName,
          "",
          "Branch",
          `${data.branchName} (${data.branchCode})`,
        ],
        [
          "Employee Code",
          data.employeeCode,
          "",
          "Pay Period",
          `${MONTH_NAMES[data.month]} ${data.year}`,
        ],
        ["Designation", data.designation, "", "Payment Mode", data.paymentType],
        ["Department", data.department, "", "Paid On", paidDate],
        ["Status", data.status, "", "", ""],
        [],
        ["EARNINGS", "Amount (INR)", "", "DEDUCTIONS", "Amount (INR)"],
      ];

      for (let i = 0; i < maxRows; i++) {
        rows.push([
          earnings[i]?.name ?? "",
          earnings[i] ? truncateReportAmount(earnings[i].amount) : "",
          "",
          deductions[i]?.name ?? "",
          deductions[i] ? truncateReportAmount(deductions[i].amount) : "",
        ]);
      }

      rows.push([]);
      rows.push([
        "Total Earnings",
        truncateReportAmount(data.totalEarnings),
        "",
        "Total Deductions",
        truncateReportAmount(data.totalDeductions),
      ]);
      rows.push([]);
      rows.push(["NET SALARY PAYABLE", truncateReportAmount(data.netPayable), "", "", ""]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 22 },
        { wch: 16 },
        { wch: 2 },
        { wch: 22 },
        { wch: 16 },
      ];
      applyExcelReportFont(ws);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payslip");

      const fileName = `Payslip_${data.employeeName.replace(/\s+/g, "_")}_${MONTH_NAMES[data.month]}_${data.year}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast({
        title: "Export Successful",
        description: `File saved as ${fileName}`,
      });
    } catch {
      toast({
        title: "Export Failed",
        description: "Could not generate Excel file.",
        variant: "destructive",
      });
    } finally {
      setIsExportingExcel(false);
    }
  };

  // ── CSV / Word export (mirrors the same field mapping used by handleExportExcel
  // above, kept separate so handleExportExcel is left untouched) ────────────────

  const buildPayslipExportRows = (data: PayslipData): { headers: string[]; rows: (string | number)[][] } => {
    const earnings = data.components.filter((c) => c.type === "EARNINGS");
    const deductions = data.components.filter((c) => c.type === "DEDUCTIONS");
    const maxRows = Math.max(earnings.length, deductions.length);

    const paidDate = data.paidOn
      ? toDisplayDate(new Date(data.paidOn))
      : "N/A";

    const headers = ["Field", "Value", "", "Field", "Value"];
    const rows: (string | number)[][] = [
      ["Employee Name", data.employeeName, "", "Branch", `${data.branchName} (${data.branchCode})`],
      ["Employee Code", data.employeeCode, "", "Pay Period", `${MONTH_NAMES[data.month]} ${data.year}`],
      ["Designation", data.designation, "", "Payment Mode", data.paymentType],
      ["Department", data.department, "", "Paid On", paidDate],
      ["Status", data.status, "", "", ""],
      ["", "", "", "", ""],
      ["EARNINGS", "Amount (INR)", "", "DEDUCTIONS", "Amount (INR)"],
    ];

    for (let i = 0; i < maxRows; i++) {
      rows.push([
        earnings[i]?.name ?? "",
        earnings[i] ? formatReportAmount(earnings[i].amount) : "",
        "",
        deductions[i]?.name ?? "",
        deductions[i] ? formatReportAmount(deductions[i].amount) : "",
      ]);
    }

    rows.push(["", "", "", "", ""]);
    rows.push(["Total Earnings", formatReportAmount(data.totalEarnings), "", "Total Deductions", formatReportAmount(data.totalDeductions)]);
    rows.push(["", "", "", "", ""]);
    rows.push(["NET SALARY PAYABLE", formatReportAmount(data.netPayable), "", "", ""]);

    return { headers, rows };
  };

  const handleExportCSV = () => {
    if (!payslipData) return;
    const { headers, rows } = buildPayslipExportRows(payslipData);
    exportToCSV(
      `Payslip_${payslipData.employeeName.replace(/\s+/g, "_")}_${MONTH_NAMES[payslipData.month]}_${payslipData.year}`,
      "SALARY PAYSLIP",
      headers,
      rows
    );
    toast({ title: "CSV Exported", description: "File downloaded successfully." });
  };

  // Word-only presentation: same label/value rows as CSV above, but the trailing
  // "NET SALARY PAYABLE" row is split off for distinct styling. No grouped headers —
  // this is a single-record form (Field/Value pairs), not a record grid.
  const buildPayslipWordOptions = (
    rows: (string | number)[][]
  ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
    bodyRows: rows.slice(0, -1),
    options: {
      columnAlignments: ["left", "right", "center", "left", "right"],
      columnWidthWeights: [7, 5, 1, 7, 5],
      totalsRow: rows[rows.length - 1],
    },
  });

  const handleExportWord = async () => {
    if (!payslipData) return;
    const { headers, rows } = buildPayslipExportRows(payslipData);
    const { bodyRows, options } = buildPayslipWordOptions(rows);
    await exportToWord(
      `Payslip_${payslipData.employeeName.replace(/\s+/g, "_")}_${MONTH_NAMES[payslipData.month]}_${payslipData.year}`,
      "SALARY PAYSLIP",
      headers,
      bodyRows,
      options
    );
    toast({ title: "Word Exported", description: "File downloaded successfully." });
  };

  // ── Derived  ──────────────────────────────────────────────────────────────
  const earnings =
    payslipData?.components.filter((c) => c.type === "EARNINGS") ?? [];
  const deductions =
    payslipData?.components.filter((c) => c.type === "DEDUCTIONS") ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Filter Card ─────────────────────────────────────────────── */}
      <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-primary via-primary to-purple-600 px-6 py-4">
          <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Employee Payslip Generator
          </CardTitle>
          <p className="text-green-100 text-sm mt-1">
            Select Centre, Employee and pay period, then click{" "}
            <strong>Generate</strong>.
          </p>
        </CardHeader>

        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
            {/* Branch */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Branch <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="h-11 bg-white dark:bg-sidebar-accent">
                  <SelectValue placeholder="— Select Branch —" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code} - {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Centre */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Centre <span className="text-red-500">*</span>
              </Label>
              <Select
                value={selectedCenter}
                onValueChange={setSelectedCenter}
                disabled={!selectedBranch || isLoadingCenters}
              >
                <SelectTrigger className="h-11 bg-white dark:bg-sidebar-accent">
                  <SelectValue
                    placeholder={
                      isLoadingCenters ? "Loading…" : "— Select Centre —"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {centers.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No centres found
                    </SelectItem>
                  ) : (
                    centers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} – {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Employee */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-primary" />
                Employee <span className="text-red-500">*</span>
              </Label>
              <Select
                value={selectedEmployee}
                onValueChange={setSelectedEmployee}
                disabled={!selectedCenter || isLoadingEmployees}
              >
                <SelectTrigger className="h-11 bg-white dark:bg-sidebar-accent">
                  <SelectValue
                    placeholder={
                      isLoadingEmployees
                        ? "Loading…"
                        : !selectedCenter
                          ? "Select centre first"
                          : "— Select Employee —"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {employees.length === 0 && !isLoadingEmployees ? (
                    <SelectItem value="__none__" disabled>
                      No employees found
                    </SelectItem>
                  ) : (
                    employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Month */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-purple-500" />
                Month <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="h-11 bg-white dark:bg-sidebar-accent">
                  <SelectValue placeholder="— Select Month —" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Year */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-emerald-500" />
                Year <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="h-11 bg-white dark:bg-sidebar-accent">
                  <SelectValue placeholder="— Select Year —" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y.value} value={y.value}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3 mt-6 pt-5 border-t border-slate-100 dark:border-sidebar-accent">
            <Button
              id="btn-generate-payslip"
              onClick={handleGenerate}
              disabled={isGenerating || !selectedCenter || !selectedEmployee}
              className="h-10 px-6 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Payslip
                </>
              )}
            </Button>

            {showPayslip && (
              <>
                <ExportDropdown
                  onExportPDF={handleExportPDF}
                  onExportExcel={handleExportExcel}
                  onExportCSV={handleExportCSV}
                  canExport={canExportReport('payslip')}
                  onExportWord={handleExportWord}
                  reportSlug={getReportExportMode('payslip') === 'REQUEST_QUEUE' ? 'payslip' : undefined}
                  exportParams={{
                    fromDate: null,
                    toDate: null,
                    branchIds: submittedBranch ? [submittedBranch] : 'ALL',
                    filters: { employeeId: submittedEmployee, month: submittedMonth, year: submittedYear },
                  }}
                  className="h-10 px-6 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg"
                />
              </>
            )}

            <Button
              id="btn-reset-payslip"
              onClick={handleReset}
              variant="destructive"
              className="h-10 px-6 shadow-lg ml-auto"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Error Banner ─────────────────────────────────────────────── */}
      {errorMsg && !showPayslip && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              No Payslip Record
            </p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">
              {errorMsg}
            </p>
            <p className="text-xs text-red-500 mt-1">
              Ensure the salary payment has been processed via{" "}
              <strong>Salary Pay</strong> for this period first.
            </p>
          </div>
        </div>
      )}

      {/* ── Metric Cards ─────────────────────────────────────────────── */}
      {showPayslip && payslipData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            title="Total Earnings"
            value={fmt(payslipData.totalEarnings)}
            subtitle={`${earnings.length} earning component${earnings.length !== 1 ? "s" : ""}`}
            icon={TrendingUp}
            gradient="green"
          />
          <MetricCard
            title="Total Deductions"
            value={fmt(payslipData.totalDeductions)}
            subtitle={`${deductions.length} deduction component${deductions.length !== 1 ? "s" : ""}`}
            icon={TrendingDown}
            gradient="rose"
          />
          <MetricCard
            title="Net Salary Payable"
            value={fmt(payslipData.netPayable)}
            subtitle="Earnings − Deductions"
            icon={Wallet}
            gradient="blue"
          />
        </div>
      )}

      {/* ── Payslip Preview ───────────────────────────────────────────── */}
      {showPayslip && payslipData && (
        <Card className="border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
          {/* Accent bar */}
          <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

          {/* Header */}
          <div className="bg-gradient-to-r from-sidebar-accent via-primary to-sidebar-accent px-4 sm:px-8 py-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center">
                  <span className="text-white font-black text-xl tracking-tight">
                    {companyNameShort}
                  </span>
                </div>
                <div>
                  <h3 className="text-white font-bold text-xl">
                    {companyNameShort} Microfinance
                  </h3>
                  <p className="text-green-200 text-xs mt-0.5 uppercase tracking-[0.12em]">
                    Premium Financial Inclusion Program
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white font-bold text-base uppercase tracking-widest">
                  Salary Payslip
                </p>
                <p className="text-green-200 text-sm mt-1">
                  {MONTH_NAMES[payslipData.month]} {payslipData.year}
                </p>
                <span className="inline-block mt-2 bg-green-400/20 border border-green-300/40 text-green-200 text-[10px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
                  <BadgeCheck className="h-3 w-3 inline mr-1" />
                  {payslipData.status}
                </span>
              </div>
            </div>
          </div>

          {/* Employee Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-sidebar-accent bg-green-50/60 dark:bg-brand-green-darker/30">
            {[
              [
                ["Employee Name", payslipData.employeeName],
                ["Employee Code", payslipData.employeeCode],
                ["Designation", payslipData.designation],
                ["Department", payslipData.department],
              ],
              [
                [
                  "Branch",
                  `${payslipData.branchName} (${payslipData.branchCode})`,
                ],
                [
                  "Pay Period",
                  `${MONTH_NAMES[payslipData.month]} ${payslipData.year}`,
                ],
                ["Payment Mode", payslipData.paymentType],
                [
                  "Paid On",
                  payslipData.paidOn
                    ? toDisplayDate(new Date(payslipData.paidOn))
                    : "N/A",
                ],
              ],
            ].map((group, gi) => (
              <div key={gi} className="px-4 sm:px-8 py-5 space-y-3">
                {group.map(([label, val]) => (
                  <div key={label} className="flex items-baseline gap-3">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 w-32 shrink-0">
                      {label}
                    </span>
                    <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Section title */}
          <div className="bg-sidebar-accent dark:bg-green-950 px-4 sm:px-8 py-2.5 border-y border-sidebar-accent">
            <span className="text-[10px] font-bold text-white uppercase tracking-[0.15em]">
              Earnings &amp; Deductions
            </span>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-sidebar-accent bg-green-50 dark:bg-brand-green-darker/40 border-b border-primary/20 dark:border-sidebar-accent">
            <div className="grid grid-cols-2 px-6 py-3">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-600">
                Earnings
              </span>
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-600 text-right">
                Amount (₹)
              </span>
            </div>
            <div className="grid grid-cols-2 px-6 py-3">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-red-600">
                Deductions
              </span>
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-red-600 text-right">
                Amount (₹)
              </span>
            </div>
          </div>

          {/* Data rows */}
          {Array.from(
            { length: Math.max(earnings.length, deductions.length, 1) },
            (_, i) => (
              <div
                key={i}
                className={`grid grid-cols-2 divide-x divide-slate-200 dark:divide-sidebar-accent border-b border-slate-100 dark:border-sidebar-accent ${
                  i % 2 === 0
                    ? "bg-white dark:bg-green-950"
                    : "bg-green-50/50 dark:bg-brand-green-darker/30"
                }`}
              >
                <div className="grid grid-cols-2 items-center px-6 py-3">
                  <span className="text-sm text-sidebar-accent dark:text-slate-300">
                    {earnings[i]?.name ?? ""}
                  </span>
                  <span
                    className={`text-sm font-semibold text-right ${earnings[i] ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                  >
                    {earnings[i] ? `₹ ${fmtRaw(earnings[i].amount)}` : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 items-center px-6 py-3">
                  <span className="text-sm text-sidebar-accent dark:text-slate-300">
                    {deductions[i]?.name ?? ""}
                  </span>
                  <span
                    className={`text-sm font-semibold text-right ${deductions[i] ? "text-red-600 dark:text-red-400" : ""}`}
                  >
                    {deductions[i] ? `₹ ${fmtRaw(deductions[i].amount)}` : ""}
                  </span>
                </div>
              </div>
            ),
          )}

          {/* Totals */}
          <div className="grid grid-cols-2 divide-x divide-slate-300 dark:divide-slate-600 bg-brand-green-tint dark:bg-sidebar-accent border-t-2 border-primary/30 dark:border-sidebar-accent/60">
            <div className="grid grid-cols-2 items-center px-6 py-4">
              <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">
                Total Earnings
              </span>
              <span className="text-sm font-bold text-emerald-600 text-right">
                ₹ {fmtRaw(payslipData.totalEarnings)}
              </span>
            </div>
            <div className="grid grid-cols-2 items-center px-6 py-4">
              <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">
                Total Deductions
              </span>
              <span className="text-sm font-bold text-red-600 text-right">
                ₹ {fmtRaw(payslipData.totalDeductions)}
              </span>
            </div>
          </div>

          {/* Net pay */}
          <div className="bg-gradient-to-r from-sidebar-accent via-primary to-sidebar-accent px-4 sm:px-8 py-5 flex items-center justify-between">
            <div>
              <p className="text-green-100 text-xs font-semibold uppercase tracking-wider">
                Net Salary Payable
              </p>
              <p className="text-green-200/80 text-[10.5px] mt-0.5">
                Total Earnings − Total Deductions
              </p>
            </div>
            <p className="text-white font-black text-2xl">
              ₹ {fmtRaw(payslipData.netPayable)}
            </p>
          </div>

          {/* Signatures */}
          <div className="px-4 sm:px-8 py-6 flex justify-between items-end border-t border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker/20">
            {["Employee Signature", "Prepared By", "Authorized Signatory"].map(
              (label) => (
                <div key={label} className="text-center">
                  <div className="w-36 border-t border-slate-400 mb-2" />
                  <p className="text-[9.5px] font-semibold text-slate-500 uppercase tracking-wide">
                    {label}
                  </p>
                </div>
              ),
            )}
          </div>

          {/* Disclaimer */}
          <div className="border-t border-slate-100 dark:border-sidebar-accent px-4 sm:px-8 py-3 bg-green-50 dark:bg-brand-green-darker/20 text-center">
            <p className="text-[10.5px] text-slate-400">
              Computer-generated payslip — no physical signature required
              &nbsp;|&nbsp; {companyNameShort} Microfinance – Confidential
            </p>
          </div>

          {/* Bottom export actions */}
          <div className="border-t border-primary/20 dark:border-sidebar-accent px-4 sm:px-8 py-4 bg-green-50 dark:bg-brand-green-darker/30 flex flex-wrap gap-3 justify-end">
            <ExportDropdown
              onExportPDF={handleExportPDF}
              onExportExcel={handleExportExcel}
              onExportCSV={handleExportCSV}
              onExportWord={handleExportWord}
              canExport={canExportReport('payslip')}
              reportSlug={getReportExportMode('payslip') === 'REQUEST_QUEUE' ? 'payslip' : undefined}
              exportParams={{
                fromDate: null,
                toDate: null,
                branchIds: submittedBranch ? [submittedBranch] : 'ALL',
                filters: { employeeId: submittedEmployee, month: submittedMonth, year: submittedYear },
              }}
              className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow text-xs h-8 px-4"
            />
          </div>
        </Card>
      )}

      {/* ── Empty State ───────────────────────────────────────────────── */}
      {!showPayslip && !isGenerating && !errorMsg && (
        <Card className="border-dashed border-2 border-primary/30 dark:border-sidebar-accent bg-green-50/50 dark:bg-brand-green-darker/20">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-green-tint to-primary dark:from-brand-green-darker/30 dark:to-brand-green-darker/30 flex items-center justify-center">
              <FileText className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-semibold text-sidebar-accent dark:text-slate-300">
                No Payslip Generated
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                Select a Centre, Employee, Month and Year, then click{" "}
                <strong>Generate Payslip</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
