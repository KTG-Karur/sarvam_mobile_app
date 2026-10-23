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
    CreditCard,
    FileText,
    FileType,
    FileOutput,
    ChevronLeft,
    ChevronRight,
    Filter,
    ArrowRightLeft,
    Wallet
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawDoubleClientsReport } from '@/app/lib/reports/double-clients-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { getPersonLabel } from '@/app/lib/person-label';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { usePermission } from '@/app/hooks/usePermission';
import { MEMBER_CONTACT_HEADERS, memberContactValues, memberContactExcelCells, matchesMemberSearch, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';

type BranchOption = { id: string; name: string; code: string };

type DoubleClient = MemberContactFields & {
    id: string;
    slNo: number;
    /** Has an active/disbursed loan — false means still a Member, not yet a Client */
    hasLoan?: boolean;
    clientName: string;
    smartCardNo: string;
    pancardNo: string;
    votersIdNo: string;
    otherIdNo: string;
    mobileNo: string;
    loanAcNo: string;
    disbursalDate: string | null;
    loanBalance: number;
    matchValue: string;
};

const SELECTION_TYPES = [
    { value: 'OTHER_ID_NO', label: 'OTHER ID NO.', icon: CreditCard },
    { value: 'SMART_CARD_NO', label: 'SMART CARD NO.', icon: CreditCard },
    { value: 'VOTER_ID_NO', label: 'VOTERS ID NO.', icon: CreditCard },
    { value: 'PAN_NO', label: 'PANCARD NO.', icon: CreditCard },
];

export function DoubleClientsClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const [selectionType, setSelectionType] = useState<string>('OTHER_ID_NO');
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<DoubleClient[]>([]);
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
            const params = new URLSearchParams({ type: selectionType });
            if (selectedBranch !== 'all') params.set('branchId', selectedBranch);
            if (selectedCenter !== 'all') params.set('centerId', selectedCenter);
            const response = await apiClient.get<DoubleClient[]>(
                `/reports/client/double-clients?${params.toString()}`
            );
            if (response.success && response.data) {
                setData(response.data);
                setShowReport(true);
                setCurrentPage(1);
                toast({
                    title: 'Sync Complete',
                    description: `Identified ${response.data.length} potential duplicate records.`,
                });
            } else {
                toast({
                    title: 'Query Failed',
                    description: response.error || 'The system was unable to identify duplicates.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Network Error',
                description: 'Failed to connect to the reporting registry.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectionType('SMART_CARD_NO');
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
            const exportData = filteredData.map((item) => ({
                'Sl No': item.slNo,
                'Name': item.clientName,
                'Member / Client': getPersonLabel(!!item.hasLoan).singular,
                'Smart Card No': item.smartCardNo,
                'PAN No': item.pancardNo,
                'Voter ID No': item.votersIdNo,
                'Mobile No': item.mobileNo,
                'Loan A/c No': item.loanAcNo,
                'Disbursal Date': item.disbursalDate ? format(new Date(item.disbursalDate), 'dd/MM/yyyy') : 'N/A',
                'Loan Balance': truncateReportAmount(item.loanBalance),
                'Match Field Value': item.matchValue,
                ...memberContactExcelCells(item),
            }));

            const ws = buildReportSheet('Double Members Report', exportData);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Double Members');
            const fileName = `Double_Clients_${selectionType}_${format(new Date(), 'yyyyMMdd')}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Success',
                description: 'The registry dump has been generated and downloaded.',
            });
        } catch (error) {
            toast({
                title: 'Export Error',
                description: 'Failed to compile the Excel registry.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildDoubleClientsExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Sl No', 'Name', 'Member / Client', 'Smart Card No', 'PAN No', 'Voter ID No', 'Mobile No', 'Loan A/c No', 'Disbursal Date', 'Loan Balance', 'Match Field Value', ...MEMBER_CONTACT_HEADERS];
        const rows: (string | number)[][] = filteredData.map((item) => [
            item.slNo, item.clientName, getPersonLabel(!!item.hasLoan).singular, item.smartCardNo, item.pancardNo,
            item.votersIdNo, item.mobileNo, item.loanAcNo,
            item.disbursalDate ? format(new Date(item.disbursalDate), 'dd/MM/yyyy') : 'N/A',
            truncateReportAmount(item.loanBalance), item.matchValue,
            ...memberContactValues(item),
        ]);
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (data.length === 0) return;
        try {
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawDoubleClientsReport(doc, filteredData, { subtitle: `Match Criteria: ${activeSelectionType?.label ?? selectionType}` }, reportFont);
            doc.save(`Double_Clients_${selectionType}_${format(new Date(), 'yyyyMMdd')}.pdf`);
            toast({ title: 'PDF Exported', description: 'The registry dump has been generated and downloaded.' });
        } catch {
            toast({ title: 'Export Error', description: 'Failed to compile the PDF registry.', variant: 'destructive' });
        }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;
        const { headers, rows } = buildDoubleClientsExportRows();
        exportToCSV(`Double_Clients_${selectionType}_${format(new Date(), 'yyyyMMdd')}`, 'DOUBLE MEMBERS REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above. No totals row exists in this
    // report today and 11 flat columns don't warrant grouped headers — just professional
    // header/zebra/alignment/width styling.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'left'],
        columnWidthWeights: [6, 14, 8, 10, 8, 10, 9, 10, 9, 9, 12],
    };

    const handleExportWord = async () => {
        if (data.length === 0) return;
        const { headers, rows } = buildDoubleClientsExportRows();
        await exportToWord(`Double_Clients_${selectionType}_${format(new Date(), 'yyyyMMdd')}`, 'DOUBLE MEMBERS REPORT', headers, rows, wordOptions);
    };

    // Filter data based on search
    const filteredData = useMemo(() => {
        return data.filter(item =>
            matchesMemberSearch(searchQuery, item, item.clientName, item.smartCardNo, item.loanAcNo, item.matchValue)
        );
    }, [data, searchQuery]);

    // Pagination logic
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = filteredData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const activeSelectionType = SELECTION_TYPES.find(t => t.value === selectionType);
    const SelectionIcon = activeSelectionType?.icon || CreditCard;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-700">

            {/* Advanced Control Panel */}
            <Card className="relative overflow-hidden border-none shadow-2xl bg-white/80 dark:bg-brand-green-darker/80 backdrop-blur-2xl rounded-[2.5rem]">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-primary to-emerald-500" />

                <CardHeader className="px-10 pt-10 pb-6">
                    <div className="flex items-center gap-5">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-xl shadow-primary/30 transform transition-transform hover:rotate-3">
                            <ArrowRightLeft className="h-8 w-8 text-white" />
                        </div>
                        <div className="space-y-1">
                            <CardTitle className="text-2xl font-black tracking-tight text-foreground dark:text-white uppercase">Double Member Detection</CardTitle>
                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Cross-reference master records to identify potential duplicate registrations.</p>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="px-10 pb-10 pt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
                        <div className="lg:col-span-3 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                                <Filter className="w-3 h-3 text-primary" />
                                MATCH CRITERIA
                            </Label>
                            <Select value={selectionType} onValueChange={setSelectionType} disabled={isLoading}>
                                <SelectTrigger className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-bold px-6 shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <SelectionIcon className="w-5 h-5 text-primary" />
                                        <SelectValue placeholder="Select Matching Logic" />
                                    </div>
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl border-primary/20 dark:border-sidebar-accent">
                                    {SELECTION_TYPES.map(type => (
                                        <SelectItem key={type.value} value={type.value} className="font-bold py-3">
                                            <div className="flex items-center gap-3">
                                                <type.icon className="w-4 h-4 text-slate-400" />
                                                {type.label}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="lg:col-span-2 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-bold px-6 shadow-sm">
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
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">
                                Center
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading}>
                                <SelectTrigger className="h-14 rounded-2xl bg-white/50 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent font-bold px-6 shadow-sm">
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

                        <div className="lg:col-span-5 flex flex-col sm:flex-row gap-4">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-14 flex-1 rounded-2xl bg-brand-green-darker hover:bg-sidebar-accent text-white shadow-xl transition-all active:scale-95 font-black text-base uppercase tracking-wider"
                            >
                                {isLoading ? <Loader2 className="mr-3 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-3 h-5 w-5" />}
                                Analyze Registry
                            </Button>

                            <Button
                                variant="outline"
                                onClick={handleReset}
                                className="h-14 px-8 rounded-2xl border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker font-bold shadow-sm transition-all"
                            >
                                <RotateCcwIcon className="h-5 w-5 mr-0" />
                            </Button>

                            <ExportDropdown
                                onExportPDF={!isLoading && data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && data.length > 0 ? handleExport : undefined}
                                onExportCSV={!isLoading && data.length > 0 ? handleExportCSV : undefined}
                                onExportWord={!isLoading && data.length > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && data.length > 0 && getReportExportMode('double-clients') === 'REQUEST_QUEUE' ? 'double-clients' : undefined}
                                canExport={canExportReport('double-clients')}
                                exportParams={{
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: {
                                        idType: selectionType,
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
                <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">

                    {/* Metrics / Summary Card */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <SummaryMetric
                            icon={Users}
                            label="Duplicate Clusters"
                            value={new Set(data.map(d => d.matchValue)).size}
                            color="blue"
                        />
                        <SummaryMetric
                            icon={ArrowRightLeft}
                            label="Total Records"
                            value={data.length}
                            color="indigo"
                        />
                        <SummaryMetric
                            icon={Wallet}
                            label="Aggregate Risk Exposure"
                            value={`₹${formatReportAmount(data.reduce((acc, d) => acc + d.loanBalance, 0))}`}
                            color="emerald"
                        />
                    </div>

                    <Card className="overflow-hidden border-none shadow-2xl bg-white/60 dark:bg-brand-green-darker/40 backdrop-blur-xl rounded-[2.5rem]">
                        <CardHeader className="px-10 pt-10 pb-6 border-b border-slate-100 dark:border-sidebar-accent/50">
                            <ReportHeader title="Double Members Report" />
                            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                    <h3 className="text-xl font-black uppercase text-sidebar-accent dark:text-white tracking-widest">Duplicate Candidates</h3>
                                    <Badge className="bg-brand-green-tint text-sidebar-accent dark:bg-brand-green-darker/30 dark:text-primary font-black border-none px-3 py-1">
                                        {filteredData.length} RECORDS
                                    </Badge>
                                </div>
                                <div className="relative w-full md:w-80 group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                                    <Input
                                        placeholder="Search name, ID, loan, Aadhaar, mobile..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="h-12 pl-12 rounded-xl bg-white/80 dark:bg-green-950/50 border-primary/20 dark:border-sidebar-accent focus:ring-4 focus:ring-primary/10 focus:border-primary font-bold transition-all shadow-inner"
                                    />
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto scrollbar-thin">
                                <Table className="min-w-[1000px]">
                                    <TableHeader className="bg-green-50 dark:bg-green-950/50">
                                        <TableRow className="hover:bg-transparent border-none">
                                            <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Reference</TableHead>
                                            <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Profile</TableHead>
                                            <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>
                                            <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Match Field</TableHead>
                                            <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em]">Loan Artifact</TableHead>
                                            <TableHead className="px-10 py-6 font-black text-[10px] text-slate-400 uppercase tracking-[0.2em] text-right">Balance Position</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedData.map((row, index) => (
                                            <TableRow key={`${row.id}-${index}`} className="group hover:bg-green-50/30 dark:hover:bg-brand-green-darker/10 transition-colors border-b border-slate-100 dark:border-sidebar-accent/50">
                                                <TableCell className="px-10 py-6">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-xs font-black text-slate-300 mr-2">{(currentPage - 1) * itemsPerPage + index + 1}</span>
                                                        <div className="h-10 w-10 rounded-xl bg-brand-green-tint dark:bg-sidebar-accent flex items-center justify-center font-black text-xs text-sidebar-accent dark:text-slate-400">
                                                            #{row.slNo}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-10 py-6">
                                                    <div className="space-y-1">
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <p className="font-black text-foreground dark:text-white uppercase tracking-tighter">{row.clientName}</p>
                                                            <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                                {getPersonLabel(!!row.hasLoan).singular}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 uppercase">
                                                                <CreditCard className="w-3 h-3" />
                                                                SC: {row.smartCardNo}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-10 py-6">
                                                    <MemberContactCell row={row} />
                                                </TableCell>
                                                <TableCell className="px-10 py-6">
                                                    <Badge variant="secondary" className="bg-brand-green-tint dark:bg-sidebar-accent text-foreground dark:text-slate-100 font-bold border-none px-3 py-1 lowercase">
                                                        {row.matchValue}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-10 py-6">
                                                    <div className="space-y-1">
                                                        <p className="text-sm font-black text-sidebar-accent dark:text-slate-300">{row.loanAcNo}</p>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                                                            <FileText className="w-2.5 h-2.5" />
                                                            {row.disbursalDate ? format(new Date(row.disbursalDate), 'dd/MM/yyyy') : 'No Disbursal'}
                                                        </p>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="px-10 py-6 text-right">
                                                    <div className="space-y-1">
                                                        <p className="font-black text-base text-primary dark:text-primary">
                                                            ₹{formatReportAmount(row.loanBalance)}
                                                        </p>
                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">O/S Principal</p>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {totalPages > 1 && (
                                <div className="px-10 py-8 flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent/50">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        Showing {paginatedData.length} of {filteredData.length} Anomalies
                                    </p>
                                    <div className="flex items-center gap-4">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            className="h-12 w-12 rounded-xl border-primary/20 dark:border-sidebar-accent hover:bg-brand-green-tint dark:hover:bg-sidebar-accent transition-all font-bold"
                                        >
                                            <ChevronLeft className="h-5 w-5" />
                                        </Button>
                                        <div className="flex items-center gap-2">
                                            <span className="h-12 w-12 flex items-center justify-center rounded-xl bg-primary text-white font-black shadow-lg shadow-primary/30">
                                                {currentPage}
                                            </span>
                                            <span className="text-sm font-bold text-slate-400 uppercase px-2">OF {totalPages}</span>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                            disabled={currentPage === totalPages}
                                            className="h-12 w-12 rounded-xl border-primary/20 dark:border-sidebar-accent hover:bg-brand-green-tint dark:hover:bg-sidebar-accent transition-all font-bold"
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
                <div className="flex flex-col items-center justify-center py-20 animate-in fade-in zoom-in duration-1000">
                    <div className="h-32 w-32 rounded-[2.5rem] bg-green-50 dark:bg-brand-green-darker border-2 border-dashed border-primary/20 dark:border-sidebar-accent flex items-center justify-center mb-8 relative">
                        <Users className="h-12 w-12 text-slate-300 dark:text-sidebar-accent" />
                        <div className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-primary animate-ping opacity-20" />
                    </div>
                    <div className="text-center space-y-3 max-w-sm mx-auto">
                        <h3 className="text-xl font-black text-foreground dark:text-white uppercase tracking-tighter">Diagnostic Ready</h3>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            Configure your matching criteria above and initiate a registry scan to detect potential duplicate client registrations.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

function SummaryMetric({ icon: Icon, label, value, color }: { icon: any, label: string, value: string | number, color: 'blue' | 'indigo' | 'emerald' }) {
    const colorClasses = {
        blue: 'from-primary to-sidebar-accent shadow-primary/20 text-primary',
        indigo: 'from-primary to-primary shadow-primary/20 text-primary',
        emerald: 'from-emerald-600 to-emerald-700 shadow-emerald-500/20 text-emerald-600',
    };

    return (
        <Card className="border-none shadow-xl bg-white/80 dark:bg-brand-green-darker/80 backdrop-blur-xl rounded-[2rem] overflow-hidden group">
            <CardContent className="p-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
                        <p className={cn("text-2xl font-black tracking-tighter", colorClasses[color].split(' ').pop())}>{value}</p>
                    </div>
                    <div className={cn("h-14 w-14 rounded-2xl bg-gradient-to-br flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110 group-hover:rotate-6", colorClasses[color].split(' ').slice(0, 2).join(' '))}>
                        <Icon className="h-7 w-7 text-white" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function RotateCcwIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    )
}
