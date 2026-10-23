'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
import {
    Download,
    RefreshCw,
    Filter,
    AlertTriangle,
    DollarSign,
    FileSpreadsheet,
    FileText,
    FileType,
    FileOutput,
    RotateCcw,
    TrendingDown,
    ChevronLeft,
    ChevronRight,
    User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawParReport } from '@/app/lib/reports/par-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';
import { toDisplayDateTime } from '@/app/lib/date-format';

/* ─── Per-loan PAR row (48 columns) — mirrors MISDetailedArrearRow ─────────── */
interface PARRow extends MemberContactFields {
    branchId: string;
    branchName: string;
    centreId: string;
    centreName: string;
    productType: string;
    loanId: string;
    loanDisbursementDate: string;
    firstEmiDate: string;
    loanMaturityDate: string;
    memberId: string;
    memberName: string;
    memberNomineeName: string;
    address: string;
    district: string;
    phoneNumber: string;
    loanAmount: number;
    noOfInstallment: number;
    lastRepayDate: string;
    lastRepayAmount: number;
    collectedDues: number;
    duesLeft: number;
    loanAge: number;
    ageWise: string;
    dueDay: number;
    emi: number;
    loanPrincipal: number;
    loanInterest: number;
    loanTotal: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingTotal: number;
    overduePrincipal: number;
    overdueInterest: number;
    overdueTotal: number;
    openingOdPrincipal: number;
    openingOdInterest: number;
    openingOdTotal: number;
    currentPrincipalCollection: number;
    currentInterestCollection: number;
    currentCollectionTotal: number;
    principalCollection: number;
    interestCollection: number;
    closingOdPrincipal: number;
    closingOdInterest: number;
    closingOdTotal: number;
    funder: string;
    fdoName: string;
}

/** PAR = Closing OD Principal / Outstanding Principal * 100 */
const computePar = (row: PARRow): number =>
    row.outstandingPrincipal > 0 ? (row.closingOdPrincipal / row.outstandingPrincipal) * 100 : 0;

// Initial Centers list
const INITIAL_CENTERS = [
    { id: 'all', name: '-- ALL CENTERS --' },
];

type BranchOption = { id: string; name: string; code: string };
type CenterWithBranch = { id: string; name: string; branchId?: string };

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

const ageWiseBadgeClass = (ageWise: string) => {
    switch (ageWise) {
        case '1-30': return 'bg-orange-100 text-orange-800 border-orange-300';
        case '31-60': return 'bg-amber-100 text-amber-800 border-amber-300';
        case '61-90': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
        case '91-180': return 'bg-lime-100 text-lime-800 border-lime-300';
        case 'Above 180': return 'bg-red-100 text-red-800 border-red-300';
        default: return 'bg-slate-100 text-slate-700';
    }
};

