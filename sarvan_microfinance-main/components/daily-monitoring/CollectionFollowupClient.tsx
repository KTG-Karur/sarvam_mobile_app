'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Search,
    RefreshCw,
    RotateCcw,
    Calendar,
    Phone,
    Users,
    ChevronLeft,
    ChevronRight,
    TrendingUp,
    AlertTriangle,
    ArrowUp,
    ArrowDown,
    Check,
    Briefcase,
    CreditCard
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { format, isValid } from 'date-fns';
import * as XLSX from 'xlsx';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { usePermission } from '@/app/hooks/usePermission';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { ExportMenuButton } from '@/components/daily-monitoring/ExportMenuButton';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { DateInput } from '@/components/ui/date-input';

const formatDate = (dateValue: string | null | undefined, formatString: string = 'dd/MM/yyyy') => {
    if (!dateValue || dateValue === 'N/A') return 'N/A';
    const date = new Date(dateValue);
    return isValid(date) ? format(date, formatString) : 'N/A';
};

interface CollectionFollowupData {
    id: string;
    branchName: string;
    centerName: string;
    loanAccountId: string;
    memberName: string;
    disbursalDate: string;
    loanAmount: number;
    opArr: number;
    dueAmount: number;
    collAmt: number;
    realizedCollAmt: number;
    pendingCollAmt: number;
    clsArr: number;
    compDue: number;
    collDue: number;
    totalDue: number;
    maturityDate: string;
    phone: string;
    nomineeName: string;
    nomineePhone: string;
    meetingDay: string;
    empName: string;
}

interface SortConfig {
    key: keyof CollectionFollowupData | '';
    direction: 'asc' | 'desc';
}

