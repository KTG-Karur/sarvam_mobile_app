'use client';

import { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, X } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useReactToPrint } from 'react-to-print';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { FileDown } from 'lucide-react';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { reportHeaderRows, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { compressDataUrlForPdf } from '@/app/lib/pdf/compress-image-for-pdf';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { toDisplayDate } from '@/app/lib/date-format';

type ScheduleRow = {
    installmentNo: number;
    dueDate: string;
    principal: string;
    interest: string;
    totalDue: string;
    balance: string;
    paidOn?: string;
    collectedAmount?: string;
    status?: string;
    savingsDue?: string;
    savingsPaid?: string;
};

type LoanDetails = {
    loanNumber: string;
    clientName: string;
    clientId: string;
    clientPhone?: string;
    clientPhotoUrl?: string | null;
    clientPhotoMimeType?: string | null;
    centerName: string;
    centerCode: string;
    groupName?: string;
    amount: number;
    interestRate: number;
    tenure: number;
    frequency: string;
    disbursedDate: string | null;
};

interface ScheduleDataResponse {
    loanDetails: LoanDetails;
    schedule: ScheduleRow[];
}

interface LoanSchedulePrintDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    loanId: string;
    loanNumber: string;
    clientName: string;
}

export function LoanSchedulePrintDialog({
    open,
    onOpenChange,
    loanId,
    loanNumber,
    clientName,
}: LoanSchedulePrintDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [scheduleData, setScheduleData] = useState<ScheduleDataResponse | null>(null);
    const { toast } = useToast();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open && loanId) {
            fetchScheduleData();
        }
    }, [open, loanId]);

    const fetchScheduleData = async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<ScheduleDataResponse>(`/loans/${loanId}/schedule`);

            if (result.success && result.data) {
                setScheduleData(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load schedule data.',
                    variant: 'destructive',
                });
                setScheduleData(null);
            }
        } catch (error) {
            console.error('Error fetching schedule data:', error);
            toast({
                title: 'Error',
                description: 'Failed to load schedule data. Please try again.',
                variant: 'destructive',
            });
            setScheduleData(null);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `LoanSchedule_${loanNumber}_${new Date().toISOString().split('T')[0]}`,
    });

    const handleDownloadPdf = async () => {
        if (!scheduleData) return;
        
        try {
            const { loanDetails, schedule } = scheduleData;
            
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4',
            });
            const reportFont = await ensureReportFont(doc);

            const getDataUrlFromInternalPhoto = async (): Promise<
                | { dataUrl: string; format: 'PNG' | 'JPEG' }
                | null
            > => {
                try {
                    const res = await fetch(`/api/loans/${loanId}/client-photo`);
                    if (!res.ok) return null;
                    const blob = await res.blob();
                    const mime = (blob.type || '').toLowerCase();
                    if (!mime.startsWith('image/')) return null;

                    const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = () => reject(new Error('Failed to read image'));
                        reader.readAsDataURL(blob);
                    });

                    const format: 'PNG' | 'JPEG' =
                        mime.includes('png') ? 'PNG' : 'JPEG';
                    return { dataUrl, format };
                } catch {
                    return null;
                }
            };

            // Header (trust name + report title + center/group subtitle)
            const headerY = await drawPdfReportHeader(doc, 'Loan Repayment Schedule', {
                subtitle: `${loanDetails.centerCode} - ${loanDetails.centerName}${loanDetails.groupName ? ` | ${loanDetails.groupName}` : ''}`,
                fontFamily: reportFont,
            });

        // Photo box (right) — client photo, kept as-is
            doc.setDrawColor(0);
            const rightMargin = doc.internal.pageSize.getWidth() - 35;
            doc.rect(rightMargin - 35, 10, 35, 35);
            const photo = await getDataUrlFromInternalPhoto();
            if (photo) {
                try {
                    // Source photo can be several MB at full camera resolution —
                    // this box is only 33mm, so downscale before embedding.
                    const compressed = await compressDataUrlForPdf(photo.dataUrl);
                    doc.addImage(compressed, 'JPEG', rightMargin - 34, 11, 33, 33);
                } catch {
                // keep empty box if embedding fails
                }
            }

        // Header details lines
            doc.setFont(reportFont, 'normal');
            doc.setFontSize(9);
            let detailY = headerY + 6;
            doc.text(`Client ID / Account ID   :   ${loanDetails.clientId} / ${loanDetails.loanNumber}`, 15, detailY);
            detailY += 6;
            doc.text(
                `Client Name / Phone      :   ${loanDetails.clientName} / ${loanDetails.clientPhone || '-'}`,
                15,
                detailY,
            );
            detailY += 6;
            doc.text(
                `Loan Amt / Dues / Date   :   ${formatNumber(loanDetails.amount)} / ${schedule.length} / ${formatDateLegacy(loanDetails.disbursedDate || '')}`,
                15,
                detailY,
            );

            const rows = schedule.map((r) => [
                String(r.installmentNo),
                formatDateLegacy(r.dueDate),
                formatNumber(r.principal),
                formatNumber(r.interest),
                formatNumber(r.totalDue),
                formatNumber(r.collectedAmount || '0'),
                formatNumber(r.balance),
                ...(loanAdvanceEnabled ? [formatNumber(r.savingsDue || '0'), formatNumber(r.savingsPaid || '0')] : []),
                r.paidOn ? formatDateTimeLegacy(r.paidOn) : '',
            ]);

            // Calculate column widths for full page
            const colWidths: Record<number, number> = {
                0: 10,   // #
                1: 22,   // Due Date
                2: 22,   // Due Pri
                3: 22,   // Due Int
                4: 22,   // Total
                5: 22,   // Collected
                6: 22,   // Pri Bal
                ...(loanAdvanceEnabled ? { 7: 22, 8: 22, 9: 22 } : { 7: 22 }), // Adv Due, Adv Paid, Paid On (or just Paid On)
            };

            try {
                (doc as any).autoTable({
                    startY: detailY + 8,
                    head: [
                        [
                            '#',
                            'Due Date',
                            'Due Pri',
                            'Due Int',
                            'Total',
                            'Collected',
                            'Pri Bal',
                            ...(loanAdvanceEnabled ? ['Adv Due', 'Adv Paid'] : []),
                            'Paid On',
                        ],
                    ],
                    body: rows,
                    theme: 'grid',
                    headStyles: {
                        font: reportFont,
                        fillColor: [255, 255, 255],
                        textColor: 0,
                        fontStyle: 'bold',
                        fontSize: 9,
                        halign: 'center',
                        lineWidth: 0.2,
                        lineColor: 0,
                    },
                    bodyStyles: {
                        fontSize: 8,
                        textColor: 0,
                        lineWidth: 0.2,
                        lineColor: 0,
                    },
                    styles: {
                        font: reportFont,
                        cellPadding: 2,
                        overflow: 'linebreak',
                    },
                    columnStyles: colWidths,
                    margin: { left: 15, right: 15 },
                    tableWidth: 'auto',
                    didDrawPage: function(data: any) {
                        // Footer on each page
                        const pageCount = doc.getNumberOfPages();
                        const currentPage = doc.getCurrentPageInfo().pageNumber;
                        doc.setFontSize(8);
                        doc.setTextColor(100);
                        doc.text(
                            `Printed on: ${toDisplayDate(new Date())} at ${new Date().toLocaleTimeString('en-IN')}`,
                            doc.internal.pageSize.getWidth() / 2,
                            doc.internal.pageSize.getHeight() - 10,
                            { align: 'center' }
                        );
                        
                        // Signatures on last page only
                        if (currentPage === pageCount) {
                            const finalY = data.cursor.y + 20;
                            if (finalY < doc.internal.pageSize.getHeight() - 30) {
                                doc.setDrawColor(0);
                                doc.setLineWidth(0.2);
                                
                                const pageWidth = doc.internal.pageSize.getWidth();
                                const col1 = pageWidth * 0.2;
                                const col2 = pageWidth * 0.5;
                                const col3 = pageWidth * 0.8;
                                
                                // Client Sign
                                doc.line(col1 - 20, finalY, col1 + 20, finalY);
                                doc.setFontSize(8);
                                doc.text('Client Sign', col1, finalY + 4, { align: 'center' });
                                
                                // FDO Sign
                                doc.line(col2 - 20, finalY, col2 + 20, finalY);
                                doc.text('FDO Sign', col2, finalY + 4, { align: 'center' });
                                
                                // Manager Sign
                                doc.line(col3 - 20, finalY, col3 + 20, finalY);
                                doc.text('Manager Sign', col3, finalY + 4, { align: 'center' });
                            }
                        }
                    },
                });
            } catch (autoTableError) {
                console.error('AutoTable error:', autoTableError);
            }

            const fileName = `LoanSchedule_${loanDetails.loanNumber}.pdf`;
            doc.save(fileName);

            toast({
                title: 'Exported PDF',
                description: 'The schedule report has been saved as PDF.',
            });
        } catch (error) {
            console.error('PDF generation error:', error);
            toast({
                title: 'Error',
                description: 'Failed to generate PDF. Please try again.',
                variant: 'destructive',
            });
        }
    };

    const handleDownloadExcel = () => {
        if (!scheduleData) return;

        const { loanDetails, schedule } = scheduleData;

        // Prepare data for Excel
        const excelData = [];
        
        // Add header information
        excelData.push(...reportHeaderRows('Loan Repayment Schedule'));
        excelData.push(['Generated On', toDisplayDate(new Date())]);
        excelData.push([]);
        excelData.push(['CLIENT INFORMATION']);
        excelData.push(['Client ID / Account ID', `${loanDetails.clientId} / ${loanDetails.loanNumber}`]);
        excelData.push(['Client Name / Phone', `${loanDetails.clientName} / ${loanDetails.clientPhone || 'N/A'}`]);
        excelData.push(['Loan Amount / Dues / Date', `${formatNumber(loanDetails.amount)} / ${schedule.length} / ${formatDateLegacy(loanDetails.disbursedDate || '')}`]);
        excelData.push(['Center', `${loanDetails.centerCode} - ${loanDetails.centerName}`]);
        if (loanDetails.groupName) {
            excelData.push(['Group', loanDetails.groupName]);
        }
        excelData.push([]);
        excelData.push(['SCHEDULE DETAILS']);
        excelData.push([]);
        
        // Add headers
        excelData.push([
            '#', 'Due Date', 'Due Pri', 'Due Int', 'Total', 'Collected', 'Pri Bal',
            ...(loanAdvanceEnabled ? ['Adv Due', 'Adv Paid'] : []),
            'Paid On',
        ]);

        // Add rows
        schedule.forEach(row => {
            excelData.push([
                row.installmentNo,
                formatDateLegacy(row.dueDate),
                parseFloat(row.principal),
                parseFloat(row.interest),
                parseFloat(row.totalDue),
                parseFloat(row.collectedAmount || '0'),
                parseFloat(row.balance),
                ...(loanAdvanceEnabled ? [parseFloat(row.savingsDue || '0'), parseFloat(row.savingsPaid || '0')] : []),
                row.paidOn ? formatDateTimeLegacy(row.paidOn) : '',
            ]);
        });

        // Add totals row
        excelData.push([]);
        excelData.push([
            'TOTAL',
            '',
            schedule.reduce((sum, r) => sum + parseFloat(r.principal), 0),
            schedule.reduce((sum, r) => sum + parseFloat(r.interest), 0),
            schedule.reduce((sum, r) => sum + parseFloat(r.totalDue), 0),
            schedule.reduce((sum, r) => sum + parseFloat(r.collectedAmount || '0'), 0),
            '',
            ...(loanAdvanceEnabled ? [
                schedule.reduce((sum, r) => sum + parseFloat(r.savingsDue || '0'), 0),
                schedule.reduce((sum, r) => sum + parseFloat(r.savingsPaid || '0'), 0),
            ] : []),
            ''
        ]);

        // Create worksheet
        const ws = XLSX.utils.aoa_to_sheet(excelData);

        // Set column widths
        ws['!cols'] = [
            { wch: 8 },   // #
            { wch: 12 },  // Due Date
            { wch: 12 },  // Due Pri
            { wch: 12 },  // Due Int
            { wch: 12 },  // Total
            { wch: 12 },  // Collected
            { wch: 12 },  // Pri Bal
            ...(loanAdvanceEnabled ? [{ wch: 12 }, { wch: 12 }] : []),  // Adv Due, Adv Paid
            { wch: 12 },  // Paid On
        ];
        
        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
        
        // Download
        const fileName = `Schedule_${loanDetails.loanNumber}_${loanDetails.clientName.replace(/\s+/g, '_')}.xlsx`;
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, fileName);
        
        toast({
            title: 'Download Started',
            description: `Downloading schedule for ${loanDetails.loanNumber}`,
        });
    };

    const formatDateLegacy = (dateStr: string) => {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = String(date.getFullYear()).slice(-2);
            return `${day}/${month}/${year}`;
        } catch {
            return dateStr;
        }
    };

    const formatDateTimeLegacy = (dateStr: string) => {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = String(date.getFullYear()).slice(-2);
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes}`;
        } catch {
            return dateStr;
        }
    };

    const formatNumber = (amount: number | string) => {
        const val = typeof amount === 'string' ? parseFloat(amount) : amount;
        return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(val || 0);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!max-w-none w-[90vw] max-w-[1400px] max-h-[95vh] overflow-hidden p-0">
                {/* Header */}
                <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-violet-50 to-purple-50 dark:from-brand-green-darker dark:to-sidebar-accent">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-xl font-bold text-foreground dark:text-white">
                            Loan Repayment Schedule - {loanNumber}
                        </DialogTitle>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleDownloadPdf}
                                variant="outline"
                                size="sm"
                                className="gap-2 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/30 font-medium"
                                disabled={isLoading || !scheduleData}
                            >
                                <FileDown className="h-4 w-4" />
                                Save PDF
                            </Button>
                            <Button
                                onClick={handleDownloadExcel}
                                variant="outline"
                                size="sm"
                                className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-900/30 font-medium"
                                disabled={isLoading || !scheduleData}
                            >
                                <Download className="h-4 w-4" />
                                Excel
                            </Button>
                            <Button
                                onClick={handlePrint}
                                variant="default"
                                size="sm"
                                className="gap-2 bg-violet-600 hover:bg-violet-700 shadow-md shadow-violet-500/20"
                                disabled={isLoading || !scheduleData}
                            >
                                <Printer className="h-4 w-4" />
                                Print
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                {/* Content */}
                <div className="overflow-y-auto max-h-[calc(95vh-80px)]">
                    {isLoading ? (
                        <PageLoader label="Loading schedule..." fullScreen={false} />
                    ) : scheduleData ? (
                        <div ref={printRef} className="p-6 bg-white">
                            {/* Header */}
                            <div className="mb-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <ReportHeader
                                            title={`${scheduleData.loanDetails.centerCode} - ${scheduleData.loanDetails.centerName}`}
                                            subtitle={scheduleData.loanDetails.groupName || undefined}
                                        />
                                    </div>
                                    <div className="w-20 h-24 border-2 border-black flex items-center justify-center overflow-hidden bg-gray-50 shrink-0">
                                        {scheduleData.loanDetails.clientPhotoUrl ? (
                                            <img
                                                src={`/api/loans/${loanId}/client-photo`}
                                                alt="Client"
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="text-[10px] text-gray-500 text-center">PHOTO</div>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 space-y-2 text-sm">
                                    <div>
                                        <span className="font-bold">Client ID / Account ID</span> &nbsp; : &nbsp;
                                        {scheduleData.loanDetails.clientId} / {scheduleData.loanDetails.loanNumber}
                                    </div>
                                    <div>
                                        <span className="font-bold">Client Name / Phone</span> &nbsp; : &nbsp;
                                        {scheduleData.loanDetails.clientName} / {scheduleData.loanDetails.clientPhone || '-'}
                                    </div>
                                    <div>
                                        <span className="font-bold">Loan Amt / Dues / Date</span> &nbsp; : &nbsp;
                                        {formatNumber(scheduleData.loanDetails.amount)} / {scheduleData.schedule.length} /{' '}
                                        {formatDateLegacy(scheduleData.loanDetails.disbursedDate || '')}
                                    </div>
                                </div>
                            </div>

                            {scheduleData.loanDetails.frequency?.toUpperCase() === 'DAILY' && (
                                <div className="mb-2 px-1 py-1.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700 print:bg-amber-50">
                                    Note: Daily loans start 2 days after disbursement and exclude Sundays.
                                </div>
                            )}

                            {/* Schedule Table - removed Status column */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="sticky top-0 bg-gray-100">
                                            {[
                                                '#', 'Due Date', 'Due Pri', 'Due Int', 'Total', 'Collected', 'Pri Bal',
                                                ...(loanAdvanceEnabled ? ['Adv Due', 'Adv Paid'] : []),
                                                'Paid On',
                                            ].map((h) => (
                                                <th
                                                    key={h}
                                                    className="border border-black px-3 py-2 font-bold text-center whitespace-nowrap"
                                                >
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {scheduleData.schedule.map((row, idx) => {
                                            const isPaid = String(row.status || '').toUpperCase() === 'PAID';
                                            const isPartial = String(row.status || '').toUpperCase() === 'PARTIALLY_PAID';
                                            const zebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                                            const statusBg = isPaid ? 'bg-emerald-50' : isPartial ? 'bg-amber-50' : '';

                                            return (
                                                <tr key={row.installmentNo} className={`${zebra} ${statusBg}`}>
                                                    <td className="border border-black px-3 py-2 text-center">{row.installmentNo}</td>
                                                    <td className="border border-black px-3 py-2 text-center whitespace-nowrap">
                                                        {formatDateLegacy(row.dueDate)}
                                                    </td>
                                                    <td className="border border-black px-3 py-2 text-right">{formatNumber(row.principal)}</td>
                                                    <td className="border border-black px-3 py-2 text-right">{formatNumber(row.interest)}</td>
                                                    <td className="border border-black px-3 py-2 text-right">{formatNumber(row.totalDue)}</td>
                                                    <td className="border border-black px-3 py-2 text-right">{formatNumber(row.collectedAmount || '0')}</td>
                                                    <td className="border border-black px-3 py-2 text-right">{formatNumber(row.balance)}</td>
                                                    {loanAdvanceEnabled && (
                                                        <>
                                                            <td className="border border-black px-3 py-2 text-right">{formatNumber(row.savingsDue || '0')}</td>
                                                            <td className="border border-black px-3 py-2 text-right">{formatNumber(row.savingsPaid || '0')}</td>
                                                        </>
                                                    )}
                                                    <td className="border border-black px-3 py-2 text-center whitespace-nowrap">
                                                        {row.paidOn ? formatDateTimeLegacy(row.paidOn) : ''}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-gray-100 font-bold">
                                            <td className="border border-black px-3 py-2 text-center" colSpan={2}>TOTAL</td>
                                            <td className="border border-black px-3 py-2 text-right">
                                                {formatNumber(scheduleData.schedule.reduce((sum, r) => sum + parseFloat(r.principal), 0))}
                                            </td>
                                            <td className="border border-black px-3 py-2 text-right">
                                                {formatNumber(scheduleData.schedule.reduce((sum, r) => sum + parseFloat(r.interest), 0))}
                                            </td>
                                            <td className="border border-black px-3 py-2 text-right">
                                                {formatNumber(scheduleData.schedule.reduce((sum, r) => sum + parseFloat(r.totalDue), 0))}
                                            </td>
                                            <td className="border border-black px-3 py-2 text-right">
                                                {formatNumber(scheduleData.schedule.reduce((sum, r) => sum + parseFloat(r.collectedAmount || '0'), 0))}
                                            </td>
                                            <td className="border border-black px-3 py-2 text-right">-</td>
                                            {loanAdvanceEnabled && (
                                                <>
                                                    <td className="border border-black px-3 py-2 text-right">
                                                        {formatNumber(scheduleData.schedule.reduce((sum, r) => sum + parseFloat(r.savingsDue || '0'), 0))}
                                                    </td>
                                                    <td className="border border-black px-3 py-2 text-right">
                                                        {formatNumber(scheduleData.schedule.reduce((sum, r) => sum + parseFloat(r.savingsPaid || '0'), 0))}
                                                    </td>
                                                </>
                                            )}
                                            <td className="border border-black px-3 py-2 text-center">-</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Signature Section */}
                            <div className="grid grid-cols-3 gap-8 mt-8 pt-4 border-t border-gray-400">
                                <div className="text-center">
                                    <div className="border-t border-gray-400 pt-2 mt-8">
                                        <p className="text-sm font-semibold">Client Sign</p>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <div className="border-t border-gray-400 pt-2 mt-8">
                                        <p className="text-sm font-semibold">FDO Sign</p>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <div className="border-t border-gray-400 pt-2 mt-8">
                                        <p className="text-sm font-semibold">Manager Sign</p>
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="text-center mt-4 text-[8px] text-gray-500">
                                <p>
                                    Printed on: {toDisplayDate(new Date())} at{' '}
                                    {new Date().toLocaleTimeString('en-IN')}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <p className="text-sm text-muted-foreground">
                                No schedule data available for this loan.
                            </p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}