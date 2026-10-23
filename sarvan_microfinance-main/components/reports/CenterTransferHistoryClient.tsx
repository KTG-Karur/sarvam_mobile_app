'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { RefreshCw, Loader2, FileText, Calendar, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { getCentersForDropdown, type CenterOption } from '@/app/lib/actions/centers';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { exportToWord, exportToCSV, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawCenterTransferHistoryReport } from '@/app/lib/reports/center-transfer-history-pdf';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';

type CenterTransferHistoryRow = {
    branchName: string;
    centerName: string;
    previousFdoName: string;
    currentFdoName: string;
    date: string;
    approvedBy: string;
};

type BranchOption = { id: string; name: string; code: string };
type OfficerOption = { id: string; employeeId: string | null; name: string };
type ReportType = 'RANGE' | 'AS_ON';

const defaultFromDate = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
const today = () => new Date().toISOString().split('T')[0];

export function CenterTransferHistoryClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    const [reportType, setReportType] = useState<ReportType>('AS_ON');
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [selectedOfficer, setSelectedOfficer] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [officers, setOfficers] = useState<OfficerOption[]>([]);
    const [fromDate, setFromDate] = useState<string>(defaultFromDate());
    const [tillDate, setTillDate] = useState<string>(today());
    const [asOnDate, setAsOnDate] = useState<string>(today());

    // Submitted (applied) snapshot — frozen until the next Show click, so export
    // filenames/subtitles/exportParams reflect what's actually on screen.
    const [submittedReportType, setSubmittedReportType] = useState<ReportType>(reportType);
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [submittedAsOnDate, setSubmittedAsOnDate] = useState<string>(asOnDate);
    const [submittedBranch, setSubmittedBranch] = useState<string>(selectedBranch);
    const [submittedOfficer, setSubmittedOfficer] = useState<string>(selectedOfficer);

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<CenterTransferHistoryRow[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        getCentersForDropdown().then(setCenters).catch((error) => {
            console.error('Failed to fetch centers:', error);
        });

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});

        apiClient.get<OfficerOption[]>('/reports/employee/center-transfer-history/officers').then((res) => {
            if (res.success && res.data) setOfficers(res.data);
        }).catch((error) => {
            console.error('Failed to fetch officers:', error);
        });
    }, []);

    // Changing branch can invalidate a previously-picked center from a different branch.
    useEffect(() => {
        if (selectedCenter === 'all') return;
        if (!filteredCenters.some((c) => c.id === selectedCenter)) {
            setSelectedCenter('all');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranch]);

    const officerName = (id: string) => officers.find((o) => o.id === id)?.name ?? '';

    const periodLabel = submittedOfficer !== 'all'
        ? `Full timeline for ${officerName(submittedOfficer)}`
        : submittedReportType === 'RANGE'
            ? `${submittedFromDate} to ${submittedTillDate}`
            : `As on ${submittedAsOnDate}`;

    const handleShow = async () => {
        // The Officer filter shows that person's complete history — date fields
        // don't apply and are hidden, so only validate them when no officer is picked.
        if (selectedOfficer === 'all') {
            if (reportType === 'RANGE' && (!fromDate || !tillDate)) {
                toast({
                    title: 'Missing dates',
                    description: 'Please select both From and Till dates.',
                    variant: 'destructive',
                });
                return;
            }
            if (reportType === 'AS_ON' && !asOnDate) {
                toast({
                    title: 'Missing date',
                    description: 'Please select an As On Date.',
                    variant: 'destructive',
                });
                return;
            }
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (selectedOfficer !== 'all') {
                params.set('fdoId', selectedOfficer);
            } else {
                params.set('reportType', reportType);
                if (reportType === 'RANGE') {
                    params.set('fromDate', fromDate);
                    params.set('tillDate', tillDate);
                } else {
                    params.set('asOnDate', asOnDate);
                }
            }
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);

            const response = await apiClient.get<CenterTransferHistoryRow[]>(
                `/reports/employee/center-transfer-history?${params.toString()}`
            );

            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
                setSubmittedReportType(reportType);
                setSubmittedFromDate(fromDate);
                setSubmittedTillDate(tillDate);
                setSubmittedAsOnDate(asOnDate);
                setSubmittedBranch(selectedBranch);
                setSubmittedOfficer(selectedOfficer);
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
        setReportType('AS_ON');
        setSelectedBranch('all');
        setSelectedCenter('all');
        setSelectedOfficer('all');
        setFromDate(defaultFromDate());
        setTillDate(today());
        setAsOnDate(today());
        setSubmittedReportType('AS_ON');
        setSubmittedFromDate(defaultFromDate());
        setSubmittedTillDate(today());
        setSubmittedAsOnDate(today());
        setSubmittedBranch('all');
        setSubmittedOfficer('all');
        setShowReport(false);
        setData([]);
        setCurrentPage(1);
    };

    // Shared field mapping for all four export formats (CSV, Excel, PDF, Word) —
    // ensures they all respect the active search filter (searchedRows).
    const buildExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Branch Name', 'Center Name', 'Previous FDO', 'Current FDO', 'Date', 'Approved By'];
        const rows: (string | number)[][] = searchedRows.map((row) => [
            row.branchName, row.centerName, row.previousFdoName, row.currentFdoName, row.date, row.approvedBy,
        ]);
        return { headers, rows };
    };

    const exportFileBase = () => {
        if (submittedOfficer !== 'all') {
            const safeName = officerName(submittedOfficer).replace(/\s+/g, '_');
            return `Center_Transfer_History_${safeName}`;
        }
        return `Center_Transfer_History_${submittedReportType === 'RANGE' ? `${submittedFromDate}_to_${submittedTillDate}` : submittedAsOnDate}`;
    };

    const handleExportCSV = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildExportRows();
        exportToCSV(exportFileBase(), 'CENTER TRANSFER HISTORY REPORT', headers, rows);
        toast({ title: 'Export successful', description: 'Your report has been downloaded.' });
    };

    const handleExportExcel = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildExportRows();
        const rowObjects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Center Transfer History Report', rowObjects);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Transfers');
        XLSX.writeFile(wb, `${exportFileBase()}.xlsx`);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as Excel.' });
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawCenterTransferHistoryReport(doc, searchedRows, { subtitle: periodLabel }, reportFont);
        doc.save(`${exportFileBase()}.pdf`);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as PDF.' });
    };

    // Word-only presentation: same rows as Excel/PDF above. No totals row exists in this
    // report (transfer log, not a financial roll-up) and 6 flat columns don't warrant
    // grouped headers — just professional header/zebra/alignment/width styling.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['left', 'left', 'left', 'left', 'center', 'left'],
        columnWidthWeights: [16, 20, 18, 18, 12, 16],
    };

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildExportRows();
        await exportToWord(exportFileBase(), 'CENTER TRANSFER HISTORY REPORT', headers, rows, wordOptions);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as Word.' });
    };

    const totalPages = Math.ceil(searchedRows.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentData = searchedRows.slice(startIndex, startIndex + itemsPerPage);

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-none shadow-xl bg-white/70 dark:bg-brand-green-darker/50 backdrop-blur-md overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="pb-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.4 bg-brand-green-tint dark:bg-brand-green-darker/30 rounded-lg">
                                <ArrowRightLeft className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl font-bold text-foreground dark:text-slate-100">
                                    Center Transfer History Filters
                                </CardTitle>
                                <CardDescription>Select a date mode, branch and center, then click Show to view FDO-to-center reassignments</CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-md hover:shadow-lg transition-all"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Fetching...
                                    </>
                                ) : (
                                    <>
                                        <FileText className="mr-2 h-4 w-4" />
                                        Show Report
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="border-primary/20 hover:bg-brand-green-tint dark:border-sidebar-accent dark:hover:bg-sidebar-accent"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                            <ExportDropdown
                                onExportPDF={!isLoading && showReport && data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && showReport && data.length > 0 ? handleExportExcel : undefined}
                                onExportCSV={!isLoading && showReport && data.length > 0 ? handleExportCSV : undefined}
                                onExportWord={!isLoading && showReport && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && showReport && data.length > 0 && getReportExportMode('center-transfer-history') === 'REQUEST_QUEUE' ? 'center-transfer-history' : undefined}
                                canExport={canExportReport('center-transfer-history')}
                                exportParams={{
                                    fromDate: submittedOfficer !== 'all' ? null : (submittedReportType === 'RANGE' ? submittedFromDate : submittedAsOnDate),
                                    toDate: submittedOfficer !== 'all' ? null : (submittedReportType === 'RANGE' ? submittedTillDate : submittedAsOnDate),
                                    branchIds: submittedBranch === 'all' ? 'ALL' : [submittedBranch],
                                    filters: submittedOfficer !== 'all' ? { fdoId: submittedOfficer } : null,
                                }}
                                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                            >
                                <SelectTrigger id="branchName" className="h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all">
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
                        <div className="space-y-2">
                            <Label htmlFor="center" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Center
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                <SelectTrigger id="center" className="h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all">
                                    <SelectValue placeholder="All Centers" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Centers</SelectItem>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="officer" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Officer
                            </Label>
                            <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
                                <SelectTrigger id="officer" className="h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all">
                                    <SelectValue placeholder="-- All Officers --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- All Officers --</SelectItem>
                                    {officers.map((officer) => (
                                        <SelectItem key={officer.id} value={officer.id}>
                                            {officer.employeeId ? `${officer.employeeId} — ${officer.name}` : officer.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedOfficer !== 'all' ? (
                            <div className="md:col-span-3 flex items-end">
                                <p className="text-xs text-slate-500 bg-green-50/50 dark:bg-green-950/50 border border-primary/20 dark:border-sidebar-accent rounded-md px-3 py-2.5 h-11 flex items-center w-full">
                                    Date filters don&apos;t apply here — this shows the selected officer&apos;s complete transfer timeline, across all centers and all time.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="reportType" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                        Report Type
                                    </Label>
                                    <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                                        <SelectTrigger id="reportType" className="h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="RANGE">From Date - Till Date</SelectItem>
                                            <SelectItem value="AS_ON">As On Date</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {reportType === 'RANGE' ? (
                                    <>
                                        <div className="space-y-2">
                                            <Label htmlFor="fromDate" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                                From Date
                                            </Label>
                                            <div className="relative">
                                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                                <DateInput
                                                    id="fromDate"
                                                    value={fromDate}
                                                    onChange={(e) => setFromDate(e.target.value)}
                                                    className="pl-10 h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="tillDate" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                                Till Date
                                            </Label>
                                            <div className="relative">
                                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                                <DateInput
                                                    id="tillDate"
                                                    value={tillDate}
                                                    onChange={(e) => setTillDate(e.target.value)}
                                                    className="pl-10 h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all"
                                                />
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-2">
                                        <Label htmlFor="asOnDate" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                            As On Date
                                        </Label>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                            <DateInput
                                                id="asOnDate"
                                                value={asOnDate}
                                                onChange={(e) => setAsOnDate(e.target.value)}
                                                className="pl-10 h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all"
                                            />
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-none shadow-2xl bg-white dark:bg-green-950 overflow-hidden">
                    <CardHeader className="border-b border-slate-100 dark:border-sidebar-accent">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <ReportHeader title="Center Transfer History Report" subtitle={periodLabel} />
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search transfers..."
                                className="ml-auto"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-brand-green-darker hover:bg-brand-green-darker border-none">
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Branch Name
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Center Name
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Previous FDO
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Current FDO
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap text-center">
                                            Date
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Approved By
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={6}
                                                className="px-4 py-12 text-center text-slate-500 italic"
                                            >
                                                No transfer records found for the selected criteria.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        currentData.map((row, index) => (
                                            <TableRow
                                                key={index}
                                                className="hover:bg-green-50/40 dark:hover:bg-brand-green-darker/10 transition-colors border-slate-100 dark:border-sidebar-accent"
                                            >
                                                <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-400">
                                                    {row.branchName}
                                                </TableCell>
                                                <TableCell className="px-4 py-4">
                                                    <span className="font-semibold text-foreground dark:text-slate-100">
                                                        {row.centerName}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-slate-500">
                                                    {row.previousFdoName}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                    {row.currentFdoName}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-center font-bold text-foreground dark:text-slate-100">
                                                    {row.date}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-400">
                                                    {row.approvedBy}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {searchedRows.length > itemsPerPage && (
                            <div className="flex items-center justify-between px-6 py-4 bg-green-50/50 dark:bg-brand-green-darker/50 border-t dark:border-sidebar-accent">
                                <div className="text-sm text-slate-500">
                                    Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, searchedRows.length)} of {searchedRows.length} transfers
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="h-8 border-primary/20 dark:border-sidebar-accent shadow-sm"
                                    >
                                        Previous
                                    </Button>
                                    <div className="flex items-center gap-1">
                                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                            const page = i + 1;
                                            return (
                                                <Button
                                                    key={page}
                                                    variant={currentPage === page ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setCurrentPage(page)}
                                                    className={cn(
                                                        "h-8 w-8 p-0 border-primary/20 dark:border-sidebar-accent",
                                                        currentPage === page && "bg-primary hover:bg-primary"
                                                    )}
                                                >
                                                    {page}
                                                </Button>
                                            );
                                        })}
                                        {totalPages > 5 && <span className="mx-1 text-slate-400">...</span>}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="h-8 border-primary/20 dark:border-sidebar-accent shadow-sm"
                                    >
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <div className="flex flex-col items-center justify-center py-20 bg-white/40 dark:bg-brand-green-darker/20 border-2 border-dashed border-primary/20 dark:border-sidebar-accent rounded-2xl">
                    <div className="p-4 bg-brand-green-tint dark:bg-sidebar-accent rounded-full mb-4">
                        <FileText className="h-10 w-10 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground dark:text-slate-100">Ready to Generate</h3>
                    <p className="text-slate-500 max-w-xs text-center mt-2">
                        Select your criteria and click &ldquo;Show Report&rdquo; to view center transfer history.
                    </p>
                </div>
            )}
        </div>
    );
}