export function PortfolioAtRiskClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centerName, setCenterName] = useState('all');
    const [isLoading, setIsLoading] = useState(false);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterWithBranch[]>(INITIAL_CENTERS);
    const [data, setData] = useState<PARRow[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : [INITIAL_CENTERS[0], ...centers.filter((c) => c.branchId === selectedBranch)];

    // Fetch branches + centers list on load
    useEffect(() => {
        const fetchCenters = async () => {
            try {
                const result = await apiClient.get<any[]>('/centers');
                if (result.success && result.data) {
                    const centerData = result.data.map((c: any) => ({
                        id: c.id,
                        name: `${c.code} - ${c.name}`,
                        branchId: c.branchId,
                    }));
                    setCenters([INITIAL_CENTERS[0], ...centerData]);
                }
            } catch (error) {
                console.error('Failed to fetch centers:', error);
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

    const handleShow = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ centerId: centerName });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            const result = await apiClient.get<PARRow[]>(`/reports/portfolio/par?${params.toString()}`);
            if (result.success && result.data) {
                setData(result.data);
                setCurrentPage(1);
                toast({
                    title: 'Success',
                    description: `Found ${result.data.length} records.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch report data.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Failed to fetch PAR data:', error);
            toast({
                title: 'Error',
                description: 'Failed to fetch report data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setCenterName('all');
        setData([]);
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({
                title: 'No Data',
                description: 'Please search for data before exporting.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const { headers, rows } = buildPARExportRows();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'PAR Report');
            XLSX.writeFile(wb, `PAR_Report_${new Date().toISOString().split('T')[0]}.xlsx`);

            toast({
                title: 'Export Successful',
                description: 'PAR report has been downloaded as Excel.',
            });
        } catch (error) {
            console.error('Export failed:', error);
            toast({
                title: 'Export Failed',
                description: 'Failed to generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the exact same field mapping used by handleExport above (kept
    // separate so handleExport is left untouched).
    const buildPARExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Branch ID', 'Branch', 'Centre ID', 'Center', 'Product Type', 'Loan ID',
            'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date', 'Member ID', 'Member Name',
            'Member Nominee Name', 'Address', 'District', 'Phone Number', 'Loan Amount',
            'No of Installment', 'Last Repay Date', 'Last Repay Amount', 'Collected Dues', 'Dues Left',
            'Loan Age', 'Age Wise', 'DueDay', 'EMI', 'Loan Principal', 'Loan Interest', 'Loan Total',
            'Outstanding Principal', 'Outstanding Interest', 'Outstanding Total', 'Overdue Principal',
            'Overdue Interest', 'Overdue Total', 'Opening OD Principal', 'Opening OD Interest',
            'Opening OD Total', 'Current Principal Collection', 'Current Interest Collection',
            'Current Collection Total', 'Principal Collection', 'Interest Collection',
            'Closing OD Principal', 'Closing OD Interest', 'Closing OD Total', 'PAR', 'Funder', 'FDO Name',
            ...MEMBER_CONTACT_HEADERS,
        ];
        const rows: (string | number)[][] = data.map((row, index) => [
            index + 1, row.branchId, row.branchName, row.centreId, row.centreName, row.productType, row.loanId,
            row.loanDisbursementDate, row.firstEmiDate, row.loanMaturityDate, row.memberId, row.memberName,
            row.memberNomineeName, row.address, row.district, row.phoneNumber, truncateReportAmount(row.loanAmount),
            row.noOfInstallment, row.lastRepayDate, truncateReportAmount(row.lastRepayAmount), truncateReportAmount(row.collectedDues), truncateReportAmount(row.duesLeft),
            row.loanAge, row.ageWise, row.dueDay, truncateReportAmount(row.emi), truncateReportAmount(row.loanPrincipal), truncateReportAmount(row.loanInterest), truncateReportAmount(row.loanTotal),
            truncateReportAmount(row.outstandingPrincipal), truncateReportAmount(row.outstandingInterest), truncateReportAmount(row.outstandingTotal), truncateReportAmount(row.overduePrincipal),
            truncateReportAmount(row.overdueInterest), truncateReportAmount(row.overdueTotal), truncateReportAmount(row.openingOdPrincipal), truncateReportAmount(row.openingOdInterest),
            truncateReportAmount(row.openingOdTotal), truncateReportAmount(row.currentPrincipalCollection), truncateReportAmount(row.currentInterestCollection),
            truncateReportAmount(row.currentCollectionTotal), truncateReportAmount(row.principalCollection), truncateReportAmount(row.interestCollection),
            truncateReportAmount(row.closingOdPrincipal), truncateReportAmount(row.closingOdInterest), truncateReportAmount(row.closingOdTotal),
            Number(computePar(row).toFixed(2)), row.funder, row.fdoName,
            ...memberContactValues(row),
        ]);
        if (data.length > 0) {
            rows.push([
                // Leading run covers columns 0-15 (S.No through Phone Number) — 16 cells, one
                // of which carries the "Grand Total (...)" label — before Loan Amount at
                // column 16. (Previously only 15 cells here, one short, which shifted every
                // following total one column left of its header.)
                '', `Grand Total (${totalClients} loans)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '',
                truncateReportAmount(totalLoanAmount),
                '', '', '', '', '', '', '', '', '',
                truncateReportAmount(totalLoanAmount), '', truncateReportAmount(totalLoanAmount),
                truncateReportAmount(totalOutstandingPrincipal), truncateReportAmount(totalOutstandingInterest), truncateReportAmount(totalOutstanding),
                truncateReportAmount(totalOverduePrincipal), truncateReportAmount(totalOverdueInterest), truncateReportAmount(totalOverdue),
                truncateReportAmount(totalOpeningOdPrincipal), truncateReportAmount(totalOpeningOdInterest), truncateReportAmount(totalOpeningOdTotal),
                truncateReportAmount(totalCurrentPrincipalCollection), truncateReportAmount(totalCurrentInterestCollection), truncateReportAmount(totalCurrentCollectionTotal),
                truncateReportAmount(totalPrincipalCollection), truncateReportAmount(totalInterestCollection),
                truncateReportAmount(totalClosingOdPrincipal), truncateReportAmount(totalClosingOdInterest), truncateReportAmount(totalClosingOdTotal),
                Number(parPercentage.toFixed(2)), '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawParReport(doc, data, reportFont);
        doc.save(`PAR_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        toast({ title: 'PDF Exported', description: 'PAR report has been downloaded as PDF.' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPARExportRows();
        exportToCSV(`PAR_Report_${new Date().toISOString().split('T')[0]}`, 'PORTFOLIO AT RISK REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above (PDF already uses A3 for this
    // 49-column report), but the trailing Grand Total row is split off for distinct
    // styling, and genuinely related column clusters (branch/center ID+Name pairs,
    // member info, repayment/dues pairs, and the six Principal/Interest/Total triads)
    // get a 2-row grouped header. At 49 columns this needs A3 landscape, matching the
    // PDF export's existing precedent.
    const buildPARWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'BRANCH & CENTER', span: 4 }, { label: 'Product Type', span: 1 },
                { label: 'Loan ID', span: 1 }, { label: 'LOAN DATES', span: 3 }, { label: 'MEMBER INFO', span: 6 },
                { label: 'Loan Amount', span: 1 }, { label: 'No of Installment', span: 1 }, { label: 'REPAYMENT', span: 2 },
                { label: 'DUES', span: 2 }, { label: 'Loan Age', span: 1 }, { label: 'Age Wise', span: 1 },
                { label: 'DueDay', span: 1 }, { label: 'EMI', span: 1 }, { label: 'LOAN AMOUNT', span: 3 },
                { label: 'OUTSTANDING', span: 3 }, { label: 'OVERDUE', span: 3 }, { label: 'OPENING OD', span: 3 },
                { label: 'CURRENT COLLECTION', span: 3 }, { label: 'COLLECTION', span: 2 }, { label: 'CLOSING OD', span: 3 },
                { label: 'PAR', span: 1 }, { label: 'Funder', span: 1 }, { label: 'FDO Name', span: 1 },
            ],
            subHeaders: ['Branch ID', 'Branch', 'Centre ID', 'Center', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Last Date', 'Last Amount', 'Collected', 'Left', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Principal', 'Interest', 'Total'],
            columnAlignments: ['center', 'center', 'left', 'center', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
            columnWidthWeights: [3, 6, 9, 6, 9, 8, 7, 7, 7, 7, 7, 11, 10, 10, 7, 7, 7, 6, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWordFile = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPARExportRows();
        const { bodyRows, options } = buildPARWordOptions(rows);
        await exportToWord(`PAR_Report_${new Date().toISOString().split('T')[0]}`, 'PORTFOLIO AT RISK REPORT', headers, bodyRows, options);
    };

    // Calculate pagination
    const totalPages = Math.ceil(searchedRows.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = searchedRows.slice(startIndex, endIndex);

    // Calculate totals
    const totalClients = data.length;
    const totalLoanAmount = data.reduce((sum, e) => sum + e.loanAmount, 0);
    const totalOutstandingPrincipal = data.reduce((sum, e) => sum + e.outstandingPrincipal, 0);
    const totalOutstandingInterest = data.reduce((sum, e) => sum + e.outstandingInterest, 0);
    const totalOutstanding = data.reduce((sum, e) => sum + e.outstandingTotal, 0);
    const totalOverduePrincipal = data.reduce((sum, e) => sum + e.overduePrincipal, 0);
    const totalOverdueInterest = data.reduce((sum, e) => sum + e.overdueInterest, 0);
    const totalOverdue = data.reduce((sum, e) => sum + e.overdueTotal, 0);
    const totalOpeningOdPrincipal = data.reduce((sum, e) => sum + e.openingOdPrincipal, 0);
    const totalOpeningOdInterest = data.reduce((sum, e) => sum + e.openingOdInterest, 0);
    const totalOpeningOdTotal = data.reduce((sum, e) => sum + e.openingOdTotal, 0);
    const totalCurrentPrincipalCollection = data.reduce((sum, e) => sum + e.currentPrincipalCollection, 0);
    const totalCurrentInterestCollection = data.reduce((sum, e) => sum + e.currentInterestCollection, 0);
    const totalCurrentCollectionTotal = data.reduce((sum, e) => sum + e.currentCollectionTotal, 0);
    const totalPrincipalCollection = data.reduce((sum, e) => sum + e.principalCollection, 0);
    const totalInterestCollection = data.reduce((sum, e) => sum + e.interestCollection, 0);
    const totalClosingOdPrincipal = data.reduce((sum, e) => sum + e.closingOdPrincipal, 0);
    const totalClosingOdInterest = data.reduce((sum, e) => sum + e.closingOdInterest, 0);
    const totalClosingOdTotal = data.reduce((sum, e) => sum + e.closingOdTotal, 0);
    const parPercentage = totalOutstandingPrincipal > 0 ? (totalClosingOdPrincipal / totalOutstandingPrincipal) * 100 : 0;

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-orange-600 shadow-lg shadow-red-500/30">
                        <AlertTriangle className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Portfolio At Risk
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Client-wise portfolio at risk analysis with arrear tracking
                        </p>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
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
                                    At risk
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
                                    Total Outstanding
                                </p>
                                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                    ₹ {formatCurrency(totalOutstanding)}
                                </p>
                                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                    Principal + Interest
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
                                    Total Overdue
                                </p>
                                <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-2">
                                    ₹ {formatCurrency(totalOverdue)}
                                </p>
                                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                    Principal + Interest
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-2 border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-amber-50/50 dark:from-orange-950/20 dark:to-amber-950/20">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
                                    PAR %
                                </p>
                                <p className="text-3xl font-bold text-orange-900 dark:text-orange-100 mt-2">
                                    {parPercentage.toFixed(2)}%
                                </p>
                                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                    Risk ratio
                                </p>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/50">
                                <TrendingDown className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-600 to-amber-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-red-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                            <Filter className="h-5 w-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Report Filters</CardTitle>
                            <CardDescription>
                                Select center to view portfolio at risk report
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setCenterName('all'); }}
                                disabled={isLoading}
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

                        {/* Action Buttons */}
                        <div className="space-y-2 lg:col-span-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                Actions
                            </Label>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleShow}
                                    disabled={isLoading}
                                    className="h-11 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg shadow-red-500/30"
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
                                <ExportDropdown
                                    onExportExcel={handleExport}
                                    onExportCSV={handleExportCSV}
                                    onExportPDF={handleExportPDF}
                                    onExportWord={handleExportWordFile}
                                    reportSlug={getReportExportMode('par') === 'REQUEST_QUEUE' ? 'par' : undefined}
                                    canExport={canExportReport('par')}
                                    exportParams={{
                                        fromDate: null,
                                        toDate: null,
                                        branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                        filters: centerName !== 'all' ? { centerId: centerName } : null,
                                    }}
                                    className="h-11 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* PAR Table Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-600 to-amber-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-red-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Portfolio At Risk Report</CardTitle>
                                <CardDescription>
                                    Client-wise arrear and outstanding details
                                </CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search name, ID, Aadhaar, mobile..."
                            />
                            <Badge variant="outline" className="text-sm px-3 py-1 border-red-300 text-red-700 dark:border-red-700 dark:text-red-300">
                                {searchedRows.length} Clients
                            </Badge>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gradient-to-r from-red-600 to-orange-600 dark:from-red-700 dark:to-orange-700 hover:from-red-600 hover:to-orange-600">
                                    <TableHead className="text-center font-bold text-white text-xs sticky left-0 bg-red-600 z-10">S.No</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Branch ID</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Branch</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Centre ID</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Center</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Product Type</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Loan ID</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Disb. Date</TableHead>
                                    <TableHead className="font-bold text-white text-xs">1st EMI Date</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Maturity Date</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Member ID</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Member Name</TableHead>
                                    <TableHead className="font-bold text-white text-xs">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Nominee Name</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Address</TableHead>
                                    <TableHead className="font-bold text-white text-xs">District</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Phone</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Loan Amt</TableHead>
                                    <TableHead className="text-center font-bold text-white text-xs">Instl</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Last Repay Date</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Last Repay Amt</TableHead>
                                    <TableHead className="text-center font-bold text-white text-xs">Coll. Dues</TableHead>
                                    <TableHead className="text-center font-bold text-white text-xs">Dues Left</TableHead>
                                    <TableHead className="text-center font-bold text-white text-xs">Loan Age</TableHead>
                                    <TableHead className="text-center font-bold text-white text-xs">Age Wise</TableHead>
                                    <TableHead className="text-center font-bold text-white text-xs">Due Day</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">EMI</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Loan Pri</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Loan Int</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Loan Total</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">OS Pri</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">OS Int</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">OS Total</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">OD Pri</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">OD Int</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">OD Total</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Op.OD Pri</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Op.OD Int</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Op.OD Total</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Cur Pri Coll</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Cur Int Coll</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Cur Coll Total</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Pri Coll</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Int Coll</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Cl.OD Pri</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Cl.OD Int</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">Cl.OD Total</TableHead>
                                    <TableHead className="text-right font-bold text-white text-xs">PAR</TableHead>
                                    <TableHead className="font-bold text-white text-xs">Funder</TableHead>
                                    <TableHead className="font-bold text-white text-xs">FDO Name</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {currentData.map((r, index) => {
                                    const rowIndex = startIndex + index;
                                    return (
                                        <TableRow
                                            key={`${r.loanId}-${rowIndex}`}
                                            className={cn(
                                                'hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors border-l-4 border-red-500',
                                                rowIndex % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                            )}
                                        >
                                            <TableCell className="text-center text-xs font-semibold text-sidebar-accent dark:text-slate-300 sticky left-0 bg-inherit z-10">{rowIndex + 1}</TableCell>
                                            <TableCell className="text-xs font-mono text-slate-600 dark:text-slate-400">{r.branchId}</TableCell>
                                            <TableCell className="text-xs font-semibold text-foreground dark:text-slate-100 whitespace-nowrap">{r.branchName}</TableCell>
                                            <TableCell className="text-xs font-mono text-slate-600 dark:text-slate-400">{r.centreId}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.centreName}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.productType || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-xs font-mono text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{r.loanId}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.loanDisbursementDate}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.firstEmiDate}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.loanMaturityDate}</TableCell>
                                            <TableCell className="text-xs font-mono">{r.memberId}</TableCell>
                                            <TableCell className="text-xs font-semibold whitespace-nowrap">{r.memberName}</TableCell>
                                            <TableCell><MemberContactCell row={r} /></TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.memberNomineeName || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-xs max-w-[140px] truncate" title={r.address || undefined}>{r.address || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.district || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-xs font-mono">{r.phoneNumber || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-right text-xs font-bold text-sidebar-accent">{formatCurrency(r.loanAmount)}</TableCell>
                                            <TableCell className="text-center text-xs">{r.noOfInstallment}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.lastRepayDate || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-right text-xs">{formatCurrency(r.lastRepayAmount)}</TableCell>
                                            <TableCell className="text-center text-xs text-green-700 font-semibold">{r.collectedDues}</TableCell>
                                            <TableCell className="text-center text-xs text-red-700 font-semibold">{r.duesLeft}</TableCell>
                                            <TableCell className="text-center text-xs">{r.loanAge}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={cn('text-xs px-2 py-0.5 rounded-full border font-semibold', ageWiseBadgeClass(r.ageWise))}>
                                                    {r.ageWise}
                                                </span>
                                            </TableCell>
                                            <TableCell className={cn('text-center text-xs font-bold', r.dueDay > 180 ? 'text-red-700' : r.dueDay > 90 ? 'text-orange-700' : 'text-amber-700')}>
                                                {r.dueDay}
                                            </TableCell>
                                            <TableCell className="text-right text-xs">{formatCurrency(r.emi)}</TableCell>
                                            <TableCell className="text-right text-xs text-indigo-700">{formatCurrency(r.loanPrincipal)}</TableCell>
                                            <TableCell className="text-right text-xs text-indigo-700">{formatCurrency(r.loanInterest)}</TableCell>
                                            <TableCell className="text-right text-xs font-semibold text-indigo-900">{formatCurrency(r.loanTotal)}</TableCell>
                                            <TableCell className="text-right text-xs text-purple-700">{formatCurrency(r.outstandingPrincipal)}</TableCell>
                                            <TableCell className="text-right text-xs text-purple-700">{formatCurrency(r.outstandingInterest)}</TableCell>
                                            <TableCell className="text-right text-xs font-semibold text-purple-900">{formatCurrency(r.outstandingTotal)}</TableCell>
                                            <TableCell className="text-right text-xs text-red-600">{formatCurrency(r.overduePrincipal)}</TableCell>
                                            <TableCell className="text-right text-xs text-red-600">{formatCurrency(r.overdueInterest)}</TableCell>
                                            <TableCell className="text-right text-xs font-semibold text-red-800">{formatCurrency(r.overdueTotal)}</TableCell>
                                            <TableCell className="text-right text-xs text-orange-600">{formatCurrency(r.openingOdPrincipal)}</TableCell>
                                            <TableCell className="text-right text-xs text-orange-600">{formatCurrency(r.openingOdInterest)}</TableCell>
                                            <TableCell className="text-right text-xs font-semibold text-orange-800">{formatCurrency(r.openingOdTotal)}</TableCell>
                                            <TableCell className="text-right text-xs text-teal-700">{formatCurrency(r.currentPrincipalCollection)}</TableCell>
                                            <TableCell className="text-right text-xs text-teal-700">{formatCurrency(r.currentInterestCollection)}</TableCell>
                                            <TableCell className="text-right text-xs font-semibold text-teal-900">{formatCurrency(r.currentCollectionTotal)}</TableCell>
                                            <TableCell className="text-right text-xs text-green-700">{formatCurrency(r.principalCollection)}</TableCell>
                                            <TableCell className="text-right text-xs text-green-700">{formatCurrency(r.interestCollection)}</TableCell>
                                            <TableCell className="text-right text-xs text-rose-600">{formatCurrency(r.closingOdPrincipal)}</TableCell>
                                            <TableCell className="text-right text-xs text-rose-600">{formatCurrency(r.closingOdInterest)}</TableCell>
                                            <TableCell className="text-right text-xs font-bold text-rose-800">{formatCurrency(r.closingOdTotal)}</TableCell>
                                            <TableCell className="text-right text-xs font-bold text-orange-700">{computePar(r).toFixed(2)}%</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.funder || <span className="text-slate-300">—</span>}</TableCell>
                                            <TableCell className="text-xs whitespace-nowrap">{r.fdoName || <span className="text-slate-300">—</span>}</TableCell>
                                        </TableRow>
                                    );
                                })}
                                {data.length > 0 && (
                                    <TableRow className="bg-gradient-to-r from-brand-green-tint to-orange-100 dark:from-brand-green-darker/30 dark:to-orange-950/20 font-bold border-t-2 border-orange-400/50 text-xs">
                                        <TableCell className="text-center sticky left-0 bg-brand-green-tint dark:bg-brand-green-darker">—</TableCell>
                                        <TableCell colSpan={16} className="font-bold text-foreground dark:text-white">Grand Total ({totalClients} loans)</TableCell>
                                        <TableCell className="text-right font-bold text-foreground">{formatCurrency(totalLoanAmount)}</TableCell>
                                        <TableCell colSpan={9} />
                                        <TableCell className="text-right font-bold text-indigo-900">{formatCurrency(totalLoanAmount)}</TableCell>
                                        <TableCell />
                                        <TableCell className="text-right font-bold text-indigo-900">{formatCurrency(totalLoanAmount)}</TableCell>
                                        <TableCell className="text-right font-bold text-purple-900">{formatCurrency(totalOutstandingPrincipal)}</TableCell>
                                        <TableCell className="text-right font-bold text-purple-900">{formatCurrency(totalOutstandingInterest)}</TableCell>
                                        <TableCell className="text-right font-bold text-purple-900">{formatCurrency(totalOutstanding)}</TableCell>
                                        <TableCell className="text-right font-bold text-red-800">{formatCurrency(totalOverduePrincipal)}</TableCell>
                                        <TableCell className="text-right font-bold text-red-800">{formatCurrency(totalOverdueInterest)}</TableCell>
                                        <TableCell className="text-right font-bold text-red-800">{formatCurrency(totalOverdue)}</TableCell>
                                        <TableCell className="text-right font-bold text-orange-800">{formatCurrency(totalOpeningOdPrincipal)}</TableCell>
                                        <TableCell className="text-right font-bold text-orange-800">{formatCurrency(totalOpeningOdInterest)}</TableCell>
                                        <TableCell className="text-right font-bold text-orange-800">{formatCurrency(totalOpeningOdTotal)}</TableCell>
                                        <TableCell className="text-right font-bold text-teal-900">{formatCurrency(totalCurrentPrincipalCollection)}</TableCell>
                                        <TableCell className="text-right font-bold text-teal-900">{formatCurrency(totalCurrentInterestCollection)}</TableCell>
                                        <TableCell className="text-right font-bold text-teal-900">{formatCurrency(totalCurrentCollectionTotal)}</TableCell>
                                        <TableCell className="text-right font-bold text-green-900">{formatCurrency(totalPrincipalCollection)}</TableCell>
                                        <TableCell className="text-right font-bold text-green-900">{formatCurrency(totalInterestCollection)}</TableCell>
                                        <TableCell className="text-right font-bold text-rose-800">{formatCurrency(totalClosingOdPrincipal)}</TableCell>
                                        <TableCell className="text-right font-bold text-rose-800">{formatCurrency(totalClosingOdInterest)}</TableCell>
                                        <TableCell className="text-right font-bold text-rose-800">{formatCurrency(totalClosingOdTotal)}</TableCell>
                                        <TableCell className="text-right font-bold text-orange-700">{parPercentage.toFixed(2)}%</TableCell>
                                        <TableCell colSpan={2} />
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                Showing {startIndex + 1} to {Math.min(endIndex, searchedRows.length)} of {searchedRows.length} clients
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
                                                currentPage === page && "bg-red-600 hover:bg-red-700"
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
                    PAR Percentage: <span className="font-semibold text-red-700 dark:text-red-400">
                        {parPercentage.toFixed(2)}%
                    </span>
                </p>
            </div>
        </div>
    );
}
