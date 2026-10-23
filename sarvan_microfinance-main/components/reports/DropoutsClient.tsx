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
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { getPersonLabel } from '@/app/lib/person-label';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawDropoutsReport } from '@/app/lib/reports/dropouts-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';

type DropoutsData = MemberContactFields & {
    centerId: string;
    centerName: string;
    clientId: string;
    /** Had at least one Loan record (any status) — false means was still a Member, never became a Client */
    hasLoan?: boolean;
    clientName: string;
    joinedDate: string | null;
    lastLoanDisbursedDate: string | null;
    loanAc: string;
    lastLoanClosedDate: string | null;
    inactiveDate: string | null;
    reason: string;
    fdoName: string;
};

// Format date as "DD/MM/YYYY"
const formatDate = (dateString: string | null | undefined): string => {
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

type BranchOption = { id: string; name: string; code: string };

export function DropoutsClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
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
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<DropoutsData[]>([]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        const fetchCenters = async () => {
            try {
                const centerOptions = await getCentersForDropdown();
                setCenters(centerOptions);
            } catch (error) {
                console.error("Failed to fetch centers:", error);
                toast({
                    title: "Error",
                    description: "Failed to load centers list.",
                    variant: "destructive",
                });
            }
        };
        fetchCenters();

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, [toast]);

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
            const queryParams = new URLSearchParams({
                fromDate,
                tillDate,
                centerId: selectedCenter,
            });
            if (selectedBranch !== 'all') queryParams.set('branchId', selectedBranch);

            const response = await fetch(`/api/reports/client/dropouts?${queryParams}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch report');
            }

            const result = await response.json();
            setData(result);
            setShowReport(true);
            setSubmittedFromDate(fromDate);
            setSubmittedTillDate(tillDate);

            if (result.length === 0) {
                toast({
                    title: 'No data found',
                    description: 'No dropouts found for the selected criteria.',
                });
            } else {
                toast({
                    title: 'Report generated',
                    description: `Found ${result.length} records.`,
                });
            }
        } catch (error: any) {
            console.error("Error fetching report:", error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to generate report.',
                variant: 'destructive',
            });
            setData([]);
            setShowReport(false);
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
        if (!showReport || data.length === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate the report first before exporting.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const headers = [
                'Center Id',
                'Center Name',
                'ID',
                'Name',
                'Member / Client',
                'Joined Date',
                'Last Loan Disbursed Date',
                'Loan A/c',
                'Last Loan Closed Date',
                'Inactive Date',
                'Reason',
                'FDO Name',
                ...MEMBER_CONTACT_HEADERS,
            ];

            const csvContent = [
                headers.join(','),
                ...searchedRows.map(row => [
                    row.centerId,
                    `"${row.centerName}"`, // Quote to handle commas in names
                    row.clientId,
                    `"${row.clientName}"`,
                    getPersonLabel(!!row.hasLoan).singular,
                    formatDate(row.joinedDate),
                    formatDate(row.lastLoanDisbursedDate),
                    row.loanAc,
                    formatDate(row.lastLoanClosedDate),
                    formatDate(row.inactiveDate),
                    `"${row.reason}"`,
                    `"${row.fdoName}"`,
                    ...memberContactValues(row).map((v) => `"${v}"`),
                ].join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `client_dropouts_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast({
                title: 'Export success',
                description: 'Report exported to CSV successfully.',
            });
        } catch (error) {
            console.error("Export error:", error);
            toast({
                title: 'Export failed',
                description: 'Failed to export report.',
                variant: 'destructive',
            });
        }
    };

    // ── Excel / PDF / Word export (mirrors the same field mapping used by
    // handleExport (CSV) above, kept separate so handleExport is left untouched) ──

    const buildDropoutsExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Center Id', 'Center Name', 'ID', 'Name', 'Member / Client', 'Joined Date',
            'Last Loan Disbursed Date', 'Loan A/c', 'Last Loan Closed Date', 'Inactive Date', 'Reason', 'FDO Name',
            ...MEMBER_CONTACT_HEADERS,
        ];
        const rows: (string | number)[][] = searchedRows.map(row => [
            row.centerId, row.centerName, row.clientId, row.clientName,
            getPersonLabel(!!row.hasLoan).singular, formatDate(row.joinedDate),
            formatDate(row.lastLoanDisbursedDate), row.loanAc, formatDate(row.lastLoanClosedDate),
            formatDate(row.inactiveDate), row.reason, row.fdoName,
            ...memberContactValues(row),
        ]);
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDropoutsExportRows();
        const excelRows = rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
        const ws = buildReportSheet('Member / Client Dropouts Report', excelRows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Dropouts');
        XLSX.writeFile(wb, `client_dropouts_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast({ title: 'Export success', description: 'Report exported to Excel successfully.' });
    };

    const handleExportPDF = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const reportFont = await ensureReportFont(doc);
        await drawDropoutsReport(doc, searchedRows, reportFont);
        doc.save(`client_dropouts_${new Date().toISOString().split('T')[0]}.pdf`);
        toast({ title: 'Export success', description: 'Report exported to PDF successfully.' });
    };

    // Word-only presentation: same rows as Excel/PDF above. No totals row exists in this
    // report today (a client list, not a financial roll-up) and 12 flat columns don't
    // warrant grouped headers — just professional header/zebra/alignment/width styling.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['center', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'left'],
        columnWidthWeights: [7, 12, 7, 12, 9, 9, 10, 8, 10, 9, 12, 10],
    };

    const handleExportWord = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDropoutsExportRows();
        await exportToWord(`client_dropouts_${new Date().toISOString().split('T')[0]}`, 'MEMBER / CLIENT DROPOUTS REPORT', headers, rows, wordOptions);
        toast({ title: 'Export success', description: 'Report exported to Word successfully.' });
    };

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">Member / Client Dropouts Report</CardTitle>
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
                                    onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                    onExportExcel={!isLoading && showReport ? handleExportExcel : undefined}
                                    onExportCSV={!isLoading && showReport ? handleExport : undefined}
                                    onExportWord={!isLoading && showReport ? handleExportWord : undefined}
                                    reportSlug={!isLoading && showReport && getReportExportMode('dropouts') === 'REQUEST_QUEUE' ? 'dropouts' : undefined}
                                    canExport={canExportReport('dropouts')}
                                    exportParams={{
                                        fromDate: submittedFromDate,
                                        toDate: submittedTillDate,
                                        branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                        filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                    }}
                                    className="h-11 bg-emerald-600 text-white border-emerald-600 shadow-lg transition-all hover:bg-emerald-700 hover:shadow-xl dark:bg-emerald-700 dark:border-emerald-700 dark:hover:bg-emerald-700/80"
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
                        <ReportHeader title="Member / Client Dropouts Report" />
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
                                            ID
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Name
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            {MEMBER_CONTACT_COLUMN_LABEL}
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Joined Date
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Last Loan Disbursed
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Loan A/c
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Last Loan Closed
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Inactive Date
                                        </TableHead>
                                        <TableHead className="px-3 py-3 font-semibold text-white text-xs whitespace-nowrap">
                                            Reason
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
                                                colSpan={12}
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
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span>{row.clientName}</span>
                                                        <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                            {getPersonLabel(!!row.hasLoan).singular}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sidebar-accent dark:text-slate-200">
                                                    <MemberContactCell row={row} />
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {formatDate(row.joinedDate)}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {formatDate(row.lastLoanDisbursedDate)}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.loanAc}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {formatDate(row.lastLoanClosedDate)}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {formatDate(row.inactiveDate)}
                                                </TableCell>
                                                <TableCell className="px-3 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                    {row.reason}
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
                        Select filters and click Show to generate the Member / Client Dropouts report
                    </p>
                </Card>
            )}
        </div>
    );
}

