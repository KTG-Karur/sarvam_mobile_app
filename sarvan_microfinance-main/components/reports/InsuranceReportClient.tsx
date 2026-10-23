'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageLoader } from '@/components/ui/page-loader';
import {
    Plus,
    Search,
    FileText,
    Shield,
    RefreshCw,
    Eye,
    Pencil,
    Trash2,
    Upload,
    X,
    Loader2,
    User,
    IndianRupee,
    AlertCircle,
    CheckCircle2,
    Clock,
    Landmark,
    Stethoscope,
    CreditCard,
    UserCheck,
    ShieldAlert,
    Download,
    FileBarChart,
    FileType,
    FileOutput,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { apiClient } from '@/app/lib/api-client';
import { usePermission } from '@/app/hooks/usePermission';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawInsuranceReportPdf } from '@/app/lib/reports/insurance-report-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// ─── Types ───
interface Branch {
    id: string;
    name: string;
    code: string;
}

interface LoanOption {
    id: string;
    loanNumber: string;
    amount: number;
    tenureMonths: number;
    disbursedByBMAt: string | null;
    branchId: string;
    branch: { id: string; name: string; code: string };
    client: {
        id: string;
        clientId: string;
        firstName: string;
        lastName: string;
        gender: string | null;
        permanentAddress: string | null;
        district: string | null;
        state: string | null;
        pincode: string | null;
        country: string | null;
        nomineeName: string | null;
        nomineeRelation: string | null;
        nomineeGender: string | null;
        nomineeDateOfBirth: string | null;
        nomineeAge: number | null;
    };
}

interface InsuranceRecord {
    id: string;
    clientId: string;
    branchId: string;
    loanId: string | null;

    masterCode: string;
    agentCode: string;
    source: string;
    cafosCode: string;
    fscFsmCode: string;

    policyNumber: string;
    policyType: string;

    coverageAmount: number;
    premiumAmount: number;
    premiumFrequency: string;

    coverType: string;
    coverBasis: string;

    startDate: string;
    endDate: string;

    nomineeName: string | null;
    nomineeRelationship: string | null;
    nomineeAge: number | null;

    hasMedicalConditions: boolean;
    consentSplitPayment: boolean;
    consentCoverContinuation: boolean;

    utrnNumber: string | null;
    fundTransferDate: string | null;

    appointeeName: string | null;
    appointeeSurname: string | null;
    appointeeGender: string | null;
    appointeeDob: string | null;
    appointeeRelationWithNominee: string | null;

    covidTestedOrIsolated: boolean;
    covidAdvisedIsolationOrSymptoms: boolean;
    covidTravelOverseas: boolean;

    adbSumAssured: number | null;
    acceleratedTiBenefit: number | null;

    documentUrl: string | null;
    documentName: string | null;
    status: string;
    computedStatus: string;
    claimDate: string | null;
    claimAmount: number | null;
    remarks: string | null;
    createdAt: string;

    client: {
        id: string;
        clientId: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        mobileNumber: string | null;
        gender: string | null;
        dateOfBirth: string | null;
        permanentAddress: string | null;
        district: string | null;
        state: string | null;
        pincode: string | null;
        country: string | null;
        occupation: string | null;
        nomineeGender: string | null;
        nomineeDateOfBirth: string | null;
        center: { name: string; code: string };
        /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
        hasLoan?: boolean;
    };
    branch: { id: string; name: string; code: string };
    loan: {
        id: string;
        loanNumber: string;
        amount: number;
        tenureMonths: number;
        disbursedByBMAt: string | null;
        disbursementStatus: string;
        frequency: string | null;
    } | null;
    createdBy: { firstName: string; lastName: string };

    // Server-derived report columns
    salutation: string;
    address1: string;
    address2: string;
    address3: string;
    address4: string;
    city: string;
    nomineeFirstName: string;
    nomineeSurname: string;
    loanNumber: string;
    loanAmount: number | null;
    sumAssured: number;
    ldDate: string | null;
    installmentsPerMonth: number | null;
    occupation: string;
    mobileNumber: string;
    coApplicantFirstName: string;
    coApplicantLastName: string;
    coApplicantDob: string | null;
    coApplicantGender: string;
    coApplicantRelation: string;
    coApplicantHouseFlat: string;
    coApplicantStreet: string;
    coApplicantArea: string;
    coApplicantCity: string;
    coApplicantState: string;
    coApplicantZip: string;
}

const POLICY_TYPES = [
    { value: 'CREDIT_LIFE', label: 'Credit Life Insurance' },
    { value: 'HEALTH', label: 'Health Insurance' },
    { value: 'PERSONAL_ACCIDENT', label: 'Personal Accident' },
    { value: 'GROUP', label: 'Group Insurance' },
];

const PREMIUM_FREQUENCIES = [
    { value: 'ONE_TIME', label: 'One Time' },
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'ANNUAL', label: 'Annual' },
];

const COVER_TYPE_OPTIONS = [
    { value: 'SINGLE_LIFE', label: 'Single Life' },
    { value: 'JOINT_LIFE', label: 'Joint Life' },
];

const COVER_BASIS_OPTIONS = [
    { value: 'LEVEL', label: 'Level' },
    { value: 'REDUCING', label: 'Reducing' },
];

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];

const RELATIONSHIP_OPTIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'];

const STATUS_OPTIONS = [
    { value: 'ALL', label: 'All Status' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'EXPIRED', label: 'Expired' },
    { value: 'CANCELLED', label: 'Cancelled' },
    { value: 'CLAIMED', label: 'Claimed' },
];

const STATUS_BADGES: Record<string, { bg: string; text: string; icon: any }> = {
    ACTIVE: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
    EXPIRED: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', icon: Clock },
    CANCELLED: { bg: 'bg-brand-green-tint dark:bg-sidebar-accent', text: 'text-sidebar-accent dark:text-slate-400', icon: X },
    CLAIMED: { bg: 'bg-brand-green-tint dark:bg-brand-green-darker/30', text: 'text-sidebar-accent dark:text-primary', icon: Shield },
};

const DEFAULT_FORM = {
    loanId: '',
    masterCode: 'SCT00JLG',
    agentCode: '1513471',
    source: 'SARM',
    cafosCode: '5071186',
    fscFsmCode: '8433',
    coverType: 'JOINT_LIFE',
    coverBasis: 'LEVEL',
    premiumAmount: '',
    hasMedicalConditions: false,
    consentSplitPayment: true,
    utrnNumber: '',
    fundTransferDate: '',
    appointeeName: '',
    appointeeSurname: '',
    appointeeGender: '',
    appointeeDob: '',
    appointeeRelationWithNominee: '',
    consentCoverContinuation: true,
    covidTestedOrIsolated: false,
    covidAdvisedIsolationOrSymptoms: false,
    covidTravelOverseas: false,
    adbSumAssured: '',
    acceleratedTiBenefit: '',
    remarks: '',
    // Edit-only fields
    policyType: 'CREDIT_LIFE',
    premiumFrequency: 'ONE_TIME',
    coverageAmount: '',
    startDate: '',
    endDate: '',
};

