'use client';

import { useState, useEffect } from 'react';
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
    Users,
    MapPin,
    DollarSign,
    FileSpreadsheet,
    RotateCcw,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    AlertCircle,
    User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// OS Clientwise entry interface
interface OSClientwiseEntry {
    branchName: string;
    centerName: string;
    clientName: string;
    disbursedDate: string;
    loanAmount: number;
    dueStartDate: string;
    tenure: number;
    loanAc: string;
    osPrincipal: number;
    osInterest: number;
    arrearPri: number;
    arrearInt: number;
    funder: string;
    mobileNo: string;
    goldDetails?: { karatType: string; gramCount: number; goldTakenValue: number } | null;
}

// Mock OS Clientwise data based on the legacy screen
const MOCK_OS_CLIENTWISE_DATA: OSClientwiseEntry[] = [
    {
        branchName: '001 - GUDALUR',
        centerName: '001 - KOZHINJILAM',
        clientName: '1-1 - GLORY',
        disbursedDate: '03 Jul 2025',
        loanAmount: 50000,
        dueStartDate: '21 Jul 2025',
        tenure: 24,
        loanAc: 'K3G011/6',
        osPrincipal: 37400,
        osInterest: 12250,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '9136552083',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '004 - CHEMBALA-6',
        clientName: '1-4 - SATYARAJ',
        disbursedDate: '25 Apr 2025',
        loanAmount: 40000,
        dueStartDate: '19 May 2025',
        tenure: 24,
        loanAc: 'K3G01762/3',
        osPrincipal: 25440,
        osInterest: 8710,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '9943858585',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '005 - KOZHINJILAM-3',
        clientName: '1-5 - KAVITHA',
        disbursedDate: '17 Oct 2025',
        loanAmount: 50000,
        dueStartDate: '03 Nov 2025',
        tenure: 24,
        loanAc: 'K3G01767/3',
        osPrincipal: 45800,
        osInterest: 15400,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '8015308565',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '005 - KOZHINJILAM-3',
        clientName: '2-1 - SUGANTHALEVI',
        disbursedDate: '24 Mar 2025',
        loanAmount: 50000,
        dueStartDate: '14 Apr 2025',
        tenure: 24,
        loanAc: 'K3G01122/5',
        osPrincipal: 35000,
        osInterest: 9250,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '7598731045',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '021 - THANIKATTAI-2',
        clientName: '1-4 - JAYASHREE',
        disbursedDate: '17 Oct 2025',
        loanAmount: 50000,
        dueStartDate: '03 Nov 2025',
        tenure: 24,
        loanAc: 'K3G01124/3',
        osPrincipal: 45800,
        osInterest: 15400,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '9787741191',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '017 - KARIMAVAI-1',
        clientName: '1-1 - SUGANYA',
        disbursedDate: '02 May 2025',
        loanAmount: 50000,
        dueStartDate: '21 May 2025',
        tenure: 24,
        loanAc: 'K3G01125/3',
        osPrincipal: 33200,
        osInterest: 10750,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '9994869665',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '017 - KARIMAVAI-1',
        clientName: '1-2 - SREELATA P',
        disbursedDate: '02 May 2025',
        loanAmount: 50000,
        dueStartDate: '21 May 2025',
        tenure: 24,
        loanAc: 'K3G01127/3',
        osPrincipal: 33200,
        osInterest: 10750,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '9944120553',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '017 - KARIMAVAI-1',
        clientName: '1-4 - ASHIFA S',
        disbursedDate: '02 May 2025',
        loanAmount: 50000,
        dueStartDate: '21 May 2025',
        tenure: 24,
        loanAc: 'K3G01128/3',
        osPrincipal: 33200,
        osInterest: 10750,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '9345025492',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '017 - KARIMAVAI-1',
        clientName: '1-5 - SULAJKA',
        disbursedDate: '02 May 2025',
        loanAmount: 50000,
        dueStartDate: '21 May 2025',
        tenure: 24,
        loanAc: 'K3G01129/3',
        osPrincipal: 33200,
        osInterest: 10750,
        arrearPri: 0,
        arrearInt: 0,
        funder: 'OWN FUND',
        mobileNo: '8015597938',
    },
    {
        branchName: '001 - GUDALUR',
        centerName: '007 - CHEMBALA',
        clientName: '2-1 - PREMA BANU',
        disbursedDate: '03 Feb 2024',
        loanAmount: 40000,
        dueStartDate: '12 Feb 2024',
        tenure: 36,
        loanAc: 'K3G01154/3',
        osPrincipal: 14240,
        osInterest: 2360,
        arrearPri: 14240,
        arrearInt: 2360,
        funder: 'OWN FUND',
        mobileNo: '7639807006',
    },
];

