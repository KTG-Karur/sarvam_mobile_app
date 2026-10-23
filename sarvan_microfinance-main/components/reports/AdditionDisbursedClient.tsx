'use client';

import { useState, useEffect } from 'react';
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
import { Calendar, RefreshCw, Download, Loader2, FileText, FileSpreadsheet, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawAdditionDisbursedReport } from '@/app/lib/reports/addition-disbursed-pdf';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';

type AdditionDisbursedData = MemberContactFields & {
    centerId: string;
    centerName: string;
    clientId: string;
    clientName: string;
    joinedDate: string;
    disbursalDate: string;
    loanAc: string;
    loanAmount: number;
    totalDues: number;
    funder: string;
    fdoName: string;
};

type BranchOption = { id: string; name: string; code: string };

// Format date as "DD/MM/YYYY"
const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    // If already in DD/MM/YYYY format, return as is
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
        return dateString;
    }
    // Try to parse ISO date string
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    } catch {
        return dateString;
    }
};

// Format currency
const formatCurrency = (amount: number): string => {
    if (amount === 0) return '';
    return formatReportAmount(amount);
};

export function AdditionDisbursedClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<AdditionDisbursedData[]>([]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    // Fetch branches + centers on mount
    useEffect(() => {
        getCentersForDropdown().then(setCenters).catch((error) => {
            console.error('Failed to fetch centers:', error);
        });

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both From Date and Till Date before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        if (new Date(fromDate) > new Date(tillDate)) {
            toast({
                title: 'Invalid date range',
                description: 'From Date cannot be greater than Till Date.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            let url = `/reports/client/addition-disbursed?fromDate=${fromDate}&tillDate=${tillDate}`;
            if (selectedCenter !== 'all') {
                url += `&centerId=${selectedCenter}`;
            }
            if (selectedBranch !== 'all') {
                url += `&branchId=${selectedBranch}`;
            }

            const response = await apiClient.get<AdditionDisbursedData[]>(url);

            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setSubmittedFromDate(fromDate);
                setSubmittedTillDate(tillDate);
                toast({
                    title: 'Report generated',
                    description: `Successfully loaded ${response.data.length} records.`,
                });
            } else {
                toast({
                    title: 'Fetch failed',
                    description: response.error || 'Failed to generate report.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching report:', error);
            toast({
                title: 'Error',
                description: 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('all');
        setFromDate(new Date().toISOString().split('T')[0]);
        setTillDate(new Date().toISOString().split('T')[0]);
        setSubmittedFromDate(new Date().toISOString().split('T')[0]);
        setSubmittedTillDate(new Date().toISOString().split('T')[0]);
        setShowReport(false);
        setData([]);
    };

    const handleExport = () => {
        if (!data || data.length === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate the report first before exporting.',
                variant: 'destructive',
            });
            return;
        }

        setIsExporting(true);
        try {
            // Use the same headers/rows (including the Grand Total row) as the
            // Excel/PDF/Word exports so CSV doesn't silently drop the totals row.
            const { headers, rows } = buildAdditionDisbursedExportRows();

            // CSV Rows (quote non-numeric cells)
            const csvRows = rows.map((r: (string | number)[]) =>
                r.map((cell) => (typeof cell === 'number' ? cell : `"${cell}"`)).join(',')
            );

            // Combine
            const csvContent = [
                headers.join(','),
                ...csvRows
            ].join('\n');

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `addition_disbursed_${submittedFromDate}_to_${submittedTillDate}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast({
                title: 'Export successful',
                description: 'Your report has been downloaded as CSV.',
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export failed',
                description: 'An error occurred during CSV generation.',
                variant: 'destructive',
            });
        } finally {
            setIsExporting(false);
        }
    };

    // Mirrors the same field mapping used by handleExport (CSV) above (kept separate so
    // handleExport is left untouched).
    const buildAdditionDisbursedExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Center Id', 'Center Name', 'Client ID', 'Client Name', 'Joined Date', 'Disbursal Date',
            'Loan A/c', 'Loan Amount', 'Total Dues', 'Funder', 'FDO Name', ...MEMBER_CONTACT_HEADERS,
        ];
        const rows: (string | number)[][] = searchedRows.map((row) => [
            row.centerId, row.centerName, row.clientId, row.clientName,
            formatDate(row.joinedDate), row.disbursalDate ? formatDate(row.disbursalDate) : '',
            row.loanAc || '', truncateReportAmount(row.loanAmount), truncateReportAmount(row.totalDues), row.funder || '', row.fdoName,
            ...memberContactValues(row),
        ]);
        if (searchedRows.length > 0) {
            const totalLoanAmount = searchedRows.reduce((sum, row) => sum + (row.loanAmount || 0), 0);
            rows.push(['Grand Total', '', '', '', '', '', '', truncateReportAmount(totalLoanAmount), '', '', '']);
        }
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAdditionDisbursedExportRows();
        const rowObjects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Client Addition Disbursed Report', rowObjects);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Addition Disbursed');
        XLSX.writeFile(wb, `addition_disbursed_${submittedFromDate}_to_${submittedTillDate}.xlsx`);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as Excel.' });
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawAdditionDisbursedReport(doc, searchedRows, { subtitle: `${formatDate(submittedFromDate)} - ${formatDate(submittedTillDate)}` }, reportFont);
        doc.save(`addition_disbursed_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as PDF.' });
    };

    // Word-only presentation: same rows as PDF above, but the trailing "Grand Total" row
    // (when present) is split off for distinct styling. 11 flat columns — no genuine
    // repeated-prefix pairs to group.
    const buildAdditionDisbursedWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: ['center', 'left', 'center', 'left', 'center', 'center', 'center', 'right', 'right', 'left', 'left'],
                columnWidthWeights: [8, 12, 8, 12, 8, 8, 8, 9, 9, 9, 10],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAdditionDisbursedExportRows();
        const { bodyRows, options } = buildAdditionDisbursedWordOptions(rows);
        await exportToWord(`addition_disbursed_${submittedFromDate}_to_${submittedTillDate}`, 'CLIENT ADDITION DISBURSED REPORT', headers, bodyRows, options);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as Word.' });
    };

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">Client Addition Disbursed Report</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger id="branchName" className="h-11">
                                    <SelectValue placeholder="-- ALL BRANCHES --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id}>
                                            {branch.code} - {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Center Name */}
                        <div className="space-y-2">
                            <Label htmlFor="centerName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Center Name
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading}>
                                <SelectTrigger id="centerName" className="h-11">
                                    <SelectValue placeholder="-- ALL CENTERS --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL CENTERS --</SelectItem>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* From Date */}
                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                From Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="fromDate"
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Till Date */}
                        <div className="space-y-2">
                            <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Till Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="tillDate"
                                    value={tillDate}
                                    onChange={(e) => setTillDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Action Buttons Row */}
                        <div className="space-y-2 md:col-span-2">
                            <Label className="text-sm font-semibold opacity-0">Actions</Label>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleShow}
                                    disabled={isLoading}
                                    className="flex-1 h-11 bg-gradient-to-r from-primary to-primary text-white shadow-lg transition-all hover:from-sidebar-accent hover:to-primary hover:shadow-xl"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Loading...
                                        </>
                                    ) : (
                                        'Show'
                                    )}
                                </Button>
                                <Button
                                    onClick={handleReset}
                                    disabled={isLoading}
                                    variant="destructive"
                                    className="h-11 shadow-lg transition-all hover:shadow-xl"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                                <ExportDropdown
                                    onExportPDF={!isLoading && !isExporting && showReport && data.length > 0 ? handleExportPDF : undefined}
                                    onExportExcel={!isLoading && !isExporting && showReport && data.length > 0 ? handleExportExcel : undefined}
                                    onExportCSV={!isLoading && !isExporting && showReport && data.length > 0 ? handleExport : undefined}
                                    onExportWord={!isLoading && !isExporting && showReport && data.length > 0 ? handleExportWord : undefined}
                                    reportSlug={!isLoading && !isExporting && showReport && data.length > 0 && getReportExportMode('addition-disbursed') === 'REQUEST_QUEUE' ? 'addition-disbursed' : undefined}
                                    canExport={canExportReport('addition-disbursed')}
                                    exportParams={{
                                        fromDate: submittedFromDate,
                                        toDate: submittedTillDate,
                                        branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                        filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                    }}
                                    className="h-11 bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-600 shadow-lg transition-all hover:from-emerald-700 hover:to-teal-700 hover:shadow-xl dark:border-emerald-600"
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-0">
                        <ReportHeader title="Client Addition Disbursed Report" />
                    </CardHeader>
                    <div className="flex flex-wrap items-center gap-4 px-6 pb-2">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search name, ID, Aadhaar, mobile..."
                            className="ml-auto"
                        />
                    </div>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-full">
                                <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0 z-10">
                                    <TableRow className="hover:bg-primary/80">
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap text-right">
                                            Center Id
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Center Name
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Client ID
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Client Name
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            {MEMBER_CONTACT_COLUMN_LABEL}
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Joined Date
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Disbursal Date
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Loan A/c
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap text-right">
                                            Loan Amount
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap text-right">
                                            Total Dues
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Funder
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            FDO Name
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={13}
                                                className="px-4 py-8 text-center text-slate-500"
                                            >
                                                No data available for the selected filters
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        searchedRows.map((row, index) => (
                                            <TableRow
                                                key={index}
                                                className={cn(
                                                    'bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80'
                                                )}
                                            >
                                                <TableCell className="px-3 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                    {row.centerId}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.centerName}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.clientId}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm font-medium text-foreground dark:text-slate-100">
                                                    {row.clientName}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sidebar-accent dark:text-slate-200">
                                                    <MemberContactCell row={row} />
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {formatDate(row.joinedDate)}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.disbursalDate ? formatDate(row.disbursalDate) : ''}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.loanAc || ''}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                    {row.loanAmount > 0 ? formatCurrency(row.loanAmount) : ''}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                    {row.totalDues > 0 ? formatCurrency(row.totalDues) : ''}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.funder || ''}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.fdoName}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <Download className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select filters and click Show to generate the Client Addition Disbursed report
                    </p>
                </Card>
            )}
        </div>
    );
}

