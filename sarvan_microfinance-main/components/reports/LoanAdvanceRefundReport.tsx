'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar, RefreshCw, Filter, Undo2, FileSpreadsheet, RotateCcw, DollarSign, Clock, Wallet } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx-js-style';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { getDocBrandPrimaryRgb } from '@/app/lib/reports/pdf-brand-color';
import { autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { DateInput } from '@/components/ui/date-input';
import type { LoanAdvanceRefundRow } from '@/app/lib/actions/reports';

type StatusFilter = 'ALL' | 'INITIATED' | 'GIVEN' | 'REJECTED';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
    { value: 'ALL', label: 'All' },
    { value: 'INITIATED', label: 'Initiated (pending approval)' },
    { value: 'GIVEN', label: 'Given' },
    { value: 'REJECTED', label: 'Rejected' },
];

const STATUS_STYLES: Record<LoanAdvanceRefundRow['status'], string> = {
    Initiated: 'border-amber-300 bg-amber-50 text-amber-800',
    Given: 'border-green-300 bg-green-50 text-green-800',
    Rejected: 'border-red-300 bg-red-50 text-red-800',
};

const HEADERS = [
    'S.No.', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name',
    'Centre ID', 'Center Name', 'FDO Name', 'Member ID', 'Member Name', 'Phone Number', 'Aadhaar Number', 'Loan ID',
    'Advance Balance At Initiation', 'Refund Amount', 'Balance After Refund', 'Current Advance Balance',
    'Status', 'Initiated By', 'Initiated Date', 'Initiated Time',
    'Given/Rejected By', 'Given/Rejected Date', 'Given/Rejected Time',
    'Remarks', 'Review Remarks', 'GL Voucher No',
];

const todayIstYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const dash = (v: string) => (v ? v : '—');
const money = (v: number | null) => (v === null ? '—' : formatReportAmount(v));

type Option = { id: string; name: string; code: string; branchId?: string };

