'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Download, ChevronDown, FileText, FileSpreadsheet, FileType, Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

export type ReportExportParams = {
    fromDate?: string | null;
    toDate?: string | null;
    branchIds?: string[] | 'ALL';
    /** Report-specific filters beyond date/branch (e.g. { centerId } ) — see ReportFetchParams in app/lib/reports/report-registry.ts. */
    filters?: Record<string, string> | null;
};

type QueuedFormat = 'PDF' | 'EXCEL' | 'CSV' | 'WORD';

interface ExportDropdownProps {
    onExportPDF?: () => void | Promise<void>;
    onExportExcel?: () => void | Promise<void>;
    onExportCSV?: () => void | Promise<void>;
    onExportWord?: () => void | Promise<void>;
    className?: string;
    label?: string;
    /**
     * When set, PDF/Excel/CSV/Word are all queued through the async "Request Report"
     * export pipeline (POST /api/report-requests) instead of calling the client-side
     * onExportPDF/onExportExcel/onExportCSV/onExportWord handlers above — those four
     * props are ignored in that case. Word's queued output is built server-side by the
     * same shared docx-core (app/lib/reports/word/docx-core.ts) the direct export uses,
     * via a per-report options reconstruction (app/lib/reports/word/options-registry.ts)
     * — see app/lib/reports/generic-file-builder.ts's buildWord().
     */
    reportSlug?: string;
    exportParams?: ReportExportParams;
    /**
     * Explicitly `false` hides the dropdown entirely (no export permission for
     * this report) — applies whether or not `reportSlug` is set. Omitted
     * (undefined) means "no permission check configured for this report",
     * which shows the dropdown same as always.
     */
    canExport?: boolean;
    /**
     * Hides the PDF option regardless of mode — needed because in queue mode
     * (`reportSlug` set) PDF/Excel/CSV are always offered via the generic
     * queue pipeline independent of which client-side handlers were passed,
     * so omitting `onExportPDF` alone only hides PDF in direct-download mode.
     */
    hidePdf?: boolean;
}

type DuplicateState = { format: QueuedFormat; existingRequestId?: string; existingStatus?: string };

export function ExportDropdown({
    onExportPDF,
    onExportExcel,
    onExportCSV,
    onExportWord,
    className,
    label = 'Export',
    reportSlug,
    exportParams,
    canExport = true,
    hidePdf = false,
}: ExportDropdownProps) {
    const { toast } = useToast();
    const [queuingFormat, setQueuingFormat] = useState<QueuedFormat | null>(null);
    const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);

    const queueExport = async (format: QueuedFormat, force = false) => {
        if (!reportSlug) return;
        setQueuingFormat(format);
        try {
            const result = await apiClient.post<{
                duplicate: boolean;
                existingRequest?: { requestId: string; status: string };
                request?: { requestId: string };
            }>('/report-requests', {
                reportSlug,
                fileFormat: format,
                fromDate: exportParams?.fromDate ?? null,
                toDate: exportParams?.toDate ?? null,
                branchIds: exportParams?.branchIds,
                filters: exportParams?.filters ?? null,
                force,
            });

            if (!result.success || !result.data) {
                toast({ title: 'Export failed', description: result.error || 'Could not queue the export.', variant: 'destructive' });
                return;
            }

            if (result.data.duplicate && !force) {
                setDuplicate({
                    format,
                    existingRequestId: result.data.existingRequest?.requestId,
                    existingStatus: result.data.existingRequest?.status,
                });
                return;
            }

            toast({
                title: 'Export queued',
                description: `Request ${result.data.request?.requestId ?? ''} queued — track progress and download from Request Report.`,
            });
        } catch {
            toast({ title: 'Export failed', description: 'Failed to communicate with the server.', variant: 'destructive' });
        } finally {
            setQueuingFormat(null);
        }
    };

    const options = (reportSlug
        ? [
            { key: 'pdf', label: 'PDF', icon: FileText, handler: () => queueExport('PDF') },
            { key: 'excel', label: 'Excel', icon: FileSpreadsheet, handler: () => queueExport('EXCEL') },
            { key: 'csv', label: 'CSV', icon: FileType, handler: () => queueExport('CSV') },
            { key: 'word', label: 'Word', icon: FileText, handler: () => queueExport('WORD') },
        ]
        : [
            { key: 'pdf', label: 'PDF', icon: FileText, handler: onExportPDF },
            { key: 'excel', label: 'Excel', icon: FileSpreadsheet, handler: onExportExcel },
            { key: 'csv', label: 'CSV', icon: FileType, handler: onExportCSV },
            { key: 'word', label: 'Word', icon: FileText, handler: onExportWord },
        ]
    ).filter((option) => option.handler && !(hidePdf && option.key === 'pdf'));

    if (canExport === false) return null;
    if (options.length === 0) return null;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className={className} disabled={queuingFormat !== null}>
                        {queuingFormat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {label}
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    {options.map(({ key, label: optionLabel, icon: Icon, handler }) => (
                        <DropdownMenuItem key={key} onClick={() => handler?.()}>
                            <Icon className="mr-2 h-4 w-4" />
                            {optionLabel}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={!!duplicate} onOpenChange={(open) => { if (!open) setDuplicate(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Report already requested today</DialogTitle>
                        <DialogDescription>
                            A report with the same type, date range and branch was already requested today
                            {duplicate?.existingRequestId ? ` (Request ${duplicate.existingRequestId}` : ''}
                            {duplicate?.existingStatus ? `, status: ${duplicate.existingStatus})` : duplicate?.existingRequestId ? ')' : ''}.
                            Use the existing report, or request a fresh one?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDuplicate(null);
                                toast({ title: 'Using existing request', description: 'Find it in Request Report.' });
                            }}
                        >
                            Use Existing
                        </Button>
                        <Button
                            onClick={() => {
                                const format = duplicate?.format;
                                setDuplicate(null);
                                if (format) queueExport(format, true);
                            }}
                        >
                            Request Fresh
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
