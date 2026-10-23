'use client';

import { useState } from 'react';
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
import { Calendar, RefreshCw, Download, Loader2, FileText, FileType, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCCRData } from '@/app/lib/actions/reports';
import { format } from 'date-fns';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawCcrReport } from '@/app/lib/reports/ccr-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { formatReportAmount, formatReportAmountPlain, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { Input } from '@/components/ui/input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, memberContactExcelCells, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';

// Type for the report row
export type CCRRow = {
    transDate: string;
    centerName: string;
    clientName: string;
    loanAmt: number;
    loanAc: string;
    opnArrPri: number;
    opnArrInt: number;
    curDmdPri: number;
    curDmdInt: number;
    totDmdPri: number;
    totDmdInt: number;
    totPriColl: number;
    totIntColl: number;
    savingsAmt: number;
    doneAt: string;
    collType: string;
    transType: string;
    refNo: string;
    empName: string;
} & MemberContactFields;

import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { useEffect } from 'react';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { DateInput } from '@/components/ui/date-input';

// Format currency helper — truncates (not rounds) to whole rupees, matches the
// project-wide report-amount convention (see app/lib/utils/format-amount.ts).
const formatCurrency = formatReportAmount;

type BranchOption = { id: string; name: string; code: string };

export function CCRClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next Show click, so pagination and
    // exports keep using the last-submitted range even if fromDate/tillDate above are edited
    // afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<CCRRow[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    // Server-side: member name / ID / Aadhaar / mobile / co-applicant mobile.
    const [search, setSearch] = useState('');
    const PAGE_SIZE = 25;

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        // Fetch branches + centers on mount
        const fetchCenters = async () => {
            try {
                const centerList = await getCentersForDropdown();
                setCenters(centerList);
            } catch (error) {
                console.error("Failed to fetch centers", error);
                toast({
                    title: "Error",
                    description: "Could not load centers.",
                    variant: "destructive"
                });
            }
        };
        fetchCenters();

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, [toast]);

    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the same
    // click — reading submittedFromDate/submittedTillDate here would otherwise use the
    // pre-update (stale) state, since the setSubmitted* calls in handleShow haven't re-rendered
    // yet. Callers other than handleShow (pagination, export) omit it and get the
    // last-submitted snapshot, which is the frozen-until-next-Show behavior they need.
    const fetchPage = async (pageArg: number, dateOverride?: { fromDate: string; tillDate: string }): Promise<{ ok: boolean; count: number }> => {
        setIsLoading(true);
        try {
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effTillDate = dateOverride?.tillDate ?? submittedTillDate;
            const result = await getCCRData(selectedCenter, effFromDate, effTillDate, selectedBranch, pageArg, PAGE_SIZE, undefined, search.trim() || null);
            setData(result.rows);
            setTotalCount(result.totalCount);
            setTotalPages(result.totalPages || 1);
            setPage(result.page ?? pageArg);
            setShowReport(true);
            return { ok: true, count: result.totalCount };
        } catch (error) {
            console.error(error);
            toast({
                title: 'Error',
                description: 'Failed to fetch report data. Ensure database is updated.',
                variant: 'destructive',
            });
            return { ok: false, count: 0 };
        } finally {
            setIsLoading(false);
        }
    };

    const handleShow = async () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both From Date and Till Date.',
                variant: 'destructive',
            });
            return;
        }

        if (new Date(fromDate) > new Date(tillDate)) {
            toast({
                title: 'Invalid date range',
                description: 'From Date cannot be later than Till Date.',
                variant: 'destructive',
            });
            return;
        }

        const snapshot = { fromDate, tillDate };
        setSubmittedFromDate(fromDate);
        setSubmittedTillDate(tillDate);
        const { ok, count } = await fetchPage(1, snapshot);
        if (ok) {
            toast({
                title: 'Report generated',
                description: `Found ${count} record${count !== 1 ? 's' : ''}.`,
            });
        }
    };

    const handlePageChange = (p: number) => {
        fetchPage(p);
    };

    // Fetches every row matching the current filters (not just the on-screen page) —
    // used only by the export handlers below, so exports keep capturing the full
    // report instead of whatever happens to be on screen.
    const fetchAllForExport = async (): Promise<CCRRow[] | null> => {
        try {
            const result = await getCCRData(selectedCenter, submittedFromDate, submittedTillDate, selectedBranch, 1, Math.max(totalCount, 1), undefined, search.trim() || null);
            return result.rows;
        } catch (error) {
            console.error(error);
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return null;
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('all');
        setFromDate(new Date().toISOString().split('T')[0]);
        setTillDate(new Date().toISOString().split('T')[0]);
        setSubmittedFromDate(new Date().toISOString().split('T')[0]);
        setSubmittedTillDate(new Date().toISOString().split('T')[0]);
        setShowReport(false);
        setData([]);
        setPage(1);
        setTotalPages(1);
        setTotalCount(0);
    };

    const handleExport = async () => {
        if (!showReport || totalCount === 0) {
            toast({
                title: 'No data',
                description: 'Generate report before exporting.',
                variant: 'destructive',
            });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;

        try {
            // Prepare data for Excel
            const excelData = fullData.map(row => ({
                'Trans Date': row.transDate,
                'Center Name': row.centerName,
                'Client Name': row.clientName,
                'Loan Amt': truncateReportAmount(row.loanAmt),
                'Loan A/c': row.loanAc,
                'Opn Arr Pri': truncateReportAmount(row.opnArrPri),
                'Opn Arr Int': truncateReportAmount(row.opnArrInt),
                'Cur Dmd Pri': truncateReportAmount(row.curDmdPri),
                'Cur Dmd Int': truncateReportAmount(row.curDmdInt),
                'Tot Dmd Pri': truncateReportAmount(row.totDmdPri),
                'Tot Dmd Int': truncateReportAmount(row.totDmdInt),
                'Tot Pri Coll': truncateReportAmount(row.totPriColl),
                'Tot Int Coll': truncateReportAmount(row.totIntColl),
                ...(loanAdvanceEnabled ? { 'Loan Advance': truncateReportAmount(row.savingsAmt) } : {}),
                'Done At': row.doneAt,
                'Coll Type': row.collType,
                'Trans Type': row.transType,
                'Ref No': row.refNo,
                'Emp Name': row.empName,
                ...memberContactExcelCells(row),
            }));

            // Create worksheet
            const ws = buildReportSheet('Client Collection Report', excelData);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);

            // Create workbook
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Collection Report");

            // Generate filename with date
            const fileName = `Client_Collection_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;

            // Write file
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export successful',
                description: `Downloaded ${fileName}`,
            });
        } catch (error) {
            console.error(error);
            toast({
                title: 'Export failed',
                description: 'Could not generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the exact same field mapping used by handleExport above (kept
    // separate so handleExport is left untouched).
    const buildCCRExportRows = (fullData: CCRRow[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Trans Date', 'Center Name', 'Client Name', 'Loan Amt', 'Loan A/c',
            'Opn Arr Pri', 'Opn Arr Int', 'Cur Dmd Pri', 'Cur Dmd Int',
            'Tot Dmd Pri', 'Tot Dmd Int', 'Tot Pri Coll', 'Tot Int Coll',
            ...(loanAdvanceEnabled ? ['Loan Advance'] : []),
            'Done At', 'Coll Type', 'Trans Type', 'Ref No', 'Emp Name',
            ...MEMBER_CONTACT_HEADERS,
        ];
        const rows: (string | number)[][] = fullData.map(row => [
            row.transDate, row.centerName, row.clientName, formatReportAmountPlain(row.loanAmt), row.loanAc,
            formatReportAmountPlain(row.opnArrPri), formatReportAmountPlain(row.opnArrInt), formatReportAmountPlain(row.curDmdPri), formatReportAmountPlain(row.curDmdInt),
            formatReportAmountPlain(row.totDmdPri), formatReportAmountPlain(row.totDmdInt), formatReportAmountPlain(row.totPriColl), formatReportAmountPlain(row.totIntColl),
            ...(loanAdvanceEnabled ? [formatReportAmountPlain(row.savingsAmt)] : []),
            row.doneAt, row.collType, row.transType, row.refNo, row.empName,
            ...memberContactValues(row),
        ]);
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        const { headers, rows } = buildCCRExportRows(fullData);
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawCcrReport(doc, { headers, rows }, { subtitle: `From ${submittedFromDate} to ${submittedTillDate}` }, reportFont);
        doc.save(`Client_Collection_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
        toast({ title: 'PDF exported', description: 'Report downloaded as PDF.' });
    };

    const handleExportCSV = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        const { headers, rows } = buildCCRExportRows(fullData);
        exportToCSV(`Client_Collection_Report_${format(new Date(), 'yyyyMMdd_HHmm')}`, 'CLIENT COLLECTION REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above. No totals row exists in this
    // report today (identical column shape to MCR). Opening Arrear, Current Demand,
    // Total Demand, and Total Collected Principal-Interest pairs each get a light 2-row
    // grouped header — genuine related fields; the other 11 columns stay standalone.
    const buildCcrWordOptions = (): WordExportOptions => ({
        groupHeaders: [
            { label: 'Trans Date', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'Client Name', span: 1 },
            { label: 'Loan Amt', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'OPENING ARREAR', span: 2 },
            { label: 'CURRENT DEMAND', span: 2 }, { label: 'TOTAL DEMAND', span: 2 }, { label: 'TOTAL COLLECTED', span: 2 },
            ...(loanAdvanceEnabled ? [{ label: 'Loan Advance', span: 1 }] : []), { label: 'Done At', span: 1 }, { label: 'Coll Type', span: 1 },
            { label: 'Trans Type', span: 1 }, { label: 'Ref No', span: 1 }, { label: 'Emp Name', span: 1 },
        ],
        subHeaders: ['Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
        columnAlignments: [
            'center', 'left', 'left', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right',
            ...(loanAdvanceEnabled ? (['right'] as const) : []), 'center', 'center', 'center', 'center', 'left',
        ],
        columnWidthWeights: [7, 10, 12, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, ...(loanAdvanceEnabled ? [7] : []), 7, 7, 7, 8, 9],
    });

    const handleExportWordFile = async () => {
        if (!showReport || totalCount === 0) {
            toast({ title: 'No data', description: 'Generate report before exporting.', variant: 'destructive' });
            return;
        }
        const fullData = await fetchAllForExport();
        if (!fullData) return;
        const { headers, rows } = buildCCRExportRows(fullData);
        await exportToWord(`Client_Collection_Report_${format(new Date(), 'yyyyMMdd_HHmm')}`, 'CLIENT COLLECTION REPORT', headers, rows, buildCcrWordOptions());
    };

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">Client Collection Report</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger id="branchName" className="h-11">
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
                                Center Name
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading}>
                                <SelectTrigger id="centerName" className="h-11">
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

                        {/* From Date */}
                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
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

                        {/* Till Date */}
                        <div className="space-y-2">
                            <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Till Date
                            </Label>
                            <div className="relative">
                                <DateInput
                                    id="tillDate"
                                    value={tillDate}
                                    onChange={(e) => setTillDate(e.target.value)}
                                    className="h-11 pl-10"
                                    disabled={isLoading}
                                />
                                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="flex-1 h-11 bg-gradient-to-r from-primary to-primary text-white shadow-lg transition-all hover:from-sidebar-accent hover:to-primary hover:shadow-xl"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    'Show'
                                )}
                            </Button>
                            <Button
                                onClick={handleReset}
                                disabled={isLoading}
                                variant="destructive"
                                className="h-11 w-11 shadow-lg transition-all hover:shadow-xl p-0 flex items-center justify-center"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </Button>
                            <ExportDropdown
                                onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && showReport ? handleExport : undefined}
                                onExportCSV={!isLoading && showReport ? handleExportCSV : undefined}
                                onExportWord={!isLoading && showReport ? handleExportWordFile : undefined}
                                reportSlug={!isLoading && showReport && getReportExportMode('ccr') === 'REQUEST_QUEUE' ? 'ccr' : undefined}
                                canExport={canExportReport('ccr')}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-11 bg-sidebar-accent text-white border-sidebar-accent shadow-lg transition-all hover:bg-brand-green-darker hover:shadow-xl dark:bg-sidebar-accent dark:border-sidebar-accent dark:hover:bg-sidebar-accent/80"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-0">
                        <ReportHeader title="Client Collection Report" />
                        <div className="flex justify-end pb-2">
                            <Input
                                placeholder="Name, ID, Aadhaar or mobile — Enter to search"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') fetchPage(1); }}
                                className="h-9 w-full max-w-xs"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-max w-full">
                                <TableHeader className="bg-gradient-to-r from-brand-green-darker via-sidebar-accent to-brand-green-darker text-white sticky top-0 z-10 shadow-md">
                                    <TableRow className="hover:bg-brand-green-darker/90 border-b border-sidebar-accent">
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Trans Date</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Center Name</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Client Name</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Loan Amt</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Loan A/c</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Opn Arr Pri</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Opn Arr Int</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Cur Dmd Pri</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Cur Dmd Int</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Tot Dmd Pri</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Tot Dmd Int</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Tot Pri Coll</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Tot Int Coll</TableHead>
                                        {loanAdvanceEnabled && (
                                            <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap text-right">Loan Advance</TableHead>
                                        )}
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Done At</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Coll Type</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Trans Type</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Reference No</TableHead>
                                        <TableHead className="px-3 py-4 font-bold text-white text-xs whitespace-nowrap">Emp Name</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={loanAdvanceEnabled ? 20 : 19} className="px-4 py-8 text-center text-slate-500">
                                                No data available for the selected filters
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((row, index) => (
                                            <TableRow
                                                key={index}
                                                className="bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80"
                                            >
                                                <TableCell className="px-3 py-3 text-xs text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{row.transDate}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs font-medium text-foreground dark:text-slate-100 border-r border-slate-100 dark:border-sidebar-accent">{row.centerName}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{row.clientName}</TableCell>
                                                <TableCell className="px-3 py-3 text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent"><MemberContactCell row={row} /></TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-right text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.loanAmt)}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{row.loanAc}</TableCell>

                                                <TableCell className="px-3 py-3 text-xs text-right text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.opnArrPri)}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-right text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.opnArrInt)}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-right text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.curDmdPri)}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-right text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.curDmdInt)}</TableCell>

                                                <TableCell className="px-3 py-3 text-xs text-right font-semibold text-foreground dark:text-slate-100 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.totDmdPri)}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-right font-semibold text-foreground dark:text-slate-100 border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.totDmdInt)}</TableCell>

                                                <TableCell className="px-3 py-3 text-xs text-right text-green-700 dark:text-green-400 font-bold border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.totPriColl)}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-right text-green-700 dark:text-green-400 font-bold border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.totIntColl)}</TableCell>
                                                {loanAdvanceEnabled && (
                                                    <TableCell className="px-3 py-3 text-xs text-right text-emerald-700 dark:text-emerald-400 font-bold border-r border-slate-100 dark:border-sidebar-accent">{formatCurrency(row.savingsAmt)}</TableCell>
                                                )}

                                                <TableCell className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap border-r border-slate-100 dark:border-sidebar-accent">{row.doneAt}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{row.collType}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-sidebar-accent dark:text-slate-300 border-r border-slate-100 dark:border-sidebar-accent">{row.transType}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 border-r border-slate-100 dark:border-sidebar-accent">{row.refNo}</TableCell>
                                                <TableCell className="px-3 py-3 text-xs text-sidebar-accent dark:text-slate-300">{row.empName}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                                </p>
                                <div className="flex gap-1">
                                    <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                                        Previous
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages || isLoading}>
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <Download className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select filters and click Show to view the Client Collection Report
                    </p>
                </Card>
            )}
        </div>
    );
}

// Helper to format date if needed, though Server Action already returns formatted string
// format function imported from date-fns
