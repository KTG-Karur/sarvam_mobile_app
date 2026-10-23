'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { Calendar, RefreshCw, Download, Loader2, ChevronLeft, ChevronRight, FileText, FileType, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getBranchDemandData, getBranchDemandTotals, type BranchDemandRow } from '@/app/lib/actions/branch-demand';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawBranchDemandReport } from '@/app/lib/reports/branch-demand-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';

// Format currency — truncates (not rounds) to whole rupees.
const formatCurrency = formatReportAmount;

// Format time
const formatTime = (timeString: string): string => {
    if (!timeString) return '';
    if (timeString === 'Total') return 'Total';
    // If already formatted, return as is
    if (/^\d{2}:\d{2}$/.test(timeString)) {
        return timeString;
    }
    // Try to parse and format
    try {
        const date = new Date(`2000-01-01T${timeString}`);
        if (isNaN(date.getTime())) return timeString;
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    } catch {
        return timeString;
    }
};

type Totals = {
    noOfClients: number;
    wb: number;
    osPri: number;
    osInt: number;
    arrearPri: number;
    arrearInt: number;
    arrearSavings: number;
    demandPri: number;
    demandInt: number;
    demandSavings: number;
    totalDemand: number;
};

type BranchOption = { id: string; name: string; code: string };

