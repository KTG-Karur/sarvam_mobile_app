// components/loan-module/LoanIndexSheetDialog.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Printer, Download, FileText } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { getDocBrandPrimaryRgb } from '@/app/lib/reports/pdf-brand-color';
import { toDisplayDate } from '@/app/lib/date-format';

type LoanSheetDetail = {
    serialNo: number;
    id: string;
    loanNumber: string;
    clientId: string;
    clientName: string;
    clientMobile?: string;
    clientAddress?: string;
    highmarkScore?: number | null;
    highmarkStatus?: string;
    age: number | null;
    amount: number;
    purpose: string;
    frequency: string;
    tenureMonths: number;
    interestRate: number;
    disbursementStatus: string;
    arrear: number;
    outstanding: number;
    loanCycle: number;
};

type IndexSheetData = {
    indexNo: string;
    indexDate: string;
    createdAt: string;
    centerCode: string;
    centerName: string;
    centerAddress: string;
    centerContactPerson?: string;
    centerMobile?: string;
    centerMeetingDay: string;
    centerMeetingPlace: string;
    centerLeader?: string | null;
    branchName: string;
    branchCode: string;
    branchAddress: string;
    createdBy: string;
    createdByEmployeeId?: string;
    fdoName: string;
    fdoEmployeeId?: string;
    fdoMobile?: string | null;
    fdoRole?: string | null;
    bmName?: string | null;
    bmMobile?: string | null;
    bmRole?: string | null;
    amName?: string | null;
    amMobile?: string | null;
    amRole?: string | null;
    centerOutstanding: number;
    centerArrear: number;
    activeMembers: number;
    arrearMembers: number;
    totalApps: number;
    totalAmount: number;
    frequency: string;
    loans: LoanSheetDetail[];
};

interface LoanIndexSheetDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    indexId: string;
    indexNo: string;
}

