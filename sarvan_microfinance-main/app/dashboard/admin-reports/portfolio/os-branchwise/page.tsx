'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import {
    BarChart3,
    Download,
    FileText,
    FileSpreadsheet,
    FileType,
    Printer,
    Calendar,
    TrendingUp,
    Building2,
    Users,
    IndianRupee,
    AlertCircle,
    RefreshCw,
    Search,
    Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Types
type Branch = { id: string; name: string; code: string };

interface BranchData {
    branchCode: string;
    branchName: string;
    noOfClients: number;
    osPrincipal: number;
    osInterest: number;
    osSavings: number;
    arrClients: number;
    arrearPri: number;
    arrearInt: number;
    arrearSavings: number;
}

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => `₹${formatReportAmount(amount)}`;

// Format number with commas
const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-IN').format(num);
};

export default function OSBranchwisePage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [reportDate, setReportDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [branchData, setBranchData] = useState<BranchData[]>([]);

    // Branch filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH) and AREA_MANAGER get a
    // picker; AREA_MANAGER's branch list is scoped to their assigned branches. No center
    // filter — this report's data is branch-level only (no center dimension).
    const storedUser = tokenStorage.getUser();
    const isAreaManager = storedUser?.role === 'AREA_MANAGER';
    const canFilterByBranch = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager;
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState('ALL');
    // Submitted (applied) snapshot — frozen until the next "Refresh Report" click, so exports
    // and displayed labels keep using the last-submitted filters even if the draft
    // reportDate/branchFilter above are edited afterward without clicking it again.
    const [submittedReportDate, setSubmittedReportDate] = useState(reportDate);
    const [submittedBranchFilter, setSubmittedBranchFilter] = useState(branchFilter);

    useEffect(() => {
        if (!canFilterByBranch) return;
        apiClient.get<Branch[]>('/branches').then((result) => {
            if (!result.success || !result.data) return;
            let list = result.data;
            if (isAreaManager) {
                const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                if (assignedBranchIds.length > 0) {
                    list = list.filter((b) => assignedBranchIds.includes(b.id));
                }
            }
            setBranches(list);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFilterByBranch, isAreaManager]);

    // `override` lets handleGenerateReport pass the just-read draft filters straight through on
    // the same click — reading submittedReportDate/submittedBranchFilter here would otherwise
    // use the pre-update (stale) state, since the setSubmitted* calls in handleGenerateReport
    // haven't re-rendered yet. Omitting it (there are no other callers today) falls back to the
    // last-submitted snapshot.
    const fetchOSData = async (override?: { reportDate: string; branchFilter: string }) => {
        setIsLoading(true);
        try {
            const effReportDate = override?.reportDate ?? submittedReportDate;
            const effBranchFilter = override?.branchFilter ?? submittedBranchFilter;
            const params = new URLSearchParams({
                reportDate: effReportDate,
            });
            if (canFilterByBranch && effBranchFilter !== 'ALL') params.set('branchId', effBranchFilter);

            const response = await fetch(`/api/reports/os-branchwise?${params}`);

            if (!response.ok) {
                throw new Error('Failed to fetch OS branchwise data');
            }

            const result = await response.json();
            setBranchData(result.data || []);
        } catch (error) {
            console.error('Error fetching OS branchwise data:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch OS branchwise data. Please try again.',
                variant: 'destructive',
            });
            setBranchData([]);
        } finally {
            setIsLoading(false);
        }
    };

    // Filter data based on search
    const filteredData = branchData.filter((branch) =>
        branch.branchName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        branch.branchCode.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Calculate totals
    const totals = filteredData.reduce(
        (acc, branch) => ({
            noOfClients: acc.noOfClients + branch.noOfClients,
            osPrincipal: acc.osPrincipal + branch.osPrincipal,
            osInterest: acc.osInterest + branch.osInterest,
            osSavings: acc.osSavings + (branch.osSavings || 0),
            arrClients: acc.arrClients + branch.arrClients,
            arrearPri: acc.arrearPri + branch.arrearPri,
            arrearInt: acc.arrearInt + branch.arrearInt,
            arrearSavings: acc.arrearSavings + (branch.arrearSavings || 0),
        }),
        {
            noOfClients: 0,
            osPrincipal: 0,
            osInterest: 0,
            osSavings: 0,
            arrClients: 0,
            arrearPri: 0,
            arrearInt: 0,
            arrearSavings: 0,
        }
    );

    const handleGenerateReport = () => {
        const snapshot = { reportDate, branchFilter };
        setSubmittedReportDate(reportDate);
        setSubmittedBranchFilter(branchFilter);
        fetchOSData(snapshot);
    };

    const handleExport = async (format: 'pdf' | 'excel') => {
        if (format === 'pdf') {
            if (filteredData.length === 0) {
                toast({
                    title: 'No Data',
                    description: 'No data available to export.',
                    variant: 'destructive',
                });
                return;
            }

            try {
                const { default: jsPDF } = await import('jspdf');
                const { drawOsBranchwiseReport } = await import('@/app/lib/reports/os-branchwise-pdf');
                const { headers, rows } = buildOSBranchwiseExportRows();

                const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
                const reportFont = await ensureReportFont(doc);
                await drawOsBranchwiseReport(
                    doc,
                    { headers, rows },
                    { subtitle: `As of ${toDisplayDate(new Date(submittedReportDate))}` },
                    reportFont
                );

                const dateStr = toDisplayDate(new Date(submittedReportDate)).replace(/\//g, '-');
                doc.save(`OS_Branchwise_${dateStr}.pdf`);

                toast({
                    title: 'Export Successful',
                    description: `Downloaded OS_Branchwise_${dateStr}.pdf`,
                });
            } catch (error) {
                console.error('PDF export error:', error);
                toast({
                    title: 'Export Failed',
                    description: 'Could not generate PDF file.',
                    variant: 'destructive',
                });
            }
            return;
        }

        // Excel export
        if (filteredData.length === 0) {
            toast({
                title: 'No Data',
                description: 'No data available to export.',
                variant: 'destructive',
            });
            return;
        }

        try {
            // Prepare data for Excel
            const excelData = filteredData.map(branch => ({
                'Branch Code': branch.branchCode,
                'Branch Name': branch.branchName,
                'No. of Clients': branch.noOfClients,
                'OS Principal': truncateReportAmount(branch.osPrincipal),
                'OS Interest': truncateReportAmount(branch.osInterest),
                ...(loanAdvanceEnabled ? { 'OS Loan Advance': truncateReportAmount(branch.osSavings || 0) } : {}),
                'Arr. Clients': branch.arrClients,
                'Arrear Principal': truncateReportAmount(branch.arrearPri),
                'Arrear Interest': truncateReportAmount(branch.arrearInt),
                ...(loanAdvanceEnabled ? { 'Arrear Loan Advance': truncateReportAmount(branch.arrearSavings || 0) } : {}),
            }));

            // Add grand total row
            excelData.push({
                'Branch Code': '',
                'Branch Name': 'GRAND TOTAL',
                'No. of Clients': totals.noOfClients,
                'OS Principal': truncateReportAmount(totals.osPrincipal),
                'OS Interest': truncateReportAmount(totals.osInterest),
                ...(loanAdvanceEnabled ? { 'OS Loan Advance': truncateReportAmount(totals.osSavings) } : {}),
                'Arr. Clients': totals.arrClients,
                'Arrear Principal': truncateReportAmount(totals.arrearPri),
                'Arrear Interest': truncateReportAmount(totals.arrearInt),
                ...(loanAdvanceEnabled ? { 'Arrear Loan Advance': truncateReportAmount(totals.arrearSavings) } : {}),
            });

            // Create worksheet
            const ws = buildReportSheet('Outstanding Branchwise Report', excelData);

            // Set column widths
            ws['!cols'] = [
                { wch: 12 },  // Branch Code
                { wch: 25 },  // Branch Name
                { wch: 15 },  // No. of Clients
                { wch: 18 },  // OS Principal
                { wch: 18 },  // OS Interest
                ...(loanAdvanceEnabled ? [{ wch: 18 }] : []),  // OS Loan Advance
                { wch: 15 },  // Arr. Clients
                { wch: 18 },  // Arrear Principal
                { wch: 18 },  // Arrear Interest
                ...(loanAdvanceEnabled ? [{ wch: 18 }] : []),  // Arrear Loan Advance
            ];
            applyExcelReportFont(ws);

            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'OS Branchwise');

            // Generate filename with date
            const dateStr = toDisplayDate(new Date(submittedReportDate)).replace(/\//g, '-');
            const fileName = `OS_Branchwise_${dateStr}.xlsx`;

            // Write file
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Successful',
                description: `Downloaded ${fileName}`,
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export Failed',
                description: 'Could not generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by the Excel export above (kept separate so
    // handleExport is left untouched).
    const buildOSBranchwiseExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch Code', 'Branch Name', 'No. of Clients', 'OS Principal', 'OS Interest',
            ...(loanAdvanceEnabled ? ['OS Loan Advance'] : []),
            'Arr. Clients', 'Arrear Principal', 'Arrear Interest',
            ...(loanAdvanceEnabled ? ['Arrear Loan Advance'] : []),
        ];
        const rows: (string | number)[][] = filteredData.map(branch => [
            branch.branchCode,
            branch.branchName,
            branch.noOfClients,
            truncateReportAmount(branch.osPrincipal),
            truncateReportAmount(branch.osInterest),
            ...(loanAdvanceEnabled ? [truncateReportAmount(branch.osSavings || 0)] : []),
            branch.arrClients,
            truncateReportAmount(branch.arrearPri),
            truncateReportAmount(branch.arrearInt),
            ...(loanAdvanceEnabled ? [truncateReportAmount(branch.arrearSavings || 0)] : []),
        ]);
        rows.push([
            '', 'GRAND TOTAL', totals.noOfClients, truncateReportAmount(totals.osPrincipal), truncateReportAmount(totals.osInterest),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.osSavings)] : []),
            totals.arrClients, truncateReportAmount(totals.arrearPri), truncateReportAmount(totals.arrearInt),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.arrearSavings)] : []),
        ]);
        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (filteredData.length === 0) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildOSBranchwiseExportRows();
        exportToCSV(`OS_Branchwise_${submittedReportDate}`, 'Outstanding Branchwise Report', headers, rows);
    };

    // Word-only presentation: same rows as Excel/CSV above, but the trailing GRAND TOTAL
    // row is split off for distinct styling, and OS/Arrear column clusters get a light
    // 2-row grouped header — genuine related fields.
    const buildOSBranchwiseWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Branch Code', span: 1 }, { label: 'Branch Name', span: 1 }, { label: 'No. of Clients', span: 1 },
                { label: 'OS', span: loanAdvanceEnabled ? 3 : 2 }, { label: 'ARREAR', span: loanAdvanceEnabled ? 4 : 3 },
            ],
            subHeaders: loanAdvanceEnabled
                ? ['Principal', 'Interest', 'Loan Advance', 'Clients', 'Principal', 'Interest', 'Loan Advance']
                : ['Principal', 'Interest', 'Clients', 'Principal', 'Interest'],
            columnAlignments: loanAdvanceEnabled
                ? ['center', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
                : ['center', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: loanAdvanceEnabled
                ? [8, 14, 8, 8, 8, 8, 8, 8, 8, 8]
                : [10, 17, 10, 10, 10, 10, 10, 10],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (filteredData.length === 0) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildOSBranchwiseExportRows();
        const { bodyRows, options } = buildOSBranchwiseWordOptions(rows);
        await exportToWord(`OS_Branchwise_${submittedReportDate}`, 'Outstanding Branchwise Report', headers, bodyRows, options);
    };

    return (
        <ProtectedRoute requiredPermission="OS_BRANCHWISE">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <BarChart3 className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Outstanding Branchwise Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Comprehensive branch-wise loan portfolio analysis
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Clients
                                        </p>
                                        <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {formatNumber(totals.noOfClients)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <Users className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            OS Principal
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            {formatCurrency(totals.osPrincipal)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                                            OS Interest
                                        </p>
                                        <p className="text-2xl font-bold text-amber-900 dark:text-amber-100 mt-2">
                                            {formatCurrency(totals.osInterest)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/50">
                                        <IndianRupee className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/20 dark:to-rose-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                            Arrear Clients
                                        </p>
                                        <p className="text-3xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            {formatNumber(totals.arrClients)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters and Actions Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Calendar className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>
                                            Select date and generate report
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ExportDropdown
                                        onExportPDF={() => handleExport('pdf')}
                                        onExportExcel={() => handleExport('excel')}
                                        onExportCSV={handleExportCSV}
                                        onExportWord={handleExportWord}
                                        reportSlug={getReportExportMode('os-branchwise') === 'REQUEST_QUEUE' ? 'os-branchwise' : undefined}
                                        canExport={canExportReport('os-branchwise')}
                                        exportParams={{
                                            fromDate: submittedReportDate,
                                            branchIds: submittedBranchFilter && submittedBranchFilter !== 'ALL' ? [submittedBranchFilter] : 'ALL',
                                        }}
                                        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => window.print()}
                                        className="border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300"
                                    >
                                        <Printer className="h-4 w-4 mr-2" />
                                        Print
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Date Picker */}
                                <div className="space-y-2">
                                    <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="reportDate"
                                        value={reportDate}
                                        onChange={(e) => setReportDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* Branch Filter (ADMIN / SUBADMIN / AREA_MANAGER only) */}
                                {canFilterByBranch && (
                                    <div className="space-y-2">
                                        <Label htmlFor="branchFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Branch
                                        </Label>
                                        <Select value={branchFilter} onValueChange={setBranchFilter} disabled={isLoading}>
                                            <SelectTrigger id="branchFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                                <SelectValue placeholder="All Branches" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ALL">All Branches</SelectItem>
                                                {branches.map((b) => (
                                                    <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {/* Search */}
                                <div className="space-y-2">
                                    <Label htmlFor="search" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Search Branch
                                    </Label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="search"
                                            type="text"
                                            placeholder="Search by name or code..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="h-11 pl-10 border-primary/30 dark:border-sidebar-accent"
                                        />
                                    </div>
                                </div>

                                {/* Generate Button */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Action
                                    </Label>
                                    <Button
                                        onClick={handleGenerateReport}
                                        disabled={isLoading}
                                        className="h-11 w-full bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Loading...
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                                Refresh Report
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Data Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <ReportHeader
                                title="Outstanding Branchwise Report"
                                subtitle={`As of ${toDisplayDate(new Date(submittedReportDate))}`}
                            />
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                        <Building2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Branch Portfolio Details</CardTitle>
                                        <CardDescription>
                                            Showing {filteredData.length} branch{filteredData.length !== 1 ? 'es' : ''}
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="bg-green-50 text-sidebar-accent border-primary/50 dark:bg-green-950/50 dark:text-green-300 dark:border-sidebar-accent">
                                    As of {toDisplayDate(new Date(submittedReportDate))}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-brand-green-tint dark:bg-sidebar-accent/50 hover:bg-brand-green-tint dark:hover:bg-sidebar-accent/50">
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">
                                                Branch Code
                                            </TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">
                                                Branch Name
                                            </TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">
                                                No. of Clients
                                            </TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">
                                                OS Principal
                                            </TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">
                                                OS Interest
                                            </TableHead>
                                            {loanAdvanceEnabled && (
                                                <TableHead className="text-right font-bold text-emerald-700 dark:text-emerald-400">
                                                    OS Loan Advance
                                                </TableHead>
                                            )}
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">
                                                Arr. Clients
                                            </TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">
                                                Arrear Principal
                                            </TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">
                                                Arrear Interest
                                            </TableHead>
                                            {loanAdvanceEnabled && (
                                                <TableHead className="text-right font-bold text-emerald-700 dark:text-emerald-400">
                                                    Arrear Loan Advance
                                                </TableHead>
                                            )}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={10} className="text-center py-12">
                                                    <PageLoader label="Loading branch data..." fullScreen={false} />
                                                </TableCell>
                                            </TableRow>
                                        ) : filteredData.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={10} className="text-center py-12">
                                                    <div className="flex flex-col items-center gap-3">
                                                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-green-tint dark:bg-sidebar-accent">
                                                            <Search className="h-8 w-8 text-slate-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-lg font-semibold text-foreground dark:text-slate-100">No branches found</p>
                                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                                Try adjusting your search criteria
                                                            </p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            <>
                                                {filteredData.map((branch, index) => (
                                                    <TableRow
                                                        key={branch.branchCode}
                                                        className={cn(
                                                            'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                            index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                        )}
                                                    >
                                                        <TableCell className="font-medium">
                                                            <Badge variant="outline" className="font-mono">
                                                                {branch.branchCode}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="font-semibold text-foreground dark:text-slate-100">
                                                            {branch.branchName}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {formatNumber(branch.noOfClients)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-green-700 dark:text-green-400">
                                                            {formatCurrency(branch.osPrincipal)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-amber-700 dark:text-amber-400">
                                                            {formatCurrency(branch.osInterest)}
                                                        </TableCell>
                                                        {loanAdvanceEnabled && (
                                                            <TableCell className="text-right font-medium text-emerald-700 dark:text-emerald-400">
                                                                {formatCurrency(branch.osSavings || 0)}
                                                            </TableCell>
                                                        )}
                                                        <TableCell className="text-right">
                                                            {branch.arrClients > 0 ? (
                                                                <Badge variant="destructive" className="font-medium">
                                                                    {formatNumber(branch.arrClients)}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-slate-500">0</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-red-700 dark:text-red-400">
                                                            {formatCurrency(branch.arrearPri)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-red-700 dark:text-red-400">
                                                            {formatCurrency(branch.arrearInt)}
                                                        </TableCell>
                                                        {loanAdvanceEnabled && (
                                                            <TableCell className="text-right font-medium text-red-700 dark:text-red-400">
                                                                {formatCurrency(branch.arrearSavings || 0)}
                                                            </TableCell>
                                                        )}
                                                    </TableRow>
                                                ))}

                                                {/* Grand Total Row */}
                                                <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/50 dark:to-brand-green-darker/50 font-bold border-t-2 border-primary/50 dark:border-sidebar-accent hover:from-brand-green-tint hover:to-primary dark:hover:from-brand-green-darker/50 dark:hover:to-brand-green-darker/50">
                                                    <TableCell colSpan={2} className="text-lg text-foreground dark:text-green-100">
                                                        Grand Total
                                                    </TableCell>
                                                    <TableCell className="text-right text-lg text-foreground dark:text-green-100">
                                                        {formatNumber(totals.noOfClients)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-lg text-green-800 dark:text-green-300">
                                                        {formatCurrency(totals.osPrincipal)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-lg text-amber-800 dark:text-amber-300">
                                                        {formatCurrency(totals.osInterest)}
                                                    </TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="text-right text-lg text-emerald-800 dark:text-emerald-300">
                                                            {formatCurrency(totals.osSavings)}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                        {formatNumber(totals.arrClients)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                        {formatCurrency(totals.arrearPri)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                        {formatCurrency(totals.arrearInt)}
                                                    </TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                            {formatCurrency(totals.arrearSavings)}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            </>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Footer Info */}
                    <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
                        <p>
                            Report generated on {toDisplayDateTime(new Date())}
                        </p>
                        <p>
                            Total Outstanding: <span className="font-semibold text-foreground dark:text-slate-100">
                                {formatCurrency(totals.osPrincipal + totals.osInterest)}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
