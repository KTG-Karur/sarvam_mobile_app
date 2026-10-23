'use client';

import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useReactToPrint } from 'react-to-print';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    FileText,
    FileSpreadsheet,
    FileType,
    Printer,
    RefreshCw,
    Filter,
    Calendar,
    Receipt,
    Download,
    Eye,
    X,
    IndianRupee,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawVoucherPrintReport } from '@/app/lib/reports/voucher-print-pdf';
import { buildReportSheet, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

interface Voucher {
    id: string;
    voucherNo: string;
    voucherType: string;
    voucherTypeLabel: string;
    transactionDate: string;
    drAccount: string;
    crAccount: string;
    amount: number;
    narration: string;
    instrumentNo: string;
    instrumentDate: string | null;
    bankName: string;
    createdBy: string;
    branch: string;
}

interface Summary {
    total: number;
    bankReceipts: number;
    cashReceipts: number;
    bankPayments: number;
    cashPayments: number;
    contras: number;
    journals: number;
    totalAmount: number;
}


const TYPE_COLORS: Record<string, string> = {
    BANK_RECEIPT: 'bg-emerald-600 hover:bg-emerald-700',
    CASH_RECEIPT: 'bg-green-600 hover:bg-green-700',
    BANK_PAYMENT: 'bg-rose-600 hover:bg-rose-700',
    CASH_PAYMENT: 'bg-red-600 hover:bg-red-700',
    CONTRA: 'bg-violet-600 hover:bg-violet-700',
    JOURNAL: 'bg-primary hover:bg-primary',
};

const formatCurrency = (amount: number) => formatReportAmount(amount);

const formatDate = (iso: string) =>
    toDisplayDate(new Date(iso));

function amountInWords(amount: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
        'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const toWords = (n: number): string => {
        if (n === 0) return '';
        if (n < 20) return ones[n] + ' ';
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' ';
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred ' + toWords(n % 100);
        if (n < 100000) return toWords(Math.floor(n / 1000)) + 'Thousand ' + toWords(n % 1000);
        if (n < 10000000) return toWords(Math.floor(n / 100000)) + 'Lakh ' + toWords(n % 100000);
        return toWords(Math.floor(n / 10000000)) + 'Crore ' + toWords(n % 10000000);
    };

    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let result = toWords(rupees).trim();
    if (paise > 0) result += ` and ${toWords(paise).trim()} Paise`;
    return result + ' Only';
}

