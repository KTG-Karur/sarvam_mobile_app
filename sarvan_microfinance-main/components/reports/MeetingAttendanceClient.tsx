'use client';

import { useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { Calendar, RefreshCw, Download, Loader2, FileText, FileBarChart, FileSpreadsheet, FileOutput, UserCheck, UserX, Users, CalendarDays, Percent } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { useEffect } from 'react';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';
import { Input } from '@/components/ui/input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';

// Types
type BranchOption = { id: string; name: string; code: string };

type AttendanceRecord = {
    id: string;
    date: string;
    centerCode: string;
    centerName: string;
    clientId: string;
    clientName: string;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
    phone: string;
    isPresent: boolean;
    markedBy: string;
} & MemberContactFields;

type AttendanceSummary = {
    totalMeetings: number;
    totalClients: number;
    presentCount: number;
    absentCount: number;
    attendancePercentage: number;
}; //

export function MeetingAttendanceClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenter, setSelectedCenter] = useState<string>('all');

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);
    // Draft date state — bound to the inputs below. Editing these alone must never trigger a
    // fetch; only Show (handleShow) copies them into the "submitted" snapshot that
    // buildEndpoint actually reads by default, so pagination/exports keep using the
    // last-submitted range even if the user edits these afterward without clicking Show again.
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [isLoadingCenters, setIsLoadingCenters] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);

    const [reportData, setReportData] = useState<AttendanceRecord[]>([]);
    const [summary, setSummary] = useState<AttendanceSummary | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    // Server-side: member name / ID / Aadhaar / mobile / co-applicant mobile.
    const [search, setSearch] = useState('');
    const PAGE_SIZE = 25;

    // Fetch centers on mount
    useEffect(() => {
        fetchCenters();
    }, []);

    const fetchCenters = async () => {
        setIsLoadingCenters(true);
        try {
            const centerList = await getCentersForDropdown();
            setCenters(centerList);

            fetch('/api/branches')
                .then((r) => r.json())
                .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
                .catch(() => {});
        } catch (error) {
            console.error('Error fetching centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingCenters(false);
        }
    };

    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the
    // same click — reading submittedFromDate/submittedTillDate here would otherwise use the
    // pre-update (stale) state, since the setSubmitted* calls in handleShow haven't
    // re-rendered yet. Callers other than handleShow (pagination, export) omit it and get the
    // last-submitted snapshot, which is the frozen-until-next-Show behavior they need.
    const buildEndpoint = (pageArg: number, pageSize: number, dateOverride?: { fromDate: string; tillDate: string }) => {
        const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
        const effTillDate = dateOverride?.tillDate ?? submittedTillDate;
        return `/reports/client/meeting-attendance?fromDate=${effFromDate}&tillDate=${effTillDate}&centerId=${selectedCenter}${selectedBranch !== 'all' ? `&branchId=${selectedBranch}` : ''}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}&page=${pageArg}&pageSize=${pageSize}`;
    };

    const fetchPage = async (pageArg: number, dateOverride?: { fromDate: string; tillDate: string }): Promise<{ ok: boolean; count: number }> => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<{ data: AttendanceRecord[]; summary: AttendanceSummary; totalCount: number; totalPages: number; page: number }>(
                buildEndpoint(pageArg, PAGE_SIZE, dateOverride)
            );

            if (result.success && result.data) {
                setReportData(result.data.data);
                setSummary(result.data.summary);
                setTotalCount(result.data.totalCount);
                setTotalPages(result.data.totalPages || 1);
                setPage(result.data.page ?? pageArg);
                setShowReport(true);
                return { ok: true, count: result.data.totalCount };
            }
            toast({
                title: 'Error',
                description: result.error || 'Failed to generate report.',
                variant: 'destructive',
            });
            return { ok: false, count: 0 };
        } catch (error) {
            console.error('API request failed:', error);
            toast({
                title: 'Error',
                description: 'Failed to communicate with the server.',
                variant: 'destructive',
            });
            return { ok: false, count: 0 };
        } finally {
            setIsLoading(false);
        }
    };

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

        setShowReport(false);
        const snapshot = { fromDate, tillDate };
        setSubmittedFromDate(fromDate);
        setSubmittedTillDate(tillDate);
        const { ok, count } = await fetchPage(1, snapshot);
        if (ok) {
            if (count === 0) {
                toast({
                    title: 'No Data',
                    description: 'No attendance records found for the selected criteria.',
                });
            } else {
                toast({
                    title: 'Report Generated',
                    description: `Loaded ${count} record${count !== 1 ? 's' : ''}.`,
                });
            }
        }
    };

    const handlePageChange = (p: number) => {
        fetchPage(p);
    };

    // Fetches every row matching the current filters (not just the on-screen page) —
    // used only by the export handlers below, so exports keep capturing the full
    // report instead of whatever happens to be on screen.
    const fetchAllForExport = async (): Promise<AttendanceRecord[] | null> => {
        try {
            const result = await apiClient.get<{ data: AttendanceRecord[]; summary: AttendanceSummary; totalCount: number }>(
                buildEndpoint(1, Math.max(totalCount, 1))
            );
            if (result.success && result.data) {
                return result.data.data;
            }
            toast({ title: 'Export failed', description: result.error || 'Could not load the full report for export.', variant: 'destructive' });
            return null;
        } catch (error) {
            console.error('Export fetch failed:', error);
            toast({ title: 'Export failed', description: 'Failed to communicate with the server.', variant: 'destructive' });
            return null;
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('all');
        setFromDate(new Date().toISOString().split('T')[0]);
        setTillDate(new Date().toISOString().split('T')[0]);
        setShowReport(false);
        setReportData([]);
        setSummary(null);
        setPage(1);
        setTotalPages(1);
        setTotalCount(0);
    };

    const handleExport = async () => {
        if (!showReport || totalCount === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate the report and ensure there is data to export.',
                variant: 'destructive',
            });
            return;
        }

        const fullData = await fetchAllForExport();
        if (!fullData) return;

        try {
            const headers = ['Date', 'Center Name / Code', 'Name', 'ID', 'Member / Client', 'Phone', 'Status', 'Marked By', ...MEMBER_CONTACT_HEADERS];

            const csvContent = fullData.map(record => {
                const date = toDisplayDate(new Date(record.date));
                const center = `"${record.centerName} / ${record.centerCode}"`;
                const clientName = `"${record.clientName}"`;
                const clientId = `"${record.clientId}"`;
                const memberOrClient = getPersonLabel(!!record.hasLoan).singular;
                const phone = `"${record.phone || 'N/A'}"`;
                const status = record.isPresent ? 'Present' : 'Absent';
                const markedBy = `"${record.markedBy || 'N/A'}"`;

                const contacts = memberContactValues(record).map((v) => `"${v}"`);

                return [date, center, clientName, clientId, memberOrClient, phone, status, markedBy, ...contacts].join(',');
            });

            const csv = [headers.join(','), ...csvContent].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);

            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = `meeting_attendance_${selectedCenter === 'all' ? 'all_centers' : selectedCenter}_${submittedFromDate || 'start'}_${submittedTillDate || 'end'}.csv`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

            toast({
                title: 'Export successful',
                description: 'The export file has been downloaded successfully.',
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export failed',
                description: 'An error occurred during export.',
                variant: 'destructive',
            });
        }
    };

    // ── Excel / PDF / Word export (mirrors the same field mapping used by
    // handleExport above, kept separate so handleExport is left untouched) ──────

    const buildMeetingAttendanceExportRows = (fullData: AttendanceRecord[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Date', 'Center Name / Code', 'Name', 'ID', 'Member / Client', 'Phone', 'Status', 'Marked By', ...MEMBER_CONTACT_HEADERS];
        const rows: (string | number)[][] = fullData.map(record => [
            toDisplayDate(new Date(record.date)),
            `${record.centerName} / ${record.centerCode}`,
            record.clientName,
            record.clientId,
            getPersonLabel(!!record.hasLoan).singular,
            record.phone || 'N/A',
            record.isPresent ? 'Present' : 'Absent',
            record.markedBy || 'N/A',
            ...memberContactValues(record),
        ]);
        if (fullData.length > 0) {
            const presentCount = summary?.presentCount ?? fullData.filter(r => r.isPresent).length;
            const absentCount = summary?.absentCount ?? fullData.filter(r => !r.isPresent).length;
            rows.push([
                'Grand Total:', `${fullData.length} Records`, `Present: ${presentCount}, Absent: ${absentCount}`, '', '', '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportExcel = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report and ensure there is data to export.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        try {
            const XLSX = await import('xlsx-js-style');
            const { headers, rows } = buildMeetingAttendanceExportRows(fullData);
            const excelRows = rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Meeting Attendance Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
            XLSX.writeFile(wb, `meeting_attendance_${selectedCenter === 'all' ? 'all_centers' : selectedCenter}_${submittedFromDate || 'start'}_${submittedTillDate || 'end'}.xlsx`);
            toast({ title: 'Export successful', description: 'The export file has been downloaded successfully.' });
        } catch (error) {
            console.error('Export error:', error);
            toast({ title: 'Export failed', description: 'An error occurred during export.', variant: 'destructive' });
        }
    };

    const handleExportPDF = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report and ensure there is data to export.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        try {
            const { default: jsPDF } = await import('jspdf');
            const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
            const { drawMeetingAttendanceReport } = await import('@/app/lib/reports/meeting-attendance-pdf');
            const { headers, rows } = buildMeetingAttendanceExportRows(fullData);
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const reportFont = await ensureReportFont(doc);
            await drawMeetingAttendanceReport(doc, headers, rows, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
            doc.save(`meeting_attendance_${selectedCenter === 'all' ? 'all_centers' : selectedCenter}_${submittedFromDate || 'start'}_${submittedTillDate || 'end'}.pdf`);
            toast({ title: 'Export successful', description: 'The export file has been downloaded successfully.' });
        } catch (error) {
            console.error('Export error:', error);
            toast({ title: 'Export failed', description: 'An error occurred during export.', variant: 'destructive' });
        }
    };

    const handleExportWord = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report and ensure there is data to export.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        try {
            const { headers, rows } = buildMeetingAttendanceExportRows(fullData);
            const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
            const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
            const wordOptions: WordExportOptions = {
                columnAlignments: ['center', 'left', 'left', 'center', 'center', 'center', 'center', 'left'],
                columnWidthWeights: [8, 14, 12, 8, 9, 9, 8, 10],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            };
            await exportToWord(`meeting_attendance_${selectedCenter === 'all' ? 'all_centers' : selectedCenter}_${submittedFromDate || 'start'}_${submittedTillDate || 'end'}`, 'MEETING ATTENDANCE REPORT', headers, bodyRows, wordOptions);
            toast({ title: 'Export successful', description: 'The export file has been downloaded successfully.' });
        } catch (error) {
            console.error('Export error:', error);
            toast({ title: 'Export failed', description: 'An error occurred during export.', variant: 'destructive' });
        }
    };

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">Meeting Attendance Report</CardTitle>
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
                                disabled={isLoading || isLoadingCenters}
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
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading || isLoadingCenters}>
                                <SelectTrigger id="centerName" className="h-11">
                                    <SelectValue placeholder={isLoadingCenters ? "Loading..." : "-- ALL CENTERS --"} />
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
                                    className="flex-1 h-11 bg-sidebar-accent text-white shadow-lg transition-all hover:bg-brand-green-darker hover:shadow-xl dark:bg-sidebar-accent dark:hover:bg-sidebar-accent/80"
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
                                    className="h-11 bg-gradient-to-r from-red-400 to-orange-400 text-white shadow-lg transition-all hover:from-red-500 hover:to-orange-500 hover:shadow-xl"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                                <ExportDropdown
                                    onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                    onExportExcel={!isLoading && showReport ? handleExportExcel : undefined}
                                    onExportCSV={!isLoading && showReport ? handleExport : undefined}
                                    onExportWord={!isLoading && showReport ? handleExportWord : undefined}
                                    reportSlug={!isLoading && showReport && getReportExportMode('meeting-attendance') === 'REQUEST_QUEUE' ? 'meeting-attendance' : undefined}
                                    canExport={canExportReport('meeting-attendance')}
                                    exportParams={{
                                        fromDate: submittedFromDate,
                                        toDate: submittedTillDate,
                                        branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                        filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                    }}
                                    className="h-11 bg-gradient-to-r from-emerald-500 to-green-500 text-white border-emerald-500 shadow-lg transition-all hover:from-emerald-600 hover:to-green-600 hover:shadow-xl dark:border-emerald-500"
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Metrics */}
            {showReport && summary && reportData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-bottom-2">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Total Meetings</p>
                                    <p className="text-2xl font-bold">{summary.totalMeetings}</p>
                                </div>
                                <CalendarDays className="h-8 w-8 text-primary opacity-80" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Total Expected</p>
                                    <p className="text-2xl font-bold">{summary.totalClients}</p>
                                </div>
                                <Users className="h-8 w-8 text-primary opacity-80" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Present</p>
                                    <p className="text-2xl font-bold text-green-600">{summary.presentCount}</p>
                                </div>
                                <UserCheck className="h-8 w-8 text-green-500 opacity-80" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Attendance Rate</p>
                                    <p className="text-2xl font-bold">{summary.attendancePercentage}%</p>
                                </div>
                                <Percent className="h-8 w-8 text-purple-500 opacity-80" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Report Content Area */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardHeader className="bg-green-50/50 dark:bg-brand-green-darker/50 border-b border-slate-100 dark:border-sidebar-accent">
                        <ReportHeader title="Meeting Attendance Report" />
                        <div className="flex justify-between items-center">
                            <CardTitle className="text-lg">Attendance Details</CardTitle>
                            <Input
                                placeholder="Name, ID, Aadhaar or mobile — Enter to search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); fetchPage(1); } }}
                                className="h-9 w-full max-w-xs mx-3"
                            />
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 bg-brand-green-tint dark:bg-sidebar-accent px-3 py-1 rounded-full">
                                {totalCount} Records Found
                            </p>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {reportData.length > 0 ? (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-green-50 dark:bg-sidebar-accent/50">
                                        <TableRow>
                                            <TableHead className="w-[50px]">#</TableHead>
                                            <TableHead>Meeting Date</TableHead>
                                            <TableHead>Center</TableHead>
                                            <TableHead>Name</TableHead>
                                            <TableHead>ID</TableHead>
                                            <TableHead>{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                            <TableHead>Phone</TableHead>
                                            <TableHead className="text-center">Status</TableHead>
                                            <TableHead className="text-right">Marked By</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {reportData.map((record, index) => (
                                            <TableRow key={record.id} className="hover:bg-green-50/80 dark:hover:bg-sidebar-accent/80">
                                                <TableCell className="font-medium">{(page - 1) * PAGE_SIZE + index + 1}</TableCell>
                                                <TableCell className="whitespace-nowrap">
                                                    {toDisplayDate(new Date(record.date))}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold">{record.centerName}</span>
                                                        <span className="text-xs text-muted-foreground">{record.centerCode}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span>{record.clientName}</span>
                                                        <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                            {getPersonLabel(!!record.hasLoan).singular}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">{record.clientId}</TableCell>
                                                <TableCell><MemberContactCell row={record} /></TableCell>
                                                <TableCell>{record.phone}</TableCell>
                                                <TableCell className="text-center">
                                                    {record.isPresent ? (
                                                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20">
                                                            <UserCheck className="w-3 h-3 mr-1" />
                                                            Present
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
                                                            <UserX className="w-3 h-3 mr-1" />
                                                            Absent
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs text-muted-foreground">
                                                    {record.markedBy}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <div className="p-12 text-center">
                                <FileText className="mx-auto h-16 w-16 text-slate-300 dark:text-sidebar-accent mb-4" />
                                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                    No attendance records found for the selected center and date range.
                                </p>
                            </div>
                        )}
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

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select filters and click Show to generate the Meeting Attendance report
                    </p>
                </Card>
            )}
        </div>
    );
}

