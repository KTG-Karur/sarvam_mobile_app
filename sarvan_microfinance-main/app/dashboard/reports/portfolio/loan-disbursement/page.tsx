'use client';

import { useState, useEffect, useMemo } from 'react';
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
    Banknote,
    FileSpreadsheet,
    FileText,
    FileType,
    FileOutput,
    RotateCcw,
    TrendingUp,
    DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawLoanDisbursementReport } from '@/app/lib/reports/loan-disbursement-pdf';
import { autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Disbursement entry interface matches DisbursementRow from backend
interface DisbursementEntry {
    slNo: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centreId: string;
    centerName: string;
    productType: string;
    loanProduct: string;
    loanId: string;
    memberId: string;
    memberName: string;
    aadhaarNumber: string;
    phoneNumber: string;
    loanCycle: number;
    fdoName: string;
    purposeOfLoan: string;
    loanIndexId: string;
    ldDate: string;
    ldTime: string;
    startDate: string;
    endDate: string;
    admissionFee: number;
    processingFees: number;
    cgst: number;
    sgst: number;
    insuranceFee: number;
    installmentType: string;
    numberOfInstallments: number;
    rateOfInterest: number;
    loanPrincipal: number;
    loanInterest: number;
    loanTotalAmount: number;
    goldWeight: number;
    goldValuePerGram: number;
    fundingName: string;
    loanStatus: string;
    loanApproval: string;
    centerTransfer: string;
}

interface Center {
    id: string;
    name: string;
    code: string;
    branchId?: string;
}

type BranchOption = { id: string; name: string; code: string };

// Today's calendar date (YYYY-MM-DD) in India time — toISOString() would give the UTC date (yesterday before 05:30 IST).
const todayIstYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

// Fee columns — same truncated whole-rupee display as formatCurrency (previously always showed
// 2 decimals; the report amount-display requirement applies uniformly to all monetary fields).
const formatFee = (amount: number) => formatReportAmount(amount ?? 0);

export default function LoanDisbursementPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [fromDate, setFromDate] = useState<string>(todayIstYmd());
    const [tillDate, setTillDate] = useState<string>(todayIstYmd());
    // Submitted (applied) date snapshot — frozen until the next Show click, so exports and
    // the footer date label keep using the last-shown range even if fromDate/tillDate are
    // edited afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);
    const [isLoading, setIsLoading] = useState(false);
    const [data, setData] = useState<DisbursementEntry[]>([]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    // Fetch branches + centers for dropdowns
    useEffect(() => {
        const fetchCenters = async () => {
            try {
                const result = await apiClient.get<Center[]>('/centers');
                if (result.success && result.data) {
                    setCenters(result.data);
                }
            } catch (error) {
                console.error('Error fetching centers:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load centers list.',
                    variant: 'destructive',
                });
            }
        };
        fetchCenters();

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, [toast]);

    const selectedCenterLabel = useMemo(() => {
        if (selectedCenter === 'all') return 'All centers';
        const c = centers.find((x) => x.id === selectedCenter);
        return c ? `${c.code} — ${c.name}` : 'Center';
    }, [centers, selectedCenter]);

    // Calculate totals
    const totalLoans = data.length;
    const totalAmount = data.reduce((sum, e) => sum + e.loanPrincipal, 0);
    const totalDues = data.reduce((sum, e) => sum + e.numberOfInstallments, 0);

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Required Fields',
                description: 'Please select both From and Till dates.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ centerId: selectedCenter, fromDate, tillDate });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            const result = await apiClient.get<DisbursementEntry[]>(
                `/reports/portfolio/loan-disbursement?${params}`
            );

            if (result.success && result.data) {
                setSubmittedFromDate(fromDate);
                setSubmittedTillDate(tillDate);
                setData(result.data);
                if (result.data.length === 0) {
                    toast({
                        title: 'No Data Found',
                        description: 'No disbursements found for the selected criteria.',
                    });
                } else {
                    toast({
                        title: 'Success',
                        description: `Loaded ${result.data.length} disbursement records.`,
                    });
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch disbursement report.',
                    variant: 'destructive',
                });
            }
        } catch (error: any) {
            console.error('Error fetching report:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch disbursement report.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('all');
        const today = todayIstYmd();
        setFromDate(today);
        setTillDate(today);
        setSubmittedFromDate(today);
        setSubmittedTillDate(today);
        setData([]);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({
                title: 'No Data',
                description: 'There is no data to export.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const { headers, rows } = buildLoanDisbursementExportRows();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

            autoSizeColumns(ws);
            applyExcelReportFont(ws);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Disbursements');
            XLSX.writeFile(wb, `Disbursement_Report_${submittedFromDate}_to_${submittedTillDate}.xlsx`);

            toast({
                title: 'Export Successful',
                description: 'Excel file has been downloaded.',
            });
        } catch (error) {
            console.error('Export error:', error);
            toast({
                title: 'Export Failed',
                description: 'An error occurred while generating the Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildLoanDisbursementExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No.', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name',
            'Centre ID', 'Center Name', 'Product Type', 'Loan Product', 'Loan ID', 'Member ID',
            'Member Name', 'Aadhaar Number', 'Phone Number', 'Loan Cycle', 'FDO Name', 'Purpose Of Loan',
            'Loan Index ID', 'LD Date', 'LD Time', 'Start Date', 'End Date', 'Admission Fee',
            'Processing Fees', 'CGST', 'SGST', 'Insurance Fee', 'Installment Type',
            'Number Of Installments', 'Rate Of Interest', 'Loan Principal', 'Loan Interest',
            'Loan Total Amount', 'Gold Weight', 'Gold Value on Date of Disbursement', 'Funding Name',
            'Loan Status', 'Loan Approval', 'Center Transfer',
        ];
        const rows: (string | number)[][] = data.map(row => [
            row.slNo, row.regionName, row.divisionName, row.areaName, row.branchId, row.branchName,
            row.centreId, row.centerName, row.productType, row.loanProduct, row.loanId, row.memberId,
            row.memberName, row.aadhaarNumber, row.phoneNumber, row.loanCycle, row.fdoName, row.purposeOfLoan,
            row.loanIndexId, row.ldDate, row.ldTime, row.startDate, row.endDate, truncateReportAmount(row.admissionFee),
            truncateReportAmount(row.processingFees), truncateReportAmount(row.cgst), truncateReportAmount(row.sgst), truncateReportAmount(row.insuranceFee), row.installmentType,
            row.numberOfInstallments, row.rateOfInterest, truncateReportAmount(row.loanPrincipal), truncateReportAmount(row.loanInterest),
            truncateReportAmount(row.loanTotalAmount), row.goldWeight, truncateReportAmount(row.goldValuePerGram), row.fundingName,
            row.loanStatus, row.loanApproval, row.centerTransfer,
        ]);
        if (data.length > 0) {
            rows.push([
                '', `Grand Total (${totalLoans} loans)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
                '', '', '', '', '', '', totalDues, '', truncateReportAmount(totalAmount), '', '', '', '', '', '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanDisbursementExportRows();
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawLoanDisbursementReport(doc, { headers, rows }, { subtitle: `${submittedFromDate} to ${submittedTillDate}` }, reportFont);
        doc.save(`Disbursement_Report_${submittedFromDate}_to_${submittedTillDate}.pdf`);
        toast({ title: 'Export Successful', description: 'PDF has been downloaded.' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanDisbursementExportRows();
        exportToCSV(`Disbursement_Report_${submittedFromDate}_to_${submittedTillDate}`, 'DISBURSEMENT REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above (PDF already uses A3 for this
    // 40-column report), but the trailing Grand Total row is split off for distinct
    // styling, and genuinely related column clusters (location, branch/center ID+Name
    // pairs, member info, fee breakdown, Principal/Interest/Total triads, status fields)
    // get a 2-row grouped header. At 40 columns — wider than Demand Sheet's 33 — this
    // needs A3 landscape, matching the PDF export's existing precedent.
    const buildLoanDisbursementWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No.', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                { label: 'PRODUCT', span: 2 }, { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 4 },
                { label: 'Loan Cycle', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Purpose Of Loan', span: 1 },
                { label: 'Loan Index ID', span: 1 }, { label: 'DISBURSEMENT', span: 2 }, { label: 'LOAN PERIOD', span: 2 },
                { label: 'FEES', span: 4 }, { label: 'Insurance Fee', span: 1 }, { label: 'Installment Type', span: 1 },
                { label: 'Number Of Installments', span: 1 }, { label: 'Rate Of Interest', span: 1 },
                { label: 'LOAN AMOUNT', span: 3 }, { label: 'GOLD', span: 2 }, { label: 'Funding Name', span: 1 },
                { label: 'STATUS', span: 3 },
            ],
            subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Type', 'Loan Product', 'Member ID', 'Member Name', 'Aadhaar', 'Phone', 'Date', 'Time', 'Start Date', 'End Date', 'Admission', 'Processing', 'CGST', 'SGST', 'Principal', 'Interest', 'Total', 'Weight', 'Value', 'Loan Status', 'Approval', 'Center Transfer'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'left', 'center', 'center', 'center', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'center', 'center', 'center'],
            columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 8, 10, 7, 7, 14, 8, 8, 6, 9, 12, 7, 7, 6, 7, 7, 7, 7, 6, 6, 7, 7, 7, 7, 7, 7, 8, 7, 9, 9, 7, 7, 8],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'There is no data to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildLoanDisbursementExportRows();
        const { bodyRows, options } = buildLoanDisbursementWordOptions(rows);
        await exportToWord(`Disbursement_Report_${submittedFromDate}_to_${submittedTillDate}`, 'DISBURSEMENT REPORT', headers, bodyRows, options);
    };

    return (
        <ProtectedRoute requiredPermission="LOAN_DISBURSEMENT_REPORT">
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
                                <Banknote className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Disbursement Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Comprehensive loan disbursement tracking with client and loan details
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Loans
                                        </p>
                                        <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {totalLoans}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            Disbursed
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <FileSpreadsheet className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Total Amount
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(totalAmount)}
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
                                            Total Dues
                                        </p>
                                        <p className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            {totalDues}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Installments
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
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
                                        Select center and date range, then run the report
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6 lg:items-end">
                                <div className="space-y-2 lg:col-span-1">
                                    <Label
                                        htmlFor="branchSelect"
                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                    >
                                        Branch
                                    </Label>
                                    <Select
                                        value={selectedBranch}
                                        onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                    >
                                        <SelectTrigger
                                            id="branchSelect"
                                            className="h-11 w-full border-primary/30 bg-white dark:border-sidebar-accent dark:bg-green-950"
                                        >
                                            <SelectValue placeholder="-- ALL BRANCHES --" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[min(20rem,50vh)]">
                                            <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                            {branches.map((branch) => (
                                                <SelectItem key={branch.id} value={branch.id}>
                                                    {branch.code} - {branch.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2 lg:col-span-1">
                                    <Label
                                        htmlFor="centerSelect"
                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                    >
                                        Center
                                    </Label>
                                    <Select value={selectedCenter} onValueChange={setSelectedCenter}>
                                        <SelectTrigger
                                            id="centerSelect"
                                            className="h-11 w-full border-primary/30 bg-white dark:border-sidebar-accent dark:bg-green-950"
                                        >
                                            <SelectValue placeholder="Select center" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[min(20rem,50vh)]">
                                            <SelectItem value="all">All centers</SelectItem>
                                            {filteredCenters.map((center) => (
                                                <SelectItem key={center.id} value={center.id}>
                                                    {center.code} — {center.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label
                                        htmlFor="fromDate"
                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                    >
                                        From date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="fromDate"
                                            value={fromDate}
                                            onChange={(e) => setFromDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label
                                        htmlFor="tillDate"
                                        className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                    >
                                        Till date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="tillDate"
                                            value={tillDate}
                                            onChange={(e) => setTillDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                    </div>
                                </div>

                                <div className="space-y-2 lg:col-span-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0 select-none">
                                        Actions
                                    </Label>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            onClick={handleShow}
                                            disabled={isLoading}
                                            className="h-11 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                        >
                                            {isLoading ? (
                                                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                            ) : (
                                                <FileSpreadsheet className="h-4 w-4 mr-2" />
                                            )}
                                            {isLoading ? 'Loading...' : 'Show'}
                                        </Button>
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExport}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            reportSlug={getReportExportMode('loan-disbursement') === 'REQUEST_QUEUE' ? 'loan-disbursement' : undefined}
                                            canExport={canExportReport('loan-disbursement')}
                                            exportParams={{
                                                fromDate: submittedFromDate,
                                                toDate: submittedTillDate,
                                                branchIds: selectedBranch !== 'all' ? [selectedBranch] : 'ALL',
                                                filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                            }}
                                            className="h-11 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                        />
                                        <Button
                                            onClick={handleReset}
                                            variant="outline"
                                            className="h-11 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                        >
                                            <RotateCcw className="h-4 w-4 mr-2" />
                                            Reset
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Disbursement Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Banknote className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Disbursement Report</CardTitle>
                                        <CardDescription>
                                            Comprehensive loan disbursement details
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-sm px-3 py-1 bg-white dark:bg-green-950">
                                    {data.length} Loans
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-primary to-primary dark:from-sidebar-accent dark:to-primary hover:from-primary hover:to-primary">
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">S.No.</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Region Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Division Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Area Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Branch ID</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Branch Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Centre ID</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Center Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Product Type</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Loan Product</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase font-mono">Loan ID</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">Member ID</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Member Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Aadhaar Number</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Phone Number</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">Loan Cycle</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">FDO Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Purpose Of Loan</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase font-mono">Loan Index ID</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">LD Date</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">LD Time</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">Start Date</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">End Date</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Admission Fee</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Processing Fees</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">CGST</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">SGST</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Insurance Fee</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Installment Type</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">No. of Installments</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">Rate Of Interest</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Loan Principal</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Loan Interest</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Loan Total Amount</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">Gold Weight</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-right">Gold Value/Gram</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Funding Name</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Loan Status</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase">Loan Approval</TableHead>
                                            <TableHead className="font-bold text-white text-[10px] whitespace-nowrap uppercase text-center">Center Transfer</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={40} className="h-32 text-center text-slate-500">
                                                    No disbursement data available. Select filters and click "Show".
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.map((entry, index) => (
                                                <TableRow
                                                    key={index}
                                                    className={cn(
                                                        'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                        index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                    )}
                                                >
                                                    <TableCell className="text-center text-[11px] font-mono text-sidebar-accent dark:text-slate-400">
                                                        {entry.slNo}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.regionName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.divisionName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.areaName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-mono text-sidebar-accent dark:text-slate-400">
                                                        {entry.branchId}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-medium text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.branchName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-mono text-sidebar-accent dark:text-slate-400">
                                                        {entry.centreId}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-medium text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.centerName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.productType}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.loanProduct}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-mono text-sidebar-accent dark:text-slate-300">
                                                        {entry.loanId}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] font-mono text-sidebar-accent dark:text-slate-300">
                                                        {entry.memberId}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-semibold text-foreground dark:text-slate-100 whitespace-nowrap">
                                                        {entry.memberName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-mono text-sidebar-accent dark:text-slate-300">
                                                        {entry.aadhaarNumber}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-mono text-sidebar-accent dark:text-slate-300">
                                                        {entry.phoneNumber}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] font-medium text-purple-700 dark:text-purple-400">
                                                        {entry.loanCycle}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-medium text-primary dark:text-primary whitespace-nowrap">
                                                        {entry.fdoName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.purposeOfLoan}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] font-mono text-sidebar-accent dark:text-slate-300">
                                                        {entry.loanIndexId}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] font-mono text-sidebar-accent dark:text-slate-400">
                                                        {entry.ldDate}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] font-mono text-sidebar-accent dark:text-slate-400">
                                                        {entry.ldTime}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        {entry.startDate}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        {entry.endDate}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        ₹{formatFee(entry.admissionFee)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        ₹{formatCurrency(entry.processingFees)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        ₹{formatCurrency(entry.cgst)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        ₹{formatCurrency(entry.sgst)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        ₹{formatFee(entry.insuranceFee)}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.installmentType}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] font-medium text-purple-700 dark:text-purple-400">
                                                        {entry.numberOfInstallments}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        {entry.rateOfInterest}%
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-[11px] text-green-700 dark:text-green-400">
                                                        ₹{formatCurrency(entry.loanPrincipal)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-sidebar-accent dark:text-slate-300">
                                                        ₹{formatCurrency(entry.loanInterest)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-[11px] text-green-700 dark:text-green-400">
                                                        ₹{formatCurrency(entry.loanTotalAmount)}
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px] text-yellow-700 dark:text-yellow-400">
                                                        {entry.goldWeight > 0 ? `${entry.goldWeight.toFixed(3)}g` : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-right text-[11px] text-yellow-700 dark:text-yellow-400">
                                                        {entry.goldValuePerGram > 0 ? `₹${formatCurrency(entry.goldValuePerGram)}` : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-[11px] text-sidebar-accent dark:text-slate-300 whitespace-nowrap">
                                                        {entry.fundingName}
                                                    </TableCell>
                                                    <TableCell className="text-[11px]">
                                                        <Badge variant="outline" className="text-[10px] bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200">
                                                            {entry.loanStatus}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-[11px]">
                                                        <Badge variant="outline" className="text-[10px] bg-green-50 dark:bg-green-950/30 border-primary/30 dark:border-sidebar-accent text-sidebar-accent dark:text-green-300">
                                                            {entry.loanApproval}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-center text-[11px]">
                                                        <Badge variant="outline" className={cn(
                                                            'text-[10px]',
                                                            entry.centerTransfer === 'Yes'
                                                                ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400'
                                                                : 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900/30 dark:text-slate-400'
                                                        )}>
                                                            {entry.centerTransfer}
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Footer Info */}
                    <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                            <p>
                                Report generated on {toDisplayDateTime(new Date())}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2 text-center">
                            <div className="px-4 py-2 bg-white dark:bg-brand-green-darker rounded-full border border-primary/20 dark:border-sidebar-accent shadow-sm">
                                <span className="text-sidebar-accent dark:text-slate-400">Center:</span>{' '}
                                <span className="font-semibold text-sidebar-accent dark:text-slate-200">
                                    {selectedCenterLabel}
                                </span>
                                <span className="mx-2 text-slate-300 dark:text-sidebar-accent">·</span>
                                <span className="text-sidebar-accent dark:text-slate-400">Dates:</span>{' '}
                                <span className="font-semibold text-primary dark:text-primary">
                                    {toDisplayDate(new Date(submittedFromDate))} —{' '}
                                    {toDisplayDate(new Date(submittedTillDate))}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* Adding basic toast feedback accessibility if not already in layout */}
            <div className="fixed bottom-4 right-4 z-50 pointer-events-none" id="toast-root" />
        </ProtectedRoute>
    );
}