function VoucherSlip({ voucher }: { voucher: Voucher }) {
    return (
        <div className="bg-white border-2 border-primary/30 rounded-lg p-6 font-mono text-sm">
            {/* Header */}
            <div className="text-center border-b-2 border-slate-400 pb-4 mb-4">
                <ReportHeader title={`${voucher.voucherTypeLabel.toUpperCase()} VOUCHER`} />
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-bold text-primary uppercase border border-primary px-3 py-1 rounded">
                        {voucher.voucherTypeLabel} VOUCHER
                    </span>
                    <div className="text-right text-xs text-sidebar-accent space-y-0.5">
                        <p><span className="font-semibold">Voucher No:</span> {voucher.voucherNo}</p>
                        <p><span className="font-semibold">Date:</span> {formatDate(voucher.transactionDate)}</p>
                        {voucher.branch && <p><span className="font-semibold">Branch:</span> {voucher.branch}</p>}
                    </div>
                </div>
            </div>

            {/* Dr / Cr Accounts */}
            <div className="space-y-3 mb-4">
                <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded">
                    <span className="font-bold text-green-800 w-6 shrink-0">Dr.</span>
                    <span className="font-semibold text-foreground flex-1">{voucher.drAccount}</span>
                    <span className="font-bold text-green-800 tabular-nums">₹ {formatCurrency(voucher.amount)}</span>
                </div>
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded">
                    <span className="font-bold text-red-800 w-6 shrink-0">Cr.</span>
                    <span className="font-semibold text-foreground flex-1 pl-4">{voucher.crAccount}</span>
                    <span className="font-bold text-red-800 tabular-nums">₹ {formatCurrency(voucher.amount)}</span>
                </div>
            </div>

            {/* Amount in Words */}
            <div className="border border-primary/20 rounded p-3 mb-4 bg-green-50">
                <p className="text-xs text-slate-500 font-semibold mb-1">AMOUNT IN WORDS</p>
                <p className="text-sidebar-accent font-medium capitalize">{amountInWords(voucher.amount)}</p>
            </div>

            {/* Narration */}
            {voucher.narration && (
                <div className="border border-primary/20 rounded p-3 mb-4 bg-green-50">
                    <p className="text-xs text-slate-500 font-semibold mb-1">NARRATION</p>
                    <p className="text-sidebar-accent">{voucher.narration}</p>
                </div>
            )}

            {/* Instrument Details */}
            {(voucher.instrumentNo || voucher.bankName) && (
                <div className="border border-primary/20 rounded p-3 mb-4 bg-green-50 grid grid-cols-2 gap-3">
                    {voucher.instrumentNo && (
                        <div>
                            <p className="text-xs text-slate-500 font-semibold">CHEQUE / INSTRUMENT NO</p>
                            <p className="text-sidebar-accent font-medium">{voucher.instrumentNo}</p>
                        </div>
                    )}
                    {voucher.instrumentDate && (
                        <div>
                            <p className="text-xs text-slate-500 font-semibold">INSTRUMENT DATE</p>
                            <p className="text-sidebar-accent font-medium">{formatDate(voucher.instrumentDate)}</p>
                        </div>
                    )}
                    {voucher.bankName && (
                        <div>
                            <p className="text-xs text-slate-500 font-semibold">BANK NAME</p>
                            <p className="text-sidebar-accent font-medium">{voucher.bankName}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Footer Signatures */}
            <div className="border-t-2 border-dashed border-primary/30 pt-4 mt-4 grid grid-cols-3 gap-4 text-center">
                <div>
                    <div className="h-10 border-b border-slate-400 mb-1" />
                    <p className="text-xs text-slate-500">Prepared By</p>
                    <p className="text-xs font-semibold text-sidebar-accent">{voucher.createdBy}</p>
                </div>
                <div>
                    <div className="h-10 border-b border-slate-400 mb-1" />
                    <p className="text-xs text-slate-500">Checked By</p>
                </div>
                <div>
                    <div className="h-10 border-b border-slate-400 mb-1" />
                    <p className="text-xs text-slate-500">Authorized By</p>
                </div>
            </div>
        </div>
    );
}

export default function VoucherPrintPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [voucherDate, setVoucherDate] = useState<string>(new Date().toISOString().split('T')[0]);
    // Submitted (applied) date snapshot — frozen until the next "Show Vouchers" click.
    // Print/export filenames, the on-screen subtitle, and exportParams read this, not the
    // live draft voucherDate, so editing the date input alone never changes what's shown.
    const [submittedVoucherDate, setSubmittedVoucherDate] = useState(voucherDate);
    const [isLoading, setIsLoading] = useState(false);
    const [vouchers, setVouchers] = useState<Voucher[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);

    const listPrintRef = useRef<HTMLDivElement>(null);
    const slipPrintRef = useRef<HTMLDivElement>(null);

    const fetchVouchers = async () => {
        if (!voucherDate) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Please select a voucher date.' });
            return;
        }
        setIsLoading(true);
        toast({ title: 'Loading Vouchers', description: 'Fetching vouchers for the selected date...' });
        try {
            const params = new URLSearchParams({ date: voucherDate });
            const res = await fetch(`/api/reports/voucher-print?${params}`);
            const result = await res.json();
            if (result.success) {
                setVouchers(result.data.vouchers);
                setSummary(result.data.summary);
                setSubmittedVoucherDate(voucherDate);
                toast({
                    title: 'Vouchers Loaded',
                    description: `Found ${result.data.summary.total} voucher(s) for ${formatDate(voucherDate + 'T00:00:00')}.`,
                });
            } else {
                toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to fetch vouchers.' });
            }
        } catch {
            toast({ variant: 'destructive', title: 'Network Error', description: 'Unable to connect to server.' });
        } finally {
            setIsLoading(false);
        }
    };

    // Mirrors the on-screen "TOTAL" row rendered below the vouchers table.
    const getVoucherTotal = () => vouchers.reduce((s, v) => s + v.amount, 0);

    const openPreview = (voucher: Voucher) => {
        setSelectedVoucher(voucher);
        setPreviewOpen(true);
    };

    const handlePrintList = useReactToPrint({
        contentRef: listPrintRef,
        documentTitle: `Vouchers_${submittedVoucherDate}`,
        onBeforePrint: async () => {
            if (vouchers.length === 0) {
                toast({ variant: 'destructive', title: 'No Data', description: 'No vouchers to print.' });
                throw new Error('No data');
            }
        },
    });

    const handlePrintSlip = useReactToPrint({
        contentRef: slipPrintRef,
        documentTitle: `Voucher_${selectedVoucher?.voucherNo ?? ''}`,
    });

    const handleExportExcel = useCallback(() => {
        if (vouchers.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Load vouchers first before exporting.' });
            return;
        }
        try {
            const rows = vouchers.map((v) => ({
                'Voucher No': v.voucherNo,
                'Type': v.voucherTypeLabel,
                'Date': formatDate(v.transactionDate),
                'Dr Account': v.drAccount,
                'Cr Account': v.crAccount,
                'Amount (₹)': truncateReportAmount(v.amount),
                'Narration': v.narration,
                'Instrument No': v.instrumentNo,
                'Bank Name': v.bankName,
                'Created By': v.createdBy,
                'Branch': v.branch,
            }));
            rows.push({
                'Voucher No': 'TOTAL', 'Type': '', 'Date': '', 'Dr Account': '', 'Cr Account': '',
                'Amount (₹)': truncateReportAmount(getVoucherTotal()), 'Narration': '', 'Instrument No': '', 'Bank Name': '',
                'Created By': '', 'Branch': '',
            });
            const ws = buildReportSheet("Voucher List", rows);
            ws['!cols'] = [
                { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 28 },
                { wch: 14 }, { wch: 40 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
            ];
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Vouchers');
            const fileName = `Vouchers_${submittedVoucherDate}.xlsx`;
            XLSX.writeFile(wb, fileName);
            toast({ title: 'Export Successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export Excel file.' });
        }
    }, [vouchers, submittedVoucherDate, toast]);

    const handleExportPDF = useCallback(async () => {
        if (vouchers.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Load vouchers first before exporting.' });
            return;
        }
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);

            const rows = vouchers.map((v) => [
                v.voucherNo,
                v.voucherTypeLabel,
                formatDate(v.transactionDate),
                v.drAccount,
                v.crAccount,
                formatCurrency(v.amount),
                v.narration,
            ]);
            rows.push(['TOTAL', '', '', '', '', formatCurrency(getVoucherTotal()), '']);

            await drawVoucherPrintReport(doc, rows, { subtitle: formatDate(submittedVoucherDate + 'T00:00:00') }, reportFont);

            const fileName = `Vouchers_${submittedVoucherDate}.pdf`;
            doc.save(fileName);
            toast({ title: 'Export Successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export PDF.' });
        }
    }, [vouchers, submittedVoucherDate, toast]);

    // Mirrors the same field mapping used by handleExportExcel above (kept separate so
    // handleExportExcel is left untouched).
    const buildVoucherExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Voucher No', 'Type', 'Date', 'Dr Account', 'Cr Account', 'Amount (₹)',
            'Narration', 'Instrument No', 'Bank Name', 'Created By', 'Branch',
        ];
        const rows: (string | number)[][] = vouchers.map((v) => [
            v.voucherNo, v.voucherTypeLabel, formatDate(v.transactionDate), v.drAccount, v.crAccount,
            truncateReportAmount(v.amount), v.narration, v.instrumentNo, v.bankName, v.createdBy, v.branch,
        ]);
        rows.push(['TOTAL', '', '', '', '', truncateReportAmount(getVoucherTotal()), '', '', '', '', '']);
        return { headers, rows };
    };

    const handleExportCSV = useCallback(() => {
        if (vouchers.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Load vouchers first before exporting.' });
            return;
        }
        const { headers, rows } = buildVoucherExportRows();
        exportToCSV(`Vouchers_${submittedVoucherDate}`, 'VOUCHER LIST', headers, rows);
    }, [vouchers, submittedVoucherDate, toast]);

    const handleExportWord = useCallback(async () => {
        if (vouchers.length === 0) {
            toast({ variant: 'destructive', title: 'No Data', description: 'Load vouchers first before exporting.' });
            return;
        }
        const { headers, rows } = buildVoucherExportRows();
        // Word-only presentation: same rows as CSV above, but the trailing "TOTAL" row
        // is split off for distinct styling, and Dr/Cr Account get a light 2-row
        // grouped header — genuine paired accounting fields (same Dr/Cr pattern already
        // used for Trial Balance).
        const wordOptions: WordExportOptions = {
            groupHeaders: [
                { label: 'Voucher No', span: 1 }, { label: 'Type', span: 1 }, { label: 'Date', span: 1 },
                { label: 'ACCOUNTS', span: 2 }, { label: 'Amount (₹)', span: 1 }, { label: 'Narration', span: 1 },
                { label: 'Instrument No', span: 1 }, { label: 'Bank Name', span: 1 }, { label: 'Created By', span: 1 },
                { label: 'Branch', span: 1 },
            ],
            subHeaders: ['Dr Account', 'Cr Account'],
            columnAlignments: ['center', 'center', 'center', 'left', 'left', 'right', 'left', 'center', 'left', 'left', 'left'],
            columnWidthWeights: [8, 8, 8, 12, 12, 9, 14, 9, 10, 9, 9],
            totalsRow: rows[rows.length - 1],
        };
        await exportToWord(`Vouchers_${submittedVoucherDate}`, 'VOUCHER LIST', headers, rows.slice(0, -1), wordOptions);
    }, [vouchers, submittedVoucherDate, toast]);

    const handleExportSlipPDF = useCallback(async () => {
        if (!selectedVoucher) return;
        try {
            const v = selectedVoucher;
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            const pw = doc.internal.pageSize.width;

            const headerY = await drawPdfReportHeader(doc, `${v.voucherTypeLabel.toUpperCase()} VOUCHER`, {
                fontFamily: reportFont,
            });

            doc.setFontSize(9);
            doc.setFont(reportFont, 'normal');
            doc.text(`Voucher No: ${v.voucherNo}`, 14, headerY + 4);
            doc.text(`Date: ${formatDate(v.transactionDate)}`, pw - 14, headerY + 4, { align: 'right' });
            if (v.branch) doc.text(`Branch: ${v.branch}`, 14, headerY + 10);

            doc.setLineWidth(0.5);
            doc.line(14, headerY + 14, pw - 14, headerY + 14);

            autoTable(doc, {
                head: [['', 'Account', 'Amount (₹)']],
                body: [
                    ['Dr.', v.drAccount, formatCurrency(v.amount)],
                    ['Cr.', v.crAccount, formatCurrency(v.amount)],
                ],
                startY: headerY + 18,
                theme: 'grid',
                headStyles: { font: reportFont, fillColor: [67, 56, 202], textColor: 255 },
                columnStyles: { 0: { cellWidth: 12, fontStyle: 'bold' }, 2: { halign: 'right', cellWidth: 40 } },
                styles: { font: reportFont, fontSize: 10 },
            });

            let y = (doc as any).lastAutoTable.finalY + 8;

            doc.setFontSize(9);
            doc.setFont(reportFont, 'bold');
            doc.text('Amount in Words:', 14, y);
            doc.setFont(reportFont, 'normal');
            const words = doc.splitTextToSize(amountInWords(v.amount), pw - 28);
            doc.text(words, 14, y + 5);
            y += 5 + words.length * 5 + 5;

            if (v.narration) {
                doc.setFont(reportFont, 'bold');
                doc.text('Narration:', 14, y);
                doc.setFont(reportFont, 'normal');
                const narLines = doc.splitTextToSize(v.narration, pw - 28);
                doc.text(narLines, 14, y + 5);
                y += 5 + narLines.length * 5 + 5;
            }

            if (v.instrumentNo || v.bankName) {
                if (v.instrumentNo) { doc.setFont(reportFont, 'bold'); doc.text('Instrument No:', 14, y); doc.setFont(reportFont, 'normal'); doc.text(v.instrumentNo, 50, y); }
                if (v.bankName) { doc.setFont(reportFont, 'bold'); doc.text('Bank:', pw / 2, y); doc.setFont(reportFont, 'normal'); doc.text(v.bankName, pw / 2 + 14, y); }
                y += 8;
            }

            y += 10;
            const sigY = y + 20;
            const cols = [pw * 0.2, pw * 0.5, pw * 0.8];
            const labels = ['Prepared By', 'Checked By', 'Authorized By'];
            cols.forEach((x, i) => {
                doc.line(x - 25, sigY, x + 25, sigY);
                doc.setFontSize(8);
                doc.text(labels[i], x, sigY + 5, { align: 'center' });
                if (i === 0) doc.text(v.createdBy, x, sigY + 10, { align: 'center' });
            });

            doc.save(`Voucher_${v.voucherNo}.pdf`);
            toast({ title: 'Export Successful', description: `Voucher slip saved as Voucher_${v.voucherNo}.pdf` });
        } catch {
            toast({ variant: 'destructive', title: 'Export Failed', description: 'Failed to export voucher slip PDF.' });
        }
    }, [selectedVoucher, toast]);

    return (
        <ProtectedRoute requiredRoles={['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER']}>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">

                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <Receipt className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Voucher Print
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    View, preview and print accounting voucher slips
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    {summary && (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
                            {[
                                { label: 'Total', value: summary.total, color: 'indigo' },
                                { label: 'Bank Receipts', value: summary.bankReceipts, color: 'emerald' },
                                { label: 'Cash Receipts', value: summary.cashReceipts, color: 'green' },
                                { label: 'Bank Payments', value: summary.bankPayments, color: 'rose' },
                                { label: 'Cash Payments', value: summary.cashPayments, color: 'red' },
                                { label: 'Contras', value: summary.contras, color: 'violet' },
                                { label: 'Journals', value: summary.journals, color: 'blue' },
                            ].map(({ label, value, color }) => (
                                <Card key={label} className={`border-2 border-${color}-200/50 bg-gradient-to-br from-${color}-50 to-${color}-50/30 dark:from-${color}-950/20`}>
                                    <CardContent className="pt-4 pb-3 px-4">
                                        <p className={`text-xs font-medium text-${color}-700 dark:text-${color}-300`}>{label}</p>
                                        <p className={`text-2xl font-bold text-${color}-900 dark:text-${color}-100 mt-1`}>{value}</p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 dark:bg-brand-green-darker/30">
                                        <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Voucher Filters</CardTitle>
                                        <CardDescription>Select date and type to view vouchers</CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ExportDropdown
                                        onExportPDF={vouchers.length > 0 ? handleExportPDF : undefined}
                                        onExportExcel={vouchers.length > 0 ? handleExportExcel : undefined}
                                        onExportCSV={vouchers.length > 0 ? handleExportCSV : undefined}
                                        onExportWord={vouchers.length > 0 ? handleExportWord : undefined}
                                        reportSlug={vouchers.length > 0 && getReportExportMode('voucher-print') === 'REQUEST_QUEUE' ? 'voucher-print' : undefined}
                                        canExport={canExportReport('voucher-print')}
                                        exportParams={{
                                            fromDate: submittedVoucherDate,
                                            branchIds: 'ALL',
                                        }}
                                        className="border-green-300 text-green-700 hover:bg-green-50"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePrintList()}
                                        disabled={vouchers.length === 0}
                                        className="border-primary/30 text-sidebar-accent hover:bg-green-50 disabled:opacity-40"
                                    >
                                        <Printer className="h-4 w-4 mr-2" />
                                        Print List
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="voucherDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Voucher Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="voucherDate"
                                        value={voucherDate}
                                        onChange={(e) => setVoucherDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
                                    <Button
                                        onClick={fetchVouchers}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-primary to-primary hover:from-primary hover:to-sidebar-accent text-white shadow-lg shadow-primary/30"
                                    >
                                        {isLoading ? (
                                            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                                        ) : (
                                            <><Calendar className="h-4 w-4 mr-2" />Show Vouchers</>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Vouchers List */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />

                        <div ref={listPrintRef}>
                            <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker border-b print:border-none">
                                <ReportHeader
                                    title="VOUCHER LIST"
                                    subtitle={formatDate(submittedVoucherDate + 'T00:00:00')}
                                />
                                {summary && (
                                    <p className="text-sm text-slate-500 text-center -mt-2">
                                        Total: {summary.total} vouchers &nbsp;|&nbsp; Amount: ₹ {formatCurrency(summary.totalAmount)}
                                    </p>
                                )}
                            </CardHeader>

                            <CardContent className="p-0">
                                {isLoading ? (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                                        <RefreshCw className="h-10 w-10 mb-3 animate-spin text-primary" />
                                        <p className="text-lg font-medium">Loading vouchers...</p>
                                    </div>
                                ) : vouchers.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-slate-400">
                                        <Receipt className="h-12 w-12 mb-3 opacity-30" />
                                        <p className="text-lg font-medium">No vouchers found</p>
                                        <p className="text-sm">Select a date and click &quot;Show Vouchers&quot;</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-brand-green-tint dark:bg-sidebar-accent/50 hover:bg-brand-green-tint dark:hover:bg-sidebar-accent/50">
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100 w-12 print:hidden">#</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100 print:hidden">Preview</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100">Voucher No</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100">Type</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100">Date</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100">Dr Account</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100">Cr Account</TableHead>
                                                    <TableHead className="text-right font-bold text-foreground dark:text-slate-100 w-36">Amount (₹)</TableHead>
                                                    <TableHead className="font-bold text-foreground dark:text-slate-100">Narration</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {vouchers.map((voucher, index) => (
                                                    <TableRow
                                                        key={voucher.id}
                                                        className={cn(
                                                            'transition-colors hover:bg-green-50/50 dark:hover:bg-brand-green-darker/20',
                                                            index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                        )}
                                                    >
                                                        <TableCell className="text-slate-500 text-sm print:hidden">{index + 1}</TableCell>
                                                        <TableCell className="print:hidden">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => openPreview(voucher)}
                                                                className="border-primary text-primary hover:bg-green-50 h-8 px-2"
                                                            >
                                                                <Eye className="h-3.5 w-3.5 mr-1" />
                                                                Preview
                                                            </Button>
                                                        </TableCell>
                                                        <TableCell className="font-mono font-semibold text-primary dark:text-primary text-sm">
                                                            {voucher.voucherNo}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge className={cn('text-xs', TYPE_COLORS[voucher.voucherType] ?? 'bg-sidebar-accent/80')}>
                                                                {voucher.voucherTypeLabel}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                            {formatDate(voucher.transactionDate)}
                                                        </TableCell>
                                                        <TableCell className="font-medium text-foreground dark:text-slate-100 text-sm">
                                                            {voucher.drAccount}
                                                        </TableCell>
                                                        <TableCell className="font-medium text-foreground dark:text-slate-100 text-sm">
                                                            {voucher.crAccount}
                                                        </TableCell>
                                                        <TableCell className="text-right font-semibold text-primary dark:text-primary tabular-nums">
                                                            {formatCurrency(voucher.amount)}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-sidebar-accent dark:text-slate-400 max-w-xs truncate">
                                                            {voucher.narration || '—'}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}

                                                {/* Total Row */}
                                                <TableRow className="bg-primary dark:bg-brand-green-darker/40 border-t-2 border-primary dark:border-primary font-bold">
                                                    <TableCell colSpan={7} className="text-right text-foreground dark:text-primary pr-4 print:hidden">
                                                        TOTAL
                                                    </TableCell>
                                                    <TableCell colSpan={6} className="text-right text-foreground dark:text-primary pr-4 hidden print:table-cell">
                                                        TOTAL
                                                    </TableCell>
                                                    <TableCell className="text-right text-foreground dark:text-primary tabular-nums">
                                                        {formatCurrency(getVoucherTotal())}
                                                    </TableCell>
                                                    <TableCell className="print:hidden" />
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </div>
                    </Card>

                    {/* Footer */}
                    {vouchers.length > 0 && (
                        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400 print:hidden">
                            <p>Generated on {toDisplayDateTime(new Date())}</p>
                            <p className="flex items-center gap-1">
                                <IndianRupee className="h-3.5 w-3.5" />
                                Total: <span className="font-semibold text-primary dark:text-primary ml-1">
                                    {formatCurrency(getVoucherTotal())}
                                </span>
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Voucher Preview Dialog */}
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <div className="flex items-center justify-between">
                            <DialogTitle className="text-lg font-bold text-foreground">
                                Voucher Slip — {selectedVoucher?.voucherNo}
                            </DialogTitle>
                            <div className="flex items-center gap-2 print:hidden">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleExportSlipPDF}
                                    className="border-primary text-primary hover:bg-green-50 h-8"
                                >
                                    <FileText className="h-3.5 w-3.5 mr-1" />
                                    PDF
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handlePrintSlip()}
                                    className="border-primary/30 text-sidebar-accent hover:bg-green-50 h-8"
                                >
                                    <Printer className="h-3.5 w-3.5 mr-1" />
                                    Print
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setPreviewOpen(false)}
                                    className="h-8 w-8 p-0"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </DialogHeader>

                    <div ref={slipPrintRef} className="mt-2">
                        {selectedVoucher && <VoucherSlip voucher={selectedVoucher} />}
                    </div>
                </DialogContent>
            </Dialog>
        </ProtectedRoute>
    );
}
