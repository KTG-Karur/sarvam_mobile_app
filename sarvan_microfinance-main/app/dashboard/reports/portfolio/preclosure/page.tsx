'use client';

import { useState, useEffect, useCallback } from 'react';
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
    CheckCircle2,
    DollarSign,
    FileSpreadsheet,
    FileType,
    FileOutput,
    RotateCcw,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    FileCheck,
    FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { CO_APPLICANT_MOBILE_HEADER } from '@/app/lib/reports/member-contact-columns';

interface PreclosureEntry {
    sNo: number;
    region: string;
    division: string;
    area: string;
    branchId: string;
    branchName: string;
    centerId: string;
    centerName: string;
    fdoName: string;
    loanId: string;
    loanType: string;
    productName: string;
    memberId: string;
    memberName: string;
    phoneNumber: string;
    aadhaarNumber: string;
    noOfInstallments: number;
    reason: string;
    fundingName: string;
    distributionDate: string;
    preClosedDate: string;
    preCloseDay: number;
    isMeetingDay: string;
    loanPrincipal: number;
    loanInterest: number;
    loanTotalAmount: number;
    preClosePrincipal: number;
    preCloseInterest: number;
    preCloseAmount: number;
    interestWaiverAmount: number;
    coApplicantMobile?: string;
}

type BranchOption = { id: string; name: string; code: string };

const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => {
    return formatReportAmount(amount);
};

const TABLE_HEADERS = [
    'S.No', 'Region', 'Division', 'Area', 'Branch ID', 'Branch Name',
    'Center ID', 'Center Name', 'FDO Name', 'Loan ID', 'Loan Type',
    'Product Name', 'Member ID', 'Member Name', 'Phone Number', 'Aadhaar Number',
    'No of Installments', 'Reason', 'Funding Name', 'Distribution Date',
    'PreClosed Date', 'PreClose Day', 'Is Meeting Day',
    'Loan Principal', 'Loan Interest', 'Loan Total Amount',
    'PreClose Principal', 'PreClose Interest', 'PreClose Amount',
    'Interest Waiver Amount',
    // Aadhaar / member phone already appear above (Aadhaar Number / Phone Number).
    CO_APPLICANT_MOBILE_HEADER,
];

