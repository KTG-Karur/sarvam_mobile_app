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
import { RefreshCw, Download, Loader2, FileBarChart, FileType, FileOutput, Users, Wallet } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawLoanSavingsReport } from '@/app/lib/reports/loan-savings-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

type LoanAdvanceRow = {
    clientCode: string;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchCode: string;
    branchName: string;
    centreCode: string;
    centerName: string;
    fdoName: string;
    memberId: string;
    memberName: string;
    nomineeName: string;
    phoneNumber: string;
    aadhaarNumber: string;
    loanAdvanceOS: number;
};

type Totals = {
    clientCount: number;
    totalLoanAdvanceOS: number;
};

// Truncates (not rounds) to whole rupees, matches the project-wide report-amount convention.
const fmt = formatReportAmount;

export function LoanSavingsReportClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled, loading: loanAdvanceEnabledLoading } = useLoanAdvanceEnabled();

    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [centers, setCenters] = useState<{ id: string; name: string; code: string; branchId?: string }[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<LoanAdvanceRow[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<number | 'all'>(10);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    useEffect(() => {
        fetch('/api/branches')
            .then(r => r.json())
            .then(d => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
        fetch('/api/centers')
            .then(r => r.json())
            .then(d => {
                const arr = Array.isArray(d) ? d : (d.data ?? []);
                setCenters(arr);
            })
            .catch(() => {});
    }, []);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter(c => c.branchId === selectedBranch);

    const fetchReport = async () => {
        setIsLoading(true);
        setShowReport(false);
        try {
            const params = new URLSearchParams();
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);

            const res = await fetch(`/api/reports/collection/loan-savings?${params}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const result = await res.json();
            setData(result.data ?? []);
            setTotals(result.totals ?? null);
            setPageSize(10);
            setCurrentPage(1);
            setShowReport(true);
        } catch {
            toast({ title: 'Error', description: 'Failed to load Loan Advance Report.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePageSizeChange = (val: string) => {
        setPageSize(val === 'all' ? 'all' : Number(val));
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        const headers = [
            'S.No', 'Region Name', 'Division Name', 'Area Name',
            'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
            'FDO Name', 'Member ID', 'Member Name', 'Nominee Name',
            'Phone Number', 'Aadhaar Number', 'Loan Advance O/S',
        ];
        const rows: (string | number)[][] = [
            ...reportHeaderRows('Loan Advance Report'),
            headers,
            ...data.map((r, i) => [
                i + 1,
                r.regionName,
                r.divisionName,
                r.areaName,
                r.branchCode,
                r.branchName,
                r.centreCode,
                r.centerName,
                r.fdoName,
                r.memberId,
                r.memberName,
                r.nomineeName,
                r.phoneNumber,
                r.aadhaarNumber,
                truncateReportAmount(r.loanAdvanceOS),
            ]),
        ];
        if (totals) {
            rows.push([]);
            rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', truncateReportAmount(totals.totalLoanAdvanceOS)]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Loan Advance');
        XLSX.writeFile(wb, `LoanAdvance_${today}.xlsx`);
        toast({ title: 'Exported', description: 'Report exported to Excel.' });
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildLoanAdvanceExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Region Name', 'Division Name', 'Area Name',
            'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
            'FDO Name', 'Member ID', 'Member Name', 'Nominee Name',
            'Phone Number', 'Aadhaar Number', 'Loan Advance O/S',
        ];
        const rows: (string | number)[][] = data.map((r, i) => [
            i + 1, r.regionName, r.divisionName, r.areaName, r.branchCode, r.branchName,
            r.centreCode, r.centerName, r.fdoName, r.memberId, r.memberName, r.nomineeName,
            r.phoneNumber, r.aadhaarNumber, truncateReportAmount(r.loanAdvanceOS),
        ]);
        if (totals) {
            rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', truncateReportAmount(totals.totalLoanAdvanceOS)]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        const { headers, rows } = buildLoanAdvanceExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawLoanSavingsReport(doc, headers, rows, reportFont);
        doc.save(`LoanAdvance_${today}.pdf`);
        toast({ title: 'Exported', description: 'Report exported to PDF.' });
    };

    const handleExportCSV = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        const { headers, rows } = buildLoanAdvanceExportRows();
        exportToCSV(`LoanAdvance_${today}`, 'LOAN ADVANCE REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "TOTAL" row
    // (when present) is split off for distinct styling. 15 flat columns, single "Loan
    // Advance O/S" amount column — no genuine repeated-prefix pairs to group.
    const buildLoanAdvanceWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'center', 'left', 'left', 'center', 'center', 'right'],
                columnWidthWeights: [4, 9, 9, 9, 7, 10, 7, 10, 9, 7, 10, 9, 8, 8, 9],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data', description: 'Generate report first.', variant: 'destructive' });
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        const { headers, rows } = buildLoanAdvanceExportRows();
        const { bodyRows, options } = buildLoanAdvanceWordOptions(rows);
        await exportToWord(`LoanAdvance_${today}`, 'LOAN ADVANCE REPORT', headers, bodyRows, options);
    };

    if (!loanAdvanceEnabledLoading && !loanAdvanceEnabled) {
        return (
            <div className="space-y-6">
                <ReportHeader title="Loan Advance Report" />
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <p className="text-base font-medium">Loan Advance is currently disabled</p>
                        <p className="text-sm mt-1">Ask an Admin to enable it from Hub → Settings to use this report.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Filters */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Branch</Label>
                            <Select value={selectedBranch} onValueChange={v => { setSelectedBranch(v); setSelectedCenter('all'); }}>
                                <SelectTrigger><SelectValue placeholder="All Branches" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Center</Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                <SelectTrigger><SelectValue placeholder="All Centers" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Centers</SelectItem>
                                    {filteredCenters.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.code ? `${c.code} - ${c.name}` : c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="mt-4 flex gap-3">
                        <Button onClick={fetchReport} disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-700">
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Generate Report
                        </Button>
                        {showReport && (
                            <>
                                <ExportDropdown
                                    onExportPDF={data.length > 0 ? handleExportPDF : undefined}
                                    onExportExcel={data.length > 0 ? handleExport : undefined}
                                    onExportCSV={data.length > 0 ? handleExportCSV : undefined}
                                    canExport={canExportReport('loan-savings')}
                                    onExportWord={data.length > 0 ? handleExportWord : undefined}
                                    reportSlug={data.length > 0 && getReportExportMode('loan-savings') === 'REQUEST_QUEUE' ? 'loan-savings' : undefined}
                                    exportParams={{
                                        fromDate: null,
                                        toDate: null,
                                        branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                        filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                    }}
                                />
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Summary — computed from the searched rows so it always matches the table below */}
            {showReport && totals && (() => {
                const memberCount = searchedRows.length;
                const totalOS = searchedRows.reduce((sum, r) => sum + r.loanAdvanceOS, 0);
                const centerCount = new Set(searchedRows.map((r) => `${r.branchCode}|${r.centreCode}`)).size;
                const branchCount = new Set(searchedRows.map((r) => r.branchCode)).size;
                return (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-50/50 dark:border-purple-800/50 dark:from-purple-950/20 dark:to-purple-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Member Count</p>
                                        <p className="mt-2 text-2xl font-bold text-foreground dark:text-purple-100">{memberCount.toLocaleString('en-IN')}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Centers: {centerCount.toLocaleString('en-IN')} · Branches: {branchCount.toLocaleString('en-IN')}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <Users className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-50/50 dark:border-blue-800/50 dark:from-blue-950/20 dark:to-blue-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Loan Advance O/S</p>
                                        <p className="mt-2 text-2xl font-bold text-foreground dark:text-blue-100">{fmt(totalOS)}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Avg per Member: {fmt(memberCount > 0 ? totalOS / memberCount : 0)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/50">
                                        <Wallet className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                );
            })()}

            {/* Table */}
            {showReport && (() => {
                const totalPages = pageSize === 'all' ? 1 : Math.ceil(searchedRows.length / (pageSize as number));
                const paginatedData = pageSize === 'all' ? searchedRows : searchedRows.slice((currentPage - 1) * (pageSize as number), currentPage * (pageSize as number));
                return (
                    <Card className="overflow-hidden border-none bg-white shadow-xl dark:bg-green-950">
                        <CardHeader className="border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                            <ReportHeader title="Loan Advance Report" />
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <CardTitle className="text-base font-bold">
                                    Loan Advance Report — {searchedRows.length} client{searchedRows.length !== 1 ? 's' : ''}
                                </CardTitle>
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search loan advance..."
                                    className="ml-auto"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table className="min-w-max w-full text-xs">
                                    <TableHeader className="sticky top-0 z-20 bg-brand-green-tint dark:bg-sidebar-accent">
                                        <TableRow>
                                            <TableHead className="font-bold w-10">S.No</TableHead>
                                            <TableHead className="font-bold">Region</TableHead>
                                            <TableHead className="font-bold">Division</TableHead>
                                            <TableHead className="font-bold">Area</TableHead>
                                            <TableHead className="font-bold">Branch ID</TableHead>
                                            <TableHead className="font-bold">Branch Name</TableHead>
                                            <TableHead className="font-bold">Centre ID</TableHead>
                                            <TableHead className="font-bold">Center Name</TableHead>
                                            <TableHead className="font-bold">FDO Name</TableHead>
                                            <TableHead className="font-bold">Member ID</TableHead>
                                            <TableHead className="font-bold">Member Name</TableHead>
                                            <TableHead className="font-bold">Nominee Name</TableHead>
                                            <TableHead className="font-bold">Phone</TableHead>
                                            <TableHead className="font-bold">Aadhaar</TableHead>
                                            <TableHead className="font-bold text-right text-sidebar-accent dark:text-primary">Loan Advance O/S</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={15} className="py-12 text-center text-slate-500">
                                                    No clients with outstanding loan advance balance found.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            paginatedData.map((row, idx) => {
                                                const sno = pageSize === 'all'
                                                    ? idx + 1
                                                    : (currentPage - 1) * (pageSize as number) + idx + 1;
                                                return (
                                                    <TableRow key={row.memberId + idx} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/50">
                                                        <TableCell className="text-center text-slate-500">{sno}</TableCell>
                                                        <TableCell>{row.regionName}</TableCell>
                                                        <TableCell>{row.divisionName}</TableCell>
                                                        <TableCell>{row.areaName}</TableCell>
                                                        <TableCell>{row.branchCode}</TableCell>
                                                        <TableCell>{row.branchName}</TableCell>
                                                        <TableCell>{row.centreCode}</TableCell>
                                                        <TableCell>{row.centerName}</TableCell>
                                                        <TableCell>{row.fdoName}</TableCell>
                                                        <TableCell className="font-mono">{row.memberId}</TableCell>
                                                        <TableCell>
                                                            <div className="font-medium">{row.memberName}</div>
                                                        </TableCell>
                                                        <TableCell>{row.nomineeName || '—'}</TableCell>
                                                        <TableCell className="font-mono">{row.phoneNumber}</TableCell>
                                                        <TableCell className="font-mono">{row.aadhaarNumber}</TableCell>
                                                        <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary">
                                                            ₹{fmt(row.loanAdvanceOS)}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                            {searchedRows.length > 0 && (
                                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-sidebar-accent">
                                    <div className="flex items-center gap-3">
                                        <span>Rows per page:</span>
                                        <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                                            <SelectTrigger className="h-7 w-20 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="10">10</SelectItem>
                                                <SelectItem value="20">20</SelectItem>
                                                <SelectItem value="50">50</SelectItem>
                                                <SelectItem value="all">All</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <span>
                                            {pageSize === 'all'
                                                ? `All ${searchedRows.length} rows`
                                                : `Showing ${Math.min((currentPage - 1) * (pageSize as number) + 1, searchedRows.length)}–${Math.min(currentPage * (pageSize as number), searchedRows.length)} of ${searchedRows.length}`}
                                        </span>
                                    </div>
                                    {pageSize !== 'all' && totalPages > 1 && (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setCurrentPage(p => p - 1)}
                                                disabled={currentPage === 1}
                                            >
                                                Previous
                                            </Button>
                                            <span>Page {currentPage} of {totalPages}</span>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setCurrentPage(p => p + 1)}
                                                disabled={currentPage === totalPages}
                                            >
                                                Next
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })()}
        </div>
    );
}
