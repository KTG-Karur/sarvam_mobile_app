'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawClientwiseDcbReport } from '@/app/lib/reports/clientwise-dcb-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
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
    BookOpen,
    Download,
    FileText,
    Printer,
    Building2,
    IndianRupee,
    RefreshCw,
    Search,
    Filter,
    CheckCircle2,
    Clock,
    TrendingUp,
    AlertTriangle,
    Phone,
    Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Types
interface DCBRecord {
    branchId: string;
    centerId: string;
    branchName: string;
    centerName: string;
    fdoName: string;
    accountNo: string;
    clientName: string;
    phone: string;
    loanAc: string;
    meetingDate: string;
    openingDue: number;
    currentDemand: number;
    currentCollection: number;
    currentArrear: number;
    osArrearCall: number;
    advance: number;
    preclosure: number;
    totalCall: number;
    currentArrearAmount: number;
    closingArrear: number;
}

interface Center {
    id: string;
    name: string;
    code: string;
}

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => `₹${formatReportAmount(amount)}`;

export default function ClientwiseDCBPage() {
    const { toast } = useToast();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [fromDate, setFromDate] = useState<string>(
        new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );
    const [toDate, setToDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) snapshot — frozen until the next "Refresh DCB" click, so exports
    // and displayed labels keep using the last-submitted filters even if the draft
    // fromDate/toDate/selectedCenter above are edited afterward without clicking it again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);
    const [submittedCenter, setSubmittedCenter] = useState(selectedCenter);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [dcbData, setDcbData] = useState<DCBRecord[]>([]);
    const [centers, setCenters] = useState<Center[]>([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
    const itemsPerPage = 10;

    // Fetch centers on mount
    useEffect(() => {
        fetchCenters();
    }, []);

    const fetchCenters = async () => {
        try {
            const response = await fetch('/api/centers');
            if (response.ok) {
                const data = await response.json();
                // Handle different response structures
                const centersArray = data.centers || data.data || data || [];

                if (Array.isArray(centersArray) && centersArray.length > 0) {
                    const centerList = centersArray.map((c: any) => ({
                        id: c.id,
                        name: c.name,
                        code: c.code,
                    }));
                    setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }, ...centerList]);
                } else {
                    // If no centers found, just set the default "All Centers"
                    setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
                }
            } else {
                console.warn('Failed to fetch centers, using default');
                setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            // Set default centers on error
            setCenters([{ id: 'all', name: 'All Centers', code: 'ALL' }]);
        }
    };

    // `override` lets handleGenerateReport pass the just-read draft filters straight through on
    // the same click — reading submittedFromDate/etc. here would otherwise use the pre-update
    // (stale) state, since the setSubmitted* calls in handleGenerateReport haven't re-rendered
    // yet. Omitting it (there are no other callers today) falls back to the last-submitted snapshot.
    const fetchDCBData = async (override?: { fromDate: string; toDate: string; centerId: string }) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                fromDate: override?.fromDate ?? submittedFromDate,
                toDate: override?.toDate ?? submittedToDate,
                centerId: override?.centerId ?? submittedCenter,
            });

            const response = await fetch(`/api/reports/clientwise-dcb?${params}`);

            if (!response.ok) {
                throw new Error('Failed to fetch DCB data');
            }

            const result = await response.json();
            setDcbData(result.data || []);
            setCurrentPage(1); // Reset to first page on new data
        } catch (error) {
            console.error('Error fetching DCB data:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch DCB data. Please try again.',
                variant: 'destructive',
            });
            setDcbData([]);
        } finally {
            setIsLoading(false);
        }
    };

    // Filter data
    const filteredData = dcbData.filter((record) => {
        const matchesSearch =
            record.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            record.accountNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            record.loanAc.toLowerCase().includes(searchTerm.toLowerCase());

        return matchesSearch;
    });

    // Pagination
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage);

    // Calculate totals
    const totals = filteredData.reduce(
        (acc, record) => ({
            openingDue: acc.openingDue + record.openingDue,
            currentDemand: acc.currentDemand + record.currentDemand,
            currentCollection: acc.currentCollection + record.currentCollection,
            currentArrear: acc.currentArrear + record.currentArrear,
            osArrearCall: acc.osArrearCall + record.osArrearCall,
            advance: acc.advance + record.advance,
            preclosure: acc.preclosure + record.preclosure,
            totalCall: acc.totalCall + record.totalCall,
            currentArrearAmount: acc.currentArrearAmount + record.currentArrearAmount,
            closingArrear: acc.closingArrear + record.closingArrear,
        }),
        {
            openingDue: 0,
            currentDemand: 0,
            currentCollection: 0,
            currentArrear: 0,
            osArrearCall: 0,
            advance: 0,
            preclosure: 0,
            totalCall: 0,
            currentArrearAmount: 0,
            closingArrear: 0,
        }
    );

    const collectionRate = totals.currentDemand > 0
        ? ((totals.currentCollection / totals.currentDemand) * 100).toFixed(1)
        : '0.0';

    const arrearCount = filteredData.filter(r => r.closingArrear > 0).length;

    const handleGenerateReport = () => {
        const snapshot = { fromDate, toDate, centerId: selectedCenter };
        setSubmittedFromDate(fromDate);
        setSubmittedToDate(toDate);
        setSubmittedCenter(selectedCenter);
        fetchDCBData(snapshot);
    };

    // Shared field mapping for both export formats — mirrors the columns actually shown
    // in the table above (search-filtered, not paginated: this report already loads every
    // matching row up front, so filteredData IS "all data for the current filters").
    const buildDCBExportRows = (): { headers: string[]; data: (string | number)[][] } => {
        const headers = [
            'Branch', 'Center', 'FDO Name', 'A/C No', 'Client Name', 'Phone', 'Loan A/C',
            'Meeting Date', 'Opening Due', 'Curr Demand', 'Curr Collection', 'Curr Arr', 'OS Arr Call',
            ...(loanAdvanceEnabled ? ['Adv'] : []),
            'Preclosure', 'Total Call', 'Curr Arr Amt', 'Closing Arr',
        ];
        const data = filteredData.map((r) => [
            r.branchName, r.centerName, r.fdoName, r.accountNo, r.clientName, r.phone, r.loanAc,
            r.meetingDate, truncateReportAmount(r.openingDue), truncateReportAmount(r.currentDemand), truncateReportAmount(r.currentCollection), truncateReportAmount(r.currentArrear),
            truncateReportAmount(r.osArrearCall),
            ...(loanAdvanceEnabled ? [truncateReportAmount(r.advance)] : []),
            truncateReportAmount(r.preclosure), truncateReportAmount(r.totalCall), truncateReportAmount(r.currentArrearAmount), truncateReportAmount(r.closingArrear),
        ]);
        data.push([
            `Grand Total (${filteredData.length} records)`, '', '', '', '', '', '', '',
            truncateReportAmount(totals.openingDue), truncateReportAmount(totals.currentDemand), truncateReportAmount(totals.currentCollection), truncateReportAmount(totals.currentArrear),
            truncateReportAmount(totals.osArrearCall),
            ...(loanAdvanceEnabled ? [truncateReportAmount(totals.advance)] : []),
            truncateReportAmount(totals.preclosure), truncateReportAmount(totals.totalCall),
            truncateReportAmount(totals.currentArrearAmount), truncateReportAmount(totals.closingArrear),
        ]);
        return { headers, data };
    };

    const handleExportExcel = () => {
        if (filteredData.length === 0) {
            toast({ title: 'No Data', description: 'No DCB data to export.', variant: 'destructive' });
            return;
        }
        try {
            const { headers, data } = buildDCBExportRows();
            const rowObjects = data.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
            const ws = buildReportSheet(`CLIENTWISE DCB REPORT - ${submittedFromDate} to ${submittedToDate}`, rowObjects);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Clientwise DCB');

            const fileName = `Clientwise_DCB_${submittedFromDate}_to_${submittedToDate}.xlsx`;
            XLSX.writeFile(wb, fileName);
            toast({ title: 'Export Successful', description: `Downloaded ${fileName}` });
        } catch (error) {
            console.error('Excel export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate Excel file.', variant: 'destructive' });
        }
    };

    const handleExportPDF = async () => {
        if (filteredData.length === 0) {
            toast({ title: 'No Data', description: 'No DCB data to export.', variant: 'destructive' });
            return;
        }
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawClientwiseDcbReport(
                doc,
                filteredData,
                { subtitle: `${toDisplayDate(new Date(submittedFromDate))} - ${toDisplayDate(new Date(submittedToDate))}` },
                reportFont,
                undefined,
                loanAdvanceEnabled
            );
            const fileName = `Clientwise_DCB_${submittedFromDate}_to_${submittedToDate}.pdf`;
            doc.save(fileName);
            toast({ title: 'Export Successful', description: `Downloaded ${fileName}` });
        } catch (error) {
            console.error('PDF export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate PDF file.', variant: 'destructive' });
        }
    };

    const handleExport = (format: 'pdf' | 'excel') => {
        if (format === 'pdf') {
            handleExportPDF();
        } else {
            handleExportExcel();
        }
    };

    return (
        <ProtectedRoute requiredPermission="CLIENTWISE_DCB">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30">
                                <BookOpen className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Clientwise DCB Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Demand Collection Book - Detailed client-level collection tracking
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                        <Card className="border-2 border-emerald-200/50 dark:border-emerald-800/50 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/20 dark:to-teal-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                            Total Records
                                        </p>
                                        <p className="text-3xl font-bold text-emerald-900 dark:text-emerald-100 mt-2">
                                            {filteredData.length}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/50">
                                        <BookOpen className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-cyan-50/50 dark:from-brand-green-darker/20 dark:to-cyan-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Demand
                                        </p>
                                        <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {formatCurrency(totals.currentDemand)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <IndianRupee className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Total Collection
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            {formatCurrency(totals.currentCollection)}
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            Collection Rate
                                        </p>
                                        <p className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            {collectionRate}%
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
                                            Arrear Cases
                                        </p>
                                        <p className="text-3xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            {arrearCount}
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
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                        <Filter className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Report Parameters</CardTitle>
                                        <CardDescription>
                                            Select center and date range
                                        </CardDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleExport('pdf')}
                                        className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                                    >
                                        <FileText className="h-4 w-4 mr-2" />
                                        Export PDF
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleExport('excel')}
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

                                {/* From Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        From Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="fromDate"
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* To Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="toDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date <span className="text-red-500">*</span>
                                    </Label>
                                    <DateInput
                                        id="toDate"
                                        value={toDate}
                                        onChange={(e) => setToDate(e.target.value)}
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
                                            placeholder="Name, A/C, Loan A/C..."
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
                                        className="h-11 w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/30"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Loading...
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                                Refresh DCB
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Data Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <ReportHeader
                                title="Clientwise DCB Report"
                                subtitle={`${toDisplayDate(new Date(submittedFromDate))} - ${toDisplayDate(new Date(submittedToDate))}`}
                            />
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Building2 className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">DCB Details</CardTitle>
                                        <CardDescription>
                                            {totalPages > 0 ? `Page ${currentPage} of ${totalPages} • ` : ''}{filteredData.length} total records
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-700">
                                    {toDisplayDate(new Date(submittedFromDate))} - {toDisplayDate(new Date(submittedToDate))}
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
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">FDO Name</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">A/C No</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Client Name</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Phone</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Loan A/C</TableHead>
                                            <TableHead className="font-bold text-foreground dark:text-slate-100">Meeting Date</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Opening Due</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Curr Demand</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Curr Collection</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Curr Arr</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">OS Arr Call</TableHead>
                                            {loanAdvanceEnabled && (
                                                <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Adv</TableHead>
                                            )}
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Preclosure</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Total Call</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Curr Arr Amt</TableHead>
                                            <TableHead className="text-right font-bold text-foreground dark:text-slate-100">Closing Arr</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={18} className="text-center py-12">
                                                    <PageLoader label="Loading DCB data..." fullScreen={false} />
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
                                                            <p className="text-lg font-semibold text-foreground dark:text-slate-100">No records found</p>
                                                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                                                Try adjusting your filters or search criteria
                                                            </p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            paginatedData.map((record, index) => (
                                                <TableRow
                                                    key={`${record.accountNo}-${index}`}
                                                    className={cn(
                                                        'hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors',
                                                        index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50',
                                                        record.closingArrear > 0 && 'border-l-4 border-l-red-500'
                                                    )}
                                                >
                                                    <TableCell className="font-medium">{record.branchName}</TableCell>
                                                    <TableCell>{record.centerName}</TableCell>
                                                    <TableCell className="text-sm">{record.fdoName}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="font-mono text-xs">
                                                            {record.accountNo}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="font-semibold text-foreground dark:text-slate-100">
                                                        {record.clientName}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        <div className="flex items-center gap-1">
                                                            <Phone className="h-3 w-3 text-slate-400" />
                                                            {record.phone}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">{record.loanAc}</TableCell>
                                                    <TableCell className="text-sm">
                                                        <div className="flex items-center gap-1">
                                                            <Clock className="h-3 w-3 text-slate-400" />
                                                            {record.meetingDate}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {record.openingDue > 0 ? (
                                                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                                                                {formatCurrency(record.openingDue)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium text-sidebar-accent dark:text-primary">
                                                        {formatCurrency(record.currentDemand)}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {record.currentCollection > 0 ? (
                                                            <span className="text-green-700 dark:text-green-400 font-medium">
                                                                {formatCurrency(record.currentCollection)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {record.currentArrear > 0 ? (
                                                            <span className="text-red-700 dark:text-red-400 font-medium">
                                                                {formatCurrency(record.currentArrear)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {record.osArrearCall > 0 ? (
                                                            <span className="text-orange-700 dark:text-orange-400 font-medium">
                                                                {formatCurrency(record.osArrearCall)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </TableCell>
                                                    {loanAdvanceEnabled && (
                                                        <TableCell className="text-right">
                                                            {record.advance > 0 ? (
                                                                <span className="text-purple-700 dark:text-purple-400 font-medium">
                                                                    {formatCurrency(record.advance)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="text-right">
                                                        {record.preclosure > 0 ? (
                                                            <span className="text-primary dark:text-primary font-medium">
                                                                {formatCurrency(record.preclosure)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium text-emerald-700 dark:text-emerald-400">
                                                        {formatCurrency(record.totalCall)}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {record.currentArrearAmount > 0 ? (
                                                            <span className="text-red-700 dark:text-red-400 font-medium">
                                                                {formatCurrency(record.currentArrearAmount)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400">-</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {record.closingArrear > 0 ? (
                                                            <Badge variant="destructive" className="font-medium">
                                                                {formatCurrency(record.closingArrear)}
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="text-green-700 border-green-300">
                                                                -
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}

                                        {/* Grand Total Row */}
                                        {paginatedData.length > 0 && (
                                            <TableRow className="bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-950/50 dark:to-teal-950/50 font-bold border-t-2 border-emerald-300 dark:border-emerald-700 hover:from-emerald-100 hover:to-teal-100 dark:hover:from-emerald-950/50 dark:hover:to-teal-950/50">
                                                <TableCell colSpan={8} className="text-lg text-emerald-900 dark:text-emerald-100">
                                                    Grand Total ({filteredData.length} records)
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-amber-800 dark:text-amber-300">
                                                    {formatCurrency(totals.openingDue)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-sidebar-accent dark:text-green-300">
                                                    {formatCurrency(totals.currentDemand)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-green-800 dark:text-green-300">
                                                    {formatCurrency(totals.currentCollection)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.currentArrear)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-orange-800 dark:text-orange-300">
                                                    {formatCurrency(totals.osArrearCall)}
                                                </TableCell>
                                                {loanAdvanceEnabled && (
                                                    <TableCell className="text-right text-lg text-purple-800 dark:text-purple-300">
                                                        {formatCurrency(totals.advance)}
                                                    </TableCell>
                                                )}
                                                <TableCell className="text-right text-lg text-primary dark:text-primary">
                                                    {formatCurrency(totals.preclosure)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-emerald-800 dark:text-emerald-300">
                                                    {formatCurrency(totals.totalCall)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.currentArrearAmount)}
                                                </TableCell>
                                                <TableCell className="text-right text-lg text-red-800 dark:text-red-300">
                                                    {formatCurrency(totals.closingArrear)}
                                                </TableCell>
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
                                                        currentPage === pageNum && "bg-emerald-600 hover:bg-emerald-700"
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
                            Collection Efficiency: <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                {collectionRate}% • {formatCurrency(totals.currentCollection)} / {formatCurrency(totals.currentDemand)}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
