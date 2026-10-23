'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { usePermission } from '@/app/hooks/usePermission';
import { useAuthStore } from '@/app/store/authStore';
import * as XLSX from 'xlsx-js-style';
import { format, isValid } from 'date-fns';
import {
    Download,
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
    Skull,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawDeathMemberReport } from '@/app/lib/reports/death-member-pdf';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { DateInput } from '@/components/ui/date-input';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Region { id: string; name: string; }
interface Division { id: string; name: string; regionId: string; }
interface Area { id: string; name: string; divisionId: string; }
interface Branch { id: string; name: string; code: string; }

interface DeathMemberRow {
    sNo: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centerId: string;
    centerName: string;
    fdoName: string;
    dateOfDeath: string | null;
    deathPerson: string;
    productType: string;
    loanId: string;
    memberId: string;
    memberName: string;
    nomineeName: string;
    address: string;
    district: string;
    phoneNumber: string;
    aadhaarNumber: string;
    loanDisbursementDate: string | null;
    firstEmiDate: string | null;
    loanMaturityDate: string | null;
    loanPrincipal: number;
    loanInterest: number;
    loanAmount: number;
    osPrincipal: number;
    osInterest: number;
    osTotal: number;
    arrearPrincipal: number;
    arrearInterest: number;
    arrearTotal: number;
    interestRate:         number;
    fundingName:          string;
    deathCertificateUrl:  string | null;
    deathCertificateName: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (d: string | null | undefined) => {
    if (!d) return '—';
    const dt = new Date(d);
    return isValid(dt) ? format(dt, 'dd/MM/yyyy') : '—';
};

const fmtAmt = (n: number) => formatReportAmount(n);

const todayStr = () => new Date().toISOString().split('T')[0];

// ─── Component ────────────────────────────────────────────────────────────────

export function DeathMemberReport() {
    const { toast } = useToast();
    const { hasRole, canExportReport, getReportExportMode } = usePermission();
    const { user } = useAuthStore();
    const isAdmin = hasRole('admin');

    // Hierarchy filter state
    const [regions, setRegions] = useState<Region[]>([]);
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [areas, setAreas] = useState<Area[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<Branch[]>([]);

    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedDivision, setSelectedDivision] = useState('');
    const [selectedArea, setSelectedArea] = useState('');
    const [selectedBranch, setSelectedBranch] = useState('');
    const [selectedCenter, setSelectedCenter] = useState('');

    const [fromDate, setFromDate] = useState(todayStr());
    const [toDate, setToDate] = useState(todayStr());
    const [submittedFromDate, setSubmittedFromDate] = useState(todayStr());
    const [submittedToDate, setSubmittedToDate] = useState(todayStr());

    // Report state
    const [reportData, setReportData] = useState<DeathMemberRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // ── On mount: load hierarchy data based on role ────────────────────────

    useEffect(() => {
        if (isAdmin) {
            apiClient.get<Region[]>('/regions').then((res) => {
                if (res.success && res.data) setRegions(res.data);
            });
        } else if (user?.id) {
            // AM: load only their assigned branches
            apiClient
                .get<{ branch: Branch }[]>(`/area-manager-branches?userId=${user.id}`)
                .then((res) => {
                    if (res.success && res.data) {
                        setBranches(res.data.map((a) => a.branch));
                    }
                });
        }
    }, [isAdmin, user?.id]);

    // ── Cascading fetches ──────────────────────────────────────────────────

    const toVal = (v: string) => (v === 'all' ? '' : v);
    const fromVal = (v: string) => (v === '' ? 'all' : v);

    const handleRegionChange = async (raw: string) => {
        const regionId = toVal(raw);
        setSelectedRegion(regionId);
        setSelectedDivision('');
        setSelectedArea('');
        setSelectedBranch('');
        setSelectedCenter('');
        setDivisions([]);
        setAreas([]);
        setBranches([]);
        setCenters([]);

        if (!regionId) return;
        const res = await apiClient.get<Division[]>(`/divisions?regionId=${regionId}`);
        if (res.success && res.data) setDivisions(res.data);
    };

    const handleDivisionChange = async (raw: string) => {
        const divisionId = toVal(raw);
        setSelectedDivision(divisionId);
        setSelectedArea('');
        setSelectedBranch('');
        setSelectedCenter('');
        setAreas([]);
        setBranches([]);
        setCenters([]);

        if (!divisionId) return;
        const res = await apiClient.get<Area[]>(`/areas?divisionId=${divisionId}`);
        if (res.success && res.data) setAreas(res.data);
    };

    const handleAreaChange = async (raw: string) => {
        const areaId = toVal(raw);
        setSelectedArea(areaId);
        setSelectedBranch('');
        setSelectedCenter('');
        setBranches([]);
        setCenters([]);

        if (!areaId) return;
        const res = await apiClient.get<Branch[]>(`/branches?areaId=${areaId}`);
        if (res.success && res.data) setBranches(res.data);
    };

    const handleBranchChange = async (raw: string) => {
        const branchId = toVal(raw);
        setSelectedBranch(branchId);
        setSelectedCenter('');
        setCenters([]);

        if (!branchId) return;
        const res = await apiClient.get<Branch[]>(`/centers?branchId=${branchId}`);
        if (res.success && res.data) setCenters(res.data);
    };

    // ── Show / Reset ───────────────────────────────────────────────────────

    const handleShow = async () => {
        if (!fromDate || !toDate) {
            toast({ title: 'Date required', description: 'Please select a date range.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ fromDate, toDate });
            if (selectedRegion) params.set('regionId', selectedRegion);
            if (selectedDivision) params.set('divisionId', selectedDivision);
            if (selectedArea) params.set('areaId', selectedArea);
            if (selectedBranch) params.set('branchId', selectedBranch);
            if (selectedCenter) params.set('centerId', selectedCenter);

            const res = await apiClient.get<DeathMemberRow[]>(`/reports/client/death-member?${params}`);
            if (res.success && res.data) {
                setReportData(res.data);
                setShowReport(true);
                setCurrentPage(1);
                setSearchQuery('');
                setSubmittedFromDate(fromDate);
                setSubmittedToDate(toDate);
                toast({
                    title: 'Report Loaded',
                    description: `${res.data.length} death-marked loan(s) found.`,
                });
            } else {
                toast({ title: 'No Data', description: res.error || 'No records found.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch report.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedRegion('');
        setSelectedDivision('');
        setSelectedArea('');
        setSelectedBranch('');
        setSelectedCenter('');
        setDivisions([]);
        setAreas([]);
        if (isAdmin) setBranches([]);
        setCenters([]);
        setFromDate(todayStr());
        setToDate(todayStr());
        setSubmittedFromDate(todayStr());
        setSubmittedToDate(todayStr());
        setReportData([]);
        setShowReport(false);
        setSearchQuery('');
        setCurrentPage(1);
    };

    // ── Filtered / paginated data ──────────────────────────────────────────

    const filteredData = useMemo(() => {
        if (!searchQuery.trim()) return reportData;
        const q = searchQuery.toLowerCase();
        return reportData.filter(
            (r) =>
                r.memberName.toLowerCase().includes(q) ||
                r.memberId.toLowerCase().includes(q) ||
                r.loanId.toLowerCase().includes(q) ||
                r.phoneNumber.includes(q) ||
                r.centerName.toLowerCase().includes(q) ||
                r.branchName.toLowerCase().includes(q)
        );
    }, [reportData, searchQuery]);

    const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredData.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredData, currentPage]);

    // ── Summary totals ─────────────────────────────────────────────────────

    const totals = useMemo(
        () =>
            filteredData.reduce(
                (acc, r) => ({
                    loanPrincipal: acc.loanPrincipal + r.loanPrincipal,
                    loanInterest: acc.loanInterest + r.loanInterest,
                    loanAmount: acc.loanAmount + r.loanAmount,
                    osPrincipal: acc.osPrincipal + r.osPrincipal,
                    osInterest: acc.osInterest + r.osInterest,
                    osTotal: acc.osTotal + r.osTotal,
                    arrearPrincipal: acc.arrearPrincipal + r.arrearPrincipal,
                    arrearInterest: acc.arrearInterest + r.arrearInterest,
                    arrearTotal: acc.arrearTotal + r.arrearTotal,
                }),
                {
                    loanPrincipal: 0, loanInterest: 0, loanAmount: 0,
                    osPrincipal: 0, osInterest: 0, osTotal: 0,
                    arrearPrincipal: 0, arrearInterest: 0, arrearTotal: 0,
                }
            ),
        [filteredData]
    );

    // ── Excel export ───────────────────────────────────────────────────────

    const handleExportExcel = () => {
        if (filteredData.length === 0) return;
        const exportRows: Record<string, string | number>[] = filteredData.map((r, i) => ({
            'S.No': i + 1,
            'Region Name': r.regionName,
            'Division Name': r.divisionName,
            'Area Name': r.areaName,
            'Branch ID': r.branchId,
            'Branch Name': r.branchName,
            'Center ID': r.centerId,
            'Center Name': r.centerName,
            'FDO Name': r.fdoName,
            'Date of Death': fmt(r.dateOfDeath),
            'Death Person': r.deathPerson,
            'Product Type': r.productType,
            'Loan ID': r.loanId,
            'Member ID': r.memberId,
            'Member Name': r.memberName,
            'Nominee Name': r.nomineeName,
            'Address': r.address,
            'District': r.district,
            'Phone Number': r.phoneNumber,
            'Aadhaar Number': r.aadhaarNumber,
            'Disbursement Date': fmt(r.loanDisbursementDate),
            '1st EMI Date': fmt(r.firstEmiDate),
            'Loan Maturity Date': fmt(r.loanMaturityDate),
            'Loan Principal': truncateReportAmount(r.loanPrincipal),
            'Loan Interest': truncateReportAmount(r.loanInterest),
            'Loan Amount': truncateReportAmount(r.loanAmount),
            'OS Principal': truncateReportAmount(r.osPrincipal),
            'OS Interest': truncateReportAmount(r.osInterest),
            'OS Total': truncateReportAmount(r.osTotal),
            'Arrear Principal': truncateReportAmount(r.arrearPrincipal),
            'Arrear Interest': truncateReportAmount(r.arrearInterest),
            'Arrear Total': truncateReportAmount(r.arrearTotal),
            'Interest Rate (%)': r.interestRate,
            'Funding Name': r.fundingName,
            'Death Certificate': r.deathCertificateName ?? '—',
        }));

        if (filteredData.length > 0) {
            exportRows.push({
                'S.No': `Totals (${filteredData.length} records)`, 'Region Name': '', 'Division Name': '', 'Area Name': '',
                'Branch ID': '', 'Branch Name': '', 'Center ID': '', 'Center Name': '', 'FDO Name': '',
                'Date of Death': '', 'Death Person': '', 'Product Type': '', 'Loan ID': '', 'Member ID': '',
                'Member Name': '', 'Nominee Name': '', 'Address': '', 'District': '', 'Phone Number': '',
                'Aadhaar Number': '', 'Disbursement Date': '', '1st EMI Date': '', 'Loan Maturity Date': '',
                'Loan Principal': truncateReportAmount(totals.loanPrincipal), 'Loan Interest': truncateReportAmount(totals.loanInterest), 'Loan Amount': truncateReportAmount(totals.loanAmount),
                'OS Principal': truncateReportAmount(totals.osPrincipal), 'OS Interest': truncateReportAmount(totals.osInterest), 'OS Total': truncateReportAmount(totals.osTotal),
                'Arrear Principal': truncateReportAmount(totals.arrearPrincipal), 'Arrear Interest': truncateReportAmount(totals.arrearInterest), 'Arrear Total': truncateReportAmount(totals.arrearTotal),
                'Interest Rate (%)': '', 'Funding Name': '', 'Death Certificate': '',
            });
        }

        const ws = buildReportSheet('Death Member Report', exportRows);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Death Member Report');
        XLSX.writeFile(wb, `Death_Member_Report_${submittedFromDate}_to_${submittedToDate}.xlsx`);
        toast({ title: 'Excel Exported', description: 'File downloaded successfully.' });
    };

    // ── PDF export ─────────────────────────────────────────────────────────

    const handleExportPDF = async () => {
        if (filteredData.length === 0) return;

        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(pdf);
        await drawDeathMemberReport(pdf, filteredData, { subtitle: `Period: ${fmt(submittedFromDate)} to ${fmt(submittedToDate)}` }, reportFont);

        pdf.save(`Death_Member_Report_${submittedFromDate}_to_${submittedToDate}.pdf`);
        toast({ title: 'PDF Exported', description: 'File downloaded successfully.' });
    };

    // ── CSV / Word export (mirrors the same field mapping used by handleExportExcel
    // above, kept separate so handleExportExcel is left untouched) ────────────────

    const buildDeathMemberExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name',
            'Center ID', 'Center Name', 'FDO Name', 'Date of Death', 'Death Person', 'Product Type',
            'Loan ID', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District',
            'Phone Number', 'Aadhaar Number', 'Disbursement Date', '1st EMI Date', 'Loan Maturity Date',
            'Loan Principal', 'Loan Interest', 'Loan Amount', 'OS Principal', 'OS Interest', 'OS Total',
            'Arrear Principal', 'Arrear Interest', 'Arrear Total', 'Interest Rate (%)', 'Funding Name',
            'Death Certificate',
        ];
        const rows: (string | number)[][] = filteredData.map((r, i) => [
            i + 1, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName,
            r.centerId, r.centerName, r.fdoName, fmt(r.dateOfDeath), r.deathPerson, r.productType,
            r.loanId, r.memberId, r.memberName, r.nomineeName, r.address, r.district,
            r.phoneNumber, r.aadhaarNumber, fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
            truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanAmount), truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest), truncateReportAmount(r.osTotal),
            truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest), truncateReportAmount(r.arrearTotal), r.interestRate, r.fundingName,
            r.deathCertificateName ?? '—',
        ]);
        if (filteredData.length > 0) {
            rows.push([
                `Totals (${filteredData.length} records)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
                truncateReportAmount(totals.loanPrincipal), truncateReportAmount(totals.loanInterest), truncateReportAmount(totals.loanAmount),
                truncateReportAmount(totals.osPrincipal), truncateReportAmount(totals.osInterest), truncateReportAmount(totals.osTotal),
                truncateReportAmount(totals.arrearPrincipal), truncateReportAmount(totals.arrearInterest), truncateReportAmount(totals.arrearTotal),
                '', '', '',
            ]);
        }
        return { headers, rows };
    };

    const handleExportCSV = () => {
        if (filteredData.length === 0) return;
        const { headers, rows } = buildDeathMemberExportRows();
        exportToCSV(`Death_Member_Report_${submittedFromDate}_to_${submittedToDate}`, 'DEATH MEMBER REPORT', headers, rows);
        toast({ title: 'CSV Exported', description: 'File downloaded successfully.' });
    };

    // Word-only presentation: same rows as CSV above, but the trailing Totals row is
    // split off for distinct styling, and genuinely related column clusters (location,
    // branch/center ID+Name pairs, member info, Principal/Interest/Total triads) get a
    // 2-row grouped header. At 35 columns (same scale as Client Portfolio) this needs
    // A3 landscape.
    const buildDeathMemberWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                { label: 'FDO Name', span: 1 }, { label: 'Date of Death', span: 1 }, { label: 'Death Person', span: 1 },
                { label: 'Product Type', span: 1 }, { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 7 },
                { label: 'LOAN DATES', span: 3 }, { label: 'LOAN AMOUNT', span: 3 }, { label: 'OUTSTANDING', span: 3 },
                { label: 'ARREAR', span: 3 }, { label: 'Interest Rate (%)', span: 1 }, { label: 'Funding Name', span: 1 },
                { label: 'Death Certificate', span: 1 },
            ],
            subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Center ID', 'Center Name', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Aadhaar', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'center', 'left', 'left', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
            columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 9, 7, 8, 8, 7, 7, 12, 10, 10, 7, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 9, 10],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWord = async () => {
        if (filteredData.length === 0) return;
        const { headers, rows } = buildDeathMemberExportRows();
        const { bodyRows, options } = buildDeathMemberWordOptions(rows);
        await exportToWord(`Death_Member_Report_${submittedFromDate}_to_${submittedToDate}`, 'DEATH MEMBER REPORT', headers, bodyRows, options);
        toast({ title: 'Word Exported', description: 'File downloaded successfully.' });
    };

    // ── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20">
                    <Skull className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-primary">
                        Death Member Report
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Loans with death markings — loan-wise view
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-sidebar-accent dark:text-primary uppercase tracking-wide">
                    Filters
                </h2>

                {/* Row 1: Hierarchy (ADMIN only) */}
                {isAdmin && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-sidebar-accent">Region</Label>
                            <Select value={fromVal(selectedRegion)} onValueChange={handleRegionChange}>
                                <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                    <SelectValue placeholder="-- All Regions --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- All Regions --</SelectItem>
                                    {regions.map((r) => (
                                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-sidebar-accent">Division</Label>
                            <Select
                                value={fromVal(selectedDivision)}
                                onValueChange={handleDivisionChange}
                                disabled={!selectedRegion}
                            >
                                <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                    <SelectValue placeholder="-- All Divisions --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- All Divisions --</SelectItem>
                                    {divisions.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-sidebar-accent">Area</Label>
                            <Select
                                value={fromVal(selectedArea)}
                                onValueChange={handleAreaChange}
                                disabled={!selectedDivision}
                            >
                                <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                    <SelectValue placeholder="-- All Areas --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- All Areas --</SelectItem>
                                    {areas.map((a) => (
                                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                {/* Row 2: Branch / Center / Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Branch</Label>
                        <Select
                            value={fromVal(selectedBranch)}
                            onValueChange={handleBranchChange}
                            disabled={isAdmin ? !selectedArea : false}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue placeholder="-- All Branches --" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Branches --</SelectItem>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Center</Label>
                        <Select
                            value={fromVal(selectedCenter)}
                            onValueChange={(raw) => setSelectedCenter(toVal(raw))}
                            disabled={!selectedBranch}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue placeholder="-- All Centers --" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Centers --</SelectItem>
                                {centers.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">From Date</Label>
                        <DateInput
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="h-9 border-primary/30 focus:border-primary"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">To Date</Label>
                        <DateInput
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="h-9 border-primary/30 focus:border-primary"
                        />
                    </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-3 pt-1">
                    <Button
                        onClick={handleShow}
                        disabled={isLoading}
                        className="bg-primary hover:bg-sidebar-accent text-white h-9 px-6"
                    >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {isLoading ? 'Loading...' : 'Show'}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleReset}
                        className="border-primary/30 text-sidebar-accent hover:bg-primary/5 h-9"
                    >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reset
                    </Button>
                </div>
            </div>

            {/* Report Table */}
            {showReport && (
                <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl shadow-sm overflow-hidden">
                    {/* Toolbar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-primary/10">
                        <div className="flex items-center gap-2 text-sm text-sidebar-accent dark:text-primary font-medium">
                            <Skull className="h-4 w-4" />
                            {filteredData.length} Record{filteredData.length !== 1 ? 's' : ''}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search member, loan, branch..."
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                    className="h-8 pl-8 w-56 text-xs border-primary/30"
                                />
                            </div>
                            <ExportDropdown
                                onExportPDF={handleExportPDF}
                                onExportExcel={handleExportExcel}
                                onExportCSV={handleExportCSV}
                                canExport={canExportReport('death-member')}
                                onExportWord={handleExportWord}
                                reportSlug={getReportExportMode('death-member') === 'REQUEST_QUEUE' ? 'death-member' : undefined}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedToDate,
                                    branchIds: selectedBranch ? [selectedBranch] : 'ALL',
                                    filters: {
                                        ...(selectedRegion ? { regionId: selectedRegion } : {}),
                                        ...(selectedDivision ? { divisionId: selectedDivision } : {}),
                                        ...(selectedArea ? { areaId: selectedArea } : {}),
                                        ...(selectedCenter ? { centerId: selectedCenter } : {}),
                                    },
                                }}
                                className="h-8 text-xs border-primary/30 text-sidebar-accent hover:bg-primary/5"
                            />
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[2400px]">
                            <thead>
                                <tr
                                    className="text-white text-center bg-gradient-to-r from-primary to-green-400"
                                >
                                    {[
                                        'S.No', 'Region', 'Division', 'Area',
                                        'Br.ID', 'Branch Name', 'Ctr.ID', 'Center Name',
                                        'FDO Name', 'Death Date', 'Death Person', 'Product Type',
                                        'Loan ID', 'Member ID', 'Member Name', 'Nominee Name',
                                        'Address', 'District', 'Phone', 'Aadhaar',
                                        'Disb. Date', '1st EMI', 'Maturity Date',
                                        'Loan Principal', 'Loan Interest', 'Loan Amount',
                                        'OS Principal', 'OS Interest', 'OS Total',
                                        'Arr. Principal', 'Arr. Interest', 'Arr. Total',
                                        'Rate %', 'Funder', 'Death Certificate',
                                    ].map((col) => (
                                        <th
                                            key={col}
                                            className="px-2 py-2.5 font-semibold whitespace-nowrap border-r border-white/20 last:border-r-0"
                                        >
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedData.length === 0 ? (
                                    <tr>
                                        <td colSpan={34} className="text-center py-8 text-muted-foreground">
                                            No records found.
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedData.map((row, idx) => (
                                        <tr
                                            key={row.loanId}
                                            className={cn(
                                                'border-b border-primary/10 hover:bg-primary/5 transition-colors',
                                                idx % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-brand-green-tint dark:bg-brand-green-darker'
                                            )}
                                        >
                                            <td className="px-2 py-2 text-center font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                            <td className="px-2 py-2 text-center">{row.regionName || '—'}</td>
                                            <td className="px-2 py-2 text-center">{row.divisionName || '—'}</td>
                                            <td className="px-2 py-2 text-center">{row.areaName || '—'}</td>
                                            <td className="px-2 py-2 text-center font-mono">{row.branchId}</td>
                                            <td className="px-2 py-2 text-left whitespace-nowrap">{row.branchName}</td>
                                            <td className="px-2 py-2 text-center font-mono">{row.centerId}</td>
                                            <td className="px-2 py-2 text-left whitespace-nowrap">{row.centerName}</td>
                                            <td className="px-2 py-2 text-left whitespace-nowrap">{row.fdoName || '—'}</td>
                                            <td className="px-2 py-2 text-center whitespace-nowrap text-red-600 dark:text-red-400 font-medium">
                                                {fmt(row.dateOfDeath)}
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <span className={cn(
                                                    'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase',
                                                    row.deathPerson === 'MEMBER'
                                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                                )}>
                                                    {row.deathPerson === 'CO_APPLICANT' ? 'Co-Applicant' : row.deathPerson}
                                                </span>
                                            </td>
                                            <td className="px-2 py-2 text-center">{row.productType || '—'}</td>
                                            <td className="px-2 py-2 text-center font-mono">{row.loanId}</td>
                                            <td className="px-2 py-2 text-center font-mono">{row.memberId}</td>
                                            <td className="px-2 py-2 text-left whitespace-nowrap font-medium">{row.memberName}</td>
                                            <td className="px-2 py-2 text-left">{row.nomineeName || '—'}</td>
                                            <td className="px-2 py-2 text-left max-w-[120px] truncate" title={row.address}>{row.address || '—'}</td>
                                            <td className="px-2 py-2 text-center">{row.district || '—'}</td>
                                            <td className="px-2 py-2 text-center font-mono">{row.phoneNumber || '—'}</td>
                                            <td className="px-2 py-2 text-center font-mono">{row.aadhaarNumber || '—'}</td>
                                            <td className="px-2 py-2 text-center whitespace-nowrap">{fmt(row.loanDisbursementDate)}</td>
                                            <td className="px-2 py-2 text-center whitespace-nowrap">{fmt(row.firstEmiDate)}</td>
                                            <td className="px-2 py-2 text-center whitespace-nowrap">{fmt(row.loanMaturityDate)}</td>
                                            <td className="px-2 py-2 text-right">{fmtAmt(row.loanPrincipal)}</td>
                                            <td className="px-2 py-2 text-right">{fmtAmt(row.loanInterest)}</td>
                                            <td className="px-2 py-2 text-right font-medium">{fmtAmt(row.loanAmount)}</td>
                                            <td className="px-2 py-2 text-right">{fmtAmt(row.osPrincipal)}</td>
                                            <td className="px-2 py-2 text-right">{fmtAmt(row.osInterest)}</td>
                                            <td className="px-2 py-2 text-right font-medium text-amber-700 dark:text-amber-400">{fmtAmt(row.osTotal)}</td>
                                            <td className="px-2 py-2 text-right">{fmtAmt(row.arrearPrincipal)}</td>
                                            <td className="px-2 py-2 text-right">{fmtAmt(row.arrearInterest)}</td>
                                            <td className="px-2 py-2 text-right font-medium text-red-700 dark:text-red-400">{fmtAmt(row.arrearTotal)}</td>
                                            <td className="px-2 py-2 text-right">{row.interestRate}%</td>
                                            <td className="px-2 py-2 text-left whitespace-nowrap">{row.fundingName || '—'}</td>
                                            <td className="px-2 py-2 whitespace-nowrap">
                                                {row.deathCertificateUrl && row.deathCertificateName ? (
                                                    <a
                                                        href={row.deathCertificateUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-blue-600 underline hover:text-blue-800 text-xs"
                                                        title={row.deathCertificateName}
                                                    >
                                                        {row.deathCertificateName}
                                                    </a>
                                                ) : '—'}
                                            </td>
                                        </tr>
                                    ))
                                )}

                                {/* Totals row */}
                                {filteredData.length > 0 && (
                                    <tr className="border-t-2 border-primary bg-primary/10 dark:bg-primary/20 font-bold text-foreground dark:text-primary">
                                        <td colSpan={23} className="px-2 py-2 text-right text-xs uppercase tracking-wide">
                                            Totals ({filteredData.length} records)
                                        </td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.loanPrincipal)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.loanInterest)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.loanAmount)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.osPrincipal)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.osInterest)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.osTotal)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.arrearPrincipal)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.arrearInterest)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.arrearTotal)}</td>
                                        <td colSpan={2} />
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-primary/10">
                        <span className="text-xs text-muted-foreground">
                            Showing {filteredData.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredData.length)} of {filteredData.length} records
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCurrentPage(1)}
                                disabled={currentPage === 1}
                                className="h-7 w-7 p-0 border-primary/30"
                            >
                                <ChevronsLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="h-7 w-7 p-0 border-primary/30"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                const page =
                                    totalPages <= 5
                                        ? i + 1
                                        : currentPage <= 3
                                        ? i + 1
                                        : currentPage >= totalPages - 2
                                        ? totalPages - 4 + i
                                        : currentPage - 2 + i;
                                return (
                                    <Button
                                        key={page}
                                        size="sm"
                                        variant={currentPage === page ? 'default' : 'outline'}
                                        onClick={() => setCurrentPage(page)}
                                        className={cn(
                                            'h-7 w-7 p-0 text-xs',
                                            currentPage === page
                                                ? 'bg-primary hover:bg-sidebar-accent text-white border-primary'
                                                : 'border-primary/30 text-sidebar-accent'
                                        )}
                                    >
                                        {page}
                                    </Button>
                                );
                            })}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="h-7 w-7 p-0 border-primary/30"
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCurrentPage(totalPages)}
                                disabled={currentPage === totalPages || totalPages === 0}
                                className="h-7 w-7 p-0 border-primary/30"
                            >
                                <ChevronsRight className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
