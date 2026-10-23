'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Loader2,
    History,
    Home,
    CalendarCheck,
    Check,
    ArrowRight,
    ClipboardList,
    IndianRupee,
    Landmark,
    Wallet,
    ListChecks,
    Clock,
    Eye,
    Coins,
    Info,
    type LucideIcon,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { EodWelcomeBanner } from '@/components/utilities/EodWelcomeBanner';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    DenominationEntryPanel,
    type DenominationVerificationPayload,
} from '@/components/utilities/DenominationEntryPanel';
import { EodChecklistDetailPanel } from '@/components/utilities/EodChecklistDetailPanel';
import {
    EodCollectionAndBooksSummary,
    type EodBookBalances,
} from '@/components/utilities/EodCollectionAndBooksSummary';
import { EodPill, EodSectionCard, eodHeadCellClass, eodHeadRowClass, eodTableWrapClass } from '@/components/utilities/eod-ui';
import { branchStorage } from '@/app/lib/branch-storage';
import { usePermission } from '@/app/hooks/usePermission';
import { cn } from '@/lib/utils';
import { tokenStorage, type StoredUser } from '@/app/lib/token-storage';
import { apiClient } from '@/app/lib/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EodDetailSection } from '@/app/types/eod-checklist-details';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

type EodFinancialSnapshot = {
    branchId: string;
    workingDateYmd: string;
    branchCalendarTimeZone: string;
    expectedCashCreditTotal: number;
};

interface ChecklistItem {
    code: number;
    description: string;
    status: string;
    issue: boolean;
    /** Info-only item (counts for the day) — never pass/fail, never blocks EOD close. */
    informational?: boolean;
    details?: string;
}

const toDateInputValue = (date: Date | null) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const DENOMINATION_ENTRY_HREF = '/dashboard/utilities/denomination-entry';

const formatInr = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);

function SummaryStatCard({
    icon: Icon,
    iconClass,
    cardClass,
    label,
    value,
    hint,
    hintClass,
    title,
}: {
    icon: LucideIcon;
    iconClass: string;
    cardClass: string;
    label: string;
    value: string;
    hint: string;
    hintClass: string;
    title?: string;
}) {
    return (
        <div
            className={cn('flex items-start gap-3 rounded-xl border border-slate-200 p-4 shadow-sm dark:border-slate-800', cardClass)}
            title={title}
        >
            <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white', iconClass)}>
                <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="mt-0.5 truncate text-2xl font-bold tabular-nums text-foreground">{value}</p>
                <p className={cn('mt-0.5 text-[11px]', hintClass)}>{hint}</p>
            </div>
        </div>
    );
}

const DEFAULT_BRANCH_LOCK_MSG =
    'Branch is outside its write window. EOD cannot be processed until Head Office extends the lock.';

/** Display branch calendar YYYY-MM-DD as DD/MM/YYYY (no browser timezone shift). */
function formatWorkingYmdAsDdMmYyyy(ymd: string | null | undefined): string {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        return '';
    }
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
}

type EodCloseRequestStatus = 'NONE' | 'PENDING_AM_APPROVAL' | 'REJECTED' | 'APPROVED';

type EodFetchSnapshot = {
    requestFailed: boolean;
    branchLockedOutOfWindow: boolean;
    lockMessage: string | null;
    eodCompletedForToday: boolean;
    canProceedToDenominationStep: boolean;
    eodCloseRequestStatus: EodCloseRequestStatus;
    eodCloseRequestRejectionReason: string | null;
};

type EodHistoryData = {
    workingDateYmd: string;
    branchCalendarTimeZone: string;
    checklist: ChecklistItem[];
    sections: EodDetailSection[];
};

