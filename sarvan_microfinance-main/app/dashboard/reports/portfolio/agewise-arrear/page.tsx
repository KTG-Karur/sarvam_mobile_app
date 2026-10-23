'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import {
    Calendar,
    Download,
    RefreshCw,
    Filter,
    AlertTriangle,
    DollarSign,
    FileSpreadsheet,
    RotateCcw,
    Clock,
    ChevronLeft,
    ChevronRight,
    TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Agewise Arrear entry interface
interface AgewiseArrearEntry {
    branch: string;
    centerName: string;
    clientName: string;
    phone: string;
    loanAccount: string;
    loanAmount: number;
    priBalance: number;
    totalDues: number;
    disbursalDate: string;
    age1to30: number;
    age31to60: number;
    age61to90: number;
    age91to180: number;
    ageAbove180: number;
    arrearPri: number;
}

// Initial (all-centers placeholder) centers list — real centers loaded from /api/centers
const INITIAL_CENTERS = [
    { id: 'all', name: '-- ALL CENTERS --' },
];

type BranchOption = { id: string; name: string; code: string };
type CenterWithBranch = { id: string; name: string; branchId?: string };

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

const todayYmd = () => new Date().toISOString().split('T')[0];

export default function AgewiseArrearPage() {
    const { toast } = useToast();
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centerName, setCenterName] = useState('all');
    const [reportDate, setReportDate] = useState<string>(todayYmd());
    const [isLoading, setIsLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [data, setData] = useState<AgewiseArrearEntry[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterWithBranch[]>(INITIAL_CENTERS);
    const itemsPerPage = 15;

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : [INITIAL_CENTERS[0], ...centers.filter((c) => c.branchId === selectedBranch)];

    // Fetch real branches + centers lists on mount
    useEffect(() => {
        fetch('/api/centers')
            .then((r) => r.json())
            .then((json) => {
                const list = (json.data || json || []).map((c: any) => ({
                    id: c.id,
                    name: `${c.code} - ${c.name}`,
                    branchId: c.branchId,
                }));
                setCenters([INITIAL_CENTERS[0], ...list]);
            })
            .catch((err) => console.error('Failed to fetch centers:', err));

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // Calculate pagination
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = data.slice(startIndex, endIndex);

    // Calculate totals
    const totalClients = data.length;
    const totalLoanAmount = data.reduce((sum, e) => sum + e.loanAmount, 0);
    const totalPriBalance = data.reduce((sum, e) => sum + e.priBalance, 0);
    const totalAge1to30 = data.reduce((sum, e) => sum + e.age1to30, 0);
    const totalAge31to60 = data.reduce((sum, e) => sum + e.age31to60, 0);
    const totalAge61to90 = data.reduce((sum, e) => sum + e.age61to90, 0);
    const totalAge91to180 = data.reduce((sum, e) => sum + e.age91to180, 0);
    const totalAgeAbove180 = data.reduce((sum, e) => sum + e.ageAbove180, 0);
    const totalArrearPri = data.reduce((sum, e) => sum + e.arrearPri, 0);

    const handleShow = async () => {
        if (!reportDate) {
            toast({ title: 'Report date is required', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ reportDate });
            if (centerName && centerName !== 'all') params.set('centerId', centerName);
            if (selectedBranch && selectedBranch !== 'all') params.set('branchId', selectedBranch);

            const res = await fetch(`/api/reports/agewise-arrear?${params.toString()}`);
            const json = await res.json();
            if (!res.ok || json.error) {
                throw new Error(json.error || 'Failed to fetch agewise arrear data');
            }

            const rows: AgewiseArrearEntry[] = (json.data || []).map((r: any) => ({
                branch: r.branchName,
                centerName: r.centerName,
                clientName: r.clientName,
                phone: r.phone,
                loanAccount: r.loanAccount,
                loanAmount: r.loanAmount,
                priBalance: r.priBalance,
                totalDues: r.totalDues,
                disbursalDate: r.disbursalDate,
                age1to30: r.days1to30,
                age31to60: r.days31to60,
                age61to90: r.days61to90,
                age91to180: r.days91to180,
                ageAbove180: r.above180,
                arrearPri: r.arrearPri,
            }));
            setData(rows);
            setCurrentPage(1);
            setHasSearched(true);
        } catch (e: any) {
            toast({ title: 'Failed to load report', description: e.message, variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setCenterName('all');
        setReportDate(todayYmd());
        setData([]);
        setHasSearched(false);
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({ title: 'Nothing to export', description: 'Run the report first.' });
            return;
        }
        console.log('Exporting Agewise Arrear data...');
    };

    return (
        <ProtectedRoute requiredPermission="AGEWISE_ARREAR">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Background Glow Effects */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-red-500/10 blur-3xl" />
                    </div>

                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-600 to-red-600 shadow-lg shadow-orange-500/30">
                                <Clock className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Arrear Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Agewise arrear analysis with client-level arrear breakdown by aging buckets
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-red-50/50 dark:from-orange-950/20 dark:to-red-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
                                            Total Clients
                                        </p>
                                        <p className="text-3xl font-bold text-orange-900 dark:text-orange-100 mt-2">
                                            {totalClients}
                                        </p>
                                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                            With arrears
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/50">
                                        <AlertTriangle className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Loan Amt
                                        </p>
                                        <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(totalLoanAmount)}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Disbursed
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <DollarSign className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Pri Balance
                                        </p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            ₹ {formatCurrency(totalPriBalance)}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Outstanding
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingDown className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/20 dark:to-rose-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                            Total Arrear
                                        </p>
                                        <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            ₹ {formatCurrency(totalArrearPri)}
                                        </p>
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            Overdue
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-orange-600 via-red-600 to-rose-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-orange-50/60 to-red-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                                    <Filter className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Report Filters</CardTitle>
                                    <CardDescription>
                                        Select center and report date to view agewise arrear report
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                                {/* Branch */}
                                <div className="space-y-2">
                                    <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch
                                    </Label>
                                    <Select
                                        value={selectedBranch}
                                        onValueChange={(v) => { setSelectedBranch(v); setCenterName('all'); }}
                                    >
                                        <SelectTrigger id="branchName" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder="-- ALL BRANCHES --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    {b.code} - {b.name}
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
                                    <Select value={centerName} onValueChange={setCenterName}>
                                        <SelectTrigger id="centerName" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder="Select center" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredCenters.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>
                                                    {c.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Report Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="reportDate"
                                            value={reportDate}
                                            onChange={(e) => setReportDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="space-y-2 lg:col-span-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Actions
                                    </Label>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={handleShow}
                                            disabled={isLoading}
                                            className="h-11 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white shadow-lg shadow-orange-500/30"
                                        >
                                            {isLoading ? (
                                                <>
                                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                    Loading...
                                                </>
                                            ) : (
                                                <>
                                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                                    Show
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            onClick={handleReset}
                                            variant="outline"
                                            className="h-11 border-primary/30 dark:border-sidebar-accent"
                                        >
                                            <RotateCcw className="h-4 w-4 mr-2" />
                                            Reset
                                        </Button>
                                        <Button
                                            onClick={handleExport}
                                            variant="outline"
                                            className="h-11 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                        >
                                            <Download className="h-4 w-4 mr-2" />
                                            Export
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Agewise Arrear Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-orange-600 via-red-600 to-rose-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-orange-50/60 to-red-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                                        <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Agewise Arrear Report</CardTitle>
                                        <CardDescription>
                                            Client-wise arrear breakdown by aging buckets
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-sm px-3 py-1 border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300">
                                    {data.length} Clients
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-700 dark:to-red-700 hover:from-orange-600 hover:to-red-600">
                                            <TableHead className="font-bold text-white text-xs">Branch</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Client Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Phone</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Loan Account</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Loan Amount</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Pri Balance</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Total Dues</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Disbursal Date</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">1 to 30</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">31 to 60</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">61 to 90</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">91 to 180</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Above 180</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Arrear Pri</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentData.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={14} className="text-center py-10 text-sm text-slate-500 dark:text-slate-400">
                                                    {isLoading
                                                        ? 'Loading...'
                                                        : hasSearched
                                                            ? 'No arrears found for the selected filters.'
                                                            : 'Select a report date and click Show to load the report.'}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {currentData.map((entry, index) => (
                                            <TableRow
                                                key={index}
                                                className={cn(
                                                    'hover:bg-orange-50/50 dark:hover:bg-orange-950/20 transition-colors border-l-4 border-orange-500',
                                                    index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                )}
                                            >
                                                <TableCell className="font-semibold text-xs text-sidebar-accent dark:text-primary">
                                                    {entry.branch}
                                                </TableCell>
                                                <TableCell className="font-medium text-xs text-foreground dark:text-slate-100">
                                                    {entry.centerName}
                                                </TableCell>
                                                <TableCell className="font-semibold text-xs text-foreground dark:text-slate-100">
                                                    {entry.clientName}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.phone}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.loanAccount}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold text-xs text-primary dark:text-primary">
                                                    {formatCurrency(entry.loanAmount)}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-xs text-purple-700 dark:text-purple-400">
                                                    {formatCurrency(entry.priBalance)}
                                                </TableCell>
                                                <TableCell className="text-right text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.totalDues}
                                                </TableCell>
                                                <TableCell className="text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.disbursalDate}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.age1to30 > 0 ? (
                                                        <span className="font-bold text-yellow-700 dark:text-yellow-400">
                                                            {formatCurrency(entry.age1to30)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.age31to60 > 0 ? (
                                                        <span className="font-bold text-orange-700 dark:text-orange-400">
                                                            {formatCurrency(entry.age31to60)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.age61to90 > 0 ? (
                                                        <span className="font-bold text-red-700 dark:text-red-400">
                                                            {formatCurrency(entry.age61to90)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.age91to180 > 0 ? (
                                                        <span className="font-bold text-rose-700 dark:text-rose-400">
                                                            {formatCurrency(entry.age91to180)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.ageAbove180 > 0 ? (
                                                        <span className="font-bold text-red-900 dark:text-red-300">
                                                            {formatCurrency(entry.ageAbove180)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-xs text-red-700 dark:text-red-400">
                                                    {formatCurrency(entry.arrearPri)}
                                                </TableCell>
                                            </TableRow>
                                        ))}

                                        {/* Grand Total Row - Only show on last page */}
                                        {currentPage === totalPages && (
                                            <TableRow className="bg-gradient-to-r from-orange-100 to-red-100 dark:from-orange-950/50 dark:to-red-950/50 font-bold border-t-2 border-orange-300 dark:border-orange-700">
                                                <TableCell className="text-lg text-orange-900 dark:text-orange-100" colSpan={5}>
                                                    Grand Total
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalLoanAmount)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalPriBalance)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs" colSpan={2}>
                                                    {data.reduce((sum, e) => sum + e.totalDues, 0)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalAge1to30)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalAge31to60)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalAge61to90)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalAge91to180)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalAgeAbove180)}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-800 dark:text-orange-300 text-xs">
                                                    {formatCurrency(totalArrearPri)}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                                    <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} clients
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                            Previous
                                        </Button>
                                        <div className="flex items-center gap-1">
                                            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(page => (
                                                <Button
                                                    key={page}
                                                    variant={currentPage === page ? "default" : "outline"}
                                                    size="sm"
                                                    onClick={() => setCurrentPage(page)}
                                                    className={cn(
                                                        "w-8 h-8 p-0",
                                                        currentPage === page && "bg-orange-600 hover:bg-orange-700"
                                                    )}
                                                >
                                                    {page}
                                                </Button>
                                            ))}
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                            disabled={currentPage === totalPages}
                                        >
                                            Next
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
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
                            Report Date: <span className="font-semibold text-orange-700 dark:text-orange-400">
                                {toDisplayDate(new Date(reportDate))}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
