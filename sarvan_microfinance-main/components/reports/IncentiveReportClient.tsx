'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import {
    Loader2,
    Search,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RotateCcw,
    FileText,
    FileSpreadsheet,
    FileType,
    FileOutput,
    Wallet,
} from 'lucide-react';
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { formatReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Division { id: string; name: string; }
interface Area { id: string; name: string; }
interface Branch { id: string; name: string; code: string; areas: { id: string }[]; }
interface Officer { id: string; employeeId: string | null; name: string; }

interface IncentiveReportRow {
    fdoId: string;
    division: string;
    branch: string;
    dateOfJoining: string | null;
    employeeId: string | null;
    staffName: string;
    fieldOfficerCategory: string | null;
    activeClients: number;
    goldLoanTarget: number;
    goldLoanAchievedMembers: number;
    goldLoanDisbursementAmount: number;
    achievementPercent: number;
    eligibleIncentive: number;
    goldWeightSlab1: number;
    goldWeightSlab2: number;
    goldWeightSlab3: number;
    goldWeightIncentive: number;
    jlgLoanMembers: number;
    jlgLoanDisbursement: number;
    jlgIncentive: number;
    totalDemand: number;
    demandCollection: number;
    arrearCollection: number;
    totalCollection: number;
    recoveryPercent: number;
    collectionIncentive: number;
    odCollection31to60: number;
    odCollection61to90: number;
    odCollection91to180: number;
    odCollectionAbove180: number;
    odCollectionIncentive: number;
    finalIncentive: number;
}

interface ApiResult {
    data: IncentiveReportRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    summary: { fdoCount: number; totalFinalIncentive: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayIst = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
    return ist.toISOString().split('T')[0];
};

const firstOfMonthIst = () => {
    const t = todayIst();
    return `${t.slice(0, 7)}-01`;
};

const fmtAmt = (n: number) => formatReportAmount(n);

const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const toVal = (v: string) => (v === 'all' ? '' : v);
const fromVal = (v: string) => (v === '' ? 'all' : v);

// ─── Column groups — mirrors the Excel sheet's banded sections ────────────────
// Colors drawn from the app's validated CVD-safe categorical set, used as light
// washes (not solid fills) so ink stays dark/readable in both themes.

type GroupId = 'officer' | 'active' | 'gold' | 'jlg' | 'collection' | 'od' | 'final';

const COLUMN_GROUPS: Record<GroupId, { label: string; headerBg: string; headerText: string; cellBg: string }> = {
    officer: {
        label: 'FIELD OFFICER',
        headerBg: 'bg-slate-500/12 dark:bg-slate-400/20',
        headerText: 'text-slate-700 dark:text-slate-200',
        cellBg: '',
    },
    active: {
        label: 'ACTIVE MEMBERS',
        headerBg: 'bg-[#2a78d6]/18 dark:bg-[#3987e5]/25',
        headerText: 'text-[#1c4d8a] dark:text-[#9cc4f2]',
        cellBg: 'bg-[#2a78d6]/[0.05] dark:bg-[#3987e5]/[0.10]',
    },
    gold: {
        label: 'GOLD LOAN',
        headerBg: 'bg-brand-yellow-dark/20 dark:bg-brand-yellow-dark/28',
        headerText: 'text-[#7a5400] dark:text-[#ffd77a]',
        cellBg: 'bg-brand-yellow-dark/[0.06] dark:bg-brand-yellow-dark/[0.12]',
    },
    jlg: {
        label: 'JLG LOAN',
        headerBg: 'bg-primary/18 dark:bg-primary/26',
        headerText: 'text-[#0d6b4a] dark:text-[#7fe0bd]',
        cellBg: 'bg-primary/[0.06] dark:bg-primary/[0.12]',
    },
    collection: {
        label: 'COLLECTION INCENTIVE',
        headerBg: 'bg-primary/14 dark:bg-primary/24',
        headerText: 'text-[#005c00] dark:text-[#8fe08f]',
        cellBg: 'bg-primary/[0.05] dark:bg-primary/[0.10]',
    },
    od: {
        label: 'OD COLLECTION',
        headerBg: 'bg-[#eb6834]/18 dark:bg-[#d95926]/26',
        headerText: 'text-[#8a3d1a] dark:text-[#ffb08a]',
        cellBg: 'bg-[#eb6834]/[0.06] dark:bg-[#d95926]/[0.12]',
    },
    final: {
        label: 'FINAL WORKINGS',
        headerBg: 'bg-[#4a3aa7]/18 dark:bg-[#9085e9]/26',
        headerText: 'text-[#2e2266] dark:text-[#c8c2f5]',
        cellBg: 'bg-[#4a3aa7]/[0.06] dark:bg-[#9085e9]/[0.12]',
    },
};

// PDF fill colors (RGB tuples) per group — used for the 2-row autoTable header.
const PDF_GROUP_FILL: Record<GroupId, [number, number, number]> = {
    officer: [100, 116, 139],
    active: [42, 120, 214],
    gold: [237, 161, 0],
    jlg: [27, 175, 122],
    collection: [0, 131, 0],
    od: [235, 104, 52],
    final: [74, 58, 167],
};

type ColDef = {
    key: keyof IncentiveReportRow;
    header: string;
    group: GroupId;
    align: 'left' | 'right' | 'center';
    cellClassName?: string;
    render: (r: IncentiveReportRow) => string | number;
};

const COLUMNS: ColDef[] = [
    { key: 'division', header: 'Division', group: 'officer', align: 'left', cellClassName: 'whitespace-nowrap', render: (r) => r.division || '—' },
    { key: 'branch', header: 'Branch', group: 'officer', align: 'left', cellClassName: 'whitespace-nowrap', render: (r) => r.branch || '—' },
    { key: 'dateOfJoining', header: 'DOJ', group: 'officer', align: 'left', cellClassName: 'whitespace-nowrap', render: (r) => fmtDate(r.dateOfJoining) },
    { key: 'employeeId', header: 'Emp ID', group: 'officer', align: 'left', cellClassName: 'font-mono', render: (r) => r.employeeId ?? '—' },
    { key: 'staffName', header: 'Staff Name', group: 'officer', align: 'left', cellClassName: 'whitespace-nowrap', render: (r) => r.staffName },
    { key: 'fieldOfficerCategory', header: 'Category', group: 'officer', align: 'center', render: (r) => r.fieldOfficerCategory ?? '—' },

    { key: 'activeClients', header: 'Active Clients', group: 'active', align: 'right', render: (r) => r.activeClients },

    { key: 'goldLoanTarget', header: 'Gold Target', group: 'gold', align: 'right', render: (r) => r.goldLoanTarget },
    { key: 'goldLoanAchievedMembers', header: 'Gold Achieved', group: 'gold', align: 'right', render: (r) => r.goldLoanAchievedMembers },
    { key: 'goldLoanDisbursementAmount', header: 'Gold Disb. Amt', group: 'gold', align: 'right', render: (r) => fmtAmt(r.goldLoanDisbursementAmount) },
    { key: 'achievementPercent', header: 'Achv %', group: 'gold', align: 'right', render: (r) => `${r.achievementPercent}%` },
    { key: 'eligibleIncentive', header: 'Eligible Incentive', group: 'gold', align: 'right', cellClassName: 'font-medium', render: (r) => fmtAmt(r.eligibleIncentive) },
    { key: 'goldWeightSlab1', header: 'Wt 0.500-0.640', group: 'gold', align: 'right', render: (r) => fmtAmt(r.goldWeightSlab1) },
    { key: 'goldWeightSlab2', header: 'Wt 0.990-1.030', group: 'gold', align: 'right', render: (r) => fmtAmt(r.goldWeightSlab2) },
    { key: 'goldWeightSlab3', header: 'Wt 1.050-2.020', group: 'gold', align: 'right', render: (r) => fmtAmt(r.goldWeightSlab3) },
    { key: 'goldWeightIncentive', header: 'Weight Incentive', group: 'gold', align: 'right', cellClassName: 'font-medium', render: (r) => fmtAmt(r.goldWeightIncentive) },

    { key: 'jlgLoanMembers', header: 'JLG Members', group: 'jlg', align: 'right', render: (r) => r.jlgLoanMembers },
    { key: 'jlgLoanDisbursement', header: 'JLG Disb. Amt', group: 'jlg', align: 'right', render: (r) => fmtAmt(r.jlgLoanDisbursement) },
    { key: 'jlgIncentive', header: 'IGP Incentive', group: 'jlg', align: 'right', cellClassName: 'font-medium', render: (r) => fmtAmt(r.jlgIncentive) },

    { key: 'totalDemand', header: 'Total Demand', group: 'collection', align: 'right', render: (r) => fmtAmt(r.totalDemand) },
    { key: 'demandCollection', header: 'Demand Coll.', group: 'collection', align: 'right', render: (r) => fmtAmt(r.demandCollection) },
    { key: 'arrearCollection', header: 'Arrear Coll.', group: 'collection', align: 'right', render: (r) => fmtAmt(r.arrearCollection) },
    { key: 'totalCollection', header: 'Total Coll.', group: 'collection', align: 'right', render: (r) => fmtAmt(r.totalCollection) },
    { key: 'recoveryPercent', header: 'Recovery %', group: 'collection', align: 'right', render: (r) => `${r.recoveryPercent}%` },
    { key: 'collectionIncentive', header: 'Collection Incentive', group: 'collection', align: 'right', cellClassName: 'font-medium', render: (r) => fmtAmt(r.collectionIncentive) },

    { key: 'odCollection31to60', header: 'OD 31-60', group: 'od', align: 'right', render: (r) => fmtAmt(r.odCollection31to60) },
    { key: 'odCollection61to90', header: 'OD 61-90', group: 'od', align: 'right', render: (r) => fmtAmt(r.odCollection61to90) },
    { key: 'odCollection91to180', header: 'OD 91-180', group: 'od', align: 'right', render: (r) => fmtAmt(r.odCollection91to180) },
    { key: 'odCollectionAbove180', header: 'OD >180', group: 'od', align: 'right', render: (r) => fmtAmt(r.odCollectionAbove180) },
    { key: 'odCollectionIncentive', header: 'OD Incentive', group: 'od', align: 'right', cellClassName: 'font-medium', render: (r) => fmtAmt(r.odCollectionIncentive) },

    { key: 'finalIncentive', header: 'Final Incentive', group: 'final', align: 'right', cellClassName: 'font-bold text-foreground dark:text-primary', render: (r) => fmtAmt(r.finalIncentive) },
];

// Consecutive-run header groups, in column order (for the top banded header row / exports).
const HEADER_GROUP_RUNS: { group: GroupId; span: number }[] = (() => {
    const runs: { group: GroupId; span: number }[] = [];
    for (const col of COLUMNS) {
        const last = runs[runs.length - 1];
        if (last && last.group === col.group) last.span++;
        else runs.push({ group: col.group, span: 1 });
    }
    return runs;
})();

const alignClass = (a: ColDef['align']) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

// ─── Component ────────────────────────────────────────────────────────────────

export function IncentiveReportClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    const [divisions, setDivisions] = useState<Division[]>([]);
    const [allBranches, setAllBranches] = useState<Branch[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [officers, setOfficers] = useState<Officer[]>([]);

    const [selectedDivision, setSelectedDivision] = useState('');
    const [selectedBranch, setSelectedBranch] = useState('');
    const [selectedFdo, setSelectedFdo] = useState('');

    const [fromDate, setFromDate] = useState(firstOfMonthIst());
    const [toDate, setToDate] = useState(todayIst());
    // Submitted (applied) date snapshot — frozen until the next Show click, so pagination,
    // sorting, the search-box resubmit, and exports keep using the last-submitted range even
    // if fromDate/toDate above are edited afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);

    const [reportData, setReportData] = useState<IncentiveReportRow[]>([]);
    const [summary, setSummary] = useState({ fdoCount: 0, totalFinalIncentive: 0 });
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<string | undefined>();
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const PAGE_SIZE = 20;

    // ── On mount: load dropdown sources ──
    useEffect(() => {
        apiClient.get<Division[]>('/divisions').then((res) => {
            if (res.success && res.data) setDivisions(res.data);
        });
        apiClient.get<Branch[]>('/branches').then((res) => {
            if (res.success && res.data) {
                setAllBranches(res.data);
                setBranches(res.data);
            }
        });
        apiClient.get<Officer[]>('/reports/employee/incentive-report/officers').then((res) => {
            if (res.success && res.data) setOfficers(res.data);
        });
    }, []);

    const handleDivisionChange = async (raw: string) => {
        const divisionId = toVal(raw);
        setSelectedDivision(divisionId);
        setSelectedBranch('');

        if (!divisionId) {
            setBranches(allBranches);
            return;
        }
        const res = await apiClient.get<Area[]>(`/areas?divisionId=${divisionId}`);
        if (res.success && res.data) {
            const areaIds = new Set(res.data.map((a) => a.id));
            setBranches(allBranches.filter((b) => b.areas.some((a) => areaIds.has(a.id))));
        }
    };

    // ── Build query params ──
    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the same
    // click — reading submittedFromDate/submittedToDate here would otherwise use the pre-update
    // (stale) state, since the setSubmitted* calls in handleShow haven't re-rendered yet.
    // Callers other than handleShow (pagination, sorting, handleSearchSubmit, export) omit it
    // and get the last-submitted snapshot, which is the frozen-until-next-Show behavior they need.
    const buildParams = useCallback(
        (overrides: Record<string, string> = {}, dateOverride?: { fromDate: string; toDate: string }) => {
            const params = new URLSearchParams({ ...overrides });
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effToDate = dateOverride?.toDate ?? submittedToDate;
            params.set('fromDate', effFromDate);
            params.set('toDate', effToDate);
            if (selectedDivision) params.set('divisionId', selectedDivision);
            if (selectedBranch) params.set('branchId', selectedBranch);
            if (selectedFdo) params.set('fdoId', selectedFdo);
            if (searchQuery.trim()) params.set('search', searchQuery.trim());
            if (sortBy) {
                params.set('sortBy', sortBy);
                params.set('sortOrder', sortOrder);
            }
            return params;
        },
        [submittedFromDate, submittedToDate, selectedDivision, selectedBranch, selectedFdo, searchQuery, sortBy, sortOrder]
    );

    // ── Fetch page ──
    const fetchReport = useCallback(
        async (page: number, dateOverride?: { fromDate: string; toDate: string }) => {
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effToDate = dateOverride?.toDate ?? submittedToDate;
            if (!effFromDate || !effToDate) {
                toast({ title: 'Date Range Required', description: 'Please select From Date and To Date.', variant: 'destructive' });
                return;
            }
            if (effFromDate > effToDate) {
                toast({ title: 'Invalid Date Range', description: 'From Date cannot be after To Date.', variant: 'destructive' });
                return;
            }

            setIsLoading(true);
            try {
                const params = buildParams({ page: String(page), pageSize: String(PAGE_SIZE) }, dateOverride);
                const res = await apiClient.get<ApiResult>(`/reports/employee/incentive-report?${params}`);

                if (res.success && res.data) {
                    setReportData(res.data.data);
                    setSummary(res.data.summary);
                    setTotalRecords(res.data.total);
                    setTotalPages(res.data.totalPages);
                    setCurrentPage(page);
                    setShowReport(true);
                    if (page === 1) {
                        toast({ title: 'Report Loaded', description: `${res.data.total} field officer(s) found.` });
                    }
                } else {
                    toast({ title: 'No Data', description: res.error || 'No records found.', variant: 'destructive' });
                    setReportData([]);
                    setTotalRecords(0);
                    setTotalPages(0);
                    setShowReport(true);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to fetch incentive report.', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        },
        [buildParams, submittedFromDate, submittedToDate, toast]
    );

    const handleShow = () => {
        const snapshot = { fromDate, toDate };
        setSubmittedFromDate(fromDate);
        setSubmittedToDate(toDate);
        fetchReport(1, snapshot);
    };
    const handleSearchSubmit = () => { if (showReport) fetchReport(1); };

    const handleSort = (column: string) => {
        if (sortBy === column) {
            setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortBy(column);
            setSortOrder('asc');
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when sort changes, not on every fetchReport identity change
    useEffect(() => { if (showReport) fetchReport(1); }, [sortBy, sortOrder]);

    const handleReset = () => {
        setSelectedDivision('');
        setSelectedBranch('');
        setSelectedFdo('');
        setBranches(allBranches);
        setFromDate(firstOfMonthIst());
        setToDate(todayIst());
        setSubmittedFromDate(firstOfMonthIst());
        setSubmittedToDate(todayIst());
        setReportData([]);
        setShowReport(false);
        setSearchQuery('');
        setSortBy(undefined);
        setCurrentPage(1);
        setTotalRecords(0);
        setTotalPages(0);
    };

    // ── Fetch all for export ──
    const fetchAllForExport = useCallback(async (): Promise<IncentiveReportRow[] | null> => {
        setIsExporting(true);
        try {
            const params = buildParams({ exportAll: 'true' });
            const res = await apiClient.get<ApiResult>(`/reports/employee/incentive-report?${params}`);
            if (res.success && res.data) return res.data.data;
            toast({ title: 'Export Error', description: 'Failed to fetch all data for export.', variant: 'destructive' });
            return null;
        } catch {
            toast({ title: 'Export Error', description: 'Failed to fetch all data for export.', variant: 'destructive' });
            return null;
        } finally {
            setIsExporting(false);
        }
    }, [buildParams, toast]);

    const handleExportExcel = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;

        // Built by hand (title rows + banded group row + column-header row + data) instead of
        // buildReportSheet/sheet_add_json, so every row index is exact — needed to merge the
        // group-label row cleanly above the column headers. Mirrors the Excel sheet's ACTIVE
        // MEMBERS / GOLD Loan / JLG Loan / COLLECTION INCENTIVE / OD COLLECTION / Final Workings
        // banding. Note: the free `xlsx` build here can't apply cell fill colors, so this row
        // carries the section labels/structure without the color banding (colors are on-screen + PDF).
        const groupRow: string[] = [];
        let colCursor = 0;
        const merges: XLSX.Range[] = [];
        for (const run of HEADER_GROUP_RUNS) {
            groupRow[colCursor] = COLUMN_GROUPS[run.group].label;
            for (let i = 1; i < run.span; i++) groupRow[colCursor + i] = '';
            if (run.span > 1) {
                merges.push({ s: { r: 3, c: colCursor }, e: { r: 3, c: colCursor + run.span - 1 } });
            }
            colCursor += run.span;
        }

        const titleRows = reportHeaderRows('Incentive Report'); // 3 rows: trust name, title, blank
        const columnHeaderRow = COLUMNS.map((c) => c.header);
        const dataRows = allData.map((r) => COLUMNS.map((c) => c.render(r)));

        const ws = XLSX.utils.aoa_to_sheet([...titleRows, groupRow, columnHeaderRow, ...dataRows]);
        ws['!merges'] = merges;
        autoSizeColumns(ws);
        applyExcelReportFont(ws);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Incentive Report');
        XLSX.writeFile(wb, `Incentive_Report_${submittedFromDate}_${submittedToDate}.xlsx`);
        toast({ title: 'Excel Exported', description: `${allData.length} record(s) downloaded.` });
    };

    const handleExportPDF = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;

        const { jsPDF } = await import('jspdf');
        const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
        const { drawIncentiveReport } = await import('@/app/lib/reports/incentive-report-pdf');

        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(pdf);
        await drawIncentiveReport(
            pdf,
            allData,
            { fromDate: submittedFromDate, toDate: submittedToDate, fieldOfficerCount: allData.length, totalFinalIncentive: summary.totalFinalIncentive },
            reportFont
        );

        pdf.save(`Incentive_Report_${submittedFromDate}_${submittedToDate}.pdf`);
        toast({ title: 'PDF Exported', description: `${allData.length} record(s) downloaded.` });
    };

    // ── CSV / Word export — COLUMNS is already a reusable module-level array with
    // the exact same header/render mapping used by handleExportExcel and
    // handleExportPDF above, so no extra helper is needed here. ────────────────

    const handleExportCSV = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const headers = COLUMNS.map((c) => c.header);
        const rows = allData.map((r) => COLUMNS.map((c) => c.render(r)));
        exportToCSV(`Incentive_Report_${submittedFromDate}_${submittedToDate}`, 'INCENTIVE REPORT', headers, rows);
        toast({ title: 'CSV Exported', description: `${allData.length} record(s) downloaded.` });
    };

    // Word-only presentation: same rows as CSV above, but the grouped header (banner +
    // per-column labels) is derived directly from the same COLUMNS / HEADER_GROUP_RUNS /
    // COLUMN_GROUPS metadata already used to build the on-screen table and the PDF's own
    // 2-row grouped header — no separate hardcoded column list to keep in sync. Single-
    // column groups (Active Clients, Final Incentive) use their own specific header
    // rather than the group banner. No totals row exists in this report. At 31 columns
    // this needs A3 landscape.
    const buildIncentiveWordOptions = (): WordExportOptions => {
        const groupHeaders: { label: string; span: number }[] = [];
        const subHeaders: string[] = [];
        let colCursor = 0;
        for (const run of HEADER_GROUP_RUNS) {
            if (run.span > 1) {
                groupHeaders.push({ label: COLUMN_GROUPS[run.group].label, span: run.span });
                for (let i = 0; i < run.span; i++) subHeaders.push(COLUMNS[colCursor + i].header);
            } else {
                groupHeaders.push({ label: COLUMNS[colCursor].header, span: 1 });
            }
            colCursor += run.span;
        }
        return {
            groupHeaders,
            subHeaders,
            columnAlignments: COLUMNS.map((c) => c.align),
            columnWidthWeights: COLUMNS.map((c) => (c.align === 'left' ? 10 : 7)),
            pageSize: { widthMm: 297, heightMm: 420 },
        };
    };

    const handleExportWord = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const headers = COLUMNS.map((c) => c.header);
        const rows = allData.map((r) => COLUMNS.map((c) => c.render(r)));
        await exportToWord(`Incentive_Report_${submittedFromDate}_${submittedToDate}`, 'INCENTIVE REPORT', headers, rows, buildIncentiveWordOptions());
        toast({ title: 'Word Exported', description: `${allData.length} record(s) downloaded.` });
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20">
                    <Wallet className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-primary">Incentive Report</h1>
                    <p className="text-sm text-muted-foreground">
                        Month-wise Field Officer incentive calculation — Gold, JLG, Collection &amp; OD
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-sidebar-accent dark:text-primary uppercase tracking-wide">Filters</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">From Date <span className="text-red-500">*</span></Label>
                        <DateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 border-primary/30 focus:border-primary" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">To Date <span className="text-red-500">*</span></Label>
                        <DateInput value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 border-primary/30 focus:border-primary" />
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Division</Label>
                        <Select value={fromVal(selectedDivision)} onValueChange={handleDivisionChange}>
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary"><SelectValue placeholder="-- All Divisions --" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Divisions --</SelectItem>
                                {divisions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Branch</Label>
                        <Select value={fromVal(selectedBranch)} onValueChange={(raw) => setSelectedBranch(toVal(raw))}>
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary"><SelectValue placeholder="-- All Branches --" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Branches --</SelectItem>
                                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Field Officer</Label>
                        <Select value={fromVal(selectedFdo)} onValueChange={(raw) => setSelectedFdo(toVal(raw))}>
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary"><SelectValue placeholder="-- All Field Officers --" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Field Officers --</SelectItem>
                                {officers.map((o) => <SelectItem key={o.id} value={o.id}>{o.employeeId ? `${o.employeeId} — ${o.name}` : o.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button onClick={handleShow} disabled={isLoading || isExporting} className="bg-primary hover:bg-sidebar-accent text-white h-9">
                        {isLoading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...</>) : 'Show Report'}
                    </Button>
                    <Button variant="outline" onClick={handleReset} disabled={isLoading || isExporting} className="h-9 border-primary/30 text-sidebar-accent">
                        <RotateCcw className="h-4 w-4 mr-1" /> Reset
                    </Button>
                    {showReport && reportData.length > 0 && (
                        <>
                            <ExportDropdown
                                onExportPDF={!isLoading && !isExporting ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && !isExporting ? handleExportExcel : undefined}
                                onExportCSV={!isLoading && !isExporting ? handleExportCSV : undefined}
                                onExportWord={!isLoading && !isExporting ? handleExportWord : undefined}
                                reportSlug={getReportExportMode('incentive-report') === 'REQUEST_QUEUE' ? 'incentive-report' : undefined}
                                canExport={canExportReport('incentive-report')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedToDate,
                                    branchIds: selectedBranch ? [selectedBranch] : 'ALL',
                                    filters: selectedFdo ? { fdoId: selectedFdo } : null,
                                }}
                                className="h-9 border-primary/30 text-sidebar-accent"
                            />
                        </>
                    )}
                </div>
            </div>

            {/* Summary cards */}
            {showReport && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl p-4 shadow-sm">
                        <p className="text-xs text-muted-foreground">Field Officers</p>
                        <p className="text-2xl font-bold text-foreground dark:text-primary">{summary.fdoCount}</p>
                    </div>
                    <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl p-4 shadow-sm">
                        <p className="text-xs text-muted-foreground">Total Final Incentive</p>
                        <p className="text-2xl font-bold text-foreground dark:text-primary">₹{fmtAmt(summary.totalFinalIncentive)}</p>
                    </div>
                </div>
            )}

            {/* Legend */}
            {showReport && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                    {(Object.keys(COLUMN_GROUPS) as GroupId[]).filter((g) => g !== 'officer').map((g) => (
                        <span key={g} className="flex items-center gap-1.5">
                            <span className={`h-2.5 w-2.5 rounded-sm ${COLUMN_GROUPS[g].headerBg}`} />
                            <span className="text-muted-foreground">{COLUMN_GROUPS[g].label}</span>
                        </span>
                    ))}
                </div>
            )}

            {/* Report Table */}
            {showReport && (
                <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
                        <div className="text-sm text-muted-foreground">
                            Page <span className="font-semibold text-sidebar-accent">{currentPage}</span> of{' '}
                            <span className="font-semibold text-sidebar-accent">{totalPages}</span> — {totalRecords} field officer(s)
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative w-64">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search name / employee ID…"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
                                    className="pl-8 h-8 text-sm border-primary/30"
                                />
                            </div>
                            <Button size="sm" variant="outline" onClick={handleSearchSubmit} disabled={isLoading} className="h-8 border-primary/30 text-sidebar-accent">
                                <Search className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 z-10">
                                {/* Banded group row — like the Excel sheet's ACTIVE MEMBERS / GOLD Loan / JLG Loan / … */}
                                <tr>
                                    {HEADER_GROUP_RUNS.map((run, i) => {
                                        const g = COLUMN_GROUPS[run.group];
                                        return (
                                            <th
                                                key={`${run.group}-${i}`}
                                                colSpan={run.span}
                                                className={`px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide border-b border-black/5 dark:border-white/10 ${g.headerBg} ${g.headerText}`}
                                            >
                                                {g.label}
                                            </th>
                                        );
                                    })}
                                </tr>
                                {/* Column labels row */}
                                <tr>
                                    {COLUMNS.map((c) => {
                                        const g = COLUMN_GROUPS[c.group];
                                        return (
                                            <th
                                                key={c.key}
                                                onClick={() => handleSort(c.key)}
                                                className={`whitespace-nowrap px-2 py-2 font-semibold border-b-2 border-primary/20 cursor-pointer select-none hover:brightness-95 ${alignClass(c.align)} ${g.headerBg} ${g.headerText}`}
                                            >
                                                {c.header}{sortBy === c.key ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((r, i) => (
                                    <tr
                                        key={r.fdoId}
                                        className={`border-b border-primary/10 hover:brightness-[0.98] ${i % 2 === 0 ? '' : 'bg-black/[0.015] dark:bg-white/[0.02]'}`}
                                    >
                                        {COLUMNS.map((c) => (
                                            <td
                                                key={c.key}
                                                className={`px-2 py-1.5 ${alignClass(c.align)} ${COLUMN_GROUPS[c.group].cellBg} ${c.cellClassName ?? ''}`}
                                            >
                                                {c.render(r)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {reportData.length === 0 && (
                            <div className="py-12 text-center text-muted-foreground text-sm">No records found for the selected filters.</div>
                        )}
                    </div>

                    <div className="flex items-center justify-between px-4 py-3 border-t border-primary/10">
                        <span className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</span>
                        <div className="flex items-center gap-1">
                            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => fetchReport(1)} disabled={currentPage === 1 || isLoading}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
                            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => fetchReport(currentPage - 1)} disabled={currentPage === 1 || isLoading}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                            <span className="px-2 text-xs font-medium">{currentPage}</span>
                            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => fetchReport(currentPage + 1)} disabled={currentPage === totalPages || isLoading}><ChevronRight className="h-3.5 w-3.5" /></Button>
                            <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => fetchReport(totalPages)} disabled={currentPage === totalPages || isLoading}><ChevronsRight className="h-3.5 w-3.5" /></Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
