'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import {
    RefreshCw,
    Download,
    Loader2,
    Search,
    Users,
    Clock,
    TrendingUp,
    Calendar,
    FileText,
    Phone,
    ChevronLeft,
    ChevronRight,
    Filter,
    ArrowRightLeft,
    Wallet,
    AlertCircle,
    Building2,
    RotateCcw,
    FileBarChart,
    FileType,
    FileOutput,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import * as XLSX from 'xlsx-js-style';
import { format, isValid, parseISO } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { MEMBER_CONTACT_HEADERS, memberContactValues, matchesMemberSearch, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';
import { usePermission } from '@/app/hooks/usePermission';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';

const formatDate = (dateValue: string | null | undefined, formatString: string = 'dd MMM yy') => {
    if (!dateValue) return 'N/A';
    try {
        const d = new Date(dateValue);
        return isValid(d) ? format(d, formatString) : 'N/A';
    } catch {
        return 'N/A';
    }
};

type DetailedRecord = {
    branch: string;
    center: string;
    accountId: string;
    /** Has an active loan cycle — false means still a Member, not yet a Client */
    hasLoan?: boolean;
    clientName: string;
    phone: string;
    dateOfJoining: string;
    disbursalDate: string;
    maturityDate: string | null;
    lastPaidDate: string | null;
    loanCycle: number;
    loanAmount: number;
    repaidAmount: number;
    principleBalance: number;
    closingArrPri: number;
    arrearType: string;
    balanceDues: number;
} & MemberContactFields;

type SummaryRecord = {
    branchName: string;
    center: string;
    noOsNewClient: number;
    client4Weeks: number;
    os4Weeks: number;
    client10Weeks: number;
    os10Weeks: number;
    defaultClients: number;
    osAmount: number;
};

type BranchOption = { id: string; name: string; code: string };

export function WaitingBorrowersClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [reportType, setReportType] = useState<'DETAILED' | 'SUMMARY'>('DETAILED');
    const [duration, setDuration] = useState<string>('0');
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        getCentersForDropdown().then(setCenters).catch(() => {});
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    const handleShow = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ type: reportType, duration });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
            const response = await apiClient.get<any[]>(
                `/reports/client/waiting-borrowers?${params.toString()}`
            );
            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
                toast({
                    title: 'Sync Complete',
                    description: `Retrieved ${response.data.length} records for ${reportType} analysis.`,
                });
            } else {
                toast({
                    title: 'Query Failed',
                    description: response.error || 'The system was unable to pull the borrower registry.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Network Error',
                description: 'Failed to connect to the reporting engine.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setReportType('DETAILED');
        setDuration('0');
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setData([]);
        setSearchQuery('');
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (data.length === 0) return;

        try {
            const { headers, rows } = buildWaitingBorrowersExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));

            const ws = buildReportSheet('Waiting Borrowers Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Waiting Borrowers ${reportType}`);
            const fileName = `Waiting_Borrowers_${reportType}_${format(new Date(), 'yyyyMMdd')}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Success',
                description: 'The registry has been compiled and downloaded.',
            });
        } catch (error) {
            toast({
                title: 'Export Error',
                description: 'Failed to generate the Excel report.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildWaitingBorrowersExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        if (reportType === 'DETAILED') {
            const headers = ['Branch', 'Center', 'Account ID', 'Name', 'Member / Client', 'Phone', 'Joining Date', 'Disbursal', 'Balance', 'Arrear Type', ...MEMBER_CONTACT_HEADERS];
            const rows: (string | number)[][] = (filteredData as DetailedRecord[]).map(item => [
                item.branch, item.center, item.accountId, item.clientName,
                getPersonLabel(!!item.hasLoan).singular, item.phone,
                format(new Date(item.dateOfJoining), 'dd/MM/yyyy'), item.disbursalDate,
                truncateReportAmount(item.principleBalance), item.arrearType,
                ...memberContactValues(item),
            ]);
            if (filteredData.length > 0) {
                const totalBalance = (filteredData as DetailedRecord[]).reduce((s, i) => s + (i.principleBalance || 0), 0);
                rows.push(['Grand Total:', '', '', '', '', '', '', '', truncateReportAmount(totalBalance), '']);
            }
            return { headers, rows };
        }
        const headers = ['Branch', 'Center', 'New/No OS', '4-Week Overdue', '4-Week OS', '10-Week Overdue', '10-Week OS', 'Total Defaults', 'Total OS'];
        const rows: (string | number)[][] = (filteredData as SummaryRecord[]).map(item => [
            item.branchName, item.center, item.noOsNewClient, item.client4Weeks, truncateReportAmount(item.os4Weeks),
            item.client10Weeks, truncateReportAmount(item.os10Weeks), item.defaultClients, truncateReportAmount(item.osAmount),
        ]);
        if (filteredData.length > 0) {
            const sumRecords = filteredData as SummaryRecord[];
            const tNew = sumRecords.reduce((s, i) => s + (i.noOsNewClient || 0), 0);
            const t4C = sumRecords.reduce((s, i) => s + (i.client4Weeks || 0), 0);
            const t4OS = sumRecords.reduce((s, i) => s + (i.os4Weeks || 0), 0);
            const t10C = sumRecords.reduce((s, i) => s + (i.client10Weeks || 0), 0);
            const t10OS = sumRecords.reduce((s, i) => s + (i.os10Weeks || 0), 0);
            const tDef = sumRecords.reduce((s, i) => s + (i.defaultClients || 0), 0);
            const tOS = sumRecords.reduce((s, i) => s + (i.osAmount || 0), 0);
            rows.push(['Grand Total:', '', tNew, t4C, truncateReportAmount(t4OS), t10C, truncateReportAmount(t10OS), tDef, truncateReportAmount(tOS)]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) return;
        const { jsPDF } = await import('jspdf');
        const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
        const { drawWaitingBorrowersReport } = await import('@/app/lib/reports/waiting-borrowers-pdf');
        const { headers, rows } = buildWaitingBorrowersExportRows();
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawWaitingBorrowersReport(doc, headers, rows, { reportType }, reportFont);
        doc.save(`Waiting_Borrowers_${reportType}_${format(new Date(), 'yyyyMMdd')}.pdf`);
        toast({ title: 'Export Success', description: 'The registry has been compiled and downloaded.' });
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;
        const { headers, rows } = buildWaitingBorrowersExportRows();
        exportToCSV(`Waiting_Borrowers_${reportType}_${format(new Date(), 'yyyyMMdd')}`, 'WAITING BORROWERS REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total:"
    // row (when present) is split off for distinct styling. Both variants are flat,
    // moderate-width reports — no genuine repeated-prefix pairs to group.
    const buildWaitingBorrowersWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
        const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
        const totalsRow = hasTotals ? rows[rows.length - 1] : undefined;

        if (reportType === 'DETAILED') {
            return {
                bodyRows,
                options: {
                    columnAlignments: ['left', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'right', 'center'],
                    columnWidthWeights: [10, 12, 8, 14, 9, 9, 9, 9, 9, 9],
                    totalsRow,
                },
            };
        }
        return {
            bodyRows,
            options: {
                columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [12, 12, 9, 10, 9, 10, 9, 10, 9],
                totalsRow,
            },
        };
    };

    const handleExportWord = async () => {
        if (data.length === 0) return;
        const { headers, rows } = buildWaitingBorrowersExportRows();
        const { bodyRows, options } = buildWaitingBorrowersWordOptions(rows);
        await exportToWord(`Waiting_Borrowers_${reportType}_${format(new Date(), 'yyyyMMdd')}`, 'WAITING BORROWERS REPORT', headers, bodyRows, options);
    };

    const filteredData = useMemo(() => {
        if (!data || !Array.isArray(data)) return [];

        if (reportType === 'DETAILED') {
            return (data as DetailedRecord[]).filter(item =>
                matchesMemberSearch(searchQuery, item, item.clientName, item.center, item.accountId)
            );
        } else {
            return (data as SummaryRecord[]).filter(item =>
                (item.center?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
                (item.branchName?.toLowerCase() || '').includes(searchQuery.toLowerCase())
            );
        }
    }, [data, searchQuery, reportType]);

    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = filteredData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Summaries for header cards
    const aggregates = useMemo(() => {
        if (!data || !Array.isArray(data)) {
            return { totalClients: 0, totalOS: 0, newClients: 0, totalCenters: 0, totalDefaults: 0 };
        }
        if (reportType === 'DETAILED') {
            const records = data as DetailedRecord[];
            return {
                totalClients: records.length,
                totalOS: records.reduce((acc, r) => acc + (Number(r.principleBalance) || 0), 0),
                newClients: records.filter(r => r.disbursalDate === 'NEW').length,
                totalCenters: 0,
                totalDefaults: 0
            };
        } else {
            const records = data as SummaryRecord[];
            return {
                totalClients: 0,
                totalOS: records.reduce((acc, r) => acc + (Number(r.osAmount) || 0), 0),
                newClients: 0,
                totalCenters: records.length,
                totalDefaults: records.reduce((acc, r) => acc + (Number(r.defaultClients) || 0), 0)
            };
        }
    }, [data, reportType]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-700">

            {/* Intelligent Filter Panel */}
            <Card className="relative overflow-hidden border-none shadow-2xl bg-white/80 dark:bg-brand-green-darker/80 backdrop-blur-2xl rounded-[2.5rem]">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-primary to-emerald-500" />

                <CardHeader className="px-10 pt-10 pb-6">
                    <div className="flex items-center gap-5">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-xl shadow-primary/30">
                            <Clock className="h-8 w-8 text-white" />
                        </div>
                        <div className="space-y-1">
                            <CardTitle className="text-2xl font-black tracking-tight text-foreground dark:text-white uppercase font-sans">Waiting Borrowers Report</CardTitle>
                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Aging analysis and portfolio tracking for pending and overdue borrowers.</p>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="px-10 pb-10 pt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
                        <div className="lg:col-span-3 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                                <Filter className="w-3 h-3 text-primary" />
                                Report Perspective
                            </Label>
                            <Select value={reportType} onValueChange={(v: any) => setReportType(v)} disabled={isLoading}>
                                <SelectTrigger className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-black px-6">
                                    <SelectValue placeholder="View Mode" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border-primary/20 dark:border-sidebar-accent">
                                    <SelectItem value="DETAILED" className="font-bold py-3 uppercase tracking-tighter">Detailed Analysis</SelectItem>
                                    <SelectItem value="SUMMARY" className="font-bold py-3 uppercase tracking-tighter">Executive Summary</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="lg:col-span-2 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Branch</Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-bold px-6">
                                    <SelectValue placeholder="-- ALL BRANCHES --" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border-primary/20 dark:border-sidebar-accent">
                                    <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id}>{branch.code} - {branch.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="lg:col-span-2 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Center</Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading}>
                                <SelectTrigger className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-bold px-6">
                                    <SelectValue placeholder="-- ALL CENTERS --" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border-primary/20 dark:border-sidebar-accent">
                                    <SelectItem value="all">-- ALL CENTERS --</SelectItem>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>{center.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="lg:col-span-1 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Aging Weeks</Label>
                            <Input
                                type="number"
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-black text-center text-lg"
                                disabled={isLoading}
                            />
                        </div>

                        <div className="lg:col-span-4 flex flex-col sm:flex-row gap-4">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-14 flex-1 rounded-2xl bg-brand-green-darker hover:bg-sidebar-accent text-white shadow-xl transition-all active:scale-95 font-black text-base uppercase tracking-wider"
                            >
                                {isLoading ? <Loader2 className="mr-3 h-5 w-5 animate-spin" /> : <TrendingUp className="mr-3 h-5 w-5" />}
                                Sync Report
                            </Button>

                            <Button
                                variant="outline"
                                onClick={handleReset}
                                className="h-14 px-8 rounded-2xl border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker font-bold transition-all"
                            >
                                <RotateCcw className="h-5 w-5" />
                            </Button>

                            <ExportDropdown
                                onExportPDF={!isLoading && data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && data.length > 0 ? handleExport : undefined}
                                onExportCSV={!isLoading && data.length > 0 ? handleExportCSV : undefined}
                                onExportWord={!isLoading && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && data.length > 0 && getReportExportMode('waiting-borrowers') === 'REQUEST_QUEUE' ? 'waiting-borrowers' : undefined}
                                canExport={canExportReport('waiting-borrowers')}
                                exportParams={{
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: {
                                        reportType,
                                        ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                                    },
                                }}
                                className="h-14 px-8 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 transition-all font-bold"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Results Section */}
            {showReport && (
                <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-1000">

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {reportType === 'DETAILED' ? (
                            <>
                                <SummaryMetric icon={Users} label="Active Borrowers" value={aggregates.totalClients} color="blue" />
                                <SummaryMetric icon={Wallet} label="Total OS Balance" value={`₹${formatReportAmount((aggregates as any).totalOS)}`} color="indigo" />
                                <SummaryMetric icon={AlertCircle} label="New Applications" value={(aggregates as any).newClients} color="emerald" />
                            </>
                        ) : (
                            <>
                                <SummaryMetric icon={Building2} label="Network Centers" value={aggregates.totalCenters} color="blue" />
                                <SummaryMetric icon={Wallet} label="Total Aggregate OS" value={`₹${formatReportAmount((aggregates as any).totalOS)}`} color="indigo" />
                                <SummaryMetric icon={AlertCircle} label="Identified Defaults" value={(aggregates as any).totalDefaults} color="emerald" />
                            </>
                        )}
                    </div>

                    <Card className="overflow-hidden border-none shadow-2xl bg-white/60 dark:bg-brand-green-darker/40 backdrop-blur-xl rounded-[2.5rem]">
                        <CardHeader className="px-10 pt-10 pb-6 border-b border-slate-100 dark:border-sidebar-accent/50">
                            <ReportHeader title="Waiting Borrowers Report" />
                            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                    <h3 className="text-xl font-black uppercase text-sidebar-accent dark:text-white tracking-widest">{reportType} REGISTRY</h3>
                                    <Badge className="bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/30 dark:text-primary font-black px-3 py-1 border-none uppercase">
                                        {filteredData.length} Results
                                    </Badge>
                                </div>
                                <div className="relative w-full md:w-80 group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                                    <Input
                                        placeholder={reportType === 'DETAILED' ? 'Name, ID, Aadhaar or mobile...' : 'Filter centers...'}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="h-12 pl-12 rounded-xl bg-white/80 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-bold transition-all"
                                    />
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto scrollbar-thin">
                                {reportType === 'DETAILED' ? (
                                    <DetailedTable data={paginatedData as DetailedRecord[]} offset={(currentPage - 1) * itemsPerPage} />
                                ) : (
                                    <SummaryTable data={paginatedData as SummaryRecord[]} offset={(currentPage - 1) * itemsPerPage} />
                                )}
                            </div>

                            {totalPages > 1 && (
                                <div className="px-10 py-8 flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent/50">
                                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                                        Page {currentPage} of {totalPages}
                                    </p>
                                    <div className="flex items-center gap-4">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="h-12 w-12 rounded-xl border-primary/20 dark:border-sidebar-accent font-bold"
                                        >
                                            <ChevronLeft className="h-5 w-5" />
                                        </Button>
                                        <span className="h-12 w-12 flex items-center justify-center rounded-xl bg-brand-green-darker text-white font-black">
                                            {currentPage}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                            disabled={currentPage === totalPages}
                                            className="h-12 w-12 rounded-xl border-primary/20 dark:border-sidebar-accent font-bold"
                                        >
                                            <ChevronRight className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {!showReport && !isLoading && (
                <div className="flex flex-col items-center justify-center py-20 opacity-40">
                    <FileText className="h-20 w-20 text-slate-300 dark:text-sidebar-accent mb-6" />
                    <p className="text-sm font-black uppercase tracking-widest text-slate-400">Registry Snapshot Awaited</p>
                </div>
            )}
        </div>
    );
}

function DetailedTable({ data, offset }: { data: DetailedRecord[], offset: number }) {
    return (
        <Table className="min-w-[1400px]">
            <TableHeader className="bg-green-50 dark:bg-green-950/50">
                <TableRow className="border-none">
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Location</TableHead>
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Profile</TableHead>
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Lifecycle</TableHead>
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-right">Repayment Status</TableHead>
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-right">O/S Principal</TableHead>
                    <TableHead className="px-4 sm:px-8 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((row, index) => (
                    <TableRow key={index} className="group hover:bg-green-50/30 dark:hover:bg-brand-green-darker/10 transition-colors border-b border-slate-100 dark:border-sidebar-accent/50">
                        <TableCell className="px-4 sm:px-8 py-6">
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase leading-none">Center</p>
                                <p className="font-bold text-sidebar-accent dark:text-slate-300 uppercase truncate max-w-[180px]">{row.center}</p>
                            </div>
                        </TableCell>
                        <TableCell className="px-4 sm:px-8 py-6">
                            <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="font-black text-foreground dark:text-white uppercase tracking-tighter">{row.clientName}</p>
                                    <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                        {getPersonLabel(!!row.hasLoan).singular}
                                    </span>
                                </div>
                                <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                                    <Phone className="w-3 h-3" /> {row.phone}
                                </p>
                            </div>
                        </TableCell>
                        <TableCell className="px-4 sm:px-8 py-6">
                            <MemberContactCell row={row} />
                        </TableCell>
                        <TableCell className="px-4 sm:px-8 py-6 text-sm">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Joined:</p>
                                <p className="font-bold text-sidebar-accent dark:text-slate-400 whitespace-nowrap">{formatDate(row.dateOfJoining)}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Disbursed:</p>
                                <p className="font-bold text-sidebar-accent dark:text-slate-400 whitespace-nowrap">
                                    {row.disbursalDate === 'PENDING' || row.disbursalDate === 'NEW' ? row.disbursalDate : formatDate(row.disbursalDate)}
                                </p>
                            </div>
                        </TableCell>
                        <TableCell className="px-4 sm:px-8 py-6 text-right">
                            <div className="space-y-1">
                                <p className="font-black text-sidebar-accent dark:text-slate-300">₹{formatReportAmount(row.repaidAmount)}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Cycle {row.loanCycle}</p>
                            </div>
                        </TableCell>
                        <TableCell className="px-4 sm:px-8 py-6 text-right">
                            <p className="font-black text-primary dark:text-primary text-base italic">₹{formatReportAmount(row.principleBalance)}</p>
                        </TableCell>
                        <TableCell className="px-4 sm:px-8 py-6">
                            <Badge className={cn(
                                "font-black border-none px-3 py-1",
                                row.arrearType === 'NO OS' ? "bg-emerald-100 text-emerald-700" : "bg-brand-green-tint text-sidebar-accent"
                            )}>
                                {row.arrearType}
                            </Badge>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

function SummaryTable({ data, offset }: { data: SummaryRecord[], offset: number }) {
    return (
        <Table className="min-w-[1200px]">
            <TableHeader className="bg-green-50 dark:bg-green-950/50">
                <TableRow className="border-none">
                    <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Executive Center</TableHead>
                    <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-center">New/No OS</TableHead>
                    <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-center">4-Week Aging</TableHead>
                    <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-center">10-Week Aging</TableHead>
                    <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-center">Risk Clients</TableHead>
                    <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-right">Aggregate OS</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((row, index) => (
                    <TableRow key={index} className="group hover:bg-green-50 dark:hover:bg-sidebar-accent/30 transition-colors border-b border-slate-100 dark:border-sidebar-accent/50">
                        <TableCell className="px-10 py-6">
                            <div className="space-y-1">
                                <p className="font-black text-foreground dark:text-white uppercase tracking-tighter">{row.center}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase">{row.branchName}</p>
                            </div>
                        </TableCell>
                        <TableCell className="px-10 py-6 text-center font-bold text-sidebar-accent dark:text-slate-400">{row.noOsNewClient}</TableCell>
                        <TableCell className="px-10 py-6 text-center">
                            <div className="space-y-0.5">
                                <p className="font-black text-sidebar-accent dark:text-white">{row.client4Weeks}</p>
                                <p className="text-[10px] font-bold text-rose-500">₹{formatReportAmount(row.os4Weeks)}</p>
                            </div>
                        </TableCell>
                        <TableCell className="px-10 py-6 text-center">
                            <div className="space-y-0.5">
                                <p className="font-black text-sidebar-accent dark:text-white">{row.client10Weeks}</p>
                                <p className="text-[10px] font-bold text-rose-600">₹{formatReportAmount(row.os10Weeks)}</p>
                            </div>
                        </TableCell>
                        <TableCell className="px-10 py-6 text-center">
                            <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 font-black px-3 py-1 border-none">
                                {row.defaultClients} DEFAULTS
                            </Badge>
                        </TableCell>
                        <TableCell className="px-10 py-6 text-right">
                            <p className="font-black text-lg text-foreground dark:text-white tracking-tighter">₹{formatReportAmount(row.osAmount)}</p>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

function SummaryMetric({ icon: Icon, label, value, color }: { icon: any, label: string, value: string | number, color: 'blue' | 'indigo' | 'emerald' }) {
    const colorClasses = {
        blue: 'from-primary to-sidebar-accent text-primary',
        indigo: 'from-primary to-primary text-primary',
        emerald: 'from-emerald-600 to-emerald-700 text-emerald-600',
    };

    return (
        <Card className="border-none shadow-xl bg-white/80 dark:bg-brand-green-darker/80 backdrop-blur-xl rounded-[2rem] overflow-hidden group">
            <CardContent className="p-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
                        <p className={cn("text-2xl font-black tracking-tighter", colorClasses[color].split(' ').pop())}>
                            {isNaN(Number(value)) && typeof value === 'number' ? '0' : value}
                        </p>
                    </div>
                    <div className={cn("h-14 w-14 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110", colorClasses[color].split(' ').slice(0, 2).join(' '))}>
                        <Icon className="h-7 w-7 text-white" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
