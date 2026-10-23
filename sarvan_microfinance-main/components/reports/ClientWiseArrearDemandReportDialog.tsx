"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellDef } from "jspdf-autotable";
import { useReactToPrint } from "react-to-print";
import {
  getArrearDemandSheetData,
  type ArrearDemandSheetResult,
} from "@/app/lib/actions/demand";
import { useToast } from "@/hooks/use-toast";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

type ClientWiseArrearDemandReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  arrearDateStr: string;
  centerId: string;
};

function formatAmount(value: number): string {
  if (!value || value === 0) return "";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatAmountWithDecimals(value: number | null): string {
  if (value == null || value === 0) return "";
  return formatReportAmount(value);
}

function formatDateDisplay(dateString: string): string {
  if (!dateString) return "";
  try {
    const [year, month, day] = dateString.split("-");
    if (year && month && day) return `${day}/${month}/${year.slice(-2)}`;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(-2)}`;
  } catch {
    return dateString;
  }
}

async function buildArrearDetailedReportPdf(
  result: ArrearDemandSheetResult,
  arrearDateStr: string
): Promise<void> {
  const { rows, meta } = result;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const reportFont = await ensureReportFont(doc);

  let y = await drawPdfReportHeader(doc, "Arrear Demand Sheet", { fontFamily: reportFont });

  doc.setFontSize(9);
  doc.setFont(reportFont, "normal");
  doc.setTextColor(0, 0, 0);

  const indentX = margin;
  doc.text(`Branch : ${meta.branchCode} - ${meta.branchName}`, indentX, y);
  doc.text(`Center : ${meta.centerCode} - ${meta.centerName}`, indentX + 80, y);
  y += 5;
  doc.text(`Arrear Date : ${formatDateDisplay(arrearDateStr)}`, indentX, y);
  doc.text(`Total Clients : ${meta.totalClients}`, indentX + 80, y);
  y += 8;

  const clientRows = rows.map((row): (string | CellDef)[] => [
    String(row.sNo),
    row.clientId,
    row.clientName.toUpperCase().substring(0, 25),
    row.loanId,
    formatAmountWithDecimals(row.arrearPrincipal) || "0",
    formatAmountWithDecimals(row.arrearInterest) || "0",
    formatAmountWithDecimals(row.totalArrearDue) || "0",
    row.collectionStatus || "Not Collected",
    row.collectedAmount != null ? formatAmountWithDecimals(row.collectedAmount) : "",
    row.collectionDateDisplay ?? "",
    row.collectionTimeDisplay ?? "",
    row.collectedBy ?? "",
  ]);

  const footerRow: (string | CellDef)[] = [
    { content: `Total (${rows.length} loans, ${meta.totalClients} clients)`, colSpan: 4, styles: { fontStyle: "bold" } },
    { content: formatAmountWithDecimals(meta.totalArrearPrincipal) || "0", styles: { fontStyle: "bold", halign: "right" } },
    { content: formatAmountWithDecimals(meta.totalArrearInterest) || "0", styles: { fontStyle: "bold", halign: "right" } },
    { content: formatAmountWithDecimals(meta.totalArrearDue) || "0", styles: { fontStyle: "bold", halign: "right" } },
    "", "", "", "", "",
  ];

  autoTable(doc, {
    startY: y,
    head: [
      [
        { content: "S.No", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Member ID", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Member Name", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Loan ID", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Arrear Principal", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Arrear Interest", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Total Arrear Due", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Coll. Status", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Coll. Amount", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Coll. Date", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Coll. Time", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
        { content: "Collected By", styles: { fontSize: 6.5, fontStyle: "bold", halign: "center" } },
      ],
    ],
    body: clientRows,
    foot: [footerRow],
    theme: "grid",
    styles: { font: reportFont },
    headStyles: {
      font: reportFont,
      fillColor: [200, 200, 200] as [number, number, number],
      textColor: 0,
      fontSize: 6.5,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
    },
    bodyStyles: {
      fontSize: 6,
      textColor: 0,
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
    },
    footStyles: {
      fillColor: [240, 240, 240] as [number, number, number],
      fontSize: 6.5,
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245] as [number, number, number],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 18, halign: "left" },
      2: { cellWidth: 28, halign: "left" },
      3: { cellWidth: 18, halign: "left" },
      4: { cellWidth: 18, halign: "right" },
      5: { cellWidth: 16, halign: "right" },
      6: { cellWidth: 18, halign: "right" },
      7: { cellWidth: 18, halign: "center" },
      8: { cellWidth: 16, halign: "right" },
      9: { cellWidth: 16, halign: "center" },
      10: { cellWidth: 14, halign: "center" },
      11: { cellWidth: 22, halign: "left" },
    },
    margin: { left: margin, right: margin },
    didDrawCell: (data) => {
      if (data.section === "body" && data.row.index !== undefined) {
        const row = rows[data.row.index];
        if (row && !row.collectionStatus) {
          data.cell.styles.textColor = [200, 0, 0];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };
  const finalY = (doc as DocWithAutoTable).lastAutoTable?.finalY ?? y + 50;
  let currentY = finalY + 8;

  if (currentY + 55 > pageHeight) {
    doc.addPage();
    currentY = 20;
  }

  const tableWidth = 100;
  const tableStartX = margin;

  doc.rect(tableStartX, currentY, tableWidth, 60);
  doc.setFontSize(9);
  doc.setFont(reportFont, "bold");
  doc.text("DENOMINATION", tableStartX + tableWidth / 2, currentY + 6, { align: "center" });
  doc.text("COUNT", tableStartX + tableWidth - 18, currentY + 6);
  doc.text("VALUE", tableStartX + tableWidth - 8, currentY + 6);
  doc.line(tableStartX, currentY + 10, tableStartX + tableWidth, currentY + 10);
  doc.line(tableStartX + tableWidth - 24, currentY, tableStartX + tableWidth - 24, currentY + 60);
  doc.line(tableStartX + tableWidth - 12, currentY, tableStartX + tableWidth - 12, currentY + 60);

  const denomLabels = ["500", "200", "100", "50", "20", "10", "Coin", "UPI", "Total"];
  let rowY = currentY + 12;
  doc.setFontSize(7);
  doc.setFont(reportFont, "normal");

  denomLabels.forEach((label, idx) => {
    doc.text(`Rs.${label}`, tableStartX + 3, rowY);
    doc.line(tableStartX + tableWidth - 23, rowY - 2, tableStartX + tableWidth - 1, rowY - 2);
    if (idx < denomLabels.length - 1) {
      doc.line(tableStartX, rowY + 2.5, tableStartX + tableWidth, rowY + 2.5);
    }
    rowY += 6;
  });

  const sigStartX = tableStartX + tableWidth + 10;
  const sigWidth = (pageWidth - sigStartX - margin) / 3;

  doc.setFontSize(8);
  doc.setFont(reportFont, "bold");
  doc.text("CL Signature", sigStartX + sigWidth / 2, currentY + 20, { align: "center" });
  doc.text("FDO Signature", sigStartX + sigWidth + sigWidth / 2, currentY + 20, { align: "center" });
  doc.text("BM Signature", sigStartX + 2 * sigWidth + sigWidth / 2, currentY + 20, { align: "center" });

  doc.setLineWidth(0.2);
  doc.line(sigStartX + 2, currentY + 23, sigStartX + sigWidth - 2, currentY + 23);
  doc.line(sigStartX + sigWidth + 2, currentY + 23, sigStartX + 2 * sigWidth - 2, currentY + 23);
  doc.line(sigStartX + 2 * sigWidth + 2, currentY + 23, sigStartX + 3 * sigWidth - 2, currentY + 23);

  const safeCenter = meta.centerCode.replace(/[^\w.-]+/g, "_");
  doc.save(`Arrear_Demand_Sheet_${safeCenter}_${arrearDateStr}.pdf`);
}

export function ClientWiseArrearDemandReportDialog({
  open,
  onOpenChange,
  arrearDateStr,
  centerId,
}: ClientWiseArrearDemandReportDialogProps) {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArrearDemandSheetResult | null>(null);

  useEffect(() => {
    if (!open || !centerId || !arrearDateStr) return;

    let active = true;
    setIsLoading(true);
    setError(null);

    getArrearDemandSheetData(arrearDateStr, centerId)
      .then((data) => {
        if (!active) return;
        setResult(data);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load report");
        setResult(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, centerId, arrearDateStr]);

  const title = useMemo(() => {
    if (!result) return "Client Wise Arrear Demand Sheet";
    return `${result.meta.centerCode} - ${result.meta.centerName}`;
  }, [result]);

  const printDocumentTitle = useMemo(() => {
    if (!result) return "ClientWise_Arrear_Demand_Sheet";
    const safe = result.meta.centerCode.replace(/[^\w.-]+/g, "_");
    return `Arrear_Demand_Sheet_${safe}_${arrearDateStr}`;
  }, [result, arrearDateStr]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: printDocumentTitle,
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 8mm;
      }
      @media print {
        html, body {
          width: 194mm;
          height: 281mm;
        }
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          margin: 0;
          padding: 0;
        }
        .print-container {
          width: 100%;
          max-width: 194mm;
          margin: 0 auto;
        }
      }
    `,
  });

  const handleExportPdf = useCallback(() => {
    if (!result) {
      toast({ variant: "destructive", title: "No report", description: "Load the report before exporting PDF." });
      return;
    }
    buildArrearDetailedReportPdf(result, arrearDateStr)
      .then(() => {
        toast({ title: "Export successful", description: "PDF downloaded." });
      })
      .catch((err) => {
        console.error("PDF export error:", err);
        toast({ variant: "destructive", title: "Export failed", description: "Could not generate PDF." });
      });
  }, [result, arrearDateStr, toast]);

  const formatCurrency = (v: number) => formatReportAmount(v);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[98vw] !max-w-[1600px] flex max-h-[95vh] flex-col overflow-hidden bg-white p-0 print:max-h-none print:overflow-visible">
        <DialogHeader className="shrink-0 print:hidden">
          <div className="flex flex-col gap-3 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="text-base">{title}</DialogTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isLoading || !result}
                onClick={handleExportPdf}
              >
                <FileDown className="h-4 w-4" />
                Save PDF
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2 bg-black text-white hover:bg-gray-800"
                disabled={isLoading || !result}
                onClick={() => void handlePrint()}
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto print:overflow-visible">
          {isLoading && (
            <div className="px-6 py-8 text-sm">Loading report...</div>
          )}
          {!isLoading && error && (
            <div className="px-6 py-8 text-sm text-red-600">{error}</div>
          )}
          {!isLoading && !error && result && (
            <div
              ref={printRef}
              className="print-container bg-white p-4 print:p-2"
              style={{ maxWidth: "210mm", margin: "0 auto" }}
            >
              {/* Header */}
              <ReportHeader title="Arrear Demand Sheet" />

              {/* Info Section */}
              <div className="mb-4 text-xs">
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <div>Branch : {result.meta.branchCode} - {result.meta.branchName}</div>
                  <div className="text-right">Center : {result.meta.centerCode} - {result.meta.centerName}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Arrear Date : {formatDateDisplay(arrearDateStr)}</div>
                  <div className="text-right">Total Clients : {result.meta.totalClients}</div>
                </div>
              </div>

              {/* Client Table */}
              {result.rows.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No outstanding arrears found for this center.
                </div>
              ) : (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-xs border-collapse border border-black">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-black p-1 text-center">S.No</th>
                        <th className="border border-black p-1 text-left">Member ID</th>
                        <th className="border border-black p-1 text-left">Member Name</th>
                        <th className="border border-black p-1 text-left">Loan ID</th>
                        <th className="border border-black p-1 text-right text-red-700">Arrear Principal</th>
                        <th className="border border-black p-1 text-right text-red-700">Arrear Interest</th>
                        <th className="border border-black p-1 text-right font-bold">Total Arrear Due</th>
                        <th className="border border-black p-1 text-center">Coll. Status</th>
                        <th className="border border-black p-1 text-right">Coll. Amount</th>
                        <th className="border border-black p-1 text-center">Coll. Date</th>
                        <th className="border border-black p-1 text-center">Coll. Time</th>
                        <th className="border border-black p-1 text-left">Collected By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row) => {
                        const notCollected = !row.collectionStatus;
                        const rowClass = notCollected ? "text-red-600 font-bold" : "";
                        return (
                          <tr key={row.loanDbId} className={rowClass}>
                            <td className="border border-black p-1 text-center">{row.sNo}</td>
                            <td className="border border-black p-1 font-mono">{row.clientId}</td>
                            <td className="border border-black p-1 uppercase">{row.clientName.substring(0, 25)}</td>
                            <td className="border border-black p-1 font-mono">{row.loanId}</td>
                            <td className="border border-black p-1 text-right">{formatCurrency(row.arrearPrincipal)}</td>
                            <td className="border border-black p-1 text-right">{formatCurrency(row.arrearInterest)}</td>
                            <td className="border border-black p-1 text-right font-bold">{formatCurrency(row.totalArrearDue)}</td>
                            <td className="border border-black p-1 text-center">
                              {row.collectionStatus ? (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                  {row.collectionStatus}
                                </span>
                              ) : (
                                <span className="text-red-600 font-semibold">Not Collected</span>
                              )}
                            </td>
                            <td className="border border-black p-1 text-right">
                              {row.collectedAmount != null ? formatCurrency(row.collectedAmount) : ""}
                            </td>
                            <td className="border border-black p-1 text-center text-muted-foreground">
                              {row.collectionDateDisplay ?? ""}
                            </td>
                            <td className="border border-black p-1 text-center text-muted-foreground">
                              {row.collectionTimeDisplay ?? ""}
                            </td>
                            <td className="border border-black p-1">{row.collectedBy ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold bg-gray-50">
                        <td className="border border-black p-1" colSpan={4}>
                          Total Loans : {result.rows.length} | Clients : {result.meta.totalClients}
                        </td>
                        <td className="border border-black p-1 text-right text-red-600">
                          {formatCurrency(result.meta.totalArrearPrincipal)}
                        </td>
                        <td className="border border-black p-1 text-right text-red-600">
                          {formatCurrency(result.meta.totalArrearInterest)}
                        </td>
                        <td className="border border-black p-1 text-right">
                          {formatCurrency(result.meta.totalArrearDue)}
                        </td>
                        <td className="border border-black p-1" colSpan={5} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Denomination Section */}
              <div className="flex flex-wrap mt-4">
                <div className="w-[280px]">
                  <table className="w-full border-collapse border border-black text-sm">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-black p-2 text-center font-bold">DENOMINATION</th>
                        <th className="border border-black p-2 text-center font-bold">COUNT</th>
                        <th className="border border-black p-2 text-center font-bold">VALUE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["Rs.500", "Rs.200", "Rs.100", "Rs.50", "Rs.20", "Rs.10", "Coins", "UPI"].map((d) => (
                        <tr key={d}>
                          <td className="border border-black p-2">{d}</td>
                          <td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td>
                          <td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td>
                        </tr>
                      ))}
                      <tr className="font-bold bg-gray-50">
                        <td className="border border-black p-2">Total</td>
                        <td className="border border-black p-2" />
                        <td className="border border-black p-2" />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex-1 flex justify-around items-center text-center text-sm pl-6">
                  <div className="font-bold">CL Signature</div>
                  <div className="font-bold">FDO Signature</div>
                  <div className="font-bold">BM Signature</div>
                </div>
              </div>

              <div className="flex justify-end pt-4 print:hidden">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
