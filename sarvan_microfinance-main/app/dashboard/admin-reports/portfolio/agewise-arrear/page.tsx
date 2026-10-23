'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawAgewiseArrearReport } from '@/app/lib/reports/agewise-arrear-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import {
    AlertTriangle,
    Download,
    FileText,
    Printer,
    Building2,
    IndianRupee,
    RefreshCw,
    Search,
    Filter,
    Clock,
    TrendingDown,
    Phone,
    FileWarning,
    Users,
    Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { PageLoader } from '@/components/ui/page-loader';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import type { UserRole } from '@/app/types';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Types
interface ArrearRecord {
    branchName: string;
    centerName: string;
    clientId: string;
    clientName: string;
    phone: string;
    loanAccount: string;
    loanAmount: number;
    priBalance: number;
    totalDues: number;
    disbursalDate: string;
    days1to30: number;
    days31to60: number;
    days61to90: number;
    days91to180: number;
    above180: number;
    arrearPri: number;
    arrearInt: number;
    totalArrear: number;
    fdoName: string;
}

interface Center {
    id: string;
    name: string;
    code: string;
}

interface Branch {
    id: string;
    name: string;
    code: string;
}

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => `₹${formatReportAmount(amount)}`;

// Get arrear severity
const getArrearSeverity = (record: ArrearRecord): 'critical' | 'high' | 'medium' | 'low' => {
    if (record.above180 > 0) return 'critical';
    if (record.days91to180 > 0) return 'high';
    if (record.days61to90 > 0) return 'medium';
    return 'low';
};

export default function AgewiseArrearPage() {
    const { toast } = useToast();
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [reportDate, setReportDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [arrearData, setArrearData] = useState<ArrearRecord[]>([]);
    const [branches, setBranches] = useState<Branch[]>([{ id: 'all', name: 'All Branches', code: 'ALL' }]);
    const [isBranchFixed, setIsBranchFixed] = useState(false);
    const [centers, setCenters] = useState<Center[]>([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
    const itemsPerPage = 15;
    // Submitted (applied) snapshot — frozen until the next "Generate Report" click, so exports
    // and displayed labels keep using the last-submitted filters even if the draft
    // reportDate/selectedBranch/selectedCenter above are edited afterward without clicking it again.
    const [submittedReportDate, setSubmittedReportDate] = useState(reportDate);
    const [submittedBranch, setSubmittedBranch] = useState(selectedBranch);
    const [submittedCenter, setSubmittedCenter] = useState(selectedCenter);

    // Resolve branch scope on mount — BM is pinned to their own branch,
    // AM sees their assigned branches, everyone else (Admin/HO roles) sees all branches.
    useEffect(() => {
        const stored = tokenStorage.getUser();
        const role = stored?.role as UserRole | undefined;

        if (role === 'BRANCH_MANAGER') {
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id || stored?.branchId || '';
            if (branchId) {
                setBranches([{ id: branchId, name: activeBranch?.name || 'My Branch', code: activeBranch?.code || '' }]);
                setSelectedBranch(branchId);
            }
            setIsBranchFixed(true);
        } else if (role === 'AREA_MANAGER') {
            fetchAmBranches(stored?.id || '');
        } else {
            fetchAllBranches();
        }
    }, []);

    // Fetch centers whenever the selected branch changes
    useEffect(() => {
        fetchCenters(selectedBranch);
        setSelectedCenter('all');
    }, [selectedBranch]);

    const fetchAllBranches = async () => {
        try {
            const response = await fetch('/api/branches');
            const result = await response.json();
            const list: Branch[] = result.data ?? result ?? [];
            setBranches([{ id: 'all', name: 'All Branches', code: 'ALL' }, ...list]);
        } catch (error) {
            console.error('Error fetching branches:', error);
            setBranches([{ id: 'all', name: 'All Branches', code: 'ALL' }]);
        }
    };

    const fetchAmBranches = async (userId: string) => {
        try {
            const response = await fetch(`/api/area-manager-branches?userId=${userId}`);
            const result = await response.json();
            const list: Branch[] = (result.data ?? []).map((a: any) => a.branch).filter(Boolean);
            setBranches([{ id: 'all', name: 'All Branches', code: 'ALL' }, ...list]);
        } catch (error) {
            console.error('Error fetching AM branches:', error);
            setBranches([{ id: 'all', name: 'All Branches', code: 'ALL' }]);
        }
    };

    const fetchCenters = async (branchId: string) => {
        try {
            const params = branchId && branchId !== 'all' ? `?branchId=${branchId}` : '';
            const response = await fetch(`/api/centers${params}`);
            if (response.ok) {
                const result = await response.json();

                if (result.success && Array.isArray(result.data)) {
                    const centerList = result.data.map((c: any) => ({
                        id: c.id,
                        name: c.name,
                        code: c.code,
                    }));
                    setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }, ...centerList]);
                } else {
                    console.error('Unexpected API response structure:', result);
                    setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
                }
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
        }
    };

    // `override` lets handleGenerateReport pass the just-read draft filters straight through on
    // the same click — reading submittedReportDate/submittedBranch/submittedCenter here would
    // otherwise use the pre-update (stale) state, since the setSubmitted* calls in
    // handleGenerateReport haven't re-rendered yet. Omitting it (there are no other callers
    // today) falls back to the last-submitted snapshot.
    const fetchArrearData = async (override?: { reportDate: string; branchId: string; centerId: string }) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                reportDate: override?.reportDate ?? submittedReportDate,
                centerId: override?.centerId ?? submittedCenter,
                branchId: override?.branchId ?? submittedBranch,
            });

            const response = await fetch(`/api/reports/agewise-arrear?${params}`);

            if (!response.ok) {
                throw new Error('Failed to fetch arrear data');
            }

            const result = await response.json();
            setArrearData(result.data || []);
            setCurrentPage(1); // Reset to first page on new data
        } catch (error) {
            console.error('Error fetching arrear data:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch arrear data. Please try again.',
                variant: 'destructive',
            });
            setArrearData([]);
        } finally {
            setIsLoading(false);
        }
    };

    // Filter data
    const filteredData = arrearData.filter((record) => {
        const matchesSearch =
            record.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            record.loanAccount.toLowerCase().includes(searchTerm.toLowerCase()) ||
            record.phone.includes(searchTerm);

        return matchesSearch;
    });

    // Pagination
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage);

    // Distinct members — one client can have several loans in arrear.
    const memberCount = new Set(filteredData.map((r) => r.clientId)).size;

    // Calculate totals
    const totals = filteredData.reduce(
        (acc, record) => ({
            loanAmount: acc.loanAmount + record.loanAmount,
            priBalance: acc.priBalance + record.priBalance,
            days1to30: acc.days1to30 + record.days1to30,
            days31to60: acc.days31to60 + record.days31to60,
            days61to90: acc.days61to90 + record.days61to90,
            days91to180: acc.days91to180 + record.days91to180,
            above180: acc.above180 + record.above180,
            arrearPri: acc.arrearPri + record.arrearPri,
            arrearInt: acc.arrearInt + record.arrearInt,
            totalArrear: acc.totalArrear + record.totalArrear,
        }),
        {
            loanAmount: 0,
            priBalance: 0,
            days1to30: 0,
            days31to60: 0,
            days61to90: 0,
            days91to180: 0,
            above180: 0,
            arrearPri: 0,
            arrearInt: 0,
            totalArrear: 0,
        }
    );

    const criticalCount = filteredData.filter(r => r.above180 > 0).length;
    const highCount = filteredData.filter(r => r.days91to180 > 0 && r.above180 === 0).length;

    const handleGenerateReport = () => {
        const snapshot = { reportDate, branchId: selectedBranch, centerId: selectedCenter };
        setSubmittedReportDate(reportDate);
        setSubmittedBranch(selectedBranch);
        setSubmittedCenter(selectedCenter);
        fetchArrearData(snapshot);
    };

    // Shared field mapping for both export formats — mirrors the columns actually shown
    // in the table above (search-filtered, not paginated: this report already loads every
    // matching row up front, so filteredData IS "all data for the current filters").
    const buildArrearExportRows = (rows: ArrearRecord[]): { headers: string[]; data: (string | number)[][] } => {
        const headers = [
            'Branch', 'Center', 'Client Name', 'Phone', 'Loan A/C', 'Loan Amt', 'Pri Balance',
            'Total Dues', 'Disbursal', '1-30 Days', '31-60 Days', '61-90 Days', '91-180 Days',
            '>180 Days', 'Arrear Pri', 'Arrear Int', 'Total Arrear', 'FDO',
        ];
        const data = rows.map((r) => [
            r.branchName, r.centerName, r.clientName, r.phone, r.loanAccount, truncateReportAmount(r.loanAmount),
            truncateReportAmount(r.priBalance), truncateReportAmount(r.totalDues), r.disbursalDate, truncateReportAmount(r.days1to30), truncateReportAmount(r.days31to60), truncateReportAmount(r.days61to90),
            truncateReportAmount(r.days91to180), truncateReportAmount(r.above180), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.totalArrear), r.fdoName,
        ]);
        return { headers, data };
    };

    const handleExportExcel = () => {
        if (filteredData.length === 0) {
            toast({ title: 'No Data', description: 'No arrear data to export.', variant: 'destructive' });
            return;
        }
        try {
            const { headers, data } = buildArrearExportRows(filteredData);
            const rowObjects = data.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
            const ws = buildReportSheet(`AGEWISE ARREAR REPORT - As of ${submittedReportDate}`, rowObjects);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Agewise Arrear');

            const fileName = `Agewise_Arrear_${submittedReportDate}.xlsx`;
            XLSX.writeFile(wb, fileName);
            toast({ title: 'Export Successful', description: `Downloaded ${fileName}` });
        } catch (error) {
            console.error('Excel export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate Excel file.', variant: 'destructive' });
        }
    };

    const handleExportPDF = async () => {
        if (filteredData.length === 0) {
            toast({ title: 'No Data', description: 'No arrear data to export.', variant: 'destructive' });
            return;
        }
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawAgewiseArrearReport(doc, filteredData, {
                subtitle: `As of ${toDisplayDate(new Date(submittedReportDate))}`,
            }, reportFont);
            const fileName = `Agewise_Arrear_${submittedReportDate}.pdf`;
            doc.save(fileName);
            toast({ title: 'Export Successful', description: `Downloaded ${fileName}` });
        } catch (error) {
            console.error('PDF export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate PDF file.', variant: 'destructive' });
        }
    };

    return (
        <ProtectedRoute requiredPermission="AGEWISE_ARREAR">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-red-50/30 to-orange-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-orange-600 shadow-lg shadow-red-500/30">
                                <AlertTriangle className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Agewise Arrear Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Arrear analysis categorized by aging buckets for proactive collection management
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                        <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-orange-50/50 dark:from-red-950/20 dark:to-orange-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                            Member Count
                                        </p>
                                        <p className="text-3xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            {memberCount.toLocaleString('en-IN')}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Arrear Loans: {filteredData.length.toLocaleString('en-IN')}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <Users className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50 to-pink-50/50 dark:from-rose-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                                            Critical (&gt;180d)
                                        </p>
                                        <p className="text-3xl font-bold text-rose-900 dark:text-rose-100 mt-2">
                                            {criticalCount}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/50">
                                        <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-amber-50/50 dark:from-orange-950/20 dark:to-amber-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
                                            High (91-180d)
                                        </p>
                                        <p className="text-3xl font-bold text-orange-900 dark:text-orange-100 mt-2">
                                            {highCount}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/50">
                                        <Clock className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/20 dark:to-rose-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                            Arrear Principal
                                        </p>
                                        <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            {formatCurrency(totals.arrearPri)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <IndianRupee className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50 to-red-50/50 dark:from-rose-950/20 dark:to-red-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                                            Total Arrear
                                        </p>
                                        <p className="text-2xl font-bold text-rose-900 dark:text-rose-100 mt-2">
                                            {formatCurrency(totals.totalArrear)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/50">
                                        <TrendingDown className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-600 to-amber-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-red-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                                        <Filter className="h-5 w-5 text-red-600 dark:text-red-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>
                                            Filter arrears by center and date
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleExportPDF}
                                        className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                    >
                                        <FileText className="h-4 w-4 mr-2" />
                                        Export PDF
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleExportExcel}
                                        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                    >
                                        <Download className="h-4 w-4 mr-2" />
                                        Export Excel
                                    </Button>
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
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                                {/* Branch Filter */}
                                <div className="space-y-2">
                                    <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch
                                    </Label>
                                    {isBranchFixed ? (
                                        <Input
                                            value={branches[0]?.name ?? 'My Branch'}
                                            readOnly
                                            className="h-11 bg-brand-green-tint dark:bg-sidebar-accent border-primary/30 dark:border-sidebar-accent"
                                        />
                                    ) : (
                                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                                            <SelectTrigger id="branch" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                                <SelectValue placeholder="Select branch" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {branches.map((branch) => (
                                                    <SelectItem key={branch.id} value={branch.id}>
                                                        {branch.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>

                                {/* Center Filter */}
                                <div className="space-y-2">
                                    <Label htmlFor="center" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center Name
                                    </Label>
                                    <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                        <SelectTrigger id="center" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder="Select center" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {centers.map((center) => (
                                                <SelectItem key={center.id} value={center.id}>
                                                    {center.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

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

                                {/* Search */}
                                <div className="space-y-2">
                                    <Label htmlFor="search" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Search Client
                                    </Label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="search"
                                            type="text"
                                            placeholder="Name, Loan A/C, Phone..."
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
                                        className="h-11 w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg shadow-red-500/30"
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
                        <div className="h-1.5 bg-gradient-to-r from-rose-600 via-red-600 to-orange-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-rose-50/60 to-red-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <ReportHeader
                                title="Agewise Arrear Report"
                                subtitle={`As of ${toDisplayDate(new Date(submittedReportDate))}`}
                            />
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
                                        <Building2 className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Arrear Details by Age</CardTitle>
                                        <CardDescription>
                                            {totalPages > 0 ? `Page ${currentPage} of ${totalPages} • ` : ''}{filteredData.length} total arrears
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-700">
                                    As of {toDisplayDate(new Date(submittedReportDate))}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-brand-green-tint dark:bg-sidebar-accent/50 hover:bg-brand-green-tint dark:hover:bg-sidebar-accent/50">
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Branch</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Center</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Client Name</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Phone</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Loan A/C</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Loan Amt</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Pri Balance</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Total Dues</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Disbursal</TableHead>
                                            <TableHead className="text-right font-bold text-amber-900 dark:text-amber-100">1-30 Days</TableHead>
                                            <TableHead className="text-right font-bold text-orange-900 dark:text-orange-100">31-60 Days</TableHead>
                                            <TableHead className="text-right font-bold text-red-900 dark:text-red-100">61-90 Days</TableHead>
                                            <TableHead className="text-right font-bold text-rose-900 dark:text-rose-100">91-180 Days</TableHead>
                                            <TableHead className="text-right font-bold text-red-900 dark:text-red-100">&gt;180 Days</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Arrear Pri</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Arrear Int</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Total Arrear</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">FDO</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={18} className="text-center py-12">
                                                    <PageLoader label="Loading arrear data..." fullScreen={false} />
                                                </TableCell>
                                            </TableRow>
                                        ) : paginatedData.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={18} className="text-center py-12">
                                                    <div className="flex flex-col items-center gap-3">
                                                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-green-tint dark:bg-sidebar-accent">
                                                            <Search className="h-8 w-8 text-slate-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-lg font-semibold text-foreground dark:text-slate-100">No arrears found</p>
                                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                                Try adjusting your filters or search criteria
                                                            </p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            paginatedData.map((record, index) => {
                                                const severity = getArrearSeverity(record);
                                                return (
                                                    <TableRow
                                                        key={`${record.loanAccount}-${index}`}
                                                        className={cn(
                                                            'hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors',
                                                            index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50',
                                                            severity === 'critical' && 'border-l-4 border-l-red-600',
                                                            severity === 'high' && 'border-l-4 border-l-orange-500',
                                                            severity === 'medium' && 'border-l-4 border-l-amber-500'
                                                        )}
                                                    >
                                                        <TableCell className="font-medium text-sm">{record.branchName}</TableCell>
                                                        <TableCell className="text-sm">{record.centerName}</TableCell>
                                                        <TableCell className="font-semibold text-foreground dark:text-slate-100">
                                                            {record.clientName}
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs">
                                                            <div className="flex items-center gap-1">
                                                                <Phone className="h-3 w-3 text-slate-400" />
                                                                {record.phone}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs">{record.loanAccount}</TableCell>
                                                        <TableCell className="text-right font-medium text-sidebar-accent dark:text-primary">
                                                            {formatCurrency(record.loanAmount)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-green-700 dark:text-green-400">
                                                            {formatCurrency(record.priBalance)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Badge variant="secondary">{record.totalDues}</Badge>
                                                        </TableCell>
                                                        <TableCell className="text-sm">{record.disbursalDate}</TableCell>
                                                        <TableCell className="text-right">
                                                            {record.days1to30 > 0 ? (
                                                                <span className="text-amber-700 dark:text-amber-400 font-medium">
                                                                    {formatCurrency(record.days1to30)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {record.days31to60 > 0 ? (
                                                                <span className="text-orange-700 dark:text-orange-400 font-medium">
                                                                    {formatCurrency(record.days31to60)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {record.days61to90 > 0 ? (
                                                                <span className="text-red-700 dark:text-red-400 font-medium">
                                                                    {formatCurrency(record.days61to90)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {record.days91to180 > 0 ? (
                                                                <Badge variant="destructive" className="bg-rose-600">
                                                                    {formatCurrency(record.days91to180)}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {record.above180 > 0 ? (
                                                                <Badge variant="destructive" className="bg-red-700 animate-pulse">
                                                                    {formatCurrency(record.above180)}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-red-700 dark:text-red-400">
                                                            {formatCurrency(record.arrearPri)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium text-orange-700 dark:text-orange-400">
                                                            {formatCurrency(record.arrearInt)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-red-800 dark:text-red-300">
                                                            {formatCurrency(record.totalArrear)}
                                                        </TableCell>
                                                        <TableCell className="text-xs">{record.fdoName}</TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        )}

                                        {/* Grand Total Row */}
                                        {paginatedData.length > 0 && (
                                            <TableRow className="bg-gradient-to-r from-red-100 to-orange-100 dark:from-red-950/50 dark:to-orange-950/50 font-bold border-t-2 border-red-300 dark:border-red-700 hover:from-red-100 hover:to-orange-100 dark:hover:from-red-950/50 dark:hover:to-orange-950/50">
                                                <TableCell colSpan={5} className="text-lg text-red-900 dark:text-red-100">
                                                    Grand Total ({filteredData.length} arrears)
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.loanAmount)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-green-800 dark:text-green-300">
                                                    {formatCurrency(totals.priBalance)}
                                                </TableCell>
                                                <TableCell colSpan={2}></TableCell>
                                                <TableCell className="text-right text-lg text-amber-800 dark:text-amber-300">
                                                    {formatCurrency(totals.days1to30)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-orange-800 dark:text-orange-300">
                                                    {formatCurrency(totals.days31to60)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.days61to90)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-rose-800 dark:text-rose-300">
                                                    {formatCurrency(totals.days91to180)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.above180)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.arrearPri)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-orange-800 dark:text-orange-300">
                                                    {formatCurrency(totals.arrearInt)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.totalArrear)}
                                                </TableCell>
                                                <TableCell></TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-2 py-6 border-t border-primary/20 dark:border-sidebar-accent">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                    >
                                        Previous
                                    </Button>
                                    <div className="flex items-center gap-2">
                                        {[...Array(Math.min(totalPages, 5))].map((_, i) => {
                                            const pageNum = i + 1;
                                            return (
                                                <Button
                                                    key={pageNum}
                                                    variant={currentPage === pageNum ? "default" : "outline"}
                                                    size="sm"
                                                    onClick={() => setCurrentPage(pageNum)}
                                                    className={cn(
                                                        currentPage === pageNum && "bg-red-600 hover:bg-red-700"
                                                    )}
                                                >
                                                    {pageNum}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                    >
                                        Next
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Footer Info */}
                    <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
                        <p>
                            Report generated on {toDisplayDateTime(new Date())}
                        </p>
                        <p>
                            Critical Arrears (&gt;180 days): <span className="font-semibold text-red-700 dark:text-red-400">
                                {criticalCount} cases • {formatCurrency(totals.above180)}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
