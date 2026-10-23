'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Banknote, Search, Loader2, AlertTriangle, Upload, X, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { apiClient } from '@/app/lib/api-client';
import { StorageLink } from '@/components/storage/StorageMedia';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { compressImageForCategory } from '@/app/lib/image-compress';
import { DateInput } from '@/components/ui/date-input';

type SearchType = 'memberId' | 'phone' | 'aadhaar';

type ClientInfo = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    mobileNumber: string | null;
};

type DeathStatus = 'Normal' | 'Demand Required' | 'Demand Not Required';

type LoanRow = {
    loanId: string;
    loanNumber: string;
    clientId: string;
    clientCode: string;
    memberName: string;
    memberPhone: string | null;
    loanPrincipal: number;
    loanInterest: number;
    loanTotal: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    outstandingTotal: number;
    arrearPrincipal: number;
    arrearInterest: number;
    arrearTotal: number;
    principalPaid: number;
    interestPaid: number;
    deathStatus: DeathStatus;
};

type EditableEntry = {
    paidPrincipal: string;
    paidInterest: string;
    penaltyAmount: string;
    penaltyPaid: string;
    reason: 'DEAD' | 'WRITEOFF' | 'OTHERS' | '';
    remarks: string;
};

type UploadedDoc = {
    url: string;
    name: string;
    key: string;
    compressionNote?: string;
};