// ─── Helpers ───
const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.trunc(amount));

const formatDate = (dateStr: string) =>
    toDisplayDate(new Date(dateStr));

const toDateInputValue = (dateStr: string | null) => (dateStr ? new Date(dateStr).toISOString().split('T')[0] : '');

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

// ─── Report table column config ───
// Flat, ungrouped, in the exact required order (64 columns). Two pairs are
// intentionally duplicated per the source spec (installments/month at #24 & #28,
// occupation at #38 & #60) — both instances of each pair render the same field.
interface ColumnDef {
    key: string;
    label: string;
    align?: 'left' | 'right' | 'center';
    render: (r: InsuranceRecord) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
    { key: 'masterCode', label: 'Master Code', render: (r) => r.masterCode },
    { key: 'agentCode', label: 'Agent code', render: (r) => r.agentCode },
    { key: 'source', label: 'Source', render: (r) => r.source },
    { key: 'cafosCode', label: 'CAFOS Code', render: (r) => r.cafosCode },
    { key: 'fscFsmCode', label: 'FSC/FSM code', render: (r) => r.fscFsmCode },
    { key: 'branchId', label: 'Branch ID', render: (r) => r.branch?.code || '' },
    { key: 'branchName', label: 'Branch Name', render: (r) => r.branch?.name || '' },
    { key: 'memberId', label: 'Member Id', render: (r) => r.client.clientId },
    { key: 'loanId', label: 'Loan ID', render: (r) => r.loanNumber },
    { key: 'memberName', label: 'Member Name', render: (r) => r.client.firstName },
    { key: 'lastName', label: 'Last Name', render: (r) => r.client.lastName },
    { key: 'dob', label: 'DOB', render: (r) => (r.client.dateOfBirth ? formatDate(r.client.dateOfBirth) : '') },
    { key: 'salutation', label: 'Salutation', render: (r) => r.salutation },
    { key: 'gender', label: 'Gender', render: (r) => r.client.gender || '' },
    { key: 'address1', label: 'Address 1', render: (r) => r.address1 },
    { key: 'address2', label: 'Address 2', render: (r) => r.address2 },
    { key: 'address3', label: 'Address 3', render: (r) => r.address3 },
    { key: 'address4', label: 'Address 4', render: (r) => r.address4 },
    { key: 'city', label: 'City', render: (r) => r.city },
    { key: 'state', label: 'State', render: (r) => r.client.state || '' },
    { key: 'country', label: 'Country', render: (r) => r.client.country || '' },
    { key: 'pincode', label: 'Pincode', render: (r) => r.client.pincode || '' },
    { key: 'loanAmount', label: 'Loan Amount', align: 'right', render: (r) => (r.loanAmount != null ? formatCurrency(r.loanAmount) : '') },
    { key: 'installmentsPerMonth1', label: 'Number Of Installments Per Month', align: 'right', render: (r) => (r.installmentsPerMonth ?? '') },
    { key: 'sumAssured', label: 'Sum Assured', align: 'right', render: (r) => formatCurrency(r.sumAssured) },
    { key: 'ldDate', label: 'LD Date', render: (r) => (r.ldDate ? formatDate(r.ldDate) : '') },
    { key: 'coverType', label: 'Type of Cover (Single Life / Joint Life)', render: (r) => COVER_TYPE_OPTIONS.find((c) => c.value === r.coverType)?.label || r.coverType },
    { key: 'installmentsPerMonth2', label: 'Number Of Installments Per Month', align: 'right', render: (r) => (r.installmentsPerMonth ?? '') },
    { key: 'premiumAmount', label: 'Premium Amount', align: 'right', render: (r) => formatCurrency(r.premiumAmount) },
    { key: 'adbSumAssured', label: 'ADB SA', align: 'right', render: (r) => (r.adbSumAssured != null ? formatCurrency(r.adbSumAssured) : '') },
    { key: 'acceleratedTiBenefit', label: 'Accelerated TI Benefit', align: 'right', render: (r) => (r.acceleratedTiBenefit != null ? formatCurrency(r.acceleratedTiBenefit) : '') },
    { key: 'coverBasis', label: 'Type of cover (Level / Reducing)', render: (r) => COVER_BASIS_OPTIONS.find((c) => c.value === r.coverBasis)?.label || r.coverBasis },
    { key: 'nomineeFirstName', label: 'Nominee First Name', render: (r) => r.nomineeFirstName },
    { key: 'nomineeSurname', label: 'Nominee SurName', render: (r) => r.nomineeSurname },
    { key: 'nomineeGender', label: 'Nominee Gender', render: (r) => r.client.nomineeGender || '' },
    { key: 'nomineeDob', label: 'Nominee DOB', render: (r) => (r.client.nomineeDateOfBirth ? formatDate(r.client.nomineeDateOfBirth) : '') },
    { key: 'nomineeRelationship', label: 'Nominee Relationship with LA', render: (r) => r.nomineeRelationship || '' },
    { key: 'occupation1', label: 'Occupation', render: (r) => r.occupation },
    { key: 'hasMedicalConditions', label: 'Medical Questions YES/No', render: (r) => yesNo(r.hasMedicalConditions) },
    { key: 'consentSplitPayment', label: 'Member Consent to Split Payment', render: (r) => yesNo(r.consentSplitPayment) },
    { key: 'coApplicantFirstName', label: 'Spouse/CoApplicant First Name', render: (r) => r.coApplicantFirstName },
    { key: 'coApplicantLastName', label: 'Spouse/CoApplicant Last Name', render: (r) => r.coApplicantLastName },
    { key: 'coApplicantDob', label: 'Spouse/CoApplicant DOB', render: (r) => (r.coApplicantDob ? formatDate(r.coApplicantDob) : '') },
    { key: 'coApplicantGender', label: 'Spouse/CoApplicant Gender', render: (r) => r.coApplicantGender },
    { key: 'coApplicantRelation', label: 'Spouse/CoApplicant Relationship with LA', render: (r) => r.coApplicantRelation },
    { key: 'coApplicantHouseFlat', label: 'CoApplicant Hse/Flat', render: (r) => r.coApplicantHouseFlat },
    { key: 'coApplicantStreet', label: 'CoApplicant Street', render: (r) => r.coApplicantStreet },
    { key: 'coApplicantArea', label: 'CoApplicant Area', render: (r) => r.coApplicantArea },
    { key: 'coApplicantCity', label: 'CoApplicant City', render: (r) => r.coApplicantCity },
    { key: 'coApplicantState', label: 'CoApplicant State', render: (r) => r.coApplicantState },
    { key: 'coApplicantZip', label: 'CoApplicant ZIPCODE', render: (r) => r.coApplicantZip },
    { key: 'utrnNumber', label: 'UTRN No.', render: (r) => r.utrnNumber || '' },
    { key: 'fundTransferDate', label: 'Fund Transfer Date', render: (r) => (r.fundTransferDate ? formatDate(r.fundTransferDate) : '') },
    { key: 'appointeeName', label: 'Appointee Name', render: (r) => r.appointeeName || '' },
    { key: 'appointeeSurname', label: 'Appointee SurName', render: (r) => r.appointeeSurname || '' },
    { key: 'appointeeGender', label: 'Appointee Gender', render: (r) => r.appointeeGender || '' },
    { key: 'appointeeDob', label: 'Appointee DOB', render: (r) => (r.appointeeDob ? formatDate(r.appointeeDob) : '') },
    { key: 'appointeeRelationWithNominee', label: 'Appointee Relationship with Nominee', render: (r) => r.appointeeRelationWithNominee || '' },
    { key: 'consentCoverContinuation', label: 'Member Consent to Cover Continuation', render: (r) => yesNo(r.consentCoverContinuation) },
    { key: 'occupation2', label: 'Occupation', render: (r) => r.occupation },
    { key: 'mobileNumber', label: 'Mobile No', render: (r) => r.mobileNumber },
    { key: 'covidQ1', label: 'COVID-19 tested/self-isolated (3mo)', render: (r) => yesNo(r.covidTestedOrIsolated) },
    { key: 'covidQ2', label: 'COVID-19 advised isolation/symptoms (1mo)', render: (r) => yesNo(r.covidAdvisedIsolationOrSymptoms) },
    { key: 'covidQ3', label: 'Overseas travel post 1 Jan 2020 / next 6mo', render: (r) => yesNo(r.covidTravelOverseas) },
];