export function EODProcessClient() {
    // Read from localStorage only after mount — reading it during the render body
    // (even in state initializers) returns a value on the client that the server
    // never had, which is a hydration mismatch. Starting at null and filling it in
    // via effect keeps the first client render identical to the server's.
    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
    const [activeBranchName, setActiveBranchName] = useState<string | null>(null);
    // Gates the first status fetch until we know whether this user must pick a branch.
    const [userLoaded, setUserLoaded] = useState(false);
    useEffect(() => {
        setCurrentUser(tokenStorage.getUser());
        setActiveBranchName(branchStorage.getActiveBranch()?.name ?? null);
        setUserLoaded(true);
    }, []);
    const { canPage, isHeadOffice } = usePermission();
    const [bookBalances, setBookBalances] = useState<EodBookBalances | null>(null);
    // AREA_MANAGER can view this screen (checklist/books/denomination) but cannot
    // submit/close EOD — that stays a BM/Admin action; the server enforces this too.
    const isViewOnly = currentUser?.role === 'AREA_MANAGER';
    // Admin can process/view EOD for any branch; Area Manager only for branches
    // they're assigned to; any other role (BRANCH_MANAGER, FDO, custom RBAC
    // roles, ...) explicitly assigned more than one branch (UserBranchAssignment)
    // also gets a picker scoped to their assigned set — same scoping the server
    // enforces (see resolveEodViewBranchId in app/lib/denomination-entry.ts). A
    // single-branch user (the common case) never sees this control.
    // Head Office–based users (Sub Admin / custom RBAC roles at HO) see every branch,
    // like Admin — the server treats them as unrestricted too (resolveEodViewBranchId).
    const isHeadOfficeUser = !!currentUser && currentUser.role !== 'ADMIN' && currentUser.role !== 'AREA_MANAGER' && isHeadOffice;
    const isMultiBranchOtherRole =
        !!currentUser &&
        !isHeadOfficeUser &&
        currentUser.role !== 'ADMIN' &&
        currentUser.role !== 'AREA_MANAGER' &&
        (currentUser.assignedBranchIds?.length ?? 0) > 1;
    const canPickBranch =
        currentUser?.role === 'ADMIN' || currentUser?.role === 'AREA_MANAGER' || isHeadOfficeUser || isMultiBranchOtherRole;
    const [branchOptions, setBranchOptions] = useState<{ id: string; label: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
    // Branch-picker users start with no branch selected — nothing is fetched until they choose one.
    const awaitingBranchPick = canPickBranch && !selectedBranchId;
    const [isLoading, setIsLoading] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const { toast } = useToast();
    const [eodDate, setEodDate] = useState<Date | null>(null);
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [canProceedToDenominationStep, setCanProceedToDenominationStep] = useState(false);
    const [denominationGate, setDenominationGate] = useState<DenominationVerificationPayload | null>(null);
    const [financialSnapshot, setFinancialSnapshot] = useState<EodFinancialSnapshot | null>(null);
    const [branchIdForView, setBranchIdForView] = useState<string | null>(null);
    const [branchLockedForEod, setBranchLockedForEod] = useState(false);
    const [branchLockMessage, setBranchLockMessage] = useState<string | null>(null);
    const [eodCompletedForToday, setEodCompletedForToday] = useState(false);
    const [eodCompletionSummary, setEodCompletionSummary] = useState<{
        branchCalendarTodayYmd: string;
        nextBusinessDayYmd: string;
        branchCalendarTimeZone: string;
    } | null>(null);
    const [daysBehind, setDaysBehind] = useState<number>(0);
    const [eodCloseRequestStatus, setEodCloseRequestStatus] = useState<EodCloseRequestStatus>('NONE');
    const [eodCloseRequestRejectionReason, setEodCloseRequestRejectionReason] = useState<string | null>(null);

    /** Branch business calendar date (YYYY-MM-DD), same source as checklist / denomination. */
    const [eodWorkingDateYmd, setEodWorkingDateYmd] = useState<string | null>(null);

    /** Date the user is currently browsing — defaults to the live pending working date. */
    const [viewDateYmd, setViewDateYmd] = useState<string | null>(null);
    const [historyData, setHistoryData] = useState<EodHistoryData | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);

    const [checklistDetails, setChecklistDetails] = useState<{
        workingDateYmd: string;
        branchCalendarTimeZone: string;
        sections: EodDetailSection[];
    } | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);

    // Load the branch picker's options — every active branch for Admin, only the
    // branches assigned to this user for an Area Manager.
    useEffect(() => {
        if (!canPickBranch || !currentUser) return;
        let cancelled = false;

        void (async () => {
            if (currentUser.role === 'ADMIN' || isHeadOfficeUser) {
                const result = await apiClient.get<{ id: string; name: string; code: string }[]>('/branches');
                if (!cancelled && result.success && result.data) {
                    setBranchOptions(result.data.map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` })));
                }
            } else if (currentUser.role === 'AREA_MANAGER') {
                const result = await apiClient.get<{
                    branch: { id: string; name: string; code: string };
                    isPrimary: boolean;
                }[]>(`/area-manager-branches?userId=${currentUser.id}`);
                if (!cancelled && result.success && result.data) {
                    setBranchOptions(
                        result.data.map((a) => ({ id: a.branch.id, label: `${a.branch.code} — ${a.branch.name}` }))
                    );
                }
            } else if (isMultiBranchOtherRole) {
                const assignedBranchIds = currentUser.assignedBranchIds ?? [];
                const result = await apiClient.get<{ id: string; name: string; code: string }[]>('/branches');
                if (!cancelled && result.success && result.data) {
                    setBranchOptions(
                        result.data
                            .filter((b) => assignedBranchIds.includes(b.id))
                            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))
                    );
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [canPickBranch, currentUser?.role, currentUser?.id, isHeadOfficeUser, isMultiBranchOtherRole, currentUser?.assignedBranchIds]);

    // Default the browse date to the branch's current pending working date once known
    // (only on first load — later refreshes shouldn't yank the user off a date they picked).
    useEffect(() => {
        if (eodWorkingDateYmd && viewDateYmd === null) {
            setViewDateYmd(eodWorkingDateYmd);
        }
    }, [eodWorkingDateYmd, viewDateYmd]);

    // Single-branch users: remember whichever branch the server resolved. Branch-picker
    // users (Admin / AM / multi-branch) deliberately start with none selected.
    useEffect(() => {
        if (!canPickBranch && branchIdForView && selectedBranchId === null) {
            setSelectedBranchId(branchIdForView);
        }
    }, [canPickBranch, branchIdForView, selectedBranchId]);

    const handleBranchChange = (branchId: string) => {
        setSelectedBranchId(branchId);
        setViewDateYmd(null);
    };

    const isViewingCurrentWorkingDate =
        viewDateYmd !== null && eodWorkingDateYmd !== null && viewDateYmd === eodWorkingDateYmd;

    const sectionByCode = useMemo(() => {
        const map = new Map<number, EodDetailSection>();
        checklistDetails?.sections.forEach((s) => map.set(s.code, s));
        return map;
    }, [checklistDetails]);

    const historySectionByCode = useMemo(() => {
        const map = new Map<number, EodDetailSection>();
        historyData?.sections.forEach((s) => map.set(s.code, s));
        return map;
    }, [historyData]);

    // The checklist table renders whichever data set matches the date being browsed.
    const displayChecklist = isViewingCurrentWorkingDate ? checklist : historyData?.checklist ?? [];
    const displaySectionByCode = isViewingCurrentWorkingDate ? sectionByCode : historySectionByCode;

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(displayChecklist);

    useEffect(() => {
        if (eodCompletedForToday || branchLockedForEod) {
            setChecklistDetails(null);
            setDetailsError(null);
            setDetailsLoading(false);
            return;
        }
        if (checklist.length === 0) {
            setChecklistDetails(null);
            setDetailsLoading(false);
            setDetailsError(null);
            return;
        }

        let cancelled = false;
        setDetailsLoading(true);
        setDetailsError(null);

        void (async () => {
            try {
                const detailsParams = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
                const response = await fetch(`/api/utilities/eod-checklist-details${detailsParams}`);
                const data = (await response.json().catch(() => ({}))) as {
                    success?: boolean;
                    data?: unknown;
                    error?: string;
                };

                if (cancelled) {
                    return;
                }

                if (response.status === 423) {
                    setChecklistDetails(null);
                    setDetailsError(null);
                    return;
                }

                if (!response.ok) {
                    setChecklistDetails(null);
                    setDetailsError(
                        typeof data?.error === 'string'
                            ? data.error
                            : 'Could not load detailed checklist report.'
                    );
                    return;
                }

                const payload = data?.data;
                if (!payload || typeof payload !== 'object') {
                    setChecklistDetails(null);
                    setDetailsError('Invalid response from server.');
                    return;
                }

                const body = payload as {
                    eodCompletedForBranchCalendarDay?: boolean;
                    workingDateYmd?: string;
                    branchCalendarTimeZone?: string;
                    sections?: EodDetailSection[];
                };

                if (body.eodCompletedForBranchCalendarDay === true) {
                    setChecklistDetails(null);
                    setDetailsError(null);
                    return;
                }

                if (
                    Array.isArray(body.sections) &&
                    typeof body.workingDateYmd === 'string' &&
                    typeof body.branchCalendarTimeZone === 'string'
                ) {
                    setChecklistDetails({
                        workingDateYmd: body.workingDateYmd,
                        branchCalendarTimeZone: body.branchCalendarTimeZone,
                        sections: body.sections,
                    });
                } else {
                    setChecklistDetails(null);
                    setDetailsError('Invalid response from server.');
                }
            } catch {
                if (!cancelled) {
                    setChecklistDetails(null);
                    setDetailsError('Could not load detailed checklist report.');
                }
            } finally {
                if (!cancelled) {
                    setDetailsLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [checklist, eodCompletedForToday, branchLockedForEod, selectedBranchId]);

    // Read-only checklist/detail snapshot for a past business date the user has browsed to.
    useEffect(() => {
        if (!viewDateYmd || isViewingCurrentWorkingDate) {
            setHistoryData(null);
            setHistoryError(null);
            setHistoryLoading(false);
            return;
        }

        let cancelled = false;
        setHistoryLoading(true);
        setHistoryError(null);

        void (async () => {
            try {
                const params = new URLSearchParams({ date: viewDateYmd });
                if (selectedBranchId) params.set('branchId', selectedBranchId);
                const response = await fetch(`/api/utilities/eod-process/history?${params}`);
                const data = (await response.json().catch(() => ({}))) as {
                    success?: boolean;
                    data?: EodHistoryData;
                    error?: string;
                };

                if (cancelled) return;

                if (!response.ok || !data?.success || !data.data) {
                    setHistoryData(null);
                    setHistoryError(
                        typeof data?.error === 'string' ? data.error : 'Failed to load EOD details for this date.'
                    );
                    return;
                }

                setHistoryData(data.data);
            } catch {
                if (!cancelled) {
                    setHistoryData(null);
                    setHistoryError('Failed to load EOD details for this date.');
                }
            } finally {
                if (!cancelled) {
                    setHistoryLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [viewDateYmd, isViewingCurrentWorkingDate, selectedBranchId]);

    const fetchStatus = useCallback(async (): Promise<EodFetchSnapshot> => {
        setIsChecking(true);
        const failSnapshot = (msg?: string): EodFetchSnapshot => {
            if (msg) {
                toast({
                    title: 'Error',
                    description: msg,
                    variant: 'destructive',
                });
            }
            return {
                requestFailed: true,
                branchLockedOutOfWindow: false,
                lockMessage: null,
                eodCompletedForToday: false,
                canProceedToDenominationStep: false,
                eodCloseRequestStatus: 'NONE',
                eodCloseRequestRejectionReason: null,
            };
        };

        try {
            const statusParams = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
            const response = await fetch(`/api/utilities/eod-process${statusParams}`);
            const data = (await response.json().catch(() => ({}))) as {
                data?: unknown;
                error?: string;
            };

            if (response.status === 423) {
                const lockMsg =
                    typeof data?.error === 'string' && data.error.trim().length > 0
                        ? data.error
                        : DEFAULT_BRANCH_LOCK_MSG;
                setBranchLockedForEod(true);
                setBranchLockMessage(lockMsg);
                setEodCompletedForToday(false);
                setEodCompletionSummary(null);
                setEodDate(null);
                setEodWorkingDateYmd(null);
                setChecklist([]);
                setCanProceedToDenominationStep(false);
                setFinancialSnapshot(null);
                setDenominationGate(null);
                setEodCloseRequestStatus('NONE');
                setEodCloseRequestRejectionReason(null);
                return {
                    requestFailed: false,
                    branchLockedOutOfWindow: true,
                    lockMessage: lockMsg,
                    eodCompletedForToday: false,
                    canProceedToDenominationStep: false,
                    eodCloseRequestStatus: 'NONE',
                    eodCloseRequestRejectionReason: null,
                };
            }

            if (!response.ok) {
                return failSnapshot(
                    typeof data?.error === 'string' ? data.error : 'Failed to fetch EOD status. Please try again.'
                );
            }

            setBranchLockedForEod(false);
            setBranchLockMessage(null);

            const payload = (data?.data ?? data) as {
                processDate: string;
                checklist: ChecklistItem[];
                canProceedToDenominationStep?: boolean;
                branchId?: string;
                workingDateYmd?: string;
                branchCalendarTimeZone?: string;
                expectedCashCreditTotal?: number;
                eodCompletedForBranchCalendarDay?: boolean;
                branchCalendarTodayYmd?: string;
                nextBusinessDayYmd?: string;
                daysBehind?: number;
                eodCloseRequestStatus?: EodCloseRequestStatus;
                eodCloseRequestRejectionReason?: string | null;
            };

            if (typeof payload.branchId === 'string') {
                setBranchIdForView(payload.branchId);
            }

            if (payload.eodCompletedForBranchCalendarDay === true) {
                setEodCompletedForToday(true);
                setEodCompletionSummary(
                    typeof payload.branchCalendarTodayYmd === 'string' &&
                        typeof payload.nextBusinessDayYmd === 'string'
                        ? {
                              branchCalendarTodayYmd: payload.branchCalendarTodayYmd,
                              nextBusinessDayYmd: payload.nextBusinessDayYmd,
                              branchCalendarTimeZone:
                                  typeof payload.branchCalendarTimeZone === 'string'
                                      ? payload.branchCalendarTimeZone
                                      : 'Asia/Kolkata',
                          }
                        : null
                );
                setEodDate(
                    payload.processDate ? new Date(payload.processDate) : null
                );
                setEodWorkingDateYmd(
                    typeof payload.workingDateYmd === 'string' ? payload.workingDateYmd : null
                );
                setChecklist([]);
                setCanProceedToDenominationStep(false);
                setFinancialSnapshot(null);
                setDenominationGate(null);
                setDaysBehind(0);
                setEodCloseRequestStatus('NONE');
                setEodCloseRequestRejectionReason(null);
                return {
                    requestFailed: false,
                    branchLockedOutOfWindow: false,
                    lockMessage: null,
                    eodCompletedForToday: true,
                    canProceedToDenominationStep: false,
                    eodCloseRequestStatus: 'NONE',
                    eodCloseRequestRejectionReason: null,
                };
            }

            setEodCompletedForToday(false);
            setEodCompletionSummary(null);

            setEodDate(new Date(payload.processDate));
            setEodWorkingDateYmd(
                typeof payload.workingDateYmd === 'string' ? payload.workingDateYmd : null
            );
            setChecklist(payload.checklist);
            setDaysBehind(typeof payload.daysBehind === 'number' ? payload.daysBehind : 0);
            const canProceed = Boolean(payload.canProceedToDenominationStep);
            setCanProceedToDenominationStep(canProceed);
            if (
                typeof payload.branchId === 'string' &&
                typeof payload.workingDateYmd === 'string' &&
                typeof payload.branchCalendarTimeZone === 'string' &&
                typeof payload.expectedCashCreditTotal === 'number'
            ) {
                setFinancialSnapshot({
                    branchId: payload.branchId,
                    workingDateYmd: payload.workingDateYmd,
                    branchCalendarTimeZone: payload.branchCalendarTimeZone,
                    expectedCashCreditTotal: payload.expectedCashCreditTotal,
                });
            } else {
                setFinancialSnapshot(null);
            }

            const closeRequestStatus = payload.eodCloseRequestStatus ?? 'NONE';
            const closeRequestRejectionReason = payload.eodCloseRequestRejectionReason ?? null;
            setEodCloseRequestStatus(closeRequestStatus);
            setEodCloseRequestRejectionReason(closeRequestRejectionReason);

            return {
                requestFailed: false,
                branchLockedOutOfWindow: false,
                lockMessage: null,
                eodCompletedForToday: false,
                canProceedToDenominationStep: canProceed,
                eodCloseRequestStatus: closeRequestStatus,
                eodCloseRequestRejectionReason: closeRequestRejectionReason,
            };
        } catch (error) {
            return failSnapshot(
                error instanceof Error ? error.message : 'Failed to fetch EOD status. Please try again.'
            );
        } finally {
            setIsChecking(false);
        }
    }, [toast, selectedBranchId]);

    useEffect(() => {
        if (!userLoaded || awaitingBranchPick) return;
        void fetchStatus();
    }, [fetchStatus, userLoaded, awaitingBranchPick]);

    const eodDateYmd = useMemo(() => {
        if (eodWorkingDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(eodWorkingDateYmd)) {
            return eodWorkingDateYmd;
        }
        return toDateInputValue(eodDate);
    }, [eodWorkingDateYmd, eodDate]);

    const handleDenomVerification = useCallback((payload: DenominationVerificationPayload) => {
        setDenominationGate(payload);
    }, []);

    const handleOpenEodConfirm = async () => {
        if (!denominationGate?.readyForEodClose) {
            toast({
                title: 'Denomination required',
                description: 'Denomination total must match collection total and be saved before closing EOD.',
                variant: 'destructive',
            });
            return;
        }

        const snap = await fetchStatus();
        if (snap.requestFailed) {
            return;
        }
        if (snap.branchLockedOutOfWindow) {
            toast({
                title: 'Branch is locked',
                description: snap.lockMessage ?? DEFAULT_BRANCH_LOCK_MSG,
                variant: 'destructive',
            });
            return;
        }
        if (snap.eodCompletedForToday) {
            toast({
                title: 'EOD already completed',
                description: 'End of day for today is already closed for this branch.',
                variant: 'destructive',
            });
            return;
        }

        setShowConfirmDialog(true);
    };

    const handleConfirm = async () => {
        setIsLoading(true);
        try {
            const pre = await fetchStatus();
            if (pre.requestFailed) {
                return;
            }
            if (pre.branchLockedOutOfWindow) {
                setShowConfirmDialog(false);
                toast({
                    title: 'Branch is locked',
                    description: pre.lockMessage ?? DEFAULT_BRANCH_LOCK_MSG,
                    variant: 'destructive',
                });
                return;
            }
            if (pre.eodCompletedForToday) {
                setShowConfirmDialog(false);
                toast({
                    title: 'EOD already completed',
                    description: 'End of day for today is already closed for this branch.',
                    variant: 'destructive',
                });
                return;
            }

            if (!denominationGate?.counts || !eodDateYmd) {
                throw new Error('Denomination entry is not ready yet. Refresh and try again.');
            }

            // Persist whatever is currently on screen (prefilled from FDO collections,
            // possibly edited by the BM for opening balance / receipts / payments) before
            // submitting — no separate "Save" click required.
            const denomSaveResponse = await fetch('/api/denomination-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: eodDateYmd,
                    branchId: selectedBranchId,
                    ...denominationGate.counts,
                    remarks: denominationGate.remarks,
                }),
            });

            if (!denomSaveResponse.ok) {
                const errorData = (await denomSaveResponse.json().catch(() => ({}))) as { error?: string };
                throw new Error(
                    errorData.error ?? 'Failed to save the denomination entry before submitting.'
                );
            }

            const closeParams = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
            const response = await fetch(`/api/utilities/eod-process${closeParams}`, {
                method: 'POST',
            });

            if (response.status === 423) {
                const errorData = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(
                    errorData.error ?? 'Branch is locked. EOD cannot be closed.'
                );
            }

            if (response.status === 409) {
                const errorData = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(
                    errorData.error ?? 'EOD cannot be closed. It may already be closed—refresh the page.'
                );
            }

            if (!response.ok) {
                const errorData = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(errorData.error || 'Failed to close EOD');
            }

            setShowConfirmDialog(false);
            toast({
                title: 'EOD Closed',
                description: 'End of day has been closed and the working date has advanced.',
            });

            void fetchStatus();
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to complete EOD process.',
                variant: 'destructive',
            });
            void fetchStatus();
        } finally {
            setIsLoading(false);
        }
    };

    const getChecklistTone = (
        status: string,
        issue: boolean,
        informational?: boolean
    ): 'completed' | 'issue' | 'pending' | 'info' => {
        if (informational) return 'info';
        if (issue) return 'issue';
        if (status === 'Approved' || status === 'No Error') return 'completed';
        return 'pending';
    };

    // Cash/Bank book + denomination panels use whichever date is being browsed;
    // for the live pending date that's the same as eodDateYmd.
    const booksDateYmd = isViewingCurrentWorkingDate ? eodDateYmd : viewDateYmd;
    const showLiveSections = isViewingCurrentWorkingDate && !eodCompletedForToday && !branchLockedForEod;

    // Progress counts only the items that actually gate EOD close; info items are listed
    // for reference and never counted as pending.
    const actionableChecklist = displayChecklist.filter((item) => !item.informational);
    const checklistCompletedCount = actionableChecklist.filter(
        (item) => getChecklistTone(item.status, item.issue) === 'completed'
    ).length;
    const checklistTotal = actionableChecklist.length;
    const checklistPendingCount = checklistTotal - checklistCompletedCount;
    const checklistPercent = checklistTotal > 0 ? Math.round((checklistCompletedCount / checklistTotal) * 100) : 0;

    const selectedBranchLabel =
        branchOptions.find((b) => b.id === selectedBranchId)?.label ?? activeBranchName ?? '—';
    const canViewDenominationPage = canPage(DENOMINATION_ENTRY_HREF, 'view');

    const focusViewDate = () => {
        const el = document.getElementById('eod-view-date');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.focus();
    };

    return (
        <div className="space-y-5">
            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
                <Home className="h-3.5 w-3.5" />
                <span>/</span>
                <span>Daily Operations</span>
                <span>/</span>
                <span className="font-medium text-foreground">EOD Process</span>
            </nav>

            {/* Header + EOD setup */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-md">
                        <CalendarCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">EOD Process</h1>
                        <p className="text-sm text-muted-foreground">
                            {isViewOnly
                                ? 'End of Day checklist, denomination verification and branch close — view only'
                                : 'End of Day checklist, denomination verification and branch close'}
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-card p-3 shadow-sm dark:border-slate-800 lg:min-w-[300px]">
                    <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                            <Check className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                            <p className="text-sm font-semibold text-foreground">EOD Setup</p>
                            <div className="grid grid-cols-[52px_1fr] items-center gap-x-2 gap-y-1.5">
                                <Label htmlFor="eod-view-branch" className="text-xs font-normal text-muted-foreground">Branch :</Label>
                                {canPickBranch ? (
                                    <Select
                                        value={selectedBranchId ?? undefined}
                                        onValueChange={handleBranchChange}
                                        disabled={branchOptions.length === 0}
                                    >
                                        <SelectTrigger id="eod-view-branch" className="h-8 text-xs font-semibold">
                                            <SelectValue placeholder="Select branch" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branchOptions.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    {b.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <span className="truncate font-semibold uppercase text-foreground">{selectedBranchLabel}</span>
                                )}
                                <Label htmlFor="eod-view-date" className="text-xs font-normal text-muted-foreground">Date :</Label>
                                <DateInput
                                    id="eod-view-date"
                                    value={viewDateYmd ?? ''}
                                    max={eodWorkingDateYmd ?? undefined}
                                    onChange={(e) => setViewDateYmd(e.target.value)}
                                    disabled={awaitingBranchPick}
                                    className="h-8 text-xs font-semibold"
                                />
                            </div>
                            {financialSnapshot?.branchCalendarTimeZone ? (
                                <p className="text-[11px] text-muted-foreground">
                                    Business working date {formatWorkingYmdAsDdMmYyyy(eodWorkingDateYmd)} ({financialSnapshot.branchCalendarTimeZone})
                                </p>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>

            {awaitingBranchPick ? (
                <EodWelcomeBanner userName={currentUser?.firstName} branchCount={branchOptions.length} />
            ) : (
            <React.Fragment>
            {/* Status banners */}
            {eodCompletedForToday ? (
                <div
                    className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                    role="status"
                >
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <div>
                        <p className="font-semibold">EOD completed for today</p>
                        <p className="mt-1 text-sm">
                            {eodCompletionSummary
                                ? `Branch calendar date ${eodCompletionSummary.branchCalendarTodayYmd} is closed. The branch is now on business day ${eodCompletionSummary.nextBusinessDayYmd} (${eodCompletionSummary.branchCalendarTimeZone}).`
                                : 'The branch working date has already advanced past today’s calendar date. No further EOD action is required for today.'}
                        </p>
                    </div>
                </div>
            ) : null}
            {branchLockedForEod ? (
                <div
                    className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
                    role="alert"
                >
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    <div>
                        <p className="font-semibold">Branch is locked</p>
                        <p className="mt-1 text-sm">{branchLockMessage ?? DEFAULT_BRANCH_LOCK_MSG}</p>
                    </div>
                </div>
            ) : null}
            {!eodCompletedForToday && !branchLockedForEod && daysBehind > 0 ? (
                <div
                    className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/30"
                    role="status"
                >
                    <div className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-amber-400 text-amber-500">
                            <AlertCircle className="h-4 w-4" aria-hidden />
                        </div>
                        <div>
                            <p className="font-semibold text-amber-800 dark:text-amber-300">EOD catch-up required</p>
                            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                                This branch is behind by <span className="font-semibold">{daysBehind}</span> working day(s).
                                Close EOD for each day sequentially to unlock the next day’s operations and keep denomination aligned.
                            </p>
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={focusViewDate}
                        className="shrink-0 border-amber-400 bg-white text-amber-800 hover:bg-amber-50 dark:bg-transparent dark:text-amber-300"
                    >
                        View Past Business Days
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                </div>
            ) : null}
            {!isViewingCurrentWorkingDate && viewDateYmd ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    <span className="flex items-center gap-2 font-medium">
                        <History className="h-4 w-4" />
                        Viewing past business date {formatWorkingYmdAsDdMmYyyy(viewDateYmd)} — read only.
                    </span>
                    {eodWorkingDateYmd && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setViewDateYmd(eodWorkingDateYmd)}
                            className="border-amber-400 bg-white text-amber-800 hover:bg-amber-50 dark:bg-transparent dark:text-amber-300"
                        >
                            Back to current ({formatWorkingYmdAsDdMmYyyy(eodWorkingDateYmd)})
                        </Button>
                    )}
                </div>
            ) : null}

            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-800">
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                            <ClipboardList className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Total Checklist Items</p>
                            <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{checklistTotal}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                <span className="text-primary">Completed {checklistCompletedCount}</span>
                                <span className="mx-1.5">|</span>
                                <span className="text-amber-600 dark:text-amber-400">Pending {checklistPendingCount}</span>
                            </p>
                        </div>
                    </div>
                    <div
                        className="relative h-14 w-14 shrink-0 rounded-full"
                        style={{
                            background: `conic-gradient(var(--primary) ${checklistPercent * 3.6}deg, rgb(226 232 240) 0deg)`,
                        }}
                        role="img"
                        aria-label={`${checklistPercent}% of checklist completed`}
                    >
                        <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-card text-xs font-bold text-foreground">
                            {checklistPercent}%
                        </div>
                    </div>
                </div>

                <SummaryStatCard
                    icon={IndianRupee}
                    iconClass="bg-sky-500"
                    cardClass="bg-sky-50/60 dark:bg-sky-950/20"
                    label="Total Cash Count"
                    value={financialSnapshot ? formatInr(financialSnapshot.expectedCashCreditTotal) : '—'}
                    hint="Expected as per records"
                    hintClass="text-sky-600 dark:text-sky-400"
                    title="Opening balance + today's loan collections + HO Borrow received − HO Remittance paid − other cash payments. Matches the daybook closing balance."
                />
                <SummaryStatCard
                    icon={Landmark}
                    iconClass="bg-primary"
                    cardClass="bg-emerald-50/60 dark:bg-emerald-950/20"
                    label="Total Denomination"
                    value={denominationGate ? formatInr(denominationGate.denominationTotal) : '—'}
                    hint={
                        !denominationGate
                            ? 'Cash count not entered'
                            : denominationGate.amountsMatch
                              ? 'Matched cash count'
                              : `Difference ${formatInr(denominationGate.difference)}`
                    }
                    hintClass={denominationGate && !denominationGate.amountsMatch ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}
                />
                <SummaryStatCard
                    icon={Wallet}
                    iconClass="bg-violet-600"
                    cardClass="bg-violet-50/60 dark:bg-violet-950/20"
                    label="Bank Book Balance"
                    value={bookBalances ? formatInr(bookBalances.bankClosingBalance) : '—'}
                    hint="Closing Balance"
                    hintClass="text-violet-600 dark:text-violet-400"
                />
            </div>

            {/* Processing overlay */}
            {isLoading && (
                <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[2px] dark:bg-green-950/70">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl dark:bg-brand-green-darker">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                    <p className="animate-pulse text-lg font-semibold text-sidebar-accent dark:text-slate-200">
                        Processing End of Day...
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Finalizing branch closure and advancing date
                    </p>
                </div>
            )}

            {/* EOD Checklist */}
            <EodSectionCard
                icon={ListChecks}
                title={isViewingCurrentWorkingDate ? 'EOD Checklist' : `EOD Checklist — ${formatWorkingYmdAsDdMmYyyy(viewDateYmd)}`}
                badge={
                    checklistTotal > 0 ? (
                        <span className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-white">
                            {checklistCompletedCount} / {checklistTotal} Completed
                        </span>
                    ) : null
                }
                actions={
                    <>
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search checklist items..."
                        />
                        {isViewingCurrentWorkingDate && (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => void fetchStatus()}
                                disabled={isChecking}
                                className="h-9 w-9 shrink-0"
                                title="Re-check checklist status"
                                aria-label="Re-check checklist status"
                            >
                                <RefreshCw className={cn('h-4 w-4', isChecking && 'animate-spin')} />
                            </Button>
                        )}
                    </>
                }
            >
                {isChecking && (
                    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center rounded-xl bg-white/70 backdrop-blur-[2px] dark:bg-green-950/70">
                        <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
                        <p className="animate-pulse text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                            Verifying checklist status...
                        </p>
                    </div>
                )}

                {!isViewingCurrentWorkingDate && historyError ? (
                    <div className="mb-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                        <AlertCircle className="h-4 w-4" />
                        {historyError}
                    </div>
                ) : null}

                <div className={eodTableWrapClass}>
                    <Table>
                        <TableHeader>
                            <TableRow className={eodHeadRowClass}>
                                <TableHead className={cn(eodHeadCellClass, 'w-[60px]')}>#</TableHead>
                                <TableHead className={eodHeadCellClass}>Checklist Item</TableHead>
                                <TableHead className={cn(eodHeadCellClass, 'w-[160px]')}>Status</TableHead>
                                <TableHead className={eodHeadCellClass}>Remarks</TableHead>
                                <TableHead className={cn(eodHeadCellClass, 'w-[110px]')}>Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="text-xs">
                            {isViewingCurrentWorkingDate && isChecking && checklist.length === 0 && !eodCompletedForToday ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        Fetching live data...
                                    </TableCell>
                                </TableRow>
                            ) : isViewingCurrentWorkingDate && eodCompletedForToday && checklist.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        No open EOD tasks for today. Refresh after the next calendar day if
                                        you need to run EOD again.
                                    </TableCell>
                                </TableRow>
                            ) : !isViewingCurrentWorkingDate && historyLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        Loading {formatWorkingYmdAsDdMmYyyy(viewDateYmd)} details...
                                    </TableCell>
                                </TableRow>
                            ) : !isViewingCurrentWorkingDate && displayChecklist.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        No checklist data available for this date.
                                    </TableCell>
                                </TableRow>
                            ) : tableSearchQuery && searchedRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                        No checklist items match your search.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                searchedRows.map((item) => {
                                    const tone = getChecklistTone(item.status, item.issue, item.informational);
                                    return (
                                        <TableRow key={item.code}>
                                            <TableCell className="text-muted-foreground">{item.code}</TableCell>
                                            <TableCell className="font-medium text-foreground">{item.description}</TableCell>
                                            <TableCell>
                                                {tone === 'info' ? (
                                                    <EodPill tone="neutral" icon={Info}>Info</EodPill>
                                                ) : tone === 'completed' ? (
                                                    <EodPill tone="success" icon={Check}>Completed</EodPill>
                                                ) : tone === 'issue' ? (
                                                    <EodPill tone="danger" icon={AlertCircle}>Action Required</EodPill>
                                                ) : (
                                                    <EodPill tone="warning" icon={Clock}>Pending</EodPill>
                                                )}
                                            </TableCell>
                                            <TableCell title={item.details}>
                                                {tone === 'info' ? (
                                                    <span className="font-medium text-foreground">{item.status}</span>
                                                ) : tone === 'completed' ? (
                                                    <span className="text-muted-foreground">-</span>
                                                ) : (
                                                    <EodPill tone={tone === 'issue' ? 'danger' : 'warning'}>{item.status}</EodPill>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Dialog>
                                                    <DialogTrigger asChild>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 gap-1 border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-primary hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40"
                                                        >
                                                            <Eye className="h-3.5 w-3.5" />
                                                            View
                                                        </Button>
                                                    </DialogTrigger>
                                                    <DialogContent className="max-h-[90vh] max-w-5xl gap-0 overflow-hidden border-brand-green-darker/20 p-0 sm:max-w-5xl">
                                                        <DialogHeader className="space-y-1 border-b border-brand-green-darker/15 bg-brand-green-darker px-6 py-4 text-left">
                                                            <DialogTitle className="text-lg font-bold text-white">
                                                                {item.description}
                                                            </DialogTitle>
                                                            <DialogDescription className="text-green-100/90">
                                                                {isViewingCurrentWorkingDate
                                                                    ? checklistDetails
                                                                        ? `Business day ${checklistDetails.workingDateYmd} · ${checklistDetails.branchCalendarTimeZone}`
                                                                        : 'Detailed EOD checklist report'
                                                                    : `Business day ${historyData?.workingDateYmd ?? viewDateYmd} · ${historyData?.branchCalendarTimeZone ?? ''}`}
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <div className="max-h-[calc(90vh-7rem)] overflow-y-auto px-6 py-5">
                                                            <EodChecklistDetailPanel
                                                                section={displaySectionByCode.get(item.code)}
                                                                loading={isViewingCurrentWorkingDate ? detailsLoading : historyLoading}
                                                                error={isViewingCurrentWorkingDate ? detailsError : historyError}
                                                                checklistSummary={{
                                                                    status: item.status,
                                                                    issue: item.issue,
                                                                    informational: item.informational,
                                                                    details: item.details,
                                                                }}
                                                            />
                                                            {item.issue ? (
                                                                <div className="mt-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
                                                                    <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
                                                                    <span className="text-sm font-medium">
                                                                        Action required: verify and resolve pending items
                                                                        before closing EOD.
                                                                    </span>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </DialogContent>
                                                </Dialog>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </EodSectionCard>

            {branchIdForView && booksDateYmd && (isViewingCurrentWorkingDate ? showLiveSections : true) ? (
                <EodCollectionAndBooksSummary
                    branchId={branchIdForView}
                    dateYmd={booksDateYmd}
                    onBalancesChange={setBookBalances}
                />
            ) : null}

            {(isViewingCurrentWorkingDate ? showLiveSections : Boolean(viewDateYmd)) && (
                <EodSectionCard
                    icon={Coins}
                    title="Denomination Verification"
                    actions={
                        canViewDenominationPage ? (
                            <Button asChild size="sm" className="h-8 bg-primary px-3 text-xs text-white hover:bg-sidebar-accent">
                                <Link href={DENOMINATION_ENTRY_HREF}>
                                    View Details
                                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                                </Link>
                            </Button>
                        ) : undefined
                    }
                >
                    {isViewingCurrentWorkingDate ? (
                        <DenominationEntryPanel
                            key={`${selectedBranchId ?? ''}-${eodDateYmd}`}
                            dateYmd={eodDateYmd}
                            branchId={selectedBranchId}
                            variant="embedded"
                            showDateSelector={false}
                            onVerificationChange={handleDenomVerification}
                        />
                    ) : (
                        viewDateYmd && (
                            <DenominationEntryPanel
                                key={`ro-${selectedBranchId ?? ''}-${viewDateYmd}`}
                                dateYmd={viewDateYmd}
                                branchId={selectedBranchId}
                                variant="embedded"
                                showDateSelector={false}
                                readOnlyView
                            />
                        )
                    )}
                </EodSectionCard>
            )}

            {isViewingCurrentWorkingDate && !isViewOnly && showLiveSections && (
                <div className="flex justify-end">
                    <Button
                        type="button"
                        onClick={() => void handleOpenEodConfirm()}
                        disabled={
                            isLoading ||
                            eodCompletedForToday ||
                            branchLockedForEod ||
                            !canProceedToDenominationStep ||
                            !denominationGate?.readyForEodClose
                        }
                        size="lg"
                        className={cn(
                            'min-w-[180px] text-white shadow-md',
                            canProceedToDenominationStep &&
                                denominationGate?.readyForEodClose &&
                                !branchLockedForEod &&
                                !eodCompletedForToday
                                ? 'bg-primary hover:bg-sidebar-accent'
                                : 'cursor-not-allowed bg-slate-400'
                        )}
                    >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Complete EOD
                    </Button>
                </div>
            )}
            </React.Fragment>
            )}

            <ConfirmationDialog
                open={showConfirmDialog}
                onOpenChange={setShowConfirmDialog}
                onConfirm={() => {
                    void handleConfirm();
                }}
                title="Complete EOD"
                description={`Close End of Day for business working date ${eodDateYmd || ''}? The denomination count shown above will be saved, and the working date will advance immediately.`}
                confirmText="Complete EOD"
                cancelText="Cancel"
                type="danger"
                isLoading={isLoading}
            />
        </div>
    );
}
