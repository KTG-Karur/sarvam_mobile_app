'use client';

import * as XLSX from 'xlsx-js-style';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Coins, Download, Search, FileDown, FileType, Eye, Users, Scale, Banknote, Wallet } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { getGoldTakenReport, getGoldReturnedReport, GoldTakenRow, GoldReturnedRow, GoldTakenTotals, GoldReturnedTotals } from '@/app/lib/actions/reports';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { GoldRecordDetailModal } from '@/components/reports/GoldRecordDetailModal';
import { reportHeaderRows, buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { jsPDF } from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawGoldReportPdf } from '@/app/lib/reports/gold-report-pdf';
import { exportToWord, exportToCSV, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';
import { cn } from '@/app/lib/utils';
import { MEMBER_CONTACT_HEADERS, CO_APPLICANT_MOBILE_HEADER, memberContactValues } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';

type ReportTab = 'taken' | 'returned';
type BranchOption = { id: string; name: string; code: string };

function getDefaultDates() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
        from: firstDay.toISOString().split('T')[0],
        to: today.toISOString().split('T')[0],
    };
}

export default function GoldReportPage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const defaults = getDefaultDates();
    const [activeTab, setActiveTab] = useState<ReportTab>('taken');
    const [fromDate, setFromDate] = useState(defaults.from);
    const [toDate, setToDate] = useState(defaults.to);
    // Submitted (applied) date snapshot — frozen until the next Search click, so pagination
    // (both tabs) and exports keep using the last-submitted range even if fromDate/toDate
    // above are edited afterward without clicking Search again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedToDate, setSubmittedToDate] = useState(toDate);
    const [isLoading, setIsLoading] = useState(false);

    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const PAGE_SIZE = 25;

    const [takenRows, setTakenRows] = useState<GoldTakenRow[]>([]);
    const [takenTotals, setTakenTotals] = useState<GoldTakenTotals>({ gramCount: 0, goldTakenValue: 0, cashGiven: 0, memberCount: 0 });
    const [takenPage, setTakenPage] = useState(1);
    const [takenTotalPages, setTakenTotalPages] = useState(1);
    const [takenTotalCount, setTakenTotalCount] = useState(0);

    const [returnedRows, setReturnedRows] = useState<GoldReturnedRow[]>([]);
    const [returnedTotals, setReturnedTotals] = useState<GoldReturnedTotals>({ loanPrincipal: 0, loanInterest: 0, loanTotalAmount: 0, goldWeight: 0, goldValueOnDisbursement: 0, memberCount: 0 });
    const [returnedPage, setReturnedPage] = useState(1);
    const [returnedTotalPages, setReturnedTotalPages] = useState(1);
    const [returnedTotalCount, setReturnedTotalCount] = useState(0);

    const [hasSearched, setHasSearched] = useState(false);

    const [viewingRow, setViewingRow] = useState<GoldTakenRow | GoldReturnedRow | null>(null);
    const [viewingType, setViewingType] = useState<'taken' | 'returned'>('taken');
    const openDetail = (type: 'taken' | 'returned', row: GoldTakenRow | GoldReturnedRow) => {
        setViewingType(type);
        setViewingRow(row);
    };

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});

        getCentersForDropdown()
            .then(setCenters)
            .catch(() => {});
    }, []);

    // `dateOverride` lets handleSearch pass the just-read draft dates straight through on the
    // same click — reading submittedFromDate/submittedToDate here would otherwise use the
    // pre-update (stale) state, since the setSubmitted* calls in handleSearch haven't
    // re-rendered yet. Callers other than handleSearch (pagination) omit it and get the
    // last-submitted snapshot.
    const fetchTakenPage = async (pageArg: number, dateOverride?: { fromDate: string; toDate: string }) => {
        const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
        const effToDate = dateOverride?.toDate ?? submittedToDate;
        const data = await getGoldTakenReport(effFromDate, effToDate, selectedBranch, selectedCenter, pageArg, PAGE_SIZE, undefined, searchQuery.trim() || undefined);
        setTakenRows(data.rows);
        setTakenTotals(data.totals);
        setTakenPage(data.page);
        setTakenTotalPages(data.totalPages);
        setTakenTotalCount(data.totalCount);
        return data;
    };

    const fetchReturnedPage = async (pageArg: number, dateOverride?: { fromDate: string; toDate: string }) => {
        const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
        const effToDate = dateOverride?.toDate ?? submittedToDate;
        const data = await getGoldReturnedReport(effFromDate, effToDate, selectedBranch, selectedCenter, pageArg, PAGE_SIZE, undefined, searchQuery.trim() || undefined);
        setReturnedRows(data.rows);
        setReturnedTotals(data.totals);
        setReturnedPage(data.page);
        setReturnedTotalPages(data.totalPages);
        setReturnedTotalCount(data.totalCount);
        return data;
    };

    const handleSearch = async () => {
        if (!fromDate || !toDate) {
            toast({ title: 'Validation', description: 'Please select date range', variant: 'destructive' });
            return;
        }
        const snapshot = { fromDate, toDate };
        setSubmittedFromDate(fromDate);
        setSubmittedToDate(toDate);
        setIsLoading(true);
        setHasSearched(true);
        try {
            if (activeTab === 'taken') {
                await fetchTakenPage(1, snapshot);
            } else {
                await fetchReturnedPage(1, snapshot);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch report data', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handlePageChange = async (p: number) => {
        setIsLoading(true);
        try {
            if (activeTab === 'taken') {
                await fetchTakenPage(p);
            } else {
                await fetchReturnedPage(p);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch report data', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    // Fetches every row matching the current filters (not just the on-screen page) —
    // used only by the export handlers below, so exports keep capturing the full
    // report instead of whatever happens to be on screen.
    // The server action clamps pageSize to 5000 regardless of what's requested here, so a
    // single call can silently truncate large filtered result sets — loop pages instead of
    // trusting one request to return everything.
    const fetchAllTakenForExport = async (): Promise<GoldTakenRow[] | null> => {
        try {
            const first = await getGoldTakenReport(submittedFromDate, submittedToDate, selectedBranch, selectedCenter, 1, 5000);
            const rows = [...first.rows];
            for (let page = 2; page <= first.totalPages; page++) {
                const next = await getGoldTakenReport(submittedFromDate, submittedToDate, selectedBranch, selectedCenter, page, 5000);
                rows.push(...next.rows);
            }
            return rows;
        } catch {
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return null;
        }
    };

    const fetchAllReturnedForExport = async (): Promise<GoldReturnedRow[] | null> => {
        try {
            const first = await getGoldReturnedReport(submittedFromDate, submittedToDate, selectedBranch, selectedCenter, 1, 5000);
            const rows = [...first.rows];
            for (let page = 2; page <= first.totalPages; page++) {
                const next = await getGoldReturnedReport(submittedFromDate, submittedToDate, selectedBranch, selectedCenter, page, 5000);
                rows.push(...next.rows);
            }
            return rows;
        } catch {
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return null;
        }
    };

    const formatCurrency = (v: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.trunc(v));

    const exportTakenCSV = async () => {
        if (takenTotalCount === 0) return;
        const fullRows = await fetchAllTakenForExport();
        if (!fullRows) return;
        const { headers, rows } = buildGoldTakenExportRows(fullRows);
        exportToCSV(`gold-taken-report-${submittedFromDate}-to-${submittedToDate}`, 'Gold Taken Report', headers, rows);
    };

    const exportTakenExcel = async () => {
        if (takenTotalCount === 0) return;
        const fullRows = await fetchAllTakenForExport();
        if (!fullRows) return;
        const { headers, rows } = buildGoldTakenExportRows(fullRows);
        const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Gold Taken Report', excelRows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Gold Taken Report');
        XLSX.writeFile(wb, `Gold_Taken_Report_${submittedFromDate}_to_${submittedToDate}.xlsx`);
    };

    const exportReturnedCSV = async () => {
        if (returnedTotalCount === 0) return;
        const fullRows = await fetchAllReturnedForExport();
        if (!fullRows) return;
        const { headers, rows } = buildGoldReturnedExportRows(fullRows);
        exportToCSV(`Gold_Return_Report_${submittedFromDate}_to_${submittedToDate}`, 'Gold Returned Report', headers, rows);
    };

    const exportReturnedExcel = async () => {
        if (returnedTotalCount === 0) return;
        const fullRows = await fetchAllReturnedForExport();
        if (!fullRows) return;
        // Gold Return: full Excel export with all 30 columns
        const excelRows: (string | number)[][] = [];
        excelRows.push(...reportHeaderRows('Gold Return Report'));
        excelRows.push([`From: ${submittedFromDate}`, `To: ${submittedToDate}`]);
        excelRows.push([]);
        excelRows.push([
            'S.No', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
            'Product Type', 'Loan Product', 'Loan ID', 'Member ID', 'Member Name',
            'Aadhaar Number', 'Phone Number', 'Loan Cycle', 'FDO Name',
            'Purpose Of Loan', 'Loan Index ID', 'LD Date', 'LD Time',
            'Start Date', 'End Date', 'Loan Principal', 'Loan Interest',
            'Loan Total Amount', 'Gold Weight (g)', 'Gold Value on Disbursement',
            'Funding Name', 'Loan Status', 'Loan Approve', 'Return Date', 'Hand Over To',
            CO_APPLICANT_MOBILE_HEADER,
        ]);
        fullRows.forEach((r) => {
            excelRows.push([
                r.sNo, r.branchId, r.branchName, r.centreId, r.centerName,
                r.productType, r.loanProduct, r.loanId, r.memberId, r.memberName,
                r.aadhaarNumber, r.phoneNumber, r.loanCycle, r.fdoName,
                r.purposeOfLoan, r.loanIndexId, r.ldDate, r.ldTime,
                r.startDate, r.endDate, truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest),
                truncateReportAmount(r.loanTotalAmount), r.goldWeight, truncateReportAmount(r.goldValueOnDisbursement),
                r.fundingName, r.loanStatus, r.loanApprove, r.returnDate, r.handOverTo,
                r.coApplicantMobile || '-',
            ]);
        });

        excelRows.push([
            `TOTAL (${fullRows.length} records)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            truncateReportAmount(returnedTotals.loanPrincipal), truncateReportAmount(returnedTotals.loanInterest), truncateReportAmount(returnedTotals.loanTotalAmount),
            Number(returnedTotals.goldWeight.toFixed(3)), truncateReportAmount(returnedTotals.goldValueOnDisbursement),
            '', '', '', '', '',
        ]);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(excelRows);
        ws['!cols'] = [
            { wch: 5 }, { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 22 },
            { wch: 16 }, { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 22 },
            { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 22 },
            { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
            { wch: 16 }, { wch: 14 }, { wch: 22 },
            { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 22 },
            { wch: 18 },
        ];
        applyExcelReportFont(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Gold Return Report');
        XLSX.writeFile(wb, `Gold_Return_Report_${submittedFromDate}_to_${submittedToDate}.xlsx`);
    };

    const buildGoldTakenExportRows = (rows: GoldTakenRow[]): { headers: (string | number)[]; rows: (string | number)[][] } => {
        const headers = ['Loan No', 'Client Name', 'Client ID', 'Center', 'Branch', 'Karat', 'Grams', 'Gold Value', 'Cash Given', 'Price/g', 'Disbursement Date', 'Item', 'Reference No.', 'Remark', ...MEMBER_CONTACT_HEADERS];
        const exportRows = rows.map((r) => [
            r.loanNumber, r.clientName, r.clientId, r.centerName, r.branchName, r.karatType,
            Number(r.gramCount.toFixed(3)), truncateReportAmount(r.goldTakenValue), truncateReportAmount(r.cashGiven), truncateReportAmount(r.pricePerGram), r.disbursementDate,
            r.itemDescription, r.goldTokenNo, r.remarks,
            ...memberContactValues(r),
        ]);
        if (rows.length > 0) {
            exportRows.push(['', 'Total', '', '', '', '', Number(takenTotals.gramCount.toFixed(3)), truncateReportAmount(takenTotals.goldTakenValue), truncateReportAmount(takenTotals.cashGiven), '', '', '', '', '']);
        }
        return { headers, rows: exportRows };
    };

    const buildGoldReturnedExportRows = (rows: GoldReturnedRow[]): { headers: (string | number)[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
            'Product Type', 'Loan Product', 'Loan ID', 'Member ID', 'Member Name',
            'Aadhaar Number', 'Phone Number', 'Loan Cycle', 'FDO Name',
            'Purpose Of Loan', 'Loan Index ID', 'LD Date', 'LD Time',
            'Start Date', 'End Date', 'Loan Principal', 'Loan Interest',
            'Loan Total Amount', 'Gold Weight (g)', 'Gold Value on Disbursement',
            'Funding Name', 'Loan Status', 'Loan Approve', 'Return Date', 'Hand Over To',
            'Item', 'Reference No.', 'Remark', CO_APPLICANT_MOBILE_HEADER,
        ];
        const exportRows = rows.map((r) => [
            r.sNo, r.branchId, r.branchName, r.centreId, r.centerName,
            r.productType, r.loanProduct, r.loanId, r.memberId, r.memberName,
            r.aadhaarNumber, r.phoneNumber, r.loanCycle, r.fdoName,
            r.purposeOfLoan, r.loanIndexId, r.ldDate, r.ldTime,
            r.startDate, r.endDate, truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest),
            truncateReportAmount(r.loanTotalAmount), r.goldWeight, truncateReportAmount(r.goldValueOnDisbursement),
            r.fundingName, r.loanStatus, r.loanApprove, r.returnDate, r.handOverTo,
            r.itemDescription, r.goldTokenNo, r.remarks, r.coApplicantMobile || '-',
        ]);

        if (rows.length > 0) {
            exportRows.push([
                `TOTAL (${rows.length} records)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
                truncateReportAmount(returnedTotals.loanPrincipal), truncateReportAmount(returnedTotals.loanInterest), truncateReportAmount(returnedTotals.loanTotalAmount),
                Number(returnedTotals.goldWeight.toFixed(3)), truncateReportAmount(returnedTotals.goldValueOnDisbursement),
                '', '', '', '', '', '', '', '',
            ]);
        }

        return { headers, rows: exportRows };
    };

    const handlePdfExport = async () => {
        const currentTotalCount = activeTab === 'taken' ? takenTotalCount : returnedTotalCount;
        if (currentTotalCount === 0) return;
        const fullRows = activeTab === 'taken' ? await fetchAllTakenForExport() : await fetchAllReturnedForExport();
        if (!fullRows) return;
        const { headers, rows } = activeTab === 'taken'
            ? buildGoldTakenExportRows(fullRows as GoldTakenRow[])
            : buildGoldReturnedExportRows(fullRows as GoldReturnedRow[]);
        const title = activeTab === 'taken' ? 'Gold Taken Report' : 'Gold Returned Report';
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const reportFont = await ensureReportFont(doc);
        await drawGoldReportPdf(doc, title, headers, rows, { subtitle: `From ${submittedFromDate} to ${submittedToDate}` }, reportFont);
        doc.save(`${activeTab === 'taken' ? 'Gold_Taken_Report' : 'Gold_Return_Report'}_${submittedFromDate}_to_${submittedToDate}.pdf`);
    };

    // Word-only presentation: same rows as PDF above, but the trailing Total row (when
    // present) is split off for distinct styling, and genuinely related column clusters
    // get a 2-row grouped header. Gold Taken (14 cols) stays default page size; Gold
    // Returned (33 cols, same scale as Demand Sheet) needs A3 landscape.
    const buildGoldTakenWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Loan No', span: 1 }, { label: 'Client Name', span: 1 }, { label: 'Client ID', span: 1 },
                { label: 'Center', span: 1 }, { label: 'Branch', span: 1 }, { label: 'Karat', span: 1 },
                { label: 'GOLD', span: 4 }, { label: 'Disbursement Date', span: 1 }, { label: 'Item', span: 1 },
                { label: 'Reference No.', span: 1 }, { label: 'Remark', span: 1 },
            ],
            subHeaders: ['Grams', 'Value', 'Cash Given', 'Price/g'],
            columnAlignments: ['center', 'left', 'center', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'center', 'left', 'center', 'left'],
            columnWidthWeights: [8, 12, 8, 10, 10, 7, 7, 8, 8, 7, 8, 10, 9, 10],
            totalsRow: rows[rows.length - 1],
        },
    });

    const buildGoldReturnedWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'BRANCH & CENTER', span: 4 }, { label: 'PRODUCT', span: 2 },
                { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 2 }, { label: 'CONTACT', span: 2 },
                { label: 'Loan Cycle', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Purpose Of Loan', span: 1 },
                { label: 'Loan Index ID', span: 1 }, { label: 'DISBURSEMENT', span: 2 }, { label: 'LOAN PERIOD', span: 2 },
                { label: 'LOAN AMOUNT', span: 3 }, { label: 'GOLD', span: 2 }, { label: 'Funding Name', span: 1 },
                { label: 'STATUS', span: 2 }, { label: 'Return Date', span: 1 }, { label: 'Hand Over To', span: 1 },
                { label: 'Item', span: 1 }, { label: 'Reference No.', span: 1 }, { label: 'Remark', span: 1 },
                { label: CO_APPLICANT_MOBILE_HEADER, span: 1 },
            ],
            subHeaders: [
                'Branch ID', 'Branch Name', 'Centre ID', 'Center Name',
                'Product Type', 'Loan Product',
                'Member ID', 'Member Name',
                'Aadhaar', 'Phone',
                'LD Date', 'LD Time',
                'Start Date', 'End Date',
                'Principal', 'Interest', 'Total',
                'Weight (g)', 'Value on Disbursement',
                'Loan Status', 'Loan Approve',
            ],
            columnAlignments: ['center', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'left', 'center', 'center', 'center', 'left', 'left', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'left', 'center', 'center', 'center', 'left', 'left', 'center', 'center', 'left', 'center'],
            columnWidthWeights: [3, 6, 9, 6, 9, 8, 9, 7, 7, 10, 8, 8, 7, 9, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 9, 6, 6, 7, 9, 8, 8, 9, 9],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWord = async () => {
        const currentTotalCount = activeTab === 'taken' ? takenTotalCount : returnedTotalCount;
        if (currentTotalCount === 0) return;
        const fullRows = activeTab === 'taken' ? await fetchAllTakenForExport() : await fetchAllReturnedForExport();
        if (!fullRows) return;
        const { headers, rows } = activeTab === 'taken'
            ? buildGoldTakenExportRows(fullRows as GoldTakenRow[])
            : buildGoldReturnedExportRows(fullRows as GoldReturnedRow[]);
        const title = activeTab === 'taken' ? 'Gold Taken Report' : 'Gold Returned Report';
        const { bodyRows, options } = activeTab === 'taken'
            ? buildGoldTakenWordOptions(rows)
            : buildGoldReturnedWordOptions(rows);
        await exportToWord(
            `${activeTab === 'taken' ? 'Gold_Taken_Report' : 'Gold_Return_Report'}_${submittedFromDate}_to_${submittedToDate}`,
            `${title.toUpperCase()}: ${submittedFromDate} to ${submittedToDate}`,
            headers,
            bodyRows,
            options
        );
    };

    const tabs: { key: ReportTab; label: string }[] = [
        { key: 'taken', label: 'Gold Taken Report' },
        { key: 'returned', label: 'Gold Returned Report' },
    ];

    const currentRows = activeTab === 'taken' ? takenRows : returnedRows;

    const fmtCount = (n: number) => n.toLocaleString('en-IN');
    const fmtGrams = (n: number) => `${n.toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`;
    const summaryCards: { label: string; value: string; sub?: string; icon: typeof Users; tone: string }[] =
        activeTab === 'taken'
            ? [
                { label: 'Member Count', value: fmtCount(takenTotals.memberCount), sub: `Gold Loans: ${fmtCount(takenTotalCount)}`, icon: Users, tone: 'purple' },
                { label: 'Gold Weight', value: fmtGrams(takenTotals.gramCount), icon: Scale, tone: 'amber' },
                { label: 'Gold Value', value: formatReportAmount(takenTotals.goldTakenValue), icon: Coins, tone: 'green' },
                { label: 'Cash Given', value: formatReportAmount(takenTotals.cashGiven), icon: Wallet, tone: 'blue' },
            ]
            : [
                { label: 'Member Count', value: fmtCount(returnedTotals.memberCount), sub: `Gold Returns: ${fmtCount(returnedTotalCount)}`, icon: Users, tone: 'purple' },
                { label: 'Gold Weight', value: fmtGrams(returnedTotals.goldWeight), icon: Scale, tone: 'amber' },
                { label: 'Gold Value on Disbursement', value: formatReportAmount(returnedTotals.goldValueOnDisbursement), icon: Coins, tone: 'green' },
                {
                    label: 'Loan Amount',
                    value: formatReportAmount(returnedTotals.loanTotalAmount),
                    sub: `Principal: ${formatReportAmount(returnedTotals.loanPrincipal)} · Interest: ${formatReportAmount(returnedTotals.loanInterest)}`,
                    icon: Banknote,
                    tone: 'blue',
                },
            ];
    // Full static class strings so Tailwind's JIT picks them up.
    const toneClasses: Record<string, { card: string; label: string; value: string; iconBg: string; icon: string }> = {
        purple: { card: 'border-purple-200 from-purple-50 to-purple-50/50 dark:border-purple-800/50 dark:from-purple-950/20 dark:to-purple-950/20', label: 'text-purple-700 dark:text-purple-300', value: 'dark:text-purple-100', iconBg: 'bg-purple-100 dark:bg-purple-900/50', icon: 'text-purple-600 dark:text-purple-400' },
        amber: { card: 'border-amber-200 from-amber-50 to-amber-50/50 dark:border-amber-800/50 dark:from-amber-950/20 dark:to-amber-950/20', label: 'text-amber-700 dark:text-amber-300', value: 'dark:text-amber-100', iconBg: 'bg-amber-100 dark:bg-amber-900/50', icon: 'text-amber-600 dark:text-amber-400' },
        green: { card: 'border-primary/20 from-green-50 to-green-50/50 dark:border-sidebar-accent/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20', label: 'text-sidebar-accent dark:text-green-300', value: 'dark:text-green-100', iconBg: 'bg-brand-green-tint dark:bg-brand-green-darker/50', icon: 'text-primary' },
        blue: { card: 'border-blue-200 from-blue-50 to-blue-50/50 dark:border-blue-800/50 dark:from-blue-950/20 dark:to-blue-950/20', label: 'text-blue-700 dark:text-blue-300', value: 'dark:text-blue-100', iconBg: 'bg-blue-100 dark:bg-blue-900/50', icon: 'text-blue-600 dark:text-blue-400' },
    };
    const currentTotalCount = activeTab === 'taken' ? takenTotalCount : returnedTotalCount;
    const currentTotalPages = activeTab === 'taken' ? takenTotalPages : returnedTotalPages;
    const currentPage = activeTab === 'taken' ? takenPage : returnedPage;

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                    <Coins className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-slate-100">Gold Loan Reports</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">View gold taken and returned transactions</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-brand-green-tint dark:bg-sidebar-accent p-1 rounded-lg w-fit">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => { setActiveTab(t.key); setHasSearched(false); }}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                            activeTab === t.key
                                ? 'bg-white dark:bg-sidebar-accent text-foreground dark:text-slate-100 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-sidebar-accent'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-4 pb-4">
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">Branch</Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="h-9 w-48 text-sm">
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
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">Center</Label>
                            <Select
                                value={selectedCenter}
                                onValueChange={setSelectedCenter}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="h-9 w-48 text-sm">
                                    <SelectValue placeholder="-- ALL CENTERS --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL CENTERS --</SelectItem>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">From Date</Label>
                            <DateInput
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="h-9 w-40 text-sm"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">To Date</Label>
                            <DateInput
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                className="h-9 w-40 text-sm"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">Search</Label>
                            <Input
                                placeholder="Loan no, client, center, branch, item, reference, remark..."
                                className="h-9 w-72 text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                            />
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={isLoading}
                            className="h-9 bg-yellow-600 hover:bg-yellow-700 text-white"
                        >
                            {isLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                            Search
                        </Button>
                        {hasSearched && currentTotalCount > 0 && (
                            <ExportDropdown
                                onExportPDF={handlePdfExport}
                                onExportExcel={activeTab === 'returned' ? exportReturnedExcel : exportTakenExcel}
                                onExportCSV={activeTab === 'returned' ? exportReturnedCSV : exportTakenCSV}
                                onExportWord={handleExportWord}
                                reportSlug={getReportExportMode(activeTab === 'returned' ? 'gold-returned' : 'gold-taken') === 'REQUEST_QUEUE' ? (activeTab === 'returned' ? 'gold-returned' : 'gold-taken') : undefined}
                                canExport={canExportReport(activeTab === 'returned' ? 'gold-returned' : 'gold-taken')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedToDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-9 ml-auto"
                            />
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Results */}
            {isLoading ? (
                <PageLoader fullScreen={false} />
            ) : hasSearched ? (
                <Card>
                    <CardHeader className="pb-2 space-y-3">
                        <ReportHeader
                            title={activeTab === 'taken' ? 'Gold Taken Report' : 'Gold Returned Report'}
                            subtitle={`From ${submittedFromDate} to ${submittedToDate}`}
                        />
                        <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200">
                            {activeTab === 'taken' ? 'Gold Taken' : 'Gold Returned'} — {currentTotalCount} records
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="grid grid-cols-1 gap-4 border-b p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
                            {summaryCards.map((c) => {
                                const tone = toneClasses[c.tone];
                                const Icon = c.icon;
                                return (
                                    <Card key={c.label} className={cn('border-2 bg-gradient-to-br', tone.card)}>
                                        <CardContent className="pt-6">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className={cn('text-sm font-medium', tone.label)}>{c.label}</p>
                                                    <p className={cn('mt-2 text-2xl font-bold text-foreground', tone.value)}>{c.value}</p>
                                                    {c.sub && <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>}
                                                </div>
                                                <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', tone.iconBg)}>
                                                    <Icon className={cn('h-6 w-6', tone.icon)} />
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                        {currentRows.length === 0 ? (
                            <div className="text-center py-10 text-slate-500 text-sm">No records found for the selected period.</div>
                        ) : activeTab === 'taken' ? (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                            <TableHead>Loan No</TableHead>
                                            <TableHead>Client</TableHead>
                                            <TableHead>{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                            <TableHead>Center</TableHead>
                                            <TableHead>Branch</TableHead>
                                            <TableHead>Karat</TableHead>
                                            <TableHead className="text-right">Grams</TableHead>
                                            <TableHead className="text-right">Price/g</TableHead>
                                            <TableHead className="text-right">Gold Value</TableHead>
                                            <TableHead className="text-right">Cash Given</TableHead>
                                            <TableHead>Disbursement Date</TableHead>
                                            <TableHead>Item</TableHead>
                                            <TableHead>Reference No.</TableHead>
                                            <TableHead>Remark</TableHead>
                                            <TableHead className="text-right">Photos</TableHead>
                                            <TableHead className="text-center">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {(takenRows as GoldTakenRow[]).map((row, i) => (
                                            <TableRow key={i} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                                <TableCell className="font-mono text-xs font-medium">{row.loanNumber}</TableCell>
                                                <TableCell className="text-sm">
                                                    <div>{row.clientName}</div>
                                                    <div className="text-xs text-slate-500">{row.clientId}</div>
                                                </TableCell>
                                                <TableCell><MemberContactCell row={row} /></TableCell>
                                                <TableCell className="text-sm">{row.centerName}</TableCell>
                                                <TableCell className="text-sm">{row.branchName}</TableCell>
                                                <TableCell>
                                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                                                        {row.karatType}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right text-sm font-medium">{row.gramCount.toFixed(3)}g</TableCell>
                                                <TableCell className="text-right text-sm">{formatCurrency(row.pricePerGram)}</TableCell>
                                                <TableCell className="text-right text-sm font-medium">{formatCurrency(row.goldTakenValue)}</TableCell>
                                                <TableCell className="text-right text-sm">{formatCurrency(row.cashGiven)}</TableCell>
                                                <TableCell className="text-sm">{row.disbursementDate}</TableCell>
                                                <TableCell className="text-sm">{row.itemDescription || '—'}</TableCell>
                                                <TableCell className="text-sm">{row.goldTokenNo || '—'}</TableCell>
                                                <TableCell className="text-sm">{row.remarks || '—'}</TableCell>
                                                <TableCell className="text-right text-sm">{row.photoCount}</TableCell>
                                                <TableCell className="text-center">
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openDetail('taken', row)}>
                                                        <Eye className="h-4 w-4 text-sidebar-accent" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {takenTotalCount > 0 && (
                                            <TableRow className="bg-brand-green-tint dark:bg-sidebar-accent font-semibold">
                                                <TableCell colSpan={6} className="text-sm">Total</TableCell>
                                                <TableCell className="text-right text-sm">{takenTotals.gramCount.toFixed(3)}g</TableCell>
                                                <TableCell />
                                                <TableCell className="text-right text-sm">{formatCurrency(takenTotals.goldTakenValue)}</TableCell>
                                                <TableCell className="text-right text-sm">{formatCurrency(takenTotals.cashGiven)}</TableCell>
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                                <TableCell />
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            /* ── Gold Return Report — 33 columns ── */
                            <div className="overflow-x-auto">
                                <Table className="min-w-[3200px] text-xs">
                                    <TableHeader>
                                        <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                            <TableHead className="whitespace-nowrap px-2">S.No</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Branch ID</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Branch Name</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Centre ID</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Center Name</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Product Type</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Loan Product</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Loan ID</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Member ID</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Member Name</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Aadhaar Number</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Phone Number</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">{CO_APPLICANT_MOBILE_HEADER}</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-center">Loan Cycle</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">FDO Name</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Purpose Of Loan</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Loan Index ID</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">LD Date</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">LD Time</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Start Date</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">End Date</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-right">Loan Principal</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-right">Loan Interest</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-right">Loan Total Amount</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-right">Gold Weight</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-right">Gold Value on Disbursement</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Funding Name</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Loan Status</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Loan Approve</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Return Date</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Hand Over To</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Item</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Reference No.</TableHead>
                                            <TableHead className="whitespace-nowrap px-2">Remark</TableHead>
                                            <TableHead className="whitespace-nowrap px-2 text-center">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {(returnedRows as GoldReturnedRow[]).map((row, i) => (
                                            <TableRow key={i} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30 border-b border-slate-100">
                                                <TableCell className="px-2 py-1.5">{row.sNo}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.branchId}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.branchName}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.centreId}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.centerName}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.productType}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.loanProduct}</TableCell>
                                                <TableCell className="px-2 py-1.5 font-mono whitespace-nowrap">{row.loanId}</TableCell>
                                                <TableCell className="px-2 py-1.5 font-mono whitespace-nowrap">{row.memberId}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.memberName}</TableCell>
                                                <TableCell className="px-2 py-1.5 font-mono">{row.aadhaarNumber}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.phoneNumber}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.coApplicantMobile || '-'}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-center">{row.loanCycle}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.fdoName}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.purposeOfLoan}</TableCell>
                                                <TableCell className="px-2 py-1.5 font-mono whitespace-nowrap">{row.loanIndexId}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.ldDate}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.ldTime}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.startDate}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.endDate}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right font-medium">{formatCurrency(row.loanPrincipal)}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right">{formatCurrency(row.loanInterest)}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right font-medium">{formatCurrency(row.loanTotalAmount)}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right">{row.goldWeight.toFixed(3)}g</TableCell>
                                                <TableCell className="px-2 py-1.5 text-right">{formatCurrency(row.goldValueOnDisbursement)}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.fundingName}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">
                                                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                                        {row.loanStatus}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.loanApprove}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap font-medium text-yellow-700 dark:text-yellow-400">{row.returnDate}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap text-sidebar-accent dark:text-emerald-400">{row.handOverTo}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.itemDescription || '—'}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.goldTokenNo || '—'}</TableCell>
                                                <TableCell className="px-2 py-1.5 whitespace-nowrap">{row.remarks || '—'}</TableCell>
                                                <TableCell className="px-2 py-1.5 text-center">
                                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openDetail('returned', row)}>
                                                        <Eye className="h-4 w-4 text-sidebar-accent" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        {returnedTotalCount > 0 && (
                                            <TableRow className="bg-brand-green-tint dark:bg-sidebar-accent font-semibold">
                                                <TableCell className="px-2 py-2" colSpan={21}>
                                                    TOTAL ({returnedTotalCount} records)
                                                </TableCell>
                                                <TableCell className="px-2 py-2 text-right">
                                                    {formatCurrency(returnedTotals.loanPrincipal)}
                                                </TableCell>
                                                <TableCell className="px-2 py-2 text-right">
                                                    {formatCurrency(returnedTotals.loanInterest)}
                                                </TableCell>
                                                <TableCell className="px-2 py-2 text-right">
                                                    {formatCurrency(returnedTotals.loanTotalAmount)}
                                                </TableCell>
                                                <TableCell className="px-2 py-2 text-right">
                                                    {returnedTotals.goldWeight.toFixed(3)}g
                                                </TableCell>
                                                <TableCell className="px-2 py-2 text-right">
                                                    {formatCurrency(returnedTotals.goldValueOnDisbursement)}
                                                </TableCell>
                                                <TableCell className="px-2 py-2" colSpan={9} />
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                        {currentTotalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Page {currentPage} of {currentTotalPages} · {currentTotalCount} record{currentTotalCount !== 1 ? 's' : ''}
                                </p>
                                <div className="flex gap-1">
                                    <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1 || isLoading}>
                                        Previous
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.min(currentTotalPages, currentPage + 1))} disabled={currentPage === currentTotalPages || isLoading}>
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ) : null}

            <GoldRecordDetailModal
                type={viewingType}
                row={viewingRow}
                open={!!viewingRow}
                onClose={() => setViewingRow(null)}
            />
        </div>
    );
}