// ─── Component ───
export function InsuranceReportClient() {
    const { toast } = useToast();
    const { hasRole, canExportReport, getReportExportMode } = usePermission();
    const isAdmin = hasRole('admin');
    const isAreaManager = hasRole('area-manager');
    const canFilterByBranch = isAdmin || isAreaManager;
    const [records, setRecords] = useState<InsuranceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState('ALL');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [stats, setStats] = useState({ total: 0, active: 0, expired: 0, totalCoverage: 0 });
    const PAGE_SIZE = 25;

    // Debounce search input before it triggers a server fetch (was firing on every keystroke).
    useEffect(() => {
        const timeout = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
        return () => clearTimeout(timeout);
    }, [searchQuery]);

    // Dialog states
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showUploadDialog, setShowUploadDialog] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState<InsuranceRecord | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Loan search (Add modal)
    const [loanSearch, setLoanSearch] = useState('');
    const [loanOptions, setLoanOptions] = useState<LoanOption[]>([]);
    const [isSearchingLoans, setIsSearchingLoans] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState<LoanOption | null>(null);

    // Form state
    const [form, setForm] = useState({ ...DEFAULT_FORM });

    // Upload state
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    // ─── Data Fetching ───
    type InsurancePageResponse = {
        data: InsuranceRecord[];
        totalCount: number;
        totalPages: number;
        page: number;
        pageSize: number;
        stats: { total: number; active: number; expired: number; totalCoverage: number };
    };

    const buildParams = (pageArg: number, pageSize: number) => {
        const params = new URLSearchParams({ page: String(pageArg), pageSize: String(pageSize) });
        if (statusFilter !== 'ALL') params.set('status', statusFilter);
        if (debouncedSearchQuery) params.set('search', debouncedSearchQuery);
        if (canFilterByBranch && branchFilter !== 'ALL') params.set('branchId', branchFilter);
        return params;
    };

    const fetchPage = useCallback(async (pageArg: number) => {
        setIsLoading(true);
        try {
            const params = buildParams(pageArg, PAGE_SIZE);
            const result = await apiClient.get<InsurancePageResponse>(`/reports/others/insurance-report?${params}`);
            if (result.success && result.data) {
                setRecords(result.data.data);
                setTotalCount(result.data.totalCount);
                setTotalPages(result.data.totalPages);
                setPage(result.data.page);
                setStats(result.data.stats);
            }
        } catch (error) {
            console.error('Error fetching insurance records:', error);
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, debouncedSearchQuery, branchFilter, canFilterByBranch]);

    const fetchRecords = useCallback(() => fetchPage(1), [fetchPage]);

    useEffect(() => {
        fetchPage(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, debouncedSearchQuery, branchFilter, canFilterByBranch]);

    const handlePageChange = (p: number) => {
        fetchPage(p);
    };

    // Fetches every row matching the current filters (not just the on-screen page) —
    // used only by the export handlers below, so exports keep capturing the full
    // report instead of whatever happens to be on screen.
    // The backend clamps pageSize to 5000 regardless of what's requested here, so a single
    // request can silently truncate large filtered result sets — loop pages instead of
    // trusting one request to return everything.
    const fetchAllForExport = async (): Promise<InsuranceRecord[] | null> => {
        try {
            const first = await apiClient.get<InsurancePageResponse>(`/reports/others/insurance-report?${buildParams(1, 5000)}`);
            if (!first.success || !first.data) return null;
            const rows = [...first.data.data];
            for (let page = 2; page <= first.data.totalPages; page++) {
                const next = await apiClient.get<InsurancePageResponse>(`/reports/others/insurance-report?${buildParams(page, 5000)}`);
                if (next.success && next.data) rows.push(...next.data.data);
            }
            return rows;
        } catch (error) {
            console.error('Error fetching full insurance report for export:', error);
            return null;
        }
    };

    // Branch list for the Admin/Area Manager branch filter — AM sees only their
    // assigned branches, matching TransactionBranchFilter's convention.
    useEffect(() => {
        if (!canFilterByBranch) return;
        apiClient.get<Branch[]>('/branches').then((result) => {
            if (!result.success || !result.data) return;
            let list = result.data;
            if (isAreaManager) {
                const assignedBranchIds = (tokenStorage.getUser() as any)?.assignedBranchIds ?? [];
                if (assignedBranchIds.length > 0) {
                    list = list.filter((b) => assignedBranchIds.includes(b.id));
                }
            }
            setBranches(list);
        });
    }, [canFilterByBranch, isAreaManager]);

    // Loan search with debounce
    useEffect(() => {
        if (loanSearch.length < 2) {
            setLoanOptions([]);
            return;
        }

        const timeout = setTimeout(async () => {
            setIsSearchingLoans(true);
            try {
                const result = await apiClient.get<LoanOption[]>(`/reports/others/insurance-report/loan-lookup?search=${encodeURIComponent(loanSearch)}`);
                if (result.success && result.data) {
                    setLoanOptions(result.data);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to search loans.', variant: 'destructive' });
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to search loans.', variant: 'destructive' });
            } finally {
                setIsSearchingLoans(false);
            }
        }, 400);

        return () => clearTimeout(timeout);
    }, [loanSearch]);

    // ─── Form Handlers ───
    const resetForm = () => {
        setForm({ ...DEFAULT_FORM });
        setLoanSearch('');
        setLoanOptions([]);
        setSelectedLoan(null);
    };

    const handleCreate = async () => {
        if (!form.loanId || !form.premiumAmount) {
            toast({ title: 'Validation Error', description: 'Please select a loan and fill all required fields.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                loanId: form.loanId,
                masterCode: form.masterCode,
                agentCode: form.agentCode,
                source: form.source,
                cafosCode: form.cafosCode,
                fscFsmCode: form.fscFsmCode,
                coverType: form.coverType,
                coverBasis: form.coverBasis,
                premiumAmount: parseFloat(form.premiumAmount),
                hasMedicalConditions: form.hasMedicalConditions,
                consentSplitPayment: form.consentSplitPayment,
                utrnNumber: form.utrnNumber || undefined,
                fundTransferDate: form.fundTransferDate || undefined,
                appointeeName: form.appointeeName || undefined,
                appointeeSurname: form.appointeeSurname || undefined,
                appointeeGender: form.appointeeGender || undefined,
                appointeeDob: form.appointeeDob || undefined,
                appointeeRelationWithNominee: form.appointeeRelationWithNominee || undefined,
                consentCoverContinuation: form.consentCoverContinuation,
                covidTestedOrIsolated: form.covidTestedOrIsolated,
                covidAdvisedIsolationOrSymptoms: form.covidAdvisedIsolationOrSymptoms,
                covidTravelOverseas: form.covidTravelOverseas,
                adbSumAssured: form.adbSumAssured ? parseFloat(form.adbSumAssured) : undefined,
                acceleratedTiBenefit: form.acceleratedTiBenefit ? parseFloat(form.acceleratedTiBenefit) : undefined,
                remarks: form.remarks || undefined,
            };

            const result = await apiClient.post<InsuranceRecord>('/reports/others/insurance-report', payload);
            if (result.success && result.data) {
                if (uploadFile) {
                    try {
                        const formData = new FormData();
                        formData.append('file', uploadFile);
                        formData.append('recordId', result.data.id);
                        await apiClient.post('/reports/others/insurance-report/upload', formData);
                    } catch {
                        toast({ title: 'Note', description: 'Record created but PDF upload failed. You can upload it from the table.' });
                    }
                }
                toast({ title: 'Success', description: 'Insurance record created successfully.' });
                setShowAddDialog(false);
                resetForm();
                setUploadFile(null);
                fetchRecords();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to create record.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to create insurance record.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdate = async () => {
        if (!selectedRecord) return;
        setIsSaving(true);
        try {
            const payload = {
                policyType: form.policyType,
                coverageAmount: form.coverageAmount ? parseFloat(form.coverageAmount) : undefined,
                premiumAmount: form.premiumAmount ? parseFloat(form.premiumAmount) : undefined,
                premiumFrequency: form.premiumFrequency,
                startDate: form.startDate || undefined,
                endDate: form.endDate || undefined,
                remarks: form.remarks || null,

                masterCode: form.masterCode,
                agentCode: form.agentCode,
                source: form.source,
                cafosCode: form.cafosCode,
                fscFsmCode: form.fscFsmCode,

                coverType: form.coverType,
                coverBasis: form.coverBasis,

                hasMedicalConditions: form.hasMedicalConditions,
                consentSplitPayment: form.consentSplitPayment,
                consentCoverContinuation: form.consentCoverContinuation,

                utrnNumber: form.utrnNumber || null,
                fundTransferDate: form.fundTransferDate || null,

                appointeeName: form.appointeeName || null,
                appointeeSurname: form.appointeeSurname || null,
                appointeeGender: form.appointeeGender || null,
                appointeeDob: form.appointeeDob || null,
                appointeeRelationWithNominee: form.appointeeRelationWithNominee || null,

                covidTestedOrIsolated: form.covidTestedOrIsolated,
                covidAdvisedIsolationOrSymptoms: form.covidAdvisedIsolationOrSymptoms,
                covidTravelOverseas: form.covidTravelOverseas,

                adbSumAssured: form.adbSumAssured ? parseFloat(form.adbSumAssured) : null,
                acceleratedTiBenefit: form.acceleratedTiBenefit ? parseFloat(form.acceleratedTiBenefit) : null,
            };

            const result = await apiClient.put(`/reports/others/insurance-report/${selectedRecord.id}`, payload);
            if (result.success) {
                toast({ title: 'Success', description: 'Insurance record updated successfully.' });
                setShowEditDialog(false);
                fetchRecords();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to update record.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to update insurance record.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedRecord) return;
        try {
            const result = await apiClient.delete(`/reports/others/insurance-report/${selectedRecord.id}`);
            if (result.success) {
                toast({ title: 'Deleted', description: 'Insurance record deleted successfully.' });
                setShowDeleteConfirm(false);
                setSelectedRecord(null);
                fetchRecords();
            } else {
                toast({ title: 'Error', description: result.error, variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to delete record.', variant: 'destructive' });
        }
    };

    const handleUpload = async () => {
        if (!uploadFile || !selectedRecord) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', uploadFile);
            formData.append('recordId', selectedRecord.id);

            const result = await apiClient.post('/reports/others/insurance-report/upload', formData);
            if (result.success) {
                toast({ title: 'Success', description: 'Document uploaded successfully.' });
                setShowUploadDialog(false);
                setUploadFile(null);
                fetchRecords();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to upload document.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to upload document.', variant: 'destructive' });
        } finally {
            setIsUploading(false);
        }
    };

    // Mirrors the field mapping used by the exports below.
    const buildInsuranceExportRows = (rows: InsuranceRecord[]): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [...COLUMNS.map((c) => c.label), 'Status'];
        const exportRows: (string | number)[][] = rows.map((record) => [
            ...COLUMNS.map((c) => c.render(record) as unknown as string | number),
            record.computedStatus,
        ]);
        return { headers, rows: exportRows };
    };

    const handleExport = async () => {
        if (totalCount === 0) {
            toast({ title: 'No data to export', description: 'There are no insurance records to export.', variant: 'destructive' });
            return;
        }
        const fullRows = await fetchAllForExport();
        if (!fullRows) {
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return;
        }

        try {
            const excelData = fullRows.map((record) => {
                const row: Record<string, string | number> = {};
                COLUMNS.forEach((col) => {
                    row[col.label] = col.render(record) as unknown as string | number;
                });
                row['Status'] = record.computedStatus;
                return row;
            });

            const ws = XLSX.utils.json_to_sheet(excelData);
            autoSizeColumns(ws);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Insurance Report');

            const fileName = `Insurance_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
            normalizeWorkbookNumbers(wb);
            XLSX.writeFile(wb, fileName);

            toast({ title: 'Export successful', description: `Downloaded ${fileName}` });
        } catch (error) {
            console.error('Error exporting insurance records:', error);
            toast({ title: 'Error', description: 'Failed to export insurance records.', variant: 'destructive' });
        }
    };

    const handleExportPDF = async () => {
        if (totalCount === 0) {
            toast({ title: 'No data to export', description: 'There are no insurance records to export.', variant: 'destructive' });
            return;
        }
        const fullRows = await fetchAllForExport();
        if (!fullRows) {
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return;
        }
        try {
            const { headers, rows } = buildInsuranceExportRows(fullRows);
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawInsuranceReportPdf(doc, headers, rows, reportFont);
            const fileName = `Insurance_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`;
            doc.save(fileName);
            toast({ title: 'Export successful', description: `Downloaded ${fileName}` });
        } catch (error) {
            console.error('Error exporting insurance records:', error);
            toast({ title: 'Error', description: 'Failed to export insurance records.', variant: 'destructive' });
        }
    };

    const handleExportCSV = async () => {
        if (totalCount === 0) {
            toast({ title: 'No data to export', description: 'There are no insurance records to export.', variant: 'destructive' });
            return;
        }
        const fullRows = await fetchAllForExport();
        if (!fullRows) {
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildInsuranceExportRows(fullRows);
        exportToCSV(`Insurance_Report_${format(new Date(), 'yyyyMMdd_HHmm')}`, 'INSURANCE REPORT', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above. COLUMNS is explicitly a flat,
    // ungrouped, fixed-order 64-column layout (per the comment above it) matching an
    // external insurer submission spec — including two intentionally duplicated column
    // pairs — so this stays flat rather than introducing grouped headers that would
    // reorganize that required order. Alignment/widths are derived from the same
    // COLUMNS metadata used by the other exports, plus the trailing Status column. At
    // 65 columns (COLUMNS + Status) — the widest report in the app — this needs A3
    // landscape.
    const insuranceWordOptions: WordExportOptions = {
        columnAlignments: [...COLUMNS.map((c) => c.align ?? 'left'), 'center'],
        columnWidthWeights: [...COLUMNS.map((c) => (c.align === 'right' ? 8 : Math.max(7, Math.min(14, c.label.length)))), 8],
        pageSize: { widthMm: 297, heightMm: 420 },
    };

    const handleExportWord = async () => {
        if (totalCount === 0) {
            toast({ title: 'No data to export', description: 'There are no insurance records to export.', variant: 'destructive' });
            return;
        }
        const fullRows = await fetchAllForExport();
        if (!fullRows) {
            toast({ title: 'Export failed', description: 'Could not load the full report for export.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildInsuranceExportRows(fullRows);
        await exportToWord(`Insurance_Report_${format(new Date(), 'yyyyMMdd_HHmm')}`, 'INSURANCE REPORT', headers, rows, insuranceWordOptions);
    };

    const openEditDialog = (record: InsuranceRecord) => {
        setSelectedRecord(record);
        setForm({
            loanId: record.loanId || '',
            masterCode: record.masterCode,
            agentCode: record.agentCode,
            source: record.source,
            cafosCode: record.cafosCode,
            fscFsmCode: record.fscFsmCode,
            coverType: record.coverType,
            coverBasis: record.coverBasis,
            premiumAmount: record.premiumAmount.toString(),
            hasMedicalConditions: record.hasMedicalConditions,
            consentSplitPayment: record.consentSplitPayment,
            utrnNumber: record.utrnNumber || '',
            fundTransferDate: toDateInputValue(record.fundTransferDate),
            appointeeName: record.appointeeName || '',
            appointeeSurname: record.appointeeSurname || '',
            appointeeGender: record.appointeeGender || '',
            appointeeDob: toDateInputValue(record.appointeeDob),
            appointeeRelationWithNominee: record.appointeeRelationWithNominee || '',
            consentCoverContinuation: record.consentCoverContinuation,
            covidTestedOrIsolated: record.covidTestedOrIsolated,
            covidAdvisedIsolationOrSymptoms: record.covidAdvisedIsolationOrSymptoms,
            covidTravelOverseas: record.covidTravelOverseas,
            adbSumAssured: record.adbSumAssured?.toString() || '',
            acceleratedTiBenefit: record.acceleratedTiBenefit?.toString() || '',
            remarks: record.remarks || '',
            policyType: record.policyType,
            premiumFrequency: record.premiumFrequency,
            coverageAmount: record.coverageAmount.toString(),
            startDate: toDateInputValue(record.startDate),
            endDate: toDateInputValue(record.endDate),
        });
        setShowEditDialog(true);
    };

    const nomineePreview = selectedLoan
        ? {
              name: selectedLoan.client.nomineeName || '',
              relation: selectedLoan.client.nomineeRelation || '',
              gender: selectedLoan.client.nomineeGender || '',
              age: selectedLoan.client.nomineeAge,
          }
        : null;

    // ─── Render ───
    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Total Policies', value: stats.total, icon: FileText, color: 'blue' },
                    { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'emerald' },
                    { label: 'Expired', value: stats.expired, icon: AlertCircle, color: 'orange' },
                    { label: 'Active Coverage', value: formatCurrency(stats.totalCoverage), icon: Shield, color: 'indigo' },
                ].map((kpi, idx) => (
                    <Card key={idx} className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 overflow-hidden">
                        <CardContent className="pt-5 pb-4 px-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{kpi.label}</p>
                                    <p className="text-2xl font-bold mt-1 text-foreground dark:text-white">{kpi.value}</p>
                                </div>
                                <div className={`h-11 w-11 rounded-xl flex items-center justify-center bg-${kpi.color}-500/15 text-${kpi.color}-600`}>
                                    <kpi.icon className="h-5 w-5" />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Main Table Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <ReportHeader title="Insurance Report" />
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Shield className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Insurance Records</CardTitle>
                                <CardDescription>Manage client insurance policies and documents</CardDescription>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    placeholder="Search policy, client, loan..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 w-56 h-9 text-sm"
                                />
                            </div>
                            {/* Status Filter */}
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-36 h-9 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_OPTIONS.map((s) => (
                                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {/* Branch Filter (Admin / Area Manager) */}
                            {canFilterByBranch && (
                                <Select value={branchFilter} onValueChange={setBranchFilter}>
                                    <SelectTrigger className="w-40 h-9 text-sm">
                                        <SelectValue placeholder="All Branches" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Branches</SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            <Button variant="outline" size="sm" onClick={() => fetchPage(page)} className="h-9">
                                <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                            <ExportDropdown
                                onExportPDF={!isLoading && totalCount > 0 ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && totalCount > 0 ? handleExport : undefined}
                                onExportCSV={!isLoading && totalCount > 0 ? handleExportCSV : undefined}
                                canExport={canExportReport('insurance-report')}
                                onExportWord={!isLoading && totalCount > 0 ? handleExportWord : undefined}
                                reportSlug={!isLoading && totalCount > 0 && getReportExportMode('insurance-report') === 'REQUEST_QUEUE' ? 'insurance-report' : undefined}
                                exportParams={{
                                    fromDate: null,
                                    toDate: null,
                                    branchIds: canFilterByBranch && branchFilter !== 'ALL' ? [branchFilter] : 'ALL',
                                    filters: {
                                        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
                                        ...(debouncedSearchQuery ? { search: debouncedSearchQuery } : {}),
                                    },
                                }}
                                className="h-9"
                            />
                            <Button size="sm" className="h-9 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white" onClick={() => { resetForm(); setShowAddDialog(true); }}>
                                <Plus className="h-4 w-4 mr-1" />
                                Add Insurance
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <PageLoader fullScreen={false} />
                    ) : records.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                            <Shield className="h-14 w-14 mb-4 text-slate-300" />
                            <p className="text-lg font-medium">No Insurance Records</p>
                            <p className="text-sm mt-1">Click &quot;Add Insurance&quot; to create the first record.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="text-sm border-collapse">
                                <thead>
                                    <tr className="border-b border-primary/20 dark:border-sidebar-accent bg-green-50/50 dark:bg-sidebar-accent/50">
                                        {COLUMNS.map((col) => (
                                            <th
                                                key={col.key}
                                                className={`px-3 py-2 whitespace-nowrap text-xs font-semibold text-sidebar-accent dark:text-slate-300 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                            >
                                                {col.label}
                                            </th>
                                        ))}
                                        <th className="px-3 py-2 text-center text-xs font-semibold text-sidebar-accent dark:text-slate-300 border-l border-primary/10 dark:border-sidebar-accent/50">Status</th>
                                        <th className="px-3 py-2 text-center text-xs font-semibold text-sidebar-accent dark:text-slate-300">Document</th>
                                        <th className="px-3 py-2 text-center text-xs font-semibold text-sidebar-accent dark:text-slate-300">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                                    {records.map((record) => {
                                        const status = record.computedStatus;
                                        const badge = STATUS_BADGES[status] || STATUS_BADGES.ACTIVE;
                                        const BadgeIcon = badge.icon;
                                        return (
                                            <tr key={record.id} className="hover:bg-green-50/50 dark:hover:bg-sidebar-accent/30 transition-colors">
                                                {COLUMNS.map((col) => (
                                                    <td key={col.key} className={`px-3 py-3 whitespace-nowrap text-sidebar-accent dark:text-slate-300 ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                                                        {col.render(record)}
                                                    </td>
                                                ))}
                                                <td className="px-3 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${badge.bg} ${badge.text}`}>
                                                        <BadgeIcon className="h-3 w-3" />
                                                        {status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    {record.documentUrl ? (
                                                        <a href={record.documentUrl} target="_blank" rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-xs text-primary hover:text-sidebar-accent font-medium whitespace-nowrap">
                                                            <Eye className="h-3.5 w-3.5" /> View
                                                        </a>
                                                    ) : (
                                                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-slate-500 hover:text-primary"
                                                            onClick={() => { setSelectedRecord(record); setUploadFile(null); setShowUploadDialog(true); }}>
                                                            <Upload className="h-3.5 w-3.5" /> Upload
                                                        </Button>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500 hover:text-primary" onClick={() => openEditDialog(record)} title="Edit">
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500 hover:text-red-600" onClick={() => { setSelectedRecord(record); setShowDeleteConfirm(true); }} title="Delete">
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
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

            {/* ─── Add / Edit Dialog ─── */}
            <Dialog open={showAddDialog || showEditDialog} onOpenChange={(open) => { if (!open) { setShowAddDialog(false); setShowEditDialog(false); setUploadFile(null); } }}>
                <DialogContent className="w-[95vw] max-w-6xl p-0 gap-0 overflow-hidden">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-primary/20 dark:border-sidebar-accent bg-gradient-to-r from-slate-50 to-green-50/50 dark:from-brand-green-darker dark:to-sidebar-accent/50">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Shield className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <DialogTitle className="text-lg font-bold">{showEditDialog ? 'Edit Insurance Record' : 'Add Insurance Record'}</DialogTitle>
                                <DialogDescription className="text-sm">Fill in the insurance policy details below. Fields marked with * are required.</DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="px-6 py-5 max-h-[70vh] overflow-y-auto space-y-6">

                        {/* ── Loan Selection (Add only) ── */}
                        {showAddDialog && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <User className="h-4 w-4 text-primary" />
                                    <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Loan Selection *</span>
                                </div>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Search disbursed loan by loan number..."
                                        value={loanSearch}
                                        onChange={(e) => setLoanSearch(e.target.value)}
                                        className="pl-9 h-10"
                                        disabled={!!form.loanId}
                                    />
                                </div>
                                {selectedLoan && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-950/30 rounded-lg border border-primary/30 dark:border-sidebar-accent">
                                        <User className="h-4 w-4 text-primary shrink-0" />
                                        <span className="text-sm font-medium text-sidebar-accent dark:text-primary">
                                            {selectedLoan.loanNumber} · {selectedLoan.client.firstName} {selectedLoan.client.lastName} · {selectedLoan.branch.name}
                                        </span>
                                        <span className="text-xs text-slate-500 ml-2">Sum Assured: {formatCurrency(selectedLoan.amount)}</span>
                                        <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={() => { setForm((f) => ({ ...f, loanId: '' })); setSelectedLoan(null); setLoanSearch(''); }}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                )}
                                {isSearchingLoans && <p className="text-xs text-slate-500 animate-pulse">Searching loans...</p>}
                                {loanOptions.length > 0 && !form.loanId && (
                                    <div className="border rounded-lg max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-sidebar-accent shadow-sm">
                                        {loanOptions.map((loan) => (
                                            <button key={loan.id} className="w-full px-3 py-2.5 text-left text-sm hover:bg-green-50 dark:hover:bg-sidebar-accent transition-colors flex items-center gap-2"
                                                onClick={() => {
                                                    setForm((f) => ({ ...f, loanId: loan.id }));
                                                    setSelectedLoan(loan);
                                                    setLoanOptions([]);
                                                }}>
                                                <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                <span className="font-medium">{loan.loanNumber}</span>
                                                <span className="text-xs text-slate-500">{loan.client.firstName} {loan.client.lastName}</span>
                                                <span className="text-xs text-slate-500 ml-auto">{loan.branch.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {nomineePreview && (
                                    <p className="text-xs text-slate-500">
                                        Nominee on file: {nomineePreview.name || '—'} ({nomineePreview.relation || '—'})
                                    </p>
                                )}
                            </div>
                        )}

                        {/* ── Master Details ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Landmark className="h-4 w-4 text-primary" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Master Details</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Master Code</Label>
                                    <Input value={form.masterCode} onChange={(e) => setForm((f) => ({ ...f, masterCode: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Agent Code</Label>
                                    <Input value={form.agentCode} onChange={(e) => setForm((f) => ({ ...f, agentCode: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Source</Label>
                                    <Input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">CAFOS Code</Label>
                                    <Input value={form.cafosCode} onChange={(e) => setForm((f) => ({ ...f, cafosCode: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">FSC / FSM Code</Label>
                                    <Input value={form.fscFsmCode} onChange={(e) => setForm((f) => ({ ...f, fscFsmCode: e.target.value }))} className="h-10" />
                                </div>
                            </div>
                        </div>

                        {/* ── Loan & Cover Details ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <IndianRupee className="h-4 w-4 text-emerald-600" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Loan &amp; Cover Details</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Member Name</Label>
                                    <Input value={showAddDialog ? `${selectedLoan?.client.firstName || ''} ${selectedLoan?.client.lastName || ''}`.trim() : `${selectedRecord?.client.firstName || ''} ${selectedRecord?.client.lastName || ''}`.trim()} disabled className="h-10 bg-slate-50 dark:bg-green-950/30" />
                                </div>
                                {showEditDialog && (
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Coverage Amount / Sum Assured (₹)</Label>
                                        <Input type="number" value={form.coverageAmount} onChange={(e) => setForm((f) => ({ ...f, coverageAmount: e.target.value }))} className="h-10" />
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Type of Cover (Single/Joint Life)</Label>
                                    <Select value={form.coverType} onValueChange={(v) => setForm((f) => ({ ...f, coverType: v }))}>
                                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {COVER_TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Premium Amount (₹) *</Label>
                                    <Input type="number" step="0.01" min="0" value={form.premiumAmount} onChange={(e) => setForm((f) => ({ ...f, premiumAmount: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Type of Cover (Level/Reducing)</Label>
                                    <Select value={form.coverBasis} onValueChange={(v) => setForm((f) => ({ ...f, coverBasis: v }))}>
                                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {COVER_BASIS_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {showEditDialog && (
                                    <>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Policy Type</Label>
                                            <Select value={form.policyType} onValueChange={(v) => setForm((f) => ({ ...f, policyType: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {POLICY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Premium Frequency</Label>
                                            <Select value={form.premiumFrequency} onValueChange={(v) => setForm((f) => ({ ...f, premiumFrequency: v }))}>
                                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {PREMIUM_FREQUENCIES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Start Date</Label>
                                            <DateInput value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="h-10" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">End Date</Label>
                                            <DateInput value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="h-10" />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ── Member Declaration ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Stethoscope className="h-4 w-4 text-purple-600" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Member Declaration</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between rounded-lg border p-3 h-16">
                                        <div>
                                            <Label className="text-sm font-medium">Medical Questions</Label>
                                            <p className="text-xs text-muted-foreground">{form.hasMedicalConditions ? 'Has medical conditions to declare' : 'No medical conditions'}</p>
                                        </div>
                                        <Switch checked={form.hasMedicalConditions} onCheckedChange={(v) => setForm((f) => ({ ...f, hasMedicalConditions: v }))} />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between rounded-lg border p-3 h-16">
                                        <div>
                                            <Label className="text-sm font-medium">Consent to Split Payment</Label>
                                            <p className="text-xs text-muted-foreground">{form.consentSplitPayment ? 'Member consents' : 'Member does not consent'}</p>
                                        </div>
                                        <Switch checked={form.consentSplitPayment} onCheckedChange={(v) => setForm((f) => ({ ...f, consentSplitPayment: v }))} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── Payment Details ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <CreditCard className="h-4 w-4 text-primary" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Payment Details</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">UTRN No.</Label>
                                    <Input value={form.utrnNumber} onChange={(e) => setForm((f) => ({ ...f, utrnNumber: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Fund Transfer Date</Label>
                                    <DateInput value={form.fundTransferDate} onChange={(e) => setForm((f) => ({ ...f, fundTransferDate: e.target.value }))} className="h-10" />
                                </div>
                            </div>
                        </div>

                        {/* ── Appointee Details ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <UserCheck className="h-4 w-4 text-purple-600" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Appointee Details</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Appointee Name</Label>
                                    <Input value={form.appointeeName} onChange={(e) => setForm((f) => ({ ...f, appointeeName: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Appointee Surname</Label>
                                    <Input value={form.appointeeSurname} onChange={(e) => setForm((f) => ({ ...f, appointeeSurname: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Appointee Gender</Label>
                                    <Select value={form.appointeeGender} onValueChange={(v) => setForm((f) => ({ ...f, appointeeGender: v }))}>
                                        <SelectTrigger className="h-10"><SelectValue placeholder="Select gender" /></SelectTrigger>
                                        <SelectContent>
                                            {GENDER_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Appointee DOB</Label>
                                    <DateInput value={form.appointeeDob} onChange={(e) => setForm((f) => ({ ...f, appointeeDob: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Appointee Relationship with Nominee</Label>
                                    <Select value={form.appointeeRelationWithNominee} onValueChange={(v) => setForm((f) => ({ ...f, appointeeRelationWithNominee: v }))}>
                                        <SelectTrigger className="h-10"><SelectValue placeholder="Select relationship" /></SelectTrigger>
                                        <SelectContent>
                                            {RELATIONSHIP_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between rounded-lg border p-3 h-10">
                                        <Label className="text-sm font-medium">Consent to Cover Continuation</Label>
                                        <Switch checked={form.consentCoverContinuation} onCheckedChange={(v) => setForm((f) => ({ ...f, consentCoverContinuation: v }))} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ── COVID Declaration ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="h-4 w-4 text-red-500" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">COVID Declaration</span>
                            </div>
                            <div className="grid grid-cols-1 gap-y-3">
                                <div className="flex items-center justify-between rounded-lg border p-3 gap-4">
                                    <p className="text-xs text-sidebar-accent dark:text-slate-400">In the last 3 months have you / your family members been tested positive for COVID-19 or have been self-isolated with symptoms on medical advice?</p>
                                    <Switch checked={form.covidTestedOrIsolated} onCheckedChange={(v) => setForm((f) => ({ ...f, covidTestedOrIsolated: v }))} />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-3 gap-4">
                                    <p className="text-xs text-sidebar-accent dark:text-slate-400">In the last 1 month have you or your family members been advised to self-isolate due to COVID-19 (excluding mandatory government orders) or had a persistent cough, fever, raised temperature, or been in contact with a suspected/confirmed COVID-19 individual?</p>
                                    <Switch checked={form.covidAdvisedIsolationOrSymptoms} onCheckedChange={(v) => setForm((f) => ({ ...f, covidAdvisedIsolationOrSymptoms: v }))} />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-3 gap-4">
                                    <p className="text-xs text-sidebar-accent dark:text-slate-400">Have you or your family members travelled overseas after 1st Jan 2020 or planned to travel during the next 6 months?</p>
                                    <Switch checked={form.covidTravelOverseas} onCheckedChange={(v) => setForm((f) => ({ ...f, covidTravelOverseas: v }))} />
                                </div>
                            </div>
                        </div>

                        {/* ── Additional Member Details ── */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <IndianRupee className="h-4 w-4 text-slate-500" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Additional Member Details</span>
                                <span className="text-xs text-slate-400 ml-1">(manual entry, no system source defined yet)</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">ADB SA</Label>
                                    <Input type="number" step="0.01" min="0" value={form.adbSumAssured} onChange={(e) => setForm((f) => ({ ...f, adbSumAssured: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Accelerated TI Benefit</Label>
                                    <Input type="number" step="0.01" min="0" value={form.acceleratedTiBenefit} onChange={(e) => setForm((f) => ({ ...f, acceleratedTiBenefit: e.target.value }))} className="h-10" />
                                </div>
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label className="text-xs font-semibold text-sidebar-accent dark:text-slate-400">Remarks</Label>
                                    <Input value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes..." className="h-10" />
                                </div>
                            </div>
                        </div>

                        {/* ── Policy Document (PDF) ── */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Upload className="h-4 w-4 text-orange-600" />
                                <span className="text-sm font-bold text-sidebar-accent dark:text-slate-200">Policy Document (PDF)</span>
                                <span className="text-xs text-slate-400 ml-1">(optional — can also upload later)</span>
                            </div>
                            <div
                                className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent/60 rounded-xl p-6 text-center cursor-pointer hover:border-primary hover:bg-green-50/30 dark:hover:bg-green-950/10 transition-all"
                                onClick={() => document.getElementById('insurance-form-pdf-input')?.click()}
                            >
                                {uploadFile ? (
                                    <div className="flex items-center justify-center gap-3">
                                        <FileText className="h-8 w-8 text-primary shrink-0" />
                                        <div className="text-left">
                                            <p className="text-sm font-medium text-sidebar-accent dark:text-slate-300">{uploadFile.name}</p>
                                            <p className="text-xs text-slate-500">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                        <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                                            onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-1.5">
                                        <Upload className="h-8 w-8 text-slate-400" />
                                        <p className="text-sm text-sidebar-accent dark:text-slate-400">Click to select a PDF file</p>
                                        <p className="text-xs text-slate-400">Max 10MB · PDF only</p>
                                    </div>
                                )}
                            </div>
                            <input id="insurance-form-pdf-input" type="file" accept=".pdf,application/pdf" className="hidden"
                                onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-primary/20 dark:border-sidebar-accent bg-green-50/50 dark:bg-brand-green-darker/50 flex items-center justify-end gap-3">
                        <Button variant="outline" onClick={() => { setShowAddDialog(false); setShowEditDialog(false); setUploadFile(null); }} disabled={isSaving} className="h-10 px-5">
                            Cancel
                        </Button>
                        <Button onClick={showEditDialog ? handleUpdate : handleCreate} disabled={isSaving}
                            className="h-10 px-6 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white font-semibold shadow-sm">
                            {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</> : (showEditDialog ? 'Update Record' : 'Create Record')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ─── Upload Dialog ─── */}
            <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Upload Insurance Document</DialogTitle>
                        <DialogDescription>Upload the insurance policy PDF for {selectedRecord?.policyNumber}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent/60 rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors"
                            onClick={() => document.getElementById('insurance-pdf-input')?.click()}>
                            {uploadFile ? (
                                <div className="flex flex-col items-center gap-2">
                                    <FileText className="h-10 w-10 text-primary" />
                                    <p className="text-sm font-medium text-sidebar-accent dark:text-slate-300">{uploadFile.name}</p>
                                    <p className="text-xs text-slate-500">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2">
                                    <Upload className="h-10 w-10 text-slate-400" />
                                    <p className="text-sm text-sidebar-accent dark:text-slate-400">Click to select a PDF file</p>
                                    <p className="text-xs text-slate-400">Max 10MB · PDF only</p>
                                </div>
                            )}
                        </div>
                        <input id="insurance-pdf-input" type="file" accept=".pdf,application/pdf" className="hidden"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowUploadDialog(false)} disabled={isUploading}>Cancel</Button>
                        <Button onClick={handleUpload} disabled={!uploadFile || isUploading} className="bg-gradient-to-r from-primary to-primary text-white">
                            {isUploading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Uploading...</> : 'Upload PDF'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── Delete Confirmation ─── */}
            <ConfirmationDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                onConfirm={handleDelete}
                title="Delete Insurance Record"
                description={`Are you sure you want to delete the insurance record for policy "${selectedRecord?.policyNumber}"? This action cannot be undone.`}
                confirmText="Delete"
                type="delete"
            />
        </div>
    );
}
