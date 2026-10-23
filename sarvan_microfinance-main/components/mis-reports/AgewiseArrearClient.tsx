'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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
    FileText,
    FileBarChart,
    FileSpreadsheet,
    FileOutput,
    Download,
    Filter,
    IndianRupee,
    TrendingUp,
    AlertCircle,
    Calendar,
    Loader2,
    Search,
    SearchX,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
    Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { getCentersForDropdown, type CenterOption } from '@/app/lib/actions/centers';
import * as XLSX from 'xlsx-js-style';
// PDF export disabled — retained for future use (see handleExportPDF below).
// import jsPDF from 'jspdf';
// import autoTable from 'jspdf-autotable';
// import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
// import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { useTableSearch } from '@/hooks/useTableSearch';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

// ─── Types ───────────────────────────────────────────────────────────────────

type ReportType = 'BRANCHWISE' | 'CENTERWISE' | 'FDOWISE' | 'CLIENTWISE' | 'DETAILEDWISE';

type Branch = { id: string; name: string; code: string };

type BaseArrearData = {
    branchName: string;
    loanAmount: number;
    priBalance: number;
    arrear1To30: number;
    arrear31To60: number;
    arrear61To90: number;
    arrear91To180: number;
    arrearAbove180: number;
    arrearPri: number;
    arrearInt: number;
    arrearTotal: number;
};

type BranchwiseData = BaseArrearData & { numCenters: number; numClients: number };
type CenterwiseData = BaseArrearData & { centerName: string; numClients: number };
type FDOwiseData = BaseArrearData & { fdoName: string; numCenters: number; numClients: number };
type ClientwiseData = BaseArrearData & {
    centerName: string;
    clientName: string;
    phone: string;
    loanAccount: string;
    totalDues: number;
    disbursalDate: string;
    fdoName: string;
};

type DetailedwiseData = {
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
};

type ArrearData = BranchwiseData | CenterwiseData | FDOwiseData | ClientwiseData | DetailedwiseData;

interface ArrearTotals {
    totalLoanAmount: number;
    totalPriBalance: number;
    total1To30: number;
    total31To60: number;
    total61To90: number;
    total91To180: number;
    totalAbove180: number;
    totalArrearPri: number;
    totalArrearInt: number;
    totalArrear: number;
    totalCenters: number;
    totalClients: number;
}

interface DetailedTotals {
    totalLoans: number;
    totalLoanAmount: number;
    totalOutstandingPrincipal: number;
    totalOutstandingInterest: number;
    totalOutstandingTotal: number;
    totalOverduePrincipal: number;
    totalOverdueInterest: number;
    totalOverdueTotal: number;
    totalOpeningOdTotal: number;
    totalCurrentCollection: number;
    totalPrincipalCollection: number;
    totalInterestCollection: number;
    totalClosingOdTotal: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) => formatReportAmount(amount);

const getTodayStr = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const formatDateForDisplay = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return `${String(date.getDate()).padStart(2, '0')} / ${String(date.getMonth() + 1).padStart(2, '0')} / ${date.getFullYear()}`;
};

const emptyTotals: ArrearTotals = {
    totalLoanAmount: 0, totalPriBalance: 0,
    total1To30: 0, total31To60: 0, total61To90: 0, total91To180: 0, totalAbove180: 0,
    totalArrearPri: 0, totalArrearInt: 0, totalArrear: 0,
    totalCenters: 0, totalClients: 0,
};

const emptyDetailedTotals: DetailedTotals = {
    totalLoans: 0,
    totalLoanAmount: 0,
    totalOutstandingPrincipal: 0,
    totalOutstandingInterest: 0,
    totalOutstandingTotal: 0,
    totalOverduePrincipal: 0,
    totalOverdueInterest: 0,
    totalOverdueTotal: 0,
    totalOpeningOdTotal: 0,
    totalCurrentCollection: 0,
    totalPrincipalCollection: 0,
    totalInterestCollection: 0,
    totalClosingOdTotal: 0,
};

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

// ─── Component ───────────────────────────────────────────────────────────────

