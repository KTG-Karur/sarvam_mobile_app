'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    CheckCircle2,
    AlertCircle,
    Users,
    Banknote,
    UserCheck,
    UserX,
    CalendarDays,
    Building2,
    Filter,
    SendHorizonal,
    ChevronLeft,
    ChevronRight,
    X,
    ShieldAlert,
    ShieldX,
    Undo2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { FirstDueDateChangeRequestButton } from '@/components/loan-module/FirstDueDateChangeRequestButton';
import { toDisplayDate } from '@/app/lib/date-format';

type Branch = { id: string; name: string; code: string };
type Funder = { id: string; funderId: string; funderName: string };

type GoldLoanDetails = {
    karatType: '24K' | '22K' | '20K' | '18K' | '16K';
    gramCount: number;
    goldTakenValue: number;
    cashGiven: number;
    itemDescription?: string;
    goldTokenNo?: string;
    remarks?: string;
};

type GoldLoanPhoto = { id: string; photoUrl: string };

type BmLoanEntry = {
    id: string;
    loanNumber: string;
    amount: number;
    frequency: string;
    tenureMonths: number;
    clientId: string;
    clientName: string;
    isGoldLoan?: boolean;
    loanProductTypeName?: string;
    firstDueDate: string | null;
    documentCharges?: number;
};

type BmIndexGroup = {
    id: string;
    indexNo: string;
    indexDate: string;
    centerId: string;
    centerName: string;
    centerCode: string;
    totalLoans: number;
    totalAmount: number;
    loans: BmLoanEntry[];
};

