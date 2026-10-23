"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportDropdown } from "@/components/reports/ExportDropdown";
import { DemandSheetCenterwiseTable } from "@/components/reports/DemandSheetCenterwiseTable";
import { DemandSheetDenominationBlock } from "@/components/reports/DemandSheetDenominationBlock";
import { ClientWiseCenterReportView } from "@/components/reports/ClientWiseCenterReportView";
import {
  getDemandSheetClientWiseCenterReport,
  type DemandSheetData,
  type DemandClientTableRow,
  type DemandClientWiseReportData,
} from "@/app/lib/actions/demand";
import {
  buildClientWiseAllCentersPdf,
  buildClientWiseCenterExportRows,
  getClientWiseCenterExportHeaders,
} from "@/app/lib/reports/client-wise-center-report";
import { buildDemandSheetDenominationRows } from "@/app/lib/reports/demand-sheet-denomination";
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import { exportToCSV } from "@/app/lib/report-export-utils";
import { useToast } from "@/hooks/use-toast";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";

interface DemandSheetAllCentersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  demandType: "centerwise" | "clientwise";
  centerRows: DemandSheetData[];
  clientRows: DemandClientTableRow[];
  branchLabel: string;
  fdoName: string;
  formattedDate: string;
  dayName: string;
  canExport: boolean;
  /** Needed only for clientwise — re-fetches each in-scope center's own full
   * "Detailed report" (same call the single-center dialog makes), so All
   * Centers is a literal repetition of that existing per-center structure
   * rather than a separate simplified layout. */
  dateStr: string;
  fdoId: string;
  branchId?: string;
  /** Centerwise export callbacks — unchanged, still owned/built by the parent
   * page (centerwise has no per-center "Detailed report" to repeat, so its
   * All-Centers preview/export stays the existing flat table + single
   * denomination block). Unused for clientwise. */
  onExportPDF: () => void | Promise<void>;
  onExportExcel: () => void | Promise<void>;
  onExportCSV: () => void | Promise<void>;
  /** Word is intentionally not offered here — see DemandSheetDenominationBlock's
   * doc comment / the feature's audit notes on why the denomination section can't
   * be added to the shared Word builder without touching the queue Word path too. */
}

/**
 * Direct-download-only preview for "Download All Centers".
 *
 * Centerwise: unchanged — renders the already-loaded flat centerRows plus one
 * denomination block (centerwise has no per-center "Detailed report" to repeat).
 *
 * Clientwise: for every center present in the loaded data, fetches that
 * center's own full report via the SAME server action the single-center
 * "Detailed report" dialog uses (getDemandSheetClientWiseCenterReport), then
 * renders the SAME ClientWiseCenterReportView once per center — each with its
 * own demand table, totals, denomination table, and signature/receipt block.
 * No global/shared denomination section, ever.
 */