export function CollectionFollowupClient() {
    const { toast } = useToast();
    const [fromDate, setFromDate] = useState('');
    const [tillDate, setTillDate] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<CollectionFollowupData[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: '', direction: 'desc' });
    const itemsPerPage = 10;

    // Branch filter — ADMIN/AREA_MANAGER/Head-Office-based users (incl. custom RBAC roles
    // like "Zonal Head") must pick one branch (report is single-branch, no "all branches"
    // mode on the server); BRANCH_MANAGER is scoped server-side.
    const { isHeadOffice } = usePermission();
    // Read after mount — localStorage is empty during SSR, so reading it in render
    // made the server omit the Branch filter the client renders (hydration mismatch).
    const [storedUser, setStoredUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
    useEffect(() => {
        setStoredUser(tokenStorage.getUser());
    }, []);
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER' || isHeadOffice;
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Center filter — server action already scopes the list per role
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('all');
    const filteredCenters = selectedBranchId
        ? centers.filter((c) => c.branchId === selectedBranchId)
        : centers;

    useEffect(() => {
        if (!isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                let list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (storedUser?.role === 'AREA_MANAGER') {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminOrAM, storedUser]);

    useEffect(() => {
        getCentersForDropdown()
            .then(setCenters)
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load centers.', variant: 'destructive' });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date Range Required',
                description: 'Please select both start and end dates.',
                variant: 'destructive',
            });
            return;
        }
        if (isAdminOrAM && !selectedBranchId) {
            toast({
                title: 'Branch Required',
                description: 'Please select a branch to proceed.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const branchParam = isAdminOrAM ? `&branchId=${selectedBranchId}` : '';
            const centerParam = selectedCenterId !== 'all' ? `&centerId=${selectedCenterId}` : '';
            const response = await apiClient.get<CollectionFollowupData[]>(
                `/reports/daily-monitoring/collection-followup?fromDate=${fromDate}&tillDate=${tillDate}${branchParam}${centerParam}`
            );
            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
                toast({
                    title: 'Analysis Complete',
                    description: `Loaded ${response.data.length} followup records.`,
                });
            } else {
                toast({
                    title: 'Query Failed',
                    description: response.error || 'Failed to retrieve followup data.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Network Error',
                description: 'Failed to connect to the reporting engine.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setFromDate('');
        setTillDate('');
        setSelectedCenterId('all');
        setData([]);
        setShowReport(false);
        setSearchQuery('');
        setCurrentPage(1);
        setSortConfig({ key: '', direction: 'desc' });
    };

    const handleExportPdf = async () => {
        if (data.length === 0) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const reportFont = await ensureReportFont(doc);
            const headerY = await drawPdfReportHeader(doc, 'Collection Followup Report', { subtitle: `From ${fromDate} to ${tillDate}`, fontFamily: reportFont });
            const headers = ['Branch', 'Center', 'Loan ID', 'Member', 'Disp Date', 'Loan Amt', 'Op. Arr', 'Due Amt', 'Coll Amt', 'Coll Approved', 'Coll Pending', 'Cls Arr', 'Comp Due', 'Coll Due', 'Total Due', 'Mat Date', 'Phone', 'Nominee', 'Nominee Phone', 'Meeting', 'Emp Name'];
            const rows = sortedData.map((item) => [
                item.branchName, item.centerName, item.loanAccountId, item.memberName, formatDate(item.disbursalDate),
                item.loanAmount, item.opArr, item.dueAmount, item.collAmt, item.realizedCollAmt, item.pendingCollAmt, item.clsArr, item.compDue, item.collDue,
                item.totalDue, formatDate(item.maturityDate), item.phone, item.nomineeName, item.nomineePhone, item.meetingDay, item.empName,
            ]);
            autoTable(doc, {
                startY: headerY,
                head: [headers],
                body: rows,
                theme: 'grid',
                styles: { font: reportFont, fontSize: 6.5, cellPadding: 1.1, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
                headStyles: { font: reportFont, fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
            });
            doc.save(`Collection_Followup_Report_${fromDate}_to_${tillDate}.pdf`);
            toast({ title: 'Export Successful', description: 'The report has been downloaded for offline audit.' });
        } catch {
            toast({ title: 'Export Error', description: 'Failed to generate the PDF file.', variant: 'destructive' });
        }
    };

    const handleExport = () => {
        if (data.length === 0) return;

        try {
            const exportData = sortedData.map(item => ({
                'Branch Name': item.branchName,
                'Center Name': item.centerName,
                'Loan ID': item.loanAccountId,
                'Member Name': item.memberName,
                'Disbursal Date': formatDate(item.disbursalDate),
                'Loan Amount': item.loanAmount,
                'Opening Arrear': item.opArr,
                'Due Amount': item.dueAmount,
                'Collection Amount (Total)': item.collAmt,
                'Collection Approved': item.realizedCollAmt,
                'Collection Pending': item.pendingCollAmt,
                'Closing Arrear': item.clsArr,
                'Comp. Due': item.compDue,
                'Coll. Due': item.collDue,
                'Total Due': item.totalDue,
                'Maturity Date': formatDate(item.maturityDate),
                'Phone': item.phone,
                'Nominee Name': item.nomineeName,
                'Nominee Phone': item.nomineePhone,
                'Meeting Day': item.meetingDay,
                'Employee Name': item.empName
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            autoSizeColumns(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Collection Followup');
            const fileName = `Collection_Followup_Report_${fromDate}_to_${tillDate}.xlsx`;
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Successful',
                description: 'The report has been downloaded for offline audit.',
            });
        } catch (error) {
            toast({
                title: 'Export Error',
                description: 'Failed to generate the Excel file.',
                variant: 'destructive',
            });
        }
    };

    const handleCopy = (text: string) => {
        if (text === 'N/A') return;
        navigator.clipboard.writeText(text);
        toast({ title: 'Copied', description: `${text} copied to clipboard.` });
    };

    const requestSort = (key: keyof CollectionFollowupData) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
        setCurrentPage(1);
    };

    const filteredData = useMemo(() => {
        if (!data || !Array.isArray(data)) return [];
        return data.filter(item =>
            (item.memberName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.centerName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.loanAccountId?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.branchName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.empName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (item.nomineeName?.toLowerCase() || '').includes(searchQuery.toLowerCase())
        );
    }, [data, searchQuery]);

    const sortedData = useMemo(() => {
        const sortableItems = [...filteredData];
        if (sortConfig.key !== '') {
            sortableItems.sort((a, b) => {
                const aVal = a[sortConfig.key as keyof CollectionFollowupData];
                const bVal = b[sortConfig.key as keyof CollectionFollowupData];

                if (aVal < bVal) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aVal > bVal) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredData, sortConfig]);

    const metrics = useMemo(() => {
        if (!filteredData || !Array.isArray(filteredData)) {
            return { demand: 0, collection: 0, arrears: 0 };
        }
        const demand = filteredData.reduce((acc, r) => acc + (r.dueAmount || 0), 0);
        const collection = filteredData.reduce((acc, r) => acc + (r.collAmt || 0), 0);
        const arrears = filteredData.reduce((acc, r) => acc + (r.clsArr || 0), 0);
        return { demand, collection, arrears };
    }, [filteredData]);

    const totalPages = Math.ceil(sortedData.length / itemsPerPage);
    const paginatedData = sortedData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages > 0 ? totalPages : 1);
        }
    }, [currentPage, totalPages]);

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px] space-y-6">
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    <div className="mb-6 flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg">
                            <TrendingUp className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground dark:text-white">Collection Followup</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                Recovery performance and arrears movement by branch and center.
                            </p>
                        </div>
                    </div>

                    <Card className="border-primary/20 bg-white shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
                        <CardHeader className="border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-sidebar-accent/50">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-tint text-primary dark:bg-brand-green-darker/30 dark:text-primary">
                                    <Briefcase className="h-4 w-4" />
                                </div>
                                <CardTitle className="text-base font-semibold text-foreground dark:text-white">
                                    Report Filters
                                </CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-6 md:items-end">
                                {isAdminOrAM && (
                                    <div className="space-y-2">
                                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-300">Branch</Label>
                                        <Select value={selectedBranchId} onValueChange={(v) => { setSelectedBranchId(v); setSelectedCenterId('all'); }} disabled={isLoadingBranches}>
                                            <SelectTrigger className="h-10">
                                                <SelectValue placeholder="-- SELECT BRANCH --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {branches.map((b) => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        {b.code} - {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-300">Center</Label>
                                    <Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
                                        <SelectTrigger className="h-10">
                                            <SelectValue placeholder="All Centers" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Centers</SelectItem>
                                            {filteredCenters.map((c) => (
                                                <SelectItem key={c.id} value={c.id}>
                                                    {c.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-300">From Date</Label>
                                    <DateInput
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        max={tillDate || undefined}
                                        className="h-10"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-300">Till Date</Label>
                                    <DateInput
                                        value={tillDate}
                                        onChange={(e) => setTillDate(e.target.value)}
                                        min={fromDate || undefined}
                                        className="h-10"
                                    />
                                </div>
                                <div className="md:col-span-2 flex gap-3">
                                    <Button onClick={handleShow} disabled={isLoading} className="h-10 flex-1 bg-primary text-white hover:bg-primary">
                                        {isLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                        Generate
                                    </Button>
                                    <Button variant="outline" onClick={handleReset} className="h-10">
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                    <ExportMenuButton
                                        onExportExcel={handleExport}
                                        onExportPdf={handleExportPdf}
                                        disabled={isLoading || data.length === 0}
                                        className="h-10 bg-emerald-600 text-white hover:bg-emerald-700"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {showReport && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <SummaryMetric icon={CreditCard} label="Total Demand" value={`₹${new Intl.NumberFormat('en-IN').format(metrics.demand)}`} color="blue" trend="Reporting Period" />
                                <SummaryMetric icon={Check} label="Total Collection" value={`₹${new Intl.NumberFormat('en-IN').format(metrics.collection)}`} color="orange" trend="Processed" />
                                <SummaryMetric icon={AlertTriangle} label="Closing Arrears" value={`₹${new Intl.NumberFormat('en-IN').format(metrics.arrears)}`} color="red" trend="Outstanding" />
                            </div>

                            <Card className="overflow-hidden rounded-2xl border border-primary/20 bg-green-50/60 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                                <CardHeader className="pb-0">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div className="space-y-1">
                                            <CardTitle className="text-lg font-semibold text-foreground dark:text-white">Recovery Registry</CardTitle>
                                            <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                                Showing {sortedData.length} records
                                            </p>
                                        </div>
                                        <div className="relative w-full md:w-96">
                                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input
                                                placeholder="Search by borrower, center or loan..."
                                                value={searchQuery}
                                                onChange={(e) => {
                                                    setSearchQuery(e.target.value);
                                                    setCurrentPage(1);
                                                }}
                                                className="h-10 pl-9"
                                            />
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="max-h-[640px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                                        <Table className="min-w-[2000px] text-xs">
                                            <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-primary via-primary to-primary text-white">
                                                <TableRow className="hover:bg-primary/80">
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Branch" onClick={() => requestSort('branchName')} active={sortConfig.key === 'branchName'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Center" onClick={() => requestSort('centerName')} active={sortConfig.key === 'centerName'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Loan ID" onClick={() => requestSort('loanAccountId')} active={sortConfig.key === 'loanAccountId'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Member" onClick={() => requestSort('memberName')} active={sortConfig.key === 'memberName'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Disp Date" onClick={() => requestSort('disbursalDate')} active={sortConfig.key === 'disbursalDate'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Loan Amt" onClick={() => requestSort('loanAmount')} active={sortConfig.key === 'loanAmount'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Op. Arr" onClick={() => requestSort('opArr')} active={sortConfig.key === 'opArr'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Due Amt" onClick={() => requestSort('dueAmount')} active={sortConfig.key === 'dueAmount'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Coll Amt" onClick={() => requestSort('collAmt')} active={sortConfig.key === 'collAmt'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Cls Arr" onClick={() => requestSort('clsArr')} active={sortConfig.key === 'clsArr'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Comp Due" onClick={() => requestSort('compDue')} active={sortConfig.key === 'compDue'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Coll Due" onClick={() => requestSort('collDue')} active={sortConfig.key === 'collDue'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 text-right font-semibold text-white"><SortButton label="Total Due" onClick={() => requestSort('totalDue')} active={sortConfig.key === 'totalDue'} direction={sortConfig.direction} isRight /></TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Mat Date" onClick={() => requestSort('maturityDate')} active={sortConfig.key === 'maturityDate'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 text-center font-semibold text-white">Phone</TableHead>
                                                    <TableHead className="px-4 py-3 text-center font-semibold text-white">Nominee</TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Meeting" onClick={() => requestSort('meetingDay')} active={sortConfig.key === 'meetingDay'} direction={sortConfig.direction} /></TableHead>
                                                    <TableHead className="px-4 py-3 font-semibold text-white"><SortButton label="Emp Name" onClick={() => requestSort('empName')} active={sortConfig.key === 'empName'} direction={sortConfig.direction} /></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody className="bg-white dark:bg-green-950/30">
                                                {isLoading ? (
                                                    Array.from({ length: 5 }).map((_, idx) => (
                                                        <TableRow key={idx}>
                                                            {Array.from({ length: 18 }).map((__, tdIdx) => (
                                                                <TableCell key={tdIdx} className="px-4 py-3">
                                                                    <Skeleton className="h-4 w-full rounded-lg" />
                                                                </TableCell>
                                                            ))}
                                                        </TableRow>
                                                    ))
                                                ) : paginatedData.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={18} className="h-40 text-center text-sm text-sidebar-accent dark:text-slate-400">
                                                            No records found matching your filters.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    paginatedData.map((row) => (
                                                        <TableRow
                                                            key={row.id}
                                                            className={cn(
                                                                'bg-white odd:bg-green-50/70 transition-colors hover:bg-green-50/60 dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80',
                                                                row.clsArr > 0 && 'bg-rose-50/60 dark:bg-rose-900/20'
                                                            )}
                                                        >
                                                            <TableCell className="max-w-[120px] truncate px-4 py-3 font-medium text-foreground dark:text-slate-100">{row.branchName}</TableCell>
                                                            <TableCell className="max-w-[150px] truncate px-4 py-3 text-sidebar-accent dark:text-slate-200">{row.centerName}</TableCell>
                                                            <TableCell className="px-4 py-3">
                                                                <Badge variant="outline" className="text-[11px]">{row.loanAccountId}</Badge>
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-foreground dark:text-slate-100">{row.memberName}</TableCell>
                                                            <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-400">{formatDate(row.disbursalDate)}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right font-medium text-foreground dark:text-slate-100">₹{new Intl.NumberFormat('en-IN').format(row.loanAmount)}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">₹{new Intl.NumberFormat('en-IN').format(row.opArr)}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">₹{new Intl.NumberFormat('en-IN').format(row.dueAmount)}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">
                                                                <div>₹{new Intl.NumberFormat('en-IN').format(row.collAmt)}</div>
                                                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                                                    A: ₹{new Intl.NumberFormat('en-IN').format(row.realizedCollAmt)} | P: ₹{new Intl.NumberFormat('en-IN').format(row.pendingCollAmt)}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-right font-semibold text-foreground dark:text-slate-100">₹{new Intl.NumberFormat('en-IN').format(row.clsArr)}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.compDue}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.collDue}</TableCell>
                                                            <TableCell className="px-4 py-3 text-right text-sidebar-accent dark:text-slate-200">{row.totalDue}</TableCell>
                                                            <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">{formatDate(row.maturityDate)}</TableCell>
                                                            <TableCell className="px-4 py-3">
                                                                <button
                                                                    onClick={() => handleCopy(row.phone)}
                                                                    className="w-full rounded-md bg-brand-green-tint px-2 py-1 text-left text-xs font-medium hover:bg-brand-green-tint dark:bg-sidebar-accent dark:hover:bg-sidebar-accent"
                                                                >
                                                                    <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{row.phone}</span>
                                                                </button>
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3">
                                                                <div className="rounded-md bg-brand-green-tint px-2 py-1 text-left text-xs font-medium dark:bg-sidebar-accent">
                                                                    <div className="inline-flex items-center gap-1 text-foreground dark:text-slate-100">
                                                                        <Users className="h-3 w-3" />
                                                                        {row.nomineeName || 'N/A'}
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleCopy(row.nomineePhone)}
                                                                        className="mt-1 block text-[10px] text-sidebar-accent hover:text-foreground dark:text-slate-300 dark:hover:text-white"
                                                                    >
                                                                        {row.nomineePhone}
                                                                    </button>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">{row.meetingDay}</TableCell>
                                                            <TableCell className="max-w-[120px] truncate px-4 py-3 text-sidebar-accent dark:text-slate-200">{row.empName}</TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {sortedData.length > itemsPerPage && (
                                        <div className="flex items-center justify-between border-t border-primary/20 bg-white px-4 py-3 dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                                            <span className="text-sm text-sidebar-accent dark:text-slate-400">
                                                Showing <span className="font-medium">{((currentPage - 1) * itemsPerPage) + 1}</span> to{' '}
                                                <span className="font-medium">{Math.min(currentPage * itemsPerPage, sortedData.length)}</span> of{' '}
                                                <span className="font-medium">{sortedData.length}</span> entries
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                    disabled={currentPage === 1}
                                                    className="h-8 w-8"
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                    disabled={currentPage === totalPages}
                                                    className="h-8 w-8"
                                                >
                                                    <ChevronRight className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {!showReport && !isLoading && (
                        <Card className="border border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardContent className="p-12 text-center">
                                <Calendar className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500" />
                                <p className="mt-3 text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                    Select a date range and generate the followup report.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}

function SummaryMetric({ icon: Icon, label, value, color, trend }: { icon: any, label: string, value: string | number, color: 'blue' | 'orange' | 'red', trend: string }) {
    const colors = {
        blue: 'text-primary bg-green-50 dark:bg-green-950/20 dark:text-primary',
        orange: 'text-orange-600 bg-orange-50 dark:bg-orange-950/20 dark:text-orange-400',
        red: 'text-red-600 bg-red-50 dark:bg-red-950/20 dark:text-red-400'
    };

    return (
        <Card className="border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker">
            <CardContent className="p-5">
                <div className="flex items-center justify-between">
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-sidebar-accent dark:text-slate-400">{label}</p>
                        <h4 className="text-2xl font-semibold text-foreground dark:text-white">{value}</h4>
                        <span className={cn("inline-flex rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide", colors[color])}>
                            {trend}
                        </span>
                    </div>
                    <div className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg",
                        colors[color]
                    )}>
                        <Icon className="h-5 w-5" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function SortButton({ label, onClick, active, direction, isRight = false }: { label: string, onClick: () => void, active: boolean, direction: 'asc' | 'desc', isRight?: boolean }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "group/sort flex w-full items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-white/10",
                isRight && "justify-end"
            )}
        >
            <span className={cn(
                "text-[11px] font-semibold transition-colors shrink-0",
                active ? "text-white" : "text-white/90"
            )}>{label}</span>
            <div className="flex flex-col -space-y-1 shrink-0">
                <ArrowUp className={cn("w-2.5 h-2.5", active && direction === 'asc' ? "text-white" : "text-white/70")} />
                <ArrowDown className={cn("w-2.5 h-2.5", active && direction === 'desc' ? "text-white" : "text-white/70")} />
            </div>
        </button>
    );
}