// Funders list
const FUNDERS = [
    { id: 'all', name: '-- ALL FUNDERS --' },
    { id: 'own', name: 'OWN FUND' },
    { id: 'nabard', name: 'NABARD' },
    { id: 'sidbi', name: 'SIDBI' },
];

// Initial (all-centers placeholder) centers list — real centers loaded from /api/centers
const INITIAL_CENTERS = [
    { id: 'all', name: '-- ALL CENTERS --' },
];

type BranchOption = { id: string; name: string; code: string };
type CenterWithBranch = { id: string; name: string; branchId?: string };

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

export default function OSClientwisePage() {
    const [funder, setFunder] = useState('all');
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centerName, setCenterName] = useState('all');
    const [reportDate, setReportDate] = useState<string>('2025-12-28');
    const [isLoading, setIsLoading] = useState(false);
    const [data, setData] = useState<OSClientwiseEntry[]>(MOCK_OS_CLIENTWISE_DATA);
    const [currentPage, setCurrentPage] = useState(1);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterWithBranch[]>(INITIAL_CENTERS);
    const itemsPerPage = 10;

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : [INITIAL_CENTERS[0], ...centers.filter((c) => c.branchId === selectedBranch)];

    // Fetch real branches + centers lists on load (replaces the previous hardcoded mock list)
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
    const totalOSPrincipal = data.reduce((sum, e) => sum + e.osPrincipal, 0);
    const totalOSInterest = data.reduce((sum, e) => sum + e.osInterest, 0);
    const totalArrearPri = data.reduce((sum, e) => sum + e.arrearPri, 0);
    const totalArrearInt = data.reduce((sum, e) => sum + e.arrearInt, 0);

    const handleShow = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ reportDate, page: '1', pageSize: '1000' });
            if (centerName && centerName !== 'all') params.set('centerId', centerName);
            if (funder && funder !== 'all') params.set('funderId', funder);
            if (selectedBranch && selectedBranch !== 'all') params.set('branchId', selectedBranch);
            const res = await fetch(`/api/reports/os-clientwise?${params.toString()}`);
            const json = await res.json();
            const rows = (json.data || []).map((r: any) => ({
                branchName: r.branchName,
                centerName: r.centerName,
                clientName: r.clientName,
                disbursedDate: r.disbursalDate,
                loanAmount: r.loanAmount,
                dueStartDate: r.dueStartDate,
                tenure: r.tenure,
                loanAc: r.loanAc,
                osPrincipal: r.osPrincipal,
                osInterest: r.osInterest,
                arrearPri: r.arrearPri,
                arrearInt: r.arrearInt,
                funder: r.funder,
                mobileNo: r.mobileNo,
                goldDetails: r.goldDetails ?? null,
            }));
            setData(rows);
            setCurrentPage(1);
        } catch (e) {
            console.error('Failed to load OS Clientwise data', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setFunder('all');
        setSelectedBranch('all');
        setCenterName('all');
        setReportDate('2025-12-28');
        setData(MOCK_OS_CLIENTWISE_DATA);
        setCurrentPage(1);
    };

    const handleExport = () => {
        // Simulate export functionality
        console.log('Exporting OS Clientwise data...');
    };

    return (
        <ProtectedRoute requiredPermission="OS_CLIENTWISE">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Background Glow Effects */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <Users className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Loan OS Client
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Client-wise outstanding principal, interest, and arrears with loan details
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
                                            {totalClients}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Active loans
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <User className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Total Loan Amt
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(totalLoanAmount)}
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            Disbursed
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Total OS
                                        </p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            ₹ {formatCurrency(totalOSPrincipal + totalOSInterest)}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Outstanding
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
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
                                            ₹ {formatCurrency(totalArrearPri + totalArrearInt)}
                                        </p>
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            Overdue
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Report Filters</CardTitle>
                                    <CardDescription>
                                        Select funder, center, and report date to view OS clientwise report
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
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
                                            {branches.map((branch) => (
                                                <SelectItem key={branch.id} value={branch.id}>
                                                    {branch.code} - {branch.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Funder Name */}
                                <div className="space-y-2">
                                    <Label htmlFor="funder" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Funder Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={funder} onValueChange={setFunder}>
                                        <SelectTrigger id="funder" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <SelectValue placeholder="Select funder" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FUNDERS.map((f) => (
                                                <SelectItem key={f.id} value={f.id}>
                                                    {f.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Center Name */}
                                <div className="space-y-2">
                                    <Label htmlFor="centerName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center Name <span className="text-red-500">*</span>
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
                                            className="h-11 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
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

                    {/* OS Clientwise Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Users className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Outstanding Clientwise Report</CardTitle>
                                        <CardDescription>
                                            Client-wise outstanding and loan details
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-sm px-3 py-1">
                                    {data.length} Clients
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-primary to-primary dark:from-sidebar-accent dark:to-primary hover:from-primary hover:to-primary">
                                            <TableHead className="font-bold text-white text-xs">Branch Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Client Name</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Disbursed Date</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Loan Amount</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Due Start Date</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Tenure</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Loan A/c</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">OS Principal</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">OS Interest</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Arrear Pri</TableHead>
                                            <TableHead className="text-right font-bold text-white text-xs">Arrear Int</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Funder</TableHead>
                                            <TableHead className="font-bold text-white text-xs">Mobile #</TableHead>
                                            <TableHead className="font-bold text-white text-xs text-center">Gold Details</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentData.map((entry, index) => (
                                            <TableRow
                                                key={index}
                                                className={cn(
                                                    'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                    index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50',
                                                    (entry.arrearPri > 0 || entry.arrearInt > 0) && 'border-l-4 border-red-500'
                                                )}
                                            >
                                                <TableCell className="font-semibold text-xs text-sidebar-accent dark:text-primary">
                                                    {entry.branchName}
                                                </TableCell>
                                                <TableCell className="font-medium text-xs text-foreground dark:text-slate-100">
                                                    {entry.centerName}
                                                </TableCell>
                                                <TableCell className="font-semibold text-xs text-foreground dark:text-slate-100">
                                                    {entry.clientName}
                                                </TableCell>
                                                <TableCell className="text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.disbursedDate}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold text-xs text-primary dark:text-primary">
                                                    {formatCurrency(entry.loanAmount)}
                                                </TableCell>
                                                <TableCell className="text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.dueStartDate}
                                                </TableCell>
                                                <TableCell className="text-right text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.tenure}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.loanAc}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-xs text-green-700 dark:text-green-400">
                                                    {formatCurrency(entry.osPrincipal)}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-xs text-purple-700 dark:text-purple-400">
                                                    {formatCurrency(entry.osInterest)}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.arrearPri > 0 ? (
                                                        <span className="font-bold text-red-700 dark:text-red-400">
                                                            {formatCurrency(entry.arrearPri)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs">
                                                    {entry.arrearInt > 0 ? (
                                                        <span className="font-bold text-red-700 dark:text-red-400">
                                                            {formatCurrency(entry.arrearInt)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">0</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/30">
                                                        {entry.funder}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">
                                                    {entry.mobileNo}
                                                </TableCell>
                                                <TableCell className="text-xs text-center whitespace-nowrap">
                                                    {entry.goldDetails ? (
                                                        <div className="space-y-0.5">
                                                            <div className="font-semibold text-yellow-700 dark:text-yellow-400">{entry.goldDetails.karatType}</div>
                                                            <div className="text-sidebar-accent dark:text-slate-400">{entry.goldDetails.gramCount.toFixed(3)}g</div>
                                                            <div className="text-sidebar-accent dark:text-slate-400">₹{formatCurrency(entry.goldDetails.goldTakenValue)}</div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-sidebar-accent">—</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
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
                                                        currentPage === page && "bg-primary hover:bg-primary"
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
                            Report Date: <span className="font-semibold text-sidebar-accent dark:text-primary">
                                {toDisplayDate(new Date(reportDate))}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
