'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePickerField } from '@/components/ui/date-picker-field';
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
import {
    RefreshCw,
    Download,
    Loader2,
    FileText,
    Users,
    UserCheck,
    UserX,
    TrendingUp,
    Search,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    FileBarChart,
    FileType,
    FileOutput,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, startOfMonth, isValid } from 'date-fns';
import * as XLSX from 'xlsx-js-style';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';

const formatDate = (dateValue: string | null | undefined, formatString: string = 'dd MMM yy') => {
    if (!dateValue) return 'N/A';
    try {
        const d = parseISO(dateValue);
        return isValid(d) ? format(d, formatString) : 'N/A';
    } catch {
        return 'N/A';
    }
};

type AttendanceData = {
    id: string;
    attendanceDate: string;
    branchName: string;
    employeeName: string;
    shift?: string;
    attendance: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'HOLIDAY';
    checkIn: string | null;
    checkOut: string | null;
};

type BranchOption = { id: string; name: string; code: string };

export function AttendanceDetailedClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    // Default to current month range
    const [fromDate, setFromDate] = useState<string>(() => {
        return format(startOfMonth(new Date()), 'yyyy-MM-dd');
    });
    const [tillDate, setTillDate] = useState<string>(() => {
        return format(new Date(), 'yyyy-MM-dd');
    });
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);

    // Submitted snapshot — updated only when "Show" is clicked. Export
    // filenames/subtitles/exportParams read these, not the live draft state above.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [submittedBranch, setSubmittedBranch] = useState<string>(selectedBranch);

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<AttendanceData[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
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

        setIsLoading(true);
        try {
            const branchParam = `&branchId=${selectedBranch || 'all'}`;
            const response = await apiClient.get<AttendanceData[]>(
                `/reports/employee/attendance-detailed?fromDate=${fromDate}&tillDate=${tillDate}${branchParam}`
            );
            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
                setSubmittedFromDate(fromDate);
                setSubmittedTillDate(tillDate);
                setSubmittedBranch(selectedBranch);
                toast({
                    title: 'Report generated',
                    description: `Successfully loaded ${response.data.length} attendance records.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to load attendance data.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to connect to the server.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setFromDate(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
        setTillDate(format(new Date(), 'yyyy-MM-dd'));
        setSelectedBranch('all');
        setSubmittedFromDate(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
        setSubmittedTillDate(format(new Date(), 'yyyy-MM-dd'));
        setSubmittedBranch('all');
        setShowReport(false);
        setData([]);
        setSearchQuery('');
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate the report first before exporting.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const { headers, rows } = buildAttendanceExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Employee Attendance Detailed Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance Detailed');
            const fileName = `Attendance_Detailed_${submittedFromDate}_to_${submittedTillDate}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export successful',
                description: 'Detailed attendance report has been exported to Excel.',
            });
        } catch (error) {
            toast({
                title: 'Export failed',
                description: 'Could not generate the Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildAttendanceExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Date', 'Branch', 'Employee', 'Assigned Shift', 'Status', 'Check-In', 'Check-Out'];
        const rows: (string | number)[][] = filteredData.map(item => [
            format(parseISO(item.attendanceDate), 'dd/MM/yyyy'),
            item.branchName,
            item.employeeName,
            item.shift || 'Default',
            item.attendance,
            item.checkIn ? format(parseISO(item.checkIn), 'HH:mm:ss') : 'N/A',
            item.checkOut ? format(parseISO(item.checkOut), 'HH:mm:ss') : 'N/A',
        ]);
        if (filteredData.length > 0) {
            const present = filteredData.filter(d => d.attendance === 'PRESENT').length;
            const absent = filteredData.filter(d => d.attendance === 'ABSENT').length;
            const halfDay = filteredData.filter(d => d.attendance === 'HALF_DAY').length;
            rows.push([
                'Grand Total:', `${filteredData.length} Records`, `Present: ${present}, Absent: ${absent}, Half Day: ${halfDay}`, '', '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { jsPDF } = await import('jspdf');
        const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
        const { drawAttendanceDetailedReport } = await import('@/app/lib/reports/attendance-detailed-pdf');
        const { headers, rows } = buildAttendanceExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawAttendanceDetailedReport(doc, { headers, rows }, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
        doc.save(`Attendance_Detailed_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'Export successful', description: 'Detailed attendance report has been exported to PDF.' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAttendanceExportRows();
        exportToCSV(`Attendance_Detailed_${submittedFromDate}_to_${submittedTillDate}`, 'EMPLOYEE ATTENDANCE DETAILED REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand
    // Total:" row (when present) is split off for distinct styling. 6 flat columns —
    // no grouping needed.
    const buildAttendanceDetailedWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: ['center', 'left', 'left', 'center', 'center', 'center'],
                columnWidthWeights: [9, 14, 14, 9, 9, 9],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAttendanceExportRows();
        const { bodyRows, options } = buildAttendanceDetailedWordOptions(rows);
        await exportToWord(`Attendance_Detailed_${submittedFromDate}_to_${submittedTillDate}`, 'EMPLOYEE ATTENDANCE DETAILED REPORT', headers, bodyRows, options);
    };

    const filteredData = useMemo(() => {
        if (!data || !Array.isArray(data)) return [];

        return data.filter(item =>
            (item.employeeName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.branchName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.attendance?.toLowerCase() || '').includes(searchQuery.toLowerCase())
        );
    }, [data, searchQuery]);

    const metrics = useMemo(() => {
        if (!filteredData || !Array.isArray(filteredData)) {
            return { total: 0, present: 0, halfDay: 0, absent: 0, rate: 0 };
        }
        const total = filteredData.length;
        const present = filteredData.filter(d => d.attendance === 'PRESENT').length;
        const halfDay = filteredData.filter(d => d.attendance === 'HALF_DAY').length;
        const absent = filteredData.filter(d => d.attendance === 'ABSENT').length;
        const rate = total > 0 ? Math.round(((present + (halfDay * 0.5)) / total) * 100) : 0;
        return { total, present, halfDay, absent, rate };
    }, [filteredData]);

    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = filteredData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'PRESENT':
            case 'PRESET':
            case 'FULL_DAY':
                return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 shadow-sm font-semibold">Present</Badge>;
            case 'ABSENT':
                return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200 shadow-sm font-semibold">Absent</Badge>;
            case 'HALF_DAY':
                return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200 shadow-sm font-semibold">Half Day</Badge>;
            case 'HOLIDAY':
                return <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200 shadow-sm font-semibold">Holiday</Badge>;
            case 'LEAVE':
                return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 shadow-sm font-semibold">Leave</Badge>;
            default:
                return <Badge variant="outline" className="text-slate-500 font-semibold">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            {/* Metric Cards */}
            {showReport && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard
                        title="Total Entries"
                        value={metrics.total.toString()}
                        subtitle="Attendance records in range"
                        icon={Users}
                        gradient="blue"
                    />
                    <MetricCard
                        title="Present"
                        value={metrics.present.toString()}
                        subtitle={`${metrics.total > 0 ? Math.round((metrics.present / metrics.total) * 100) : 0}% of total entries`}
                        icon={UserCheck}
                        gradient="green"
                    />
                    <MetricCard
                        title="Absent"
                        value={metrics.absent.toString()}
                        subtitle={`${metrics.total > 0 ? Math.round((metrics.absent / metrics.total) * 100) : 0}% of total entries`}
                        icon={UserX}
                        gradient="rose"
                    />
                    <MetricCard
                        title="Attendance Rate"
                        value={`${metrics.rate}%`}
                        subtitle={`Based on ${metrics.total} entries`}
                        icon={TrendingUp}
                        gradient="indigo"
                    />
                </div>
            )}

            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">Employee Attendance Detailed Report</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={isLoading}>
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

                        {/* From Date */}
                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                From Date
                            </Label>
                            <DatePickerField
                                id="fromDate"
                                value={fromDate}
                                onChange={setFromDate}
                                disabled={isLoading}
                            />
                        </div>

                        {/* Till Date */}
                        <div className="space-y-2">
                            <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Till Date
                            </Label>
                            <DatePickerField
                                id="tillDate"
                                value={tillDate}
                                onChange={setTillDate}
                                disabled={isLoading}
                            />
                        </div>

                        {/* Show */}
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

                        {/* Reset */}
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

                        {/* Export */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Export</Label>
                            <ExportDropdown
                                onExportPDF={!isLoading && data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && data.length > 0 ? handleExport : undefined}
                                onExportCSV={!isLoading && data.length > 0 ? handleExportCSV : undefined}
                                onExportWord={!isLoading && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && data.length > 0 && getReportExportMode('attendance-detailed') === 'REQUEST_QUEUE' ? 'attendance-detailed' : undefined}
                                canExport={canExportReport('attendance-detailed')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: submittedBranch === 'all' ? 'ALL' : [submittedBranch],
                                }}
                                className="h-11 w-full bg-gradient-to-r from-cyan-400 to-green-400 text-white border-cyan-400 shadow-lg transition-all hover:from-cyan-500 hover:to-primary hover:shadow-xl dark:border-cyan-400"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    {/* Search Bar */}
                    <CardHeader className="border-b border-primary/20 dark:border-sidebar-accent pb-4">
                        <ReportHeader title="Employee Attendance Detailed Report" />
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200">
                                    Attendance Records
                                </CardTitle>
                                <Badge variant="secondary" className="font-semibold">
                                    {filteredData.length} records
                                </Badge>
                            </div>
                            <div className="relative w-full md:w-72">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <Input
                                    placeholder="Search employee, branch..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="h-10 pl-10 text-sm"
                                />
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-full">
                                <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0 z-10">
                                    <TableRow className="hover:bg-primary/80">
                                        <TableHead className="px-4 py-3 font-semibold text-white">Date</TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white">Branch Name</TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white">Employee Name</TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white">Assigned Shift</TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-center">Check-In</TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-center">Check-Out</TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-center">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {paginatedData.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={7}
                                                className="px-4 py-8 text-center text-slate-500"
                                            >
                                                No data available for the selected date range
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {paginatedData.map((row, index) => (
                                                <TableRow
                                                    key={row.id}
                                                    className={cn(
                                                        'hover:bg-green-50/60 transition-colors dark:hover:bg-sidebar-accent/80',
                                                        index % 2 === 0
                                                            ? 'bg-white dark:bg-brand-green-darker'
                                                            : 'bg-green-50/70 dark:bg-brand-green-darker/80'
                                                    )}
                                                >
                                                    <TableCell className="px-4 py-3 text-sm font-medium text-foreground dark:text-slate-100">
                                                        {formatDate(row.attendanceDate, 'dd/MM/yyyy')}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                        {row.branchName}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm font-medium text-foreground dark:text-slate-100">
                                                        {row.employeeName}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                        <Badge variant="outline" className="font-normal text-xs">
                                                            {row.shift || 'Default'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-center text-sidebar-accent dark:text-slate-200">
                                                        {row.checkIn ? formatDate(row.checkIn, 'hh:mm a') : <span className="text-slate-300 dark:text-sidebar-accent">-</span>}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-center text-sidebar-accent dark:text-slate-200">
                                                        {row.checkOut ? formatDate(row.checkOut, 'hh:mm a') : <span className="text-slate-300 dark:text-sidebar-accent">-</span>}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-center">
                                                        {getStatusBadge(row.attendance)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-4 py-4 border-t border-primary/20 dark:border-sidebar-accent bg-green-50/40 dark:bg-brand-green-darker/40">
                                <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                    Showing <span className="font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                                    <span className="font-semibold">{Math.min(currentPage * itemsPerPage, filteredData.length)}</span>{' '}
                                    of <span className="font-semibold">{filteredData.length}</span> records
                                </p>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(1)}
                                        disabled={currentPage === 1}
                                        className="h-9 w-9"
                                    >
                                        <ChevronsLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                        disabled={currentPage === 1}
                                        className="h-9 w-9"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="px-4 py-2 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                        Page {currentPage} of {totalPages}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                        disabled={currentPage === totalPages}
                                        className="h-9 w-9"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setCurrentPage(totalPages)}
                                        disabled={currentPage === totalPages}
                                        className="h-9 w-9"
                                    >
                                        <ChevronsRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select date range and click Show to generate the Employee Attendance Detailed report
                    </p>
                </Card>
            )}
        </div>
    );
}