export function FinalDisbursementClient() {
    const { toast } = useToast();
    const { canPage } = usePermission();
    const canDisburse = canPage('/dashboard/loan-module/final-disbursement', 'add');

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Filter state
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [isBranchManager, setIsBranchManager] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [approvedIndexes, setApprovedIndexes] = useState<BmIndexGroup[]>([]);
    const [isLoadingIndexes, setIsLoadingIndexes] = useState(false);
    // Indexes with a PENDING first-due-date change request (BM raised, Admin yet to decide)
    const [pendingDateChangeIndexIds, setPendingDateChangeIndexIds] = useState<Set<string>>(new Set());

    // Admin-only: send an AM-approved (not-yet-disbursed) index back to the AM
    // Level-2 queue — e.g. to fix a wrong loan product before disbursement.
    const [confirmSendBack, setConfirmSendBack] = useState<BmIndexGroup | null>(null);
    // Per-member reject: sends one loan back to Loan Indexation (rest of the index stays)
    const [rejectingLoan, setRejectingLoan] = useState<BmLoanEntry | null>(null);
    const [rejectReason, setRejectReason] = useState('');
    const [isRejectingLoan, setIsRejectingLoan] = useState(false);
    // Warn before disbursing an index that still has a pending first-due-date change request.
    const [confirmPendingDateChange, setConfirmPendingDateChange] = useState(false);
    const [sendingBack, setSendingBack] = useState(false);

    // Funder state (mandatory, selected at page level)
    const [funders, setFunders] = useState<Funder[]>([]);
    const [fundersLoading, setFundersLoading] = useState(false);
    const [selectedFunderId, setSelectedFunderId] = useState('');

    // Admission fee settings
    const [admissionFeeEnabled, setAdmissionFeeEnabled] = useState(true);
    const [admissionFeeSettings, setAdmissionFeeSettings] = useState<any>(null);

    // Inline disbursement section state
    const [selectedIndex, setSelectedIndex] = useState<BmIndexGroup | null>(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [attendanceMap, setAttendanceMap] = useState<Record<string, 'PRESENT' | 'ABSENT'>>({});
    const [admissionFeeMap, setAdmissionFeeMap] = useState<Record<string, number>>({});
    const [newClientsMap, setNewClientsMap] = useState<Record<string, boolean>>({});
    const [goldMap, setGoldMap] = useState<Record<string, Partial<GoldLoanDetails>>>({});
    const [goldPhotosMap, setGoldPhotosMap] = useState<Record<string, GoldLoanPhoto[]>>({});
    const [uploadingGoldPhotoFor, setUploadingGoldPhotoFor] = useState<string | null>(null);
    const [memberIndividualMap, setMemberIndividualMap] = useState<Record<string, boolean>>({});
    const [isRefreshingMemberIndividual, setIsRefreshingMemberIndividual] = useState(false);

    // Per-member funder — defaults to the bulk funder above, individually overridable.
    // `funderOverrides` tracks which rows were manually touched so a later bulk-funder
    // change doesn't clobber a member's explicit choice.
    const [memberFunderMap, setMemberFunderMap] = useState<Record<string, string>>({});
    const [funderOverrides, setFunderOverrides] = useState<Set<string>>(new Set());

    // Pagination for Approved Indexes table
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 5;

    useEffect(() => {
        Promise.all([fetchBranches(), fetchFunders(), fetchAdmissionFeeSettings()]);
    }, []);

    const fetchBranches = async () => {
        setIsLoading(true);
        try {
            const activeBranch = branchStorage.getActiveBranch();
            const storedUser = tokenStorage.getUser();
            const isBM = storedUser?.role === 'BRANCH_MANAGER';
            setIsBranchManager(isBM);
            setIsAdmin(storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH');
            if (isBM && (activeBranch?.id || storedUser?.branchId)) {
                const result = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                if (result.success && result.data) {
                    const branchId = activeBranch?.id || storedUser?.branchId || '';
                    // Lock the dropdown to the BM's own branch only — the server
                    // already rejects any other branch, this just matches the UI.
                    const ownBranch = result.data.filter((b) => b.id === branchId);
                    setBranches(ownBranch.length > 0 ? ownBranch : result.data);
                    if (branchId) {
                        setSelectedBranchId(branchId);
                        fetchApprovedIndexes(branchId);
                    }
                }
            } else {
                const result = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                if (result.success && result.data) setBranches(result.data);
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    const fetchFunders = async () => {
        setFundersLoading(true);
        try {
            const result = await apiClient.get<Funder[]>('/masters/funder');
            if (result.success && result.data) setFunders(result.data);
        } catch {
            // silent
        } finally {
            setFundersLoading(false);
        }
    };

    const fetchAdmissionFeeSettings = async () => {
        try {
            const result = await apiClient.get<any>('/settings/admission-fee');
            if (result.success && result.data) {
                setAdmissionFeeEnabled(result.data.enabled ?? true);
                setAdmissionFeeSettings(result.data);
            } else {
                setAdmissionFeeEnabled(true);
            }
        } catch {
            setAdmissionFeeEnabled(true);
        }
    };

    const fetchApprovedIndexes = useCallback(async (branchId: string) => {
        if (!branchId) return;
        setIsLoadingIndexes(true);
        try {
            const result = await apiClient.get<any>(`/disbursements/approved-level2?branchId=${branchId}`);
            apiClient
                .get<{ requests: { indexId: string }[] }>(
                    `/first-due-date-change-requests?status=PENDING&branchId=${branchId}&pageSize=100`
                )
                .then((r) => setPendingDateChangeIndexIds(new Set(r.success ? (r.data?.requests ?? []).map((q) => q.indexId) : [])))
                .catch(() => setPendingDateChangeIndexIds(new Set()));
            if (result.success && result.data) {
                setApprovedIndexes(result.data.indexes || []);
            } else {
                setApprovedIndexes([]);
            }
        } catch {
            setApprovedIndexes([]);
        } finally {
            setIsLoadingIndexes(false);
        }
    }, []);

    const refreshMemberIndividualStatuses = useCallback(async (loans: BmLoanEntry[]) => {
        const results = await Promise.all(
            loans.map((loan) =>
                apiClient.get<{ isComplete: boolean }>(`/loans/${loan.id}/member-individual-status`)
                    .then((r) => ({ loanId: loan.id, completed: r.success ? (r.data?.isComplete ?? false) : false }))
                    .catch(() => ({ loanId: loan.id, completed: false }))
            )
        );
        const newMap: Record<string, boolean> = {};
        results.forEach((r) => { newMap[r.loanId] = r.completed; });
        setMemberIndividualMap(newMap);
        return newMap;
    }, []);

    const refreshGoldPhotos = useCallback(async (loans: BmLoanEntry[]) => {
        const goldLoans = loans.filter((l) => l.isGoldLoan);
        if (goldLoans.length === 0) {
            setGoldPhotosMap({});
            return;
        }
        const results = await Promise.all(
            goldLoans.map((loan) =>
                apiClient.get<{ photos: GoldLoanPhoto[] }>(`/loans/${loan.id}/gold-photos`)
                    .then((r) => ({ loanId: loan.id, photos: r.success ? (r.data?.photos ?? []) : [] }))
                    .catch(() => ({ loanId: loan.id, photos: [] as GoldLoanPhoto[] }))
            )
        );
        const newMap: Record<string, GoldLoanPhoto[]> = {};
        results.forEach((r) => { newMap[r.loanId] = r.photos; });
        setGoldPhotosMap(newMap);
    }, []);

    const handleRefreshMemberIndividual = async () => {
        if (!selectedIndex) return;
        setIsRefreshingMemberIndividual(true);
        try {
            const fresh = await refreshMemberIndividualStatuses(selectedIndex.loans);
            const stillPending = selectedIndex.loans.filter((l) => fresh[l.id] !== true);
            toast(
                stillPending.length === 0
                    ? { title: 'Member Individual Status Updated', description: 'All members are cleared for disbursement.' }
                    : { title: 'Member Individual Status Updated', description: `Still pending for: ${stillPending.map((l) => l.clientName).join(', ')}`, variant: 'destructive' }
            );
        } finally {
            setIsRefreshingMemberIndividual(false);
        }
    };

    const clearSelection = () => {
        setSelectedIndex(null);
        setAttendanceMap({});
        setAdmissionFeeMap({});
        setNewClientsMap({});
        setGoldMap({});
        setGoldPhotosMap({});
        setMemberIndividualMap({});
        setMemberFunderMap({});
        setFunderOverrides(new Set());
    };

    const handleBranchChange = (branchId: string) => {
        setSelectedBranchId(branchId);
        setCurrentPage(1);
        clearSelection();
        fetchApprovedIndexes(branchId);
    };

    const handleSendBackToAm = async () => {
        if (!confirmSendBack) return;
        setSendingBack(true);
        try {
            const res = await apiClient.post<{ sentBack: number; indexNo: string }>(
                '/disbursements/send-back-to-am',
                { indexId: confirmSendBack.id }
            );
            if (res.success && res.data) {
                toast({
                    title: 'Sent back to AM approval',
                    description: `Index #${res.data.indexNo}: ${res.data.sentBack} loan(s) moved back to the AM Level-2 queue.`,
                });
                if (selectedIndex?.id === confirmSendBack.id) clearSelection();
                setConfirmSendBack(null);
                if (selectedBranchId) fetchApprovedIndexes(selectedBranchId);
            } else {
                toast({ title: 'Cannot send back', description: res.error || 'Failed to send back to AM', variant: 'destructive' });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to send back to AM',
                variant: 'destructive',
            });
        } finally {
            setSendingBack(false);
        }
    };

    const handleRejectMember = async () => {
        if (!rejectingLoan) return;
        if (rejectReason.trim().length < 3) {
            toast({ title: 'Reason required', description: 'Enter a reason (at least 3 characters).', variant: 'destructive' });
            return;
        }
        setIsRejectingLoan(true);
        try {
            const result = await apiClient.post('/disbursements/reject-to-indexation', {
                loanId: rejectingLoan.id,
                stage: 'FINAL_DISBURSEMENT',
                reason: rejectReason.trim(),
            });
            if (result.success) {
                toast({ title: 'Member rejected', description: result.message || 'Sent back to Loan Indexation.' });
                // Drop just this loan from the open index so attendance / gold / funder
                // entries already made for the other members are kept.
                const rejected = rejectingLoan;
                if (selectedIndex) {
                    const remainingLoans = selectedIndex.loans.filter((l) => l.id !== rejected.id);
                    if (remainingLoans.length === 0) {
                        clearSelection();
                    } else {
                        setSelectedIndex({
                            ...selectedIndex,
                            loans: remainingLoans,
                            totalLoans: remainingLoans.length,
                            totalAmount: remainingLoans.reduce((sum, l) => sum + l.amount, 0),
                        });
                    }
                }
                setRejectingLoan(null);
                setRejectReason('');
                if (selectedBranchId) fetchApprovedIndexes(selectedBranchId);
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to reject member', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to reject member', variant: 'destructive' });
        } finally {
            setIsRejectingLoan(false);
        }
    };

    const selectIndex = async (idx: BmIndexGroup) => {
        if (!selectedFunderId) {
            toast({ title: 'Funder Required', description: 'Select a funder before selecting an index.', variant: 'destructive' });
            return;
        }
        clearSelection();
        setSelectedIndex(idx);
        setGoldMap({});

        const attMap: Record<string, 'PRESENT' | 'ABSENT'> = {};
        idx.loans.forEach((l) => { attMap[l.id] = 'PRESENT'; });
        setAttendanceMap(attMap);

        // Every member defaults to the bulk funder; none are overridden yet.
        const funderMap: Record<string, string> = {};
        idx.loans.forEach((l) => { funderMap[l.id] = selectedFunderId; });
        setMemberFunderMap(funderMap);
        setFunderOverrides(new Set());

        setIsLoadingDetails(true);
        try {
            // Member Individual must be completed before a member can be disbursed
            await refreshMemberIndividualStatuses(idx.loans);
            // Restore any gold-pledge photos already uploaded in a prior session
            await refreshGoldPhotos(idx.loans);

            if (admissionFeeEnabled) {
                const defaultFee = admissionFeeSettings?.defaultAmount ?? 50;
                const newFees: Record<string, number> = {};
                const newClients: Record<string, boolean> = {};
                for (const loan of idx.loans) {
                    const res = await apiClient.get<any>(`/clients/${loan.clientId}/is-new`);
                    if (res.success && res.data) {
                        newClients[loan.id] = res.data.isNew;
                        if (res.data.isNew) newFees[loan.id] = parseFloat(res.data.admissionFees) || defaultFee;
                    } else {
                        newClients[loan.id] = false;
                    }
                }
                setAdmissionFeeMap(newFees);
                setNewClientsMap(newClients);
            } else {
                setAdmissionFeeMap({});
                setNewClientsMap({});
            }
        } catch {
            // ignore — admission fee lookup failure shouldn't block disbursement
        } finally {
            setIsLoadingDetails(false);
        }
    };

    const updateGoldDetail = (loanId: string, field: keyof GoldLoanDetails, value: string | number, loanAmount?: number) => {
        setGoldMap((prev) => {
            const current = prev[loanId] ?? {};
            const updated = { ...current, [field]: value };
            if (loanAmount && loanAmount > 0) {
                if (field === 'goldTakenValue') {
                    const capped = Math.min(Number(value), loanAmount);
                    updated.goldTakenValue = capped;
                    updated.cashGiven = parseFloat((loanAmount - capped).toFixed(2));
                } else if (field === 'cashGiven') {
                    const capped = Math.min(Number(value), loanAmount);
                    updated.cashGiven = capped;
                    updated.goldTakenValue = parseFloat((loanAmount - capped).toFixed(2));
                }
            }
            return { ...prev, [loanId]: updated };
        });
    };

    const uploadGoldPhoto = async (loanId: string, file: File) => {
        setUploadingGoldPhotoFor(loanId);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            const result = await apiClient.post<{ id: string; photoUrl: string }>(
                `/loans/${loanId}/gold-photos`,
                formData
            );
            if (result.success && result.data) {
                setGoldPhotosMap((prev) => ({
                    ...prev,
                    [loanId]: [...(prev[loanId] ?? []), { id: result.data!.id, photoUrl: result.data!.photoUrl }],
                }));
            } else {
                toast({ title: 'Upload Failed', description: result.message || 'Could not upload gold photo', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Upload Failed', description: 'Could not upload gold photo', variant: 'destructive' });
        } finally {
            setUploadingGoldPhotoFor(null);
        }
    };

    const removeGoldPhoto = async (loanId: string, photoId: string) => {
        try {
            const result = await apiClient.delete(`/loans/${loanId}/gold-photos/${photoId}`);
            if (result.success) {
                setGoldPhotosMap((prev) => ({
                    ...prev,
                    [loanId]: (prev[loanId] ?? []).filter((p) => p.id !== photoId),
                }));
            }
        } catch {
            toast({ title: 'Delete Failed', description: 'Could not remove photo', variant: 'destructive' });
        }
    };

    // Bulk funder selector — fills the default for every member not yet
    // individually overridden; overridden rows are left untouched.
    const handleBulkFunderChange = (newFunderId: string) => {
        setSelectedFunderId(newFunderId);
        if (selectedIndex) {
            setMemberFunderMap((prev) => {
                const next = { ...prev };
                selectedIndex.loans.forEach((l) => {
                    if (!funderOverrides.has(l.id)) next[l.id] = newFunderId;
                });
                return next;
            });
        }
    };

    // Per-member funder override — changing one member's funder never affects others.
    const handleMemberFunderChange = (loanId: string, newFunderId: string) => {
        setMemberFunderMap((prev) => ({ ...prev, [loanId]: newFunderId }));
        setFunderOverrides((prev) => new Set(prev).add(loanId));
    };

    const setAttendanceForAll = (status: 'PRESENT' | 'ABSENT') => {
        if (!selectedIndex) return;
        const newMap: Record<string, 'PRESENT' | 'ABSENT'> = {};
        selectedIndex.loans.forEach((l) => { newMap[l.id] = status; });
        setAttendanceMap(newMap);
    };

    // ── Validation ────────────────────────────────────────────────────────────
    const allIndexLoans = selectedIndex?.loans ?? [];
    // Absent members are skipped: they are not paid, not validated, and stay in this index to be
    // disbursed on the day they come.
    const selectedLoans = allIndexLoans.filter((l) => attendanceMap[l.id] !== 'ABSENT');
    const absentCount = allIndexLoans.length - selectedLoans.length;
    const missingFirstDueDateLoans = selectedLoans.filter((l) => !l.firstDueDate);
    const firstDueDateValid = selectedLoans.length > 0 && missingFirstDueDateLoans.length === 0;
    const commonFirstDueDate = selectedLoans[0]?.firstDueDate ?? null;
    const allAttendanceSet = allIndexLoans.length > 0 && allIndexLoans.every((l) => attendanceMap[l.id] !== undefined);
    const allGoldFilled = selectedLoans
        .filter((l) => l.isGoldLoan)
        .every((l) => {
            const gd = goldMap[l.id];
            // cashGiven can legitimately be 0 (gold value alone covers the full loan
            // amount) — only require it to be a non-negative number, not truthy/positive.
            // Item Name / Reference Number / Remark are optional. At least one pledge
            // photo is required (anti-fraud control, mirrors the server-side gate).
            return gd?.karatType && gd?.gramCount && gd?.gramCount > 0 && gd?.goldTakenValue && gd?.goldTakenValue > 0
                && gd?.cashGiven !== undefined && gd.cashGiven >= 0
                && (goldPhotosMap[l.id]?.length ?? 0) > 0;
        });
    const notCompletedMemberIndividualLoans = selectedLoans.filter((l) => memberIndividualMap[l.id] !== true);
    const allMemberIndividualsCompleted = selectedLoans.length > 0 && !isLoadingDetails && notCompletedMemberIndividualLoans.length === 0;
    const canConfirmDisburse = firstDueDateValid && allAttendanceSet && allGoldFilled && allMemberIndividualsCompleted;

    // Pre-submit accounting summary — mirrors how the backend will aggregate
    // vouchers (one HO Borrow total, one voucher per distinct final funder,
    // one Processing Fees total, one Admission Fees total).
    const funderTotals = selectedLoans.reduce((acc, loan) => {
        const fId = memberFunderMap[loan.id] || selectedFunderId;
        if (!fId) return acc;
        acc[fId] = (acc[fId] || 0) + loan.amount;
        return acc;
    }, {} as Record<string, number>);
    const totalAdmissionFee = selectedLoans.reduce(
        (s, l) => s + (newClientsMap[l.id] ? (admissionFeeMap[l.id] || 0) : 0),
        0
    );
    const totalProcessingFee = selectedLoans.reduce((s, l) => s + (l.documentCharges || 0), 0);

    // Disburse button: warn first when a first-due-date change request is still pending for this index.
    const handleDisburse = async () => {
        if (!selectedIndex) return;
        let hasPending = pendingDateChangeIndexIds.has(selectedIndex.id);
        try {
            const r = await apiClient.get<{ totalCount: number }>(
                `/first-due-date-change-requests?status=PENDING&indexId=${selectedIndex.id}&pageSize=1`
            );
            if (r.success) hasPending = (r.data?.totalCount ?? 0) > 0;
        } catch {
            // fall back to the list loaded with the indexes
        }
        if (hasPending) {
            setConfirmPendingDateChange(true);
            return;
        }
        await performDisburse();
    };

    const performDisburse = async () => {
        if (!selectedIndex || !selectedFunderId) return;

        const disbursements = selectedLoans.map((loan) => {
            const entry: Record<string, unknown> = {
                loanId: loan.id,
                attendanceStatus: attendanceMap[loan.id],
                admissionFee: admissionFeeMap[loan.id] || 0,
                isNewClient: newClientsMap[loan.id] || false,
                funderId: memberFunderMap[loan.id] || selectedFunderId,
            };
            if (loan.isGoldLoan && goldMap[loan.id]) {
                entry.goldLoanDetails = goldMap[loan.id];
            }
            return entry;
        });

        setIsSubmitting(true);
        try {
            const result = await apiClient.post('/disbursements/bm-disburse', {
                centerId: selectedIndex.centerId,
                indexId: selectedIndex.id,
                funderId: selectedFunderId,
                disbursements,
            });

            if (result.success) {
                const funderName = funders.find((f) => f.id === selectedFunderId)?.funderName ?? '';
                toast({
                    title: 'Disbursed Successfully',
                    description: `${selectedLoans.length} loan(s) disbursed${funderName ? ` via ${funderName}` : ''} with first due date ${commonFirstDueDate}.`,
                });
                clearSelection();
                // Absent members remain in the index, so reload instead of dropping it from the list.
                if (selectedBranchId) fetchApprovedIndexes(selectedBranchId);
            } else {
                toast({ title: 'Disbursement Failed', description: result.error || 'Disbursement failed.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Disbursement failed. Please try again.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const selectedFunder = funders.find((f) => f.id === selectedFunderId);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(approvedIndexes);

    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    // ── Pagination ────────────────────────────────────────────────────────────
    const totalPages = Math.ceil(searchedRows.length / pageSize);
    const paginatedIndexes = searchedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    // ── RENDER ─────────────────────────────────────────────────────────────────

    if (isLoading) {
        return <PageLoader label="Loading..." fullScreen={false} />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
            {/* Page Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border/40">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-transparent">
                        Final Disbursement
                    </h1>
                    <p className="text-muted-foreground mt-2 text-base">
                        Select a branch, then disburse Area Manager-approved loans index by index.
                    </p>
                </div>
                <div className="hidden md:flex items-center gap-3">
                    <Badge variant="outline" className="text-sm py-1.5 px-4 h-9 rounded-full border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300">
                        {`${new Date().toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })}, ${toDisplayDate(new Date())}`}
                    </Badge>
                </div>
            </div>

            {/* Branch Selection */}
            <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-600 to-teal-500" />
                <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Filter className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        Filters
                    </CardTitle>
                    <CardDescription>Select a branch to view approved indexes.</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="p-5 rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/20 dark:bg-emerald-950/10">
                        <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <Filter className="h-3.5 w-3.5 text-emerald-600" />
                                Branch
                            </Label>
                            <Select value={selectedBranchId} onValueChange={handleBranchChange} disabled={isBranchManager}>
                                <SelectTrigger className="h-11 text-base shadow-sm border-muted-foreground/20 focus:ring-2 focus:ring-emerald-500/20">
                                    <SelectValue placeholder="Select branch..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id} className="cursor-pointer py-2">
                                            {branch.code} - {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border bg-gradient-to-br from-white to-slate-50 dark:from-brand-green-darker dark:to-green-950 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Approved Loans</span>
                        <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600">
                            <Users className="h-4 w-4" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold tracking-tight text-sidebar-accent dark:text-slate-100">
                        {isLoadingIndexes ? <Loader2 className="h-6 w-6 animate-spin" /> : approvedIndexes.reduce((s, i) => s + i.totalLoans, 0)}
                    </div>
                </div>
                <div className="p-5 rounded-2xl border bg-gradient-to-br from-white to-slate-50 dark:from-brand-green-darker dark:to-green-950 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Total Value</span>
                        <div className="h-8 w-8 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-teal-600">
                            <Banknote className="h-4 w-4" />
                        </div>
                    </div>
                    <div className="text-2xl font-bold tracking-tight text-sidebar-accent dark:text-slate-100">
                        {isLoadingIndexes
                            ? <Loader2 className="h-6 w-6 animate-spin" />
                            : `₹${new Intl.NumberFormat('en-IN', { maximumSignificantDigits: 3 }).format(approvedIndexes.reduce((s, i) => s + i.totalAmount, 0))}`}
                    </div>
                </div>
            </div>

            {/* ── Disbursement Section (inline, above table) ─────────────────── */}
            <Card className="border-border/60 shadow-lg overflow-hidden bg-card/50 backdrop-blur-sm relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-600 to-teal-500" />
                <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <CardTitle className="text-xl font-semibold flex items-center gap-2">
                                <SendHorizonal className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                Disbursement Section
                            </CardTitle>
                            <CardDescription>
                                {selectedIndex
                                    ? `Index #${selectedIndex.indexNo} · ${selectedIndex.centerName} · ${selectedIndex.totalLoans} loan(s)`
                                    : 'Select an index from the Approved Indexes table below.'}
                            </CardDescription>
                        </div>
                        {selectedIndex && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={clearSelection}
                                disabled={isSubmitting}
                                className="shrink-0"
                            >
                                <X className="h-4 w-4 mr-1" />
                                Clear Selection
                            </Button>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="p-6 space-y-6">
                    {/* Funder selector — mandatory, always visible */}
                    <div className="p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/20 dark:bg-emerald-950/10">
                        <div className="space-y-2">
                            <Label className="text-sm font-medium flex items-center gap-2">
                                <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                                Funder (Bulk / Default)
                                <span className="text-red-500">*</span>
                                <span className="text-xs text-muted-foreground font-normal">(required — can be overridden per member below)</span>
                            </Label>
                            <Select value={selectedFunderId} onValueChange={handleBulkFunderChange} disabled={fundersLoading}>
                                <SelectTrigger className={cn(
                                    "h-11 text-base shadow-sm focus:ring-2 focus:ring-emerald-500/20",
                                    !selectedFunderId ? "border-red-200 dark:border-red-900" : "border-muted-foreground/20"
                                )}>
                                    <SelectValue placeholder={fundersLoading ? 'Loading funders...' : 'Select Funder...'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {funders.length === 0 && !fundersLoading && (
                                        <SelectItem value="__none__" disabled>No funders available</SelectItem>
                                    )}
                                    {funders.map((f) => (
                                        <SelectItem key={f.id} value={f.id} className="cursor-pointer py-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs text-slate-500">{f.funderId}</span>
                                                <span className="font-medium">{f.funderName}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedFunder ? (
                                <p className="text-xs text-emerald-600 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" />
                                    {selectedFunder.funderName} selected
                                </p>
                            ) : (
                                <p className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    Funder must be selected before disbursing
                                </p>
                            )}
                        </div>
                    </div>

                    {!selectedIndex ? (
                        /* Placeholder */
                        <div className="flex flex-col items-center py-10 text-center gap-3">
                            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                                <SendHorizonal className="h-7 w-7 text-muted-foreground/40" />
                            </div>
                            <p className="text-sm text-muted-foreground max-w-xs">
                                Select a loan index from the <strong>Approved Indexes</strong> table below to view its details and perform disbursement.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Index summary */}
                            <div className="flex flex-wrap gap-5 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/10">
                                <div>
                                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Index No</span>
                                    <p className="font-semibold text-foreground">#{selectedIndex.indexNo}</p>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Date</span>
                                    <p className="text-foreground">{selectedIndex.indexDate}</p>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Center</span>
                                    <p className="text-foreground">{selectedIndex.centerName} <span className="text-muted-foreground text-xs">({selectedIndex.centerCode})</span></p>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Loans</span>
                                    <p className="text-foreground">{selectedIndex.totalLoans}</p>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Amount</span>
                                    <p className="font-semibold text-foreground">₹{new Intl.NumberFormat('en-IN').format(selectedIndex.totalAmount)}</p>
                                </div>
                                {selectedFunder && (
                                    <div>
                                        <span className="text-xs text-muted-foreground uppercase tracking-wide">Funder</span>
                                        <p className="font-medium text-emerald-600 dark:text-emerald-400">{selectedFunder.funderName}</p>
                                    </div>
                                )}
                            </div>

                            {/* Checking client status */}
                            {isLoadingDetails && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Checking client status...
                                </div>
                            )}

                            {/* First Due Date (read-only — set by BM on the Loan Index page) + Quick Attendance */}
                            <div className="grid md:grid-cols-2 gap-5 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium flex items-center gap-2">
                                        <CalendarDays className="h-4 w-4 text-emerald-600" />
                                        First Due Date
                                    </Label>
                                    {commonFirstDueDate ? (
                                        <p className="h-10 flex items-center text-base font-semibold text-emerald-700 dark:text-emerald-400">
                                            {commonFirstDueDate}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-red-600 flex items-center gap-1 h-10">
                                            <AlertCircle className="h-3 w-3" />
                                            Not set. Go to Loan Index and set the First Due Date for this batch.
                                        </p>
                                    )}
                                    {!firstDueDateValid && missingFirstDueDateLoans.length > 0 && (
                                        <p className="text-xs text-red-600 flex items-center gap-1">
                                            <AlertCircle className="h-3 w-3" />
                                            {missingFirstDueDateLoans.length} loan(s) are missing a first due date.
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Quick Attendance</Label>
                                    <div className="flex gap-3">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                            onClick={() => setAttendanceForAll('PRESENT')}
                                        >
                                            <UserCheck className="h-4 w-4 mr-1.5" />
                                            All Present
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="flex-1 border-amber-200 text-amber-700 hover:bg-amber-50"
                                            onClick={() => setAttendanceForAll('ABSENT')}
                                        >
                                            <UserX className="h-4 w-4 mr-1.5" />
                                            All Absent
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Loans table */}
                            <div className="border border-border/60 rounded-xl overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/20 sticky top-0 backdrop-blur-sm z-10">
                                        <TableRow>
                                            <TableHead className="w-[110px]">Client ID</TableHead>
                                            <TableHead>Client Name</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                            <TableHead>Frequency</TableHead>
                                            <TableHead className="w-[180px]">Funder</TableHead>
                                            {admissionFeeEnabled && <TableHead className="w-[140px]">Admission Fee</TableHead>}
                                            <TableHead className="w-[160px]">Attendance</TableHead>
                                            {canDisburse && <TableHead className="w-[70px] text-center">Reject</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {allIndexLoans.map((loan) => (
                                            <React.Fragment key={loan.id}>
                                                <TableRow className={cn(
                                                    "hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10",
                                                    !attendanceMap[loan.id] && "bg-amber-50/40 dark:bg-amber-900/10"
                                                )}>
                                                    <TableCell className="font-mono text-xs">{loan.clientId}</TableCell>
                                                    <TableCell className="font-medium">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span>{loan.clientName}</span>
                                                            {memberIndividualMap[loan.id] === false && (
                                                                <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500">
                                                                    <ShieldAlert className="h-3 w-3 shrink-0" />
                                                                    Member Individual pending
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">
                                                        ₹{new Intl.NumberFormat('en-IN').format(loan.amount)}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground capitalize">
                                                        {loan.frequency?.toLowerCase()}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Select
                                                            value={memberFunderMap[loan.id] || ''}
                                                            onValueChange={(val) => handleMemberFunderChange(loan.id, val)}
                                                        >
                                                            <SelectTrigger className={cn(
                                                                "h-8 text-xs",
                                                                funderOverrides.has(loan.id) && "border-emerald-300 text-emerald-700"
                                                            )}>
                                                                <SelectValue placeholder="Select funder..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {funders.map((f) => (
                                                                    <SelectItem key={f.id} value={f.id} className="text-xs">
                                                                        {f.funderName}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </TableCell>
                                                    {admissionFeeEnabled && (
                                                        <TableCell>
                                                            {newClientsMap[loan.id] ? (
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-xs bg-brand-green-tint text-sidebar-accent px-2 py-1 rounded whitespace-nowrap">New</span>
                                                                    <Input
                                                                        type="number"
                                                                        value={admissionFeeMap[loan.id] ?? 50}
                                                                        onChange={(e) =>
                                                                            setAdmissionFeeMap((prev) => ({
                                                                                ...prev,
                                                                                [loan.id]: parseInt(e.target.value) || 0,
                                                                            }))
                                                                        }
                                                                        className="h-8 w-20 text-xs"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">—</span>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                    <TableCell>
                                                        <Select
                                                            value={attendanceMap[loan.id] || ''}
                                                            onValueChange={(val) =>
                                                                setAttendanceMap((prev) => ({
                                                                    ...prev,
                                                                    [loan.id]: val as 'PRESENT' | 'ABSENT',
                                                                }))
                                                            }
                                                        >
                                                            <SelectTrigger className={cn(
                                                                "h-8 text-xs",
                                                                attendanceMap[loan.id] === 'PRESENT' && "border-emerald-300 text-emerald-700",
                                                                attendanceMap[loan.id] === 'ABSENT' && "border-amber-300 text-amber-700",
                                                                !attendanceMap[loan.id] && "border-red-200 text-red-500"
                                                            )}>
                                                                <SelectValue placeholder="Select..." />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="PRESENT">
                                                                    <span className="flex items-center gap-1.5 text-emerald-700">
                                                                        <UserCheck className="h-3.5 w-3.5" />
                                                                        Present
                                                                    </span>
                                                                </SelectItem>
                                                                <SelectItem value="ABSENT">
                                                                    <span className="flex items-center gap-1.5 text-amber-700">
                                                                        <UserX className="h-3.5 w-3.5" />
                                                                        Absent
                                                                    </span>
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </TableCell>
                                                    {canDisburse && (
                                                        <TableCell className="text-center">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                                                                onClick={() => {
                                                                    setRejectReason('');
                                                                    setRejectingLoan(loan);
                                                                }}
                                                                title="Reject this member and send back to Loan Indexation"
                                                            >
                                                                <ShieldX className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </TableCell>
                                                    )}
                                                </TableRow>

                                                {/* Gold loan details row */}
                                                {loan.isGoldLoan && attendanceMap[loan.id] !== 'ABSENT' && (
                                                    <TableRow className="bg-yellow-50/60 dark:bg-yellow-900/10">
                                                        <TableCell colSpan={(admissionFeeEnabled ? 7 : 6) + (canDisburse ? 1 : 0)} className="py-3 px-4">
                                                            <div className="flex flex-wrap gap-3 items-end">
                                                                <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mr-2">Gold Details:</span>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Karat Type</Label>
                                                                    <Select
                                                                        value={goldMap[loan.id]?.karatType ?? ''}
                                                                        onValueChange={(v) => updateGoldDetail(loan.id, 'karatType', v)}
                                                                    >
                                                                        <SelectTrigger className="h-8 w-24 text-xs">
                                                                            <SelectValue placeholder="Karat" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {['24K', '22K', '20K', '18K', '16K'].map((k) => (
                                                                                <SelectItem key={k} value={k}>{k}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Gram Count</Label>
                                                                    <Input
                                                                        type="number" min="0.001" step="0.001" placeholder="0.000"
                                                                        className="h-8 w-28 text-xs"
                                                                        value={goldMap[loan.id]?.gramCount ?? ''}
                                                                        onChange={(e) => updateGoldDetail(loan.id, 'gramCount', Number(e.target.value))}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Gold Value (₹)</Label>
                                                                    <Input
                                                                        type="number" min="0.01" step="0.01" placeholder="0.00"
                                                                        className="h-8 w-32 text-xs"
                                                                        value={goldMap[loan.id]?.goldTakenValue ?? ''}
                                                                        onChange={(e) => updateGoldDetail(loan.id, 'goldTakenValue', Number(e.target.value), loan.amount)}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Cash Given (₹)</Label>
                                                                    <Input
                                                                        type="number" min="0" step="0.01" placeholder="0.00"
                                                                        className="h-8 w-32 text-xs"
                                                                        value={goldMap[loan.id]?.cashGiven ?? ''}
                                                                        onChange={(e) => updateGoldDetail(loan.id, 'cashGiven', Number(e.target.value), loan.amount)}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Item Name (optional)</Label>
                                                                    <Input
                                                                        type="text" placeholder="e.g. Gold Chain"
                                                                        className="h-8 w-36 text-xs"
                                                                        value={goldMap[loan.id]?.itemDescription ?? ''}
                                                                        onChange={(e) => updateGoldDetail(loan.id, 'itemDescription', e.target.value)}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Reference No. (optional)</Label>
                                                                    <Input
                                                                        type="text" placeholder="Token / ref no."
                                                                        className="h-8 w-32 text-xs"
                                                                        value={goldMap[loan.id]?.goldTokenNo ?? ''}
                                                                        onChange={(e) => updateGoldDetail(loan.id, 'goldTokenNo', e.target.value)}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs text-slate-500">Remark (optional)</Label>
                                                                    <Input
                                                                        type="text" placeholder="Remark"
                                                                        className="h-8 w-40 text-xs"
                                                                        value={goldMap[loan.id]?.remarks ?? ''}
                                                                        onChange={(e) => updateGoldDetail(loan.id, 'remarks', e.target.value)}
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2 items-center mt-3">
                                                                <Label className="text-xs text-slate-500">
                                                                    Gold Photos <span className="text-red-500">*</span>
                                                                </Label>
                                                                <input
                                                                    type="file"
                                                                    accept="image/*"
                                                                    multiple
                                                                    id={`gold-photo-input-${loan.id}`}
                                                                    className="hidden"
                                                                    onChange={(e) => {
                                                                        const files = e.target.files;
                                                                        if (files) {
                                                                            Array.from(files).forEach((f) => uploadGoldPhoto(loan.id, f));
                                                                        }
                                                                        e.target.value = '';
                                                                    }}
                                                                />
                                                                <label
                                                                    htmlFor={`gold-photo-input-${loan.id}`}
                                                                    className={cn(
                                                                        "h-7 px-2.5 inline-flex items-center gap-1 rounded-md border text-xs cursor-pointer",
                                                                        "border-yellow-300 bg-white hover:bg-yellow-50 text-yellow-800 dark:bg-transparent dark:hover:bg-yellow-900/20"
                                                                    )}
                                                                >
                                                                    {uploadingGoldPhotoFor === loan.id ? (
                                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                                    ) : null}
                                                                    Upload Photo
                                                                </label>
                                                                {(goldPhotosMap[loan.id]?.length ?? 0) > 0 ? (
                                                                    <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                                                                        {goldPhotosMap[loan.id]!.length} photo{goldPhotosMap[loan.id]!.length > 1 ? 's' : ''} uploaded
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-red-500">No photos yet</span>
                                                                )}
                                                                {(goldPhotosMap[loan.id] ?? []).map((p) => (
                                                                    <span
                                                                        key={p.id}
                                                                        className="inline-flex items-center gap-1 text-xs bg-white dark:bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5"
                                                                    >
                                                                        Photo
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removeGoldPhoto(loan.id, p.id)}
                                                                            className="text-slate-400 hover:text-red-500"
                                                                        >
                                                                            <X className="h-3 w-3" />
                                                                        </button>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Validation hints */}
                            {!canConfirmDisburse && (
                                <div className="flex flex-col gap-1.5 p-4 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10">
                                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        Before disbursing, please ensure:
                                    </p>
                                    <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 ml-5 list-disc">
                                        {!firstDueDateValid && <li>All loans in this index must have a First Due Date set on the Loan Index page</li>}
                                        {!allAttendanceSet && <li>Attendance must be set for all {allIndexLoans.length} loan(s)</li>}
                                        {allIndexLoans.length > 0 && selectedLoans.length === 0 && <li>At least one member must be Present to disburse</li>}
                                        {!allGoldFilled && <li>Gold loan details (karat, gram count, values) and at least one pledge photo must be provided for all gold loans</li>}
                                        {!allMemberIndividualsCompleted && (
                                            <li className="flex items-center gap-2">
                                                <span>
                                                    {isLoadingDetails
                                                        ? 'Checking Member Individual status...'
                                                        : `Member Individual must be completed for: ${notCompletedMemberIndividualLoans.map((l) => l.clientName).join(', ')}`}
                                                </span>
                                                {!isLoadingDetails && (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-6 px-2 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300"
                                                        disabled={isRefreshingMemberIndividual}
                                                        onClick={handleRefreshMemberIndividual}
                                                    >
                                                        {isRefreshingMemberIndividual
                                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                                            : 'Refresh Status'}
                                                    </Button>
                                                )}
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}

                            {/* Accounting summary — shows the aggregated vouchers this
                                disbursement will produce before the BM confirms. */}
                            <div className="p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/20 dark:bg-emerald-950/10">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                                    Accounting Summary (Bulk Vouchers)
                                </p>
                                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                                    {Object.entries(funderTotals).map(([fId, total]) => {
                                        const fName = funders.find((f) => f.id === fId)?.funderName ?? 'Unknown Funder';
                                        return (
                                            <div key={fId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/60 border border-border/40">
                                                <span className="text-muted-foreground">{fName}</span>
                                                <span className="font-semibold text-foreground">₹{new Intl.NumberFormat('en-IN').format(total)}</span>
                                            </div>
                                        );
                                    })}
                                    {totalAdmissionFee > 0 && (
                                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/60 border border-border/40">
                                            <span className="text-muted-foreground">Admission Fees</span>
                                            <span className="font-semibold text-foreground">₹{new Intl.NumberFormat('en-IN').format(totalAdmissionFee)}</span>
                                        </div>
                                    )}
                                    {totalProcessingFee > 0 && (
                                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/60 border border-border/40">
                                            <span className="text-muted-foreground">Processing Fees</span>
                                            <span className="font-semibold text-foreground">₹{new Intl.NumberFormat('en-IN').format(totalProcessingFee)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Action row */}
                            <div className="flex items-center justify-between pt-2 border-t border-dashed">
                                <div className="text-sm text-muted-foreground">
                                    <span className="font-semibold text-foreground">{selectedLoans.length}</span> loans ·{' '}
                                    <span className="font-semibold text-foreground">
                                        ₹{new Intl.NumberFormat('en-IN').format(selectedLoans.reduce((sum, l) => sum + l.amount, 0))}
                                    </span>
                                    {absentCount > 0 && (
                                        <span className="ml-2 text-amber-600">· {absentCount} absent — stays pending for a later date</span>
                                    )}
                                </div>
                                <Button
                                    disabled={!canConfirmDisburse || isSubmitting}
                                    onClick={handleDisburse}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[180px] shadow-lg shadow-emerald-600/20"
                                >
                                    {isSubmitting
                                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                    Disburse {selectedLoans.length} Loan{selectedLoans.length !== 1 ? 's' : ''}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Approved Indexes Table ─────────────────────────────────────── */}
            <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-600 to-teal-500" />
                <CardHeader className="pb-4 border-b border-border/40 bg-muted/10">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <CardTitle className="text-lg font-semibold tracking-tight">Approved Indexes</CardTitle>
                        <div className="flex flex-wrap items-center gap-3">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search indexes..."
                            />
                            {approvedIndexes.length > 0 && (
                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                    {searchedRows.length} Index{searchedRows.length !== 1 ? 'es' : ''}
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {/* Loading */}
                    {isLoadingIndexes && (
                        <PageLoader label="Loading approved loans..." fullScreen={false} />
                    )}

                    {/* No branch selected */}
                    {!isLoadingIndexes && !selectedBranchId && (
                        <div className="flex flex-col items-center justify-center py-10 text-center gap-2 px-6">
                            <Filter className="h-8 w-8 text-muted-foreground/50" />
                            <p className="text-sm text-muted-foreground">Select a branch to view approved loans.</p>
                        </div>
                    )}

                    {/* Empty state */}
                    {!isLoadingIndexes && selectedBranchId && searchedRows.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-center gap-3 px-6">
                            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <p className="text-sm text-muted-foreground">No loans are awaiting final disbursement for this branch.</p>
                        </div>
                    )}

                    {/* Index table */}
                    {!isLoadingIndexes && searchedRows.length > 0 && (
                        <>
                            <Table>
                                <TableHeader className="bg-muted/30">
                                    <TableRow>
                                        <TableHead>Index No</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Center</TableHead>
                                        <TableHead className="text-center">Loans</TableHead>
                                        <TableHead className="text-right">Total Amount</TableHead>
                                        <TableHead className="text-center w-[160px]">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedIndexes.map((idx) => (
                                        <TableRow
                                            key={idx.id}
                                            className={cn(
                                                "hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10",
                                                selectedIndex?.id === idx.id && "bg-emerald-50/60 dark:bg-emerald-900/20"
                                            )}
                                        >
                                            <TableCell className="font-semibold">#{idx.indexNo}</TableCell>
                                            <TableCell className="text-sm text-muted-foreground">{idx.indexDate}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-sm">{idx.centerName}</span>
                                                    <span className="text-xs text-muted-foreground">{idx.centerCode}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant="secondary" className="text-xs">{idx.totalLoans}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                ₹{new Intl.NumberFormat('en-IN').format(idx.totalAmount)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center gap-1.5">
                                                    {canDisburse && (
                                                        <Button
                                                            size="sm"
                                                            variant={selectedIndex?.id === idx.id ? 'secondary' : 'default'}
                                                            onClick={() => selectIndex(idx)}
                                                            disabled={!selectedFunderId || selectedIndex?.id === idx.id}
                                                            className={cn(
                                                                "h-8 text-xs w-full",
                                                                selectedIndex?.id !== idx.id && "bg-emerald-600 hover:bg-emerald-700 text-white"
                                                            )}
                                                        >
                                                            {selectedIndex?.id === idx.id ? (
                                                                <>
                                                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                                                                    Selected
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <SendHorizonal className="h-3.5 w-3.5 mr-1" />
                                                                    Select
                                                                </>
                                                            )}
                                                        </Button>
                                                    )}
                                                    {(isBranchManager || isAdmin || !!tokenStorage.getUser()?.isSubAdmin) && (
                                                        <FirstDueDateChangeRequestButton
                                                            indexId={idx.id}
                                                            indexNo={idx.indexNo}
                                                            currentFirstDueDate={idx.loans[0]?.firstDueDate ?? null}
                                                            isPending={pendingDateChangeIndexIds.has(idx.id)}
                                                            onRaised={() => fetchApprovedIndexes(selectedBranchId)}
                                                        />
                                                    )}
                                                    {isAdmin && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => setConfirmSendBack(idx)}
                                                            disabled={sendingBack}
                                                            title="Move this index's loans back to the AM Level-2 approval queue (e.g. to fix a wrong loan product before disbursement)"
                                                            className="h-7 text-[11px] w-full border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                                                        >
                                                            <Undo2 className="h-3.5 w-3.5 mr-1" />
                                                            Send back to AM
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            {/* Funder hint */}
                            {!selectedFunderId && (
                                <div className="px-4 py-2 border-t">
                                    <p className="text-xs text-amber-600 flex items-center gap-1.5">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        Select a funder in the Disbursement section above to enable the Select button.
                                    </p>
                                </div>
                            )}

                            {/* Pagination */}
                            {searchedRows.length > 0 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                                    <span className="text-sm text-muted-foreground">
                                        Showing {Math.min((currentPage - 1) * pageSize + 1, searchedRows.length)}–{Math.min(currentPage * pageSize, searchedRows.length)} of {searchedRows.length}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage((p) => p - 1)}
                                            disabled={currentPage === 1}
                                            className="h-8 px-3"
                                        >
                                            <ChevronLeft className="h-4 w-4 mr-1" />
                                            Prev
                                        </Button>
                                        <span className="text-sm text-muted-foreground">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setCurrentPage((p) => p + 1)}
                                            disabled={currentPage === totalPages}
                                            className="h-8 px-3"
                                        >
                                            Next
                                            <ChevronRight className="h-4 w-4 ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <ConfirmationDialog
                open={confirmPendingDateChange}
                onOpenChange={(open) => { if (!open) setConfirmPendingDateChange(false); }}
                onConfirm={() => {
                    setConfirmPendingDateChange(false);
                    void performDisburse();
                }}
                title="First due date change is pending"
                description={
                    selectedIndex
                        ? `Index #${selectedIndex.indexNo} has a first due date change request waiting for Admin approval. ` +
                          `If you disburse now, the schedule is built with the current first due date (${commonFirstDueDate ?? 'not set'}) ` +
                          `and the pending request can no longer be applied. Do you want to proceed with the disbursement anyway?`
                        : ''
                }
                confirmText="Proceed with disbursement"
                cancelText="Cancel"
                type="warning"
            />

            <Dialog
                open={!!rejectingLoan}
                onOpenChange={(open) => {
                    if (!open && !isRejectingLoan) {
                        setRejectingLoan(null);
                        setRejectReason('');
                    }
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                            <ShieldX className="h-5 w-5" />
                            Reject Member
                        </DialogTitle>
                        <DialogDescription>
                            {rejectingLoan && (
                                <>
                                    <span className="font-medium text-foreground">
                                        {rejectingLoan.clientId} — {rejectingLoan.clientName}
                                    </span>{' '}
                                    (₹{new Intl.NumberFormat('en-IN').format(rejectingLoan.amount)}) will be removed from
                                    index {selectedIndex?.indexNo} and sent back to Loan Indexation, clearing its AM approval.
                                    The other members in this index can still be disbursed.
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="final-member-reject-reason">Reason</Label>
                        <Textarea
                            id="final-member-reject-reason"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Why is this member being rejected?"
                            rows={3}
                            disabled={isRejectingLoan}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => { setRejectingLoan(null); setRejectReason(''); }}
                            disabled={isRejectingLoan}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleRejectMember}
                            disabled={isRejectingLoan || rejectReason.trim().length < 3}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isRejectingLoan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldX className="mr-2 h-4 w-4" />}
                            Reject &amp; Send to Indexation
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmationDialog
                open={!!confirmSendBack}
                onOpenChange={(open) => { if (!open) setConfirmSendBack(null); }}
                onConfirm={handleSendBackToAm}
                title="Send back to AM approval?"
                description={
                    confirmSendBack
                        ? `Index #${confirmSendBack.indexNo} · ${confirmSendBack.centerName} · ${confirmSendBack.totalLoans} loan(s). ` +
                          `This moves the loan(s) from Final Disbursement back to the AM Level-2 approval queue and clears the AM approval stamp, so the product can be corrected in Member Individual → Loan Appraisal and re-approved. ` +
                          `It is refused if any loan is already disbursed or has a payment.`
                        : ''
                }
                confirmText="Send back to AM"
                cancelText="Cancel"
                type="warning"
                isLoading={sendingBack}
            />
        </div>
    );
}
