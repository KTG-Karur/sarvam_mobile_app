"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDown, Printer } from "lucide-react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { useReactToPrint } from "react-to-print";
import {
  getDemandSheetClientWiseCollectedCenterReport,
  type DemandClientWiseCollectedReportData,
} from "@/app/lib/actions/demand";
import { useToast } from "@/hooks/use-toast";
import { normalizeMeetingTime } from "@/app/lib/utils/meeting-time";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateStr: string;
  fdoId: string;
  centerId: string;
};

function formatAmount(value: number): string {
  if (!value || value === 0) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

async function buildCollectedPdf(report: DemandClientWiseCollectedReportData, dateStr: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = await ensureReportFont(doc);
  let y = await drawPdfReportHeader(doc, "Collected Collection Report", { fontFamily: reportFont });

  doc.setFontSize(7);
  doc.setFont(reportFont, "normal");
  doc.text(`Branch: ${report.branchCode} - ${report.branchName}`, 10, y);
  y += 5;
  doc.text(`Center: ${report.centerCode} - ${report.centerName}`, 10, y);
  y += 5;
  doc.text(`FDO: ${report.fdoId || "-"} - ${report.fdoName || "-"}`, 10, y);
  y += 5;
  doc.text(`Meeting: ${report.meetingDay} ${report.meetingTime ? normalizeMeetingTime(report.meetingTime) : "-"}  Date: ${report.meetingDate}`, 10, y);
  y += 5;
  doc.text(`Report Type: CLIENTWISE (COLLECTED)`, 10, y);
  y += 6;

  const body = report.clients.map((c) => [
    c.cid,
    c.clientName.toUpperCase(),
    c.mobileNumber || "-",
    formatAmount(c.collectedApproved),
    formatAmount(c.collectedPending),
    formatAmount(c.collectedTotal),
  ]);

  body.push([
    { content: `Total Clients: ${report.totalClients}`, colSpan: 3, styles: { fontStyle: "bold", halign: "left" } } as any,
    formatAmount(report.grandTotalCollectedApproved),
    formatAmount(report.grandTotalCollectedPending),
    formatAmount(report.grandTotalCollectedTotal),
  ]);

  autoTable(doc, {
    startY: y,
    head: [["CID", "Client Name", "Mobile", "Approved", "Pending", "Total"]],
    body,
    theme: "grid",
    styles: { font: reportFont },
    headStyles: { font: reportFont, fillColor: [230, 230, 230], textColor: 0, fontStyle: "bold", halign: "center", fontSize: 7 },
    bodyStyles: { fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 55 },
      2: { cellWidth: 25 },
      3: { cellWidth: 25, halign: "right" },
      4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 25, halign: "right" },
    },
  });

  const safeCenter = report.centerCode.replace(/[^\w.-]+/g, "_");
  doc.save(`Collected_Sheet_${safeCenter}_${dateStr}.pdf`);
}

export function ClientWiseCollectedReportDialog({
  open,
  onOpenChange,
  dateStr,
  fdoId,
  centerId,
}: Props) {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DemandClientWiseCollectedReportData | null>(null);

  useEffect(() => {
    if (!open || !centerId) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    getDemandSheetClientWiseCollectedCenterReport(dateStr, fdoId, centerId)
      .then((data) => {
        if (!active) return;
        setReport(data);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load collected report");
        setReport(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, centerId, dateStr, fdoId]);

  const title = useMemo(() => {
    if (!report) return "Collected Collection Report";
    return `${report.centerCode} - ${report.centerName}`;
  }, [report]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: report ? `Collected_Sheet_${report.centerCode}_${dateStr}` : "Collected_Sheet",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader className="flex items-center justify-between gap-4 sm:flex-row">
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!report) return;
                buildCollectedPdf(report, dateStr).catch(() => {
                  toast({
                    title: "Export failed",
                    description: "Unable to generate PDF for collected report.",
                    variant: "destructive",
                  });
                });
              }}
              disabled={!report || isLoading}
              className="gap-2"
            >
              <FileDown className="h-4 w-4" />
              Export PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!report || isLoading} className="gap-2">
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        </DialogHeader>

        {isLoading && <div className="py-10 text-sm text-muted-foreground">Loading...</div>}
        {error && <div className="py-6 text-sm text-red-600">{error}</div>}

        {report && (
          <div ref={printRef} className="space-y-4">
            <ReportHeader title="Collected Collection Report" />
            <div className="rounded-xl border bg-green-50 p-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Branch</div>
                  <div className="font-semibold">
                    {report.branchCode} - {report.branchName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Meeting</div>
                  <div className="font-semibold">
                    {report.meetingDay} {report.meetingTime ? normalizeMeetingTime(report.meetingTime) : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">FDO</div>
                  <div className="font-semibold">
                    {report.fdoName || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Date</div>
                  <div className="font-semibold">{report.meetingDate}</div>
                </div>
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">CID</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-[140px]">Mobile</TableHead>
                    <TableHead className="text-right w-[120px]">Approved</TableHead>
                    <TableHead className="text-right w-[120px]">Pending</TableHead>
                    <TableHead className="text-right w-[120px]">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.clients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No collections recorded for this center on the selected date.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.clients.map((c) => (
                      <TableRow key={c.cid}>
                        <TableCell className="font-mono">{c.cid}</TableCell>
                        <TableCell className="font-medium">{c.clientName}</TableCell>
                        <TableCell>{c.mobileNumber || "-"}</TableCell>
                        <TableCell className="text-right">{formatAmount(c.collectedApproved)}</TableCell>
                        <TableCell className="text-right">{formatAmount(c.collectedPending)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatAmount(c.collectedTotal)}</TableCell>
                      </TableRow>
                    ))
                  )}
                  <TableRow>
                    <TableCell colSpan={3} className="font-semibold">
                      Total clients: {report.totalClients}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatAmount(report.grandTotalCollectedApproved)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatAmount(report.grandTotalCollectedPending)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatAmount(report.grandTotalCollectedTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