function fmt(n: number): string {
    return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const TH_BASE = 'text-white text-xs font-semibold px-3 py-2 border-r border-slate-600 whitespace-nowrap align-middle';
const TH_DARK = 'bg-slate-800';
const TH_BLUE = 'bg-blue-900';
const TH_INDIGO = 'bg-indigo-900';
const TH_AMBER = 'bg-amber-900';
const TH_TEAL = 'bg-teal-900';

const SEARCH_PLACEHOLDERS: Record<SearchType, string> = {
    memberId: 'Enter Member ID',
    phone: 'Enter Phone Number',
    aadhaar: 'Enter Aadhaar Number',
};

const DEATH_STATUS_BADGE: Record<DeathStatus, string> = {
    Normal: 'bg-slate-100 text-slate-600 border-slate-200',
    'Demand Required': 'bg-red-100 text-red-700 border-red-200',
    'Demand Not Required': 'bg-blue-100 text-blue-700 border-blue-200',
};

export function LoanWriteoffClosureClient({ branchId }: { branchId?: string } = {}) {
    const { toast } = useToast();

    const today = format(new Date(), 'yyyy-MM-dd');
    const [closeDate, setCloseDate] = useState(today);
    // When rendered standalone (app/dashboard/collections/loan-writeoff-closure/page.tsx),
    // no branchId prop is passed — fall back to the session's active branch, same resolution
    // non-admin branch context uses elsewhere (e.g. DeleteForeclosureClient).
    const [fallbackBranchId, setFallbackBranchId] = useState('');
    useEffect(() => {
        if (branchId) return;
        const activeBranch = branchStorage.getActiveBranch();
        setFallbackBranchId(activeBranch?.id ?? tokenStorage.getUser()?.branchId ?? '');
    }, [branchId]);
    const resolvedBranchId = branchId || fallbackBranchId;

    // The resolved branch's current EOD/working date (same hook/source the rest of
    // CollectionApprovalClient's tabs use) — available immediately on mount, before any
    // member search. Search results below can override this with the *searched loan's own*
    // branch working date (see workingDate), which takes precedence once resolved since
    // that's what the backend actually validates closeDate against.
    const { eodWorkingDate } = useEodWorkingDate(resolvedBranchId || undefined);
    // The branch's current EOD/working date, resolved from the searched member's loans
    // (all scoped to one branch) once a search returns results — null before any search,
    // or if it couldn't be resolved. When set, the Close Date field is locked to it, since
    // the backend only accepts a closeDate inside the branch's current working-day window.
    const [workingDate, setWorkingDate] = useState<string | null>(null);

    // Before any search (or once search results are cleared), fall back to the page's
    // selected-branch EOD date instead of the browser's system date.
    useEffect(() => {
        if (!workingDate && eodWorkingDate) {
            setCloseDate(eodWorkingDate);
        }
    }, [eodWorkingDate, workingDate]);

    const effectiveWorkingDate = workingDate ?? eodWorkingDate;

    // Search state
    const [searchType, setSearchType] = useState<SearchType>('memberId');
    const [searchValue, setSearchValue] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [clientResult, setClientResult] = useState<ClientInfo | null>(null);
    const [loans, setLoans] = useState<LoanRow[]>([]);

    // Selection + editable state
    const [selectedLoanIds, setSelectedLoanIds] = useState<Set<string>>(new Set());
    const [pendingLoanId, setPendingLoanId] = useState<string | null>(null);
    const [rowConfirmOpen, setRowConfirmOpen] = useState(false);
    const [editableData, setEditableData] = useState<Record<string, EditableEntry>>({});

    // Document upload state (keyed by loanId)
    const [uploadedDocs, setUploadedDocs] = useState<Record<string, UploadedDoc>>({});
    const [uploadingFor, setUploadingFor] = useState<string | null>(null);
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    // Submit dialog
    const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const resetResults = () => {
        setClientResult(null);
        setLoans([]);
        setSelectedLoanIds(new Set());
        setEditableData({});
        setUploadedDocs({});
        setHasSearched(false);
        setWorkingDate(null);
        setCloseDate(eodWorkingDate ?? today);
    };

    const handleSearch = async () => {
        const trimmed = searchValue.trim();
        if (!trimmed) {
            toast({ title: 'Search value is required', variant: 'destructive' });
            return;
        }
        setIsSearching(true);
        resetResults();

        const params = new URLSearchParams({ searchType, searchValue: trimmed });
        const res = await apiClient.get<{ client: ClientInfo; loans: LoanRow[]; workingDate: string | null } | null>(
            `/collections/loan-writeoff-closure?${params.toString()}`
        );
        setIsSearching(false);
        setHasSearched(true);

        if (!res.success) {
            toast({ title: 'Search Failed', description: res.error ?? '', variant: 'destructive' });
            return;
        }

        if (!res.data) {
            toast({ title: 'No member found', description: 'No member matched the search criteria.' });
            return;
        }

        setClientResult(res.data.client);
        setLoans(res.data.loans);
        if (res.data.workingDate) {
            setWorkingDate(res.data.workingDate);
            setCloseDate(res.data.workingDate);
        }
        if (res.data.loans.length === 0) {
            toast({ title: 'No eligible loans', description: 'Member has no active disbursed loans eligible for closure.' });
        }
    };

    const handleCheckboxChange = (loanId: string, checked: boolean) => {
        if (!checked) {
            setSelectedLoanIds((prev) => { const s = new Set(prev); s.delete(loanId); return s; });
            setEditableData((prev) => { const d = { ...prev }; delete d[loanId]; return d; });
            return;
        }
        setPendingLoanId(loanId);
        setRowConfirmOpen(true);
    };

    const confirmRowSelect = () => {
        if (!pendingLoanId) return;
        const loan = loans.find((l) => l.loanId === pendingLoanId);
        if (!loan) return;
        setSelectedLoanIds((prev) => new Set(prev).add(pendingLoanId));
        setEditableData((prev) => ({
            ...prev,
            [pendingLoanId]: {
                paidPrincipal: loan.outstandingPrincipal.toFixed(2),
                paidInterest: loan.outstandingInterest.toFixed(2),
                penaltyAmount: '0',
                penaltyPaid: '0',
                reason: '',
                remarks: '',
            },
        }));
        setRowConfirmOpen(false);
        setPendingLoanId(null);
    };

    const cancelRowSelect = () => {
        setRowConfirmOpen(false);
        setPendingLoanId(null);
    };

    const updateField = (loanId: string, field: keyof EditableEntry, value: string) => {
        setEditableData((prev) => ({
            ...prev,
            [loanId]: { ...prev[loanId], [field]: value },
        }));
    };

    const getWaiver = (loanId: string, type: 'principal' | 'interest'): number => {
        const loan = loans.find((l) => l.loanId === loanId);
        const entry = editableData[loanId];
        if (!loan || !entry) return 0;
        if (type === 'principal') return Math.max(0, loan.outstandingPrincipal - (parseFloat(entry.paidPrincipal) || 0));
        return Math.max(0, loan.outstandingInterest - (parseFloat(entry.paidInterest) || 0));
    };

    const needsDoc = (loanId: string): boolean => {
        return getWaiver(loanId, 'principal') > 0 || getWaiver(loanId, 'interest') > 0;
    };

    const handleDocUpload = async (loanId: string, file: File) => {
        setUploadingFor(loanId);
        try {
            const compressionResult = await compressImageForCategory(file, 'document');
            const { compressedFile, previewUrl } = compressionResult;
            URL.revokeObjectURL(previewUrl);
            const compressionNote = compressionResult.wasCompressed
                ? `Compressed ${compressionResult.originalSizeLabel} → ${compressionResult.compressedSizeLabel} (saved ${compressionResult.reductionPercent}%)`
                : undefined;

            const formData = new FormData();
            formData.append('file', compressedFile);
            formData.append('loanId', loanId);

            const token = tokenStorage.getAccessToken();
            const authHeaders: Record<string, string> = {};
            if (token) authHeaders['Authorization'] = `Bearer ${token}`;

            const response = await fetch('/api/collections/loan-writeoff-closure/upload-approval-doc', {
                method: 'POST',
                headers: authHeaders,
                body: formData,
                credentials: 'include',
            });
            const json = await response.json();

            if (!response.ok || !json.success) {
                toast({ title: 'Upload Failed', description: json.message ?? 'Could not upload document', variant: 'destructive' });
                return;
            }

            setUploadedDocs((prev) => ({
                ...prev,
                [loanId]: { url: json.data.fileUrl, name: json.data.fileName, key: json.data.fileKey, compressionNote },
            }));
            toast({ title: 'Document Uploaded', description: json.data.fileName });
        } catch {
            toast({ title: 'Upload Error', description: 'An unexpected error occurred during upload', variant: 'destructive' });
        } finally {
            setUploadingFor(null);
            if (fileInputRefs.current[loanId]) {
                fileInputRefs.current[loanId]!.value = '';
            }
        }
    };

    const clearDoc = (loanId: string) => {
        setUploadedDocs((prev) => { const d = { ...prev }; delete d[loanId]; return d; });
        if (fileInputRefs.current[loanId]) {
            fileInputRefs.current[loanId]!.value = '';
        }
    };

    const allSelected = loans.length > 0 && loans.every((l) => selectedLoanIds.has(l.loanId));
    const someSelected = selectedLoanIds.size > 0;

    const handleSelectAll = (checked: boolean) => {
        if (!checked) {
            setSelectedLoanIds(new Set());
            setEditableData({});
            return;
        }
        const newSelected = new Set<string>();
        const newEditable: Record<string, EditableEntry> = {};
        loans.forEach((loan) => {
            newSelected.add(loan.loanId);
            newEditable[loan.loanId] = editableData[loan.loanId] ?? {
                paidPrincipal: loan.outstandingPrincipal.toFixed(2),
                paidInterest: loan.outstandingInterest.toFixed(2),
                penaltyAmount: '0',
                penaltyPaid: '0',
                reason: '',
                remarks: '',
            };
        });
        setSelectedLoanIds(newSelected);
        setEditableData((prev) => ({ ...prev, ...newEditable }));
    };

    const validateEntries = (): string | null => {
        for (const loanId of selectedLoanIds) {
            const entry = editableData[loanId];
            const loan = loans.find((l) => l.loanId === loanId);
            if (!loan || !entry) continue;
            const paidP = parseFloat(entry.paidPrincipal) || 0;
            const paidI = parseFloat(entry.paidInterest) || 0;
            const penAmt = parseFloat(entry.penaltyAmount) || 0;
            const penPaid = parseFloat(entry.penaltyPaid) || 0;
            if (paidP < 0 || paidP > loan.outstandingPrincipal + 0.01)
                return `${loan.loanNumber}: Paid Principal must be between 0 and ${fmt(loan.outstandingPrincipal)}`;
            if (paidI < 0 || paidI > loan.outstandingInterest + 0.01)
                return `${loan.loanNumber}: Paid Interest must be between 0 and ${fmt(loan.outstandingInterest)}`;
            if (penPaid > penAmt + 0.01)
                return `${loan.loanNumber}: Penalty Paid cannot exceed Penalty Amount`;
            if (!entry.reason)
                return `${loan.loanNumber}: Reason is required`;
            if (entry.reason === 'OTHERS' && !entry.remarks.trim())
                return `${loan.loanNumber}: Remarks are required when Reason is "Others"`;
            if (needsDoc(loanId) && !uploadedDocs[loanId]) {
                return `${loan.loanNumber}: HO Approval Document is required (waiver amount > 0)`;
            }
        }
        return null;
    };

    const getSubmitTotals = () => {
        let totalPaidPrincipal = 0, totalPaidInterest = 0;
        let totalPrincipalWaiver = 0, totalInterestWaiver = 0;
        let totalPenaltyAmount = 0, totalPenaltyPaid = 0;
        for (const loanId of selectedLoanIds) {
            const entry = editableData[loanId];
            if (!entry) continue;
            totalPaidPrincipal += parseFloat(entry.paidPrincipal) || 0;
            totalPaidInterest += parseFloat(entry.paidInterest) || 0;
            totalPrincipalWaiver += getWaiver(loanId, 'principal');
            totalInterestWaiver += getWaiver(loanId, 'interest');
            totalPenaltyAmount += parseFloat(entry.penaltyAmount) || 0;
            totalPenaltyPaid += parseFloat(entry.penaltyPaid) || 0;
        }
        return { totalPaidPrincipal, totalPaidInterest, totalPrincipalWaiver, totalInterestWaiver, totalPenaltyAmount, totalPenaltyPaid };
    };

    const handleSubmitClick = () => {
        if (selectedLoanIds.size === 0) { toast({ title: 'No loans selected', variant: 'destructive' }); return; }
        const error = validateEntries();
        if (error) { toast({ title: 'Validation Error', description: error, variant: 'destructive' }); return; }
        setSubmitDialogOpen(true);
    };

    const handleConfirmSubmit = async () => {
        setIsSubmitting(true);
        const payload = Array.from(selectedLoanIds).map((loanId) => {
            const entry = editableData[loanId];
            const loan = loans.find((l) => l.loanId === loanId)!;
            const doc = uploadedDocs[loanId];
            return {
                loanId,
                clientId: loan.clientId,
                closeDate,
                paidPrincipal: parseFloat(entry.paidPrincipal) || 0,
                paidInterest: parseFloat(entry.paidInterest) || 0,
                principalWaiver: getWaiver(loanId, 'principal'),
                interestWaiver: getWaiver(loanId, 'interest'),
                penaltyAmount: parseFloat(entry.penaltyAmount) || 0,
                penaltyPaid: parseFloat(entry.penaltyPaid) || 0,
                reason: entry.reason as 'DEAD' | 'WRITEOFF' | 'OTHERS',
                remarks: entry.remarks || undefined,
                approvalDocumentUrl: doc?.url,
                approvalDocumentKey: doc?.key,
                approvalDocumentName: doc?.name,
            };
        });
        const res = await apiClient.post<{ loanId: string; loanNumber: string; status: string }[]>(
            '/collections/loan-writeoff-closure',
            payload
        );
        setIsSubmitting(false);
        setSubmitDialogOpen(false);
        if (res.success) {
            toast({ title: 'Loan(s) Closed', description: `${selectedLoanIds.size} loan(s) closed. Their GL voucher will post the next time you Allocate for EOD.` });
            // Re-run search to refresh the loans list
            handleSearch();
        } else {
            toast({ title: 'Closure Failed', description: res.error ?? 'An error occurred', variant: 'destructive' });
        }
    };

    const totals = getSubmitTotals();
    const canSubmit = someSelected && !isSubmitting && Array.from(selectedLoanIds).every((id) => !!editableData[id]?.reason);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Banknote className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Loan Write-Off / Death Closure</h1>
                    <p className="text-sm text-muted-foreground">Close active loans via write-off or death closure</p>
                </div>
            </div>

            {/* Search Card */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Search Member</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {/* Search type selector */}
                        <div className="space-y-2">
                            <Label>Search By</Label>
                            <RadioGroup
                                value={searchType}
                                onValueChange={(v) => { setSearchType(v as SearchType); setSearchValue(''); resetResults(); }}
                                className="flex flex-wrap gap-4"
                            >
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="memberId" id="st-memberId" />
                                    <Label htmlFor="st-memberId" className="cursor-pointer font-normal">Member ID</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="phone" id="st-phone" />
                                    <Label htmlFor="st-phone" className="cursor-pointer font-normal">Phone Number</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="aadhaar" id="st-aadhaar" />
                                    <Label htmlFor="st-aadhaar" className="cursor-pointer font-normal">Aadhaar Number</Label>
                                </div>
                            </RadioGroup>
                        </div>

                        {/* Search input row */}
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1.5 flex-1 min-w-[220px] max-w-xs">
                                <Label htmlFor="searchValue">{SEARCH_PLACEHOLDERS[searchType].replace('Enter ', '')}</Label>
                                <Input
                                    id="searchValue"
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                    placeholder={SEARCH_PLACEHOLDERS[searchType]}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="closeDate">Close Date <span className="text-red-500">*</span></Label>
                                <DateInput
                                    id="closeDate"
                                    value={closeDate}
                                    onChange={(e) => setCloseDate(e.target.value)}
                                    min={effectiveWorkingDate ?? undefined}
                                    max={effectiveWorkingDate ?? today}
                                    disabled={!!effectiveWorkingDate}
                                    className="w-44"
                                />
                                {effectiveWorkingDate && (
                                    <p className="text-[11px] text-muted-foreground">Locked to the branch&apos;s current EOD date.</p>
                                )}
                            </div>
                            <Button
                                onClick={handleSearch}
                                disabled={isSearching}
                                className="bg-primary hover:bg-sidebar-accent text-white"
                            >
                                {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                Search
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Client Result Card */}
            {hasSearched && clientResult && (
                <Card className="border-green-200 bg-green-50/40">
                    <CardContent className="pt-4 pb-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100">
                                <User className="h-4 w-4 text-green-700" />
                            </div>
                            <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm">
                                <span className="font-semibold text-foreground">
                                    {clientResult.firstName} {clientResult.lastName}
                                </span>
                                <span className="text-muted-foreground">ID: <span className="text-foreground font-medium">{clientResult.clientId}</span></span>
                                {clientResult.mobileNumber && (
                                    <span className="text-muted-foreground">Phone: <span className="text-foreground font-medium">{clientResult.mobileNumber}</span></span>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Table Section */}
            {hasSearched && (
                <Card>
                    <CardHeader className="pb-2 pt-3 px-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                                Active Loans
                                {loans.length > 0 && <Badge variant="secondary" className="ml-2">{loans.length}</Badge>}
                            </CardTitle>
                            {someSelected && (
                                <span className="text-sm text-muted-foreground">{selectedLoanIds.size} loan(s) selected</span>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {loans.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <AlertTriangle className="h-8 w-8 mb-2 text-amber-400" />
                                <p>{clientResult ? 'No active disbursed loans eligible for closure.' : 'No member found matching the search criteria.'}</p>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto border-t">
                                    <table
                                        className="w-full text-xs"
                                        style={{ minWidth: '3000px', borderCollapse: 'collapse' }}
                                    >
                                        <TableHeader>
                                            {/* ── Row 1: Group headers ─────────────────────────── */}
                                            <TableRow className="hover:bg-transparent">
                                                {/* Select — sticky left, rowSpan=2 */}
                                                <TableHead
                                                    rowSpan={2}
                                                    className={cn(TH_BASE, TH_DARK, 'sticky left-0 z-20 text-center w-[110px] min-w-[110px]')}
                                                >
                                                    <div className="flex flex-col items-center gap-1.5">
                                                        <Switch
                                                            checked={allSelected}
                                                            onCheckedChange={handleSelectAll}
                                                            className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-slate-500 scale-90"
                                                        />
                                                        <span className="text-[10px] text-slate-300 leading-tight">Check All</span>
                                                    </div>
                                                </TableHead>

                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'min-w-[130px]')}>Loan No.</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'min-w-[200px]')}>Member Name</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'min-w-[150px]')}>Member Unique ID</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'min-w-[140px]')}>Phone Number</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_TEAL, 'min-w-[150px]')}>Death Status</TableHead>

                                                {/* Loan Amount */}
                                                <TableHead colSpan={3} className={cn(TH_BASE, TH_BLUE, 'text-center min-w-[270px]')}>Loan Amount</TableHead>
                                                {/* Outstanding Balance */}
                                                <TableHead colSpan={3} className={cn(TH_BASE, TH_INDIGO, 'text-center min-w-[270px]')}>Outstanding Balance Amount</TableHead>
                                                {/* Arrear Amount */}
                                                <TableHead colSpan={3} className={cn(TH_BASE, TH_AMBER, 'text-center min-w-[270px]')}>Arrear Amount</TableHead>

                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[140px]')}>Paid Principal</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[140px]')}>Paid Interest</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[140px]')}>Principal Waiver</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[140px]')}>Interest Waiver</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[140px]')}>Penalty Amount</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[140px]')}>Penalty Paid</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[160px]')}>Reason <span className="text-red-400">*</span></TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_DARK, 'text-center min-w-[180px]')}>Remarks</TableHead>
                                                <TableHead rowSpan={2} className={cn(TH_BASE, TH_TEAL, 'text-center min-w-[200px] border-r-0')}>HO Approval Doc</TableHead>
                                            </TableRow>

                                            {/* ── Row 2: Sub-headers ───────────────────────────── */}
                                            <TableRow className="hover:bg-transparent">
                                                <TableHead className={cn(TH_BASE, 'bg-blue-800 text-center min-w-[90px]')}>Principal</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-blue-800 text-center min-w-[90px]')}>Interest</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-blue-800 text-center min-w-[90px]')}>Total</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-indigo-800 text-center min-w-[90px]')}>Principal</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-indigo-800 text-center min-w-[90px]')}>Interest</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-indigo-800 text-center min-w-[90px]')}>Total</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-amber-800 text-center min-w-[90px]')}>Principal</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-amber-800 text-center min-w-[90px]')}>Interest</TableHead>
                                                <TableHead className={cn(TH_BASE, 'bg-amber-800 text-center min-w-[90px]')}>Total</TableHead>
                                            </TableRow>
                                        </TableHeader>

                                        <TableBody>
                                            {loans.map((loan, idx) => {
                                                const isSelected = selectedLoanIds.has(loan.loanId);
                                                const entry = editableData[loan.loanId];
                                                const principalWaiver = isSelected ? getWaiver(loan.loanId, 'principal') : 0;
                                                const interestWaiver = isSelected ? getWaiver(loan.loanId, 'interest') : 0;
                                                const hasWaiver = principalWaiver > 0 || interestWaiver > 0;
                                                const doc = uploadedDocs[loan.loanId];
                                                const isUploading = uploadingFor === loan.loanId;
                                                const evenBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                                                const rowCls = cn(isSelected ? 'bg-green-50' : evenBg, !isSelected && 'text-slate-400');
                                                const stickyBg = isSelected ? 'bg-green-50' : evenBg;

                                                return (
                                                    <TableRow key={loan.loanId} className={cn(rowCls, 'hover:bg-opacity-90')}>
                                                        {/* Select Switch */}
                                                        <TableCell
                                                            className={cn(
                                                                'sticky left-0 z-10 text-center px-3 border-r border-slate-200',
                                                                stickyBg,
                                                                isSelected && 'border-l-[3px] border-l-green-500'
                                                            )}
                                                        >
                                                            <Switch
                                                                checked={isSelected}
                                                                onCheckedChange={(checked) => handleCheckboxChange(loan.loanId, checked)}
                                                                className="data-[state=checked]:bg-green-500 scale-90"
                                                            />
                                                        </TableCell>

                                                        {/* Loan No. */}
                                                        <TableCell className="px-3 py-2 whitespace-nowrap border-r border-slate-200 font-mono text-[11px]">
                                                            {loan.loanNumber}
                                                        </TableCell>

                                                        {/* Member Name */}
                                                        <TableCell className="px-3 py-2 font-medium whitespace-nowrap border-r border-slate-200">
                                                            {loan.memberName}
                                                        </TableCell>

                                                        {/* Member Unique ID */}
                                                        <TableCell className="px-3 py-2 whitespace-nowrap border-r border-slate-200">
                                                            {loan.clientCode}
                                                        </TableCell>

                                                        {/* Phone */}
                                                        <TableCell className="px-3 py-2 whitespace-nowrap border-r border-slate-200">
                                                            {loan.memberPhone ?? '—'}
                                                        </TableCell>

                                                        {/* Death Status */}
                                                        <TableCell className="px-3 py-2 whitespace-nowrap border-r border-slate-200">
                                                            <span className={cn(
                                                                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                                                DEATH_STATUS_BADGE[loan.deathStatus]
                                                            )}>
                                                                {loan.deathStatus}
                                                            </span>
                                                        </TableCell>

                                                        {/* Loan Amount — P / I / Total */}
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-100">₹{fmt(loan.loanPrincipal)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-100">₹{fmt(loan.loanInterest)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right font-semibold whitespace-nowrap border-r border-slate-200">₹{fmt(loan.loanTotal)}</TableCell>

                                                        {/* Outstanding — P / I / Total */}
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-100">₹{fmt(loan.outstandingPrincipal)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-100">₹{fmt(loan.outstandingInterest)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right font-semibold whitespace-nowrap border-r border-slate-200">₹{fmt(loan.outstandingTotal)}</TableCell>

                                                        {/* Arrear — P / I / Total */}
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-100">₹{fmt(loan.arrearPrincipal)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-100">₹{fmt(loan.arrearInterest)}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right font-semibold whitespace-nowrap border-r border-slate-200">₹{fmt(loan.arrearTotal)}</TableCell>

                                                        {/* Paid Principal */}
                                                        <TableCell className="px-2 py-1 border-r border-slate-200">
                                                            <Input
                                                                type="number" min={0} max={loan.outstandingPrincipal} step="0.01"
                                                                value={isSelected && entry ? entry.paidPrincipal : ''}
                                                                placeholder={isSelected ? '' : fmt(loan.outstandingPrincipal)}
                                                                onChange={(e) => updateField(loan.loanId, 'paidPrincipal', e.target.value)}
                                                                disabled={!isSelected}
                                                                className="h-7 text-xs w-full min-w-[110px]"
                                                            />
                                                        </TableCell>

                                                        {/* Paid Interest */}
                                                        <TableCell className="px-2 py-1 border-r border-slate-200">
                                                            <Input
                                                                type="number" min={0} max={loan.outstandingInterest} step="0.01"
                                                                value={isSelected && entry ? entry.paidInterest : ''}
                                                                placeholder={isSelected ? '' : fmt(loan.outstandingInterest)}
                                                                onChange={(e) => updateField(loan.loanId, 'paidInterest', e.target.value)}
                                                                disabled={!isSelected}
                                                                className="h-7 text-xs w-full min-w-[110px]"
                                                            />
                                                        </TableCell>

                                                        {/* Principal Waiver */}
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-200">
                                                            <span className={cn('font-medium', isSelected && principalWaiver > 0 ? 'text-amber-600' : '')}>
                                                                {isSelected ? `₹${fmt(principalWaiver)}` : '—'}
                                                            </span>
                                                        </TableCell>

                                                        {/* Interest Waiver */}
                                                        <TableCell className="px-3 py-2 text-right whitespace-nowrap border-r border-slate-200">
                                                            <span className={cn('font-medium', isSelected && interestWaiver > 0 ? 'text-amber-600' : '')}>
                                                                {isSelected ? `₹${fmt(interestWaiver)}` : '—'}
                                                            </span>
                                                        </TableCell>

                                                        {/* Penalty Amount */}
                                                        <TableCell className="px-2 py-1 border-r border-slate-200">
                                                            <Input
                                                                type="number" min={0} step="0.01"
                                                                value={isSelected && entry ? entry.penaltyAmount : ''}
                                                                placeholder="0"
                                                                onChange={(e) => updateField(loan.loanId, 'penaltyAmount', e.target.value)}
                                                                disabled={!isSelected}
                                                                className="h-7 text-xs w-full min-w-[110px]"
                                                            />
                                                        </TableCell>

                                                        {/* Penalty Paid */}
                                                        <TableCell className="px-2 py-1 border-r border-slate-200">
                                                            <Input
                                                                type="number" min={0}
                                                                max={isSelected && entry ? (parseFloat(entry.penaltyAmount) || 0) : 0}
                                                                step="0.01"
                                                                value={isSelected && entry ? entry.penaltyPaid : ''}
                                                                placeholder="0"
                                                                onChange={(e) => updateField(loan.loanId, 'penaltyPaid', e.target.value)}
                                                                disabled={!isSelected}
                                                                className="h-7 text-xs w-full min-w-[110px]"
                                                            />
                                                        </TableCell>

                                                        {/* Reason */}
                                                        <TableCell className="px-2 py-1 border-r border-slate-200">
                                                            {isSelected && entry ? (
                                                                <Select value={entry.reason} onValueChange={(v) => updateField(loan.loanId, 'reason', v)}>
                                                                    <SelectTrigger className={cn('h-7 text-xs min-w-[130px]', !entry.reason && 'border-red-300')}>
                                                                        <SelectValue placeholder="Select Reason *" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="DEAD">Dead</SelectItem>
                                                                        <SelectItem value="WRITEOFF">Write-Off</SelectItem>
                                                                        <SelectItem value="OTHERS">Others</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : (
                                                                <span className="text-muted-foreground">—</span>
                                                            )}
                                                        </TableCell>

                                                        {/* Remarks */}
                                                        <TableCell className="px-2 py-1 border-r border-slate-200">
                                                            {isSelected && entry ? (
                                                                <Textarea
                                                                    value={entry.remarks}
                                                                    onChange={(e) => updateField(loan.loanId, 'remarks', e.target.value)}
                                                                    placeholder={entry.reason === 'OTHERS' ? 'Required *' : 'Optional'}
                                                                    rows={1}
                                                                    className="text-xs min-w-[150px] resize-none"
                                                                />
                                                            ) : (
                                                                <span className="text-muted-foreground">—</span>
                                                            )}
                                                        </TableCell>

                                                        {/* HO Approval Doc */}
                                                        <TableCell className="px-2 py-1">
                                                            {isSelected && hasWaiver ? (
                                                                <div className="min-w-[180px]">
                                                                    {doc ? (
                                                                        <div>
                                                                            <div className="flex items-center gap-1">
                                                                                <StorageLink
                                                                                    href={doc.url}
                                                                                    className="text-blue-600 underline text-[11px] truncate max-w-[130px]"
                                                                                    title={doc.name}
                                                                                >
                                                                                    {doc.name}
                                                                                </StorageLink>
                                                                                <button
                                                                                    onClick={() => clearDoc(loan.loanId)}
                                                                                    className="text-slate-400 hover:text-red-500 shrink-0"
                                                                                    title="Remove"
                                                                                >
                                                                                    <X className="h-3 w-3" />
                                                                                </button>
                                                                            </div>
                                                                            {doc.compressionNote && (
                                                                                <div className="text-[9px] text-blue-500 truncate max-w-[160px]" title={doc.compressionNote}>
                                                                                    {doc.compressionNote}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <button
                                                                                type="button"
                                                                                disabled={isUploading}
                                                                                onClick={() => fileInputRefs.current[loan.loanId]?.click()}
                                                                                className={cn(
                                                                                    'inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium',
                                                                                    'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100',
                                                                                    isUploading && 'opacity-50 cursor-wait'
                                                                                )}
                                                                            >
                                                                                {isUploading
                                                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                                                    : <Upload className="h-3 w-3" />
                                                                                }
                                                                                {isUploading ? 'Uploading…' : 'Upload Doc *'}
                                                                            </button>
                                                                            <input
                                                                                ref={(el) => { fileInputRefs.current[loan.loanId] = el; }}
                                                                                type="file"
                                                                                accept=".pdf,.jpg,.jpeg,.png"
                                                                                style={{ display: 'none' }}
                                                                                disabled={isUploading}
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (file) handleDocUpload(loan.loanId, file);
                                                                                }}
                                                                            />
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-muted-foreground">—</span>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </table>
                                </div>

                                {/* Bottom Totals + Submit */}
                                {someSelected && (
                                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Selected Loans</span>
                                                <span className="font-bold text-lg text-slate-800">{selectedLoanIds.size}</span>
                                            </div>
                                            <div className="h-8 w-px bg-slate-300" />
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Paid Principal</span>
                                                <span className="font-semibold text-green-700">₹{fmt(totals.totalPaidPrincipal)}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Paid Interest</span>
                                                <span className="font-semibold text-green-700">₹{fmt(totals.totalPaidInterest)}</span>
                                            </div>
                                            <div className="h-8 w-px bg-slate-300" />
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Principal Waiver</span>
                                                <span className="font-semibold text-amber-600">₹{fmt(totals.totalPrincipalWaiver)}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Interest Waiver</span>
                                                <span className="font-semibold text-amber-600">₹{fmt(totals.totalInterestWaiver)}</span>
                                            </div>
                                            <div className="h-8 w-px bg-slate-300" />
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Penalty Amount</span>
                                                <span className="font-semibold text-slate-700">₹{fmt(totals.totalPenaltyAmount)}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Penalty Paid</span>
                                                <span className="font-semibold text-slate-700">₹{fmt(totals.totalPenaltyPaid)}</span>
                                            </div>
                                            <div className="ml-auto">
                                                <Button
                                                    onClick={handleSubmitClick}
                                                    disabled={!canSubmit}
                                                    className="bg-red-700 hover:bg-red-800 text-white"
                                                >
                                                    <Banknote className="mr-2 h-4 w-4" />
                                                    Submit Closure ({selectedLoanIds.size})
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Row Confirm Dialog */}
            <Dialog open={rowConfirmOpen} onOpenChange={setRowConfirmOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600">
                            <AlertTriangle className="h-5 w-5" />
                            Confirm Selection
                        </DialogTitle>
                        <DialogDescription>
                            Do you want to <strong>Write-Off / Dead Close</strong> this loan?
                            <br />
                            <span className="text-xs text-muted-foreground mt-1 block">
                                {pendingLoanId && loans.find((l) => l.loanId === pendingLoanId)?.loanNumber}
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={cancelRowSelect}>No</Button>
                        <Button className="bg-primary hover:bg-sidebar-accent text-white" onClick={confirmRowSelect}>
                            Yes, Select
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Submit Confirm Dialog */}
            <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="h-5 w-5" />
                            Confirm Loan Closure
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to close the selected <strong>{selectedLoanIds.size}</strong> loan(s)?
                            Each loan closes immediately — its GL voucher posts separately the next time you Allocate for EOD. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Paid Principal</span>
                            <span className="font-semibold">₹{fmt(totals.totalPaidPrincipal)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Paid Interest</span>
                            <span className="font-semibold">₹{fmt(totals.totalPaidInterest)}</span>
                        </div>
                        <div className="border-t pt-2 flex justify-between text-amber-600">
                            <span>Total Principal Waiver</span>
                            <span className="font-semibold">₹{fmt(totals.totalPrincipalWaiver)}</span>
                        </div>
                        <div className="flex justify-between text-amber-600">
                            <span>Total Interest Waiver</span>
                            <span className="font-semibold">₹{fmt(totals.totalInterestWaiver)}</span>
                        </div>
                        <div className="border-t pt-2 flex justify-between font-bold">
                            <span>Total Waiver</span>
                            <span className="text-red-600">₹{fmt(totals.totalPrincipalWaiver + totals.totalInterestWaiver)}</span>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setSubmitDialogOpen(false)} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        <Button onClick={handleConfirmSubmit} disabled={isSubmitting} className="bg-red-700 hover:bg-red-800 text-white">
                            {isSubmitting
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
                                : 'Confirm Closure'
                            }
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
