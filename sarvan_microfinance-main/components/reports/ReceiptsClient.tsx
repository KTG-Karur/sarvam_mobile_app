'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Calendar, RefreshCw, Download, Loader2, FileText, Users, FileType, FileOutput } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { format } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { reportHeaderRows, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawReceiptsReport } from '@/app/lib/reports/receipts-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { getCentersForDropdown, type CenterOption } from '@/app/lib/actions/centers';
import { DateInput } from '@/components/ui/date-input';

type Officer = { id: string; name: string; role: string };
type BranchOption = { id: string; name: string; code: string };

type ReceiptRow = {
    sno: number;
    centerName: string;
    clientName: string;
    accountNo: string;
    loanAc: string;
    refNo: string;
    receiptDate: string;
    demandPrincipal: number;
    demandInterest: number;
    collectedPrincipal: number;
    collectedInterest: number;
    collectedSavings: number;
    totalCollected: number;
    mode: string;
    collectedBy: string;
    transactionType: string;
};

type Totals = {
    demandPrincipal: number;
    demandInterest: number;
    collectedPrincipal: number;
    collectedInterest: number;
    collectedSavings: number;
    totalCollected: number;
};

// Truncates (not rounds) to whole rupees, matches the project-wide report-amount convention.
const formatCurrency = formatReportAmount;

const formatDate = (iso: string) => {
    try {
        return format(new Date(iso), 'dd/MM/yyyy');
    } catch {
        return iso;
    }
};

const modeLabel: Record<string, string> = {
    CASH: 'Cash',
    BANK_TRANSFER: 'Bank Transfer',
    CHEQUE: 'Cheque',
    UPI: 'UPI',
    ADJUSTMENT: 'Adjustment',
};

