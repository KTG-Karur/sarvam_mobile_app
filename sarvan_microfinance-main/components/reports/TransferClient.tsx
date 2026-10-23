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
import { RefreshCw, Download, Loader2, FileText, FileBarChart, FileSpreadsheet, FileOutput, Calendar, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawTransferReport } from '@/app/lib/reports/transfer-pdf';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';

type TransferData = {
    clientName: string;
    oldCenterName: string;
    fromDate: string;
    tillDate: string;
    newCenterName: string;
    oldClientId: string;
    newClientId: string;
    performedBy: string;
    remarks: string;
};

type BranchOption = { id: string; name: string; code: string };

export function TransferClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [fromDate, setFromDate] = useState<string>(
        new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [submittedFromDate, setSubmittedFromDate] = useState<string>(
        new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    );
    const [submittedTillDate, setSubmittedTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<TransferData[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

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
                title: 'Missing dates',
                description: 'Please select both From and Till dates.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            let url = `/reports/client/transfer?fromDate=${fromDate}&tillDate=${tillDate}`;

            if (selectedCenter !== 'all') {
                url += `&centerId=${selectedCenter}`;
            }

            if (selectedBranch !== 'all') {
                url += `&branchId=${selectedBranch}`;
            }

            const response = await apiClient.get<TransferData[]>(url);

            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
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
        setFromDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
        setTillDate(new Date().toISOString().split('T')[0]);
        setSubmittedFromDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
        setSubmittedTillDate(new Date().toISOString().split('T')[0]);
        setShowReport(false);
        setData([]);
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (!data || data.length === 0) {
            toast({
                title: 'No data',
                description: 'There is no data to export.',
                variant: 'destructive',
            });
            return;
        }

        setIsExporting(true);
        try {
            const { headers, rows } = buildTransferExportRows();

            const csvContent = [
                headers.join(','),
                ...rows.map(r => r.map((cell) => (typeof cell === 'number' ? cell : `"${String(cell).replace(/"/g, '""')}"`)).join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Client_Transfer_Report_${submittedFromDate}_to_${submittedTillDate}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            toast({
                title: 'Export successful',
                description: 'Your report has been downloaded.',
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export failed',
                description: 'Failed to generate CSV file.',
                variant: 'destructive',
            });
        } finally {
            setIsExporting(false);
        }
    };

    // Shared field mapping for all four export formats (CSV, Excel, PDF, Word) —
    // ensures they all respect the active search filter (searchedRows).
    const buildTransferExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Client Name', 'Old Client ID', 'New Client ID', 'Old Center', 'New Center',
            'From Date', 'Transfer Date', 'Performed By', 'Remarks',
        ];
        const rows: (string | number)[][] = searchedRows.map((row) => [
            row.clientName, row.oldClientId, row.newClientId, row.oldCenterName, row.newCenterName,
            row.fromDate, row.tillDate, row.performedBy, row.remarks,
        ]);
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildTransferExportRows();
        const rowObjects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Client Transfer Report', rowObjects);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Transfers');
        XLSX.writeFile(wb, `Client_Transfer_Report_${submittedFromDate}_to_${submittedTillDate}.xlsx`);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as Excel.' });
    };

    const handleExportPDF = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawTransferReport(doc, searchedRows, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
        doc.save(`Client_Transfer_Report_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'Export successful', description: 'Your report has been downloaded as PDF.' });
    };

    // Word-only presentation: same rows as Excel/PDF above. No totals row exists in this
    // report today (transfer log, not a financial roll-up) and 9 flat columns don't
    // warrant grouped headers — just professional header/zebra/alignment/width styling.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['left', 'center', 'center', 'left', 'left', 'center', 'center', 'left', 'left'],
        columnWidthWeights: [14, 10, 10, 12, 12, 8, 8, 10, 14],
    };

    const handleExportWord = async () => {
        if (!data || data.length === 0) {
            toast({ title: 'No data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildTransferExportRows();
        await exportToWord(`Client_Transfer_Report_${submittedFromDate}_to_${submittedTillDate}`, 'CLIENT TRANSFER REPORT', headers, rows, wordOptions);
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
                                    Transfer Filters
                                </CardTitle>
                                <CardDescription>Select range and center to view transfers</CardDescription>
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
                                onExportCSV={!isLoading && showReport && data.length > 0 ? handleExport : undefined}
                                onExportWord={!isLoading && showReport && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && showReport && data.length > 0 && getReportExportMode('transfer') === 'REQUEST_QUEUE' ? 'transfer' : undefined}
                                canExport={canExportReport('transfer')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
                        <div className="space-y-2">
                            <Label htmlFor="center" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Center (Old)
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                <SelectTrigger id="center" className="h-11 bg-green-50/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary/20 transition-all">
                                    <SelectValue placeholder="Select Center" />
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
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-none shadow-2xl bg-white dark:bg-green-950 overflow-hidden">
                    <CardHeader className="border-b border-slate-100 dark:border-sidebar-accent">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <ReportHeader title="Client Transfer Report" />
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
                                            Client Name
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Old ID
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            New ID
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Old Center
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            New Center
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap text-center">
                                            From Date
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap text-center">
                                            Trans. Date
                                        </TableHead>
                                        <TableHead className="px-4 py-4 font-bold text-white text-xs uppercase tracking-widest whitespace-nowrap">
                                            Performed By
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={8}
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
                                                <TableCell className="px-4 py-4">
                                                    <span className="font-semibold text-foreground dark:text-slate-100">
                                                        {row.clientName}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-xs font-mono text-slate-500">
                                                    {row.oldClientId}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-xs font-mono text-primary dark:text-primary font-bold">
                                                    {row.newClientId}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-400">
                                                    {row.oldCenterName}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm font-medium text-sidebar-accent dark:text-slate-200">
                                                    {row.newCenterName}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-center text-slate-500">
                                                    {row.fromDate}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-center font-bold text-foreground dark:text-slate-100">
                                                    {row.tillDate}
                                                </TableCell>
                                                <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-400">
                                                    {row.performedBy}
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
                        Select your criteria and click "Show Report" to view client transfer history.
                    </p>
                </div>
            )}
        </div>
    );
}