export function LoanIndexSheetDialog({
    open,
    onOpenChange,
    indexId,
    indexNo,
}: LoanIndexSheetDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [sheetData, setSheetData] = useState<IndexSheetData | null>(null);
    const { toast } = useToast();
    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open && indexId) {
            fetchIndexSheetData();
        }
    }, [open, indexId]);

    const fetchIndexSheetData = async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<IndexSheetData>(`/loan-indexes/${indexId}/index-sheet`);

            if (result.success && result.data) {
                setSheetData(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load index sheet data.',
                    variant: 'destructive',
                });
                setSheetData(null);
            }
        } catch (error) {
            console.error('Error fetching index sheet data:', error);
            toast({
                title: 'Error',
                description: 'Failed to load index sheet data. Please try again.',
                variant: 'destructive',
            });
            setSheetData(null);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `LoanIndexSheet_${indexNo}_${new Date().toISOString().split('T')[0]}`,
    });

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const handleDownloadPdf = async () => {
        if (!sheetData) return;
        setIsDownloading(true);
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();
            const reportFont = await ensureReportFont(doc);

            const headerY = await drawPdfReportHeader(doc, 'Loan Index Sheet', {
                subtitle: `Index #${sheetData.indexNo}  ·  Date: ${sheetData.indexDate}`,
                fontFamily: reportFont,
            });

            autoTable(doc, {
                startY: headerY,
                body: [
                    [
                        { content: 'Center:', styles: { fontStyle: 'bold' as const } },
                        `${sheetData.centerCode} - ${sheetData.centerName}`,
                        { content: 'Branch:', styles: { fontStyle: 'bold' as const } },
                        `${sheetData.branchCode} - ${sheetData.branchName}`,
                    ],
                    [
                        { content: 'Address:', styles: { fontStyle: 'bold' as const } },
                        sheetData.centerAddress || '-',
                        { content: 'Branch Address:', styles: { fontStyle: 'bold' as const } },
                        sheetData.branchAddress || '-',
                    ],
                    [
                        { content: 'Contact Person:', styles: { fontStyle: 'bold' as const } },
                        `${sheetData.centerContactPerson || 'N/A'} (${sheetData.centerMobile || 'N/A'})`,
                        { content: 'Created By:', styles: { fontStyle: 'bold' as const } },
                        sheetData.createdBy,
                    ],
                    [
                        { content: 'Meeting:', styles: { fontStyle: 'bold' as const } },
                        `${sheetData.centerMeetingDay} at ${sheetData.centerMeetingPlace}`,
                        { content: 'FDO:', styles: { fontStyle: 'bold' as const } },
                        `${sheetData.fdoName}${sheetData.fdoEmployeeId ? ` (${sheetData.fdoEmployeeId})` : ''}`,
                    ],
                ],
                theme: 'plain',
                styles: { font: reportFont, fontSize: 8, cellPadding: 1 },
                columnStyles: {
                    0: { cellWidth: 28, fontStyle: 'bold' },
                    1: { cellWidth: 110 },
                    2: { cellWidth: 28, fontStyle: 'bold' },
                    3: { cellWidth: 110 },
                },
            });

            autoTable(doc, {
                startY: (doc as any).lastAutoTable.finalY + 3,
                head: [['Total Apps', 'Total Amount', 'Frequency', 'Center Arrear', 'Center Outstanding', 'Active Members', 'Arrear Members']],
                body: [[
                    sheetData.totalApps,
                    `Rs.${formatCurrency(sheetData.totalAmount)}`,
                    sheetData.frequency,
                    `Rs.${formatCurrency(sheetData.centerArrear)}`,
                    `Rs.${formatCurrency(sheetData.centerOutstanding)}`,
                    sheetData.activeMembers,
                    sheetData.arrearMembers,
                ]],
                theme: 'grid',
                styles: { font: reportFont, fontSize: 8, halign: 'center' as const, cellPadding: 1.5 },
                headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' as const },
            });

            autoTable(doc, {
                startY: (doc as any).lastAutoTable.finalY + 5,
                head: [['S.No', 'Loan Number', 'Client ID', 'Client Name', 'Age', 'Mobile', 'Purpose', 'Amount', 'Arrear', 'Outstanding', 'Cycle']],
                body: [
                    ...sheetData.loans.map((l) => [
                        l.serialNo, l.loanNumber, l.clientId, l.clientName, l.age ?? '-', l.clientMobile || '-',
                        l.purpose, formatCurrency(l.amount), formatCurrency(l.arrear), formatCurrency(l.outstanding), l.loanCycle,
                    ]),
                    [
                        { content: 'Total', colSpan: 7, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
                        { content: formatCurrency(sheetData.totalAmount), styles: { fontStyle: 'bold' as const } },
                        { content: formatCurrency(sheetData.loans.reduce((s, l) => s + l.arrear, 0)), styles: { fontStyle: 'bold' as const } },
                        { content: formatCurrency(sheetData.loans.reduce((s, l) => s + l.outstanding, 0)), styles: { fontStyle: 'bold' as const } },
                        '',
                    ],
                ],
                theme: 'grid',
                styles: { font: reportFont, fontSize: 7, cellPadding: 1.2 },
                headStyles: { font: reportFont, fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' as const, halign: 'center' as const },
                columnStyles: {
                    7: { halign: 'right' as const },
                    8: { halign: 'right' as const },
                    9: { halign: 'right' as const },
                },
            });

            // Signatures footer
            let finalY = (doc as any).lastAutoTable.finalY + 15;
            if (finalY > doc.internal.pageSize.getHeight() - 30) {
                doc.addPage();
                finalY = 20;
            }
            const margin = 15;
            const colWidth = (pageWidth - margin * 2) / 3;
            const signBlock = (label: string, name: string, role: string, mobile: string, colIndex: number) => {
                const x = margin + colWidth * colIndex;
                const lineWidth = colWidth - 20;
                doc.setDrawColor(0);
                doc.line(x, finalY, x + lineWidth, finalY);
                const cx = x + lineWidth / 2;
                doc.setFont(reportFont, 'bold');
                doc.setFontSize(9);
                doc.text(label, cx, finalY + 5, { align: 'center' });
                doc.setFont(reportFont, 'normal');
                doc.setFontSize(8);
                doc.text(name || '-', cx, finalY + 10, { align: 'center' });
                if (role) doc.text(role, cx, finalY + 14, { align: 'center' });
                if (mobile) doc.text(mobile, cx, finalY + 18, { align: 'center' });
            };
            signBlock('Prepared By', sheetData.fdoName || sheetData.createdBy, sheetData.fdoRole || '', sheetData.fdoMobile || '', 0);
            signBlock('Verified By', sheetData.bmName || '', sheetData.bmRole || '', sheetData.bmMobile || '', 1);
            signBlock('Approved By', sheetData.amName || '', sheetData.amRole || '', sheetData.amMobile || '', 2);

            doc.save(`LoanIndexSheet_${sheetData.indexNo}_${new Date().toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            console.error('Error generating loan index sheet PDF:', error);
            toast({
                title: 'Error',
                description: 'Failed to generate PDF. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!max-w-none w-[90vw] max-w-[1400px] max-h-[95vh] overflow-hidden p-0">
                {/* Header */}
                <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-pink-50 dark:from-brand-green-darker dark:to-sidebar-accent">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-xl font-bold text-foreground dark:text-white">
                            <div className="flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                Loan Index Sheet - {indexNo}
                            </div>
                        </DialogTitle>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleDownloadPdf}
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={isLoading || !sheetData || isDownloading}
                            >
                                {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                Download PDF
                            </Button>
                            <Button
                                onClick={handlePrint}
                                variant="default"
                                size="sm"
                                className="gap-2 bg-purple-600 hover:bg-purple-700"
                                disabled={isLoading || !sheetData}
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
                        <PageLoader label="Loading loan index sheet..." fullScreen={false} />
                    ) : sheetData ? (
                        <div ref={printRef} className="p-6 bg-white">
                            {/* Header Information */}
                            <div className="mb-6">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <ReportHeader title="Loan Index Sheet" subtitle={`Index #${sheetData.indexNo}`} />
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-semibold">Date: {sheetData.indexDate}</p>
                                        <p className="text-xs text-gray-500">Created: {sheetData.createdAt}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Center and Branch Details */}
                            <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
                                <div className="border rounded-lg p-3 bg-gray-50">
                                    <h3 className="font-bold text-purple-700 mb-2">Center Details</h3>
                                    <p><span className="font-semibold">Code/Name:</span> {sheetData.centerCode} - {sheetData.centerName}</p>
                                    <p><span className="font-semibold">Address:</span> {sheetData.centerAddress}</p>
                                    <p><span className="font-semibold">Center Leader:</span> {sheetData.centerLeader || 'N/A'}</p>
                                    <p><span className="font-semibold">Contact Person:</span> {sheetData.centerContactPerson || 'N/A'}</p>
                                    <p><span className="font-semibold">Mobile:</span> {sheetData.centerMobile || 'N/A'}</p>
                                    <p><span className="font-semibold">Meeting:</span> {sheetData.centerMeetingDay} at {sheetData.centerMeetingPlace}</p>
                                    <p><span className="font-semibold">FDO:</span> {sheetData.fdoName} {sheetData.fdoEmployeeId ? `(${sheetData.fdoEmployeeId})` : ''}</p>
                                </div>
                                <div className="border rounded-lg p-3 bg-gray-50">
                                    <h3 className="font-bold text-purple-700 mb-2">Branch Details</h3>
                                    <p><span className="font-semibold">Name:</span> {sheetData.branchName}</p>
                                    <p><span className="font-semibold">Code:</span> {sheetData.branchCode}</p>
                                    <p><span className="font-semibold">Address:</span> {sheetData.branchAddress}</p>
                                    <p><span className="font-semibold">Created By:</span> {sheetData.createdBy}</p>
                                </div>
                            </div>

                            {/* Summary */}
                            <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-6">
                                <div className="bg-purple-100 rounded-lg p-3 text-center">
                                    <p className="text-xs text-purple-600 uppercase">Total Applications</p>
                                    <p className="text-2xl font-bold text-purple-800">{sheetData.totalApps}</p>
                                </div>
                                <div className="bg-brand-green-tint rounded-lg p-3 text-center">
                                    <p className="text-xs text-primary uppercase">Total Amount</p>
                                    <p className="text-2xl font-bold text-sidebar-accent">₹{formatCurrency(sheetData.totalAmount)}</p>
                                </div>
                                <div className="bg-green-100 rounded-lg p-3 text-center">
                                    <p className="text-xs text-green-600 uppercase">Frequency</p>
                                    <p className="text-2xl font-bold text-green-800">{sheetData.frequency}</p>
                                </div>
                                <div className="bg-red-100 rounded-lg p-3 text-center">
                                    <p className="text-xs text-red-600 uppercase">Center Arrear</p>
                                    <p className="text-2xl font-bold text-red-800">₹{formatCurrency(sheetData.centerArrear)}</p>
                                </div>
                                <div className="bg-orange-100 rounded-lg p-3 text-center">
                                    <p className="text-xs text-orange-600 uppercase">Center Outstanding</p>
                                    <p className="text-2xl font-bold text-orange-800">₹{formatCurrency(sheetData.centerOutstanding)}</p>
                                </div>
                                <div className="bg-blue-100 rounded-lg p-3 text-center">
                                    <p className="text-xs text-blue-600 uppercase">Active Members</p>
                                    <p className="text-2xl font-bold text-blue-800">{sheetData.activeMembers}</p>
                                </div>
                                <div className="bg-amber-100 rounded-lg p-3 text-center">
                                    <p className="text-xs text-amber-600 uppercase">Arrear Members</p>
                                    <p className="text-2xl font-bold text-amber-800">{sheetData.arrearMembers}</p>
                                </div>
                            </div>

                            {/* Detailed Table */}
                            <div className="mt-6 overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-100">
                                            <th className="border px-2 py-1 text-xs">S.No</th>
                                            <th className="border px-2 py-1 text-xs">Loan Number</th>
                                            <th className="border px-2 py-1 text-xs">Client ID</th>
                                            <th className="border px-2 py-1 text-xs">Client Name</th>
                                            <th className="border px-2 py-1 text-xs">Age</th>
                                            <th className="border px-2 py-1 text-xs">Mobile</th>
                                            <th className="border px-2 py-1 text-xs">High Mark</th>
                                            <th className="border px-2 py-1 text-xs">Purpose</th>
                                            <th className="border px-2 py-1 text-xs">Amount</th>
                                            <th className="border px-2 py-1 text-xs">Arrear</th>
                                            <th className="border px-2 py-1 text-xs">Outstanding</th>
                                            <th className="border px-2 py-1 text-xs">Cycle</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sheetData.loans.map((loan) => (
                                            <tr key={loan.id} className="hover:bg-gray-50">
                                                <td className="border px-2 py-1 text-center font-bold">
                                                    {String(loan.serialNo).padStart(3, '0')}
                                                </td>
                                                <td className="border px-2 py-1 font-mono">
                                                    {loan.loanNumber || '-'}
                                                </td>
                                                <td className="border px-2 py-1 font-mono">
                                                    {loan.clientId}
                                                </td>
                                                <td className="border px-2 py-1">
                                                    {loan.clientName}
                                                </td>
                                                <td className="border px-2 py-1 text-center">
                                                    {loan.age !== null ? loan.age : '-'}
                                                </td>
                                                <td className="border px-2 py-1">
                                                    {loan.clientMobile || '-'}
                                                </td>
                                                <td className="border px-2 py-1 text-center font-semibold">
                                                    {loan.highmarkScore ?? loan.highmarkStatus ?? 'N/A'}
                                                </td>
                                                <td className="border px-2 py-1">
                                                    {loan.purpose}
                                                </td>
                                                <td className="border px-2 py-1 text-right font-semibold">
                                                    ₹{formatCurrency(loan.amount)}
                                                </td>
                                                <td className="border px-2 py-1 text-right text-red-700">
                                                    {loan.arrear > 0 ? `₹${formatCurrency(loan.arrear)}` : '-'}
                                                </td>
                                                <td className="border px-2 py-1 text-right">
                                                    {loan.outstanding > 0 ? `₹${formatCurrency(loan.outstanding)}` : '-'}
                                                </td>
                                                <td className="border px-2 py-1 text-center font-semibold">
                                                    {loan.loanCycle}
                                                </td>
                                                {/* <td className="border px-2 py-1 text-center">
                                                    {loan.tenureMonths}m
                                                </td>
                                                <td className="border px-2 py-1 text-center">
                                                    {loan.interestRate}%
                                                </td>
                                                <td className="border px-2 py-1">
                                                    <span className={`px-1 py-0.5 rounded text-[10px] font-semibold
                                                        ${loan.disbursementStatus === 'DISBURSED' ? 'bg-green-100 text-green-700' :
                                                          loan.disbursementStatus === 'PENDING_LEVEL2' ? 'bg-brand-green-tint text-sidebar-accent' :
                                                          loan.disbursementStatus === 'REJECTED' ? 'bg-red-100 text-red-700' :
                                                          'bg-yellow-100 text-yellow-700'}`}>
                                                        {loan.disbursementStatus}
                                                    </span>
                                                </td> */}
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-100 font-bold">
                                        <tr>
                                            <td colSpan={7} className="border px-2 py-2 text-right">
                                                Total:
                                            </td>
                                            <td className="border px-2 py-2 text-right">
                                                ₹{formatCurrency(sheetData.totalAmount)}
                                            </td>
                                            <td className="border px-2 py-2 text-right text-red-700">
                                                ₹{formatCurrency(sheetData.loans.reduce((s, l) => s + l.arrear, 0))}
                                            </td>
                                            <td className="border px-2 py-2 text-right">
                                                ₹{formatCurrency(sheetData.loans.reduce((s, l) => s + l.outstanding, 0))}
                                            </td>
                                            <td className="border px-2 py-2"></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            {/* Footer with signatures */}
                            <div className="grid grid-cols-3 gap-8 mt-8 pt-4 border-t border-gray-300">
                                <div className="text-center">
                                    <div className="border-t border-gray-400 pt-2 mt-8">
                                        <p className="text-sm font-semibold">Prepared By</p>
                                        <p className="text-xs text-gray-700">{sheetData.fdoName || sheetData.createdBy}</p>
                                        <p className="text-[11px] text-gray-500 italic">Field Development Officer (FDO)</p>
                                        <p className="text-xs text-gray-600">{sheetData.fdoMobile || ''}</p>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <div className="border-t border-gray-400 pt-2 mt-8">
                                        <p className="text-sm font-semibold">Verified By</p>
                                        <p className="text-xs text-gray-700">{sheetData.bmName || ''}</p>
                                        <p className="text-[11px] text-gray-500 italic">Branch Manager (BM)</p>
                                        <p className="text-xs text-gray-600">{sheetData.bmMobile || ''}</p>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <div className="border-t border-gray-400 pt-2 mt-8">
                                        <p className="text-sm font-semibold">Approved By</p>
                                        <p className="text-xs text-gray-700">{sheetData.amName || ''}</p>
                                        <p className="text-[11px] text-gray-500 italic">Area Manager (AM)</p>
                                        <p className="text-xs text-gray-600">{sheetData.amMobile || ''}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Print Footer */}
                            <div className="text-center mt-4 text-[10px] text-gray-500">
                                <p>
                                    Printed on: {toDisplayDate(new Date())} at{' '}
                                    {new Date().toLocaleTimeString('en-IN')}
                                </p>
                                <p className="mt-1">This is a system generated document</p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <p className="text-sm text-muted-foreground">
                                No data available for this index.
                            </p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}