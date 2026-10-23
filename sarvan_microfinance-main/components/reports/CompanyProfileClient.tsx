"use client";

import { useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx-js-style";
import { useReactToPrint } from "react-to-print";
import {
  RefreshCw,
  Download,
  FileDown,
  FileType,
  FileOutput,
  Printer,
  Building2,
  Activity,
  Users,
  FileText,
  Loader2,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { usePermission } from "@/app/hooks/usePermission";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { drawCompanyProfileReport } from "@/app/lib/reports/company-profile-pdf";
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";
import { exportToCSV, exportToWord, type WordExportOptions } from "@/app/lib/report-export-utils";
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

interface CompanyProfileData {
  identification: {
    reportDate: string;
  };
  functionalData: {
    openingPortfolio: number;
    loanDisbursementSinceApril: number;
    portfolioOutstanding: number;
    demand: number;
    collection: number;
    recoveryRate: number;
    advance: number;
    preclosure: number;
    openingArrear: number;
    currentArrear: number;
    closingArrear: number;
  };
  operationalData: {
    noOfCenters: number;
    noOfGroups: number;
    noOfFdo: number;
    openingClients: number;
    openingMembers?: number;
    openingClientsWithLoan?: number;
    newClients: number;
    newMembers?: number;
    newClientsWithLoan?: number;
    dropouts: number;
    dropoutMembers?: number;
    dropoutClientsWithLoan?: number;
    closingClients: number;
    closingMembers?: number;
    closingClientsWithLoan?: number;
    waitingBorrowers: number;
    activeClients: number;
  };
}

const formatDate = (dateString: string) => toDisplayDate(dateString);

const formatCurrency = (amount: number) => formatReportAmount(amount);

export function CompanyProfileClient() {
  const { toast } = useToast();
  const { canExportReport, getReportExportMode } = usePermission();
  const printRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reportDate, setReportDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [data, setData] = useState<CompanyProfileData | null>(null);

  const fetchProfile = async () => {
    if (!reportDate) {
      toast({
        title: "Validation Error",
        description: "Please select a report date.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/reports/mis/company-profile?date=${reportDate}`,
      );
      const result = await res.json();

      if (!res.ok)
        throw new Error(result.error || "Failed to fetch company profile");

      if (result.success && result.data) {
        setData(result.data);
        toast({
          title: "Success",
          description: "Company Profile loaded successfully.",
        });
      } else {
        throw new Error("Invalid data format received");
      }
    } catch (error: any) {
      console.error("Error fetching company profile:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to load company profile.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (!data) return;

    try {
      const { headers, rows } = buildCompanyProfileExportRows();
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows("COMPANY PROFILE"), headers, ...rows]);
      autoSizeColumns(ws);
      applyExcelReportFont(ws);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      XLSX.writeFile(wb, `Company_Profile_${formatDate(data.identification.reportDate)}.xlsx`);

      toast({
        title: "Export Success",
        description: "Company Profile exported to Excel.",
      });
    } catch (error) {
      console.error("Export Error:", error);
      toast({
        title: "Export Failed",
        description: "Could not export file.",
        variant: "destructive",
      });
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "Company_Profile_Report",
  });

  const handlePdfExport = async () => {
    if (!data) return;

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });
    const reportFont = await ensureReportFont(doc);

    try {
      await drawCompanyProfileReport(doc, data, reportFont);

      doc.save(
        `Company_Profile_${formatDate(data.identification.reportDate)}.pdf`,
      );
      toast({
        title: "PDF Exported",
        description: "Company Profile PDF downloaded successfully.",
      });
    } catch (error: any) {
      console.error("PDF Export error:", error);
      toast({
        title: "Export Failed",
        description: "Failed to generate PDF report.",
        variant: "destructive",
      });
    }
  };

  // ── CSV / Word export (mirrors the same field mapping used by handleExportExcel
  // above, kept separate so handleExportExcel is left untouched) ────────────────

  const buildCompanyProfileExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
    if (!data) return { headers: [], rows: [] };
    const { functionalData, operationalData } = data;
    const headers = ["Field", "Value"];
    const rows: (string | number)[][] = [
      ["Report Date", formatDate(data.identification.reportDate)],
      ["", ""],
      ["Functional Data", ""],
      ["Opening Portfolio 1st April", formatReportAmount(functionalData.openingPortfolio)],
      ["Loan Disbursement Since April", formatReportAmount(functionalData.loanDisbursementSinceApril)],
      ["Portfolio Outstanding", formatReportAmount(functionalData.portfolioOutstanding)],
      ["Demand", formatReportAmount(functionalData.demand)],
      ["Collection", formatReportAmount(functionalData.collection)],
      ["Recovery Rate %", functionalData.recoveryRate],
      ["Advance", formatReportAmount(functionalData.advance)],
      ["Preclosure", formatReportAmount(functionalData.preclosure)],
      ["Opening Arrear 1st April", formatReportAmount(functionalData.openingArrear)],
      ["Current Arrear", formatReportAmount(functionalData.currentArrear)],
      ["Closing Arrear", formatReportAmount(functionalData.closingArrear)],
      ["", ""],
      ["Operational Data", ""],
      ["No. Of Centers", operationalData.noOfCenters],
      ["No. Of Groups", operationalData.noOfGroups],
      ["No. Of FDO", operationalData.noOfFdo],
      ["Opening (Total)", operationalData.openingClients],
      ["Opening Members", operationalData.openingMembers ?? ""],
      ["Opening Clients", operationalData.openingClientsWithLoan ?? ""],
      ["New (Total)", operationalData.newClients],
      ["New Members", operationalData.newMembers ?? ""],
      ["New Clients", operationalData.newClientsWithLoan ?? ""],
      ["Dropouts", operationalData.dropouts],
      ["Closing (Total)", operationalData.closingClients],
      ["Closing Members", operationalData.closingMembers ?? ""],
      ["Closing Clients", operationalData.closingClientsWithLoan ?? ""],
      ["Waiting Borrowers", operationalData.waitingBorrowers],
      ["Active Clients", operationalData.activeClients],
    ];
    return { headers, rows };
  };

  const handleExportCSV = () => {
    if (!data) return;
    const { headers, rows } = buildCompanyProfileExportRows();
    exportToCSV(`Company_Profile_${formatDate(data.identification.reportDate)}`, "COMPANY PROFILE", headers, rows);
    toast({ title: "CSV Exported", description: "File downloaded successfully." });
  };

  // Word-only presentation: same rows as CSV above. A freeform 2-column key/value
  // summary sheet, not a record grid — no grouped headers, no distinct totals row.
  const wordOptions: WordExportOptions = {
    columnAlignments: ["left", "right"],
    columnWidthWeights: [16, 8],
  };

  const handleExportWord = async () => {
    if (!data) return;
    const { headers, rows } = buildCompanyProfileExportRows();
    await exportToWord(`Company_Profile_${formatDate(data.identification.reportDate)}`, "COMPANY PROFILE", headers, rows, wordOptions);
    toast({ title: "Word Exported", description: "File downloaded successfully." });
  };

  return (
    <div className="space-y-6 print:space-y-0">
      {/* Header / Filter Section */}
      <Card className="border-0 shadow-xl bg-white/90 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden print:hidden transition-all duration-500 hidden-print border-b-4 border-primary">
        <CardHeader className="px-6 py-5 border-b border-slate-100 dark:border-sidebar-accent/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary dark:from-primary dark:to-primary flex items-center gap-3">
            <div className="p-2 bg-primary/10 dark:bg-brand-green-darker/40 rounded-lg">
              <Building2 className="w-6 h-6 text-primary dark:text-primary" />
            </div>
            Company Profile Report
          </CardTitle>
          {data && (
            <div className="flex items-center gap-2 overflow-x-auto">
              <Button
                onClick={() => handlePrint()}
                className="h-10 px-5 bg-primary hover:bg-sidebar-accent text-white font-bold rounded-xl whitespace-nowrap shadow-md transition-all active:scale-95 flex items-center gap-2"
              >
                <Printer className="h-4 w-4" /> Print
              </Button>
              <ExportDropdown
                onExportPDF={handlePdfExport}
                onExportExcel={handleExportExcel}
                onExportCSV={handleExportCSV}
                canExport={canExportReport('company-profile')}
                onExportWord={handleExportWord}
                reportSlug={getReportExportMode('company-profile') === 'REQUEST_QUEUE' ? 'company-profile' : undefined}
                exportParams={{
                  fromDate: data.identification.reportDate,
                  toDate: null,
                  branchIds: 'ALL',
                  filters: null,
                }}
                className="h-10 px-4 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 font-bold rounded-xl shadow-sm"
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-end gap-6">
            <div className="w-full md:w-1/3 space-y-2">
              <Label
                htmlFor="reportDate"
                className="text-sm font-semibold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2"
              >
                REPORT DATE <span className="text-red-500">*</span>
              </Label>
              <DateInput
                id="reportDate"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="h-12 bg-green-50 border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent rounded-xl font-medium"
                disabled={isLoading}
              />
            </div>
            <Button
              onClick={fetchProfile}
              disabled={isLoading}
              className="h-12 px-8 w-full md:w-auto bg-brand-green-darker hover:bg-black text-white dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80 shadow-xl font-bold rounded-xl transition-all active:scale-95"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-3 h-5 w-5 animate-spin" />{" "}
                  GENERATING...
                </>
              ) : (
                <>
                  <BarChart3 className="mr-3 h-5 w-5" /> SHOW REPORT
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <div
          className="space-y-6 print:space-y-4 print:m-0 print:p-0"
          ref={printRef}
        >
          <div className="hidden print:block mb-6">
            <ReportHeader
              title="Company Profile"
              subtitle={`As on ${formatDate(data.identification.reportDate)}`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:grid-cols-2 print:gap-4">
            {/* Functional Data Card */}
            <Card className="border border-primary/20 dark:border-sidebar-accent shadow-xl dark:bg-brand-green-darker/60 rounded-3xl overflow-hidden print:shadow-none print:border-primary/30 print:rounded-xl">
              <div className="h-2 w-full bg-primary print:h-1" />
              <CardHeader className="bg-green-50 dark:bg-sidebar-accent/50 pb-4 border-b border-slate-100 dark:border-sidebar-accent pt-6 print:pt-4 print:pb-2">
                <CardTitle className="text-lg font-bold text-sidebar-accent dark:text-white flex items-center gap-2 print:text-base">
                  <Activity className="w-5 h-5 text-primary print:w-4 print:h-4" />
                  Functional Data
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-slate-100 dark:divide-sidebar-accent print:divide-slate-200">
                  {[
                    {
                      label: "Opening Portfolio 1st April",
                      value: formatCurrency(
                        data.functionalData.openingPortfolio,
                      ),
                      isHighlight: true,
                    },
                    {
                      label: "Loan Disbursement Since April",
                      value: formatCurrency(
                        data.functionalData.loanDisbursementSinceApril,
                      ),
                    },
                    {
                      label: "Portfolio Outstanding",
                      value: formatCurrency(
                        data.functionalData.portfolioOutstanding,
                      ),
                      isHighlight: true,
                    },
                    {
                      label: "Demand",
                      value: formatCurrency(data.functionalData.demand),
                    },
                    {
                      label: "Collection",
                      value: formatCurrency(data.functionalData.collection),
                    },
                    {
                      label: "Recovery Rate %",
                      value: `${data.functionalData.recoveryRate}%`,
                      textClass:
                        "text-emerald-600 dark:text-emerald-400 print:text-emerald-700",
                    },
                    {
                      label: "Advance",
                      value: formatCurrency(data.functionalData.advance),
                    },
                    {
                      label: "Preclosure",
                      value: formatCurrency(data.functionalData.preclosure),
                    },
                    {
                      label: "Opening Arrear 1st April",
                      value: formatCurrency(data.functionalData.openingArrear),
                    },
                    {
                      label: "Current Period Arrear",
                      value: formatCurrency(data.functionalData.currentArrear),
                      textClass: "text-red-500 print:text-red-700",
                    },
                    {
                      label: "Closing Arrear",
                      value: formatCurrency(data.functionalData.closingArrear),
                      isHighlight: true,
                      textClass:
                        "text-red-600 dark:text-red-400 print:text-red-700",
                    },
                  ].map((item, idx) => (
                    <li
                      key={idx}
                      className={`flex justify-between items-center py-4 px-6 hover:bg-green-50 dark:hover:bg-sidebar-accent/50 transition-colors print:py-2 print:px-4 ${item.isHighlight ? "bg-green-50/30 dark:bg-brand-green-darker/10 print:bg-green-50" : ""}`}
                    >
                      <span
                        className={`text-sm font-semibold text-sidebar-accent dark:text-slate-400 print:text-xs print:text-sidebar-accent ${item.isHighlight ? "text-sidebar-accent dark:text-slate-200" : ""}`}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`font-bold text-right print:text-xs ${item.textClass || "text-foreground dark:text-white"} ${item.isHighlight ? "text-lg print:text-sm" : "text-base"}`}
                      >
                        {item.label.includes("%") ||
                        item.label.includes("Preclosure")
                          ? item.value
                          : `₹ ${item.value}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Operational Data Card */}
            <Card className="border border-primary/20 dark:border-sidebar-accent shadow-xl dark:bg-brand-green-darker/60 rounded-3xl overflow-hidden print:shadow-none h-fit print:border-primary/30 print:rounded-xl">
              <div className="h-2 w-full bg-primary print:h-1" />
              <CardHeader className="bg-green-50 dark:bg-sidebar-accent/50 pb-4 border-b border-slate-100 dark:border-sidebar-accent pt-6 print:pt-4 print:pb-2">
                <CardTitle className="text-lg font-bold text-sidebar-accent dark:text-white flex items-center gap-2 print:text-base">
                  <Users className="w-5 h-5 text-primary print:w-4 print:h-4" />
                  Operational Data
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-slate-100 dark:divide-sidebar-accent print:divide-slate-200">
                  {[
                    {
                      label: "No. Of Centers",
                      value: data.operationalData.noOfCenters,
                    },
                    {
                      label: "No. Of Groups",
                      value: data.operationalData.noOfGroups,
                    },
                    {
                      label: "No. Of FDO",
                      value: data.operationalData.noOfFdo,
                    },
                    {
                      label: "Opening (Total)",
                      value: data.operationalData.openingClients,
                    },
                    {
                      label: "Opening Members",
                      value: data.operationalData.openingMembers ?? 0,
                    },
                    {
                      label: "Opening Clients",
                      value: data.operationalData.openingClientsWithLoan ?? 0,
                    },
                    {
                      label: "New (Total)",
                      value: data.operationalData.newClients,
                      textClass:
                        "text-emerald-600 dark:text-emerald-400 print:text-emerald-700",
                    },
                    {
                      label: "New Members",
                      value: data.operationalData.newMembers ?? 0,
                    },
                    {
                      label: "New Clients",
                      value: data.operationalData.newClientsWithLoan ?? 0,
                    },
                    {
                      label: "Dropouts",
                      value: data.operationalData.dropouts,
                      textClass: "text-rose-500 print:text-rose-700",
                    },
                    {
                      label: "Closing (Total)",
                      value: data.operationalData.closingClients,
                      isHighlight: true,
                    },
                    {
                      label: "Closing Members",
                      value: data.operationalData.closingMembers ?? 0,
                    },
                    {
                      label: "Closing Clients",
                      value: data.operationalData.closingClientsWithLoan ?? 0,
                    },
                    {
                      label: "Waiting Borrowers",
                      value: data.operationalData.waitingBorrowers,
                      textClass: "text-amber-500 print:text-orange-700",
                    },
                    {
                      label: "Active Clients",
                      value: data.operationalData.activeClients,
                      isHighlight: true,
                      textClass:
                        "text-primary dark:text-primary print:text-primary",
                    },
                  ].map((item, idx) => (
                    <li
                      key={idx}
                      className={`flex justify-between items-center py-4 px-6 hover:bg-green-50 dark:hover:bg-sidebar-accent/50 transition-colors print:py-2 print:px-4 ${item.isHighlight ? "bg-green-50/30 dark:bg-brand-green-darker/10 print:bg-green-50" : ""}`}
                    >
                      <span
                        className={`text-sm font-semibold text-sidebar-accent dark:text-slate-400 print:text-xs print:text-sidebar-accent ${item.isHighlight ? "text-sidebar-accent dark:text-slate-200" : ""}`}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`font-bold text-right print:text-xs ${item.textClass || "text-foreground dark:text-white"} ${item.isHighlight ? "text-lg print:text-sm" : "text-base"}`}
                      >
                        {item.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
