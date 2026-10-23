
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoanSchedulePrintDialog } from '@/components/loan-module/LoanSchedulePrintDialog';
import { LoanPassbookDialog } from '@/components/loan-module/LoanPassbookDialog';
import { Button } from '@/components/ui/button';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { FileText, Printer, Search, RotateCcw, Calendar, IndianRupee, Download, Eye, Loader2, Info, FileSpreadsheet, BookOpen, FileBarChart, FileType, FileOutput } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawLoanScheduleReport } from '@/app/lib/reports/loan-schedule-pdf';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDate } from '@/app/lib/date-format';

// Types
type BranchOption = { id: string; name: string; code: string };

type DeathMarkingInfo = {
    deceasedPersonType: string;
    deceasedPersonName: string;
    deathDate: string;
    placeOfDeath: string;
    deathReason: string;
    demandRequired: boolean;
};

interface LoanSummary {
    id: string;
    clientName: string;
    loanAccount: string;
    disbursementDate: string | null;
    loanEndDate?: string | null;
    amount: number;
    centerId: string;
    centerName: string;
    isDead?: boolean;
    deathMarking?: DeathMarkingInfo | null;
}

interface ScheduleRow {
    installmentNo: number;
    dueDate: string;
    principal: string;
    interest: string;
    savingsDue: string;
    savingsPaid: string;
    totalDue: string;
    balance: string;
}

interface LoanDetails {
    loanNumber: string;
    clientName: string;
    clientId: string;
    centerName: string;
    amount: number;
    interestRate: number;
    tenure: number;
    frequency: string;
    disbursedDate: string | null;
    loanEndDate?: string | null;
}

interface ScheduleDataResponse {
    loanDetails: LoanDetails;
    schedule: ScheduleRow[];
    loanEndDate?: string | null;
}

const LOAN_TYPES = [
    { id: 'open', name: 'OPEN (Active)' },
    { id: 'closed', name: 'CLOSED' },
    { id: 'all', name: 'ALL' },
];

