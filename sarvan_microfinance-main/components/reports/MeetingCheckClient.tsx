'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getCentersForDropdown, type CenterOption } from '@/app/lib/actions/centers';
import { useToast } from '@/hooks/use-toast';
import {
    Calendar, RefreshCw, Download, Loader2, FileText, CheckCircle2,
    XCircle, Users, IndianRupee, Clock, ArrowRight, Building2, User,
    FileBarChart, FileType, FileOutput
} from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { usePermission } from '@/app/hooks/usePermission';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

interface MeetingReportData {
    id: string;
    centerCode: string;
    centerName: string;
    fdoName: string;
    clientCount: number;
    meetingTime: string;
    meetingStatus: 'PENDING' | 'COMPLETED';
    expectedCollection: number;
    actualCollection: number;
    collectionVariance: number;
}

interface ReportSummary {
    totalCenters: number;
    meetingsCompleted: number;
    meetingsPending: number;
    totalExpectedCollection: number;
    totalCollected: number;
}

export function MeetingCheckClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [reportDate, setReportDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next Show click. Filenames,
    // PDF subtitle, on-screen labels and the Request-Queue exportParams all read this
    // (not the live reportDate draft), so editing the date input after Show has no effect
    // on export/label output until Show is clicked again.
    const [submittedReportDate, setSubmittedReportDate] = useState<string>(reportDate);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [reportData, setReportData] = useState<MeetingReportData[]>([]);
    const [summary, setSummary] = useState<ReportSummary | null>(null);

    type BranchOption = { id: string; name: string; code: string };
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(reportData);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});

        getCentersForDropdown()
            .then((c) => setCenters(c))
            .catch(() => {});
    }, []);

    // Truncates (not rounds) to whole rupees, matches the project-wide report-amount convention.
    const formatCurrency = (amount: number) => `₹${formatReportAmount(amount)}`;

    const handleShow = async () => {
        if (!reportDate) {
            toast({
                title: 'Date required',
                description: 'Please select Report Date before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ reportDate });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
            const response = await apiClient.get<{ data: MeetingReportData[], summary: ReportSummary }>(
                `/reports/collection/meeting-check?${params.toString()}`
            );

            if (response.success && response.data) {
                setReportData(response.data.data);
                setSummary(response.data.summary);
                setShowReport(true);
                setSubmittedReportDate(reportDate);
                toast({
                    title: 'Report generated',
                    description: 'Daily Meeting Report loaded successfully.',
                });
            } else {
                throw new Error(response.error || 'Failed to fetch report');
            }
        } catch (error: any) {
            toast({
                title: 'Data Load Failed',
                description: error.message || 'Could not fetch data for the selected date.',
                variant: 'destructive',
            });
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setReportDate(new Date().toISOString().split('T')[0]);
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setReportData([]);
        setSummary(null);
        setSubmittedReportDate(new Date().toISOString().split('T')[0]);
    };

    const handleExport = async () => {
        if (!showReport || reportData.length === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate a valid report first before exporting.',
                variant: 'destructive',
            });
            return;
        }

        setIsExporting(true);
        try {
            toast({
                title: 'Export started',
                description: 'Preparing your Daily Meeting Excel Report...',
            });

            // Dynamic import to keep client bundle size small
            const XLSX = await import('xlsx-js-style');

            // Format data for Excel
            const excelData = searchedRows.map(row => ({
                'Center Code': row.centerCode,
                'Center Name': row.centerName,
                'FDO Name': row.fdoName,
                'Meeting Time': row.meetingTime ? normalizeMeetingTime(row.meetingTime) : '',
                'Clients': row.clientCount,
                'Status': row.meetingStatus,
                'Expected Collection': truncateReportAmount(row.expectedCollection),
                'Actual Collection': truncateReportAmount(row.actualCollection),
                'Variance': truncateReportAmount(row.collectionVariance)
            }));

            // Create worksheet and workbook
            const worksheet = buildReportSheet('Daily Meeting Report', excelData);
            applyExcelReportFont(worksheet);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Meeting Check');

            // Adjust column widths (basic formatting for xlsx)
            worksheet['!cols'] = [
                { wch: 15 }, // Center Code
                { wch: 25 }, // Center Name
                { wch: 20 }, // FDO Name
                { wch: 15 }, // Meeting Time
                { wch: 10 }, // Clients
                { wch: 15 }, // Status
                { wch: 20 }, // Expected
                { wch: 20 }, // Actual
                { wch: 20 }, // Variance
            ];

            // Trigger download
            XLSX.writeFile(workbook, `meeting_check_${submittedReportDate}.xlsx`);

            toast({
                title: 'Export Successful',
                description: 'The report has been downloaded to your device.',
            });

        } catch (error) {
            console.error('Export Error:', error);
            toast({
                title: 'Export Failed',
                description: 'An error occurred while generating the Excel file.',
                variant: 'destructive',
            });
        } finally {
            setIsExporting(false);
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildMeetingCheckExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Center Code', 'Center Name', 'FDO Name', 'Meeting Time', 'Clients', 'Status', 'Expected Collection', 'Actual Collection', 'Variance'];
        const rows: (string | number)[][] = searchedRows.map(row => [
            row.centerCode, row.centerName, row.fdoName, row.meetingTime ? normalizeMeetingTime(row.meetingTime) : '',
            row.clientCount, row.meetingStatus, truncateReportAmount(row.expectedCollection), truncateReportAmount(row.actualCollection), truncateReportAmount(row.collectionVariance),
        ]);
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || reportData.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate a valid report first before exporting.', variant: 'destructive' });
            return;
        }
        const { jsPDF } = await import('jspdf');
        const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
        const { drawMeetingCheckReport } = await import('@/app/lib/reports/meeting-check-pdf');
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawMeetingCheckReport(doc, searchedRows, { subtitle: submittedReportDate }, reportFont);
        doc.save(`meeting_check_${submittedReportDate}.pdf`);
        toast({ title: 'PDF Exported', description: 'The report has been downloaded to your device.' });
    };

    const handleExportCSV = () => {
        if (!showReport || reportData.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate a valid report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildMeetingCheckExportRows();
        exportToCSV(`meeting_check_${submittedReportDate}`, 'DAILY MEETING REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above. No totals row exists in this
    // report today. Expected/Actual Collection and Variance share a genuine cluster and
    // get a light 2-row grouped header; the other 6 columns stay standalone.
    const wordOptions: WordExportOptions = {
        groupHeaders: [
            { label: 'Center Code', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'FDO Name', span: 1 },
            { label: 'Meeting Time', span: 1 }, { label: 'Clients', span: 1 }, { label: 'Status', span: 1 },
            { label: 'COLLECTION', span: 3 },
        ],
        subHeaders: ['Expected', 'Actual', 'Variance'],
        columnAlignments: ['center', 'left', 'left', 'center', 'right', 'center', 'right', 'right', 'right'],
        columnWidthWeights: [8, 12, 12, 8, 7, 9, 9, 9, 9],
    };

    const handleExportWord = async () => {
        if (!showReport || reportData.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate a valid report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildMeetingCheckExportRows();
        await exportToWord(`meeting_check_${submittedReportDate}`, 'DAILY MEETING REPORT', headers, rows, wordOptions);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Filter Section */}
            <Card className="border-primary/20/80 bg-white/50 backdrop-blur-xl shadow-xl dark:border-sidebar-accent/80 dark:bg-green-950/50 rounded-2xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-violet-500" />
                <CardHeader className="bg-gradient-to-r from-slate-50 to-white dark:from-brand-green-darker dark:to-green-950 pb-6 border-b border-slate-100 dark:border-sidebar-accent">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/40">
                            <Clock className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold text-foreground dark:text-white">Daily Meeting Report</CardTitle>
                            <CardDescription>Track daily center meetings and collection variances.</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        {/* Report Date */}
                        <div className="space-y-2">
                            <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Report Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="reportDate"
                                    value={reportDate}
                                    onChange={(e) => setReportDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

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

                        {/* Center */}
                        <div className="space-y-2">
                            <Label htmlFor="centerName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Center
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

                        {/* Action Buttons */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Show</Label>
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-11 w-full bg-sidebar-accent text-white shadow-lg transition-all hover:bg-brand-green-darker hover:shadow-xl dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80"
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
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Export</Label>
                            <ExportDropdown
                                onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && showReport ? handleExport : undefined}
                                onExportCSV={!isLoading && showReport ? handleExportCSV : undefined}
                                onExportWord={!isLoading && showReport ? handleExportWord : undefined}
                                reportSlug={!isLoading && showReport && getReportExportMode('meeting-check') === 'REQUEST_QUEUE' ? 'meeting-check' : undefined}
                                canExport={canExportReport('meeting-check')}
                                exportParams={{
                                    fromDate: submittedReportDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-11 w-full bg-gradient-to-r from-cyan-400 to-green-400 text-white border-cyan-400 shadow-lg transition-all hover:from-cyan-500 hover:to-primary hover:shadow-xl dark:border-cyan-400"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Reset</Label>
                            <Button
                                onClick={handleReset}
                                disabled={isLoading}
                                className="h-11 w-full bg-gradient-to-r from-red-400 to-orange-400 text-white shadow-lg transition-all hover:from-red-500 hover:to-orange-500 hover:shadow-xl"
                            >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Reset
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Content Area */}
            {showReport && (
                <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">
                    <ReportHeader title="Daily Meeting Report" subtitle={submittedReportDate} />
                    {/* Summary Metrics */}
                    {summary && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Card className="border-none shadow-lg bg-gradient-to-br from-primary to-primary text-white rounded-2xl">
                                <CardContent className="p-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-2">
                                            <p className="text-green-100 font-medium text-sm">Target Centers</p>
                                            <p className="text-3xl font-black">{summary.totalCenters}</p>
                                        </div>
                                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                                            <Building2 className="w-5 h-5 text-white" />
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-white/20 flex items-center justify-between text-sm">
                                        <span className="text-green-100">{submittedReportDate}</span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl">
                                <CardContent className="p-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-2">
                                            <p className="text-emerald-100 font-medium text-sm">Meetings Completed</p>
                                            <p className="text-3xl font-black">{summary.meetingsCompleted} <span className="text-lg text-emerald-100 font-medium">/ {summary.totalCenters}</span></p>
                                        </div>
                                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                                            <CheckCircle2 className="w-5 h-5 text-white" />
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-white/20 text-sm">
                                        <span className="text-emerald-100">{summary.meetingsPending} pending meetings</span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-none shadow-lg bg-white dark:bg-brand-green-darker rounded-2xl">
                                <CardContent className="p-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-2">
                                            <p className="text-slate-500 font-medium text-sm">Expected Collection</p>
                                            <p className="text-2xl font-black text-sidebar-accent dark:text-slate-200">{formatCurrency(summary.totalExpectedCollection)}</p>
                                        </div>
                                        <div className="p-3 bg-green-50 dark:bg-brand-green-darker/30 rounded-xl">
                                            <IndianRupee className="w-5 h-5 text-primary dark:text-primary" />
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-sidebar-accent text-sm">
                                        <span className="text-slate-500">Based on due schedules</span>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className={cn(
                                "border-none shadow-lg rounded-2xl",
                                summary.totalCollected >= summary.totalExpectedCollection ? "bg-white dark:bg-brand-green-darker" : "bg-gradient-to-br from-rose-50 to-orange-50 dark:from-rose-950/30 dark:to-orange-950/30"
                            )}>
                                <CardContent className="p-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-2">
                                            <p className={cn("font-medium text-sm", summary.totalCollected >= summary.totalExpectedCollection ? "text-slate-500" : "text-rose-600 dark:text-rose-400")}>Actual Collection</p>
                                            <p className={cn("text-2xl font-black", summary.totalCollected >= summary.totalExpectedCollection ? "text-emerald-600" : "text-rose-600 dark:text-rose-400")}>{formatCurrency(summary.totalCollected)}</p>
                                        </div>
                                        <div className={cn("p-3 rounded-xl", summary.totalCollected >= summary.totalExpectedCollection ? "bg-emerald-50 dark:bg-emerald-900/30" : "bg-rose-100 dark:bg-rose-900/50")}>
                                            <IndianRupee className={cn("w-5 h-5", summary.totalCollected >= summary.totalExpectedCollection ? "text-emerald-600" : "text-rose-600")} />
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-sidebar-accent/50 text-sm">
                                        <span className={cn(
                                            "font-semibold",
                                            summary.totalCollected - summary.totalExpectedCollection >= 0 ? "text-emerald-600" : "text-rose-600"
                                        )}>
                                            Variance: {formatCurrency(summary.totalCollected - summary.totalExpectedCollection)}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Report Table */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden rounded-2xl">
                        <CardContent className="p-0">
                            {reportData.length === 0 ? (
                                <div className="p-16 text-center">
                                    <FileText className="mx-auto h-16 w-16 text-slate-300 dark:text-sidebar-accent mb-4" />
                                    <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-400">
                                        No center meetings found for {submittedReportDate}.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto scrollbar-thin scrollbar-track-slate-100 scrollbar-thumb-slate-300 dark:scrollbar-track-brand-green-darker dark:scrollbar-thumb-sidebar-accent">
                                    <div className="flex flex-wrap items-center justify-end gap-4 px-6 py-3 border-b border-primary/20 dark:border-sidebar-accent">
                                        <TableSearchInput
                                            value={tableSearchQuery}
                                            onChange={setTableSearchQuery}
                                            placeholder="Search meetings..."
                                        />
                                    </div>
                                    <Table className="min-w-[1000px] w-full">
                                        <TableHeader className="bg-green-50 dark:bg-brand-green-darker/50">
                                            <TableRow className="hover:bg-transparent border-b border-primary/20 dark:border-sidebar-accent">
                                                <TableHead className="h-12 px-6 font-semibold text-sidebar-accent dark:text-slate-300 whitespace-nowrap">Center Information</TableHead>
                                                <TableHead className="h-12 px-6 font-semibold text-sidebar-accent dark:text-slate-300 whitespace-nowrap">Status</TableHead>
                                                <TableHead className="h-12 px-6 font-semibold text-sidebar-accent dark:text-slate-300 text-right whitespace-nowrap">Expected</TableHead>
                                                <TableHead className="h-12 px-6 font-semibold text-sidebar-accent dark:text-slate-300 text-right whitespace-nowrap">Collected</TableHead>
                                                <TableHead className="h-12 px-6 font-semibold text-sidebar-accent dark:text-slate-300 text-right whitespace-nowrap">Variance</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody className="bg-white dark:bg-green-950/30">
                                            {searchedRows.map((row) => (
                                                <TableRow
                                                    key={row.id}
                                                    className="transition-all duration-200 hover:bg-green-50/80 dark:hover:bg-sidebar-accent/50 border-b border-slate-100 dark:border-sidebar-accent/50"
                                                >
                                                    <TableCell className="px-6 py-4">
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-sm text-foreground dark:text-white">{row.centerName}</span>
                                                                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 dark:border-sidebar-accent">{row.centerCode}</Badge>
                                                            </div>
                                                            <div className="flex items-center gap-3 text-xs text-slate-500">
                                                                <span className="flex items-center gap-1"><User className="w-3 h-3" /> {row.fdoName}</span>
                                                                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {row.clientCount} clients</span>
                                                                <span className="flex items-center gap-1 text-primary dark:text-primary font-medium"><Clock className="w-3 h-3" /> {row.meetingTime ? normalizeMeetingTime(row.meetingTime) : '—'}</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4">
                                                        <Badge variant={row.meetingStatus === 'COMPLETED' ? 'default' : 'secondary'} className={cn(
                                                            "px-2.5 py-1 text-xs font-semibold",
                                                            row.meetingStatus === 'COMPLETED' ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 hover:bg-amber-100 border-none dark:bg-amber-900/30 dark:text-amber-400"
                                                        )}>
                                                            {row.meetingStatus === 'COMPLETED' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                                                            {row.meetingStatus}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right font-medium text-sidebar-accent dark:text-slate-300">
                                                        {formatCurrency(row.expectedCollection)}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right font-bold text-foreground dark:text-white">
                                                        {formatCurrency(row.actualCollection)}
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <span className={cn(
                                                            "font-bold px-3 py-1 rounded-md text-xs",
                                                            row.collectionVariance >= 0
                                                                ? "bg-brand-green-tint text-emerald-600 dark:bg-sidebar-accent dark:text-emerald-400"
                                                                : "bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400"
                                                        )}>
                                                            {row.collectionVariance > 0 ? '+' : ''}{formatCurrency(row.collectionVariance)}
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {!showReport && (
                <div className="rounded-[2rem] border-2 border-dashed border-primary/20 dark:border-sidebar-accent bg-white/50 dark:bg-brand-green-darker/50 p-16 text-center animate-in fade-in zoom-in duration-500">
                    <div className="mx-auto h-20 w-20 rounded-3xl bg-brand-green-tint dark:bg-sidebar-accent flex items-center justify-center mb-6">
                        <Clock className="h-10 w-10 text-primary/50" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground dark:text-white mb-2">Select a Date to Analyze</h3>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                        Choose a report date and click "Show" to compile the daily meeting status and calculate expected vs. actual collections.
                    </p>
                </div>
            )}
        </div>
    );
}

