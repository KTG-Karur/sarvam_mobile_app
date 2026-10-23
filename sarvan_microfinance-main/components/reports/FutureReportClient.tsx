'use client';

import * as XLSX from 'xlsx-js-style';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/hooks/use-toast';
import {
    Calendar,
    RefreshCw,
    Download,
    Loader2,
    ChevronLeft,
    ChevronRight,
    FileText,
    FileBarChart,
    FileType,
    FileOutput,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { Input } from '@/components/ui/input';
import { CO_APPLICANT_MOBILE_HEADER } from '@/app/lib/reports/member-contact-columns';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawFutureReport } from '@/app/lib/reports/future-report-pdf';
import { reportHeaderRows, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';

// ── Types ────────────────────────────────────────────────────────────────────

type Branch = { id: string; code: string; name: string };

type FutureReportRow = {
    sNo: number;
    branchId: string;
    branchName: string;
    centreId: string;
    centerName: string;
    fdoName: string;
    loanId: string;
    memberUniqueId: string;
    memberName: string;
    memberPhone: string;
    memberAadhar: string;
    meetupTime: string;
    disbursementDate: string;
    firstEmiDate: string;
    loanMaturityDate: string;
    loanAmount: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingTotal: number;
    dueDate: string;
    dueNo: string;
    duePrincipal: number;
    dueInterest: number;
    totalDueAmount: number;
    funderName: string;
    coApplicantMobile?: string;
};

type Totals = {
    loanAmount: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingTotal: number;
    duePrincipal: number;
    dueInterest: number;
    totalDueAmount: number;
};

type FutureReportResponse = {
    data: FutureReportRow[];
    totalCount: number;
    totalPages: number;
    page: number;
    pageSize: number;
    totals: Totals;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** IST today as yyyy-MM-dd */
const todayIst = (): string => {
    const now = new Date();
    const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
    return ist.toISOString().split('T')[0];
};

/** yyyy-MM-dd → DD/MM/YYYY */
const formatDate = (dateStr: string): string => {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

// Truncates (not rounds) to whole rupees, matches the project-wide report-amount convention.
const formatCurrency = formatReportAmount;

// ── Component ────────────────────────────────────────────────────────────────

export function FutureReportClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    const [fromDate, setFromDate] = useState(todayIst());
    const [toDate, setToDate] = useState(todayIst());
    // Submitted (applied) date snapshot — frozen until the next Show click, so pagination,
    // the displayed header/summary, and exports keep using the last-submitted range even if
    // fromDate/toDate above are edited afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
    const [selectedCenterId, setSelectedCenterId] = useState<string>('all');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);

    const filteredCenters = selectedBranchId === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranchId);

    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<FutureReportRow[]>([]);
    const [totals, setTotals] = useState<Totals | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    // Server-side: member name / ID / Aadhaar / mobile / co-applicant mobile.
    const [search, setSearch] = useState('');

    // Load branches + centers for filter dropdowns
    useEffect(() => {
        fetch('/api/branches?isActive=true')
            .then((r) => r.json())
            .then((res) => {
                const list: Branch[] = Array.isArray(res)
                    ? res
                    : Array.isArray(res?.data)
                    ? res.data
                    : [];
                setBranches(list);
            })
            .catch(() => {
                // branch list is optional — swallow silently
            });

        getCentersForDropdown()
            .then(setCenters)
            .catch(() => {
                // center list is optional — swallow silently
            });
    }, []);

    // ── Fetch ─────────────────────────────────────────────────────────────────

    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the same
    // click — reading submittedFromDate/submittedToDate here would otherwise use the pre-update
    // (stale) state, since the setSubmitted* calls in handleShow haven't re-rendered yet.
    // Callers other than handleShow (pagination) omit it and get the last-submitted snapshot.
    const fetchPage = async (page: number, dateOverride?: { fromDate: string; toDate: string }) => {
        setIsLoading(true);
        try {
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effToDate = dateOverride?.toDate ?? submittedToDate;
            const params = new URLSearchParams({
                fromDate: effFromDate,
                toDate: effToDate,
                page: page.toString(),
                pageSize: '20',
            });
            if (search.trim()) params.set('search', search.trim());
            if (selectedBranchId && selectedBranchId !== 'all') {
                params.set('branchId', selectedBranchId);
            }
            if (selectedCenterId && selectedCenterId !== 'all') {
                params.set('centerId', selectedCenterId);
            }

            const res = await fetch(`/api/reports/future-report?${params}`);
            if (!res.ok) throw new Error('Failed to fetch');

            const result: FutureReportResponse = await res.json();
            setData(result.data);
            setTotals(result.totals);
            setCurrentPage(result.page);
            setTotalPages(result.totalPages);
            setTotalCount(result.totalCount);
            setShowReport(true);

            if (page === 1) {
                toast({
                    title: 'Report generated',
                    description: `Found ${result.totalCount} record(s).`,
                });
            }
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to load Future Report data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // ── Actions ───────────────────────────────────────────────────────────────

    const handleShow = () => {
        if (!fromDate || !toDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both From Date and To Date.',
                variant: 'destructive',
            });
            return;
        }
        if (fromDate > toDate) {
            toast({
                title: 'Invalid date range',
                description: 'From Date cannot be after To Date.',
                variant: 'destructive',
            });
            return;
        }
        const snapshot = { fromDate, toDate };
        setSubmittedFromDate(fromDate);
        setSubmittedToDate(toDate);
        fetchPage(1, snapshot);
    };

    const handleReset = () => {
        setFromDate(todayIst());
        setToDate(todayIst());
        setSubmittedFromDate(todayIst());
        setSubmittedToDate(todayIst());
        setSelectedBranchId('all');
        setSelectedCenterId('all');
        setShowReport(false);
        setData([]);
        setTotals(null);
        setCurrentPage(1);
        setTotalPages(1);
        setTotalCount(0);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            fetchPage(newPage);
        }
    };

    const handleExport = async () => {
        if (!submittedFromDate || !submittedToDate) return;
        toast({
            title: 'Export started',
            description: 'Fetching all records…',
        });

        try {
            const params = new URLSearchParams({
                fromDate: submittedFromDate,
                toDate: submittedToDate,
                page: '1',
                pageSize: '1000000',
            });
            if (search.trim()) params.set('search', search.trim());
            if (selectedBranchId && selectedBranchId !== 'all') {
                params.set('branchId', selectedBranchId);
            }
            if (selectedCenterId && selectedCenterId !== 'all') {
                params.set('centerId', selectedCenterId);
            }

            const res = await fetch(`/api/reports/future-report?${params}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const result: FutureReportResponse = await res.json();
            const rows = result.data;

            // Build Excel rows
            const excelRows: (string | number)[][] = [];

            excelRows.push(...reportHeaderRows('Future Report'));
            excelRows.push([`From Date: ${formatDate(submittedFromDate)}`, `To Date: ${formatDate(submittedToDate)}`]);
            excelRows.push([]);

            excelRows.push([
                'S.No',
                'Branch ID',
                'Branch Name',
                'Centre ID',
                'Center Name',
                'FDO Name',
                'Loan ID',
                'Member Unique ID',
                'Member Name',
                'Member Phone',
                'Member Aadhar',
                'Meetup Time',
                'Disbursement Date',
                '1st EMI Date',
                'Loan Maturity Date',
                'Loan Amount',
                'Outstanding Principal',
                'Outstanding Interest',
                'Outstanding Total Amount',
                'Due Date',
                'Due No',
                'Due Principal',
                'Due Interest',
                'Total Due Amount',
                'Funder Name',
                CO_APPLICANT_MOBILE_HEADER,
            ]);

            rows.forEach((r) => {
                excelRows.push([
                    r.sNo,
                    r.branchId,
                    r.branchName,
                    r.centreId,
                    r.centerName,
                    r.fdoName,
                    r.loanId,
                    r.memberUniqueId,
                    r.memberName,
                    r.memberPhone,
                    r.memberAadhar,
                    r.meetupTime,
                    formatDate(r.disbursementDate),
                    formatDate(r.firstEmiDate),
                    formatDate(r.loanMaturityDate),
                    truncateReportAmount(r.loanAmount),
                    truncateReportAmount(r.outstandingPrincipal),
                    truncateReportAmount(r.outstandingInterest),
                    truncateReportAmount(r.outstandingTotal),
                    formatDate(r.dueDate),
                    r.dueNo,
                    truncateReportAmount(r.duePrincipal),
                    truncateReportAmount(r.dueInterest),
                    truncateReportAmount(r.totalDueAmount),
                    r.funderName,
                    r.coApplicantMobile || '-',
                ]);
            });

            // Totals row
            if (result.totals) {
                const t = result.totals;
                excelRows.push([
                    'TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
                    truncateReportAmount(t.loanAmount),
                    truncateReportAmount(t.outstandingPrincipal),
                    truncateReportAmount(t.outstandingInterest),
                    truncateReportAmount(t.outstandingTotal),
                    '', '',
                    truncateReportAmount(t.duePrincipal),
                    truncateReportAmount(t.dueInterest),
                    truncateReportAmount(t.totalDueAmount),
                    '',
                ]);
            }

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(excelRows);
            applyExcelReportFont(ws);

            // Column widths
            ws['!cols'] = [
                { wch: 5 },  // S.No
                { wch: 10 }, // Branch ID
                { wch: 18 }, // Branch Name
                { wch: 10 }, // Centre ID
                { wch: 22 }, // Center Name
                { wch: 22 }, // FDO Name
                { wch: 10 }, // Loan ID
                { wch: 16 }, // Member Unique ID
                { wch: 22 }, // Member Name
                { wch: 14 }, // Member Phone
                { wch: 16 }, // Member Aadhar
                { wch: 10 }, // Meetup Time
                { wch: 16 }, // Disbursement Date
                { wch: 14 }, // 1st EMI Date
                { wch: 16 }, // Loan Maturity Date
                { wch: 14 }, // Loan Amount
                { wch: 20 }, // O/S Principal
                { wch: 20 }, // O/S Interest
                { wch: 22 }, // O/S Total
                { wch: 12 }, // Due Date
                { wch: 10 }, // Due No
                { wch: 14 }, // Due Principal
                { wch: 14 }, // Due Interest
                { wch: 16 }, // Total Due
                { wch: 16 }, // Funder Name
                { wch: 18 }, // Co-Applicant Mobile
            ];

            XLSX.utils.book_append_sheet(wb, ws, 'Future Report');
            XLSX.writeFile(
                wb,
                `Future_Report_${submittedFromDate}_to_${submittedToDate}.xlsx`
            );

            toast({
                title: 'Export successful',
                description: 'The Excel file has been downloaded.',
            });
        } catch {
            toast({
                title: 'Export failed',
                description: 'Could not generate the Excel file.',
                variant: 'destructive',
            });
        }
    };

    // ── PDF / CSV / Word export — shared fetch+mapping helper mirrors the exact
    // same field set as handleExport above (kept separate so handleExport is left
    // untouched) ──────────────────────────────────────────────────────────────

    const fetchFutureReportExportRows = async (): Promise<{ headers: string[]; rows: (string | number)[][] } | null> => {
        const params = new URLSearchParams({
            fromDate: submittedFromDate,
            toDate: submittedToDate,
            page: '1',
            pageSize: '1000000',
        });
        if (selectedBranchId && selectedBranchId !== 'all') {
            params.set('branchId', selectedBranchId);
        }
        if (selectedCenterId && selectedCenterId !== 'all') {
            params.set('centerId', selectedCenterId);
        }

        const res = await fetch(`/api/reports/future-report?${params}`);
        if (!res.ok) return null;
        const result: FutureReportResponse = await res.json();

        const headers = [
            'S.No', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
            'FDO Name', 'Loan ID', 'Member Unique ID', 'Member Name', 'Member Phone',
            'Member Aadhar', 'Meetup Time', 'Disbursement Date', '1st EMI Date',
            'Loan Maturity Date', 'Loan Amount', 'Outstanding Principal', 'Outstanding Interest',
            'Outstanding Total Amount', 'Due Date', 'Due No', 'Due Principal',
            'Due Interest', 'Total Due Amount', 'Funder Name', CO_APPLICANT_MOBILE_HEADER,
        ];

        const rows: (string | number)[][] = result.data.map((r) => [
            r.sNo, r.branchId, r.branchName, r.centreId, r.centerName, r.fdoName, r.loanId,
            r.memberUniqueId, r.memberName, r.memberPhone, r.memberAadhar, r.meetupTime,
            formatDate(r.disbursementDate), formatDate(r.firstEmiDate), formatDate(r.loanMaturityDate),
            truncateReportAmount(r.loanAmount), truncateReportAmount(r.outstandingPrincipal), truncateReportAmount(r.outstandingInterest), truncateReportAmount(r.outstandingTotal),
            formatDate(r.dueDate), r.dueNo, truncateReportAmount(r.duePrincipal), truncateReportAmount(r.dueInterest), truncateReportAmount(r.totalDueAmount), r.funderName,
            r.coApplicantMobile || '-',
        ]);

        if (result.totals) {
            const t = result.totals;
            rows.push([
                'TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
                truncateReportAmount(t.loanAmount), truncateReportAmount(t.outstandingPrincipal), truncateReportAmount(t.outstandingInterest), truncateReportAmount(t.outstandingTotal),
                '', '', truncateReportAmount(t.duePrincipal), truncateReportAmount(t.dueInterest), truncateReportAmount(t.totalDueAmount), '',
            ]);
        }

        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!submittedFromDate || !submittedToDate) return;
        toast({ title: 'Export started', description: 'Fetching all records…' });
        try {
            const data = await fetchFutureReportExportRows();
            if (!data) throw new Error('fetch failed');
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawFutureReport(doc, data.headers, data.rows, { subtitle: `From ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}` }, reportFont);
            doc.save(`Future_Report_${submittedFromDate}_to_${submittedToDate}.pdf`);
            toast({ title: 'Export successful', description: 'The PDF file has been downloaded.' });
        } catch {
            toast({ title: 'Export failed', description: 'Could not generate the PDF file.', variant: 'destructive' });
        }
    };

    const handleExportCSV = async () => {
        if (!submittedFromDate || !submittedToDate) return;
        toast({ title: 'Export started', description: 'Fetching all records…' });
        try {
            const data = await fetchFutureReportExportRows();
            if (!data) throw new Error('fetch failed');
            exportToCSV(`Future_Report_${submittedFromDate}_to_${submittedToDate}`, 'FUTURE REPORT', data.headers, data.rows);
        } catch {
            toast({ title: 'Export failed', description: 'Could not generate the CSV file.', variant: 'destructive' });
        }
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing 'TOTAL' row
    // (when present) is split off for distinct styling, and genuinely related column
    // clusters (branch/center ID+Name pairs, member info, date triads, Principal-
    // Interest-Total triads) get a 2-row grouped header.
    const buildFutureReportWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                groupHeaders: [
                    { label: 'S.No', span: 1 }, { label: 'BRANCH & CENTER', span: 4 }, { label: 'FDO Name', span: 1 },
                    { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 4 }, { label: 'Meetup Time', span: 1 },
                    { label: 'LOAN DATES', span: 3 }, { label: 'Loan Amount', span: 1 }, { label: 'OUTSTANDING', span: 3 },
                    { label: 'Due Date', span: 1 }, { label: 'Due No', span: 1 }, { label: 'DUE', span: 3 },
                    { label: 'Funder Name', span: 1 },
                ],
                subHeaders: ['Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Unique ID', 'Name', 'Phone', 'Aadhar', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total'],
                columnAlignments: ['center', 'center', 'left', 'center', 'left', 'left', 'center', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'center', 'center', 'right', 'right', 'right', 'left'],
                columnWidthWeights: [3, 6, 9, 6, 9, 9, 7, 7, 9, 9, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 6, 7, 7, 7, 9],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (!submittedFromDate || !submittedToDate) return;
        toast({ title: 'Export started', description: 'Fetching all records…' });
        try {
            const data = await fetchFutureReportExportRows();
            if (!data) throw new Error('fetch failed');
            const { bodyRows, options } = buildFutureReportWordOptions(data.rows);
            await exportToWord(`Future_Report_${submittedFromDate}_to_${submittedToDate}`, 'FUTURE REPORT', data.headers, bodyRows, options);
        } catch {
            toast({ title: 'Export failed', description: 'Could not generate the Word file.', variant: 'destructive' });
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const HEADER_COLS = [
        'S.No', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
        'FDO Name', 'Loan ID', 'Member Unique ID', 'Member Name', 'Member Phone',
        'Member Aadhar', 'Meetup Time', 'Disbursement Date', '1st EMI Date',
        'Loan Maturity Date', 'Loan Amount', 'O/S Principal', 'O/S Interest',
        'O/S Total Amount', 'Due Date', 'Due No', 'Due Principal',
        'Due Interest', 'Total Due Amount', 'Funder Name', CO_APPLICANT_MOBILE_HEADER,
    ];

    const RIGHT_ALIGN_COLS = new Set([
        'Loan Amount', 'O/S Principal', 'O/S Interest', 'O/S Total Amount',
        'Due Principal', 'Due Interest', 'Total Due Amount',
    ]);

    return (
        <div className="space-y-6">
            {/* ── Filter Section ── */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* From Date */}
                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold">
                                From Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="fromDate"
                                    value={fromDate}
                                    onChange={(e) => setFromDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* To Date */}
                        <div className="space-y-2">
                            <Label htmlFor="toDate" className="text-sm font-semibold">
                                To Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="toDate"
                                    value={toDate}
                                    onChange={(e) => setToDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Branch Filter (AM / ADMIN only — BM/FDO is auto-scoped) */}
                        {branches.length > 0 && (
                            <div className="space-y-2">
                                <Label htmlFor="branch" className="text-sm font-semibold">
                                    Branch
                                </Label>
                                <Select
                                    value={selectedBranchId}
                                    onValueChange={(v) => { setSelectedBranchId(v); setSelectedCenterId('all'); }}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger id="branch" className="h-11">
                                        <SelectValue placeholder="All Branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Branches</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>
                                                {b.code} - {b.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Center Filter (AM / ADMIN only — BM/FDO is auto-scoped) */}
                        {centers.length > 0 && (
                            <div className="space-y-2">
                                <Label htmlFor="center" className="text-sm font-semibold">
                                    Center
                                </Label>
                                <Select
                                    value={selectedCenterId}
                                    onValueChange={setSelectedCenterId}
                                    disabled={isLoading}
                                >
                                    <SelectTrigger id="center" className="h-11">
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
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3 mt-6">
                        <Button
                            onClick={handleShow}
                            disabled={isLoading}
                            className="bg-primary hover:bg-sidebar-accent text-white shadow-md"
                        >
                            {isLoading ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Show
                        </Button>
                        <Button
                            onClick={handleReset}
                            disabled={isLoading}
                            variant="destructive"
                            className="shadow-md"
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reset
                        </Button>
                        <ExportDropdown
                            onExportPDF={showReport && !isLoading ? handleExportPDF : undefined}
                            onExportExcel={showReport && !isLoading ? handleExport : undefined}
                            onExportCSV={showReport && !isLoading ? handleExportCSV : undefined}
                            onExportWord={showReport && !isLoading ? handleExportWord : undefined}
                            reportSlug={showReport && !isLoading && getReportExportMode('future-report') === 'REQUEST_QUEUE' ? 'future-report' : undefined}
                            canExport={canExportReport('future-report')}
                            exportParams={{
                                fromDate: submittedFromDate,
                                toDate: submittedToDate,
                                branchIds: selectedBranchId === 'all' ? 'ALL' : [selectedBranchId],
                                filters: selectedCenterId !== 'all' ? { centerId: selectedCenterId } : null,
                            }}
                            className="shadow-md"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* ── Report Table ── */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-2">
                        <ReportHeader
                            title="Future Report"
                            subtitle={`From ${formatDate(submittedFromDate)} to ${formatDate(submittedToDate)}`}
                        />
                        <div className="flex justify-end">
                            <Input
                                placeholder="Name, ID, Aadhaar or mobile — Enter to search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') fetchPage(1); }}
                                className="h-9 w-full max-w-xs"
                            />
                        </div>
                    </CardHeader>
                    {/* Summary bar */}
                    <div className="px-4 py-2 bg-green-50 dark:bg-brand-green-darker/60 border-b text-sm text-sidebar-accent dark:text-emerald-300 font-medium">
                        {totalCount} record(s) &mdash; From{' '}
                        <strong>{formatDate(submittedFromDate)}</strong> to{' '}
                        <strong>{formatDate(submittedToDate)}</strong>
                        {selectedBranchId !== 'all' && (
                            <>
                                {' '}— Branch:{' '}
                                <strong>
                                    {branches.find((b) => b.id === selectedBranchId)?.name ??
                                        selectedBranchId}
                                </strong>
                            </>
                        )}
                        {selectedCenterId !== 'all' && (
                            <>
                                {' '}— Center:{' '}
                                <strong>
                                    {centers.find((c) => c.id === selectedCenterId)?.name ??
                                        selectedCenterId}
                                </strong>
                            </>
                        )}
                    </div>

                    <CardContent className="p-0">
                        {/* Horizontally scrollable, sticky header */}
                        <div className="max-h-[600px] overflow-auto">
                            <Table className="min-w-[2400px] text-xs">
                                <TableHeader className="sticky top-0 z-10 bg-primary">
                                    <TableRow className="hover:bg-sidebar-accent border-b border-sidebar-accent">
                                        {HEADER_COLS.map((col) => (
                                            <TableHead
                                                key={col}
                                                className={`text-white font-semibold whitespace-nowrap px-3 py-2 ${
                                                    RIGHT_ALIGN_COLS.has(col)
                                                        ? 'text-right'
                                                        : ''
                                                }`}
                                            >
                                                {col}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>

                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={HEADER_COLS.length}
                                                className="text-center py-10 text-slate-500"
                                            >
                                                No records found for the selected criteria.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((row) => (
                                            <TableRow
                                                key={`${row.loanId}-${row.dueNo}`}
                                                className="hover:bg-green-50/60 border-b border-slate-100"
                                            >
                                                <TableCell className="px-3 py-1.5">{row.sNo}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.branchId}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.branchName}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.centreId}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.centerName}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.fdoName}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap font-mono">{row.loanId}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap font-mono">{row.memberUniqueId}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.memberName}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.memberPhone}</TableCell>
                                                <TableCell className="px-3 py-1.5 font-mono">{row.memberAadhar}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.meetupTime}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{formatDate(row.disbursementDate)}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{formatDate(row.firstEmiDate)}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{formatDate(row.loanMaturityDate)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right font-medium">{formatCurrency(row.loanAmount)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right">{formatCurrency(row.outstandingPrincipal)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right">{formatCurrency(row.outstandingInterest)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right font-medium">{formatCurrency(row.outstandingTotal)}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{formatDate(row.dueDate)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-center whitespace-nowrap">[{row.dueNo}]</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right">{formatCurrency(row.duePrincipal)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right">{formatCurrency(row.dueInterest)}</TableCell>
                                                <TableCell className="px-3 py-1.5 text-right font-medium">{formatCurrency(row.totalDueAmount)}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.funderName}</TableCell>
                                                <TableCell className="px-3 py-1.5 whitespace-nowrap">{row.coApplicantMobile || '-'}</TableCell>
                                            </TableRow>
                                        ))
                                    )}

                                    {/* Grand Totals Row */}
                                    {data.length > 0 && totals && (
                                        <TableRow className="bg-green-50 dark:bg-brand-green-darker/50 font-bold border-t-2 border-primary/40 sticky bottom-0">
                                            <TableCell className="px-3 py-2" colSpan={15}>
                                                PAGE TOTAL ({data.length} rows)
                                            </TableCell>
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.loanAmount)}</TableCell>
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.outstandingPrincipal)}</TableCell>
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.outstandingInterest)}</TableCell>
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.outstandingTotal)}</TableCell>
                                            <TableCell className="px-3 py-2" colSpan={2} />
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.duePrincipal)}</TableCell>
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.dueInterest)}</TableCell>
                                            <TableCell className="px-3 py-2 text-right">{formatCurrency(totals.totalDueAmount)}</TableCell>
                                            <TableCell className="px-3 py-2" />
                                            <TableCell className="px-3 py-2" />
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t bg-green-50/80 dark:bg-brand-green-darker/50">
                                <span className="text-sm text-slate-500">
                                    Page {currentPage} of {totalPages} &mdash; {totalCount} total
                                    records
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage <= 1 || isLoading}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="flex items-center px-3 text-sm">
                                        {currentPage} / {totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage >= totalPages || isLoading}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Empty state ── */}
            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="flex flex-col items-center justify-center py-14">
                        <FileText className="h-14 w-14 text-slate-300 mb-4" />
                        <p className="text-sm font-medium text-sidebar-accent dark:text-emerald-400">
                            Select date range and click <strong>Show</strong> to generate
                            the Future Report
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
