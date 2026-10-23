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
    BookOpen,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawClosedLoanReport } from '@/app/lib/reports/closed-loan-report-pdf';
import { buildReportSheet, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { StorageLink } from '@/components/storage/StorageMedia';
import { DateInput } from '@/components/ui/date-input';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Region { id: string; name: string; }
interface Division { id: string; name: string; regionId: string; }
interface Area { id: string; name: string; divisionId: string; }
interface Branch { id: string; name: string; code: string; }
interface Center { id: string; name: string; code: string; }
interface ProductType { id: string; name: string; }
interface LoanProduct { productId: string; productName: string; }
interface Funder { id: string; funderName: string; }

interface ClosedLoanRow {
    sNo: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centerId: string;
    centerName: string;
    fdoName: string;
    loanId: string;
    loanType: string;
    memberId: string;
    memberName: string;
    reason: string;
    fundingName: string;
    loanDisbursementDate: string | null;
    firstEmiDate: string | null;
    loanMaturityDate: string | null;
    preCloseDate: string | null;
    closeDate: string | null;
    lastEmiDate: string | null;
    totalTenure: number;
    osPrincipalBeforeClose: number;
    osInterestBeforeClose: number;
    closeLoanWaiverInterest: number;
    loanAmount: number;
    amountOutstanding: number;
    interest: number;
    writeOffPrincipal: number;
    writeOffInterest: number;
    principalWaiver: number;
    interestWaiver: number;
    penaltyAmount: number;
    penaltyPaid: number;
    interestPercent: number;
    nextInstNo: number | null;
    isDead: boolean;
    deceasedPersonType:   string | null;
    deceasedPersonName:   string | null;
    deathCertificateUrl:  string | null;
    deathCertificateName: string | null;
    approvalDocumentName: string | null;
    approvalDocumentUrl:  string | null;
}

interface ApiResponse {
    data: ClosedLoanRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayIst = () => {
    const now = new Date();
    const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
    return ist.toISOString().split('T')[0];
};

const fmt = (d: string | Date | null | undefined) => {
    if (!d) return '—';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return isValid(dt) ? format(dt, 'dd/MM/yyyy') : '—';
};

const fmtAmt = (n: number) => formatReportAmount(n);

const toVal = (v: string) => (v === 'all' ? '' : v);
const fromVal = (v: string) => (v === '' ? 'all' : v);

// ─── Component ────────────────────────────────────────────────────────────────

export function ClosedLoanReport() {
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

    // Product / Funder / Closure filter state
    const [productTypes, setProductTypes] = useState<ProductType[]>([]);
    const [loanProducts, setLoanProducts] = useState<LoanProduct[]>([]);
    const [funders, setFunders] = useState<Funder[]>([]);

    const [selectedProductType, setSelectedProductType] = useState('');
    const [selectedLoanProduct, setSelectedLoanProduct] = useState('');
    const [selectedFunder, setSelectedFunder] = useState('');
    const [selectedClosureType, setSelectedClosureType] = useState('all');

    // Date range — default to today
    const [fromDate, setFromDate] = useState(todayIst());
    const [tillDate, setTillDate] = useState(todayIst());
    // Submitted (applied) date snapshot — frozen until the next Show click, so pagination,
    // the search-box resubmit, and exports keep using the last-submitted range even if
    // fromDate/tillDate above are edited afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);

    // Report state
    const [reportData, setReportData] = useState<ClosedLoanRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showReport, setShowReport] = useState(false);

    // Search and pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const PAGE_SIZE = 20;

    // ── On mount: load master dropdowns ───────────────────────────────────────

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

    // ── Cascading hierarchy handlers ──────────────────────────────────────────

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

    // ── Build query params ─────────────────────────────────────────────────────

    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the same
    // click — reading submittedFromDate/submittedTillDate here would otherwise use the
    // pre-update (stale) state, since the setSubmitted* calls in handleShow haven't re-rendered
    // yet. Callers other than handleShow (pagination, handleSearchSubmit, export) omit it and
    // get the last-submitted snapshot, which is the frozen-until-next-Show behavior they need.
    const buildParams = useCallback(
        (overrides: Record<string, string> = {}, dateOverride?: { fromDate: string; tillDate: string }) => {
            const params = new URLSearchParams({ ...overrides });
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effTillDate = dateOverride?.tillDate ?? submittedTillDate;
            if (effFromDate) params.set('fromDate', effFromDate);
            if (effTillDate) params.set('tillDate', effTillDate);
            if (selectedRegion) params.set('regionId', selectedRegion);
            if (selectedDivision) params.set('divisionId', selectedDivision);
            if (selectedArea) params.set('areaId', selectedArea);
            if (selectedBranch) params.set('branchId', selectedBranch);
            if (selectedCenter) params.set('centerId', selectedCenter);
            if (selectedProductType) params.set('productTypeId', selectedProductType);
            if (selectedLoanProduct) params.set('loanProductId', selectedLoanProduct);
            if (selectedFunder) params.set('funderId', selectedFunder);
            if (selectedClosureType !== 'all') params.set('closureType', selectedClosureType);
            if (searchQuery.trim()) params.set('search', searchQuery.trim());
            return params;
        },
        [
            submittedFromDate, submittedTillDate,
            selectedRegion, selectedDivision, selectedArea, selectedBranch, selectedCenter,
            selectedProductType, selectedLoanProduct, selectedFunder,
            selectedClosureType, searchQuery,
        ]
    );

    // ── Fetch report page ──────────────────────────────────────────────────────

    const fetchReport = useCallback(
        async (page: number, dateOverride?: { fromDate: string; tillDate: string }) => {
            const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
            const effTillDate = dateOverride?.tillDate ?? submittedTillDate;
            if (!effFromDate || !effTillDate) {
                toast({
                    title: 'Date Range Required',
                    description: 'Please select From Date and Till Date.',
                    variant: 'destructive',
                });
                return;
            }
            if (effFromDate > effTillDate) {
                toast({
                    title: 'Invalid Date Range',
                    description: 'From Date cannot be after Till Date.',
                    variant: 'destructive',
                });
                return;
            }

            setIsLoading(true);
            try {
                const params = buildParams({ page: String(page), pageSize: String(PAGE_SIZE) }, dateOverride);
                const res = await apiClient.get<ApiResponse>(
                    `/reports/client/closed-loan-report?${params}`
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
                        description: res.error || 'No records found for the selected filters.',
                        variant: 'destructive',
                    });
                    setReportData([]);
                    setTotalRecords(0);
                    setTotalPages(0);
                    setShowReport(true);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to fetch report.', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        },
        [buildParams, submittedFromDate, submittedTillDate, toast]
    );

    const handleShow = () => {
        const snapshot = { fromDate, tillDate };
        setSubmittedFromDate(fromDate);
        setSubmittedTillDate(tillDate);
        fetchReport(1, snapshot);
    };

    const handleSearchSubmit = () => {
        if (showReport) fetchReport(1);
    };

    const handleReset = () => {
        const today = todayIst();
        setSelectedRegion('');
        setSelectedDivision('');
        setSelectedArea('');
        setSelectedBranch('');
        setSelectedCenter('');
        setSelectedProductType('');
        setSelectedLoanProduct('');
        setSelectedFunder('');
        setSelectedClosureType('all');
        setFromDate(today);
        setTillDate(today);
        setSubmittedFromDate(today);
        setSubmittedTillDate(today);
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

    // ── Page totals ────────────────────────────────────────────────────────────

    const totals = useMemo(
        () =>
            reportData.reduce(
                (acc, r) => ({
                    osPrincipalBeforeClose: acc.osPrincipalBeforeClose + r.osPrincipalBeforeClose,
                    osInterestBeforeClose: acc.osInterestBeforeClose + r.osInterestBeforeClose,
                    closeLoanWaiverInterest: acc.closeLoanWaiverInterest + r.closeLoanWaiverInterest,
                    loanAmount: acc.loanAmount + r.loanAmount,
                    amountOutstanding: acc.amountOutstanding + r.amountOutstanding,
                    interest: acc.interest + r.interest,
                    writeOffPrincipal: acc.writeOffPrincipal + r.writeOffPrincipal,
                    writeOffInterest: acc.writeOffInterest + r.writeOffInterest,
                    principalWaiver: acc.principalWaiver + (r.principalWaiver ?? 0),
                    interestWaiver: acc.interestWaiver + (r.interestWaiver ?? 0),
                    penaltyAmount: acc.penaltyAmount + (r.penaltyAmount ?? 0),
                    penaltyPaid: acc.penaltyPaid + (r.penaltyPaid ?? 0),
                }),
                {
                    osPrincipalBeforeClose: 0,
                    osInterestBeforeClose: 0,
                    closeLoanWaiverInterest: 0,
                    loanAmount: 0,
                    amountOutstanding: 0,
                    interest: 0,
                    writeOffPrincipal: 0,
                    writeOffInterest: 0,
                    principalWaiver: 0,
                    interestWaiver: 0,
                    penaltyAmount: 0,
                    penaltyPaid: 0,
                }
            ),
        [reportData]
    );

    // ── Fetch all for export ───────────────────────────────────────────────────

    const fetchAllForExport = useCallback(async (): Promise<ClosedLoanRow[] | null> => {
        setIsExporting(true);
        try {
            const params = buildParams({ exportAll: 'true' });
            const res = await apiClient.get<ApiResponse>(
                `/reports/client/closed-loan-report?${params}`
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

    // ── Excel export ───────────────────────────────────────────────────────────

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
            'Center ID': r.centerId,
            'Center Name': r.centerName,
            'FDO Name': r.fdoName,
            'Loan ID': r.loanId,
            'Loan Type': r.loanType,
            'Member ID': r.memberId,
            'Member Name': r.memberName,
            'Reason': r.reason,
            'Funding Name': r.fundingName,
            'Loan Disbursement Date': fmt(r.loanDisbursementDate),
            '1st EMI Date': fmt(r.firstEmiDate),
            'Loan Maturity Date': fmt(r.loanMaturityDate),
            'PreClose Date': fmt(r.preCloseDate),
            'Close Date': fmt(r.closeDate),
            'Last EMI Date': fmt(r.lastEmiDate),
            'Total Tenure': r.totalTenure,
            'OS Principal Before Close': truncateReportAmount(r.osPrincipalBeforeClose),
            'OS Interest Before Close': truncateReportAmount(r.osInterestBeforeClose),
            'Close Loan Waiver Interest': truncateReportAmount(r.closeLoanWaiverInterest),
            'Loan Amount': truncateReportAmount(r.loanAmount),
            'Amount Outstanding': truncateReportAmount(r.amountOutstanding),
            'Interest': truncateReportAmount(r.interest),
            'WriteOff Principal': truncateReportAmount(r.writeOffPrincipal),
            'WriteOff Interest': truncateReportAmount(r.writeOffInterest),
            'Principal Waiver': truncateReportAmount(r.principalWaiver ?? 0),
            'Interest Waiver': truncateReportAmount(r.interestWaiver ?? 0),
            'Penalty Amount': truncateReportAmount(r.penaltyAmount ?? 0),
            'Penalty Paid': truncateReportAmount(r.penaltyPaid ?? 0),
            'Interest %': r.interestPercent,
            'Next Inst No': r.nextInstNo ?? '',
            'Is Dead': r.isDead ? 'Yes' : 'No',
            'Deceased Person Type': r.deceasedPersonType ?? '',
            'Deceased Person Name': r.deceasedPersonName ?? '',
            'Death Certificate': r.deathCertificateName ?? '—',
            'HO Approval Document': r.approvalDocumentName ?? '—',
        }));

        // Grand total row
        const allTotals = allData.reduce(
            (acc, r) => ({
                osPrincipalBeforeClose: acc.osPrincipalBeforeClose + r.osPrincipalBeforeClose,
                osInterestBeforeClose: acc.osInterestBeforeClose + r.osInterestBeforeClose,
                closeLoanWaiverInterest: acc.closeLoanWaiverInterest + r.closeLoanWaiverInterest,
                loanAmount: acc.loanAmount + r.loanAmount,
                amountOutstanding: acc.amountOutstanding + r.amountOutstanding,
                interest: acc.interest + r.interest,
                writeOffPrincipal: acc.writeOffPrincipal + r.writeOffPrincipal,
                writeOffInterest: acc.writeOffInterest + r.writeOffInterest,
                principalWaiver: acc.principalWaiver + (r.principalWaiver ?? 0),
                interestWaiver: acc.interestWaiver + (r.interestWaiver ?? 0),
                penaltyAmount: acc.penaltyAmount + (r.penaltyAmount ?? 0),
                penaltyPaid: acc.penaltyPaid + (r.penaltyPaid ?? 0),
            }),
            { osPrincipalBeforeClose: 0, osInterestBeforeClose: 0, closeLoanWaiverInterest: 0, loanAmount: 0, amountOutstanding: 0, interest: 0, writeOffPrincipal: 0, writeOffInterest: 0, principalWaiver: 0, interestWaiver: 0, penaltyAmount: 0, penaltyPaid: 0 }
        );

        exportRows.push({
            'S.No': 0,
            'Region Name': 'GRAND TOTAL',
            'Division Name': '', 'Area Name': '', 'Branch ID': '', 'Branch Name': '',
            'Center ID': '', 'Center Name': '', 'FDO Name': '', 'Loan ID': '', 'Loan Type': '',
            'Member ID': '', 'Member Name': '', 'Reason': '', 'Funding Name': '',
            'Loan Disbursement Date': '', '1st EMI Date': '', 'Loan Maturity Date': '',
            'PreClose Date': '', 'Close Date': '', 'Last EMI Date': '', 'Total Tenure': 0,
            'OS Principal Before Close': truncateReportAmount(allTotals.osPrincipalBeforeClose),
            'OS Interest Before Close': truncateReportAmount(allTotals.osInterestBeforeClose),
            'Close Loan Waiver Interest': truncateReportAmount(allTotals.closeLoanWaiverInterest),
            'Loan Amount': truncateReportAmount(allTotals.loanAmount),
            'Amount Outstanding': truncateReportAmount(allTotals.amountOutstanding),
            'Interest': truncateReportAmount(allTotals.interest),
            'WriteOff Principal': truncateReportAmount(allTotals.writeOffPrincipal),
            'WriteOff Interest': truncateReportAmount(allTotals.writeOffInterest),
            'Principal Waiver': truncateReportAmount(allTotals.principalWaiver),
            'Interest Waiver': truncateReportAmount(allTotals.interestWaiver),
            'Penalty Amount': truncateReportAmount(allTotals.penaltyAmount),
            'Penalty Paid': truncateReportAmount(allTotals.penaltyPaid),
            'Interest %': 0, 'Next Inst No': '', 'Is Dead': '', 'Deceased Person Type': '', 'Deceased Person Name': '', 'Death Certificate': '', 'HO Approval Document': '',
        });

        const ws = buildReportSheet('Closed Loan Report', exportRows);
        ws['!cols'] = [
            { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
            { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 18 },
            { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
            { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 14 },
            { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 },
            { wch: 13 }, { wch: 8 }, { wch: 16 }, { wch: 16 },
            { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
            { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
            { wch: 10 }, { wch: 10 },
            { wch: 8 }, { wch: 16 }, { wch: 20 }, { wch: 28 },
        ];
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Closed Loan Report');
        XLSX.writeFile(wb, `Closed_Loan_Report_${submittedFromDate}_${submittedTillDate}.xlsx`);
        toast({ title: 'Excel Exported', description: `${allData.length} records downloaded.` });
    };

    // ── PDF export ─────────────────────────────────────────────────────────────

    const handleExportPDF = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;

        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(pdf);
        await drawClosedLoanReport(
            pdf,
            allData,
            { subtitle: `Date Range: ${submittedFromDate} to ${submittedTillDate}  |  Total Loans: ${allData.length}` },
            reportFont
        );

        pdf.save(`Closed_Loan_Report_${submittedFromDate}_${submittedTillDate}.pdf`);
        toast({ title: 'PDF Exported', description: `${allData.length} records downloaded.` });
    };

    // ── CSV / Word export (mirrors the same field mapping used by handleExportExcel
    // above, kept separate so handleExportExcel is left untouched) ────────────────

    const buildClosedLoanExportRows = (allData: ClosedLoanRow[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'S.No', 'Region Name', 'Division Name', 'Area Name', 'Branch ID', 'Branch Name',
            'Center ID', 'Center Name', 'FDO Name', 'Loan ID', 'Loan Type', 'Member ID', 'Member Name',
            'Reason', 'Funding Name', 'Loan Disbursement Date', '1st EMI Date', 'Loan Maturity Date',
            'PreClose Date', 'Close Date', 'Last EMI Date', 'Total Tenure',
            'OS Principal Before Close', 'OS Interest Before Close', 'Close Loan Waiver Interest',
            'Loan Amount', 'Amount Outstanding', 'Interest', 'WriteOff Principal', 'WriteOff Interest',
            'Principal Waiver', 'Interest Waiver', 'Penalty Amount', 'Penalty Paid', 'Interest %',
            'Next Inst No', 'Is Dead', 'Deceased Person Type', 'Deceased Person Name',
            'Death Certificate', 'HO Approval Document',
        ];
        const rows: (string | number)[][] = allData.map((r, i) => [
            i + 1, r.regionName, r.divisionName, r.areaName, r.branchId, r.branchName,
            r.centerId, r.centerName, r.fdoName, r.loanId, r.loanType, r.memberId, r.memberName,
            r.reason, r.fundingName, fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
            fmt(r.preCloseDate), fmt(r.closeDate), fmt(r.lastEmiDate), r.totalTenure,
            truncateReportAmount(r.osPrincipalBeforeClose), truncateReportAmount(r.osInterestBeforeClose), truncateReportAmount(r.closeLoanWaiverInterest),
            truncateReportAmount(r.loanAmount), truncateReportAmount(r.amountOutstanding), truncateReportAmount(r.interest), truncateReportAmount(r.writeOffPrincipal), truncateReportAmount(r.writeOffInterest),
            truncateReportAmount(r.principalWaiver ?? 0), truncateReportAmount(r.interestWaiver ?? 0), truncateReportAmount(r.penaltyAmount ?? 0), truncateReportAmount(r.penaltyPaid ?? 0), r.interestPercent,
            r.nextInstNo ?? '', r.isDead ? 'Yes' : 'No', r.deceasedPersonType ?? '', r.deceasedPersonName ?? '',
            r.deathCertificateName ?? '—', r.approvalDocumentName ?? '—',
        ]);
        return { headers, rows };
    };

    const handleExportCSV = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const { headers, rows } = buildClosedLoanExportRows(allData);
        exportToCSV(`Closed_Loan_Report_${submittedFromDate}_${submittedTillDate}`, 'CLOSED LOAN REPORT', headers, rows);
        toast({ title: 'CSV Exported', description: `${allData.length} records downloaded.` });
    };

    // Word-only presentation: same rows as CSV above. No totals row exists in this report
    // today. At 41 columns (wider than Demand Sheet's 33) this genuinely benefits from
    // grouped headers and A3 landscape — grouping only genuinely related clusters
    // (location, branch/center ID+Name pairs, date triads, before/after-close balances,
    // writeoff/waiver/penalty pairs, death-record fields).
    const buildClosedLoanWordOptions = (): WordExportOptions => ({
        groupHeaders: [
            { label: 'S.No', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
            { label: 'FDO Name', span: 1 }, { label: 'LOAN INFO', span: 2 }, { label: 'MEMBER INFO', span: 2 },
            { label: 'Reason', span: 1 }, { label: 'Funding Name', span: 1 }, { label: 'LOAN DATES', span: 3 },
            { label: 'CLOSURE DATES', span: 3 }, { label: 'Total Tenure', span: 1 }, { label: 'BEFORE CLOSE', span: 3 },
            { label: 'LOAN AMOUNT', span: 3 }, { label: 'WRITEOFF', span: 2 }, { label: 'WAIVER', span: 2 },
            { label: 'PENALTY', span: 2 }, { label: 'Interest %', span: 1 }, { label: 'Next Inst No', span: 1 },
            { label: 'DEATH INFO', span: 3 }, { label: 'Death Certificate', span: 1 }, { label: 'HO Approval Document', span: 1 },
        ],
        subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Center ID', 'Center Name', 'Loan ID', 'Loan Type', 'Member ID', 'Member Name', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'PreClose', 'Close', 'Last EMI', 'OS Principal', 'OS Interest', 'Waiver Interest', 'Loan Amount', 'Outstanding', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Amount', 'Paid', 'Is Dead', 'Deceased Type', 'Deceased Name'],
        columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'center', 'left', 'left', 'left', 'left'],
        columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 9, 7, 9, 7, 12, 10, 9, 7, 7, 7, 7, 7, 7, 6, 7, 7, 7, 7, 7, 6, 7, 7, 7, 7, 7, 7, 6, 6, 6, 9, 9, 10, 10],
        pageSize: { widthMm: 297, heightMm: 420 },
    });

    const handleExportWord = async () => {
        const allData = await fetchAllForExport();
        if (!allData || allData.length === 0) return;
        const { headers, rows } = buildClosedLoanExportRows(allData);
        await exportToWord(`Closed_Loan_Report_${submittedFromDate}_${submittedTillDate}`, 'CLOSED LOAN REPORT', headers, rows, buildClosedLoanWordOptions());
        toast({ title: 'Word Exported', description: `${allData.length} records downloaded.` });
    };

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20">
                    <BookOpen className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-primary">
                        Closed Loan Report
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        All closed, preclosed, and written-off loans with financial details
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-brand-green-darker border border-primary/20 rounded-xl p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-sidebar-accent dark:text-primary uppercase tracking-wide">
                    Filters
                </h2>

                {/* Row 1: Date range */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">
                            From Date <span className="text-red-500">*</span>
                        </Label>
                        <DateInput
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="h-9 border-primary/30 focus:border-primary"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">
                            Till Date <span className="text-red-500">*</span>
                        </Label>
                        <DateInput
                            value={tillDate}
                            onChange={(e) => setTillDate(e.target.value)}
                            className="h-9 border-primary/30 focus:border-primary"
                        />
                    </div>
                </div>

                {/* Row 2: Region → Division → Area */}
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

                {/* Row 3: Branch → Center */}
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

                {/* Row 4: Product Type → Loan Product + Funding */}
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

                {/* Row 5: Closure Type */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-sidebar-accent">Closure Type</Label>
                        <Select
                            value={selectedClosureType}
                            onValueChange={setSelectedClosureType}
                        >
                            <SelectTrigger className="h-9 border-primary/30 focus:border-primary">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="CLOSED">Closed</SelectItem>
                                <SelectItem value="PRECLOSED">Preclosed</SelectItem>
                                <SelectItem value="WRITTEN_OFF">Written Off</SelectItem>
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
                                canExport={canExportReport('closed-loan-report')}
                                onExportWord={!isLoading && !isExporting ? handleExportWord : undefined}
                                reportSlug={!isLoading && !isExporting && getReportExportMode('closed-loan-report') === 'REQUEST_QUEUE' ? 'closed-loan-report' : undefined}
                                exportParams={{
                                    fromDate: submittedFromDate,
                                    toDate: submittedTillDate,
                                    branchIds: selectedBranch ? [selectedBranch] : 'ALL',
                                    filters: {
                                        ...(selectedRegion ? { regionId: selectedRegion } : {}),
                                        ...(selectedDivision ? { divisionId: selectedDivision } : {}),
                                        ...(selectedArea ? { areaId: selectedArea } : {}),
                                        ...(selectedCenter ? { centerId: selectedCenter } : {}),
                                        ...(selectedProductType ? { productTypeId: selectedProductType } : {}),
                                        ...(selectedLoanProduct ? { loanProductId: selectedLoanProduct } : {}),
                                        ...(selectedFunder ? { funderId: selectedFunder } : {}),
                                        ...(selectedClosureType !== 'all' ? { closureType: selectedClosureType } : {}),
                                    },
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
                            Showing page{' '}
                            <span className="font-semibold text-sidebar-accent">{currentPage}</span> of{' '}
                            <span className="font-semibold text-sidebar-accent">{totalPages}</span> —{' '}
                            {totalRecords} total loan(s)
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
                                        'FDO Name', 'Loan ID', 'Loan Type',
                                        'Member ID', 'Member Name', 'Reason', 'Funding',
                                        'Disb. Date', '1st EMI', 'Maturity',
                                        'PreClose Date', 'Close Date', 'Last EMI',
                                        'Tenure', 'OS Principal', 'OS Interest', 'Waiver Interest',
                                        'Loan Amount', 'Amt Outstanding', 'Interest',
                                        'WO Principal', 'WO Interest',
                                        'Pri. Waiver', 'Int. Waiver', 'Penalty', 'Penalty Paid',
                                        'Rate %', 'Next Inst', 'Dead', 'Dcsd. Type', 'Dcsd. Name', 'Death Certificate', 'HO Approval Document',
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
                                        key={`${r.loanId}-${r.sNo}`}
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
                                        <td className="px-2 py-1.5 font-mono">{r.loanId}</td>
                                        <td className="px-2 py-1.5">
                                            <Badge
                                                className={`text-[10px] px-1.5 py-0 ${
                                                    r.loanType === 'Written Off'
                                                        ? 'bg-red-100 text-red-700 border-red-200'
                                                        : r.loanType === 'Dead'
                                                        ? 'bg-rose-100 text-rose-700 border-rose-200'
                                                        : r.loanType === 'Others'
                                                        ? 'bg-orange-100 text-orange-700 border-orange-200'
                                                        : r.loanType === 'Preclosed'
                                                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                                                        : 'bg-green-100 text-green-700 border-green-200'
                                                }`}
                                                variant="outline"
                                            >
                                                {r.loanType}
                                            </Badge>
                                        </td>
                                        <td className="px-2 py-1.5 font-mono">{r.memberId}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.memberName}</td>
                                        <td className="px-2 py-1.5 max-w-[120px] truncate" title={r.reason}>{r.reason || '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.fundingName || '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.loanDisbursementDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.firstEmiDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.loanMaturityDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.preCloseDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.closeDate)}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.lastEmiDate)}</td>
                                        <td className="px-2 py-1.5 text-center">{r.totalTenure}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.osPrincipalBeforeClose)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.osInterestBeforeClose)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.closeLoanWaiverInterest)}</td>
                                        <td className="px-2 py-1.5 text-right font-medium">{fmtAmt(r.loanAmount)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.amountOutstanding)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.interest)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.writeOffPrincipal)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.writeOffInterest)}</td>
                                        <td className="px-2 py-1.5 text-right text-red-600">{fmtAmt(r.principalWaiver ?? 0)}</td>
                                        <td className="px-2 py-1.5 text-right text-red-600">{fmtAmt(r.interestWaiver ?? 0)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.penaltyAmount ?? 0)}</td>
                                        <td className="px-2 py-1.5 text-right">{fmtAmt(r.penaltyPaid ?? 0)}</td>
                                        <td className="px-2 py-1.5 text-center">{r.interestPercent}%</td>
                                        <td className="px-2 py-1.5 text-center">{r.nextInstNo ?? '—'}</td>
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
                                        <td className="px-2 py-1.5 whitespace-nowrap text-xs">{r.deceasedPersonType ?? '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">{r.deceasedPersonName ?? '—'}</td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                            {r.deathCertificateUrl && r.deathCertificateName ? (
                                                <StorageLink
                                                    href={r.deathCertificateUrl}
                                                    className="text-blue-600 underline hover:text-blue-800 text-xs"
                                                    title={r.deathCertificateName}
                                                >
                                                    {r.deathCertificateName}
                                                </StorageLink>
                                            ) : '—'}
                                        </td>
                                        <td className="px-2 py-1.5 whitespace-nowrap">
                                            {r.approvalDocumentName && r.approvalDocumentUrl ? (
                                                <StorageLink
                                                    href={r.approvalDocumentUrl}
                                                    className="text-blue-600 underline hover:text-blue-800 text-xs"
                                                    title={r.approvalDocumentName}
                                                >
                                                    {r.approvalDocumentName}
                                                </StorageLink>
                                            ) : '—'}
                                        </td>
                                    </tr>
                                ))}

                                {/* Page totals row */}
                                {reportData.length > 0 && (
                                    <tr className="bg-brand-green-tint dark:bg-sidebar-accent/40 font-bold border-t-2 border-primary/30">
                                        <td colSpan={22} className="px-2 py-2 text-right text-foreground dark:text-primary">
                                            Page Total
                                        </td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.osPrincipalBeforeClose)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.osInterestBeforeClose)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.closeLoanWaiverInterest)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.loanAmount)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.amountOutstanding)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.interest)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.writeOffPrincipal)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.writeOffInterest)}</td>
                                        <td className="px-2 py-2 text-right text-red-600">{fmtAmt(totals.principalWaiver)}</td>
                                        <td className="px-2 py-2 text-right text-red-600">{fmtAmt(totals.interestWaiver)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.penaltyAmount)}</td>
                                        <td className="px-2 py-2 text-right">{fmtAmt(totals.penaltyPaid)}</td>
                                        <td colSpan={6} />
                                    </tr>
                                )}
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
