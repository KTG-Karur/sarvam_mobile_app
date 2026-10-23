"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { useReactToPrint } from "react-to-print";
import { getDemandSheetClientWiseCenterReport, type DemandClientWiseReportData } from "@/app/lib/actions/demand";
import { useToast } from "@/hooks/use-toast";
import { ClientWiseCenterReportView } from "@/components/reports/ClientWiseCenterReportView";
import { buildClientWiseCenterReportPdf } from "@/app/lib/reports/client-wise-center-report";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";

type ClientWiseDemandReportDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    dateStr: string;
    fdoId: string;
    centerId: string;
    branchId?: string;
};

export function ClientWiseDemandReportDialog({
    open,
    onOpenChange,
    dateStr,
    fdoId,
    centerId,
    branchId,
}: ClientWiseDemandReportDialogProps) {
    const { toast } = useToast();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const printRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<DemandClientWiseReportData | null>(null);

    useEffect(() => {
        if (!open || !centerId || !fdoId) return;

        let active = true;
        setIsLoading(true);
        setError(null);

        getDemandSheetClientWiseCenterReport(dateStr, fdoId, centerId, branchId)
            .then((data) => {
                if (!active) return;
                setReport(data);
            })
            .catch((e: unknown) => {
                if (!active) return;
                setError(e instanceof Error ? e.message : "Failed to load report");
                setReport(null);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [open, centerId, dateStr, fdoId, branchId]);

    const title = useMemo(() => {
        if (!report) return "Client Wise Demand Sheet";
        return `${report.centerCode} - ${report.centerName}`;
    }, [report]);

    const printDocumentTitle = useMemo(() => {
        if (!report) return "ClientWise_Demand_Sheet";
        const safe = report.centerCode.replace(/[^\w.-]+/g, "_");
        return `Demand_Sheet_${safe}_${dateStr}`;
    }, [report, dateStr]);

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
            }
        `,
    });

    const handleExportPdf = useCallback(async () => {
        if (!report) {
            toast({
                variant: "destructive",
                title: "No report",
                description: "Load the report before exporting PDF."
            });
            return;
        }
        try {
            await buildClientWiseCenterReportPdf(report, dateStr, loanAdvanceEnabled);
            toast({
                title: "Export successful",
                description: "PDF downloaded."
            });
        } catch (error) {
            console.error("PDF export error:", error);
            toast({
                variant: "destructive",
                title: "Export failed",
                description: "Could not generate PDF."
            });
        }
    }, [report, dateStr, toast]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!w-[98vw] !max-w-[1600px] flex max-h-[95vh] flex-col overflow-hidden bg-white p-0 print:max-h-none print:overflow-visible">
                <DialogHeader className="shrink-0 print:hidden">
                    <div className="flex flex-col gap-3 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <DialogTitle className="text-base">{title}</DialogTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="outline" size="sm" className="gap-2" disabled={isLoading || !report} onClick={handleExportPdf}>
                                <FileDown className="h-4 w-4" />
                                Save PDF
                            </Button>
                            <Button type="button" size="sm" className="gap-2 bg-black text-white hover:bg-gray-800" disabled={isLoading || !report} onClick={() => void handlePrint()}>
                                <Printer className="h-4 w-4" />
                                Print
                            </Button>
                        </div>
                    </div>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto print:overflow-visible">
                    {isLoading && <div className="px-3 sm:px-6 py-4 sm:py-8 text-sm">Loading report...</div>}
                    {!isLoading && error && <div className="px-3 sm:px-6 py-4 sm:py-8 text-sm text-red-600">{error}</div>}
                    {!isLoading && !error && report && (
                        <div ref={printRef} className="print-container bg-white p-4 print:p-2 print:max-w-[194mm] print:mx-auto">
                            <ClientWiseCenterReportView report={report} />
                            <div className="flex justify-end pt-4 print:hidden">
                                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