export function LoanScheduleReport() {
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    // State
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenter, setSelectedCenter] = useState('');
    const [selectedLoanType, setSelectedLoanType] = useState('open');
    const [loans, setLoans] = useState<LoanSummary[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [loadingScheduleLoanId, setLoadingScheduleLoanId] = useState<string | null>(null);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(loans);

    // Dialog State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedLoanSchedule, setSelectedLoanSchedule] = useState<ScheduleDataResponse | null>(null);
    const [printDialogOpen, setPrintDialogOpen] = useState(false);
    const [selectedLoanForPrint, setSelectedLoanForPrint] = useState<{
        id: string;
        loanNumber: string;
        clientName: string;
    } | null>(null);
    const [passbookDialogOpen, setPassbookDialogOpen] = useState(false);
    const [selectedLoanForPassbook, setSelectedLoanForPassbook] = useState<{
        id: string;
        loanNumber: string;
        clientName: string;
    } | null>(null);

    const { toast } = useToast();

    // Initial Load
    useEffect(() => {
        fetchCenters();
    }, []);

    const fetchCenters = async () => {
        setIsLoadingCenters(true);
        try {
            const centerList = await getCentersForDropdown();
            setCenters(centerList);
            if (centerList.length === 1 && !selectedCenter) {
                setSelectedCenter(centerList[0].id);
            }

            fetch('/api/branches')
                .then((r) => r.json())
                .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
                .catch(() => {});
        } catch (error) {
            console.error('Failed to fetch centers', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers list.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingCenters(false);
        }
    };

    const handleShow = async () => {
        if (!selectedCenter) {
            toast({
                title: 'Validation Error',
                description: 'Please select a center to proceed.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoadingLoans(true);
        try {
            const result = await apiClient.get<LoanSummary[]>(
                `/reports/loan-schedule?centerId=${selectedCenter}&status=${selectedLoanType}`
            );

            if (result.success && result.data) {
                setLoans(result.data);
                if (result.data.length === 0) {
                    toast({
                        title: 'No Data',
                        description: 'No loans found for the selected criteria.',
                    });
                } else {
                    toast({
                        title: 'Success',
                        description: `Found ${result.data.length} loan(s).`,
                    });
                }
            } else {
                setLoans([]);
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch loan data.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching loans:', error);
            setLoans([]);
            toast({
                title: 'Error',
                description: 'An unexpected error occurred.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingLoans(false);
        }
    };

    const handleViewSchedule = async (loanId: string, loanNumber: string, clientName: string) => {
        // First fetch the schedule data
        setLoadingScheduleLoanId(loanId);
        try {
            const result = await apiClient.get<ScheduleDataResponse>(`/loans/${loanId}/schedule`);
            
            if (result.success && result.data) {
                setSelectedLoanSchedule(result.data);
                // Set the loan for print dialog
                setSelectedLoanForPrint({
                    id: loanId,
                    loanNumber: loanNumber,
                    clientName: clientName,
                });
                // Open both dialogs or just the print dialog
                setPrintDialogOpen(true);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch schedule.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching schedule:', error);
            toast({
                title: 'Error',
                description: 'Failed to load schedule details.',
                variant: 'destructive',
            });
        } finally {
            setLoadingScheduleLoanId(null);
        }
    };


    const handleDownloadExcel = () => {
        if (!selectedLoanSchedule) return;

        const { loanDetails, schedule } = selectedLoanSchedule;

        // 1. Create a Header Section
        const headerData = [
            ...reportHeaderRows('Repayment Schedule'),
            ['Generated On', toDisplayDate(new Date())],
            [''],
            ['Client Details'],
            ['Client Name', loanDetails.clientName, 'Client ID', loanDetails.clientId],
            ['Loan Account', loanDetails.loanNumber, 'Center', loanDetails.centerName],
            ['Loan Amount', loanDetails.amount, 'Interest Rate', `${loanDetails.interestRate}%`],
            ['Tenure', `${loanDetails.tenure} Months`, 'Frequency', loanDetails.frequency],
            ['Disbursement Date', formatDateTime(loanDetails.disbursedDate || ''), 'Loan End Date', loanDetails.loanEndDate || 'N/A'],
            [''],
            ['Schedule Details']
        ];

        // 2. Map Schedule Data
        const scheduleData = schedule.map(row => ({
            'No.': String(row.installmentNo),
            'Due Date': formatDateTime(row.dueDate),
            'Principal': parseFloat(row.principal),
            'Interest': parseFloat(row.interest),
            ...(loanAdvanceEnabled ? {
                'Loan Advance Due': parseFloat(row.savingsDue || '0'),
                'Loan Advance Paid': parseFloat(row.savingsPaid || '0'),
            } : {}),
            'Total Due': parseFloat(row.totalDue),
            'Balance': parseFloat(row.balance),
        }));

        if (schedule.length > 0) {
            const totPri = schedule.reduce((sum, r) => sum + parseFloat(r.principal || '0'), 0);
            const totInt = schedule.reduce((sum, r) => sum + parseFloat(r.interest || '0'), 0);
            const totDue = schedule.reduce((sum, r) => sum + parseFloat(r.savingsDue || '0'), 0);
            const totPaid = schedule.reduce((sum, r) => sum + parseFloat(r.savingsPaid || '0'), 0);
            const totTotal = schedule.reduce((sum, r) => sum + parseFloat(r.totalDue || '0'), 0);
            scheduleData.push({
                'No.': 'Grand Total',
                'Due Date': '',
                'Principal': totPri,
                'Interest': totInt,
                ...(loanAdvanceEnabled ? {
                    'Loan Advance Due': totDue,
                    'Loan Advance Paid': totPaid,
                } : {}),
                'Total Due': totTotal,
                'Balance': 0,
            });
        }

        // 3. Create Worksheet from header data first
        const ws = XLSX.utils.aoa_to_sheet(headerData);

        // 4. Add Schedule Data immediately after the header rows
        XLSX.utils.sheet_add_json(ws, scheduleData, { origin: `A${headerData.length + 1}`, skipHeader: false });

        // 4b. Auto-size columns
        autoSizeColumns(ws);

        // 5. Create Workbook and Append Worksheet
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedule');

        // 6. Generate Filename
        const fileName = `Schedule_${loanDetails.loanNumber}_${loanDetails.clientName.replace(/\s+/g, '_')}.xlsx`;

        // 7. Download
        XLSX.writeFile(wb, fileName);

        toast({
            title: 'Download Started',
            description: `Downloading schedule for ${loanDetails.loanNumber}`,
        });
    };

    // Mirrors the same field mapping used by handleDownloadExcel above (kept separate
    // so handleDownloadExcel is left untouched).
    const buildScheduleExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        if (!selectedLoanSchedule) return { headers: [], rows: [] };
        const { loanDetails, schedule } = selectedLoanSchedule;
        const headers = loanAdvanceEnabled
            ? ['No.', 'Due Date', 'Principal', 'Interest', 'Loan Advance Due', 'Loan Advance Paid', 'Total Due', 'Balance']
            : ['No.', 'Due Date', 'Principal', 'Interest', 'Total Due', 'Balance'];
        const padWidth = headers.length - 4;
        const pad = Array(padWidth).fill('');
        const scheduleRows: (string | number)[][] = schedule.map((row) => [
            row.installmentNo, formatDateTime(row.dueDate), parseFloat(row.principal), parseFloat(row.interest),
            ...(loanAdvanceEnabled ? [parseFloat(row.savingsDue || '0'), parseFloat(row.savingsPaid || '0')] : []),
            parseFloat(row.totalDue), parseFloat(row.balance),
        ]);
        if (schedule.length > 0) {
            const totPri = schedule.reduce((sum, r) => sum + parseFloat(r.principal || '0'), 0);
            const totInt = schedule.reduce((sum, r) => sum + parseFloat(r.interest || '0'), 0);
            const totDue = schedule.reduce((sum, r) => sum + parseFloat(r.savingsDue || '0'), 0);
            const totPaid = schedule.reduce((sum, r) => sum + parseFloat(r.savingsPaid || '0'), 0);
            const totTotal = schedule.reduce((sum, r) => sum + parseFloat(r.totalDue || '0'), 0);
            scheduleRows.push([
                'Grand Total', '', totPri, totInt,
                ...(loanAdvanceEnabled ? [totDue, totPaid] : []),
                totTotal, 0,
            ]);
        }
        const rows: (string | number)[][] = [
            ['Client Name', loanDetails.clientName, 'Client ID', loanDetails.clientId, ...pad],
            ['Loan Account', loanDetails.loanNumber, 'Center', loanDetails.centerName, ...pad],
            ['Loan Amount', loanDetails.amount, 'Interest Rate', `${loanDetails.interestRate}%`, ...pad],
            ['Tenure', `${loanDetails.tenure} Months`, 'Frequency', loanDetails.frequency, ...pad],
            ['Disbursement Date', formatDateTime(loanDetails.disbursedDate || ''), 'Loan End Date', loanDetails.loanEndDate || 'N/A', ...pad],
            ['', '', '', '', ...pad],
            ...scheduleRows,
        ];
        return { headers, rows };
    };

    const handleDownloadPDF = async () => {
        if (!selectedLoanSchedule) return;
        const { loanDetails, schedule } = selectedLoanSchedule;
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawLoanScheduleReport(doc, loanDetails, schedule, reportFont, undefined, loanAdvanceEnabled);
        const fileName = `Schedule_${loanDetails.loanNumber}_${loanDetails.clientName.replace(/\s+/g, '_')}.pdf`;
        doc.save(fileName);
        toast({ title: 'Download Started', description: `Downloading schedule for ${loanDetails.loanNumber}` });
    };

    const handleDownloadCSV = () => {
        if (!selectedLoanSchedule) return;
        const { loanDetails } = selectedLoanSchedule;
        const { headers, rows } = buildScheduleExportRows();
        const fileName = `Schedule_${loanDetails.loanNumber}_${loanDetails.clientName.replace(/\s+/g, '_')}`;
        exportToCSV(fileName, `REPAYMENT SCHEDULE — ${loanDetails.clientName} (${loanDetails.loanNumber})`, headers, rows);
        toast({ title: 'Download Started', description: `Downloading schedule for ${loanDetails.loanNumber}` });
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total"
    // row (when present) is split off for distinct styling. This report leads with a
    // 6-row loan-info block (Field/Value pairs, same shape as Payslip/Branch Profile)
    // before the actual installment schedule, so alignment is tuned for the dominant
    // schedule table (No./Due Date/amounts) rather than grouped headers.
    const buildScheduleWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                columnAlignments: loanAdvanceEnabled
                    ? ['center', 'center', 'right', 'right', 'right', 'right', 'right', 'right']
                    : ['center', 'center', 'right', 'right', 'right', 'right'],
                columnWidthWeights: loanAdvanceEnabled
                    ? [6, 10, 9, 9, 10, 10, 9, 9]
                    : [7, 12, 11, 11, 12, 12],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleDownloadWord = async () => {
        if (!selectedLoanSchedule) return;
        const { loanDetails } = selectedLoanSchedule;
        const { headers, rows } = buildScheduleExportRows();
        const fileName = `Schedule_${loanDetails.loanNumber}_${loanDetails.clientName.replace(/\s+/g, '_')}`;
        const { bodyRows, options } = buildScheduleWordOptions(rows);
        await exportToWord(fileName, `REPAYMENT SCHEDULE — ${loanDetails.clientName} (${loanDetails.loanNumber})`, headers, bodyRows, options);
        toast({ title: 'Download Started', description: `Downloading schedule for ${loanDetails.loanNumber}` });
    };

    const handleViewPassbook = (loanId: string, loanNumber: string, clientName: string) => {
        setSelectedLoanForPassbook({ id: loanId, loanNumber, clientName });
        setPassbookDialogOpen(true);
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('');
        setSelectedLoanType('open');
        setLoans([]);
    };

    // Formatters
    const formatCurrency = (amount: number | string) => {
        const val = typeof amount === 'string' ? parseFloat(amount) : amount;
        return `₹${formatReportAmount(val || 0)}`;
    };

    const formatDateTime = (dateStr: string) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
        return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return toDisplayDate(date); // DD/MM/YYYY
    };

    return (
        <div className="space-y-6">
            {/* Filter Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg bg-card">
                <CardHeader className="bg-gradient-to-r from-slate-50 via-violet-50/30 to-purple-50/30 dark:from-brand-green-darker dark:via-brand-green-darker/50 dark:to-brand-green-darker border-b border-slate-100 dark:border-sidebar-accent">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                            <Search className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div>
                            <CardTitle className="text-lg font-semibold">Report Filters</CardTitle>
                            <CardDescription>Select criteria to generate the loan schedule report</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                Branch
                            </label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter(''); }}
                                disabled={isLoadingCenters}
                            >
                                <SelectTrigger className="h-11 border-primary/20 dark:border-sidebar-accent focus:ring-violet-500">
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
                            <label className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                Center Name <span className="text-red-500">*</span>
                            </label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoadingCenters}>
                                <SelectTrigger className="h-11 border-primary/20 dark:border-sidebar-accent focus:ring-violet-500">
                                    <SelectValue placeholder={isLoadingCenters ? "Loading centers..." : "-- SELECT CENTER --"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                Loan Status <span className="text-red-500">*</span>
                            </label>
                            <Select value={selectedLoanType} onValueChange={setSelectedLoanType}>
                                <SelectTrigger className="h-11 border-primary/20 dark:border-sidebar-accent focus:ring-violet-500">
                                    <SelectValue placeholder="-- SELECT --" />
                                </SelectTrigger>
                                <SelectContent>
                                    {LOAN_TYPES.map((type) => (
                                        <SelectItem key={type.id} value={type.id}>
                                            {type.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-end gap-3 pb-0.5">
                            <Button
                                onClick={handleShow}
                                disabled={isLoadingLoans || isLoadingCenters}
                                className="h-11 flex-1 bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200 dark:shadow-none"
                            >
                                {isLoadingLoans ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    <>
                                        <Search className="h-4 w-4 mr-2" />
                                        Generate Report
                                    </>
                                )}
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="h-11 px-4 border-primary/30 dark:border-sidebar-accent hover:bg-brand-green-tint dark:hover:bg-sidebar-accent"
                            >
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Results Table */}
            {loans.length > 0 && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-primary" />
                    <CardHeader className="bg-green-50/50 dark:bg-brand-green-darker/50 border-b border-slate-100 dark:border-sidebar-accent flex flex-row items-center justify-between flex-wrap gap-4">
                        <div>
                            <CardTitle className="text-lg">Loan List</CardTitle>
                            <CardDescription>
                                Found {searchedRows.length} loans for Center: {loans[0]?.centerName}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-3">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search loans..."
                            />
                            <Button variant="outline" size="sm" className="hidden">
                                <Download className="h-4 w-4 mr-2" />
                                Export List
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200">#</TableHead>
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200">Client Name</TableHead>
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200">Loan A/c</TableHead>
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200">Disb. Date</TableHead>
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200">Loan End</TableHead>
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200 text-right">Amount</TableHead>
                                        <TableHead className="font-semibold text-sidebar-accent dark:text-slate-200 text-center">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map((loan, index) => (
                                        <TableRow key={loan.id} className="cursor-pointer hover:bg-green-50 dark:hover:bg-brand-green-darker/50 transition-colors">
                                            <TableCell className="w-[50px] text-muted-foreground">{index + 1}</TableCell>
                                            <TableCell className="font-medium text-foreground dark:text-slate-100">
                                                <div className="flex items-center gap-2">
                                                    {loan.clientName}
                                                    {loan.isDead && (
                                                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 rounded uppercase tracking-wider">
                                                            DEAD
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="font-mono text-xs bg-brand-green-tint dark:bg-sidebar-accent px-2 py-1 rounded text-sidebar-accent dark:text-slate-300">
                                                    {loan.loanAccount}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-sidebar-accent dark:text-slate-400">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-3.5 w-3.5" />
                                                    {loan.disbursementDate ? formatDateTime(loan.disbursementDate) : 'Not disbursed'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sidebar-accent dark:text-slate-400">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-3.5 w-3.5" />
                                                    {loan.loanEndDate ? formatDateTime(loan.loanEndDate) : 'N/A'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-foreground dark:text-slate-100">
                                                {formatCurrency(loan.amount)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        onClick={() => handleViewSchedule(loan.id, loan.loanAccount, loan.clientName)}
                                                        size="sm"
                                                        variant="secondary"
                                                        className="h-8 px-3 bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/50"
                                                        disabled={loadingScheduleLoanId !== null}
                                                    >
                                                        {loadingScheduleLoanId === loan.id ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <>
                                                                <Eye className="h-3.5 w-3.5 mr-1.5" />
                                                                View Schedule
                                                            </>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        onClick={() => handleViewPassbook(loan.id, loan.loanAccount, loan.clientName)}
                                                        size="sm"
                                                        variant="secondary"
                                                        className="h-8 px-3 bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
                                                    >
                                                        <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                                                        Passbook
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {selectedLoanForPrint && (
                <LoanSchedulePrintDialog
                    open={printDialogOpen}
                    onOpenChange={setPrintDialogOpen}
                    loanId={selectedLoanForPrint.id}
                    loanNumber={selectedLoanForPrint.loanNumber}
                    clientName={selectedLoanForPrint.clientName}
                />
            )}

            {selectedLoanForPassbook && (
                <LoanPassbookDialog
                    open={passbookDialogOpen}
                    onOpenChange={setPassbookDialogOpen}
                    loanId={selectedLoanForPassbook.id}
                    loanNumber={selectedLoanForPassbook.loanNumber}
                    clientName={selectedLoanForPassbook.clientName}
                />
            )}

            {/* Empty State */}
            {!isLoadingLoans && loans.length === 0 && selectedCenter && (
                <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-primary/20 dark:border-sidebar-accent rounded-lg">
                    <div className="bg-green-50 dark:bg-brand-green-darker/50 p-4 rounded-full mb-3">
                        <FileText className="h-8 w-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-foreground dark:text-slate-100">No Loans Found</h3>
                    <p className="text-slate-500 max-w-sm mt-1">
                        We couldn't find any loans matching your criteria. Try adjusting the status filter or selecting a different center.
                    </p>
                </div>
            )}

            {/* Detailed Schedule Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0">
                    <DialogHeader className="p-6 pb-4 border-b">
                        <DialogTitle className="text-xl flex items-center gap-2 text-violet-700 dark:text-violet-400">
                            <FileText className="h-6 w-6" />
                            Repayment Schedule
                        </DialogTitle>
                        <DialogDescription>
                            Detailed breakdown of loan installments and due dates.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedLoanSchedule && (
                        <>
                            <div className="px-6 pt-4 bg-green-50 dark:bg-brand-green-darker/50">
                                <ReportHeader title="Repayment Schedule" />
                            </div>
                            <div className="p-6 bg-green-50 dark:bg-brand-green-darker/50 border-b">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Client</p>
                                        <p className="font-medium text-base truncate" title={selectedLoanSchedule.loanDetails.clientName}>
                                            {selectedLoanSchedule.loanDetails.clientName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">{selectedLoanSchedule.loanDetails.clientId}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Loan Details</p>
                                        <p className="font-medium text-base">{selectedLoanSchedule.loanDetails.loanNumber}</p>
                                        <p className="text-xs text-muted-foreground">{formatDateTime(selectedLoanSchedule.loanDetails.disbursedDate || '')}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Financials</p>
                                        <p className="font-medium text-base text-green-600 dark:text-green-400">
                                            {formatCurrency(selectedLoanSchedule.loanDetails.amount)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {selectedLoanSchedule.loanDetails.interestRate}% Int. | {selectedLoanSchedule.loanDetails.tenure} Mths
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Frequency</p>
                                        <div className="flex items-center gap-1.5">
                                            <p className="font-medium text-base transform capitalize">
                                                {selectedLoanSchedule.loanDetails.frequency?.toLowerCase()}
                                            </p>
                                            {selectedLoanSchedule.loanDetails.frequency?.toUpperCase() === 'DAILY' && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Info className="h-3.5 w-3.5 text-amber-500 cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                                                            Daily loans start 2 days after disbursement and exclude Sundays
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {selectedLoanSchedule.loanDetails.centerName}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-0">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-white dark:bg-green-950 shadow-sm z-10">
                                        <TableRow>
                                            <TableHead className="w-[80px] text-center">#</TableHead>
                                            <TableHead>Due Date</TableHead>
                                            <TableHead className="text-right">Principal</TableHead>
                                            <TableHead className="text-right">Interest</TableHead>
                                            {loanAdvanceEnabled && (
                                                <>
                                                    <TableHead className="text-right text-emerald-700 dark:text-emerald-400">Loan Advance Due</TableHead>
                                                    <TableHead className="text-right text-emerald-700 dark:text-emerald-400">Loan Advance Paid</TableHead>
                                                </>
                                            )}
                                            <TableHead className="text-right font-bold text-sidebar-accent dark:text-slate-100">Total Due</TableHead>
                                            <TableHead className="text-right">Balance</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {selectedLoanSchedule.schedule.map((row) => (
                                            <TableRow key={row.installmentNo} className="even:bg-green-50/50 dark:even:bg-brand-green-darker/30">
                                                <TableCell className="text-center font-medium text-muted-foreground">
                                                    {row.installmentNo}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {formatDateTime(row.dueDate)}
                                                </TableCell>
                                                <TableCell className="text-right text-sidebar-accent dark:text-slate-400">
                                                    {formatCurrency(row.principal)}
                                                </TableCell>
                                                <TableCell className="text-right text-sidebar-accent dark:text-slate-400">
                                                    {formatCurrency(row.interest)}
                                                </TableCell>
                                                {loanAdvanceEnabled && (
                                                    <>
                                                        <TableCell className="text-right text-emerald-700 dark:text-emerald-400">
                                                            {formatCurrency(row.savingsDue || '0')}
                                                        </TableCell>
                                                        <TableCell className="text-right text-emerald-700 dark:text-emerald-400">
                                                            {formatCurrency(row.savingsPaid || '0')}
                                                        </TableCell>
                                                    </>
                                                )}
                                                <TableCell className="text-right font-bold text-foreground dark:text-slate-200">
                                                    {formatCurrency(row.totalDue)}
                                                </TableCell>
                                                <TableCell className="text-right text-slate-500">
                                                    {formatCurrency(row.balance)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            <DialogFooter className="p-4 border-t bg-green-50 dark:bg-brand-green-darker/50 sm:justify-between items-center">
                                <div className="flex flex-col gap-1">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                                        <Info className="h-4 w-4" />
                                        <span>Total: {selectedLoanSchedule.schedule.length} Installments</span>
                                    </div>
                                    {selectedLoanSchedule.loanDetails.frequency?.toUpperCase() === 'DAILY' && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400">
                                            Daily loans start 2 days after disbursement and exclude Sundays
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                                        Close
                                    </Button>
                                    <ExportDropdown
                                        onExportPDF={handleDownloadPDF}
                                        onExportExcel={handleDownloadExcel}
                                        onExportCSV={handleDownloadCSV}
                                        canExport={canExportReport('loan-schedule')}
                                        onExportWord={handleDownloadWord}
                                        reportSlug={selectedLoanForPrint && getReportExportMode('loan-schedule') === 'REQUEST_QUEUE' ? 'loan-schedule' : undefined}
                                        exportParams={{
                                            fromDate: null,
                                            toDate: null,
                                            branchIds: 'ALL',
                                            filters: { loanId: selectedLoanForPrint?.id ?? '' },
                                        }}
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                    />
                                </div>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