export function DemandSheetAllCentersDialog({
  open,
  onOpenChange,
  demandType,
  centerRows,
  clientRows,
  branchLabel,
  fdoName,
  formattedDate,
  dayName,
  canExport,
  dateStr,
  fdoId,
  branchId,
  onExportPDF,
  onExportExcel,
  onExportCSV,
}: DemandSheetAllCentersDialogProps) {
  const { toast } = useToast();
  const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();

  // Distinct centers present in the loaded clientwise data — same derivation
  // (Map + name sort) as the page's own Center filter dropdown.
  const clientCenters = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of clientRows) {
      if (!byId.has(row.centerId)) byId.set(row.centerId, row.centerName);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));
  }, [clientRows]);

  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [centerReports, setCenterReports] = useState<DemandClientWiseReportData[]>([]);

  useEffect(() => {
    if (!open || demandType !== "clientwise" || clientCenters.length === 0) {
      setCenterReports([]);
      setReportsError(null);
      return;
    }
    let active = true;
    setIsLoadingReports(true);
    setReportsError(null);
    Promise.all(
      clientCenters.map(([centerId]) => getDemandSheetClientWiseCenterReport(dateStr, fdoId, centerId, branchId))
    )
      .then((data) => {
        if (!active) return;
        setCenterReports(data);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setReportsError(e instanceof Error ? e.message : "Failed to load center reports");
        setCenterReports([]);
      })
      .finally(() => {
        if (active) setIsLoadingReports(false);
      });
    return () => {
      active = false;
    };
    // clientCenters is a freshly-built array each render but its contents are
    // derived from clientRows (already a dependency) — including it directly
    // would re-fetch every render, so it's intentionally omitted here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, demandType, dateStr, fdoId, branchId, clientRows]);

  const handleExportAllCentersPdf = async () => {
    if (centerReports.length === 0) return;
    try {
      await buildClientWiseAllCentersPdf(
        centerReports,
        dateStr,
        `Demand_ClientWise_AllCenters_${fdoName}_${dateStr}.pdf`,
        loanAdvanceEnabled
      );
    } catch (e) {
      console.error("All Centers PDF export error", e);
      toast({ variant: "destructive", title: "Export failed", description: "Could not generate PDF." });
    }
  };

  // Repeats each center's own export rows + its own denomination block — never
  // a single combined table/denomination for the whole file.
  const buildAllCentersClientwiseRows = (): (string | number)[][] => {
    const headers = getClientWiseCenterExportHeaders(loanAdvanceEnabled);
    const rows: (string | number)[][] = [];
    centerReports.forEach((report, index) => {
      if (index > 0) rows.push(Array(headers.length).fill(""));
      const centerHeaderRow = Array(headers.length).fill("");
      centerHeaderRow[0] = `CENTER: ${report.centerCode} - ${report.centerName}`;
      rows.push(centerHeaderRow);
      rows.push(...buildClientWiseCenterExportRows(report, loanAdvanceEnabled));
      rows.push(...buildDemandSheetDenominationRows(headers.length));
    });
    return rows;
  };

  const handleExportAllCentersExcel = () => {
    if (centerReports.length === 0) return;
    const headers = getClientWiseCenterExportHeaders(loanAdvanceEnabled);
    const rows = buildAllCentersClientwiseRows();
    const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    const ws = buildReportSheet("Demand Sheet — Clientwise (All Centers)", excelRows);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Demand Sheet");
    XLSX.writeFile(wb, `Demand_ClientWise_AllCenters_${fdoName}_${dateStr}.xlsx`);
  };

  const handleExportAllCentersCSV = () => {
    if (centerReports.length === 0) return;
    const headers = getClientWiseCenterExportHeaders(loanAdvanceEnabled);
    const rows = buildAllCentersClientwiseRows();
    exportToCSV(
      `Demand_ClientWise_AllCenters_${fdoName}_${dateStr}`,
      "DEMAND SHEET — CLIENTWISE (ALL CENTERS)",
      headers,
      rows
    );
  };

  const isClientwise = demandType === "clientwise";
  const rowCount = isClientwise ? centerReports.length : centerRows.length;
  const canDownload = isClientwise ? centerReports.length > 0 : centerRows.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[98vw] !max-w-[1600px] flex max-h-[95vh] flex-col overflow-hidden bg-white p-0 dark:bg-brand-green-darker">
        <DialogHeader className="shrink-0">
          <div className="flex flex-col gap-3 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <DialogTitle className="text-base">Demand Sheet — All Centers</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Branch: <span className="font-medium text-foreground">{branchLabel}</span>
                {" • "}Demand Date: <span className="font-medium text-foreground">{formattedDate}</span>
                {" • "}FDO: <span className="font-medium text-foreground">{fdoName}</span>
                {" • "}Demand Type: <span className="font-medium text-foreground uppercase">{demandType}</span>
                {" • "}Center: <span className="font-medium text-foreground">All Centers</span>
                {" • "}Meeting Day: <span className="font-medium text-foreground">{dayName}</span>
              </p>
            </div>
            {isClientwise ? (
              <ExportDropdown
                label="Download"
                canExport={canExport}
                onExportPDF={canDownload ? handleExportAllCentersPdf : undefined}
                onExportExcel={canDownload ? handleExportAllCentersExcel : undefined}
                onExportCSV={canDownload ? handleExportAllCentersCSV : undefined}
                className="gap-2 shrink-0"
              />
            ) : (
              <ExportDropdown
                label="Download"
                canExport={canExport}
                onExportPDF={rowCount > 0 ? onExportPDF : undefined}
                onExportExcel={rowCount > 0 ? onExportExcel : undefined}
                onExportCSV={rowCount > 0 ? onExportCSV : undefined}
                className="gap-2 shrink-0"
              />
            )}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto p-4">
          {isClientwise ? (
            isLoadingReports ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Loading {clientCenters.length} center{clientCenters.length === 1 ? "" : "s"}…
              </div>
            ) : reportsError ? (
              <div className="py-10 text-center text-sm text-red-600">{reportsError}</div>
            ) : centerReports.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No data available to preview.
              </div>
            ) : (
              centerReports.map((report, index) => (
                <div
                  key={report.centerCode || index}
                  className={index > 0 ? "mt-6 border-t-4 border-dashed border-gray-300 pt-6 print:break-before-page print:border-t-0 print:pt-0" : ""}
                >
                  <ClientWiseCenterReportView report={report} />
                </div>
              ))
            )
          ) : centerRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No data available to preview.
            </div>
          ) : (
            <>
              <DemandSheetCenterwiseTable rows={centerRows} />
              <DemandSheetDenominationBlock />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