export default function PreclosurePage() {
    const { toast } = useToast();
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';

    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [branchDisplayName, setBranchDisplayName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const today = getTodayStr();
    const [fromDate, setFromDate] = useState<string>(today);
    const [tillDate, setTillDate] = useState<string>(today);
    const [isLoading, setIsLoading] = useState(false);
    const [rawData, setData] = useState<PreclosureEntry[]>([]);
    // Every table / total / export below reads `data` — the search-filtered rows
    // (member name, ID, Aadhaar, phone, co-applicant mobile, ...).
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: data } = useTableSearch(rawData);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    useEffect(() => { setCurrentPage(1); }, [tableSearchQuery]);

    // Load branches on mount
    useEffect(() => {
        const load = async () => {
            if (isAdminOrAM) {
                setIsLoadingBranches(true);
                try {
                    const res = await fetch('/api/branches');
                    const json = await res.json();
                    const list: BranchOption[] = (json?.data ?? []).map((b: any) => ({
                        id: b.id,
                        name: b.name,
                        code: b.code,
                    }));
                    setBranches(list);
                    const activeBranch = branchStorage.getActiveBranch();
                    const preferred = activeBranch?.id ?? storedUser?.branchId;
                    const match = list.find((b) => b.id === preferred) ?? list[0];
                    if (match) setSelectedBranchId(match.id);
                    else setSelectedBranchId('all');
                } catch {
                    toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                } finally {
                    setIsLoadingBranches(false);
                }
            } else {
                const activeBranch = branchStorage.getActiveBranch();
                const branchId = activeBranch?.id ?? storedUser?.branchId ?? 'all';
                setSelectedBranchId(branchId);
                setBranchDisplayName(activeBranch?.name ?? storedUser?.branchId ?? '');
            }
        };
        load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchReport = useCallback(async (bId: string, fd: string, td: string) => {
        if (!fd || !td) return;
        setIsLoading(true);
        try {
            const result = await apiClient.get<PreclosureEntry[]>(
                `/reports/portfolio/preclosure?branchId=${bId}&fromDate=${fd}&tillDate=${td}`
            );
            if (result.success && result.data) {
                setData(result.data);
                setCurrentPage(1);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to fetch report data.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch report data.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    // Auto-load when branch resolves
    useEffect(() => {
        if (selectedBranchId) {
            fetchReport(selectedBranchId, fromDate, tillDate);
        }
    // Only fires when selectedBranchId is first set (page load auto-load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    const handleShow = () => {
        if (!fromDate || !tillDate) {
            toast({ title: 'Required', description: 'Please select both From and Till dates.', variant: 'destructive' });
            return;
        }
        fetchReport(selectedBranchId, fromDate, tillDate);
    };

    const handleReset = () => {
        const t = getTodayStr();
        setFromDate(t);
        setTillDate(t);
        setData([]);
        setCurrentPage(1);
    };

    const handleExportExcel = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        try {
            const exportData = data.map((row) => ({
                'S.No': row.sNo,
                'Region': row.region,
                'Division': row.division,
                'Area': row.area,
                'Branch ID': row.branchId,
                'Branch Name': row.branchName,
                'Center ID': row.centerId,
                'Center Name': row.centerName,
                'FDO Name': row.fdoName,
                'Loan ID': row.loanId,
                'Loan Type': row.loanType,
                'Product Name': row.productName,
                'Member ID': row.memberId,
                'Member Name': row.memberName,
                'Phone Number': row.phoneNumber,
                'Aadhaar Number': row.aadhaarNumber,
                'No of Installments': row.noOfInstallments,
                'Reason': row.reason,
                'Funding Name': row.fundingName,
                'Distribution Date': row.distributionDate,
                'PreClosed Date': row.preClosedDate,
                'PreClose Day': row.preCloseDay,
                'Is Meeting Day': row.isMeetingDay,
                'Loan Principal': truncateReportAmount(row.loanPrincipal),
                'Loan Interest': truncateReportAmount(row.loanInterest),
                'Loan Total Amount': truncateReportAmount(row.loanTotalAmount),
                'PreClose Principal': truncateReportAmount(row.preClosePrincipal),
                'PreClose Interest': truncateReportAmount(row.preCloseInterest),
                'PreClose Amount': truncateReportAmount(row.preCloseAmount),
                'Interest Waiver Amount': truncateReportAmount(row.interestWaiverAmount),
                [CO_APPLICANT_MOBILE_HEADER]: row.coApplicantMobile || '-',
            }));

            exportData.push({
                'S.No': 0,
                'Region': '',
                'Division': '',
                'Area': '',
                'Branch ID': '',
                'Branch Name': '',
                'Center ID': '',
                'Center Name': '',
                'FDO Name': '',
                'Loan ID': '',
                'Loan Type': '',
                'Product Name': '',
                'Member ID': '',
                'Member Name': 'Grand Total',
                'Phone Number': '',
                'Aadhaar Number': '',
                'No of Installments': 0,
                'Reason': '',
                'Funding Name': '',
                'Distribution Date': '',
                'PreClosed Date': '',
                'PreClose Day': 0,
                'Is Meeting Day': '',
                'Loan Principal': truncateReportAmount(data.reduce((s, r) => s + r.loanPrincipal, 0)),
                'Loan Interest': truncateReportAmount(data.reduce((s, r) => s + r.loanInterest, 0)),
                'Loan Total Amount': truncateReportAmount(data.reduce((s, r) => s + r.loanTotalAmount, 0)),
                'PreClose Principal': truncateReportAmount(data.reduce((s, r) => s + r.preClosePrincipal, 0)),
                'PreClose Interest': truncateReportAmount(data.reduce((s, r) => s + r.preCloseInterest, 0)),
                'PreClose Amount': truncateReportAmount(data.reduce((s, r) => s + r.preCloseAmount, 0)),
                'Interest Waiver Amount': truncateReportAmount(data.reduce((s, r) => s + r.interestWaiverAmount, 0)),
                [CO_APPLICANT_MOBILE_HEADER]: '',
            });

            const ws = buildReportSheet('Preclosure Report', exportData);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Preclosure Report');
            XLSX.writeFile(wb, `Preclosure_Report_${fromDate}_to_${tillDate}.xlsx`);
            toast({ title: 'Export Successful', description: 'Report downloaded as Excel.' });
        } catch {
            toast({ title: 'Export Failed', description: 'Failed to generate Excel file.', variant: 'destructive' });
        }
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        try {
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
            const reportFont = await ensureReportFont(doc);
            const headerY = await drawPdfReportHeader(doc, 'Preclosure Report', {
                subtitle: `${fromDate} to ${tillDate}`,
                fontFamily: reportFont,
            });

            const body = data.map((row) => [
                row.sNo, row.region, row.division, row.area,
                row.branchId, row.branchName, row.centerId, row.centerName,
                row.fdoName, row.loanId, row.loanType, row.productName,
                row.memberId, row.memberName, row.phoneNumber, row.aadhaarNumber,
                row.noOfInstallments, row.reason, row.fundingName,
                row.distributionDate, row.preClosedDate, row.preCloseDay,
                row.isMeetingDay,
                formatCurrency(row.loanPrincipal),
                formatCurrency(row.loanInterest),
                formatCurrency(row.loanTotalAmount),
                formatCurrency(row.preClosePrincipal),
                formatCurrency(row.preCloseInterest),
                formatCurrency(row.preCloseAmount),
                formatCurrency(row.interestWaiverAmount),
                row.coApplicantMobile || '-',
            ]);

            // Grand total row
            body.push([
                '', '', '', '', '', '', '', '', '', '', '', '',
                '', 'Grand Total', '', '', '', '', '', '', '', '', '',
                formatCurrency(data.reduce((s, r) => s + r.loanPrincipal, 0)),
                formatCurrency(data.reduce((s, r) => s + r.loanInterest, 0)),
                formatCurrency(data.reduce((s, r) => s + r.loanTotalAmount, 0)),
                formatCurrency(data.reduce((s, r) => s + r.preClosePrincipal, 0)),
                formatCurrency(data.reduce((s, r) => s + r.preCloseInterest, 0)),
                formatCurrency(data.reduce((s, r) => s + r.preCloseAmount, 0)),
                formatCurrency(data.reduce((s, r) => s + r.interestWaiverAmount, 0)),
                '',
            ]);

            autoTable(doc, {
                startY: headerY,
                head: [TABLE_HEADERS],
                body,
                styles: { font: reportFont, fontSize: 5, cellPadding: 1 },
                headStyles: { font: reportFont, fillColor: [3, 127, 53], textColor: 255, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [240, 250, 244] },
            });

            doc.save(`Preclosure_Report_${fromDate}_to_${tillDate}.pdf`);
            toast({ title: 'Export Successful', description: 'Report downloaded as PDF.' });
        } catch {
            toast({ title: 'Export Failed', description: 'Failed to generate PDF file.', variant: 'destructive' });
        }
    };

    // Mirrors the same field mapping used by handleExportExcel above (kept separate so
    // handleExportExcel is left untouched).
    const buildPreclosureExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const rows: (string | number)[][] = data.map((row) => [
            row.sNo, row.region, row.division, row.area,
            row.branchId, row.branchName, row.centerId, row.centerName,
            row.fdoName, row.loanId, row.loanType, row.productName,
            row.memberId, row.memberName, row.phoneNumber, row.aadhaarNumber,
            row.noOfInstallments, row.reason, row.fundingName,
            row.distributionDate, row.preClosedDate, row.preCloseDay,
            row.isMeetingDay,
            truncateReportAmount(row.loanPrincipal), truncateReportAmount(row.loanInterest), truncateReportAmount(row.loanTotalAmount),
            truncateReportAmount(row.preClosePrincipal), truncateReportAmount(row.preCloseInterest), truncateReportAmount(row.preCloseAmount),
            truncateReportAmount(row.interestWaiverAmount),
            row.coApplicantMobile || '-',
        ]);

        rows.push([
            0, '', '', '', '', '', '', '', '', '', '', '',
            '', 'Grand Total', '', '', 0, '', '', '', '', 0, '',
            truncateReportAmount(data.reduce((s, r) => s + r.loanPrincipal, 0)),
            truncateReportAmount(data.reduce((s, r) => s + r.loanInterest, 0)),
            truncateReportAmount(data.reduce((s, r) => s + r.loanTotalAmount, 0)),
            truncateReportAmount(data.reduce((s, r) => s + r.preClosePrincipal, 0)),
            truncateReportAmount(data.reduce((s, r) => s + r.preCloseInterest, 0)),
            truncateReportAmount(data.reduce((s, r) => s + r.preCloseAmount, 0)),
            truncateReportAmount(data.reduce((s, r) => s + r.interestWaiverAmount, 0)),
            '',
        ]);

        return { headers: TABLE_HEADERS, rows };
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPreclosureExportRows();
        exportToCSV(`Preclosure_Report_${fromDate}_to_${tillDate}`, 'PRECLOSURE REPORT', headers, rows);
    };

    // Word-only presentation: same rows as CSV above, but the trailing "Grand Total" row
    // is split off for distinct styling. At 30 columns (comparable to Demand Sheet's 33)
    // this genuinely benefits from grouped headers and A3 landscape — grouping only where
    // fields are truly parallel (ID+Name pairs, org-hierarchy levels, Principal/Interest/
    // Total triads); the 7 unrelated closure-detail fields (Reason, Funding Name, dates,
    // etc.) are left standalone rather than crammed under one vague banner.
    const buildPreclosureWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 },
                { label: 'LOCATION', span: 3 },
                { label: 'BRANCH & CENTER', span: 4 },
                { label: 'FDO Name', span: 1 },
                { label: 'LOAN INFO', span: 3 },
                { label: 'MEMBER INFO', span: 4 },
                { label: 'No of Installments', span: 1 },
                { label: 'Reason', span: 1 },
                { label: 'Funding Name', span: 1 },
                { label: 'Distribution Date', span: 1 },
                { label: 'PreClosed Date', span: 1 },
                { label: 'PreClose Day', span: 1 },
                { label: 'Is Meeting Day', span: 1 },
                { label: 'LOAN AMOUNT', span: 3 },
                { label: 'PRECLOSE AMOUNT', span: 3 },
                { label: 'Interest Waiver Amount', span: 1 },
                { label: CO_APPLICANT_MOBILE_HEADER, span: 1 },
            ],
            subHeaders: [
                'Region', 'Division', 'Area',
                'Branch ID', 'Branch Name', 'Center ID', 'Center Name',
                'Loan ID', 'Loan Type', 'Product Name',
                'Member ID', 'Member Name', 'Phone Number', 'Aadhaar Number',
                'Principal', 'Interest', 'Total',
                'Principal', 'Interest', 'Amount',
            ],
            columnAlignments: [
                'center',
                'left', 'left', 'left',
                'center', 'left', 'center', 'left',
                'left',
                'center', 'left', 'left',
                'center', 'left', 'center', 'center',
                'right',
                'left',
                'left',
                'center',
                'center',
                'center',
                'center',
                'right', 'right', 'right',
                'right', 'right', 'right',
                'right',
                'center',
            ],
            columnWidthWeights: [
                3,
                6, 6, 6,
                6, 10, 6, 10,
                9,
                7, 8, 10,
                7, 14, 8, 9,
                6,
                12,
                10,
                7,
                7,
                6,
                6,
                8, 8, 9,
                8, 8, 8,
                8,
                9,
            ],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 }, // A3 landscape — 30 columns needs the width, same as Demand Sheet
        },
    });

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please search for data before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildPreclosureExportRows();
        const { bodyRows, options } = buildPreclosureWordOptions(rows);
        await exportToWord(`Preclosure_Report_${fromDate}_to_${tillDate}`, 'PRECLOSURE REPORT', headers, bodyRows, options);
    };

    // Pagination
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentData = data.slice(startIndex, startIndex + itemsPerPage);

    // Summary totals
    const totalPreClosePrincipal = data.reduce((s, r) => s + r.preClosePrincipal, 0);
    const totalPreCloseInterest = data.reduce((s, r) => s + r.preCloseInterest, 0);
    const totalInterestWaiver = data.reduce((s, r) => s + r.interestWaiverAmount, 0);

    return (
        <ProtectedRoute requiredPermission="PRECLOSURE_REPORT">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Background Glow */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-green-500/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
                    </div>

                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-600 to-emerald-600 shadow-lg shadow-green-500/30">
                                <CheckCircle2 className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Preclosure Report
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Detailed loan preclosure tracking with full hierarchy and financial breakdown
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">Total Preclosures</p>
                                        <p className="text-3xl font-bold text-green-900 dark:text-green-100 mt-2">{data.length}</p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">Loans closed</p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <FileCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">PreClose Principal</p>
                                        <p className="text-2xl font-bold text-foreground dark:text-green-100 mt-2">₹ {formatCurrency(totalPreClosePrincipal)}</p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">Principal collected</p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <DollarSign className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">PreClose Interest</p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">₹ {formatCurrency(totalPreCloseInterest)}</p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Interest collected</p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-orange-200/50 dark:border-orange-800/50 bg-gradient-to-br from-orange-50 to-amber-50/50 dark:from-orange-950/20 dark:to-amber-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">Interest Waiver</p>
                                        <p className="text-2xl font-bold text-orange-900 dark:text-orange-100 mt-2">₹ {formatCurrency(totalInterestWaiver)}</p>
                                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">Total waived</p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/50">
                                        <DollarSign className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-emerald-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                                    <Filter className="h-5 w-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Report Filters</CardTitle>
                                    <CardDescription>Select branch and date range to view preclosure report</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                                {/* Branch */}
                                <div className="space-y-2">
                                    <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch <span className="text-red-500">*</span>
                                    </Label>
                                    {isAdminOrAM ? (
                                        <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={isLoadingBranches}>
                                            <SelectTrigger id="branch" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                                <SelectValue placeholder={isLoadingBranches ? 'Loading...' : 'Select branch'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                                {branches.map((b) => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        {b.code} - {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <div className="h-11 flex items-center px-3 rounded-md border border-primary/30 dark:border-sidebar-accent bg-slate-50 dark:bg-brand-green-darker text-sm text-sidebar-accent dark:text-slate-300">
                                            {branchDisplayName || selectedBranchId}
                                        </div>
                                    )}
                                </div>

                                {/* From Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        From Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="fromDate"
                                            value={fromDate}
                                            onChange={(e) => setFromDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Till Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="tillDate"
                                            value={tillDate}
                                            onChange={(e) => setTillDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="space-y-2 lg:col-span-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">Actions</Label>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            onClick={handleShow}
                                            disabled={isLoading}
                                            className="h-11 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg shadow-green-500/30"
                                        >
                                            {isLoading ? (
                                                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                                            ) : (
                                                <><FileSpreadsheet className="h-4 w-4 mr-2" />Show</>
                                            )}
                                        </Button>
                                        <Button onClick={handleReset} variant="outline" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                            <RotateCcw className="h-4 w-4 mr-2" />Reset
                                        </Button>
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExportExcel}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            className="h-11 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-emerald-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Preclosure Report</CardTitle>
                                        <CardDescription>Loan preclosure transaction details</CardDescription>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <TableSearchInput
                                        value={tableSearchQuery}
                                        onChange={setTableSearchQuery}
                                        placeholder="Search name, ID, Aadhaar, mobile..."
                                    />
                                    <Badge variant="outline" className="text-sm px-3 py-1 border-green-300 text-green-700 dark:border-green-700 dark:text-green-300">
                                        {data.length} Preclosures
                                    </Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-700 dark:to-emerald-700 hover:from-green-600 hover:to-emerald-600">
                                            {TABLE_HEADERS.map((h) => (
                                                <TableHead key={h} className="font-bold text-white whitespace-nowrap text-xs px-2">
                                                    {h}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentData.map((row, index) => (
                                            <TableRow
                                                key={row.sNo}
                                                className={cn(
                                                    'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                    index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50'
                                                )}
                                            >
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.sNo}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.region}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.division}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.area}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap font-mono">{row.branchId}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.branchName}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap font-mono">{row.centerId}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.centerName}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.fdoName}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap font-mono text-sidebar-accent dark:text-primary">{row.loanId}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.loanType}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.productName}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap font-mono">{row.memberId}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap font-semibold">{row.memberName}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.phoneNumber}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap font-mono">{row.aadhaarNumber}</TableCell>
                                                <TableCell className="text-xs px-2 text-center">{row.noOfInstallments}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap max-w-[120px] truncate" title={row.reason}>{row.reason}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.fundingName}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.distributionDate}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.preClosedDate}</TableCell>
                                                <TableCell className="text-xs px-2 text-center">{row.preCloseDay}</TableCell>
                                                <TableCell className="text-xs px-2 text-center">
                                                    <span className={cn(
                                                        'px-1.5 py-0.5 rounded text-xs font-medium',
                                                        row.isMeetingDay === 'Yes'
                                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                                                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                                    )}>
                                                        {row.isMeetingDay}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(row.loanPrincipal)}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(row.loanInterest)}</TableCell>
                                                <TableCell className="text-xs px-2 text-right font-semibold">{formatCurrency(row.loanTotalAmount)}</TableCell>
                                                <TableCell className="text-xs px-2 text-right text-green-700 dark:text-green-400 font-semibold">{formatCurrency(row.preClosePrincipal)}</TableCell>
                                                <TableCell className="text-xs px-2 text-right text-purple-700 dark:text-purple-400">{formatCurrency(row.preCloseInterest)}</TableCell>
                                                <TableCell className="text-xs px-2 text-right font-bold text-primary dark:text-primary">{formatCurrency(row.preCloseAmount)}</TableCell>
                                                <TableCell className="text-xs px-2 text-right text-orange-700 dark:text-orange-400">{formatCurrency(row.interestWaiverAmount)}</TableCell>
                                                <TableCell className="text-xs px-2 whitespace-nowrap">{row.coApplicantMobile || '-'}</TableCell>
                                            </TableRow>
                                        ))}

                                        {/* Grand Total Row — last page only */}
                                        {currentPage === totalPages && data.length > 0 && (
                                            <TableRow className="bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-950/50 dark:to-emerald-950/50 font-bold border-t-2 border-green-300 dark:border-green-700">
                                                <TableCell className="text-xs px-2" colSpan={23}>Grand Total</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.loanPrincipal, 0))}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.loanInterest, 0))}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.loanTotalAmount, 0))}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.preClosePrincipal, 0))}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.preCloseInterest, 0))}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.preCloseAmount, 0))}</TableCell>
                                                <TableCell className="text-xs px-2 text-right">{formatCurrency(data.reduce((s, r) => s + r.interestWaiverAmount, 0))}</TableCell>
                                                <TableCell />
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                                    <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                        Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, data.length)} of {data.length} preclosures
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                        >
                                            <ChevronLeft className="h-4 w-4" />Previous
                                        </Button>
                                        <div className="flex items-center gap-1">
                                            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((page) => (
                                                <Button
                                                    key={page}
                                                    variant={currentPage === page ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setCurrentPage(page)}
                                                    className={cn('w-8 h-8 p-0', currentPage === page && 'bg-green-600 hover:bg-green-700')}
                                                >
                                                    {page}
                                                </Button>
                                            ))}
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                        >
                                            Next<ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Footer */}
                    <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
                        <p>
                            Report generated on {toDisplayDateTime(new Date())}
                        </p>
                        <p>
                            Date Range: <span className="font-semibold text-green-700 dark:text-green-400">
                                {toDisplayDate(new Date(fromDate))} — {toDisplayDate(new Date(tillDate))}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
