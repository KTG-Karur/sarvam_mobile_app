'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    CreditCard,
    Users,
    Building2,
    IndianRupee,
    CalendarDays,
    ListChecks,
    AlertCircle,
    Loader2,
    Save,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { useEnrollmentValidation } from '@/hooks/useEnrollmentValidation';
import { LOAN_FEES } from '@/app/lib/config';
import type { LoanInfo } from '@/components/client/LoanInfoDialog';

// Duplicated verbatim from ClientEnrollmentForm.tsx / first-loan.service.ts —
// this codebase intentionally keeps this tiny helper local to each consumer
// rather than sharing a module (see plan notes).
function computeTenureMonths(numberOfDues: number, frequency: string): number {
    const freq = (frequency || '').toLowerCase();
    if (freq === 'weekly') return Math.ceil(numberOfDues / 4.33);
    if (freq === 'forthnight') return Math.ceil(numberOfDues / 2.17);
    if (freq === 'daily') return Math.ceil(numberOfDues / 30);
    if (freq === 'quarterly') return numberOfDues * 3;
    return numberOfDues;
}

type LoanProductOption = {
    id: string; productName: string; loanAmount: number; frequency: string; loanProductTypeId: string;
    insuranceFees?: number | null; numberOfDues?: number; documentCharges?: number | null;
};

interface LoanDetailsUpdateFormProps {
    selectedClient: string;
    // Loosely-typed API response object, same as KYCDetailsFlatForm's clientData prop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentClient: any;
    onSuccess?: () => void;
}

