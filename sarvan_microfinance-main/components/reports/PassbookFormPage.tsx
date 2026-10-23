'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { BookOpen, Building2, Search, RotateCcw, Loader2, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { usePermission } from '@/app/hooks/usePermission';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount } from '@/app/lib/utils/format-amount';

type PassbookInstallment = { no: number; date: string; principal: string; interest: string; balance: string };
type PassbookExportData = { memberDetails: { memberName: string; accountNumber: string }; installments: PassbookInstallment[] };

type BranchOption = { id: string; name: string; code: string };

interface LoanSummary {
    id: string;
    clientName: string;
    loanAccount: string;
    loanNumber: string;
    disbursementDate: string;
    amount: number;
    centerId: string;
    centerName: string;
}

const LOAN_TYPES = [
    { id: 'open', name: 'OPEN (Active)' },
    { id: 'closed', name: 'CLOSED' },
    { id: 'all', name: 'ALL' },
];

export function PassbookFormPage() {
    const { canExportReport, getReportExportMode } = usePermission();
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenter, setSelectedCenter] = useState('');
    const [selectedLoanType, setSelectedLoanType] = useState('open');
    const [loans, setLoans] = useState<LoanSummary[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(loans);

    const [passbookDialogOpen, setPassbookDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState<{
        id: string;
        loanNumber: string;
        clientName: string;
    } | null>(null);

    const { toast } = useToast();

    useEffect(() => {
        fetchCenters();
    }, []);

    const fetchCenters = async () => {
        setIsLoadingCenters(true);
        try {
            const centerList = await getCentersForDropdown();
            setCenters(centerList);

            fetch('/api/branches')
                .then((r) => r.json())
                .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
                .catch(() => {});
        } catch {
            toast({ title: 'Error', description: 'Failed to load centers list.', variant: 'destructive' });
        } finally {
            setIsLoadingCenters(false);
        }
    };

    const handleShow = async () => {
        if (!selectedCenter) {
            toast({ title: 'Validation Error', description: 'Please select a center to proceed.', variant: 'destructive' });
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
                    toast({ title: 'No Data', description: 'No loans found for the selected criteria.' });
                } else {
                    toast({ title: 'Success', description: `Found ${result.data.length} loan(s).` });
                }
            } else {
                setLoans([]);
                toast({ title: 'Error', description: result.error || 'Failed to fetch loan data.', variant: 'destructive' });
            }
        } catch {
            setLoans([]);
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsLoadingLoans(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('');
        setSelectedLoanType('open');
        setLoans([]);
    };

    const handleOpenPassbook = (loan: LoanSummary) => {
        setSelectedLoan({
            id: loan.id,
            loanNumber: loan.loanNumber || loan.loanAccount,
            clientName: loan.clientName,
        });
        setPassbookDialogOpen(true);
    };

    // ── Plain tabular export (No / Due Date / Principal / Interest / Balance) ──
    // NOT a replica of the bespoke Tamil-language PDF in LoanPassbookDialog above,
    // which stays untouched — this is a generic flat export of the same schedule data.
    const fetchPassbookExportData = async (loan: LoanSummary): Promise<PassbookExportData | null> => {
        const result = await apiClient.get<PassbookExportData>(`/loans/${loan.id}/passbook`);
        if (result.success && result.data) return result.data;
        toast({ title: 'Export Failed', description: result.error || 'Failed to load passbook data.', variant: 'destructive' });
        return null;
    };

    const buildPassbookExportRows = (data: PassbookExportData): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['No', 'Due Date', 'Principal', 'Interest', 'Balance'];
        const rows: (string | number)[][] = data.installments.map((inst) => [
            inst.no, inst.date, inst.principal, inst.interest, inst.balance,
        ]);
        return { headers, rows };
    };

    const handleExportPDF = async (loan: LoanSummary) => {
        const data = await fetchPassbookExportData(loan);
        if (!data) return;
        const { headers, rows } = buildPassbookExportRows(data);
        const { default: jsPDFCtor } = await import('jspdf');
        const { default: autoTable } = await import('jspdf-autotable');
        const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const reportFont = await ensureReportFont(doc);
        const headerY = await drawPdfReportHeader(doc, 'LOAN PASSBOOK', {
            subtitle: `${data.memberDetails.memberName} — ${data.memberDetails.accountNumber}`,
            fontFamily: reportFont,
        });
        autoTable(doc, { startY: headerY, head: [headers], body: rows, styles: { font: reportFont, fontSize: 8, cellPadding: 1.5 }, headStyles: { font: reportFont } });
        doc.save(`Passbook_${data.memberDetails.accountNumber}.pdf`);
        toast({ title: 'Export Successful', description: 'Passbook exported as PDF.' });
    };

    const handleExportExcel = async (loan: LoanSummary) => {
        const data = await fetchPassbookExportData(loan);
        if (!data) return;
        const { headers, rows } = buildPassbookExportRows(data);
        const XLSX = await import('xlsx-js-style');
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows(`Loan Passbook: ${data.memberDetails.accountNumber}`), headers, ...rows]);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Passbook');
        XLSX.writeFile(wb, `Passbook_${data.memberDetails.accountNumber}.xlsx`);
        toast({ title: 'Export Successful', description: 'Passbook exported as Excel.' });
    };

    const handleExportCSV = async (loan: LoanSummary) => {
        const data = await fetchPassbookExportData(loan);
        if (!data) return;
        const { headers, rows } = buildPassbookExportRows(data);
        const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Passbook_${data.memberDetails.accountNumber}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({ title: 'Export Successful', description: 'Passbook exported as CSV.' });
    };

    // Word-only presentation: same rows as Excel/CSV above. No totals row exists in this
    // report and 5 flat columns don't warrant grouped headers — just professional
    // header/zebra/alignment/width styling.
    const passbookWordOptions: WordExportOptions = {
        columnAlignments: ['center', 'center', 'right', 'right', 'right'],
        columnWidthWeights: [5, 10, 9, 9, 9],
    };

    const handleExportWord = async (loan: LoanSummary) => {
        const data = await fetchPassbookExportData(loan);
        if (!data) return;
        const { headers, rows } = buildPassbookExportRows(data);
        await exportToWord(`Passbook_${data.memberDetails.accountNumber}`, 'LOAN PASSBOOK', headers, rows, passbookWordOptions);
        toast({ title: 'Export Successful', description: 'Passbook exported as Word.' });
    };

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-2xl bg-white/90 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden">
                <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary to-primary" />
                <CardHeader className="px-6 py-5 border-b border-slate-100 dark:border-sidebar-accent/50 space-y-4">
                    <ReportHeader title="Loan Passbook" />
                    <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-white dark:to-slate-400 flex items-center gap-3">
                        <div className="p-2 bg-brand-green-tint dark:bg-brand-green-darker/40 rounded-lg">
                            <BookOpen className="w-5 h-5 text-primary dark:text-primary" />
                        </div>
                        Passbook Filter
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-x-8 gap-y-6">
                        <div className="md:col-span-3 space-y-2.5">
                            <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200">
                                BRANCH
                            </Label>
                            <div className="relative">
                                <Select
                                    value={selectedBranch}
                                    onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter(''); }}
                                    disabled={isLoadingCenters || isLoadingLoans}
                                >
                                    <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                                        <div className="truncate text-left w-full pr-4">
                                            <SelectValue placeholder="-- ALL BRANCHES --" />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-primary/20 shadow-2xl">
                                        <SelectItem value="all" className="py-3">-- ALL BRANCHES --</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id} className="py-3">
                                                {b.code} - {b.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        <div className="md:col-span-3 space-y-2.5">
                            <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                CENTER NAME <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative">
                                <Select
                                    value={selectedCenter}
                                    onValueChange={setSelectedCenter}
                                    disabled={isLoadingCenters || isLoadingLoans}
                                >
                                    <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                                        <div className="truncate text-left w-full pr-4">
                                            {isLoadingCenters ? (
                                                <span className="text-slate-400 flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                                                </span>
                                            ) : (
                                                <SelectValue placeholder="Select Center" />
                                            )}
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-primary/20 shadow-2xl">
                                        {filteredCenters.map((c) => (
                                            <SelectItem key={c.id} value={c.id} className="py-3">
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        <div className="md:col-span-3 space-y-2.5">
                            <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                LOAN TYPE
                            </Label>
                            <div className="relative">
                                <Select
                                    value={selectedLoanType}
                                    onValueChange={setSelectedLoanType}
                                    disabled={isLoadingLoans}
                                >
                                    <SelectTrigger className="h-12 pl-11 bg-white border-primary/20 focus:ring-4 focus:ring-primary/10 dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary rounded-xl w-full">
                                        <div className="truncate text-left w-full pr-4">
                                            <SelectValue placeholder="Loan Type" />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-primary/20 shadow-2xl">
                                        {LOAN_TYPES.map((t) => (
                                            <SelectItem key={t.id} value={t.id} className="py-3">
                                                {t.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 mt-10 pt-8 border-t border-slate-100 dark:border-sidebar-accent/50">
                        <Button
                            onClick={handleShow}
                            disabled={isLoadingLoans}
                            className="h-12 px-10 bg-brand-green-darker hover:bg-black text-white dark:bg-primary dark:hover:bg-primary shadow-xl font-bold tracking-tight rounded-xl transition-all active:scale-95"
                        >
                            {isLoadingLoans ? (
                                <><Loader2 className="mr-3 h-5 w-5 animate-spin" /> LOADING...</>
                            ) : (
                                <><Search className="mr-3 h-5 w-5" /> SHOW LOANS</>
                            )}
                        </Button>
                        <Button
                            onClick={handleReset}
                            variant="outline"
                            disabled={isLoadingLoans}
                            className="h-12 px-10 border-primary/20 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-sidebar-accent font-bold tracking-tight rounded-xl"
                        >
                            <RotateCcw className="mr-3 h-5 w-5" /> RESET
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {loans.length > 0 && (
                <Card className="border-0 shadow-xl ring-1 ring-slate-200 dark:ring-sidebar-accent overflow-hidden">
                    <div className="flex flex-wrap items-center justify-end gap-4 px-4 py-3 border-b border-slate-100 dark:border-sidebar-accent">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search loans..."
                        />
                    </div>
                    <div className="overflow-x-auto">
                        <Table className="w-full text-sm">
                            <TableHeader className="bg-brand-green-tint/80 dark:bg-sidebar-accent/80">
                                <TableRow className="border-b border-primary/20">
                                    <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 py-4 px-4">#</TableHead>
                                    <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 py-4 px-4">Client Name</TableHead>
                                    <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 py-4 px-4">Loan Account</TableHead>
                                    <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 py-4 px-4">Center</TableHead>
                                    <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 py-4 px-4 text-right">Amount</TableHead>
                                    <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 py-4 px-4 text-center">Passbook</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows.map((loan, idx) => (
                                    <TableRow
                                        key={loan.id}
                                        className="border-b border-slate-100 dark:border-sidebar-accent hover:bg-green-50/50 dark:hover:bg-sidebar-accent/50"
                                    >
                                        <TableCell className="py-3 px-4 text-slate-500">{idx + 1}</TableCell>
                                        <TableCell className="py-3 px-4 font-medium text-foreground dark:text-white">
                                            {loan.clientName}
                                        </TableCell>
                                        <TableCell className="py-3 px-4 font-mono text-sidebar-accent dark:text-primary">
                                            {loan.loanNumber || loan.loanAccount}
                                        </TableCell>
                                        <TableCell className="py-3 px-4 text-slate-600 dark:text-slate-400">
                                            {loan.centerName}
                                        </TableCell>
                                        <TableCell className="py-3 px-4 text-right font-semibold text-foreground dark:text-white">
                                            ₹{formatReportAmount(loan.amount)}
                                        </TableCell>
                                        <TableCell className="py-3 px-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleOpenPassbook(loan)}
                                                    className={cn(
                                                        'gap-2 bg-green-600 hover:bg-green-700 text-white shadow-sm h-8 px-4 text-xs font-bold rounded-lg'
                                                    )}
                                                >
                                                    <BookOpen className="h-3.5 w-3.5" />
                                                    Passbook
                                                </Button>
                                                <ExportDropdown
                                                    onExportPDF={() => handleExportPDF(loan)}
                                                    onExportExcel={() => handleExportExcel(loan)}
                                                    onExportCSV={() => handleExportCSV(loan)}
                                                    onExportWord={() => handleExportWord(loan)}
                                                    canExport={canExportReport('loan-passbook')}
                                                    reportSlug={getReportExportMode('loan-passbook') === 'REQUEST_QUEUE' ? 'loan-passbook' : undefined}
                                                    exportParams={{ fromDate: null, toDate: null, branchIds: 'ALL', filters: { loanId: loan.id } }}
                                                    label="Export"
                                                    className="h-8 px-3 text-xs"
                                                />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </Card>
            )}

            {selectedLoan && (
                <LoanPassbookDialog
                    open={passbookDialogOpen}
                    onOpenChange={setPassbookDialogOpen}
                    loanId={selectedLoan.id}
                    loanNumber={selectedLoan.loanNumber}
                    clientName={selectedLoan.clientName}
                />
            )}
        </div>
    );
}