export function BranchDemandClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [demandDate, setDemandDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next Show click, so page-change
    // refetches and exports keep using the last-submitted date even if demandDate above is
    // edited afterward without clicking Show again.
    const [submittedDemandDate, setSubmittedDemandDate] = useState<string>(demandDate);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<BranchDemandRow[]>([]);
    const [totals, setTotals] = useState<Totals>({
        noOfClients: 0,
        wb: 0,
        osPri: 0,
        osInt: 0,
        arrearPri: 0,
        arrearInt: 0,
        arrearSavings: 0,
        demandPri: 0,
        demandInt: 0,
        demandSavings: 0,
        totalDemand: 0,
    });

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [totalRecords, setTotalRecords] = useState(0);
    const [totalPages, setTotalPages] = useState(0);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        getCentersForDropdown()
            .then((list) => setCenters(list))
            .catch(() => {});

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // Does the actual fetch (paginated data + totals). `dateOverride` lets handleShow pass the
    // just-read draft date straight through on the same click — reading submittedDemandDate
    // here would otherwise use the pre-update (stale) state, since setSubmittedDemandDate
    // hasn't re-rendered yet. The page-change effect below omits the override and gets the
    // last-submitted snapshot, which is the frozen-until-next-Show behavior it needs.
    const fetchBranchDemand = async (page: number, size: number, dateOverride?: string) => {
        const effDate = dateOverride ?? submittedDemandDate;
        setIsLoading(true);
        try {
            const response = await getBranchDemandData(effDate, page, size, selectedBranch, selectedCenter);
            setData(response.data);
            setTotalRecords(response.total);
            setTotalPages(response.totalPages);

            const totalsData = await getBranchDemandTotals(effDate, selectedBranch, selectedCenter);
            setTotals(totalsData);

            setShowReport(true);

            if (response.data.length === 0) {
                toast({
                    title: 'No data found',
                    description: 'No centers found for the selected date.',
                    variant: 'default',
                });
            } else {
                toast({
                    title: 'Report generated',
                    description: `Branch Demand report loaded successfully. Found ${response.total} records.`,
                });
            }
        } catch (error) {
            console.error('Error fetching branch demand data:', error);
            toast({
                title: 'Error',
                description: 'Failed to generate Branch Demand report.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleShow = async () => {
        if (!demandDate) {
            toast({
                title: 'Date required',
                description: 'Please select Demand Date before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        setSubmittedDemandDate(demandDate);
        await fetchBranchDemand(currentPage, pageSize, demandDate);
    };

    // Fetch data when page/page-size changes — reuses the submitted date, never the live draft.
    useEffect(() => {
        if (showReport) {
            fetchBranchDemand(currentPage, pageSize);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, pageSize]);

    const handleReset = () => {
        setDemandDate(new Date().toISOString().split('T')[0]);
        setSubmittedDemandDate(new Date().toISOString().split('T')[0]);
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setData([]);
        setCurrentPage(1);
        setTotalRecords(0);
        setTotalPages(0);
        setTotals({
            noOfClients: 0,
            wb: 0,
            osPri: 0,
            osInt: 0,
            arrearPri: 0,
            arrearInt: 0,
            arrearSavings: 0,
            demandPri: 0,
            demandInt: 0,
            demandSavings: 0,
            totalDemand: 0,
        });
    };

    const handleExport = async () => {
        if (!showReport || data.length === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate the report first before exporting.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const { headers, rows } = await buildBranchDemandExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Branch Demand Report', excelRows);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Branch Demand');

            // Set column widths
            ws['!cols'] = [
                { wch: 8 },  // Sl No
                { wch: 25 }, // FDO
                { wch: 35 }, // Center
                { wch: 15 }, // Meeting Time
                { wch: 12 }, // # Clients
                { wch: 8 },  // WB
                { wch: 15 }, // OS Pri
                { wch: 15 }, // OS Int
                { wch: 15 }, // Arrear Pri
                { wch: 15 }, // Arrear Int
                ...(loanAdvanceEnabled ? [{ wch: 15 }] : []), // Arrear Sav
                { wch: 15 }, // Demand Pri
                { wch: 15 }, // Demand Int
                ...(loanAdvanceEnabled ? [{ wch: 15 }] : []), // Demand Sav
                { wch: 18 }, // Total Demand
            ];

            // Generate file name
            const fileName = `Branch_Demand_${submittedDemandDate}.xlsx`;

            // Save file
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export successful',
                description: `Branch Demand report exported to ${fileName}`,
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export failed',
                description: 'Failed to export Branch Demand report.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the exact same field mapping used by handleExport above (kept
    // separate so handleExport is left untouched). Fetches the full (unpaginated)
    // dataset, same as handleExport does.
    const buildBranchDemandExportRows = async (): Promise<{ headers: string[]; rows: (string | number)[][] }> => {
        const fullData = await getBranchDemandData(submittedDemandDate, 1, 999999, selectedBranch, selectedCenter);
        const headers = [
            'Sl No', 'FDO', 'Center', 'Meeting Time', '# Clients', 'WB', 'OS Pri', 'OS Int',
            'Arrear Pri', 'Arrear Int', ...(loanAdvanceEnabled ? ['Arrear Sav'] : []),
            'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Sav'] : []),
            'Total Demand',
        ];
        const rows: (string | number)[][] = fullData.data.map((row, index) => [
            index + 1, row.fdo, row.center, formatTime(row.meetingTime), row.noOfClients, row.wb,
            truncateReportAmount(row.osPri), truncateReportAmount(row.osInt), truncateReportAmount(row.arrearPri), truncateReportAmount(row.arrearInt),
            ...(loanAdvanceEnabled ? [truncateReportAmount(row.arrearSavings || 0)] : []),
            truncateReportAmount(row.demandPri), truncateReportAmount(row.demandInt),
            ...(loanAdvanceEnabled ? [truncateReportAmount(row.demandSavings || 0)] : []),
            truncateReportAmount(row.totalDemand),
        ]);
        rows.push([
            '', 'GRAND TOTAL', '', '', totals.noOfClients, totals.wb, truncateReportAmount(totals.osPri), truncateReportAmount(totals.osInt),
            truncateReportAmount(totals.arrearPri), truncateReportAmount(totals.arrearInt),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.arrearSavings || 0)] : []),
            truncateReportAmount(totals.demandPri), truncateReportAmount(totals.demandInt),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.demandSavings || 0)] : []),
            truncateReportAmount(totals.totalDemand),
        ]);
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await getBranchDemandData(submittedDemandDate, 1, 999999, selectedBranch, selectedCenter);
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const reportFont = await ensureReportFont(doc);
        await drawBranchDemandReport(doc, fullData.data, { subtitle: `Demand Date: ${submittedDemandDate}` }, reportFont, undefined, loanAdvanceEnabled);
        doc.save(`Branch_Demand_${submittedDemandDate}.pdf`);
        toast({ title: 'PDF exported', description: 'Report downloaded as PDF.' });
    };

    const handleExportCSV = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = await buildBranchDemandExportRows();
        exportToCSV(`Branch_Demand_${submittedDemandDate}`, 'BRANCH DEMAND REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing GRAND TOTAL
    // row is split off for distinct styling, and the OS/Arrear/Demand Principal-Interest
    // (-Savings) triples get a 2-row grouped header — genuine related fields.
    const buildBranchDemandWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Sl No', span: 1 },
                { label: 'FDO', span: 1 },
                { label: 'Center', span: 1 },
                { label: 'Meeting Time', span: 1 },
                { label: '# Clients', span: 1 },
                { label: 'WB', span: 1 },
                { label: 'OS', span: 2 },
                { label: 'ARREAR', span: loanAdvanceEnabled ? 3 : 2 },
                { label: 'DEMAND', span: loanAdvanceEnabled ? 3 : 2 },
                { label: 'Total Demand', span: 1 },
            ],
            subHeaders: loanAdvanceEnabled
                ? ['Principal', 'Interest', 'Principal', 'Interest', 'Savings', 'Principal', 'Interest', 'Savings']
                : ['Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: loanAdvanceEnabled
                ? ['center', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
                : ['center', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: loanAdvanceEnabled
                ? [4, 10, 12, 8, 6, 6, 8, 8, 8, 8, 8, 8, 8, 8, 9]
                : [4, 11, 13, 9, 7, 7, 9, 9, 9, 9, 9, 9, 10],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWordFile = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = await buildBranchDemandExportRows();
        const { bodyRows, options } = buildBranchDemandWordOptions(rows);
        await exportToWord(`Branch_Demand_${submittedDemandDate}`, 'BRANCH DEMAND REPORT', headers, bodyRows, options);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    const handlePageSizeChange = (newSize: string) => {
        setPageSize(Number(newSize));
        setCurrentPage(1); // Reset to first page
    };

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold">
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
                            <Label htmlFor="centerName" className="text-sm font-semibold">
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

                        {/* Demand Date */}
                        <div className="space-y-2">
                            <Label htmlFor="demandDate" className="text-sm font-semibold">
                                Demand Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="demandDate"
                                    value={demandDate}
                                    onChange={(e) => setDemandDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Actions</Label>
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-11 w-full bg-gradient-to-r from-primary to-primary text-white shadow-lg transition-all hover:from-sidebar-accent hover:to-primary hover:shadow-xl"
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
                                variant="destructive"
                                className="h-11 w-full shadow-lg transition-all hover:shadow-xl"
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
                                reportSlug={!isLoading && showReport && getReportExportMode('branch-demand') === 'REQUEST_QUEUE' ? 'branch-demand' : undefined}
                                canExport={canExportReport('branch-demand')}
                                exportParams={{
                                    fromDate: submittedDemandDate,
                                    branchIds: selectedBranch !== 'all' ? [selectedBranch] : 'ALL',
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-11 w-full bg-sidebar-accent text-white border-sidebar-accent shadow-lg transition-all hover:bg-brand-green-darker hover:shadow-xl dark:bg-sidebar-accent dark:border-sidebar-accent dark:hover:bg-sidebar-accent/80"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-0">
                        <ReportHeader title="Branch Demand Report" />
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-full">
                                <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0 z-10">
                                    <TableRow className="hover:bg-primary/80">
                                        <TableHead className="px-4 py-3 font-semibold text-white">
                                            FDO
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white">
                                            Center
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white">
                                            Meeting Time
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            # Clients
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            WB
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            OS Pri
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            OS Int
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Arrear Pri
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Arrear Int
                                        </TableHead>
                                        {loanAdvanceEnabled && (
                                            <TableHead className="px-4 py-3 font-semibold text-emerald-200 text-right">
                                                Arrear Adv
                                            </TableHead>
                                        )}
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Demand Pri
                                        </TableHead>
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Demand Int
                                        </TableHead>
                                        {loanAdvanceEnabled && (
                                            <TableHead className="px-4 py-3 font-semibold text-emerald-200 text-right">
                                                Demand Adv
                                            </TableHead>
                                        )}
                                        <TableHead className="px-4 py-3 font-semibold text-white text-right">
                                            Total Demand
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={14}
                                                className="px-4 py-8 text-center text-slate-500"
                                            >
                                                No data available for the selected date
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {data.map((row, index) => (
                                                <TableRow
                                                    key={`${row.fdoId}-${row.centerId}`}
                                                    className="bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80"
                                                >
                                                    <TableCell className="px-4 py-3 font-medium text-foreground dark:text-slate-100">
                                                        {row.fdo}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                                                        {row.center}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                                                        {formatTime(row.meetingTime)}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.noOfClients}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.wb}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.osPri > 0 ? formatCurrency(row.osPri) : '0'}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.osInt > 0 ? formatCurrency(row.osInt) : '0'}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.arrearPri > 0 ? formatCurrency(row.arrearPri) : '0'}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.arrearInt > 0 ? formatCurrency(row.arrearInt) : '0'}
                                                    </TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                                                            {(row.arrearSavings || 0) > 0 ? formatCurrency(row.arrearSavings || 0) : '0'}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.demandPri > 0 ? formatCurrency(row.demandPri) : '0'}
                                                    </TableCell>
                                                    <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                        {row.demandInt > 0 ? formatCurrency(row.demandInt) : '0'}
                                                    </TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                                                            {(row.demandSavings || 0) > 0 ? formatCurrency(row.demandSavings || 0) : '0'}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="px-4 py-3 text-right font-semibold text-foreground dark:text-slate-100">
                                                        {row.totalDemand > 0 ? formatCurrency(row.totalDemand) : '0'}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {/* Totals Row */}
                                            <TableRow className="font-bold bg-brand-green-tint dark:bg-brand-green-darker/30 border-t-2 border-primary/50 dark:border-sidebar-accent">
                                                <TableCell className="px-4 py-3 text-foreground dark:text-green-100" colSpan={3}>
                                                    GRAND TOTAL
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {totals.noOfClients}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {totals.wb}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.osPri)}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.osInt)}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.arrearPri)}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.arrearInt)}
                                                </TableCell>
                                                {loanAdvanceEnabled && (
                                                    <TableCell className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                                                        {formatCurrency(totals.arrearSavings || 0)}
                                                    </TableCell>
                                                )}
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.demandPri)}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.demandInt)}
                                                </TableCell>
                                                {loanAdvanceEnabled && (
                                                    <TableCell className="px-4 py-3 text-right text-emerald-700 dark:text-emerald-400">
                                                        {formatCurrency(totals.demandSavings || 0)}
                                                    </TableCell>
                                                )}
                                                <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.totalDemand)}
                                                </TableCell>
                                            </TableRow>
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination Controls */}
                        {data.length > 0 && (
                            <div className="flex items-center justify-between border-t border-primary/20 bg-green-50 px-6 py-4 dark:border-sidebar-accent dark:bg-brand-green-darker/60">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-sm font-medium">Rows per page:</Label>
                                        <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                                            <SelectTrigger className="h-9 w-20">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="5">5</SelectItem>
                                                <SelectItem value="10">10</SelectItem>
                                                <SelectItem value="25">25</SelectItem>
                                                <SelectItem value="50">50</SelectItem>
                                                <SelectItem value="100">100</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} entries
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1 || isLoading}
                                        className="h-9 w-9 p-0"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <div className="flex items-center gap-1">
                                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                            let pageNum;
                                            if (totalPages <= 5) {
                                                pageNum = i + 1;
                                            } else if (currentPage <= 3) {
                                                pageNum = i + 1;
                                            } else if (currentPage >= totalPages - 2) {
                                                pageNum = totalPages - 4 + i;
                                            } else {
                                                pageNum = currentPage - 2 + i;
                                            }

                                            return (
                                                <Button
                                                    key={pageNum}
                                                    variant={currentPage === pageNum ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => handlePageChange(pageNum)}
                                                    disabled={isLoading}
                                                    className="h-9 w-9 p-0"
                                                >
                                                    {pageNum}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPages || isLoading}
                                        className="h-9 w-9 p-0"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <Download className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select demand date and click Show to generate the Branch Demand report
                    </p>
                </Card>
            )}
        </div>
    );
}
