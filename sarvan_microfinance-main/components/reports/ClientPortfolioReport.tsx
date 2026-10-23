'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import * as XLSX from 'xlsx-js-style';
import { format, isValid } from 'date-fns';
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
    BarChart3,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawClientPortfolioReport } from '@/app/lib/reports/client-portfolio-report-pdf';
import { buildReportSheet, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { truncateReportAmount, formatReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Region { id: string; name: string; }
interface Division { id: string; name: string; regionId: string; }
interface Area { id: string; name: string; divisionId: string; }
interface Branch { id: string; name: string; code: string; }
interface Center { id: string; name: string; code: string; }
interface ProductType { id: string; name: string; }
interface LoanProduct { productId: string; productName: string; }
interface Funder { id: string; funderName: string; }

interface PortfolioRow {
    sNo: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centerId: string;
    centerName: string;
    fdoName: string;
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
    interestRate: number;
    fundingName: string;
    isDead: boolean;
    deceasedPersonType: string | null;
    deceasedPersonName: string | null;
}

interface ApiResponse {
    data: PortfolioRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (d: string | null | undefined) => {
    if (!d) return '—';
    const dt = new Date(d);
    return isValid(dt) ? format(dt, 'dd/MM/yyyy') : '—';
};

const fmtAmt = (n: number) => formatReportAmount(n);

const toVal = (v: string) => (v === 'all' ? '' : v);
const fromVal = (v: string) => (v === '' ? 'all' : v);

// ─── Component ────────────────────────────────────────────────────────────────

export function ClientPortfolioReport() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    // Hierarchy filter state
    const [regions, setRegions] = useState<Region[]>([]);
    const [divisions, setDivisions] = useState<Division[]>([]);
    const [areas, setAreas] = useState<Area[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<Center[]>([]);

    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedDivision, setSelectedDivision] = useState('');
    const [selectedArea, setSelectedArea] = useState('');
    const [selectedBranch, setSelectedBranch] = useState('');
    const [selectedCenter, setSelectedCenter] = useState('');

    // Product / Funding filter state
    const [productTypes, setProductTypes] = useState<ProductType[]>([]);
    const [loanProducts, setLoanProducts] = useState<LoanProduct[]>([]);
    const [funders, setFunders] = useState<Funder[]>([]);

    const [selectedProductType, setSelectedProductType] = useState('');
    const [selectedLoanProduct, setSelectedLoanProduct] = useState('');
    const [selectedFunder, setSelectedFunder] = useState('');

    // Report state
    const [reportData, setReportData] = useState<PortfolioRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);

    // Server-side search and pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const PAGE_SIZE = 20;

    // ── On mount: load master dropdowns ───────────────────────────────────

    useEffect(() => {
        apiClient.get<Region[]>('/regions').then((res) => {
            if (res.success && res.data) setRegions(res.data);
        });
        apiClient.get<ProductType[]>('/loan-product-types').then((res) => {
            if (res.success && res.data) setProductTypes(res.data as ProductType[]);
        });
        apiClient.get<Funder[]>('/masters/funder').then((res) => {
            if (res.success && res.data) setFunders(res.data);
        });
    }, []);

    // ── Cascading hierarchy handlers ───────────────────────────────────────

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
        const res = await apiClient.get<Center[]>(`/centers?branchId=${branchId}`);
        if (res.success && res.data) setCenters(res.data);
    };

    const handleProductTypeChange = async (raw: string) => {
        const productTypeId = toVal(raw);
        setSelectedProductType(productTypeId);
        setSelectedLoanProduct('');
        setLoanProducts([]);

        if (!productTypeId) return;
        const res = await apiClient.get<{ loanProducts: LoanProduct[] }>(
            `/loan-product-types?id=${productTypeId}`
        );
        if (res.success && res.data) {
            setLoanProducts((res.data as { loanProducts?: LoanProduct[] }).loanProducts ?? []);
        }
    };

    // ── Build query params helper ──────────────────────────────────────────

    const buildParams = useCallback(
        (overrides: Record<string, string> = {}) => {
            const params = new URLSearchParams({ ...overrides });
            if (selectedRegion) params.set('regionId', selectedRegion);
            if (selectedDivision) params.set('divisionId', selectedDivision);
            if (selectedArea) params.set('areaId', selectedArea);
            if (selectedBranch) params.set('branchId', selectedBranch);
            if (selectedCenter) params.set('centerId', selectedCenter);
            if (selectedProductType) params.set('productTypeId', selectedProductType);
            if (selectedLoanProduct) params.set('loanProductId', selectedLoanProduct);
            if (selectedFunder) params.set('funderId', selectedFunder);
            if (searchQuery.trim()) params.set('search', searchQuery.trim());
            return params;
        },
        [selectedRegion, selectedDivision, selectedArea, selectedBranch,
            selectedCenter, selectedProductType, selectedLoanProduct, selectedFunder, searchQuery]
    );

    // ── Fetch report page ──────────────────────────────────────────────────

    const fetchReport = useCallback(
        async (page: number) => {
            setIsLoading(true);
            try {
                const params = buildParams({ page: String(page), pageSize: String(PAGE_SIZE) });

                const res = await apiClient.get<ApiResponse>(
                    `/admin-reports/portfolio/client-portfolio-report?${params}`
                );

                if (res.success && res.data) {
                    const { data, total, totalPages: tp } = res.data;
                    setReportData(data);
                    setTotalRecords(total);
                    setTotalPages(tp);
                    setCurrentPage(page);
                    setShowReport(true);
                    if (page === 1) {
                        toast({
                            title: 'Report Loaded',
                            description: `${total} loan(s) found.`,
                        });
                    }
                } else {
                    toast({
                        title: 'No Data',
                        description: res.error || 'No records found.',
                        variant: 'destructive',
                    });
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to fetch report.', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        },
        [buildParams, toast]
    );

    const handleShow = () => fetchReport(1);

    const handleSearchSubmit = () => {
        if (showReport) fetchReport(1);
    };

    const handleReset = () => {
        setSelectedRegion('');
        setSelectedDivision('');
        setSelectedArea('');
        setSelectedBranch('');
        setSelectedCenter('');
        setSelectedProductType('');
        setSelectedLoanProduct('');
        setSelectedFunder('');
        setDivisions([]);
        setAreas([]);
        setBranches([]);
        setCenters([]);
        setLoanProducts([]);
        setReportData([]);
        setShowReport(false);
        setSearchQuery('');
        setCurrentPage(1);
        setTotalRecords(0);
        setTotalPages(0);
    };

    // ── Page totals (current page) ─────────────────────────────────────────

    const totals = useMemo(
        () =>
            reportData.reduce(
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
        [reportData]
    );

    // ── Fetch all data for export ──────────────────────────────────────────

    const fetchAllForExport = useCallback(async (): Promise<PortfolioRow[] | null> => {
        setIsExporting(true);
        try {
            const params = buildParams({ exportAll: 'true' });
            const res = await apiClient.get<ApiResponse>(
                `/admin-reports/portfolio/client-portfolio-report?${params}`
            );
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

    // ── Excel export (all matching records) ───────────────────────────────

    const handleExportExcel = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;

        const exportRows = allData.map((r, i) => ({
            'S.No': i + 1,
            'Region Name': r.regionName,
            'Division Name': r.divisionName,
            'Area Name': r.areaName,
            'Branch ID': r.branchId,
            'Branch Name': r.branchName,
            'Centre ID': r.centerId,
            'Center Name': r.centerName,
            'FDO Name': r.fdoName,
            'Product Type': r.productType,
            'Loan ID': r.loanId,
            'Member ID': r.memberId,
            'Member Name': r.memberName,
            'Nominee Name': r.nomineeName,
            'Address': r.address,
            'District': r.district,
            'Phone Number': r.phoneNumber,
            'Aadhaar Number': r.aadhaarNumber,
            'Loan Disbursement Date': fmt(r.loanDisbursementDate),
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
            'Is Dead': r.isDead ? 'Yes' : 'No',
            'Deceased Person Type': r.deceasedPersonType ?? '',
            'Deceased Person Name': r.deceasedPersonName ?? '',
        }));

        // Totals row
        const allTotals = allData.reduce(
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
            { loanPrincipal: 0, loanInterest: 0, loanAmount: 0, osPrincipal: 0, osInterest: 0, osTotal: 0, arrearPrincipal: 0, arrearInterest: 0, arrearTotal: 0 }
        );

        exportRows.push({
            'S.No': 0,
            'Region Name': 'GRAND TOTAL',
            'Division Name': '',
            'Area Name': '',
            'Branch ID': '',
            'Branch Name': '',
            'Centre ID': '',
            'Center Name': '',
            'FDO Name': '',
            'Product Type': '',
            'Loan ID': '',
            'Member ID': '',
            'Member Name': '',
            'Nominee Name': '',
            'Address': '',
            'District': '',
            'Phone Number': '',
            'Aadhaar Number': '',
            'Loan Disbursement Date': '',
            '1st EMI Date': '',
            'Loan Maturity Date': '',
            'Loan Principal': truncateReportAmount(allTotals.loanPrincipal),
            'Loan Interest': truncateReportAmount(allTotals.loanInterest),
            'Loan Amount': truncateReportAmount(allTotals.loanAmount),
            'OS Principal': truncateReportAmount(allTotals.osPrincipal),
            'OS Interest': truncateReportAmount(allTotals.osInterest),
            'OS Total': truncateReportAmount(allTotals.osTotal),
            'Arrear Principal': truncateReportAmount(allTotals.arrearPrincipal),
            'Arrear Interest': truncateReportAmount(allTotals.arrearInterest),
            'Arrear Total': truncateReportAmount(allTotals.arrearTotal),
            'Interest Rate (%)': 0,
            'Funding Name': '',
            'Is Dead': '',
            'Deceased Person Type': '',
            'Deceased Person Name': '',
        });

        const ws = buildReportSheet('Client Portfolio Report', exportRows);
        ws['!cols'] = [
            { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
            { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 18 },
            { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
            { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 14 },
            { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
            { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
            { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
            { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
            { wch: 8 }, { wch: 18 }, { wch: 20 },
        ];
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Client Portfolio');
        XLSX.writeFile(wb, `Client_Portfolio_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast({ title: 'Excel Exported', description: `${allData.length} records downloaded.` });
    };

    // ── PDF export (all matching records) ─────────────────────────────────

    const handleExportPDF = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;

        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(pdf);
        await drawClientPortfolioReport(pdf, allData, { subtitle: `Total Loans: ${allData.length}` }, reportFont);

        pdf.save(`Client_Portfolio_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        toast({ title: 'PDF Exported', description: `${allData.length} records downloaded.` });
    };

    // ── CSV / Word export (mirrors the same field mapping used by handleExportExcel
    // above, kept separate so handleExportExcel is left untouched) ────────────────

    const buildPortfolioExportRows = (allData: PortfolioRow[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name',
            'Centre ID', 'Center Name', 'FDO Name', 'Product Type', 'Loan ID', 'Member ID',
            'Member Name', 'Nominee Name', 'Address', 'District', 'Phone Number', 'Aadhaar Number',
            'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date', 'Loan Principal',
            'Loan Interest', 'Loan Amount', 'OS Principal', 'OS Interest', 'OS Total',
            'Arrear Principal', 'Arrear Interest', 'Arrear Total', 'Interest Rate (%)',
            'Funding Name', 'Is Dead', 'Deceased Person Type', 'Deceased Person Name',
        ];

        const rows: (string | number)[][] = allData.map((r, i) => [
            i + 1, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName,
            r.centerId, r.centerName, r.fdoName, r.productType, r.loanId, r.memberId,
            r.memberName, r.nomineeName, r.address, r.district, r.phoneNumber, r.aadhaarNumber,
            fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
            truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanAmount),
            truncateReportAmount(r.osPrincipal), truncateReportAmount(r.osInterest), truncateReportAmount(r.osTotal),
            truncateReportAmount(r.arrearPrincipal), truncateReportAmount(r.arrearInterest), truncateReportAmount(r.arrearTotal), r.interestRate, r.fundingName,
            r.isDead ? 'Yes' : 'No', r.deceasedPersonType ?? '', r.deceasedPersonName ?? '',
        ]);

        const allTotals = allData.reduce(
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
            { loanPrincipal: 0, loanInterest: 0, loanAmount: 0, osPrincipal: 0, osInterest: 0, osTotal: 0, arrearPrincipal: 0, arrearInterest: 0, arrearTotal: 0 }
        );

        rows.push([
            0, 'GRAND TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            '', '', '', truncateReportAmount(allTotals.loanPrincipal), truncateReportAmount(allTotals.loanInterest), truncateReportAmount(allTotals.loanAmount),
            truncateReportAmount(allTotals.osPrincipal), truncateReportAmount(allTotals.osInterest), truncateReportAmount(allTotals.osTotal),
            truncateReportAmount(allTotals.arrearPrincipal), truncateReportAmount(allTotals.arrearInterest), truncateReportAmount(allTotals.arrearTotal),
            0, '', '', '', '',
        ]);

        return { headers, rows };
    };

    const handleExportCSV = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const { headers, rows } = buildPortfolioExportRows(allData);
        exportToCSV(`Client_Portfolio_Report_${new Date().toISOString().split('T')[0]}`, 'Client Portfolio Report', headers, rows);
        toast({ title: 'CSV Exported', description: `${allData.length} records downloaded.` });
    };

    // Word-only presentation: same rows as PDF/CSV above (the PDF export already uses a
    // tiny 5pt font to fit this report's 35 columns — a strong signal it needs A3), but
    // the trailing GRAND TOTAL row is split off for distinct styling, and genuinely
    // related column clusters (location, branch/center ID+Name pairs, member info,
    // Principal/Interest/Total triads, death-record fields) get a 2-row grouped header.
    const buildPortfolioWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                { label: 'FDO Name', span: 1 }, { label: 'Product Type', span: 1 }, { label: 'Loan ID', span: 1 },
                { label: 'MEMBER INFO', span: 7 }, { label: 'LOAN DATES', span: 3 }, { label: 'LOAN AMOUNT', span: 3 },
                { label: 'OUTSTANDING', span: 3 }, { label: 'ARREAR', span: 3 }, { label: 'Interest Rate (%)', span: 1 },
                { label: 'Funding Name', span: 1 }, { label: 'DEATH INFO', span: 3 },
            ],
            subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Aadhaar', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Is Dead', 'Deceased Type', 'Deceased Name'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'center', 'left', 'left'],
            columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 9, 8, 7, 7, 12, 10, 10, 7, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 9, 6, 9, 9],
            totalsRow: rows[rows.length - 1],
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWord = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const { headers, rows } = buildPortfolioExportRows(allData);
        const { bodyRows, options } = buildPortfolioWordOptions(rows);
        await exportToWord(`Client_Portfolio_Report_${new Date().toISOString().split('T')[0]}`, 'Client Portfolio Report', headers, bodyRows, options);
        toast({ title: 'Word Exported', description: `${allData.length} records downloaded.` });
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20">
                    <BarChart3 className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-primary">
                        Client Portfolio Report
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Loan-wise portfolio — all disbursed loans with outstanding and arrear details
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-sidebar-accent dark:text-primary uppercase tracking-wide">
                    Filters
                </h2>

                {/* Row 1: Region → Division → Area */}
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

                {/* Row 2: Branch → Center */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Branch</Label>
                        <Select
                            value={fromVal(selectedBranch)}
                            onValueChange={handleBranchChange}
                            disabled={!selectedArea}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue placeholder="-- All Branches --" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Branches --</SelectItem>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                </div>

                {/* Row 3: Product Type → Loan Product + Funding */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Product Type</Label>
                        <Select
                            value={fromVal(selectedProductType)}
                            onValueChange={handleProductTypeChange}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue placeholder="-- All Product Types --" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Product Types --</SelectItem>
                                {productTypes.map((pt) => (
                                    <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Loan Product</Label>
                        <Select
                            value={fromVal(selectedLoanProduct)}
                            onValueChange={(raw) => setSelectedLoanProduct(toVal(raw))}
                            disabled={!selectedProductType}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue placeholder="-- All Loan Products --" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Loan Products --</SelectItem>
                                {loanProducts.map((lp) => (
                                    <SelectItem key={lp.productId} value={lp.productId}>
                                        {lp.productName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Funding</Label>
                        <Select
                            value={fromVal(selectedFunder)}
                            onValueChange={(raw) => setSelectedFunder(toVal(raw))}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue placeholder="-- All Funders --" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">-- All Funders --</SelectItem>
                                {funders.map((f) => (
                                    <SelectItem key={f.id} value={f.id}>{f.funderName}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button
                        onClick={handleShow}
                        disabled={isLoading || isExporting}
                        className="bg-primary hover:bg-sidebar-accent text-white h-9"
                    >
                        {isLoading ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...</>
                        ) : (
                            'Show Report'
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleReset}
                        disabled={isLoading || isExporting}
                        className="h-9 border-primary/30 text-sidebar-accent"
                    >
                        <RotateCcw className="h-4 w-4 mr-1" /> Reset
                    </Button>
                    {showReport && (
                        <>
                            <ExportDropdown
                                onExportPDF={!isLoading && !isExporting ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && !isExporting ? handleExportExcel : undefined}
                                onExportCSV={!isLoading && !isExporting ? handleExportCSV : undefined}
                                reportSlug={getReportExportMode('client-portfolio-report') === 'REQUEST_QUEUE' ? 'client-portfolio-report' : undefined}
                                canExport={canExportReport('client-portfolio-report')}
                                onExportWord={!isLoading && !isExporting ? handleExportWord : undefined}
                                exportParams={{
                                    fromDate: null,
                                    toDate: null,
                                    branchIds: selectedBranch ? [selectedBranch] : 'ALL',
                                    filters: selectedCenter ? { centerId: selectedCenter } : null,
                                }}
                                className="h-9 border-primary/30 text-sidebar-accent"
                            />
                        </>
                    )}
                </div>
            </div>

            {/* Report Table */}
            {showReport && (
                <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl shadow-sm overflow-hidden">
                    {/* Table toolbar */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
                        <div className="text-sm text-muted-foreground">
                            Showing page <span className="font-semibold text-sidebar-accent">{currentPage}</span> of{' '}
                            <span className="font-semibold text-sidebar-accent">{totalPages}</span> — {totalRecords} total loans
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative w-64">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search member / loan…"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
                                    className="pl-8 h-8 text-sm border-primary/30"
                                />
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleSearchSubmit}
                                disabled={isLoading}
                                className="h-8 border-primary/30 text-sidebar-accent"
                            >
                                <Search className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>

                    {/* Scrollable table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 z-10 bg-brand-green-tint dark:bg-sidebar-accent/50">
                                <tr>
                                    {[
                                        'S.No', 'Region', 'Division', 'Area',
                                        'Br.ID', 'Branch Name', 'Ctr.ID', 'Center Name',
                                        'FDO Name', 'Product Type', 'Loan ID',
                                        'Member ID', 'Member Name', 'Nominee Name',
                                        'Address', 'District', 'Phone', 'Aadhaar',
                                        'Disb. Date', '1st EMI', 'Maturity',
                                        'Principal', 'Interest', 'Loan Amount',
                                        'OS Principal', 'OS Interest', 'OS Total',
                                        'Arr. Principal', 'Arr. Interest', 'Arr. Total',
                                        'Rate %', 'Funder', 'Dead',
                                    ].map((h) => (
                                        <th
                                            key={h}
                                            className="whitespace-nowrap px-2 py-2 text-left font-semibold text-foreground dark:text-primary border-b border-primary/20"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((r, i) => (
                                    <tr
                                        key={r.loanId}
                                        className={`border-b border-primary/10 hover:bg-green-50 dark:hover:bg-brand-green-darker/40 ${
                                            i % 2 === 0 ? '' : 'bg-brand-green-tint dark:bg-brand-green-darker/60'
                                        }`}
                                    >
                                        <td className="px-2 py-1.5 text-center">{r.sNo}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.regionName || '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.divisionName || '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.areaName || '—'}</td>
                                        <td className="px-2 py-1.5">{r.branchId}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.branchName}</td>
                                        <td className="px-2 py-1.5">{r.centerId}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.centerName}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.fdoName || '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.productType || '—'}</td>
                                        <td className="px-2 py-1.5 font-mono">{r.loanId}</td>
                                        <td className="px-2 py-1.5 font-mono">{r.memberId}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.memberName}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.nomineeName || '—'}</td>
                                        <td className="px-2 py-1.5 max-w-[140px] truncate" title={r.address}>{r.address || '—'}</td>
                                        <td className="px-2 py-1.5">{r.district || '—'}</td>
                                        <td className="px-2 py-1.5 font-mono">{r.phoneNumber || '—'}</td>
                                        <td className="px-2 py-1.5 font-mono">{r.aadhaarNumber || '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.loanDisbursementDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.firstEmiDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.loanMaturityDate)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.loanPrincipal)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.loanInterest)}</td>
                                        <td className="px-2 py-1.5 text-right font-medium">{fmtAmt(r.loanAmount)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.osPrincipal)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.osInterest)}</td>
                                        <td className="px-2 py-1.5 text-right font-medium">{fmtAmt(r.osTotal)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.arrearPrincipal)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.arrearInterest)}</td>
                                        <td className="px-2 py-1.5 text-right font-medium text-red-600">{fmtAmt(r.arrearTotal)}</td>
                                        <td className="px-2 py-1.5 text-center">{r.interestRate}%</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.fundingName || '—'}</td>
                                        <td className="px-2 py-1.5">
                                            {r.isDead && (
                                                <Badge
                                                    variant="destructive"
                                                    className="text-[10px] px-1 py-0"
                                                    title={`${r.deceasedPersonType ?? ''} — ${r.deceasedPersonName ?? ''}`}
                                                >
                                                    Dead
                                                </Badge>
                                            )}
                                        </td>
                                    </tr>
                                ))}

                                {/* Page totals row */}
                                <tr className="bg-brand-green-tint dark:bg-sidebar-accent/40 font-bold border-t-2 border-primary/30">
                                    <td colSpan={21} className="px-2 py-2 text-right text-foreground dark:text-primary">
                                        Page Total
                                    </td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.loanPrincipal)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.loanInterest)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.loanAmount)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.osPrincipal)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.osInterest)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.osTotal)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.arrearPrincipal)}</td>
                                    <td className="px-2 py-2 text-right">{fmtAmt(totals.arrearInterest)}</td>
                                    <td className="px-2 py-2 text-right text-red-600">{fmtAmt(totals.arrearTotal)}</td>
                                    <td colSpan={3} />
                                </tr>
                            </tbody>
                        </table>

                        {reportData.length === 0 && (
                            <div className="py-12 text-center text-muted-foreground text-sm">
                                No records found for the selected filters.
                            </div>
                        )}
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-primary/10">
                        <span className="text-xs text-muted-foreground">
                            Page {currentPage} of {totalPages}
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => fetchReport(1)}
                                disabled={currentPage === 1 || isLoading}
                            >
                                <ChevronsLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => fetchReport(currentPage - 1)}
                                disabled={currentPage === 1 || isLoading}
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <span className="px-2 text-xs font-medium">{currentPage}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => fetchReport(currentPage + 1)}
                                disabled={currentPage === totalPages || isLoading}
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => fetchReport(totalPages)}
                                disabled={currentPage === totalPages || isLoading}
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
