'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    FileSpreadsheet,
    Search,
    RotateCcw,
    Download,
    Building2,
    Users,
    Calendar,
    Phone,
    TrendingUp,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    Loader2,
    UserCircle,
    MapPin,
    ArrowRightLeft,
    Clock,
    FileBarChart,
    FileType,
    FileOutput
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { MetricCard } from '@/components/dashboard/MetricCard';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawBalanceInformationReport } from '@/app/lib/reports/balance-information-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { usePermission } from '@/app/hooks/usePermission';
import { DateInput } from '@/components/ui/date-input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, matchesMemberSearch, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell } from '@/components/reports/MemberContactCell';

type BranchOption = { id: string; name: string; code: string };

interface BalanceData extends MemberContactFields {
    branchName: string;
    centerName: string;
    fdo: string;
    meetingDay: string;
    clientName: string;
    accountId: string;
    osPrinciple: number;
    osInterest: number;
    arrearPri: number;
    arrearInt: number;
    mobile: string;
}

export function BalanceInformationReport() {
    const { canExportReport, getReportExportMode } = usePermission();
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenter, setSelectedCenter] = useState('');
    const [asOnDate, setAsOnDate] = useState(new Date().toISOString().split('T')[0]);
    const [submittedAsOnDate, setSubmittedAsOnDate] = useState(new Date().toISOString().split('T')[0]);
    const [balanceData, setBalanceData] = useState<BalanceData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [isFetchingCenters, setIsFetchingCenters] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 6;
    const { toast } = useToast();

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    // Fetch branches + centers on mount
    useEffect(() => {
        const fetchCenters = async () => {
            try {
                const centerList = await getCentersForDropdown();
                setCenters(centerList);
                if (centerList.length === 1 && !selectedCenter) {
                    setSelectedCenter(centerList[0].id);
                }
            } catch (error) {
                console.error('Failed to fetch centers:', error);
            } finally {
                setIsFetchingCenters(false);
            }
        };
        fetchCenters();

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // Filter data based on search query
    const filteredData = useMemo(() => {
        return balanceData.filter((item) =>
            matchesMemberSearch(searchQuery, item, item.clientName, item.accountId, item.mobile, item.fdo)
        );
    }, [balanceData, searchQuery]);

    // Pagination
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const startIndex = (currentPage - 1) * itemsPerPage;
        return filteredData.slice(startIndex, startIndex + itemsPerPage);
    }, [filteredData, currentPage]);

    // Calculate totals
    const totals = useMemo(() => {
        return balanceData.reduce(
            (acc, item) => ({
                osPrinciple: acc.osPrinciple + item.osPrinciple,
                osInterest: acc.osInterest + item.osInterest,
                arrearPri: acc.arrearPri + item.arrearPri,
                arrearInt: acc.arrearInt + item.arrearInt,
            }),
            { osPrinciple: 0, osInterest: 0, arrearPri: 0, arrearInt: 0 }
        );
    }, [balanceData]);

    const handleShow = async () => {
        if (!selectedCenter) {
            toast({
                title: 'Center Required',
                description: 'Please select a center to view balance information',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        setShowReport(true);
        try {
            const response = await apiClient.get<BalanceData[]>(
                `/reports/client/balance-information?centerId=${selectedCenter}&date=${asOnDate}`
            );
            if (response.success && response.data) {
                setBalanceData(response.data);
                setCurrentPage(1);
                setSubmittedAsOnDate(asOnDate);
                toast({
                    title: 'Data Loaded',
                    description: `Successfully fetched records for ${response.data.length} clients.`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to fetch balance information',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'System Error',
                description: 'Failed to connect to the server.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedBranch('all');
        setSelectedCenter('');
        setAsOnDate(new Date().toISOString().split('T')[0]);
        setSubmittedAsOnDate(new Date().toISOString().split('T')[0]);
        setBalanceData([]);
        setSearchQuery('');
        setShowReport(false);
        setCurrentPage(1);
    };

    const handleExport = () => {
        if (balanceData.length === 0) return;

        try {
            const { headers, rows } = buildBalanceInfoExportRows();
            const excelRows = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('Balance Confirmation Report', excelRows);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Balance Confirmation');
            const fileName = `Balance_Confirmation_${submittedAsOnDate}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export Successful',
                description: 'Excel file has been generated.',
            });
        } catch (error) {
            toast({
                title: 'Export Error',
                description: 'Failed to generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same field mapping used by handleExport above (kept separate so
    // handleExport is left untouched).
    const buildBalanceInfoExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['Sl No', 'Branch', 'Center', 'FDO', 'Meeting Day', 'Client', 'Account ID', 'OS Principle', 'OS Interest', 'Arrear Pri', 'Arrear Int', 'Mobile', ...MEMBER_CONTACT_HEADERS];
        const rows: (string | number)[][] = filteredData.map((item, idx) => [
            idx + 1, item.branchName, item.centerName, item.fdo, item.meetingDay, item.clientName,
            item.accountId, truncateReportAmount(item.osPrinciple), truncateReportAmount(item.osInterest),
            truncateReportAmount(item.arrearPri), truncateReportAmount(item.arrearInt), item.mobile,
            ...memberContactValues(item),
        ]);
        if (balanceData.length > 0) {
            rows.push([
                '', 'Grand Total:', '', '', '', '', '',
                truncateReportAmount(totals.osPrinciple), truncateReportAmount(totals.osInterest),
                truncateReportAmount(totals.arrearPri), truncateReportAmount(totals.arrearInt), '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (balanceData.length === 0) return;
        try {
            const { headers, rows } = buildBalanceInfoExportRows();
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawBalanceInformationReport(doc, { headers, rows }, { subtitle: `As on ${submittedAsOnDate}` }, reportFont);
            doc.save(`Balance_Confirmation_${submittedAsOnDate}.pdf`);
            toast({ title: 'Export Successful', description: 'PDF file has been generated.' });
        } catch (error) {
            toast({ title: 'Export Error', description: 'Failed to generate PDF file.', variant: 'destructive' });
        }
    };

    const handleExportCSV = () => {
        if (balanceData.length === 0) return;
        const { headers, rows } = buildBalanceInfoExportRows();
        exportToCSV(`Balance_Confirmation_${submittedAsOnDate}`, 'BALANCE CONFIRMATION REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand Total:"
    // row is split off for distinct styling, and OS/Arrear Principal-Interest pairs get
    // a light 2-row grouped header — genuine related fields.
    const buildBalanceInfoWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Sl No', span: 1 }, { label: 'Branch', span: 1 }, { label: 'Center', span: 1 },
                { label: 'FDO', span: 1 }, { label: 'Meeting Day', span: 1 }, { label: 'Client', span: 1 },
                { label: 'Account ID', span: 1 }, { label: 'OS', span: 2 }, { label: 'ARREAR', span: 2 },
                { label: 'Mobile', span: 1 },
            ],
            subHeaders: ['Principle', 'Interest', 'Pri', 'Int'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'right', 'right', 'right', 'right', 'center'],
            columnWidthWeights: [5, 10, 10, 9, 8, 12, 8, 8, 8, 8, 8, 9],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (balanceData.length === 0) return;
        const { headers, rows } = buildBalanceInfoExportRows();
        const { bodyRows, options } = buildBalanceInfoWordOptions(rows);
        await exportToWord(`Balance_Confirmation_${submittedAsOnDate}`, 'BALANCE CONFIRMATION REPORT', headers, bodyRows, options);
    };

    const formatCurrency = (amount: number) => `₹${formatReportAmount(amount)}`;

    const hasArrears = (item: BalanceData) => item.arrearPri > 0 || item.arrearInt > 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Filter Section */}
            <Card className="overflow-hidden border-none shadow-2xl bg-white/70 dark:bg-brand-green-darker/50 backdrop-blur-xl">
                <CardHeader className="bg-brand-green-darker dark:bg-sidebar-accent py-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/20 rounded-lg">
                            <Search className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold text-white">Verification Parameters</CardTitle>
                            <p className="text-xs text-slate-400 mt-1">Select dimensions to confirm client balances</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-emerald-500" />
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter(''); }}
                                disabled={isFetchingCenters}
                            >
                                <SelectTrigger className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-emerald-500">
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
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-emerald-500" />
                                Select Center
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isFetchingCenters}>
                                <SelectTrigger className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-emerald-500">
                                    <SelectValue placeholder={isFetchingCenters ? "Loading..." : "-- Select Center --"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="md:col-span-1 space-y-3">
                            <Label className="text-sm font-bold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-primary" />
                                As On Date
                            </Label>
                            <DateInput
                                value={asOnDate}
                                onChange={(e) => setAsOnDate(e.target.value)}
                                className="h-12 rounded-xl border-primary/20 dark:border-sidebar-accent focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        <div className="md:col-span-2 flex flex-wrap gap-3">
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-12 px-8 rounded-xl bg-brand-green-darker hover:bg-sidebar-accent text-white shadow-lg transition-all active:scale-95 flex-1 font-bold"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5 mr-2" />}
                                Show Results
                            </Button>
                            <Button
                                onClick={handleReset}
                                variant="outline"
                                className="h-12 px-6 rounded-xl border-primary/20 dark:border-sidebar-accent hover:bg-green-50 transition-all flex-1 font-bold"
                            >
                                <RotateCcw className="w-5 h-5 mr-2" />
                            </Button>
                            <ExportDropdown
                                onExportPDF={balanceData.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={balanceData.length > 0 ? handleExport : undefined}
                                onExportCSV={balanceData.length > 0 ? handleExportCSV : undefined}
                                onExportWord={balanceData.length > 0 ? handleExportWord : undefined}
                                reportSlug={balanceData.length > 0 && getReportExportMode('balance-information') === 'REQUEST_QUEUE' ? 'balance-information' : undefined}
                                canExport={canExportReport('balance-information')}
                                exportParams={{
                                    fromDate: submittedAsOnDate,
                                    branchIds: 'ALL',
                                    filters: { centerId: selectedCenter },
                                }}
                                className="h-12 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex-1 font-bold"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Metric Summary */}
            {balanceData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in slide-in-from-top-4 duration-500">
                    <MetricCard
                        title="OS Principal"
                        value={formatCurrency(totals.osPrinciple)}
                        subtitle="Total Outstanding"
                        icon={TrendingUp}
                        gradient="blue"
                    />
                    <MetricCard
                        title="OS Interest"
                        value={formatCurrency(totals.osInterest)}
                        subtitle="Expected Interest"
                        icon={TrendingUp}
                        gradient="indigo"
                    />
                    <MetricCard
                        title="Arrear Principal"
                        value={formatCurrency(totals.arrearPri)}
                        subtitle="Overdue Principal"
                        icon={AlertCircle}
                        gradient="rose"
                    />
                    <MetricCard
                        title="Arrear Interest"
                        value={formatCurrency(totals.arrearInt)}
                        subtitle="Overdue Interest"
                        icon={AlertCircle}
                        gradient="orange"
                    />
                </div>
            )}

            {/* Client Grid */}
            {balanceData.length > 0 && (
                <div className="space-y-6">
                    <ReportHeader
                        title="Balance Confirmation Report"
                        subtitle={`As on ${submittedAsOnDate}`}
                    />
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <h2 className="text-xl font-bold text-foreground dark:text-white">Client Portfolio List</h2>
                            <Badge variant="secondary" className="px-3 py-1 bg-brand-green-tint/50 dark:bg-sidebar-accent/50 text-sidebar-accent dark:text-slate-400 font-mono text-xs">
                                {filteredData.length} RECORDS
                            </Badge>
                        </div>
                        <div className="relative w-full sm:w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                type="text"
                                placeholder="Filter by Name, Account, Aadhaar, Mobile..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-12 h-12 rounded-2xl bg-white/50 border-primary/20 dark:bg-brand-green-darker dark:border-sidebar-accent shadow-sm focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                        {paginatedData.map((item) => (
                            <Card
                                key={item.accountId}
                                className={cn(
                                    "group relative overflow-hidden transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] border-none",
                                    hasArrears(item)
                                        ? "bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/20 dark:to-brand-green-darker ring-1 ring-rose-100 dark:ring-rose-900/30"
                                        : "bg-white dark:bg-brand-green-darker/60 ring-1 ring-slate-100 dark:ring-sidebar-accent"
                                )}
                            >
                                <div className="p-6">
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                "p-3 rounded-2xl shadow-sm",
                                                hasArrears(item) ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600"
                                            )}>
                                                <UserCircle className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-foreground dark:text-white leading-tight">{item.clientName.split(' - ')[1]}</h3>
                                                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tighter">{item.accountId}</p>
                                            </div>
                                        </div>
                                        {hasArrears(item) && (
                                            <Badge className="bg-rose-500 hover:bg-rose-600 text-white border-none shadow-lg shadow-rose-500/20">ARREAR</Badge>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 mb-6">
                                        <div className="space-y-1">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">OS Principle</p>
                                            <p className="text-lg font-black text-foreground dark:text-white">{formatCurrency(item.osPrinciple)}</p>
                                        </div>
                                        <div className="space-y-1 text-right">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">OS Interest</p>
                                            <p className="text-lg font-black text-sidebar-accent dark:text-slate-300">{formatCurrency(item.osInterest)}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between p-3 rounded-xl bg-green-50 dark:bg-sidebar-accent/40 mb-6">
                                        {item.arrearPri > 0 ? (
                                            <div className="flex items-center gap-2 text-rose-600">
                                                <AlertCircle className="w-4 h-4" />
                                                <span className="text-xs font-bold uppercase tracking-tighter">Penalty Due: {formatCurrency(item.arrearPri + item.arrearInt)}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 text-emerald-600">
                                                <TrendingUp className="w-4 h-4" />
                                                <span className="text-xs font-bold uppercase tracking-tighter">Account in Good Standing</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-sidebar-accent">
                                        <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2 text-slate-500">
                                                <MapPin className="w-3.5 h-3.5" />
                                                <span>{item.centerName}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-slate-500">
                                                <Calendar className="w-3.5 h-3.5" />
                                                <span>{item.meetingDay}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2 text-slate-500">
                                                <Clock className="w-3.5 h-3.5" />
                                                <span>FDO: {item.fdo}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-primary font-bold">
                                                <Phone className="w-3.5 h-3.5" />
                                                <span>{item.mobile}</span>
                                            </div>
                                        </div>
                                        <MemberContactCell row={item} className="pt-2 border-t border-slate-100 dark:border-sidebar-accent text-slate-600 dark:text-slate-300" />
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-8">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Page {currentPage} of {totalPages}
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="h-10 w-10 p-0 rounded-xl"
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                </Button>
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    const pageNum = i + 1;
                                    return (
                                        <Button
                                            key={pageNum}
                                            variant={currentPage === pageNum ? "default" : "outline"}
                                            onClick={() => setCurrentPage(pageNum)}
                                            className={cn(
                                                "h-10 w-10 text-xs font-bold rounded-xl",
                                                currentPage === pageNum ? "bg-brand-green-darker shadow-xl" : ""
                                            )}
                                        >
                                            {pageNum}
                                        </Button>
                                    );
                                })}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                    className="h-10 w-10 p-0 rounded-xl"
                                >
                                    <ChevronRight className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Empty States */}
            {!isLoading && showReport && balanceData.length === 0 && (
                <div className="flex flex-col items-center justify-center p-24 bg-white/40 dark:bg-brand-green-darker/20 rounded-3xl border border-dashed border-primary/20 dark:border-sidebar-accent">
                    <div className="p-4 bg-brand-green-tint dark:bg-sidebar-accent rounded-full mb-6">
                        <Users className="w-12 h-12 text-slate-300 dark:text-sidebar-accent" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground dark:text-white">Clean Slate</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 text-center max-w-xs">
                        No active loan balances were found for this center on the selected date.
                    </p>
                </div>
            )}

            {!showReport && (
                <div className="flex flex-col items-center justify-center p-24 bg-white/40 dark:bg-brand-green-darker/20 rounded-3xl border border-dashed border-primary/20 dark:border-sidebar-accent animate-pulse">
                    <TrendingUp className="w-16 h-16 text-slate-200 dark:text-sidebar-accent mb-6" />
                    <h3 className="text-lg font-bold text-slate-400 dark:text-sidebar-accent tracking-widest uppercase">Select Parameters to Begin</h3>
                </div>
            )}
        </div>
    );
}