export function AgewiseArrearClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode, isHeadOffice } = usePermission();

    // Branch/Center filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH), AREA_MANAGER,
    // and any Head-Office-based user (incl. custom RBAC roles like "Zonal Head") get a
    // picker; AREA_MANAGER's branch list is scoped to their assigned branches.
    // Read after mount, not during render — localStorage doesn't exist on the server, so a
    // render-time read made SSR hide the Branch/Center filters while the client showed them
    // (hydration mismatch).
    const [storedUser, setStoredUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
    useEffect(() => {
        setStoredUser(tokenStorage.getUser());
    }, []);
    const isAreaManager = storedUser?.role === 'AREA_MANAGER';
    const canFilterByBranch = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager || isHeadOffice;
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState('ALL');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [centerFilter, setCenterFilter] = useState('ALL');
    const filteredCenters = branchFilter === 'ALL' ? centers : centers.filter((c) => c.branchId === branchFilter);

    // Filter state
    // "Select Type" was removed — this report now only renders the Detailed (48 cols)
    // view. Kept as a constant (widened to ReportType via the assertion so the existing
    // per-type switch/branch code still type-checks); only the DETAILEDWISE arms run.
    const reportType = 'DETAILEDWISE' as ReportType;
    const [reportDate, setReportDate] = useState<string>(getTodayStr());
    // Snapshot of reportDate as of the last "Show" click — used for export filenames,
    // exportParams, and the on-screen subtitle so a draft date edit (without clicking
    // Show) never changes what's displayed/exported.
    const [submittedReportDate, setSubmittedReportDate] = useState<string>(reportDate);

    // FDO filter (server-side `fdoId`) — mirrors the Incentive Report pattern.
    const [officers, setOfficers] = useState<{ id: string; employeeId: string | null; name: string }[]>([]);
    const [fdoFilter, setFdoFilter] = useState('ALL');

    // Data state
    const [data, setData] = useState<ArrearData[]>([]);
    const [totals, setTotals] = useState<ArrearTotals>(emptyTotals);
    const [detailedTotals, setDetailedTotals] = useState<DetailedTotals>(emptyDetailedTotals);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = reportType === 'DETAILEDWISE' ? 20 : 15;
    // useTableSearch skips id-like keys by default; every DetailedwiseData field maps to a
    // visible table column, so feed the full row (all 48 columns, ids included) into the
    // haystack — the search then matches on any column/header in the table.
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data, {
        extraText: (r) =>
            Object.values(r as Record<string, unknown>)
                .filter((v) => v != null && typeof v !== 'object')
                .join(' '),
    });
    const totalPages = Math.ceil(searchedRows.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = searchedRows.slice(startIndex, endIndex);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const printRef = useRef<HTMLDivElement>(null);

    // Branch list for the filter dropdown — AREA_MANAGER sees only their assigned branches.
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
        // Server action already scopes centers to the caller's permitted branches.
        getCentersForDropdown().then(setCenters).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canFilterByBranch, isAreaManager]);

    // FDO dropdown source — re-fetched when the branch filter changes so the list stays
    // branch-scoped. The endpoint also scopes to the caller's permitted branches server-side.
    useEffect(() => {
        const qs = canFilterByBranch && branchFilter !== 'ALL' ? `?branchId=${branchFilter}` : '';
        apiClient
            .get<{ id: string; employeeId: string | null; name: string }[]>(`/reports/mis-agewise-arrear/officers${qs}`)
            .then((result) => {
                if (result.success && result.data) setOfficers(result.data);
            })
            .catch(() => {});
    }, [canFilterByBranch, branchFilter]);

    // ─── Fetch Data ──────────────────────────────────────────────────────

    const fetchData = useCallback(async () => {
        if (!reportDate) {
            toast({ title: 'Report date required', description: 'Please select a report date.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        setCurrentPage(1);

        try {
            const params = new URLSearchParams({ reportDate, reportType });
            if (canFilterByBranch && branchFilter !== 'ALL') params.set('branchId', branchFilter);
            if (canFilterByBranch && centerFilter !== 'ALL') params.set('centerId', centerFilter);
            if (fdoFilter !== 'ALL') params.set('fdoId', fdoFilter);
            const res = await fetch(`/api/reports/mis-agewise-arrear?${params.toString()}`);

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Request failed with status ${res.status}`);
            }

            const json = await res.json();
            setData(json.data || []);

            if (reportType === 'DETAILEDWISE') {
                setDetailedTotals(json.totals || emptyDetailedTotals);
            } else {
                setTotals(json.totals || emptyTotals);
            }

            setSubmittedReportDate(reportDate);
            setShowReport(true);

            if ((json.data || []).length === 0) {
                toast({ title: 'No Data Found', description: 'No arrear data found for the selected parameters.' });
            } else {
                toast({
                    title: 'Report Generated',
                    description: `${(json.data || []).length} records loaded for the arrear report.`,
                });
            }
        } catch (err: any) {
            console.error('Error fetching agewise arrear data:', err);
            toast({ title: 'Error', description: err.message || 'Failed to fetch report data', variant: 'destructive' });
            setData([]);
        } finally {
            setIsLoading(false);
        }
    }, [reportDate, toast, canFilterByBranch, branchFilter, centerFilter, fdoFilter]);

    // ─── Handlers ────────────────────────────────────────────────────────

    const handleReset = () => {
        const today = getTodayStr();
        setReportDate(today);
        setBranchFilter('ALL');
        setCenterFilter('ALL');
        setFdoFilter('ALL');
        setTableSearchQuery('');
        setSubmittedReportDate(today);
        setShowReport(false);
        setData([]);
        setTotals(emptyTotals);
        setDetailedTotals(emptyDetailedTotals);
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first.', variant: 'destructive' });
            return;
        }

        let headers: string[] = [];
        let rows: string[][] = [];

        switch (reportType) {
            case 'BRANCHWISE':
                headers = ['Branch', '# Centers', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
                rows = (data as BranchwiseData[]).map(r => [
                    r.branchName, String(r.numCenters), String(r.numClients), String(r.loanAmount), String(r.priBalance),
                    String(r.arrear1To30), String(r.arrear31To60), String(r.arrear61To90), String(r.arrear91To180),
                    String(r.arrearAbove180), String(r.arrearPri), String(r.arrearInt), String(r.arrearTotal),
                ]);
                break;
            case 'CENTERWISE':
                headers = ['Branch', 'Center', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
                rows = (data as CenterwiseData[]).map(r => [
                    r.branchName, r.centerName, String(r.numClients), String(r.loanAmount), String(r.priBalance),
                    String(r.arrear1To30), String(r.arrear31To60), String(r.arrear61To90), String(r.arrear91To180),
                    String(r.arrearAbove180), String(r.arrearPri), String(r.arrearInt), String(r.arrearTotal),
                ]);
                break;
            case 'FDOWISE':
                headers = ['Branch', 'FDO', '# Centers', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
                rows = (data as FDOwiseData[]).map(r => [
                    r.branchName, r.fdoName, String(r.numCenters), String(r.numClients), String(r.loanAmount), String(r.priBalance),
                    String(r.arrear1To30), String(r.arrear31To60), String(r.arrear61To90), String(r.arrear91To180),
                    String(r.arrearAbove180), String(r.arrearPri), String(r.arrearInt), String(r.arrearTotal),
                ]);
                break;
            case 'CLIENTWISE':
                headers = ['Branch', 'Center', 'Client', 'Phone', 'Loan A/C', 'Loan Amount', 'Pri. Balance', 'Total Dues', 'Disbursal Date', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Total Arrear', 'FDO'];
                rows = (data as ClientwiseData[]).map(r => [
                    r.branchName, r.centerName, r.clientName, r.phone, r.loanAccount, String(r.loanAmount), String(r.priBalance),
                    String(r.totalDues), r.disbursalDate, String(r.arrear1To30), String(r.arrear31To60), String(r.arrear61To90),
                    String(r.arrear91To180), String(r.arrearAbove180), String(r.arrearPri), String(r.arrearInt), String(r.arrearTotal), r.fdoName,
                ]);
                break;
            case 'DETAILEDWISE':
                headers = [
                    'S.No', 'Branch ID', 'Branch', 'Centre ID', 'Center', 'Product Type',
                    'Loan ID', 'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date',
                    'Member ID', 'Member Name', 'Member Nominee Name', 'Address', 'District', 'Phone Number',
                    'Loan Amount', 'No of Installment', 'Last Repay Date', 'Last Repay Amount',
                    'Collected Dues', 'Dues Left', 'Loan Age', 'Age Wise', 'DueDay', 'EMI',
                    'Loan Principal', 'Loan Interest', 'Loan Total',
                    'Outstanding Principal', 'Outstanding Interest', 'Outstanding Total',
                    'Overdue Principal', 'Overdue Interest', 'Overdue Total',
                    'Opening OD Principal', 'Opening OD Interest', 'Opening OD Total',
                    'Current Principal Collection', 'Current Interest Collection', 'Current Collection Total',
                    'Principal Collection', 'Interest Collection',
                    'Closing OD Principal', 'Closing OD Interest', 'Closing OD Total',
                    'Funder', 'FDO Name',
                ];
                rows = (data as DetailedwiseData[]).map((r, idx) => [
                    String(idx + 1), r.branchId, r.branchName, r.centreId, r.centreName, r.productType,
                    r.loanId, r.loanDisbursementDate, r.firstEmiDate, r.loanMaturityDate,
                    r.memberId, r.memberName, r.memberNomineeName, r.address, r.district, r.phoneNumber,
                    String(r.loanAmount), String(r.noOfInstallment), r.lastRepayDate, String(r.lastRepayAmount),
                    String(r.collectedDues), String(r.duesLeft), String(r.loanAge), r.ageWise, String(r.dueDay), String(r.emi),
                    String(r.loanPrincipal), String(r.loanInterest), String(r.loanTotal),
                    String(r.outstandingPrincipal), String(r.outstandingInterest), String(r.outstandingTotal),
                    String(r.overduePrincipal), String(r.overdueInterest), String(r.overdueTotal),
                    String(r.openingOdPrincipal), String(r.openingOdInterest), String(r.openingOdTotal),
                    String(r.currentPrincipalCollection), String(r.currentInterestCollection), String(r.currentCollectionTotal),
                    String(r.principalCollection), String(r.interestCollection),
                    String(r.closingOdPrincipal), String(r.closingOdInterest), String(r.closingOdTotal),
                    r.funder, r.fdoName,
                ]);
                break;
        }

        // Mirrors the same grand-total row rendered on-screen by renderGrandTotalRow()
        if (data.length > 0) {
            switch (reportType) {
                case 'BRANCHWISE':
                    rows.push([
                        'Grand Total', String(totals.totalCenters), String(totals.totalClients), String(totals.totalLoanAmount), String(totals.totalPriBalance),
                        String(totals.total1To30), String(totals.total31To60), String(totals.total61To90), String(totals.total91To180), String(totals.totalAbove180),
                        String(totals.totalArrearPri), String(totals.totalArrearInt), String(totals.totalArrear),
                    ]);
                    break;
                case 'CENTERWISE':
                    rows.push([
                        'Grand Total', '', String(totals.totalClients), String(totals.totalLoanAmount), String(totals.totalPriBalance),
                        String(totals.total1To30), String(totals.total31To60), String(totals.total61To90), String(totals.total91To180), String(totals.totalAbove180),
                        String(totals.totalArrearPri), String(totals.totalArrearInt), String(totals.totalArrear),
                    ]);
                    break;
                case 'FDOWISE':
                    rows.push([
                        'Grand Total', '', String(totals.totalCenters), String(totals.totalClients), String(totals.totalLoanAmount), String(totals.totalPriBalance),
                        String(totals.total1To30), String(totals.total31To60), String(totals.total61To90), String(totals.total91To180), String(totals.totalAbove180),
                        String(totals.totalArrearPri), String(totals.totalArrearInt), String(totals.totalArrear),
                    ]);
                    break;
                case 'CLIENTWISE':
                    rows.push([
                        'Grand Total', '', '', '', '', String(totals.totalLoanAmount), String(totals.totalPriBalance), '', '',
                        String(totals.total1To30), String(totals.total31To60), String(totals.total61To90), String(totals.total91To180), String(totals.totalAbove180),
                        String(totals.totalArrearPri), String(totals.totalArrearInt), String(totals.totalArrear), '',
                    ]);
                    break;
                case 'DETAILEDWISE': {
                    const dt = detailedTotals;
                    rows.push([
                        '—', `Grand Total (${dt.totalLoans} loans)`, '', '', '', '', '', '', '', '', '', '', '', '', '',
                        String(dt.totalLoanAmount),
                        '', '', '', '', '', '', '', '', '',
                        String(dt.totalLoanAmount), '', String(dt.totalLoanAmount),
                        String(dt.totalOutstandingPrincipal), String(dt.totalOutstandingInterest), String(dt.totalOutstandingTotal),
                        String(dt.totalOverduePrincipal), String(dt.totalOverdueInterest), String(dt.totalOverdueTotal),
                        String(dt.totalOpeningOdTotal), '', String(dt.totalOpeningOdTotal),
                        String(dt.totalCurrentCollection), '', String(dt.totalCurrentCollection),
                        String(dt.totalPrincipalCollection), String(dt.totalInterestCollection),
                        String(dt.totalClosingOdTotal), '', String(dt.totalClosingOdTotal),
                        '', '',
                    ]);
                    break;
                }
            }
        }

        const escape = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v;
        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.map(escape).join(',')),
        ].join('\n');

        const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Arrear-Report-${submittedReportDate}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        toast({ title: 'Export Successful', description: 'CSV file downloaded successfully.' });
    };

    // ── Excel / PDF / Word export (mirrors the exact same per-reportType field
    // mapping used by handleExport (CSV) above, kept separate so handleExport is
    // left untouched) ──────────────────────────────────────────────────────────

    const buildAgewiseArrearExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        let headers: string[] = [];
        let rows: (string | number)[][] = [];

        switch (reportType) {
            case 'BRANCHWISE':
                headers = ['Branch', '# Centers', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
                rows = (data as BranchwiseData[]).map(r => [
                    r.branchName, r.numCenters, r.numClients, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                    truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180),
                    truncateReportAmount(r.arrearAbove180), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal),
                ]);
                break;
            case 'CENTERWISE':
                headers = ['Branch', 'Center', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
                rows = (data as CenterwiseData[]).map(r => [
                    r.branchName, r.centerName, r.numClients, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                    truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180),
                    truncateReportAmount(r.arrearAbove180), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal),
                ]);
                break;
            case 'FDOWISE':
                headers = ['Branch', 'FDO', '# Centers', '# Clients', 'Loan Amount', 'Pri. Balance', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Arrear Total'];
                rows = (data as FDOwiseData[]).map(r => [
                    r.branchName, r.fdoName, r.numCenters, r.numClients, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                    truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90), truncateReportAmount(r.arrear91To180),
                    truncateReportAmount(r.arrearAbove180), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal),
                ]);
                break;
            case 'CLIENTWISE':
                headers = ['Branch', 'Center', 'Client', 'Phone', 'Loan A/C', 'Loan Amount', 'Pri. Balance', 'Total Dues', 'Disbursal Date', '1-30', '31-60', '61-90', '91-180', '>180', 'Arrear Pri', 'Arrear Int', 'Total Arrear', 'FDO'];
                rows = (data as ClientwiseData[]).map(r => [
                    r.branchName, r.centerName, r.clientName, r.phone, r.loanAccount, truncateReportAmount(r.loanAmount), truncateReportAmount(r.priBalance),
                    truncateReportAmount(r.totalDues), r.disbursalDate, truncateReportAmount(r.arrear1To30), truncateReportAmount(r.arrear31To60), truncateReportAmount(r.arrear61To90),
                    truncateReportAmount(r.arrear91To180), truncateReportAmount(r.arrearAbove180), truncateReportAmount(r.arrearPri), truncateReportAmount(r.arrearInt), truncateReportAmount(r.arrearTotal), r.fdoName,
                ]);
                break;
            case 'DETAILEDWISE':
                headers = [
                    'S.No', 'Branch ID', 'Branch', 'Centre ID', 'Center', 'Product Type',
                    'Loan ID', 'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date',
                    'Member ID', 'Member Name', 'Member Nominee Name', 'Address', 'District', 'Phone Number',
                    'Loan Amount', 'No of Installment', 'Last Repay Date', 'Last Repay Amount',
                    'Collected Dues', 'Dues Left', 'Loan Age', 'Age Wise', 'DueDay', 'EMI',
                    'Loan Principal', 'Loan Interest', 'Loan Total',
                    'Outstanding Principal', 'Outstanding Interest', 'Outstanding Total',
                    'Overdue Principal', 'Overdue Interest', 'Overdue Total',
                    'Opening OD Principal', 'Opening OD Interest', 'Opening OD Total',
                    'Current Principal Collection', 'Current Interest Collection', 'Current Collection Total',
                    'Principal Collection', 'Interest Collection',
                    'Closing OD Principal', 'Closing OD Interest', 'Closing OD Total',
                    'Funder', 'FDO Name',
                ];
                rows = (data as DetailedwiseData[]).map((r, idx) => [
                    idx + 1, r.branchId, r.branchName, r.centreId, r.centreName, r.productType,
                    r.loanId, r.loanDisbursementDate, r.firstEmiDate, r.loanMaturityDate,
                    r.memberId, r.memberName, r.memberNomineeName, r.address, r.district, r.phoneNumber,
                    truncateReportAmount(r.loanAmount), r.noOfInstallment, r.lastRepayDate, truncateReportAmount(r.lastRepayAmount),
                    truncateReportAmount(r.collectedDues), truncateReportAmount(r.duesLeft), r.loanAge, r.ageWise, r.dueDay, truncateReportAmount(r.emi),
                    truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanTotal),
                    truncateReportAmount(r.outstandingPrincipal), truncateReportAmount(r.outstandingInterest), truncateReportAmount(r.outstandingTotal),
                    truncateReportAmount(r.overduePrincipal), truncateReportAmount(r.overdueInterest), truncateReportAmount(r.overdueTotal),
                    truncateReportAmount(r.openingOdPrincipal), truncateReportAmount(r.openingOdInterest), truncateReportAmount(r.openingOdTotal),
                    truncateReportAmount(r.currentPrincipalCollection), truncateReportAmount(r.currentInterestCollection), truncateReportAmount(r.currentCollectionTotal),
                    truncateReportAmount(r.principalCollection), truncateReportAmount(r.interestCollection),
                    truncateReportAmount(r.closingOdPrincipal), truncateReportAmount(r.closingOdInterest), truncateReportAmount(r.closingOdTotal),
                    r.funder, r.fdoName,
                ]);
                break;
        }

        // Mirrors the same grand-total row rendered on-screen by renderGrandTotalRow()
        if (data.length > 0) {
            switch (reportType) {
                case 'BRANCHWISE':
                    rows.push([
                        'Grand Total', totals.totalCenters, totals.totalClients, truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance),
                        truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                        truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear),
                    ]);
                    break;
                case 'CENTERWISE':
                    rows.push([
                        'Grand Total', '', totals.totalClients, truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance),
                        truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                        truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear),
                    ]);
                    break;
                case 'FDOWISE':
                    rows.push([
                        'Grand Total', '', totals.totalCenters, totals.totalClients, truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance),
                        truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                        truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear),
                    ]);
                    break;
                case 'CLIENTWISE':
                    rows.push([
                        'Grand Total', '', '', '', '', truncateReportAmount(totals.totalLoanAmount), truncateReportAmount(totals.totalPriBalance), '', '',
                        truncateReportAmount(totals.total1To30), truncateReportAmount(totals.total31To60), truncateReportAmount(totals.total61To90), truncateReportAmount(totals.total91To180), truncateReportAmount(totals.totalAbove180),
                        truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt), truncateReportAmount(totals.totalArrear), '',
                    ]);
                    break;
                case 'DETAILEDWISE': {
                    const dt = detailedTotals;
                    rows.push([
                        '—', `Grand Total (${dt.totalLoans} loans)`, '', '', '', '', '', '', '', '', '', '', '', '', '',
                        truncateReportAmount(dt.totalLoanAmount),
                        '', '', '', '', '', '', '', '', '',
                        truncateReportAmount(dt.totalLoanAmount), '', truncateReportAmount(dt.totalLoanAmount),
                        truncateReportAmount(dt.totalOutstandingPrincipal), truncateReportAmount(dt.totalOutstandingInterest), truncateReportAmount(dt.totalOutstandingTotal),
                        truncateReportAmount(dt.totalOverduePrincipal), truncateReportAmount(dt.totalOverdueInterest), truncateReportAmount(dt.totalOverdueTotal),
                        truncateReportAmount(dt.totalOpeningOdTotal), '', truncateReportAmount(dt.totalOpeningOdTotal),
                        truncateReportAmount(dt.totalCurrentCollection), '', truncateReportAmount(dt.totalCurrentCollection),
                        truncateReportAmount(dt.totalPrincipalCollection), truncateReportAmount(dt.totalInterestCollection),
                        truncateReportAmount(dt.totalClosingOdTotal), '', truncateReportAmount(dt.totalClosingOdTotal),
                        '', '',
                    ]);
                    break;
                }
            }
        }

        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAgewiseArrearExportRows();
        const excelRows = rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
        const ws = buildReportSheet('Arrear Report - Detailed', excelRows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Arrear Report');
        XLSX.writeFile(wb, `Arrear-Report-${submittedReportDate}.xlsx`);
        toast({ title: 'Excel Exported', description: 'File downloaded successfully.' });
    };

    // ── PDF export disabled — retained for future use. ─────────────────────────
    // Re-enable by uncommenting this handler + the jsPDF/jspdf-autotable/pdf-report-header
    // /pdf-fonts imports at the top of this file, and re-wiring onExportPDF + removing
    // `hidePdf` on the <ExportDropdown/> below.
    // const handleExportPDF = async () => {
    //     if (data.length === 0) {
    //         toast({ title: 'No Data', description: 'Please generate the report first.', variant: 'destructive' });
    //         return;
    //     }
    //     const { headers, rows } = buildAgewiseArrearExportRows();
    //     const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    //     const reportFont = await ensureReportFont(doc);
    //     const headerY = await drawPdfReportHeader(doc, 'ARREAR REPORT — Detailed', {
    //         subtitle: `Report Date: ${formatDateForDisplay(reportDate)}`,
    //         fontFamily: reportFont,
    //     });
    //     autoTable(doc, {
    //         startY: headerY,
    //         head: [headers],
    //         body: rows,
    //         styles: { font: reportFont, fontSize: 7, cellPadding: 1.5 },
    //         headStyles: { font: reportFont, fillColor: [3, 127, 53], textColor: 255, fontStyle: 'bold' },
    //         alternateRowStyles: { fillColor: [240, 250, 244] },
    //     });
    //     doc.save(`Arrear-Report-${reportDate}.pdf`);
    //     toast({ title: 'PDF Exported', description: 'File downloaded successfully.' });
    // };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total"
    // row is split off for distinct styling. Columns differ by reportType, so grouping
    // branches the same way the header set already does: the ageing-bucket columns
    // (1-30/31-60/61-90/91-180/>180) and Arrear Principal-Interest-Total always get a
    // grouped header for the 4 summary variants; DETAILEDWISE (48 columns, identical
    // shape to the Portfolio at Risk report minus its PAR% column) reuses that same
    // grouping and needs A3 landscape.
    const buildAgewiseArrearWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const bodyRows = rows.slice(0, -1);
        const totalsRow = rows[rows.length - 1];
        const ageingSub = ['1-30', '31-60', '61-90', '91-180', '>180'];
        const arrearSub = ['Principal', 'Interest', 'Total'];

        if (reportType === 'BRANCHWISE') {
            return {
                bodyRows,
                options: {
                    groupHeaders: [
                        { label: 'Branch', span: 1 }, { label: '# Centers', span: 1 }, { label: '# Clients', span: 1 },
                        { label: 'Loan Amount', span: 1 }, { label: 'Pri. Balance', span: 1 },
                        { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 },
                    ],
                    subHeaders: [...ageingSub, ...arrearSub],
                    columnAlignments: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                    columnWidthWeights: [14, 8, 8, 9, 9, 6, 6, 6, 6, 6, 7, 7, 7],
                    totalsRow,
                },
            };
        }
        if (reportType === 'CENTERWISE') {
            return {
                bodyRows,
                options: {
                    groupHeaders: [
                        { label: 'Branch', span: 1 }, { label: 'Center', span: 1 }, { label: '# Clients', span: 1 },
                        { label: 'Loan Amount', span: 1 }, { label: 'Pri. Balance', span: 1 },
                        { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 },
                    ],
                    subHeaders: [...ageingSub, ...arrearSub],
                    columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                    columnWidthWeights: [12, 12, 8, 9, 9, 6, 6, 6, 6, 6, 7, 7, 7],
                    totalsRow,
                },
            };
        }
        if (reportType === 'FDOWISE') {
            return {
                bodyRows,
                options: {
                    groupHeaders: [
                        { label: 'Branch', span: 1 }, { label: 'FDO', span: 1 }, { label: '# Centers', span: 1 },
                        { label: '# Clients', span: 1 }, { label: 'Loan Amount', span: 1 }, { label: 'Pri. Balance', span: 1 },
                        { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 },
                    ],
                    subHeaders: [...ageingSub, ...arrearSub],
                    columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                    columnWidthWeights: [11, 11, 7, 7, 8, 8, 6, 6, 6, 6, 6, 7, 7, 7],
                    totalsRow,
                },
            };
        }
        if (reportType === 'CLIENTWISE') {
            return {
                bodyRows,
                options: {
                    groupHeaders: [
                        { label: 'Branch', span: 1 }, { label: 'Center', span: 1 }, { label: 'Client', span: 1 },
                        { label: 'Phone', span: 1 }, { label: 'Loan A/C', span: 1 }, { label: 'Loan Amount', span: 1 },
                        { label: 'Pri. Balance', span: 1 }, { label: 'Total Dues', span: 1 }, { label: 'Disbursal Date', span: 1 },
                        { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 }, { label: 'FDO', span: 1 },
                    ],
                    subHeaders: [...ageingSub, ...arrearSub],
                    columnAlignments: ['left', 'left', 'left', 'center', 'center', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'],
                    columnWidthWeights: [9, 9, 11, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 6, 6, 6, 8],
                    totalsRow,
                },
            };
        }
        // DETAILEDWISE — same shape as Portfolio at Risk, minus its PAR% column
        return {
            bodyRows,
            options: {
                groupHeaders: [
                    { label: 'S.No', span: 1 }, { label: 'BRANCH & CENTER', span: 4 }, { label: 'Product Type', span: 1 },
                    { label: 'Loan ID', span: 1 }, { label: 'LOAN DATES', span: 3 }, { label: 'MEMBER INFO', span: 6 },
                    { label: 'Loan Amount', span: 1 }, { label: 'No of Installment', span: 1 }, { label: 'REPAYMENT', span: 2 },
                    { label: 'DUES', span: 2 }, { label: 'Loan Age', span: 1 }, { label: 'Age Wise', span: 1 },
                    { label: 'DueDay', span: 1 }, { label: 'EMI', span: 1 }, { label: 'LOAN AMOUNT', span: 3 },
                    { label: 'OUTSTANDING', span: 3 }, { label: 'OVERDUE', span: 3 }, { label: 'OPENING OD', span: 3 },
                    { label: 'CURRENT COLLECTION', span: 3 }, { label: 'COLLECTION', span: 2 }, { label: 'CLOSING OD', span: 3 },
                    { label: 'Funder', span: 1 }, { label: 'FDO Name', span: 1 },
                ],
                subHeaders: ['Branch ID', 'Branch', 'Centre ID', 'Center', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Last Date', 'Last Amount', 'Collected', 'Left', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Principal', 'Interest', 'Total'],
                columnAlignments: ['center', 'center', 'left', 'center', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
                columnWidthWeights: [3, 6, 9, 6, 9, 8, 7, 7, 7, 7, 7, 11, 10, 10, 7, 7, 7, 6, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8],
                totalsRow,
                pageSize: { widthMm: 297, heightMm: 420 },
            },
        };
    };

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildAgewiseArrearExportRows();
        const { bodyRows, options } = buildAgewiseArrearWordOptions(rows);
        await exportToWord(`Arrear-Report-${submittedReportDate}`, 'ARREAR REPORT — Detailed', headers, bodyRows, options);
        toast({ title: 'Word Exported', description: 'File downloaded successfully.' });
    };

    // ─── Table Renderers — Aggregated Views ──────────────────────────────

    const commonAgingHeaders = (
        <>
            <TableHead className="font-bold text-white text-xs text-right">1 to 30</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">31 to 60</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">61 to 90</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">91 to 180</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">Above 180</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">Arrear Pri</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">Arrear Int</TableHead>
            <TableHead className="font-bold text-white text-xs text-right">Arrear Total</TableHead>
        </>
    );

    const renderTableHeaders = () => {
        switch (reportType) {
            case 'BRANCHWISE':
                return (
                    <>
                        <TableHead className="font-bold text-white text-xs">Branch</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center"># Centers</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center"># Clients</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Amount</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Pri. Balance</TableHead>
                        {commonAgingHeaders}
                    </>
                );
            case 'CENTERWISE':
                return (
                    <>
                        <TableHead className="font-bold text-white text-xs">Branch</TableHead>
                        <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center"># Clients</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Amount</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Pri. Balance</TableHead>
                        {commonAgingHeaders}
                    </>
                );
            case 'FDOWISE':
                return (
                    <>
                        <TableHead className="font-bold text-white text-xs">Branch</TableHead>
                        <TableHead className="font-bold text-white text-xs">FDO Name</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center"># Centers</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center"># Clients</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Amount</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Pri. Balance</TableHead>
                        {commonAgingHeaders}
                    </>
                );
            case 'CLIENTWISE':
                return (
                    <>
                        <TableHead className="font-bold text-white text-xs">Branch</TableHead>
                        <TableHead className="font-bold text-white text-xs">Center Name</TableHead>
                        <TableHead className="font-bold text-white text-xs">Client Name</TableHead>
                        <TableHead className="font-bold text-white text-xs">Phone</TableHead>
                        <TableHead className="font-bold text-white text-xs">Loan Account</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Amount</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Pri. Balance</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Total Dues</TableHead>
                        <TableHead className="font-bold text-white text-xs">Disbursal Date</TableHead>
                        {commonAgingHeaders}
                        <TableHead className="font-bold text-white text-xs">FDO Name</TableHead>
                    </>
                );
            case 'DETAILEDWISE':
                return (
                    <>
                        <TableHead className="font-bold text-white text-xs text-center sticky left-0 bg-sidebar-accent z-10">S.No</TableHead>
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
                        <TableHead className="font-bold text-white text-xs">Nominee Name</TableHead>
                        <TableHead className="font-bold text-white text-xs">Address</TableHead>
                        <TableHead className="font-bold text-white text-xs">District</TableHead>
                        <TableHead className="font-bold text-white text-xs">Phone</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Amt</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Instl</TableHead>
                        <TableHead className="font-bold text-white text-xs">Last Repay Date</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Last Repay Amt</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Coll. Dues</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Dues Left</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Loan Age</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Age Wise</TableHead>
                        <TableHead className="font-bold text-white text-xs text-center">Due Day</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">EMI</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Pri</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Int</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Loan Total</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">OS Pri</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">OS Int</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">OS Total</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">OD Pri</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">OD Int</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">OD Total</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Op.OD Pri</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Op.OD Int</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Op.OD Total</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Cur Pri Coll</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Cur Int Coll</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Cur Coll Total</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Pri Coll</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Int Coll</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Cl.OD Pri</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Cl.OD Int</TableHead>
                        <TableHead className="font-bold text-white text-xs text-right">Cl.OD Total</TableHead>
                        <TableHead className="font-bold text-white text-xs">Funder</TableHead>
                        <TableHead className="font-bold text-white text-xs">FDO Name</TableHead>
                    </>
                );
            default:
                return null;
        }
    };

    const renderAgingCells = (item: BaseArrearData) => (
        <>
            <TableCell className="text-right font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(item.arrear1To30)}</TableCell>
            <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-400">{formatCurrency(item.arrear31To60)}</TableCell>
            <TableCell className="text-right font-semibold text-yellow-700 dark:text-yellow-400">{formatCurrency(item.arrear61To90)}</TableCell>
            <TableCell className="text-right font-semibold text-lime-700 dark:text-lime-400">{formatCurrency(item.arrear91To180)}</TableCell>
            <TableCell className={cn("text-right font-semibold", item.arrearAbove180 > 0 ? "text-red-700 dark:text-red-400" : "text-slate-500")}>{formatCurrency(item.arrearAbove180)}</TableCell>
            <TableCell className="text-right font-semibold text-pink-700 dark:text-pink-400">{formatCurrency(item.arrearPri)}</TableCell>
            <TableCell className="text-right font-semibold text-rose-700 dark:text-rose-400">{formatCurrency(item.arrearInt)}</TableCell>
            <TableCell className="text-right font-bold text-primary dark:text-primary">{formatCurrency(item.arrearTotal)}</TableCell>
        </>
    );

    const renderTableRows = () => {
        return currentData.map((item, index) => {
            const rowIndex = startIndex + index;
            const rowClass = cn(
                'transition-colors',
                rowIndex % 2 === 0
                    ? 'bg-white dark:bg-brand-green-darker hover:bg-green-50 dark:hover:bg-green-950/20'
                    : 'bg-green-50/50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-green-950/20'
            );

            switch (reportType) {
                case 'BRANCHWISE': {
                    const r = item as BranchwiseData;
                    return (
                        <TableRow key={rowIndex} className={rowClass}>
                            <TableCell className="font-semibold text-sidebar-accent dark:text-primary">{r.branchName}</TableCell>
                            <TableCell className="text-center"><Badge variant="secondary">{r.numCenters}</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="secondary">{r.numClients}</Badge></TableCell>
                            <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary">{formatCurrency(r.loanAmount)}</TableCell>
                            <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400">{formatCurrency(r.priBalance)}</TableCell>
                            {renderAgingCells(r)}
                        </TableRow>
                    );
                }
                case 'CENTERWISE': {
                    const r = item as CenterwiseData;
                    return (
                        <TableRow key={rowIndex} className={rowClass}>
                            <TableCell className="font-semibold text-sidebar-accent dark:text-primary">{r.branchName}</TableCell>
                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{r.centerName}</TableCell>
                            <TableCell className="text-center"><Badge variant="secondary">{r.numClients}</Badge></TableCell>
                            <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary">{formatCurrency(r.loanAmount)}</TableCell>
                            <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400">{formatCurrency(r.priBalance)}</TableCell>
                            {renderAgingCells(r)}
                        </TableRow>
                    );
                }
                case 'FDOWISE': {
                    const r = item as FDOwiseData;
                    return (
                        <TableRow key={rowIndex} className={rowClass}>
                            <TableCell className="font-semibold text-sidebar-accent dark:text-primary">{r.branchName}</TableCell>
                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{r.fdoName}</TableCell>
                            <TableCell className="text-center"><Badge variant="secondary">{r.numCenters}</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="secondary">{r.numClients}</Badge></TableCell>
                            <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary">{formatCurrency(r.loanAmount)}</TableCell>
                            <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400">{formatCurrency(r.priBalance)}</TableCell>
                            {renderAgingCells(r)}
                        </TableRow>
                    );
                }
                case 'CLIENTWISE': {
                    const r = item as ClientwiseData;
                    return (
                        <TableRow key={rowIndex} className={rowClass}>
                            <TableCell className="font-semibold text-sidebar-accent dark:text-primary">{r.branchName}</TableCell>
                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{r.centerName}</TableCell>
                            <TableCell className="font-semibold text-foreground dark:text-slate-100">{r.clientName}</TableCell>
                            <TableCell className="font-mono text-xs text-sidebar-accent dark:text-slate-300">{r.phone}</TableCell>
                            <TableCell className="font-mono text-xs text-cyan-700 dark:text-cyan-400">{r.loanAccount}</TableCell>
                            <TableCell className="text-right font-bold text-sidebar-accent dark:text-primary">{formatCurrency(r.loanAmount)}</TableCell>
                            <TableCell className="text-right font-semibold text-purple-700 dark:text-purple-400">{formatCurrency(r.priBalance)}</TableCell>
                            <TableCell className="text-center font-semibold text-violet-700 dark:text-violet-400">{r.totalDues}</TableCell>
                            <TableCell className="text-sm">{r.disbursalDate}</TableCell>
                            {renderAgingCells(r)}
                            <TableCell className="font-medium text-sidebar-accent dark:text-slate-300">{r.fdoName}</TableCell>
                        </TableRow>
                    );
                }
                case 'DETAILEDWISE': {
                    const r = item as DetailedwiseData;
                    return (
                        <TableRow key={rowIndex} className={rowClass}>
                            <TableCell className="text-center text-xs text-slate-500 sticky left-0 bg-inherit z-10">{rowIndex + 1}</TableCell>
                            <TableCell className="text-xs font-mono text-slate-600 dark:text-slate-400">{r.branchId}</TableCell>
                            <TableCell className="text-xs font-semibold text-sidebar-accent dark:text-primary whitespace-nowrap">{r.branchName}</TableCell>
                            <TableCell className="text-xs font-mono text-slate-600 dark:text-slate-400">{r.centreId}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.centreName}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.productType || <span className="text-slate-300">—</span>}</TableCell>
                            <TableCell className="text-xs font-mono text-cyan-700 dark:text-cyan-400 whitespace-nowrap">{r.loanId}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.loanDisbursementDate}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.firstEmiDate}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.loanMaturityDate}</TableCell>
                            <TableCell className="text-xs font-mono">{r.memberId}</TableCell>
                            <TableCell className="text-xs font-semibold whitespace-nowrap">{r.memberName}</TableCell>
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
                            <TableCell className="text-xs whitespace-nowrap">{r.funder}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fdoName}</TableCell>
                        </TableRow>
                    );
                }
                default:
                    return null;
            }
        });
    };

    const renderGrandTotalRow = () => {
        if (!showReport || data.length === 0) return null;

        if (reportType === 'DETAILEDWISE') {
            const dt = detailedTotals;
            return (
                <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/30 dark:to-brand-green-darker/30 font-bold border-t-2 border-primary/50 text-xs">
                    <TableCell className="font-bold text-foreground dark:text-white text-center sticky left-0 bg-brand-green-tint">—</TableCell>
                    {/* Branch ID, Branch, Centre ID, Center, Product Type, Loan ID, Disb/EMI/Maturity, Member cols, Address, District, Phone */}
                    <TableCell colSpan={15} className="font-bold text-foreground dark:text-white">Grand Total ({dt.totalLoans} loans)</TableCell>
                    {/* Loan Amount */}
                    <TableCell className="text-right font-bold text-foreground">{formatCurrency(dt.totalLoanAmount)}</TableCell>
                    {/* Instl, Last Repay Date, Last Repay Amt, Coll Dues, Dues Left, Loan Age, Age Wise, Due Day, EMI */}
                    <TableCell colSpan={9} />
                    {/* Loan Pri, Int, Total */}
                    <TableCell className="text-right font-bold">{formatCurrency(dt.totalLoanAmount)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold">{formatCurrency(dt.totalLoanAmount)}</TableCell>
                    {/* OS Pri, Int, Total */}
                    <TableCell className="text-right font-bold text-purple-900">{formatCurrency(dt.totalOutstandingPrincipal)}</TableCell>
                    <TableCell className="text-right font-bold text-purple-900">{formatCurrency(dt.totalOutstandingInterest)}</TableCell>
                    <TableCell className="text-right font-bold text-purple-900">{formatCurrency(dt.totalOutstandingTotal)}</TableCell>
                    {/* OD Pri, Int, Total */}
                    <TableCell className="text-right font-bold text-red-800">{formatCurrency(dt.totalOverduePrincipal)}</TableCell>
                    <TableCell className="text-right font-bold text-red-800">{formatCurrency(dt.totalOverdueInterest)}</TableCell>
                    <TableCell className="text-right font-bold text-red-800">{formatCurrency(dt.totalOverdueTotal)}</TableCell>
                    {/* Op OD Pri, Int, Total */}
                    <TableCell className="text-right font-bold text-orange-800">{formatCurrency(dt.totalOpeningOdTotal)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold text-orange-800">{formatCurrency(dt.totalOpeningOdTotal)}</TableCell>
                    {/* Cur Pri, Int, Total */}
                    <TableCell className="text-right font-bold text-teal-900">{formatCurrency(dt.totalCurrentCollection)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold text-teal-900">{formatCurrency(dt.totalCurrentCollection)}</TableCell>
                    {/* Pri Coll, Int Coll */}
                    <TableCell className="text-right font-bold text-green-900">{formatCurrency(dt.totalPrincipalCollection)}</TableCell>
                    <TableCell className="text-right font-bold text-green-900">{formatCurrency(dt.totalInterestCollection)}</TableCell>
                    {/* Closing OD Pri, Int, Total */}
                    <TableCell className="text-right font-bold text-rose-800">{formatCurrency(dt.totalClosingOdTotal)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold text-rose-800">{formatCurrency(dt.totalClosingOdTotal)}</TableCell>
                    {/* Funder, FDO */}
                    <TableCell colSpan={2} />
                </TableRow>
            );
        }

        const totalAgingCells = (
            <>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.total1To30)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.total31To60)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.total61To90)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.total91To180)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.totalAbove180)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.totalArrearPri)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.totalArrearInt)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.totalArrear)}</TableCell>
            </>
        );

        return (
            <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/30 dark:to-brand-green-darker/30 font-bold border-t-2 border-primary/50">
                {reportType === 'BRANCHWISE' && (
                    <>
                        <TableCell className="font-bold text-foreground dark:text-white">Grand Total</TableCell>
                        <TableCell className="text-center font-bold text-foreground dark:text-white">{totals.totalCenters}</TableCell>
                        <TableCell className="text-center font-bold text-foreground dark:text-white">{totals.totalClients}</TableCell>
                    </>
                )}
                {reportType === 'CENTERWISE' && (
                    <>
                        <TableCell className="font-bold text-foreground dark:text-white" colSpan={2}>Grand Total</TableCell>
                        <TableCell className="text-center font-bold text-foreground dark:text-white">{totals.totalClients}</TableCell>
                    </>
                )}
                {reportType === 'FDOWISE' && (
                    <>
                        <TableCell className="font-bold text-foreground dark:text-white" colSpan={2}>Grand Total</TableCell>
                        <TableCell className="text-center font-bold text-foreground dark:text-white">{totals.totalCenters}</TableCell>
                        <TableCell className="text-center font-bold text-foreground dark:text-white">{totals.totalClients}</TableCell>
                    </>
                )}
                {reportType === 'CLIENTWISE' && (
                    <TableCell className="font-bold text-foreground dark:text-white" colSpan={5}>Grand Total</TableCell>
                )}
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.totalLoanAmount)}</TableCell>
                <TableCell className="text-right font-bold text-foreground dark:text-white">{formatCurrency(totals.totalPriBalance)}</TableCell>
                {reportType === 'CLIENTWISE' && (
                    <>
                        <TableCell className="font-bold text-foreground dark:text-white"></TableCell>
                        <TableCell className="font-bold text-foreground dark:text-white"></TableCell>
                    </>
                )}
                {totalAgingCells}
                {reportType === 'CLIENTWISE' && (
                    <TableCell className="font-bold text-foreground dark:text-white"></TableCell>
                )}
            </TableRow>
        );
    };

    // ─── Summary cards for DETAILEDWISE ─────────────────────────────────

    const renderDetailedSummaryCards = () => {
        // Distinct members — one client can have several loans in arrear.
        const memberCount = new Set((data as DetailedwiseData[]).map((r) => r.memberId)).size;
        return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
            <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-purple-50/50 dark:from-purple-950/20 dark:to-purple-950/20">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Member Count</p>
                            <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                {memberCount.toLocaleString('en-IN')}
                            </p>
                            <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">{detailedTotals.totalLoans.toLocaleString('en-IN')} loans in arrear</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                            <Users className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-orange-50/50 dark:from-red-950/20 dark:to-orange-950/20">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">Total Overdue</p>
                            <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-2">
                                ₹ {formatCurrency(detailedTotals.totalOverdueTotal)}
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{detailedTotals.totalLoans} loans in arrear</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card className="border-2 border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-amber-50/50 dark:from-orange-950/20 dark:to-amber-950/20">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-orange-700 dark:text-orange-300">Opening OD</p>
                            <p className="text-2xl font-bold text-orange-900 dark:text-orange-100 mt-2">
                                ₹ {formatCurrency(detailedTotals.totalOpeningOdTotal)}
                            </p>
                            <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">Start of day overdue</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/50">
                            <TrendingUp className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card className="border-2 border-teal-200/50 dark:border-teal-800/50 bg-gradient-to-br from-teal-50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-teal-700 dark:text-teal-300">Current Day Collection</p>
                            <p className="text-2xl font-bold text-teal-900 dark:text-teal-100 mt-2">
                                ₹ {formatCurrency(detailedTotals.totalCurrentCollection)}
                            </p>
                            <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">Collected on report date</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/50">
                            <IndianRupee className="h-6 w-6 text-teal-600 dark:text-teal-400" />
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card className="border-2 border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50 to-pink-50/50 dark:from-rose-950/20 dark:to-pink-950/20">
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Closing OD</p>
                            <p className="text-2xl font-bold text-rose-900 dark:text-rose-100 mt-2">
                                ₹ {formatCurrency(detailedTotals.totalClosingOdTotal)}
                            </p>
                            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">End of day balance</p>
                        </div>
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/50">
                            <AlertCircle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
        );
    };

    // ─── Render ──────────────────────────────────────────────────────────

    return (
        <div className="relative w-full">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <FileText className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Arrear Report
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Detailed per-loan arrear report with day-past-due aging buckets
                        </p>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            {showReport && data.length > 0 && renderDetailedSummaryCards()}

            {/* Filters Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Filter className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Report Parameters</CardTitle>
                                <CardDescription>Select date and filters for the Arrear Report</CardDescription>
                            </div>
                        </div>
                        {showReport && data.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                <ExportDropdown
                                    // PDF export disabled — retained for future use; `hidePdf`
                                    // also suppresses it in REQUEST_QUEUE mode.
                                    hidePdf
                                    onExportExcel={handleExportExcel}
                                    onExportCSV={handleExport}
                                    reportSlug={getReportExportMode('mis-agewise-arrear') === 'REQUEST_QUEUE' ? 'mis-agewise-arrear' : undefined}
                                    canExport={canExportReport('mis-agewise-arrear')}
                                    onExportWord={handleExportWord}
                                    exportParams={{
                                        fromDate: submittedReportDate,
                                        toDate: submittedReportDate,
                                        branchIds: branchFilter === 'ALL' ? 'ALL' : [branchFilter],
                                        filters: {
                                            // Required by fetchMisAgewiseArrear (report-registry.ts) — always
                                            // DETAILEDWISE now that the type selector is removed. Do not drop.
                                            reportType,
                                            ...(centerFilter !== 'ALL' ? { centerId: centerFilter } : {}),
                                            ...(fdoFilter !== 'ALL' ? { fdoId: fdoFilter } : {}),
                                        },
                                    }}
                                    className="border-emerald-400/50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                                />
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            </div>
                        </div>

                        {/* Branch Filter (ADMIN / SUBADMIN / AREA_MANAGER only) */}
                        {canFilterByBranch && (
                            <div className="space-y-2">
                                <Label htmlFor="branchFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Branch
                                </Label>
                                <Select
                                    value={branchFilter}
                                    onValueChange={(v) => { setBranchFilter(v); setCenterFilter('ALL'); }}
                                    disabled={isLoading}
                                >
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

                        {/* Center Filter (ADMIN / SUBADMIN / AREA_MANAGER only) */}
                        {canFilterByBranch && (
                            <div className="space-y-2">
                                <Label htmlFor="centerFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Center
                                </Label>
                                <Select value={centerFilter} onValueChange={setCenterFilter} disabled={isLoading}>
                                    <SelectTrigger id="centerFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                        <SelectValue placeholder="All Centers" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Centers</SelectItem>
                                        {filteredCenters.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* FDO Filter */}
                        <div className="space-y-2">
                            <Label htmlFor="fdoFilter" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                FDO
                            </Label>
                            <Select value={fdoFilter} onValueChange={setFdoFilter} disabled={isLoading}>
                                <SelectTrigger id="fdoFilter" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                    <SelectValue placeholder="All FDOs" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All FDOs</SelectItem>
                                    {officers.map((o) => (
                                        <SelectItem key={o.id} value={o.id}>
                                            {o.employeeId ? `${o.employeeId} — ${o.name}` : o.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Search (filters the loaded rows — client/member details incl. member & loan id) */}
                        <div className="space-y-2">
                            <Label htmlFor="tableSearch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Search
                            </Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <Input
                                    id="tableSearch"
                                    type="text"
                                    value={tableSearchQuery}
                                    onChange={(e) => setTableSearchQuery(e.target.value)}
                                    placeholder="Name / phone / member id..."
                                    className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                    disabled={data.length === 0}
                                />
                            </div>
                        </div>

                        {/* Show Button */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
                            <Button
                                onClick={fetchData}
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
                                        <FileText className="h-4 w-4 mr-2" />
                                        Show
                                    </>
                                )}
                            </Button>
                        </div>

                        {/* Reset Button */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Action</Label>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="h-11 w-full border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
                                disabled={isLoading}
                            >
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Reset
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Loading State */}
            {isLoading && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <PageLoader label="Generating the arrear report, please wait..." fullScreen={false} />
                </Card>
            )}

            {/* Pre-fetch State */}
            {!isLoading && !showReport && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green-tint/80 dark:bg-brand-green-darker/30">
                            <FileText className="h-8 w-8 text-primary" />
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">
                                Select parameters and click &quot;Show&quot;
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                Choose a report date to generate the arrear report
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* No Results State */}
            {!isLoading && showReport && data.length === 0 && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100/80 dark:bg-emerald-900/30">
                            <SearchX className="h-8 w-8 text-emerald-500" />
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">No arrears found</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                No overdue loan schedules found as of the selected date. This is good news!
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Arrear Report Table */}
            {!isLoading && showReport && data.length > 0 && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                    <div ref={printRef} className="print:p-8">
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker print:bg-white">
                            <ReportHeader
                                title="Arrear Report — Detailed"
                                subtitle={`Report Date: ${formatDateForDisplay(submittedReportDate)}`}
                            />
                            <div className="flex flex-wrap items-center justify-end gap-4">
                                <Badge variant="outline" className="text-sm px-3 py-1">
                                    {searchedRows.length} Records
                                </Badge>
                            </div>
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table className="min-w-[3200px]">
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-sidebar-accent to-primary dark:from-sidebar-accent dark:to-primary hover:from-sidebar-accent hover:to-primary">
                                            {renderTableHeaders()}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {renderTableRows()}
                                        {renderGrandTotalRow()}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                                    <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Showing {startIndex + 1} to {Math.min(endIndex, searchedRows.length)} of {searchedRows.length} records
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="border-primary/50 text-sidebar-accent hover:bg-green-50"
                                        >
                                            <ChevronLeft className="h-4 w-4 mr-1" />
                                            Previous
                                        </Button>
                                        <div className="flex items-center gap-1">
                                            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                                                let page: number;
                                                if (totalPages <= 10) {
                                                    page = i + 1;
                                                } else if (currentPage <= 5) {
                                                    page = i + 1;
                                                } else if (currentPage >= totalPages - 4) {
                                                    page = totalPages - 9 + i;
                                                } else {
                                                    page = currentPage - 4 + i;
                                                }
                                                return (
                                                    <Button
                                                        key={page}
                                                        variant={currentPage === page ? 'default' : 'outline'}
                                                        size="sm"
                                                        onClick={() => setCurrentPage(page)}
                                                        className={cn(
                                                            'w-8 h-8 p-0',
                                                            currentPage === page
                                                                ? 'bg-primary text-white hover:bg-primary'
                                                                : 'border-primary/50 text-sidebar-accent hover:bg-green-50'
                                                        )}
                                                    >
                                                        {page}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            className="border-primary/50 text-sidebar-accent hover:bg-green-50"
                                        >
                                            Next
                                            <ChevronRight className="h-4 w-4 ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </div>
                </Card>
            )}

            {/* Footer Info */}
            {showReport && data.length > 0 && (
                <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400 print:hidden">
                    <p>
                        Report generated on {toDisplayDateTime(new Date())}
                    </p>
                    <p>{`${data.length} loans in arrear`}</p>
                </div>
            )}

            {/* Print Styles */}
            <style jsx global>{`
                @media print {
                    body * { visibility: hidden; }
                    .print\\:p-8, .print\\:p-8 * { visibility: visible; }
                    .print\\:p-8 { position: absolute; left: 0; top: 0; width: 100%; }
                    @page { margin: 1cm; size: landscape; }
                }
            `}</style>
        </div>
    );
}