export function LoanDetailsUpdateForm({ selectedClient, currentClient, onSuccess }: LoanDetailsUpdateFormProps) {
    const { toast } = useToast();
    const { isRequired: configIsRequired } = useEnrollmentValidation();
    const isFieldRequired = (fieldKey: string, defaultRequired: boolean = false): boolean => configIsRequired(fieldKey, defaultRequired);
    const renderRequiredIndicator = (fieldKey: string) =>
        isFieldRequired(fieldKey) ? <span className="text-red-500">*</span> : <span className="text-slate-400 text-xs">(Optional)</span>;

    // ── Lock behavior — mirrors KYCDetailsFlatForm's isLocked verbatim, plus a
    // narrower additional rule: Admin/Sub Admin's usual bypass of the APPROVED
    // lock does NOT apply to these 5 loan fields (server-enforced too, see
    // app/api/clients/[clientId]/route.ts). ──────────────────────────────────
    const currentUser = tokenStorage.getUser();
    const isAdminOrSubAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || !!currentUser?.isSubAdmin;
    const isBranchManager = currentUser?.role === 'BRANCH_MANAGER';
    const isFdo = currentUser?.role === 'FDO';
    const [allowFdoEditApproved, setAllowFdoEditApproved] = useState(true);
    const [allowBmEditApproved, setAllowBmEditApproved] = useState(true);
    useEffect(() => {
        if (!isFdo) return;
        apiClient.get<{ enabled: boolean }>('/settings/fdo-approved-client-edit')
            .then((res) => { if (res.success && res.data) setAllowFdoEditApproved(res.data.enabled); })
            .catch(() => { /* keep default (true) */ });
    }, [isFdo]);
    useEffect(() => {
        if (!isBranchManager) return;
        apiClient.get<{ enabled: boolean }>('/settings/bm-approved-client-edit')
            .then((res) => { if (res.success && res.data) setAllowBmEditApproved(res.data.enabled); })
            .catch(() => { /* keep default (true) */ });
    }, [isBranchManager]);
    const isApproved = currentClient?.approvalStatus === 'APPROVED';
    const isLocked = isApproved && !isAdminOrSubAdmin
        && !(isBranchManager && allowBmEditApproved) && !(isFdo && allowFdoEditApproved);
    // New rule: even the Admin/Sub Admin exemption above closes for these 5
    // fields once the client is APPROVED.
    const isAdminLoanLocked = isAdminOrSubAdmin && isApproved;
    const isLoanCardLocked = isLocked || isAdminLoanLocked;

    // ── Requested loan card state ───────────────────────────────────────────
    const [loanProductTypes, setLoanProductTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [allLoanProducts, setAllLoanProducts] = useState<LoanProductOption[]>([]);
    const [loanPurposeTypes, setLoanPurposeTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [loanPurposes, setLoanPurposes] = useState<Array<{ id: string; name: string; loanPurposeTypeId: string }>>([]);
    const [isLoadingLoanPurposes, setIsLoadingLoanPurposes] = useState(false);
    const [isSavingLoan, setIsSavingLoan] = useState(false);

    const [requestedLoanProductTypeId, setRequestedLoanProductTypeId] = useState(currentClient?.requestedLoanProductTypeId || '');
    const [requestedLoanFrequency, setRequestedLoanFrequency] = useState(currentClient?.requestedLoanFrequency || 'weekly');
    const [requestedLoanProductId, setRequestedLoanProductId] = useState(currentClient?.requestedLoanProductId || '');
    const [requestedLoanPurposeTypeId, setRequestedLoanPurposeTypeId] = useState(currentClient?.requestedLoanPurposeTypeId || '');
    const [requestedLoanPurposeId, setRequestedLoanPurposeId] = useState(currentClient?.requestedLoanPurposeId || '');

    useEffect(() => {
        setRequestedLoanProductTypeId(currentClient?.requestedLoanProductTypeId || '');
        setRequestedLoanFrequency(currentClient?.requestedLoanFrequency || 'weekly');
        setRequestedLoanProductId(currentClient?.requestedLoanProductId || '');
        setRequestedLoanPurposeTypeId(currentClient?.requestedLoanPurposeTypeId || '');
        setRequestedLoanPurposeId(currentClient?.requestedLoanPurposeId || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentClient?.clientId]);

    // Prefer the actual assigned center's branch; while still unassigned, use the
    // REQUESTED center's branch (Loan Details tab selection) rather than the
    // enroller's own branch, which may differ (e.g. an HO Admin enrolling on an
    // FDO's behalf) — falls back to the viewer's own branch only as a last resort.
    const branchId: string = currentClient?.center?.branchId ?? currentClient?.requestedCenter?.branchId ?? currentClient?.enrolledBy?.branchId ?? tokenStorage.getUser()?.branchId ?? '';

    useEffect(() => {
        apiClient.get<Array<{ id: string; name: string }>>('/loan-product-types?includeInactive=false')
            .then((res) => { if (res.success && res.data) setLoanProductTypes(res.data); })
            .catch(() => { /* ignore */ });
        apiClient.get<Array<{ id: string; name: string }>>('/loan-purpose-types?includeInactive=false')
            .then((res) => { if (res.success && res.data) setLoanPurposeTypes(res.data); })
            .catch(() => { /* ignore */ });
    }, []);

    useEffect(() => {
        if (!branchId) return;
        // The /products response shape varies by caller (bare array or { products: [...] });
        // same ambiguity CoApplicantForm.tsx already handles the same way.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiClient.get<any>(`/products?branchId=${branchId}`)
            .then((res) => {
                if (res.success && res.data) {
                    const list = Array.isArray(res.data) ? res.data : (res.data.products || []);
                    setAllLoanProducts(list);
                }
            })
            .catch(() => { /* ignore */ });
    }, [branchId]);

    const fetchLoanPurposes = useCallback(async (purposeTypeId: string) => {
        if (!purposeTypeId) { setLoanPurposes([]); return; }
        setIsLoadingLoanPurposes(true);
        try {
            const res = await apiClient.get<Array<{ id: string; name: string; loanPurposeTypeId: string }>>(
                `/loan-purposes?purposeTypeId=${purposeTypeId}&includeInactive=false`
            );
            if (res.success && res.data) setLoanPurposes(res.data);
        } catch { /* ignore */ } finally {
            setIsLoadingLoanPurposes(false);
        }
    }, []);

    // Restore the dependent Loan Purpose options for an already-saved purpose type.
    useEffect(() => {
        if (currentClient?.requestedLoanPurposeTypeId) {
            fetchLoanPurposes(currentClient.requestedLoanPurposeTypeId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentClient?.clientId, currentClient?.requestedLoanPurposeTypeId]);

    const filteredLoanProducts = useMemo(() => {
        let products = allLoanProducts;
        if (requestedLoanProductTypeId) products = products.filter((p) => p.loanProductTypeId === requestedLoanProductTypeId);
        if (requestedLoanFrequency) products = products.filter((p) => (p.frequency || '').toLowerCase() === requestedLoanFrequency.toLowerCase());
        return products;
    }, [allLoanProducts, requestedLoanProductTypeId, requestedLoanFrequency]);

    const selectedLoanProduct = useMemo(
        () => allLoanProducts.find((p) => p.id === requestedLoanProductId),
        [allLoanProducts, requestedLoanProductId]
    );
    const tenureMonths = selectedLoanProduct?.numberOfDues != null
        ? computeTenureMonths(selectedLoanProduct.numberOfDues, selectedLoanProduct.frequency)
        : null;

    const handleSaveLoanDetails = async () => {
        setIsSavingLoan(true);
        try {
            const res = await apiClient.patch(`/clients/${selectedClient}`, {
                requestedLoanProductTypeId: requestedLoanProductTypeId || null,
                requestedLoanFrequency: requestedLoanFrequency || null,
                requestedLoanProductId: requestedLoanProductId || null,
                requestedLoanPurposeTypeId: requestedLoanPurposeTypeId || null,
                requestedLoanPurposeId: requestedLoanPurposeId || null,
            });
            if (res.success) {
                toast({ title: 'Saved', description: 'Requested loan details updated.' });
                onSuccess?.();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save loan details', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' });
        } finally {
            setIsSavingLoan(false);
        }
    };

    // ── Group Status / Center / Group card ──────────────────────────────────
    const hasCenterAssigned = !!currentClient?.centerId;
    const [fdoCenters, setFdoCenters] = useState<Array<{ id: string; name: string; code: string; clientCount: number }>>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [requestedGroups, setRequestedGroups] = useState<Array<{ id: string; name: string; memberCount: number; maxMembersPerGroup: number }>>([]);
    const [isLoadingGroups, setIsLoadingGroups] = useState(false);
    const [isSavingGroup, setIsSavingGroup] = useState(false);

    const [memberGroupStatus, setMemberGroupStatus] = useState(currentClient?.memberGroupStatus || '');
    const [requestedCenterId, setRequestedCenterId] = useState(currentClient?.requestedCenterId || '');
    const [requestedGroupId, setRequestedGroupId] = useState(currentClient?.requestedGroupId || '');

    useEffect(() => {
        setMemberGroupStatus(currentClient?.memberGroupStatus || '');
        setRequestedCenterId(currentClient?.requestedCenterId || '');
        setRequestedGroupId(currentClient?.requestedGroupId || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentClient?.clientId]);

    const fetchRequestedGroups = useCallback(async (centerId: string) => {
        if (!centerId) { setRequestedGroups([]); return; }
        setIsLoadingGroups(true);
        try {
            const res = await apiClient.get<Array<{ id: string; name: string; memberCount: number; maxMembersPerGroup: number }>>(
                `/groups?centerId=${centerId}&includeInactive=false&availableOnly=true`
            );
            if (res.success && res.data) setRequestedGroups(res.data);
        } catch { /* ignore */ } finally {
            setIsLoadingGroups(false);
        }
    }, []);

    // Only fetch center/group options when the editable form is actually shown
    // (unassigned AND not approved — see render logic below).
    useEffect(() => {
        if (hasCenterAssigned || isApproved) return;
        setIsLoadingCenters(true);
        apiClient.get<Array<{ id: string; name: string; code: string; clientCount: number }>>('/centers?status=APPROVED&includeInactive=false')
            .then((res) => { if (res.success && res.data) setFdoCenters(res.data); })
            .catch(() => { /* ignore */ })
            .finally(() => setIsLoadingCenters(false));
    }, [hasCenterAssigned, isApproved]);

    useEffect(() => {
        if (hasCenterAssigned || isApproved) return;
        if (currentClient?.requestedCenterId) fetchRequestedGroups(currentClient.requestedCenterId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasCenterAssigned, isApproved, currentClient?.clientId, currentClient?.requestedCenterId]);

    const handleSaveGroupRequest = async () => {
        setIsSavingGroup(true);
        try {
            const res = await apiClient.patch(`/clients/${selectedClient}`, {
                memberGroupStatus: memberGroupStatus || null,
                requestedCenterId: requestedCenterId || null,
                requestedGroupId: requestedGroupId || null,
            });
            if (res.success) {
                toast({ title: 'Saved', description: 'Group request updated.' });
                onSuccess?.();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save group request', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' });
        } finally {
            setIsSavingGroup(false);
        }
    };

    // ── Actual Loan(s) — read-only, sourced from the real Loan records ──────
    const [loans, setLoans] = useState<LoanInfo[]>([]);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);

    useEffect(() => {
        if (!selectedClient) return;
        setIsLoadingLoans(true);
        apiClient.get<{ clientId: string; loans: LoanInfo[] }>(`/clients/${selectedClient}/loans`)
            .then((res) => { if (res.success && res.data) setLoans(res.data.loans || []); })
            .catch(() => { /* ignore */ })
            .finally(() => setIsLoadingLoans(false));
    }, [selectedClient]);

    return (
        <div className="space-y-6">
            {/* Actual/Ongoing Loan(s) — read-only, never locked. Always shown so it
                also surfaces loan history pre-approval, but this is specifically
                what carries the "ongoing loan" info once the client is APPROVED
                and the Requested Loan card below locks. */}
            <Card className="border-primary/20 shadow-md dark:border-sidebar-accent">
                <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <ListChecks className="h-5 w-5 text-primary" />{isApproved ? 'Ongoing Loan' : 'Actual Loan(s)'}
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                        {isApproved
                            ? "This client is approved — showing their ongoing (approved/active) loan below, read-only."
                            : 'Real approved/active loans for this client — read-only.'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                    {isLoadingLoans ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading loans...</div>
                    ) : loans.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {isApproved ? 'No ongoing loan for this client yet.' : 'No approved/active loans for this client yet.'}
                        </p>
                    ) : (
                        <div className="space-y-4">
                            {loans.map((loan) => (
                                <div key={loan.id} className="grid min-w-0 gap-4 rounded-xl border border-primary/20 dark:border-sidebar-accent p-4 md:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            <CreditCard className="h-3.5 w-3.5" />{loan.loanAccount}
                                        </p>
                                        <p className="flex items-center gap-1 text-base font-semibold text-emerald-700 dark:text-emerald-400">
                                            <IndianRupee className="h-4 w-4" />{loan.loanAmount.toLocaleString('en-IN')}
                                        </p>
                                        <p className="text-xs text-slate-600 dark:text-slate-300">
                                            Dues: <span className="font-semibold">{loan.completedDues}/{loan.totalDues}</span> · Collected {loan.collectedDues}
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-xs text-slate-600 dark:text-slate-300">
                                        <div className="space-y-1">
                                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Dates</p>
                                            <p className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Disb: {loan.disbursementDate}</p>
                                            <p className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Due Start: {loan.dueStartDate}</p>
                                            <p className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Maturity: {loan.maturityDate}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Balances</p>
                                            <p>Pri. Bal: {loan.principalBalance.toLocaleString('en-IN')}</p>
                                            <p>Int. Bal: {loan.interestBalance.toLocaleString('en-IN')}</p>
                                            <p>Closing Arr: {loan.closingArrPrincipal.toLocaleString('en-IN')} / {loan.closingArrInterest.toLocaleString('en-IN')}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Group Status / Center / Group */}
            <Card className="border-primary/20 shadow-md dark:border-sidebar-accent">
                <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Users className="h-5 w-5 text-primary" />Member Group Status
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                        {hasCenterAssigned
                            ? 'This client already has a center/group assignment — managed from Client Operations → Assign Center & Group.'
                            : isApproved
                            ? 'This client is approved and does not need a group request edited here.'
                            : "The FDO's preferred center and group for this member. This is only a request — the Branch Manager makes the final assignment in Client Operations → Assign Center & Group."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                    {hasCenterAssigned ? (
                        <div className="flex items-center gap-2 text-sm">
                            <Building2 className="h-4 w-4 text-slate-400" />
                            <span className="font-medium">{currentClient?.center?.name}</span>
                            {currentClient?.center?.code && <Badge variant="secondary">{currentClient.center.code}</Badge>}
                        </div>
                    ) : isApproved ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No center/group assigned yet.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Group Status <span className="text-red-500">*</span></Label>
                                    <Select value={memberGroupStatus} onValueChange={(v) => {
                                        setMemberGroupStatus(v);
                                        setRequestedCenterId('');
                                        setRequestedGroupId('');
                                        setRequestedGroups([]);
                                    }}>
                                        <SelectTrigger><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="NEW_CENTER_NEW_MEMBER">New Center New Member</SelectItem>
                                            <SelectItem value="EXISTING_CENTER_NEW_MEMBER">Existing Center New Member</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Center <span className="text-red-500">*</span></Label>
                                    <Select value={requestedCenterId} onValueChange={(v) => {
                                        setRequestedCenterId(v);
                                        setRequestedGroupId('');
                                        setRequestedGroups([]);
                                        fetchRequestedGroups(v);
                                    }} disabled={isLoadingCenters}>
                                        <SelectTrigger><SelectValue placeholder={isLoadingCenters ? 'Loading...' : '-- SELECT --'} /></SelectTrigger>
                                        <SelectContent>
                                            {fdoCenters
                                                .filter((c) => memberGroupStatus !== 'NEW_CENTER_NEW_MEMBER' || c.clientCount === 0)
                                                .map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Requested Group <span className="text-red-500">*</span></Label>
                                    <Select value={requestedGroupId} onValueChange={setRequestedGroupId} disabled={!requestedCenterId || isLoadingGroups}>
                                        <SelectTrigger><SelectValue placeholder={!requestedCenterId ? 'Select center first' : isLoadingGroups ? 'Loading...' : '-- SELECT --'} /></SelectTrigger>
                                        <SelectContent>
                                            {requestedGroups
                                                .filter((g) => memberGroupStatus !== 'NEW_CENTER_NEW_MEMBER' || g.memberCount === 0)
                                                .map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({g.memberCount}/{g.maxMembersPerGroup})</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end pt-2">
                                <Button size="sm" onClick={handleSaveGroupRequest} disabled={isSavingGroup}>
                                    {isSavingGroup ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                                    Save Group Request
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Requested Loan — hidden entirely once the client is APPROVED; the
                Ongoing Loan panel above is the only loan info shown at that point. */}
            {!isApproved && (
            <Card className="border-primary/20 shadow-md dark:border-sidebar-accent">
                <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <CreditCard className="h-5 w-5 text-primary" />Loan Details
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                        Requested loan product, purpose, and amount for this member&apos;s loan.
                        {isLoanCardLocked && (
                            <span className="ml-1 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <AlertCircle className="h-3.5 w-3.5" />
                                Locked.
                            </span>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <fieldset disabled={isLoanCardLocked} className="space-y-3 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">Product Type {renderRequiredIndicator('requestedLoanProductTypeId')}</Label>
                                <Select value={requestedLoanProductTypeId} onValueChange={(v) => {
                                    setRequestedLoanProductTypeId(v);
                                    setRequestedLoanProductId('');
                                }} disabled={isLoanCardLocked}>
                                    <SelectTrigger><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                    <SelectContent>{loanProductTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">Frequency {renderRequiredIndicator('requestedLoanFrequency')}</Label>
                                <Select value={requestedLoanFrequency} onValueChange={(v) => {
                                    setRequestedLoanFrequency(v);
                                    setRequestedLoanProductId('');
                                }} disabled={isLoanCardLocked || !requestedLoanProductTypeId}>
                                    <SelectTrigger><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                    <SelectContent><SelectItem value="weekly">Weekly</SelectItem></SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">Loan Product {renderRequiredIndicator('requestedLoanProductId')}</Label>
                                <Select value={requestedLoanProductId} onValueChange={setRequestedLoanProductId} disabled={isLoanCardLocked || !requestedLoanProductTypeId}>
                                    <SelectTrigger><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                    <SelectContent>{filteredLoanProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">Loan Amount</Label>
                                <Input value={
                                    selectedLoanProduct
                                        ? `₹ ${Number(selectedLoanProduct.loanAmount).toLocaleString('en-IN')}`
                                        : currentClient?.requestedAmount != null
                                            ? `₹ ${Number(currentClient.requestedAmount).toLocaleString('en-IN')}`
                                            : ''
                                } placeholder="Auto-filled from product" disabled />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">Purpose Type {renderRequiredIndicator('requestedLoanPurposeTypeId')}</Label>
                                <Select value={requestedLoanPurposeTypeId} onValueChange={(v) => {
                                    setRequestedLoanPurposeTypeId(v);
                                    setRequestedLoanPurposeId('');
                                    setLoanPurposes([]);
                                    fetchLoanPurposes(v);
                                }} disabled={isLoanCardLocked}>
                                    <SelectTrigger><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                    <SelectContent>{loanPurposeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-sm font-semibold">Loan Purpose {renderRequiredIndicator('requestedLoanPurposeId')}</Label>
                                <Select value={requestedLoanPurposeId} onValueChange={setRequestedLoanPurposeId} disabled={isLoanCardLocked || !requestedLoanPurposeTypeId || isLoadingLoanPurposes}>
                                    <SelectTrigger><SelectValue placeholder={isLoadingLoanPurposes ? 'Loading...' : '-- SELECT --'} /></SelectTrigger>
                                    <SelectContent>{loanPurposes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2 pt-2">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Auto-fetched from Loan Product</Label>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Insurance Rate</Label>
                                    <Input value={`${LOAN_FEES.INSURANCE_FEE_PERCENT}%`} disabled />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Insurance Fee</Label>
                                    <Input value={selectedLoanProduct?.insuranceFees != null ? `₹ ${Number(selectedLoanProduct.insuranceFees).toLocaleString('en-IN')}` : '—'} disabled />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Tenure</Label>
                                    <Input value={selectedLoanProduct?.numberOfDues != null ? `${selectedLoanProduct.numberOfDues} dues (${tenureMonths} mo)` : '—'} disabled />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold">Document Charge</Label>
                                    <Input value={selectedLoanProduct?.documentCharges != null ? `₹ ${Number(selectedLoanProduct.documentCharges).toLocaleString('en-IN')}` : '—'} disabled />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button size="sm" onClick={handleSaveLoanDetails} disabled={isSavingLoan || isLoanCardLocked}>
                                {isSavingLoan ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                                Save Loan Details
                            </Button>
                        </div>
                    </fieldset>
                </CardContent>
            </Card>
            )}
        </div>
    );
}