export default function LoanAdvanceRefundReport() {
    const { toast } = useToast();
    const { canExportReport } = usePermission();
    const [branches, setBranches] = useState<Option[]>([]);
    const [centers, setCenters] = useState<Option[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    // One date range; the server applies it to each row's own date (initiated / given / rejected).
    const [fromDate, setFromDate] = useState(todayIstYmd());
    const [tillDate, setTillDate] = useState(todayIstYmd());
    const [submittedLabel, setSubmittedLabel] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [data, setData] = useState<LoanAdvanceRefundRow[]>([]);

    const filteredCenters = selectedBranch === 'all' ? centers : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        (async () => {
            try {
                const [centerRes, branchRes] = await Promise.all([
                    apiClient.get<Option[]>('/centers'),
                    apiClient.get<Option[]>('/branches'),
                ]);
                if (centerRes.success && centerRes.data) setCenters(centerRes.data);
                if (branchRes.success && branchRes.data) setBranches(branchRes.data);
            } catch (error) {
                console.error('Error loading filters:', error);
                toast({ title: 'Error', description: 'Failed to load branch/center lists.', variant: 'destructive' });
            }
        })();
    }, [toast]);

    const totals = useMemo(() => {
        const given = data.filter((r) => r.status === 'Given');
        const initiated = data.filter((r) => r.status === 'Initiated');
        const sum = (rows: LoanAdvanceRefundRow[]) => rows.reduce((s, r) => s + r.refundAmount, 0);
        // Current balance is per member — count each member once.
        const byMember = new Map<string, number>();
        data.forEach((r) => byMember.set(r.memberId, r.currentAdvanceBalance));
        const stillInAdvance = Array.from(byMember.values()).reduce((s, v) => s + v, 0);
        return {
            requests: data.length,
            refunded: sum(given),
            givenCount: given.length,
            pending: sum(initiated),
            pendingCount: initiated.length,
            stillInAdvance,
        };
    }, [data]);

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({ title: 'Required Fields', description: 'Please select both From and Till dates.', variant: 'destructive' });
            return;
        }
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ status });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
            params.set('fromDate', fromDate);
            params.set('tillDate', tillDate);
            const result = await apiClient.get<LoanAdvanceRefundRow[]>(`/reports/portfolio/loan-advance-refund?${params}`);
            if (result.success && result.data) {
                setData(result.data);
                setSubmittedLabel(`${fromDate} to ${tillDate}`);
                toast({
                    title: result.data.length === 0 ? 'No Data Found' : 'Success',
                    description: result.data.length === 0
                        ? 'No loan advance refunds found for the selected criteria.'
                        : `Loaded ${result.data.length} refund records.`,
                });
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to fetch report.', variant: 'destructive' });
            }
        } catch (error) {
            console.error('Error fetching report:', error);
            toast({ title: 'Error', description: 'Failed to fetch report.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('all');
        setStatus('ALL');
        setFromDate(todayIstYmd());
        setTillDate(todayIstYmd());
        setSubmittedLabel('');
        setData([]);
    };

    const buildRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const num = (v: number | null) => (v === null ? '' : truncateReportAmount(v));
        const rows: (string | number)[][] = data.map((r) => [
            r.slNo, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName,
            r.centreId, r.centerName, r.fdoName, r.memberId, r.memberName, r.phoneNumber, r.aadhaarNumber, r.loanId,
            num(r.advanceAtInitiation), num(r.refundAmount), num(r.balanceAfterRefund), num(r.currentAdvanceBalance),
            r.status, r.initiatedBy, r.initiatedDate, r.initiatedTime,
            r.reviewedBy, r.reviewedDate, r.reviewedTime,
            r.remarks, r.reviewRemarks, r.voucherNo,
        ]);
        if (data.length > 0) {
            // Grand-total row: label in column 2, total refunded under "Refund Amount" (column 16).
            const total: (string | number)[] = Array(HEADERS.length).fill('');
            total[1] = `Total Given (${totals.givenCount})`;
            total[15] = truncateReportAmount(totals.refunded);
            rows.push(total);
        }
        return { headers: HEADERS, rows };
    };

    const fileBase = () => `Loan_Advance_Refund_Report_${todayIstYmd()}`;

    const guardEmpty = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return true;
        }
        return false;
    };

    const handleExportExcel = () => {
        if (guardEmpty()) return;
        try {
            const { headers, rows } = buildRows();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Loan Advance Refund');
            XLSX.writeFile(wb, `${fileBase()}.xlsx`);
            toast({ title: 'Export Successful', description: 'Excel file has been downloaded.' });
        } catch (error) {
            console.error('Export error:', error);
            toast({ title: 'Export Failed', description: 'An error occurred while generating the Excel file.', variant: 'destructive' });
        }
    };

    const handleExportCSV = () => {
        if (guardEmpty()) return;
        const { headers, rows } = buildRows();
        exportToCSV(fileBase(), 'LOAN ADVANCE REFUND REPORT', headers, rows);
    };

    const handleExportPDF = async () => {
        if (guardEmpty()) return;
        const { headers, rows } = buildRows();
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        const headerY = await drawPdfReportHeader(doc, 'LOAN ADVANCE REFUND REPORT', { subtitle: submittedLabel, fontFamily: reportFont });
        autoTable(doc, {
            startY: headerY,
            head: [headers],
            body: rows,
            styles: { font: reportFont, fontSize: 6 },
            headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' },
        });
        doc.save(`${fileBase()}.pdf`);
        toast({ title: 'Export Successful', description: 'PDF has been downloaded.' });
    };

    const th = 'font-bold text-white text-[10px] whitespace-nowrap uppercase';
    const td = 'text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap';
    const labelCls = 'text-sm font-semibold text-sidebar-accent dark:text-slate-200';
    const triggerCls = 'h-11 w-full border-primary/30 bg-white dark:border-sidebar-accent dark:bg-green-950';

    const dateField = (id: string, label: string, value: string, onChange: (v: string) => void) => (
        <div className="space-y-2">
            <Label htmlFor={id} className={labelCls}>{label}</Label>
            <div className="relative">
                <DateInput
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                />
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
        </div>
    );

    const cards = [
        { label: 'Total Requests', value: String(totals.requests), sub: 'In this report', Icon: FileSpreadsheet },
        { label: 'Given', value: `₹ ${formatReportAmount(totals.refunded)}`, sub: `${totals.givenCount} approved`, Icon: DollarSign },
        { label: 'Pending (Initiated)', value: `₹ ${formatReportAmount(totals.pending)}`, sub: `${totals.pendingCount} awaiting approval`, Icon: Clock },
        { label: 'Still In Advance', value: `₹ ${formatReportAmount(totals.stillInAdvance)}`, sub: 'Current member balances', Icon: Wallet },
    ];

    return (
        <ProtectedRoute requiredPermission="LOAN_ADVANCE_REFUND_REPORT">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    <div className="mb-8 flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Undo2 className="h-7 w-7 text-white" />
                        </div>
                        <div className="flex-1">
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Loan Advance Refund Report
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Refund requests with who initiated and approved them, when, and how much is refunded or still held
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        {cards.map(({ label, value, sub, Icon }) => (
                            <Card key={label} className="border-2 border-primary/30 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                                <CardContent className="pt-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">{label}</p>
                                            <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">{value}</p>
                                            <p className="text-xs text-primary mt-1">{sub}</p>
                                        </div>
                                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                            <Icon className="h-6 w-6 text-primary" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <Filter className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Report Filters</CardTitle>
                                    <CardDescription>
                                        Select the From and Till dates. The date applies to each row by its status: Initiated by initiated date, Given by approved date, Rejected by rejected date.
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6 space-y-6">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                                <div className="space-y-2">
                                    <Label htmlFor="branchSelect" className={labelCls}>Branch</Label>
                                    <Select value={selectedBranch} onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}>
                                        <SelectTrigger id="branchSelect" className={triggerCls}><SelectValue placeholder="-- ALL BRANCHES --" /></SelectTrigger>
                                        <SelectContent className="max-h-[min(20rem,50vh)]">
                                            <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="centerSelect" className={labelCls}>Center</Label>
                                    <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                        <SelectTrigger id="centerSelect" className={triggerCls}><SelectValue placeholder="Select center" /></SelectTrigger>
                                        <SelectContent className="max-h-[min(20rem,50vh)]">
                                            <SelectItem value="all">All centers</SelectItem>
                                            {filteredCenters.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="statusSelect" className={labelCls}>Status</Label>
                                    <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                                        <SelectTrigger id="statusSelect" className={triggerCls}><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {STATUS_OPTIONS.map((o) => (
                                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 lg:items-end">
                                {dateField('fromDate', 'From date *', fromDate, setFromDate)}
                                {dateField('tillDate', 'Till date *', tillDate, setTillDate)}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    onClick={handleShow}
                                    disabled={isLoading}
                                    className="h-11 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                >
                                    {isLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
                                    {isLoading ? 'Loading...' : 'Show'}
                                </Button>
                                <ExportDropdown
                                    onExportPDF={handleExportPDF}
                                    onExportExcel={handleExportExcel}
                                    onExportCSV={handleExportCSV}
                                    canExport={canExportReport('loan-advance-refund')}
                                    className="h-11 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                />
                                <Button
                                    onClick={handleReset}
                                    variant="outline"
                                    className="h-11 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                >
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                    Reset
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Undo2 className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Loan Advance Refunds</CardTitle>
                                        <CardDescription>{submittedLabel || 'Select filters and click Show'}</CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-sm px-3 py-1 bg-white dark:bg-green-950">{data.length} Records</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-primary to-primary dark:from-sidebar-accent dark:to-primary hover:from-primary hover:to-primary">
                                            {HEADERS.map((h, i) => (
                                                <TableHead key={h} className={cn(th, i === 0 && 'text-center', i >= 14 && i <= 17 && 'text-right')}>{h}</TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={HEADERS.length} className="h-32 text-center text-slate-500">
                                                    No data available. Select filters and click &quot;Show&quot;.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.map((r, index) => (
                                                <TableRow
                                                    key={`${r.slNo}-${r.memberId}-${r.initiatedDate}-${r.initiatedTime}`}
                                                    className={cn(
                                                        'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                        index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                    )}
                                                >
                                                    <TableCell className={cn(td, 'text-center font-mono')}>{r.slNo}</TableCell>
                                                    <TableCell className={td}>{r.regionName}</TableCell>
                                                    <TableCell className={td}>{r.divisionName}</TableCell>
                                                    <TableCell className={td}>{r.areaName}</TableCell>
                                                    <TableCell className={cn(td, 'font-mono')}>{r.branchId}</TableCell>
                                                    <TableCell className={td}>{r.branchName}</TableCell>
                                                    <TableCell className={cn(td, 'font-mono')}>{r.centreId}</TableCell>
                                                    <TableCell className={td}>{r.centerName}</TableCell>
                                                    <TableCell className={td}>{r.fdoName}</TableCell>
                                                    <TableCell className={cn(td, 'font-mono')}>{r.memberId}</TableCell>
                                                    <TableCell className={td}>{r.memberName}</TableCell>
                                                    <TableCell className={td}>{r.phoneNumber}</TableCell>
                                                    <TableCell className={td}>{r.aadhaarNumber}</TableCell>
                                                    <TableCell className={cn(td, 'font-mono')}>{r.loanId}</TableCell>
                                                    <TableCell className={cn(td, 'text-right')}>{money(r.advanceAtInitiation)}</TableCell>
                                                    <TableCell className={cn(td, 'text-right font-semibold')}>{money(r.refundAmount)}</TableCell>
                                                    <TableCell className={cn(td, 'text-right')}>{money(r.balanceAfterRefund)}</TableCell>
                                                    <TableCell className={cn(td, 'text-right')}>{money(r.currentAdvanceBalance)}</TableCell>
                                                    <TableCell className={td}>
                                                        <Badge variant="outline" className={STATUS_STYLES[r.status]}>{r.status}</Badge>
                                                    </TableCell>
                                                    <TableCell className={td}>{r.initiatedBy}</TableCell>
                                                    <TableCell className={td}>{r.initiatedDate}</TableCell>
                                                    <TableCell className={td}>{r.initiatedTime}</TableCell>
                                                    <TableCell className={td}>{dash(r.reviewedBy)}</TableCell>
                                                    <TableCell className={td}>{dash(r.reviewedDate)}</TableCell>
                                                    <TableCell className={td}>{dash(r.reviewedTime)}</TableCell>
                                                    <TableCell className={cn(td, 'max-w-[200px] truncate')} title={r.remarks}>{dash(r.remarks)}</TableCell>
                                                    <TableCell className={cn(td, 'max-w-[200px] truncate')} title={r.reviewRemarks}>{dash(r.reviewRemarks)}</TableCell>
                                                    <TableCell className={cn(td, 'font-mono')}>{dash(r.voucherNo)}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ProtectedRoute>
    );
}