export function ReceiptsClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const today = new Date().toISOString().split('T')[0];

    const [officers, setOfficers] = useState<Officer[]>([]);
    const [selectedOfficer, setSelectedOfficer] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [fromDate, setFromDate] = useState<string>(today);
    const [tillDate, setTillDate] = useState<string>(today);
    // Submitted (applied) date snapshot — frozen until the next Show click, so pagination and
    // exports keep using the last-submitted range even if fromDate/tillDate above are edited afterward.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);
    const [isLoading, setIsLoading] = useState(false);
    const [isOfficersLoading, setIsOfficersLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<ReceiptRow[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const PAGE_SIZE = 25;

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    const loadOfficers = useCallback(async () => {
        setIsOfficersLoading(true);
        try {
            const res = await fetch('/api/reports/collection/receipts-officers');
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || 'Failed to load officers');
            setOfficers(json.data);
        } catch {
            toast({ title: 'Error', description: 'Could not load officers list.', variant: 'destructive' });
        } finally {
            setIsOfficersLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadOfficers(); }, [loadOfficers]);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});

        getCentersForDropdown()
            .then((c) => setCenters(c))
            .catch(() => {});
    }, []);

    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the same
    // click — reading submittedFromDate/submittedTillDate here would otherwise use the
    // pre-update (stale) state, since the setSubmitted* calls in handleShow haven't re-rendered
    // yet. Callers other than handleShow omit it and get the last-submitted snapshot.
    const buildEndpoint = (pageArg: number, pageSize: number, dateOverride?: { fromDate: string; tillDate: string }) => {
        const eff = dateOverride ?? { fromDate: submittedFromDate, tillDate: submittedTillDate };
        const params = new URLSearchParams({ fromDate: eff.fromDate, toDate: eff.tillDate, page: String(pageArg), pageSize: String(pageSize) });
        if (selectedOfficer !== 'all') params.append('officerId', selectedOfficer);
        if (selectedBranch !== 'all') params.append('branchId', selectedBranch);
        if (selectedCenter !== 'all') params.append('centerId', selectedCenter);
        return `/api/reports/collection/receipts?${params}`;
    };

    const fetchPage = async (pageArg: number, dateOverride?: { fromDate: string; tillDate: string }): Promise<{ ok: boolean; count: number }> => {
        setIsLoading(true);
        try {
            const res = await fetch(buildEndpoint(pageArg, PAGE_SIZE, dateOverride));
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || 'Failed to fetch report');

            setData(json.data.rows);
            setTotals(json.data.totals);
            setTotalCount(json.data.totalCount ?? json.data.count ?? 0);
            setTotalPages(json.data.totalPages || 1);
            setPage(json.data.page ?? pageArg);
            setShowReport(true);
            return { ok: true, count: json.data.totalCount ?? json.data.count ?? 0 };
        } catch (err: any) {
            toast({ title: 'Error', description: err.message || 'Failed to fetch report data.', variant: 'destructive' });
            return { ok: false, count: 0 };
        } finally {
            setIsLoading(false);
        }
    };

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({ title: 'Date required', description: 'Please select both From Date and Till Date.', variant: 'destructive' });
            return;
        }
        if (new Date(fromDate) > new Date(tillDate)) {
            toast({ title: 'Invalid range', description: 'From Date cannot be greater than Till Date.', variant: 'destructive' });
            return;
        }

        setShowReport(false);
        setData([]);
        setTotals(null);

        const snapshot = { fromDate, tillDate };
        setSubmittedFromDate(fromDate);
        setSubmittedTillDate(tillDate);

        const { ok, count } = await fetchPage(1, snapshot);
        if (ok) {
            if (count === 0) {
                toast({ title: 'No records', description: 'No receipts found for the selected filters.' });
            } else {
                toast({ title: 'Report generated', description: `${count} receipt(s) loaded.` });
            }
        }
    };

    const handlePageChange = (p: number) => {
        fetchPage(p);
    };

    // Fetches every row matching the current filters (not just the on-screen page) —
    // used only by the export handlers below, so exports keep capturing the full
    // report instead of whatever happens to be on screen.
    const fetchAllForExport = async (): Promise<ReceiptRow[] | null> => {
        try {
            const res = await fetch(buildEndpoint(1, Math.max(totalCount, 1)));
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.message || 'Failed to fetch report');
            return json.data.rows;
        } catch (err: any) {
            toast({ title: 'Export failed', description: err.message || 'Could not load the full report for export.', variant: 'destructive' });
            return null;
        }
    };

    const handleReset = () => {
        setSelectedOfficer('all');
        setSelectedBranch('all');
        setSelectedCenter('all');
        setFromDate(today);
        setTillDate(today);
        setSubmittedFromDate(today);
        setSubmittedTillDate(today);
        setShowReport(false);
        setData([]);
        setTotals(null);
        setPage(1);
        setTotalPages(1);
        setTotalCount(0);
    };

    const handleExport = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;

        try {
            const officerName =
                selectedOfficer === 'all'
                    ? 'All Officers'
                    : officers.find((o) => o.id === selectedOfficer)?.name ?? 'Officer';

            const headerRows = [
                ...reportHeaderRows('Receipt Report'),
                [`Officer: ${officerName}`],
                [`Date Range: ${format(new Date(submittedFromDate), 'dd/MM/yyyy')} to ${format(new Date(submittedTillDate), 'dd/MM/yyyy')}`],
                [],
            ];

            const colHeaders = [
                'S.No', 'Center Name', 'Client Name', 'Account No', 'Loan A/c',
                'Ref No', 'Receipt Date', 'Demand Pri', 'Demand Int',
                'Coll. Pri', 'Coll. Int', ...(loanAdvanceEnabled ? ['Loan Advance'] : []), 'Total Collected', 'Mode', 'Collected By', 'Trans Type',
            ];

            const dataRows = fullData.map((row) => [
                row.sno,
                row.centerName,
                row.clientName,
                row.accountNo,
                row.loanAc,
                row.refNo,
                formatDate(row.receiptDate),
                truncateReportAmount(row.demandPrincipal),
                truncateReportAmount(row.demandInterest),
                truncateReportAmount(row.collectedPrincipal),
                truncateReportAmount(row.collectedInterest),
                ...(loanAdvanceEnabled ? [truncateReportAmount(row.collectedSavings)] : []),
                truncateReportAmount(row.totalCollected),
                modeLabel[row.mode] || row.mode,
                row.collectedBy,
                row.transactionType,
            ]);

            const totalRow = totals
                ? ['', '', '', '', '', '', 'GRAND TOTAL',
                    truncateReportAmount(totals.demandPrincipal), truncateReportAmount(totals.demandInterest),
                    truncateReportAmount(totals.collectedPrincipal), truncateReportAmount(totals.collectedInterest),
                    ...(loanAdvanceEnabled ? [truncateReportAmount(totals.collectedSavings)] : []), truncateReportAmount(totals.totalCollected), '', '', '']
                : [];

            const ws = XLSX.utils.aoa_to_sheet([
                ...headerRows,
                colHeaders,
                ...dataRows,
                totalRow,
            ]);
            applyExcelReportFont(ws);

            // Column widths
            ws['!cols'] = [
                { wch: 5 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 18 },
                { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
                { wch: 12 }, { wch: 12 }, ...(loanAdvanceEnabled ? [{ wch: 15 }] : []), { wch: 14 }, { wch: 20 }, { wch: 14 },
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Receipt Report');

            const fileName = `ReceiptReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedTillDate), 'ddMMMyyyy')}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({ title: 'Export successful', description: `Saved as ${fileName}` });
        } catch {
            toast({ title: 'Export failed', description: 'Could not generate Excel file.', variant: 'destructive' });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildReceiptsExportRows = (fullData: ReceiptRow[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Center Name', 'Client Name', 'Account No', 'Loan A/c',
            'Ref No', 'Receipt Date', 'Demand Pri', 'Demand Int',
            'Coll. Pri', 'Coll. Int', ...(loanAdvanceEnabled ? ['Loan Advance'] : []), 'Total Collected', 'Mode', 'Collected By', 'Trans Type',
        ];
        const rows: (string | number)[][] = fullData.map((row) => [
            row.sno, row.centerName, row.clientName, row.accountNo, row.loanAc,
            row.refNo, formatDate(row.receiptDate), truncateReportAmount(row.demandPrincipal), truncateReportAmount(row.demandInterest),
            truncateReportAmount(row.collectedPrincipal), truncateReportAmount(row.collectedInterest), ...(loanAdvanceEnabled ? [truncateReportAmount(row.collectedSavings)] : []), truncateReportAmount(row.totalCollected),
            modeLabel[row.mode] || row.mode, row.collectedBy, row.transactionType,
        ]);
        if (totals) {
            rows.push([
                '', '', '', '', '', '', 'GRAND TOTAL',
                truncateReportAmount(totals.demandPrincipal), truncateReportAmount(totals.demandInterest),
                truncateReportAmount(totals.collectedPrincipal), truncateReportAmount(totals.collectedInterest),
                truncateReportAmount(totals.collectedSavings), truncateReportAmount(totals.totalCollected), '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        const { headers, rows } = buildReceiptsExportRows(fullData);
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawReceiptsReport(doc, headers, rows, {
            subtitle: `${format(new Date(submittedFromDate), 'dd/MM/yyyy')} to ${format(new Date(submittedTillDate), 'dd/MM/yyyy')}`,
        }, reportFont);
        const fileName = `ReceiptReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedTillDate), 'ddMMMyyyy')}.pdf`;
        doc.save(fileName);
        toast({ title: 'Export successful', description: `Saved as ${fileName}` });
    };

    const handleExportCSV = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        const { headers, rows } = buildReceiptsExportRows(fullData);
        exportToCSV(
            `ReceiptReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedTillDate), 'ddMMMyyyy')}`,
            'RECEIPT REPORT',
            headers,
            rows
        );
    };

    // Word-only presentation: same rows as PDF/CSV/Excel above, but the trailing GRAND
    // TOTAL row (when present) is split off for distinct styling, and Demand/Collection
    // Principal-Interest columns get a light 2-row grouped header — a genuine recurring
    // prefix, not forced grouping. The other 10 columns stay standalone.
    const buildReceiptsWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = !!totals;
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                groupHeaders: [
                    { label: 'S.No', span: 1 },
                    { label: 'Center Name', span: 1 },
                    { label: 'Client Name', span: 1 },
                    { label: 'Account No', span: 1 },
                    { label: 'Loan A/c', span: 1 },
                    { label: 'Ref No', span: 1 },
                    { label: 'Receipt Date', span: 1 },
                    { label: 'DEMAND', span: 2 },
                    { label: 'COLLECTION', span: loanAdvanceEnabled ? 4 : 3 },
                    { label: 'Mode', span: 1 },
                    { label: 'Collected By', span: 1 },
                    { label: 'Trans Type', span: 1 },
                ],
                subHeaders: ['Principal', 'Interest', 'Principal', 'Interest', ...(loanAdvanceEnabled ? ['Loan Advance'] : []), 'Total'],
                columnAlignments: [
                    'center', 'left', 'left', 'center', 'center', 'center', 'center',
                    'right', 'right', 'right', 'right', ...(loanAdvanceEnabled ? ['right' as const] : []), 'right',
                    'center', 'left', 'center',
                ],
                columnWidthWeights: [4, 12, 14, 8, 8, 8, 8, 7, 7, 7, 7, ...(loanAdvanceEnabled ? [8] : []), 9, 7, 10, 8],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        const { headers, rows } = buildReceiptsExportRows(fullData);
        const { bodyRows, options } = buildReceiptsWordOptions(rows);
        await exportToWord(
            `ReceiptReport_${format(new Date(submittedFromDate), 'ddMMMyyyy')}_to_${format(new Date(submittedTillDate), 'ddMMMyyyy')}`,
            'RECEIPT REPORT',
            headers,
            bodyRows,
            options
        );
    };

    const selectedOfficerName =
        selectedOfficer === 'all'
            ? 'All Field Officers'
            : officers.find((o) => o.id === selectedOfficer)?.name ?? '';

    return (
        <div className="space-y-6">
            {/* Filter Card */}
            <Card className="overflow-hidden border-none bg-white/70 shadow-xl backdrop-blur-md dark:bg-brand-green-darker/40">
                <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary to-primary" />
                <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/50 bg-white/50 px-6 py-4 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/50">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-brand-green-tint p-2 text-primary dark:bg-brand-green-darker/30 dark:text-primary">
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-lg font-bold tracking-tight text-sidebar-accent dark:text-slate-100">
                                Receipt Report
                            </CardTitle>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Configure filters to generate collection receipts
                            </p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6 items-end font-sans">
                        {/* Officer */}
                        <div className="space-y-2 lg:col-span-2">
                            <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Users className="h-3 w-3" />
                                Field Officer
                            </Label>
                            <Select value={selectedOfficer} onValueChange={setSelectedOfficer} disabled={isLoading || isOfficersLoading}>
                                <SelectTrigger className="h-11 border-primary/20 bg-white shadow-sm ring-offset-white transition-all hover:bg-green-50 focus:ring-2 focus:ring-primary/20 dark:border-sidebar-accent dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80">
                                    <SelectValue placeholder="-- ALL FIELD OFFICERS --" />
                                </SelectTrigger>
                                <SelectContent className="border-primary/20 shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
                                    <SelectItem value="all" className="py-2.5 font-medium italic">-- ALL FIELD OFFICERS --</SelectItem>
                                    {officers.map((o) => (
                                        <SelectItem key={o.id} value={o.id} className="py-2.5">
                                            {o.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Branch */}
                        <div className="space-y-2 lg:col-span-2">
                            <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="h-11 border-primary/20 bg-white shadow-sm ring-offset-white transition-all hover:bg-green-50 focus:ring-2 focus:ring-primary/20 dark:border-sidebar-accent dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80">
                                    <SelectValue placeholder="-- ALL BRANCHES --" />
                                </SelectTrigger>
                                <SelectContent className="border-primary/20 shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
                                    <SelectItem value="all" className="py-2.5 font-medium italic">-- ALL BRANCHES --</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id} className="py-2.5">
                                            {b.code} - {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Center */}
                        <div className="space-y-2 lg:col-span-2">
                            <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Center
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading}>
                                <SelectTrigger className="h-11 border-primary/20 bg-white shadow-sm ring-offset-white transition-all hover:bg-green-50 focus:ring-2 focus:ring-primary/20 dark:border-sidebar-accent dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80">
                                    <SelectValue placeholder="-- ALL CENTERS --" />
                                </SelectTrigger>
                                <SelectContent className="border-primary/20 shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
                                    <SelectItem value="all" className="py-2.5 font-medium italic">-- ALL CENTERS --</SelectItem>
                                    {filteredCenters.map((c) => (
                                        <SelectItem key={c.id} value={c.id} className="py-2.5">
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* From Date */}
                        <div className="space-y-2 lg:col-span-2">
                            <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Calendar className="h-3 w-3" />
                                From Date
                            </Label>
                            <div className="group relative">
                                <DateInput
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="h-11 border-primary/20 bg-white pr-4 shadow-sm transition-all hover:bg-green-50 focus:ring-2 focus:ring-primary/20 dark:border-sidebar-accent dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        {/* Till Date */}
                        <div className="space-y-2 lg:col-span-2">
                            <Label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <Calendar className="h-3 w-3" />
                                Till Date
                            </Label>
                            <div className="group relative">
                                <DateInput
                                    value={tillDate}
                                    onChange={(e) => setTillDate(e.target.value)}
                                    className="h-11 border-primary/20 bg-white pr-4 shadow-sm transition-all hover:bg-green-50 focus:ring-2 focus:ring-primary/20 dark:border-sidebar-accent dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 lg:col-span-2">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-11 flex-1 bg-gradient-to-r from-primary to-primary font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:from-sidebar-accent hover:to-primary hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-70 dark:shadow-none"
                            >
                                {isLoading ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>
                                ) : (
                                    <>Show Report</>
                                )}
                            </Button>
                            <Button
                                onClick={handleReset}
                                disabled={isLoading}
                                variant="outline"
                                className="h-11 w-11 border-primary/20 bg-white p-0 text-slate-500 shadow-sm transition-all hover:bg-brand-green-tint hover:text-foreground active:scale-[0.98] dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-400 dark:hover:bg-sidebar-accent dark:hover:text-slate-100"
                                title="Reset filters"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Info (Visible when report is shown) */}
            {showReport && totals && (
                <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${loanAdvanceEnabled ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
                    <Card className="border-none bg-gradient-to-br from-primary to-primary p-4 text-white shadow-lg dark:from-primary dark:to-sidebar-accent">
                        <p className="text-xs font-medium text-green-100 uppercase tracking-wider">Total Records</p>
                        <p className="mt-1 text-2xl font-bold">{totalCount}</p>
                    </Card>
                    <Card className="border-none bg-gradient-to-br from-primary to-primary p-4 text-white shadow-lg dark:from-primary dark:to-primary">
                        <p className="text-xs font-medium text-primary uppercase tracking-wider">Collected Principal</p>
                        <p className="mt-1 text-2xl font-bold">₹ {formatCurrency(totals.collectedPrincipal)}</p>
                    </Card>
                    <Card className="border-none bg-gradient-to-br from-purple-500 to-purple-600 p-4 text-white shadow-lg dark:from-purple-600 dark:to-purple-700">
                        <p className="text-xs font-medium text-purple-100 uppercase tracking-wider">Collected Interest</p>
                        <p className="mt-1 text-2xl font-bold">₹ {formatCurrency(totals.collectedInterest)}</p>
                    </Card>
                    {loanAdvanceEnabled && (
                        <Card className="border-none bg-gradient-to-br from-teal-500 to-teal-600 p-4 text-white shadow-lg dark:from-teal-600 dark:to-teal-700">
                            <p className="text-xs font-medium text-teal-100 uppercase tracking-wider">Loan Advance Collected</p>
                            <p className="mt-1 text-2xl font-bold">₹ {formatCurrency(totals.collectedSavings)}</p>
                        </Card>
                    )}
                    <Card className="border-none bg-gradient-to-br from-emerald-500 to-emerald-600 p-4 text-white shadow-lg dark:from-emerald-600 dark:to-emerald-700">
                        <p className="text-xs font-medium text-emerald-100 uppercase tracking-wider">Grand Total</p>
                        <p className="mt-1 text-2xl font-bold">₹ {formatCurrency(totals.totalCollected)}</p>
                    </Card>
                </div>
            )}

            {/* Report Table */}
            {showReport && (
                <Card className="overflow-hidden border-none bg-white shadow-xl dark:bg-green-950">
                    <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <div>
                            <ReportHeader title="Receipt Report" />
                            <CardTitle className="text-base font-bold text-sidebar-accent dark:text-slate-100">
                                Detailed Statement
                            </CardTitle>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                Results for <span className="font-semibold text-sidebar-accent dark:text-slate-300">{selectedOfficerName}</span> from {format(new Date(submittedFromDate), 'dd/MM/yyyy')} to {format(new Date(submittedTillDate), 'dd/MM/yyyy')}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <ExportDropdown
                                onExportPDF={!isLoading && totalCount > 0 ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && totalCount > 0 ? handleExport : undefined}
                                onExportCSV={!isLoading && totalCount > 0 ? handleExportCSV : undefined}
                                canExport={canExportReport('receipts')}
                                onExportWord={!isLoading && totalCount > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && totalCount > 0 && getReportExportMode('receipts') === 'REQUEST_QUEUE' ? 'receipts' : undefined}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    // centerId and officerId both genuinely filter the underlying data
                                    // (fetchReceipts reads filters.centerId/officerId, matching this page's
                                    // own fetchAllForExport() query) — without officerId here, a Queue PDF
                                    // requested while an officer filter is active would silently return
                                    // unfiltered data, unlike Direct Download.
                                    filters: (selectedCenter !== 'all' || selectedOfficer !== 'all') ? {
                                        ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                                        ...(selectedOfficer !== 'all' ? { officerId: selectedOfficer } : {}),
                                    } : null,
                                }}
                                className="bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto">
                            <Table className="min-w-max w-full text-[11px]">
                                <TableHeader className="sticky top-0 z-20">
                                    <TableRow className="border-b border-primary/20 bg-brand-green-tint/80 backdrop-blur-sm dark:border-sidebar-accent dark:bg-brand-green-darker/80">
                                        {[
                                            'S.No', 'Center Name', 'Client Name', 'Account No', 'Loan A/c',
                                            'Ref No', 'Receipt Date', 'Demand Pri', 'Demand Int',
                                            'Coll. Pri', 'Coll. Int', ...(loanAdvanceEnabled ? ['Loan Advance'] : []), 'Total Collected', 'Mode', 'Collected By', 'Trans Type',
                                        ].map((h) => (
                                            <TableHead
                                                key={h}
                                                className="h-10 px-4 text-[10px] font-bold uppercase tracking-wider text-sidebar-accent dark:text-slate-400"
                                            >
                                                {h}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.map((row) => (
                                        <TableRow
                                            key={row.refNo}
                                            className="border-b border-slate-100 bg-white transition-colors hover:bg-green-50/80 dark:border-sidebar-accent dark:bg-green-950 dark:hover:bg-brand-green-darker/50"
                                        >
                                            <TableCell className="px-4 py-3 text-center font-medium text-slate-400">{row.sno}</TableCell>
                                            <TableCell className="px-4 py-3 font-semibold text-sidebar-accent dark:text-slate-200">{row.centerName}</TableCell>
                                            <TableCell className="px-4 py-3 font-medium text-sidebar-accent dark:text-slate-300">{row.clientName}</TableCell>
                                            <TableCell className="px-4 py-3 text-slate-500">{row.accountNo}</TableCell>
                                            <TableCell className="px-4 py-3 font-mono text-slate-500">{row.loanAc}</TableCell>
                                            <TableCell className="px-4 py-3 font-mono text-slate-400 uppercase">{row.refNo}</TableCell>
                                            <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-400">{formatDate(row.receiptDate)}</TableCell>
                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent">{formatCurrency(row.demandPrincipal)}</TableCell>
                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent">{formatCurrency(row.demandInterest)}</TableCell>
                                            <TableCell className="px-4 py-3 text-right font-bold text-primary dark:text-primary">{formatCurrency(row.collectedPrincipal)}</TableCell>
                                            <TableCell className="px-4 py-3 text-right font-bold text-primary dark:text-primary">{formatCurrency(row.collectedInterest)}</TableCell>
                                            {loanAdvanceEnabled && (
                                                <TableCell className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(row.collectedSavings)}</TableCell>
                                            )}
                                            <TableCell className="px-4 py-3 text-right font-black text-foreground dark:text-white">₹ {formatCurrency(row.totalCollected)}</TableCell>
                                            <TableCell className="px-4 py-3">
                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter ${row.mode === 'CASH' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/40 dark:text-primary'}`}>
                                                    {modeLabel[row.mode] || row.mode}
                                                </span>
                                            </TableCell>
                                            <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-400">{row.collectedBy}</TableCell>
                                            <TableCell className="px-4 py-3">
                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter ${row.transactionType === 'PRECLOSURE' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                                                    {row.transactionType}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                                {totals && (
                                    <tfoot className="sticky bottom-0 z-20">
                                        <TableRow className="border-t-2 border-primary/20 bg-brand-green-darker text-white dark:border-sidebar-accent dark:bg-brand-green-darker">
                                            <TableCell colSpan={7} className="px-4 py-4 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Grand Totals</TableCell>
                                            <TableCell className="px-4 py-4 text-right font-bold text-slate-300">{formatCurrency(totals.demandPrincipal)}</TableCell>
                                            <TableCell className="px-4 py-4 text-right font-bold text-slate-300">{formatCurrency(totals.demandInterest)}</TableCell>
                                            <TableCell className="px-4 py-4 text-right font-black text-primary">{formatCurrency(totals.collectedPrincipal)}</TableCell>
                                            <TableCell className="px-4 py-4 text-right font-black text-primary">{formatCurrency(totals.collectedInterest)}</TableCell>
                                            {loanAdvanceEnabled && (
                                                <TableCell className="px-4 py-4 text-right font-black text-teal-400">{formatCurrency(totals.collectedSavings)}</TableCell>
                                            )}
                                            <TableCell className="px-4 py-4 text-right font-black text-emerald-400">₹ {formatCurrency(totals.totalCollected)}</TableCell>
                                            <TableCell colSpan={3} />
                                        </TableRow>
                                    </tfoot>
                                )}
                            </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                                </p>
                                <div className="flex gap-1">
                                    <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                                        Previous
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages || isLoading}>
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Empty state */}
            {!showReport && !isLoading && (
                <Card className="group border-dashed border-primary/20 bg-green-50/50 transition-colors hover:bg-brand-green-tint/50 dark:border-sidebar-accent dark:bg-brand-green-darker/20">
                    <CardContent className="flex flex-col items-center justify-center py-20">
                        <div className="relative mb-6">
                            <div className="absolute inset-0 animate-ping rounded-full bg-brand-green-tint opacity-20 dark:bg-brand-green-darker/20" />
                            <div className="relative rounded-full bg-green-50 p-6 dark:bg-brand-green-darker/30">
                                <FileText className="h-10 w-10 text-primary dark:text-primary" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-sidebar-accent dark:text-slate-100">Ready to generate report?</h3>
                        <p className="mt-2 max-w-[300px] text-center text-sm text-slate-500 dark:text-slate-400">
                            Select an officer and time period above to view collection receipts and transaction details.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
