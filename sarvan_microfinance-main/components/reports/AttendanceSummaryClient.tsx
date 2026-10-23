'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DatePickerField } from '@/components/ui/date-picker-field';
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
import { RefreshCw, Download, Loader2, FileText, Users, UserCheck, UserX, Clock, TrendingUp, FileType, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { format, startOfMonth } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawAttendanceSummaryReport } from '@/app/lib/reports/attendance-summary-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

type AttendanceSummaryData = {
    branchName: string;
    employeeName: string;
    present: number;
    absent: number;
    halfDay: number;
    fullDay: number;
};

type BranchOption = { id: string; name: string; code: string };

export function AttendanceSummaryClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [fromDate, setFromDate] = useState<string>(() =>
        format(startOfMonth(new Date()), 'yyyy-MM-dd')
    );
    const [tillDate, setTillDate] = useState<string>(() =>
        format(new Date(), 'yyyy-MM-dd')
    );
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);

    // Submitted snapshot — updated only when "Show" is clicked. Export
    // filenames/subtitles/exportParams read these, not the live draft state above.
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(tillDate);
    const [submittedBranch, setSubmittedBranch] = useState<string>(selectedBranch);

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<AttendanceSummaryData[]>([]);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // Calculate metrics
    const totalEmployees = data.length;
    const totalPresent = data.reduce((sum, item) => sum + item.present, 0);
    const totalAbsent = data.reduce((sum, item) => sum + item.absent, 0);
    const totalHalfDay = data.reduce((sum, item) => sum + item.halfDay, 0);
    const totalFullDay = data.reduce((sum, item) => sum + item.fullDay, 0);
    const totalDays = totalPresent + totalAbsent + totalHalfDay;
    const attendanceRate = totalDays > 0 ? Math.round((totalPresent / totalDays) * 100) : 0;

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

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
            const response = await apiClient.get<AttendanceSummaryData[]>(
                `/reports/employee/attendance-summary?fromDate=${fromDate}&tillDate=${tillDate}${branchParam}`
            );

            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setSubmittedFromDate(fromDate);
                setSubmittedTillDate(tillDate);
                setSubmittedBranch(selectedBranch);
                toast({
                    title: 'Report generated',
                    description: `Attendance summary loaded for ${response.data.length} employees.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to load attendance summary.',
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
            const { headers, rows } = buildAttendanceSummaryExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Employee Attendance Summary Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance Summary');
            const fileName = `Attendance_Summary_${submittedFromDate}_to_${submittedTillDate}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export successful',
                description: 'Attendance summary has been exported to Excel.',
            });
        } catch (error) {
            toast({
                title: 'Export failed',
                description: 'Could not generate the Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the exact same field mapping used by handleExport above (kept
    // separate so handleExport is left untouched).
    const buildAttendanceSummaryExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Branch Name', 'Employee Name', 'Present', 'Absent', 'Half Day', 'Full Day'];
        const rows: (string | number)[][] = searchedRows.map((row) => [
            row.branchName, row.employeeName, row.present, row.absent, row.halfDay, row.fullDay,
        ]);
        rows.push(['', 'Grand Total', totalPresent, totalAbsent, totalHalfDay, totalFullDay]);
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAttendanceSummaryExportRows();
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const reportFont = await ensureReportFont(doc);
        await drawAttendanceSummaryReport(doc, { headers, rows }, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
        doc.save(`Attendance_Summary_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'PDF exported', description: 'Attendance summary has been exported to PDF.' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAttendanceSummaryExportRows();
        exportToCSV(`Attendance_Summary_${submittedFromDate}_to_${submittedTillDate}`, 'EMPLOYEE ATTENDANCE SUMMARY REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total"
    // row is split off for distinct styling. 6 flat columns — no grouping needed.
    const buildAttendanceSummaryWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [14, 16, 8, 8, 8, 8],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWordFile = async () => {
        if (data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAttendanceSummaryExportRows();
        const { bodyRows, options } = buildAttendanceSummaryWordOptions(rows);
        await exportToWord(`Attendance_Summary_${submittedFromDate}_to_${submittedTillDate}`, 'EMPLOYEE ATTENDANCE SUMMARY REPORT', headers, bodyRows, options);
    };

    return (
        <div className="space-y-6">
            {/* Metric Cards */}
            {showReport && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard
                        title="Total Employees"
                        value={totalEmployees.toString()}
                        subtitle={`Employees in report`}
                        icon={Users}
                        gradient="blue"
                    />
                    <MetricCard
                        title="Total Present"
                        value={totalPresent.toString()}
                        subtitle={`${totalDays > 0 ? Math.round((totalPresent / totalDays) * 100) : 0}% of total days`}
                        icon={UserCheck}
                        gradient="green"
                    />
                    <MetricCard
                        title="Total Absent"
                        value={totalAbsent.toString()}
                        subtitle={`${totalDays > 0 ? Math.round((totalAbsent / totalDays) * 100) : 0}% of total days`}
                        icon={UserX}
                        gradient="rose"
                    />
                    <MetricCard
                        title="Attendance Rate"
                        value={`${attendanceRate}%`}
                        subtitle={`Based on ${totalDays} total days`}
                        icon={TrendingUp}
                        gradient="indigo"
                    />
                </div>
            )}

            {/* Additional Metric Cards for Half Day and Full Day */}
            {showReport && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <MetricCard
                        title="Total Half Day"
                        value={totalHalfDay.toString()}
                        subtitle={`Half day attendance count`}
                        icon={Clock}
                        gradient="orange"
                    />
                    <MetricCard
                        title="Total Full Day"
                        value={totalFullDay.toString()}
                        subtitle={`Full day attendance count`}
                        icon={UserCheck}
                        gradient="purple"
                    />
                </div>
            )}

            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">Employee Attendance Summary Report</CardTitle>
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

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Export</Label>
                            <ExportDropdown
                                onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && showReport ? handleExport : undefined}
                                onExportCSV={!isLoading && showReport ? handleExportCSV : undefined}
                                onExportWord={!isLoading && showReport ? handleExportWordFile : undefined}
                                reportSlug={!isLoading && showReport && getReportExportMode('attendance-summary') === 'REQUEST_QUEUE' ? 'attendance-summary' : undefined}
                                canExport={canExportReport('attendance-summary')}
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
                    <CardHeader className="pb-0">
                        <ReportHeader title="Employee Attendance Summary Report" />
                    </CardHeader>
                    <div className="flex flex-wrap items-center gap-4 px-6 pb-2">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search attendance..."
                            className="ml-auto"
                        />
                    </div>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-full">
                                <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0 z-10">
                                    <TableRow className="hover:bg-primary/80">
                                        <TableHead className="px-4 py-3 font-semibold text-white">
                                            Branch Name
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white">
                                            Employee Name
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Present
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Absent
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Half Day
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Full Day
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={6}
                                                className="px-4 py-8 text-center text-slate-500"
                                            >
                                                No data available for the selected date range
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {searchedRows.map((row, index) => (
                                                <TableRow
                                                    key={index}
                                                    className={cn(
                                                        'bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80'
                                                    )}
                                                >
                                                    <TableCell className="px-4 py-3 text-sm text-sidebar-accent dark:text-slate-200">
                                                        {row.branchName}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm font-medium text-foreground dark:text-slate-100">
                                                        {row.employeeName}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.present}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.absent}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.halfDay}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.fullDay}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {/* Grand Total Row */}
                                            {data.length > 0 && (
                                                <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/50 dark:to-brand-green-darker/50 font-bold border-t-2 border-primary/50 dark:border-sidebar-accent">
                                                    <TableCell colSpan={2} className="px-4 py-3 text-sm text-foreground dark:text-green-100">
                                                        Grand Total
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-foreground dark:text-green-100">
                                                        {totalPresent}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-foreground dark:text-green-100">
                                                        {totalAbsent}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-foreground dark:text-green-100">
                                                        {totalHalfDay}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sm text-right text-foreground dark:text-green-100">
                                                        {totalFullDay}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <FileText className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select date range and click Show to generate the Employee Attendance Summary report
                    </p>
                </Card>
            )}
        </div>
    );
}
