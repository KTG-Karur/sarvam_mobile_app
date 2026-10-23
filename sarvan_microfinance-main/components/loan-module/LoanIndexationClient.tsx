'use client';

import { useState, useEffect, useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
    FileText,
    Save,
    RotateCcw,
    Loader2,
    FileSpreadsheet,
    CheckCircle2,
    Clock,
    AlertCircle,
    Trash2,
    Filter,
    X,
    Pencil,
    BookOpen,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { TopSheetDialog } from '@/components/loan-module/TopSheetDialog';
import { LoanIndexSheetDialog } from '@/components/loan-module/LoanIndexSheetDialog';
import { LoanProductEditModal, type UpdatedLoanProduct } from '@/components/loan-module/LoanProductEditModal';
import { LoanPassbookDialog } from '@/components/loan-module/LoanPassbookDialog';
import { IndexPassbookDialog } from '@/components/loan-module/IndexPassbookDialog';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

type Center = {
    id: string;
    name: string;
    code: string;
    meetingDay?: string | null;
};

type UnindexedLoan = {
    id: string;
    loanNumber: string;
    clientId: string;
    clientDisplayId: string;
    clientName: string;
    purpose: string;
    product: string;
    loanProductId: string | null;
    amount: number;
    appliedAmount: number;
    interestRate: number;
    tenureMonths: number;
    frequency: string;
    isSelected: boolean;
    isRejected: boolean;
};

type LoanIndex = {
    id: string;
    indexNo: string;
    indexDate: string;
    centerId: string;
    centerCode: string;
    centerName: string;
    branchName: string;
    branchCode: string;
    frequency: string;
    totalApps: number;
    totalAmount: number;
    status: string;
    statusCounts: Record<string, number>;
    // Only present when an Admin lists deleted indexes
    deletedAt?: string | null;
    deleteReason?: string | null;
    deletedByName?: string;
};

type BranchOption = {
    id: string;
    name: string;
    code: string;
};

type OngoingLoanInfo = {
    clientId: string;
    clientName: string;
    loans: Array<{
        loanNumber: string;
        productName: string;
        indexNo?: string | null;
        disbursementDate: string;
        loanAmount: number;
        outstandingPrincipal: number;
        outstandingInterest: number;
        arrear: number;
        status: string;
    }>;
};

// Validation schema
const loanIndexationSchema = z.object({
    indexDate: z.string().min(1, 'Index date is required'),
    indexNo: z.string().optional(),
    centerName: z.string().min(1, 'Center is required'),
    firstDueDate: z.string().min(1, 'First due date is required'),
});

type LoanIndexationFormValues = z.infer<typeof loanIndexationSchema>;

// Mirrors the server-side check in app/api/loan-indexes/[indexId]/approve/route.ts —
// kept in sync so the BM sees the same block before submitting, not just after.
function getNextValidDateClient(date: Date): Date {
    const nextDate = new Date(date);
    if (nextDate.getDay() === 0) {
        nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
}

const MEETING_DAY_MAP: Record<string, number> = {
    SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
    THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

function findMeetingDayMismatch(
    firstDueDate: string,
    centerMeetingDay: string | null | undefined,
    loans: UnindexedLoan[]
): string | null {
    if (!firstDueDate || !centerMeetingDay) return null;
    const expectedDay = MEETING_DAY_MAP[centerMeetingDay.toUpperCase()];
    if (expectedDay === undefined) return null;

    const adjustedDate = getNextValidDateClient(new Date(firstDueDate));
    if (adjustedDate.getDay() === expectedDay) return null;

    const hasNonDaily = loans.some((l) => (l.frequency || '').toLowerCase() !== 'daily');
    if (!hasNonDaily) return null;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `First due date must fall on the center's meeting day (${centerMeetingDay}). Selected date is ${dayNames[adjustedDate.getDay()]}.`;
}

export function LoanIndexationClient() {
    const { canPage, hasRole } = usePermission();
    const isAdmin = hasRole('admin');
    const canCreateLoan = canPage('/dashboard/loan-module/loan-indexation', 'add');
    const { toast } = useToast();
    const [centers, setCenters] = useState<Center[]>([]);
    const [unindexedLoans, setUnindexedLoans] = useState<UnindexedLoan[]>([]);
    const [loanIndexes, setLoanIndexes] = useState<LoanIndex[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [isLoadingIndexes, setIsLoadingIndexes] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [nextIndexNo, setNextIndexNo] = useState('');
    const [topSheetDialogOpen, setTopSheetDialogOpen] = useState(false);
    const [showDeleted, setShowDeleted] = useState(false);
    const [restoringIndexId, setRestoringIndexId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<LoanIndex | null>(null);
    const [deleteReason, setDeleteReason] = useState('');
    const [selectedIndexForTopSheet, setSelectedIndexForTopSheet] = useState<LoanIndex | null>(null);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [indexSheetDialogOpen, setIndexSheetDialogOpen] = useState(false);
    const [selectedIndexForSheet, setSelectedIndexForSheet] = useState<LoanIndex | null>(null);
    const [indexPassbookDialogOpen, setIndexPassbookDialogOpen] = useState(false);
    const [selectedIndexForPassbook, setSelectedIndexForPassbook] = useState<LoanIndex | null>(null);
    const [editingLoan, setEditingLoan] = useState<UnindexedLoan | null>(null);
    const [recordDateFilter, setRecordDateFilter] = useState('');
    const defaultDateRef = useRef('');
    const [recordCenterFilter, setRecordCenterFilter] = useState('');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [selectedFormBranchId, setSelectedFormBranchId] = useState('');

    const [showOngoingConfirm, setShowOngoingConfirm] = useState(false);
    const [ongoingConfirmData, setOngoingConfirmData] = useState<OngoingLoanInfo[]>([]);
    const [pendingSubmitValues, setPendingSubmitValues] = useState<LoanIndexationFormValues | null>(null);
    const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
    const [firstDueDateConfig, setFirstDueDateConfig] = useState({ enabled: true, maxDays: 8 });
    // Rejecting loans needs a reason — collected in a dialog before the save runs.
    // Held in a ref too, since the save can resume later from the ongoing-loans confirm.
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const rejectReasonRef = useRef('');

    const form = useForm<LoanIndexationFormValues>({
        resolver: zodResolver(loanIndexationSchema),
        defaultValues: {
            indexDate: new Date().toISOString().split('T')[0],
            indexNo: '',
            centerName: '',
            firstDueDate: '',
        },
    });

    const selectedCenterId = form.watch('centerName');
    const indexDate = form.watch('indexDate');
    const firstDueDate = form.watch('firstDueDate');
    // The first due date is validated against the branch's EOD working date, not
    // the browser's wall-clock date — the branch may be operating on a working
    // day that lags real time, and the BM must be able to set a first due date
    // relative to that working date (which can be "in the past" vs. real today).
    const { eodWorkingDate } = useEodWorkingDate(selectedFormBranchId || undefined);
    const todayStr = eodWorkingDate || defaultDateRef.current || new Date().toISOString().split('T')[0];
    // Base UserRole check (not the RBAC slug `isAdmin` above) — this must match
    // the server-side exemption in approve/route.ts and bm-disburse/route.ts,
    // both of which check `user.role !== 'ADMIN'`.
    // Read in an effect, not during render — tokenStorage is localStorage-backed,
    // so reading it during SSR yields false and causes a hydration mismatch.
    const [isBaseAdminRole, setIsBaseAdminRole] = useState(false);
    useEffect(() => {
        setIsBaseAdminRole(tokenStorage.getUser()?.role === 'ADMIN');
    }, []);
    const maxDueStr = firstDueDateConfig.enabled && !isBaseAdminRole
        ? new Date(new Date(todayStr).getTime() + firstDueDateConfig.maxDays * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0]
        : null;
    const firstDueDateValid = !firstDueDate || (firstDueDate >= todayStr && (!maxDueStr || firstDueDate <= maxDueStr));
    const selectedCenter = centers.find((c) => c.id === selectedCenterId) || null;
    const meetingDayMismatch = firstDueDate
        ? findMeetingDayMismatch(firstDueDate, selectedCenter?.meetingDay, unindexedLoans.filter((l) => l.isSelected))
        : null;

    const [passbookPreviewLoan, setPassbookPreviewLoan] = useState<UnindexedLoan | null>(null);

    // Load branches on mount — role decides scope (Admin can always switch
    // branches, even if their profile happens to carry a home/default branchId)
    useEffect(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        const userBranchId = storedUser?.branchId || '';

        apiClient.get<BranchOption[]>('/branches')
            .then(result => {
                if (result.success && result.data) {
                    if (!isAdmin && userBranchId) {
                        // Non-admin: has an assigned branchId — show only that branch, lock selection
                        const assigned = result.data.filter(b => b.id === userBranchId);
                        setBranches(assigned);
                        setSelectedFormBranchId(userBranchId);
                    } else {
                        // Admin: always see all branches and can switch freely
                        setBranches(result.data);
                        const defaultId = activeBranch?.id || userBranchId || (result.data[0]?.id ?? '');
                        setSelectedFormBranchId(defaultId);
                    }
                }
            })
            .catch(() => {});
    }, [isAdmin]);

    // Fetch centers on component mount
    useEffect(() => {
        if (selectedFormBranchId) fetchCenters();
    }, [selectedFormBranchId]);

    // Fetch unindexed loans when center is selected
    useEffect(() => {
        if (selectedCenterId) {
            fetchUnindexedLoans();
        } else {
            setUnindexedLoans([]);
        }
    }, [selectedCenterId]);

    // Refresh index preview when branch or center selection changes
    useEffect(() => {
        generateNextIndexNo();
    }, [selectedFormBranchId, selectedCenterId]);

    // Set today's date client-side only to avoid SSR/CSR timezone mismatch
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        defaultDateRef.current = today;
        setRecordDateFilter(today);
    }, []);

    // Admin-configurable cap on how far out the First Due Date may be set —
    // mirrors the same check enforced server-side at approval and final
    // disbursement (Settings → Member Approval Workflow page, ADMIN only).
    useEffect(() => {
        apiClient.get<{ enabled: boolean; maxDays: number }>('/settings/first-due-date')
            .then((result) => {
                if (result.success && result.data) setFirstDueDateConfig(result.data);
            })
            .catch(() => {});
    }, []);

    // Fetch loan index records when record filters change
    useEffect(() => {
        fetchRecordIndexes();
    }, [recordDateFilter, recordCenterFilter, selectedFormBranchId, showDeleted]);

    const generateNextIndexNo = async () => {
        const centerId = selectedCenterId;
        if (!centerId || !selectedFormBranchId) {
            setNextIndexNo('');
            return;
        }
        try {
            const result = await apiClient.get<{ nextId: string }>(
                `/loan-indexes/next-id?branchId=${selectedFormBranchId}&centerId=${centerId}`
            );
            if (result.success && result.data?.nextId) {
                setNextIndexNo(result.data.nextId);
                form.setValue('indexNo', result.data.nextId);
            }
        } catch (error) {
            console.error('Error generating index number:', error);
            setNextIndexNo('');
        }
    };

    const fetchRecordIndexes = async () => {
        if (!recordDateFilter) return;
        setIsLoadingIndexes(true);
        try {
            let url = `/loan-indexes?fromDate=${recordDateFilter}&toDate=${recordDateFilter}`;
            if (recordCenterFilter) url += `&centerId=${recordCenterFilter}`;
            if (selectedFormBranchId) url += `&branchId=${selectedFormBranchId}`;
            if (showDeleted && isBaseAdminRole) url += '&deleted=true';
            const result = await apiClient.get<LoanIndex[]>(url);
            if (result.success && result.data) {
                setLoanIndexes(result.data);
            } else {
                setLoanIndexes([]);
            }
        } catch {
            setLoanIndexes([]);
        } finally {
            setIsLoadingIndexes(false);
        }
    };

    const handleRestoreIndex = async (index: LoanIndex) => {
        setRestoringIndexId(index.id);
        try {
            const result = await apiClient.post<{ restoredLoans: number }>(`/loan-indexes/${index.id}/restore`, {});
            if (result.success) {
                toast({
                    title: 'Restored',
                    description: `Index ${index.indexNo} restored with ${result.data?.restoredLoans ?? 0} loan(s).`,
                });
                await fetchRecordIndexes();
                await fetchUnindexedLoans();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to restore index.',
                    variant: 'destructive',
                });
            }
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to restore index. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setRestoringIndexId(null);
        }
    };

    const handleIndexSheet = (index: LoanIndex) => {
        setSelectedIndexForSheet(index);
        setIndexSheetDialogOpen(true);
    };

    const handleIndexPassbook = (index: LoanIndex) => {
        setSelectedIndexForPassbook(index);
        setIndexPassbookDialogOpen(true);
    };

    const fetchCenters = async () => {
        if (!selectedFormBranchId) return;
        setIsLoading(true);
        try {
            const centersResult = await apiClient.get<Center[]>(
                `/centers?branchId=${selectedFormBranchId}&includeInactive=false&status=APPROVED`
            );

            if (centersResult.success && centersResult.data) {
                setCenters(centersResult.data);
            } else {
                toast({
                    title: 'Error',
                    description: centersResult.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchUnindexedLoans = async () => {
        if (!selectedCenterId) return;

        setIsLoadingLoans(true);
        try {
            const result = await apiClient.get<any[]>(
                `/loan-indexes/unindexed-loans?centerId=${selectedCenterId}`
            );

            if (result.success && result.data) {
                const loansWithSelection: UnindexedLoan[] = result.data.map((loan: any) => ({
                    ...loan,
                    clientDisplayId: loan.clientDisplayId || loan.clientId,
                    loanProductId: loan.loanProductId || null,
                    isSelected: false,
                    isRejected: false,
                }));
                setUnindexedLoans(loansWithSelection);
            } else {
                toast({
                    title: 'Info',
                    description: result.error || 'No unindexed loans found for this center.',
                });
                setUnindexedLoans([]);
            }
        } catch (error) {
            console.error('Error fetching unindexed loans:', error);
            toast({
                title: 'Error',
                description: 'Failed to load loans. Please try again.',
                variant: 'destructive',
            });
            setUnindexedLoans([]);
        } finally {
            setIsLoadingLoans(false);
        }
    };

    const fetchLoanIndexes = async () => {
        setIsLoadingIndexes(true);
        try {
            let url = `/loan-indexes?indexDate=${indexDate}`;
            if (selectedCenterId) {
                url += `&centerId=${selectedCenterId}`;
            }

            const result = await apiClient.get<LoanIndex[]>(url);

            if (result.success && result.data) {
                setLoanIndexes(result.data);
            } else {
                setLoanIndexes([]);
            }
        } catch (error) {
            console.error('Error fetching loan indexes:', error);
            setLoanIndexes([]);
        } finally {
            setIsLoadingIndexes(false);
        }
    };

    const handleSelectToggle = (loanId: string) => {
        setUnindexedLoans(prev =>
            prev.map(loan =>
                loan.id === loanId
                    ? { ...loan, isSelected: !loan.isSelected, isRejected: false }
                    : loan
            )
        );
    };

    const handleSelectAll = (checked: boolean) => {
        setUnindexedLoans(prev =>
            prev.map(loan => ({
                ...loan,
                isSelected: checked,
                isRejected: checked ? false : loan.isRejected,
            }))
        );
    };

    const handleRejectAll = (checked: boolean) => {
        setUnindexedLoans(prev =>
            prev.map(loan => ({
                ...loan,
                isRejected: checked,
                isSelected: checked ? false : loan.isSelected
            }))
        );
    };

    const handleRejectToggle = (loanId: string) => {
        setUnindexedLoans(prev =>
            prev.map(loan =>
                loan.id === loanId
                    ? { ...loan, isRejected: !loan.isRejected, isSelected: false }
                    : loan
            )
        );
    };

    /** Rejects the loans toggled to Reject; returns false (after a toast) on failure. */
    const rejectToggledLoans = async (centerId: string): Promise<boolean> => {
        const rejectedLoans = unindexedLoans.filter(loan => loan.isRejected);
        if (rejectedLoans.length === 0) return true;
        const result = await apiClient.post<{ rejected: number }>('/loan-indexes/reject-loans', {
            centerId,
            loanIds: rejectedLoans.map(l => l.id),
            reason: rejectReasonRef.current,
        });
        if (!result.success) {
            toast({ title: 'Reject failed', description: result.error || 'Failed to reject loans.', variant: 'destructive' });
            return false;
        }
        return true;
    };

    const resetAfterSave = async () => {
        await fetchUnindexedLoans();
        await fetchRecordIndexes();
        await generateNextIndexNo();
        setUnindexedLoans(prev => prev.map(loan => ({
            ...loan,
            isSelected: false,
            isRejected: false,
        })));
        form.setValue('firstDueDate', '');
        setRejectReason('');
        rejectReasonRef.current = '';
        setPendingSubmitValues(null);
    };

    // Reject-only save: no index is created, so no First Due Date is needed.
    const performRejectOnly = async () => {
        const rejectedCount = unindexedLoans.filter(loan => loan.isRejected).length;
        setIsSaving(true);
        try {
            if (await rejectToggledLoans(form.getValues('centerName'))) {
                toast({ title: 'Loans rejected', description: `${rejectedCount} loan(s) rejected.` });
                await resetAfterSave();
            }
        } catch (error) {
            console.error('Error rejecting loans:', error);
            toast({ title: 'Error', description: 'Failed to reject loans. Please try again.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveClick = () => {
        const hasSelected = unindexedLoans.some(loan => loan.isSelected);
        const hasRejected = unindexedLoans.some(loan => loan.isRejected);
        if (hasRejected) {
            setRejectDialogOpen(true);
            return;
        }
        if (hasSelected) void form.handleSubmit(onSubmit)();
    };

    const handleRejectConfirm = () => {
        rejectReasonRef.current = rejectReason.trim();
        setRejectDialogOpen(false);
        if (unindexedLoans.some(loan => loan.isSelected)) {
            void form.handleSubmit(onSubmit)();
        } else {
            void performRejectOnly();
        }
    };

    const performIndexCreation = async (values: LoanIndexationFormValues) => {
        const selectedLoans = unindexedLoans.filter(loan => loan.isSelected);
        const rejectedLoans = unindexedLoans.filter(loan => loan.isRejected);

        setIsSaving(true);
        try {
            const createResult = await apiClient.post<{ id: string }>('/loan-indexes', {
                indexDate: values.indexDate,
                centerId: values.centerName,
                selectedLoanIds: selectedLoans.map(l => l.id),
            });

            if (!createResult.success || !createResult.data?.id) {
                toast({
                    title: 'Error',
                    description: createResult.error || 'Failed to create loan index.',
                    variant: 'destructive',
                });
                return;
            }

            const newIndexId = createResult.data.id;

            // Auto-submit selected loans to AM (PENDING_LEVEL2)
            const approveResult = await apiClient.post(`/loan-indexes/${newIndexId}/approve`, {
                selectedLoanIds: selectedLoans.map(l => l.id),
                // Rejected loans are not in this index — they go to reject-loans below
                rejectedLoanIds: [],
                firstDueDate: values.firstDueDate,
            });

            const rejectedOk = await rejectToggledLoans(values.centerName);

            if (approveResult.success) {
                toast({
                    title: 'Sent to Area Manager',
                    description: `Loan index created and ${selectedLoans.length} loan(s) forwarded to Area Manager for approval.` +
                        (rejectedLoans.length > 0 && rejectedOk ? ` ${rejectedLoans.length} loan(s) rejected.` : ''),
                });
            } else {
                toast({
                    title: 'Index Created',
                    description: `Loan index created but forwarding to AM failed: ${approveResult.error}`,
                    variant: 'destructive',
                });
            }

            await resetAfterSave();
        } catch (error) {
            console.error('Error creating loan index:', error);
            toast({
                title: 'Error',
                description: 'Failed to create loan index. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleProductEditSaved = (result: UpdatedLoanProduct) => {
        if (!editingLoan) return;
        setUnindexedLoans(prev =>
            prev.map(loan =>
                loan.id === editingLoan.id
                    ? {
                        ...loan,
                        loanProductId: result.loanProductId,
                        product: result.productName,
                        amount: result.amount,
                        interestRate: result.interestRate,
                        tenureMonths: result.tenureMonths,
                        frequency: result.frequency,
                    }
                    : loan
            )
        );
        setEditingLoan(null);
    };

    const onSubmit = async (values: LoanIndexationFormValues) => {
        const selectedLoans = unindexedLoans.filter(loan => loan.isSelected);

        if (selectedLoans.length === 0) {
            toast({
                title: 'No Selection',
                description: 'Please select at least one loan to create an index.',
                variant: 'destructive',
            });
            return;
        }

        if (!values.firstDueDate || values.firstDueDate < todayStr) {
            toast({
                title: 'First Due Date Required',
                description: `Please set a valid First Due Date (on or after the branch working date ${todayStr}) before submitting.`,
                variant: 'destructive',
            });
            return;
        }

        if (maxDueStr && values.firstDueDate > maxDueStr) {
            toast({
                title: 'First Due Date Too Far Out',
                description: `First Due Date must be within ${firstDueDateConfig.maxDays} days of the branch working date (${todayStr}).`,
                variant: 'destructive',
            });
            return;
        }

        const mismatch = findMeetingDayMismatch(values.firstDueDate, selectedCenter?.meetingDay, selectedLoans);
        if (mismatch) {
            toast({
                title: 'First Due Date Mismatch',
                description: mismatch,
                variant: 'destructive',
            });
            return;
        }

        // If user already confirmed, proceed with creation
        if (pendingSubmitValues !== null) {
            await performIndexCreation(values);
            return;
        }

        // Check for ongoing loans
        setIsSaving(true);
        try {
            const uniqueClientIds = Array.from(new Set(selectedLoans.map(l => l.clientId)));

            // Fetch ongoing loans for all clients in a single batched request — firing one
            // request per client made partial/silent per-request failures likely once many
            // loans were selected at once.
            const result = await apiClient.post<Record<string, any[]>>('/clients/ongoing-loans-bulk', {
                clientIds: uniqueClientIds,
            });

            if (!result.success || !result.data) {
                throw new Error(result.error || 'Failed to check ongoing loans');
            }

            // Build confirmation data
            const confirmData: OngoingLoanInfo[] = [];
            uniqueClientIds.forEach((clientId) => {
                const clientLoans = result.data![clientId] || [];
                if (clientLoans.length > 0) {
                    const client = selectedLoans.find(l => l.clientId === clientId);
                    confirmData.push({
                        clientId,
                        clientName: client?.clientName || clientId,
                        loans: clientLoans.map(loan => ({
                            loanNumber: loan.loanNumber,
                            productName: loan.productName,
                            indexNo: loan.indexNo,
                            disbursementDate: loan.disbursementDate,
                            loanAmount: loan.loanAmount,
                            outstandingPrincipal: loan.outstandingPrincipal,
                            outstandingInterest: loan.outstandingInterest,
                            arrear: loan.arrear ?? 0,
                            status: loan.status,
                        })),
                    });
                }
            });

            // If any client has ongoing loans, show confirmation dialog
            if (confirmData.length > 0) {
                setOngoingConfirmData(confirmData);
                setPendingSubmitValues(values);
                setShowOngoingConfirm(true);
            } else {
                // No ongoing loans, proceed with creation
                await performIndexCreation(values);
            }
        } catch (error) {
            console.error('Error checking ongoing loans:', error);
            // Continue with creation even if check fails
            await performIndexCreation(values);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setUnindexedLoans(prev => prev.map(loan => ({
            ...loan,
            isSelected: false,
            isRejected: false,
        })));
        toast({
            title: 'Reset',
            description: 'All selections have been cleared.',
        });
    };

    const handlePrint = (index: LoanIndex) => {
        toast({
            title: 'Print',
            description: `Printing loan index: ${index.indexNo}`,
        });
    };

    const handleTopSheet = (index: LoanIndex) => {
        setSelectedIndexForTopSheet(index);
        setTopSheetDialogOpen(true);
    };

    const handleDeleteIndex = async (indexId: string, reason: string) => {
        setIsLoadingIndexes(true);
        try {
            const result = await apiClient.delete(`/loan-indexes/${indexId}`, { reason });

            if (result.success) {
                setDeleteTarget(null);
                setDeleteReason('');
                toast({
                    title: 'Deleted',
                    description: 'Loan index has been deleted successfully.',
                });
                // Refresh both lists
                await fetchRecordIndexes();
                await fetchUnindexedLoans();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete index.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting index:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete index. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingIndexes(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    };

    const getStatusBadge = (status: string, statusCounts: Record<string, number> = {}) => {
        let badgeStyle = "bg-brand-green-tint text-sidebar-accent hover:bg-brand-green-tint border-primary/20";
        let icon = <Clock className="w-3 h-3 mr-1" />;
        let label = "Pending";

        if (status === 'DISBURSED') {
            badgeStyle = "bg-green-100 text-green-800 hover:bg-green-200 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
            icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
            label = "Disbursed";
        } else if (status === 'AM_APPROVED') {
            badgeStyle = "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700";
            icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
            label = "Ready to Disburse";
        } else if (status === 'BM_APPROVED') {
            badgeStyle = "bg-brand-green-tint text-sidebar-accent hover:bg-primary border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300 dark:border-sidebar-accent";
            icon = <CheckCircle2 className="w-3 h-3 mr-1" />;
            label = "Sent to AM";
        } else if (status === 'PARTIALLY_APPROVED') {
            badgeStyle = "bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800";
            icon = <AlertCircle className="w-3 h-3 mr-1" />;
            label = "Partial";
        }

        return (
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        <Badge variant="outline" className={`${badgeStyle} cursor-help`}>
                            {icon}
                            {label}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="p-3 bg-white dark:bg-green-950 border border-primary/20 dark:border-sidebar-accent shadow-xl rounded-lg">
                        <div className="space-y-1.5 text-xs">
                            <p className="font-semibold text-foreground dark:text-slate-100 mb-2 border-b pb-1">Status Breakdown</p>
                            {Object.entries(statusCounts).map(([key, count]) => {
                                let label = key;
                                if (key === 'PENDING_LEVEL1') label = 'Pending BM Review';
                                if (key === 'APPROVED_LEVEL1') label = 'Sent to AM';
                                if (key === 'PENDING_LEVEL2') label = 'Pending AM Approval';
                                if (key === 'APPROVED_LEVEL2') label = 'AM Approved (Ready to Disburse)';
                                if (key === 'DISBURSED') label = 'Disbursed';
                                if (key === 'REJECTED') label = 'Rejected';

                                return (
                                    <div key={key} className="flex justify-between items-center gap-4 min-w-[140px]">
                                        <span className="text-sidebar-accent dark:text-slate-400 capitalize truncate max-w-[100px]" title={label}>{label}:</span>
                                        <span className="font-mono font-medium text-foreground dark:text-slate-200">{count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    };

    const filteredLoanIndexes = loanIndexes;
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(filteredLoanIndexes);

    const selectedCount = unindexedLoans.filter(loan => loan.isSelected).length;
    const rejectedCount = unindexedLoans.filter(loan => loan.isRejected).length;

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Loan Index
                </h1>
                <p className="text-muted-foreground">
                    Create loan indexes by selecting verified loans
                </p>
            </div>

            {/* Main Form Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <FileText className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Loan Index Details</CardTitle>
                            <CardDescription>
                                Select center and date to view unindexed loans
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {isLoading ? (
                                <PageLoader label="Loading centers..." fullScreen={false} />
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 gap-6 items-start">
                                        {/* Core Selection (Branch, Center & Date) */}
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-4 bg-green-50 dark:bg-brand-green-darker/50 rounded-xl border border-slate-100 dark:border-sidebar-accent">
                                            {/* Branch Selection */}
                                            <div className="grid grid-cols-1 gap-2 min-w-0">
                                                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Branch</Label>
                                                <Select
                                                    value={selectedFormBranchId}
                                                    onValueChange={(v) => {
                                                        setSelectedFormBranchId(v);
                                                        form.setValue('centerName', '');
                                                        setUnindexedLoans([]);
                                                    }}
                                                    disabled={!isAdmin && branches.length <= 1}
                                                >
                                                    <SelectTrigger className="h-12 w-full min-w-0 overflow-hidden bg-white dark:bg-green-950 border-primary/20 dark:border-sidebar-accent focus:ring-primary/20 transition-all">
                                                        <SelectValue placeholder="-- Select Branch --" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {branches.map((b) => (
                                                            <SelectItem key={b.id} value={b.id}>
                                                                <span className="font-semibold text-primary dark:text-primary w-16 inline-block shrink-0">{b.code}</span>
                                                                <span className="text-sidebar-accent dark:text-slate-300 ml-2 truncate" title={b.name}>{b.name}</span>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Center Name */}
                                            <FormField
                                                control={form.control}
                                                name="centerName"
                                                render={({ field }) => (
                                                    <FormItem className="min-w-0 grid-cols-1">
                                                        <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                            Center Selection
                                                        </FormLabel>
                                                        <Select
                                                            onValueChange={field.onChange}
                                                            value={field.value}
                                                            disabled={centers.length === 0}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger className="h-12 w-full min-w-0 overflow-hidden bg-white dark:bg-green-950 border-primary/20 dark:border-sidebar-accent focus:ring-primary/20 transition-all">
                                                                    <SelectValue placeholder="-- Select Center --" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {centers.length === 0 ? (
                                                                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                        No centers available
                                                                    </div>
                                                                ) : (
                                                                    centers.map((center) => (
                                                                        <SelectItem key={center.id} value={center.id}>
                                                                            <span className="font-semibold text-primary dark:text-primary w-16 inline-block shrink-0">{center.code}</span>
                                                                            <span className="text-sidebar-accent dark:text-slate-300 ml-2 truncate" title={center.name}>{center.name}</span>
                                                                        </SelectItem>
                                                                    ))
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Index Date */}
                                            <FormField
                                                control={form.control}
                                                name="indexDate"
                                                render={({ field }) => (
                                                    <FormItem className="min-w-0 grid-cols-1">
                                                        <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                            Index Date
                                                        </FormLabel>
                                                        <FormControl>
                                                            <DateInput
                                                                {...field}
                                                                className="h-12 bg-white dark:bg-green-950 border-primary/20 dark:border-sidebar-accent focus:ring-primary/20 transition-all"
                                                            />
                                                        </FormControl>
                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* First Due Date */}
                                            <FormField
                                                control={form.control}
                                                name="firstDueDate"
                                                render={({ field }) => (
                                                    <FormItem className="min-w-0 grid-cols-1">
                                                        <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                            First Due Date
                                                        </FormLabel>
                                                        <FormControl>
                                                            <DateInput
                                                                min={todayStr}
                                                                max={maxDueStr || undefined}
                                                                {...field}
                                                                className="h-12 bg-white dark:bg-green-950 border-primary/20 dark:border-sidebar-accent focus:ring-primary/20 transition-all"
                                                            />
                                                        </FormControl>
                                                        {selectedCenter?.meetingDay && (
                                                            <p className="text-xs text-slate-500">
                                                                Center meeting day: <span className="font-semibold">{selectedCenter.meetingDay}</span>
                                                            </p>
                                                        )}
                                                        {maxDueStr && (
                                                            <p className="text-xs text-slate-500">
                                                                Must be on or before <span className="font-semibold">{maxDueStr}</span> ({firstDueDateConfig.maxDays} days from working date).
                                                            </p>
                                                        )}
                                                        {field.value && firstDueDate < todayStr && (
                                                            <p className="text-xs text-red-600">First due date must be on or after the branch working date ({todayStr}).</p>
                                                        )}
                                                        {field.value && maxDueStr && firstDueDate > maxDueStr && (
                                                            <p className="text-xs text-red-600">First due date must be within {firstDueDateConfig.maxDays} days of the branch working date ({todayStr}).</p>
                                                        )}
                                                        {field.value && firstDueDateValid && meetingDayMismatch && (
                                                            <p className="text-xs text-red-600">{meetingDayMismatch}</p>
                                                        )}
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                        </div>
                                    </div>

                                    {/* Unindexed Loans Table */}
                                    {selectedCenterId && (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-lg font-semibold">Unindexed Loans</h3>
                                                {selectedCount > 0 && (
                                                    <span className="text-sm text-muted-foreground">
                                                        {selectedCount} selected, {rejectedCount} rejected
                                                    </span>
                                                )}
                                            </div>

                                            {isLoadingLoans ? (
                                                <PageLoader label="Loading loans..." fullScreen={false} />
                                            ) : unindexedLoans.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center py-12 border rounded-lg">
                                                    <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                                                    <p className="text-sm text-muted-foreground">
                                                        No unindexed loans found for this center.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="overflow-x-auto rounded-lg border">
                                                    <Table>
                                                        <TableHeader className="bg-brand-green-darker dark:bg-sidebar-accent text-white">
                                                            <TableRow className="hover:bg-brand-green-darker dark:hover:bg-sidebar-accent border-none">
                                                                <TableHead className="text-white w-[100px]">
                                                                    <div className="flex flex-col gap-1 items-start">
                                                                        <span className="text-[10px] uppercase tracking-wider opacity-70">Approve</span>
                                                                        <Switch
                                                                            checked={unindexedLoans.length > 0 && unindexedLoans.every(l => l.isSelected)}
                                                                            onCheckedChange={handleSelectAll}
                                                                            className="data-[state=checked]:bg-green-500 scale-75 -ml-1"
                                                                        />
                                                                    </div>
                                                                </TableHead>
                                                                <TableHead className="text-white w-[100px]">
                                                                    <div className="flex flex-col gap-1 items-start">
                                                                        <span className="text-[10px] uppercase tracking-wider opacity-70">Reject</span>
                                                                        <Switch
                                                                            checked={unindexedLoans.length > 0 && unindexedLoans.every(l => l.isRejected)}
                                                                            onCheckedChange={handleRejectAll}
                                                                            className="data-[state=checked]:bg-red-500 scale-75 -ml-1"
                                                                        />
                                                                    </div>
                                                                </TableHead>
                                                                <TableHead className="text-white">Client Info</TableHead>
                                                                <TableHead className="text-white">Purpose</TableHead>
                                                                <TableHead className="text-white min-w-[180px]">Loan Product</TableHead>
                                                                <TableHead className="text-white">Freq.</TableHead>
                                                                <TableHead className="text-white text-right">Amount</TableHead>
                                                                <TableHead className="text-white text-center">Passbook</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {unindexedLoans.map((loan) => (
                                                                <TableRow
                                                                    key={loan.id}
                                                                    className={`${loan.isSelected
                                                                        ? 'bg-green-50 dark:bg-green-950/20'
                                                                        : loan.isRejected
                                                                            ? 'bg-red-50 dark:bg-red-950/20'
                                                                            : 'even:bg-green-50 dark:even:bg-brand-green-darker/50'
                                                                        }`}
                                                                >
                                                                    <TableCell>
                                                                        <Switch
                                                                            checked={loan.isSelected}
                                                                            onCheckedChange={() => handleSelectToggle(loan.id)}
                                                                            className="data-[state=checked]:bg-green-600"
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Switch
                                                                            checked={loan.isRejected}
                                                                            onCheckedChange={() => handleRejectToggle(loan.id)}
                                                                            className="data-[state=checked]:bg-red-600"
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <div className="flex flex-col gap-0.5">
                                                                                <span className="font-bold text-foreground dark:text-slate-100">{loan.clientDisplayId}</span>
                                                                                <span className="text-xs text-slate-500">{loan.clientName}</span>
                                                                            </div>
                                                                            <HighmarkHistoryButton
                                                                                clientId={loan.clientId}
                                                                                clientName={loan.clientName}
                                                                                centerName={selectedCenter?.name}
                                                                                variant="outline"
                                                                                className="h-7 shrink-0 px-2 text-xs"
                                                                            />
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Badge variant="outline" className="font-normal bg-green-50 dark:bg-brand-green-darker">
                                                                            {loan.purpose}
                                                                        </Badge>
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-xs text-sidebar-accent dark:text-slate-300 truncate max-w-[140px]" title={loan.product}>
                                                                                {loan.product || '—'}
                                                                            </span>
                                                                            <Button
                                                                                type="button"
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-7 w-7 p-0 shrink-0 text-primary hover:bg-brand-green-tint"
                                                                                onClick={() => setEditingLoan(loan)}
                                                                                title="Edit loan product"
                                                                            >
                                                                                <Pencil className="h-3.5 w-3.5" />
                                                                            </Button>
                                                                        </div>
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Badge variant="secondary" className="text-[10px] uppercase py-0 px-1.5">
                                                                            {loan.frequency}
                                                                        </Badge>
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-bold text-primary dark:text-primary">
                                                                        ₹{formatCurrency(loan.amount)}
                                                                    </TableCell>
                                                                    <TableCell className="text-center">
                                                                        <Button
                                                                            type="button"
                                                                            size="sm"
                                                                            variant="outline"
                                                                            className="h-8 px-2 border-primary text-primary hover:bg-green-50"
                                                                            disabled={!firstDueDate || !firstDueDateValid}
                                                                            title={!firstDueDate ? 'Set the First Due Date to preview the passbook' : 'Preview Loan Passbook'}
                                                                            onClick={() => setPassbookPreviewLoan(loan)}
                                                                        >
                                                                            <BookOpen className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div className="flex flex-wrap gap-3 pt-4">
                                        <Button
                                            type="button"
                                            onClick={handleSaveClick}
                                            disabled={
                                                !canCreateLoan || isSaving ||
                                                (selectedCount === 0 && rejectedCount === 0) ||
                                                // First due date only matters when an index is being created
                                                (selectedCount > 0 && (!firstDueDateValid || !!meetingDayMismatch))
                                            }
                                            className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                            size="lg"
                                        >
                                            {isSaving ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Saving...
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="mr-2 h-4 w-4" />
                                                    Save
                                                </>
                                            )}
                                        </Button>

                                        <Button
                                            type="button"
                                            onClick={handleReset}
                                            disabled={isSaving || (selectedCount === 0 && rejectedCount === 0)}
                                            variant="outline"
                                            className="flex-1 min-w-[120px]"
                                            size="lg"
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Reset
                                        </Button>
                                    </div>
                                </>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>

            {/* Record Filter Bar */}
            <Card className="border border-primary/20/80 dark:border-sidebar-accent/60 shadow-sm">
                <CardContent className="pt-4 pb-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex items-center gap-2 mr-1">
                            <Filter className="h-4 w-4 text-slate-500" />
                            <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Filter Records</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs text-slate-500">Index Date</Label>
                            <DateInput
                                value={recordDateFilter}
                                onChange={e => setRecordDateFilter(e.target.value)}
                                className="h-9 w-44"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs text-slate-500">Center</Label>
                            <Select
                                value={recordCenterFilter || '__all__'}
                                onValueChange={v => setRecordCenterFilter(v === '__all__' ? '' : v)}
                            >
                                <SelectTrigger className="h-9 w-52">
                                    <SelectValue placeholder="All Centers" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All Centers</SelectItem>
                                    {centers.map(c => (
                                        <SelectItem key={c.id} value={c.id}>
                                            <span className="font-semibold text-primary mr-2">{c.code}</span>{c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {(recordCenterFilter || (defaultDateRef.current && recordDateFilter !== defaultDateRef.current)) && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1.5 self-end"
                                onClick={() => {
                                    setRecordDateFilter(defaultDateRef.current);
                                    setRecordCenterFilter('');
                                }}
                            >
                                <X className="h-3.5 w-3.5" />
                                Clear
                            </Button>
                        )}
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search loan indexes..."
                            className="ml-auto self-end"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Loan Indexes Table */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
                <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <CardTitle>{showDeleted ? 'Deleted Loan Indexes' : 'Loan Index Records'}</CardTitle>
                            <CardDescription>
                                {showDeleted
                                    ? 'Deleted indexes for the selected date — restore relinks their loans'
                                    : 'View and manage created loan indexes for the selected date'}
                            </CardDescription>
                        </div>
                        {isBaseAdminRole && (
                            <label className="flex items-center gap-2 text-sm font-medium">
                                Show deleted
                                <Switch checked={showDeleted} onCheckedChange={setShowDeleted} />
                            </label>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoadingIndexes ? (
                        <PageLoader label="Loading loan indexes..." fullScreen={false} />
                    ) : searchedRows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12">
                            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-sm text-muted-foreground">
                                No loan indexes found for the selected criteria.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader className="bg-brand-green-darker dark:bg-sidebar-accent text-white">
                                    <TableRow className="hover:bg-brand-green-darker dark:hover:bg-sidebar-accent border-none">
                                        <TableHead className="text-white">Index No</TableHead>
                                        <TableHead className="text-white">Date</TableHead>
                                        <TableHead className="text-white">Branch</TableHead>
                                        <TableHead className="text-white">Center</TableHead>
                                        <TableHead className="text-white">Freq.</TableHead>
                                        <TableHead className="text-white text-center">Batch Status</TableHead>
                                        <TableHead className="text-white text-center">Appls</TableHead>
                                        <TableHead className="text-white text-right">Total Amount</TableHead>
                                        <TableHead className="text-white text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map((index) => (
                                        <TableRow
                                            key={index.id}
                                            className="even:bg-green-50 dark:even:bg-brand-green-darker/50"
                                        >
                                            <TableCell className="font-medium">
                                                {index.indexNo}
                                                {showDeleted && (
                                                    <div className="mt-1 text-xs font-normal text-red-600">
                                                        Deleted by {index.deletedByName ?? 'Unknown'}
                                                        {index.deletedAt ? ` on ${toDisplayDateTime(new Date(index.deletedAt))}` : ''}
                                                        {index.deleteReason ? ` — ${index.deleteReason}` : ''}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell>{formatDate(index.indexDate)}</TableCell>
                                            <TableCell>
                                                <span className="font-semibold text-primary">{index.branchCode}</span>
                                                {index.branchName ? ` - ${index.branchName}` : ''}
                                            </TableCell>
                                            <TableCell>
                                                {index.centerCode} - {index.centerName}
                                            </TableCell>
                                            <TableCell>{index.frequency}</TableCell>
                                            <TableCell>
                                                {getStatusBadge(index.status, index.statusCounts)}
                                            </TableCell>
                                            <TableCell className="text-center">{index.totalApps}</TableCell>
                                            <TableCell className="text-right font-bold text-primary dark:text-primary">
                                                ₹{formatCurrency(index.totalAmount)}
                                            </TableCell>
                                            <TableCell>
                                                {showDeleted ? (
                                                    <div className="flex items-center justify-center">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={restoringIndexId === index.id}
                                                            onClick={() => handleRestoreIndex(index)}
                                                            className="h-8 px-3 border-primary text-primary hover:bg-green-50"
                                                            title="Restore Index"
                                                        >
                                                            Restore
                                                        </Button>
                                                    </div>
                                                ) : (
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleTopSheet(index)}
                                                        className="h-8 px-2 border-primary text-primary hover:bg-green-50"
                                                        title="Top Sheet"
                                                    >
                                                        <FileSpreadsheet className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleIndexSheet(index)}
                                                        className="h-8 px-2 border-purple-200 text-purple-700 hover:bg-purple-50"
                                                        title="Loan Index Sheet"
                                                    >
                                                        <FileText className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleIndexPassbook(index)}
                                                        className="h-8 px-2 border-primary text-primary hover:bg-green-50"
                                                        title="Loan Passbooks"
                                                    >
                                                        <BookOpen className="h-4 w-4" />
                                                    </Button>
                                                    {!index.statusCounts?.APPROVED_LEVEL2 && !index.statusCounts?.DISBURSED && (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => { setDeleteReason(''); setDeleteTarget(index); }}
                                                            className="h-8 px-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                            title="Delete Index"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Reject Loans Dialog — rejecting at indexation is final, so a reason is mandatory */}
            <Dialog
                open={rejectDialogOpen}
                onOpenChange={(open) => { if (!open) setRejectDialogOpen(false); }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject {rejectedCount} loan(s)</DialogTitle>
                        <DialogDescription>
                            Rejected loans are marked REJECTED and removed from Unindexed Loans for good.
                            {selectedCount > 0 && ` The ${selectedCount} approved loan(s) will still be indexed and sent to the Area Manager.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            {unindexedLoans.filter(l => l.isRejected).map(l => `${l.clientDisplayId || l.clientId} — ${l.clientName}`).join(', ')}
                        </p>
                        <Label htmlFor="reject-loans-reason">Reason for rejection</Label>
                        <Textarea
                            id="reject-loans-reason"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Why are these loans being rejected?"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setRejectDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={rejectReason.trim().length < 3 || isSaving}
                            onClick={handleRejectConfirm}
                        >
                            {selectedCount > 0 ? 'Reject & Save Index' : 'Reject Loans'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Index Dialog — a reason is mandatory and stored with who deleted it */}
            <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete index {deleteTarget?.indexNo}</DialogTitle>
                        <DialogDescription>
                            Associated loans will be released back to Unindexed Loans. This is recorded against your name.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="delete-index-reason">Reason for deletion</Label>
                        <Textarea
                            id="delete-index-reason"
                            value={deleteReason}
                            onChange={(e) => setDeleteReason(e.target.value)}
                            placeholder="Why is this index being deleted?"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={deleteReason.trim().length < 5 || isLoadingIndexes}
                            onClick={() => deleteTarget && handleDeleteIndex(deleteTarget.id, deleteReason.trim())}
                        >
                            Delete Index
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Top Sheet Dialog */}
            {selectedIndexForTopSheet && (
                <TopSheetDialog
                    open={topSheetDialogOpen}
                    onOpenChange={setTopSheetDialogOpen}
                    indexId={selectedIndexForTopSheet.id}
                    indexNo={selectedIndexForTopSheet.indexNo}
                />
            )}

            {selectedIndexForSheet && (
                <LoanIndexSheetDialog
                    open={indexSheetDialogOpen}
                    onOpenChange={setIndexSheetDialogOpen}
                    indexId={selectedIndexForSheet.id}
                    indexNo={selectedIndexForSheet.indexNo}
                />
            )}

            {selectedIndexForPassbook && (
                <IndexPassbookDialog
                    open={indexPassbookDialogOpen}
                    onOpenChange={setIndexPassbookDialogOpen}
                    indexId={selectedIndexForPassbook.id}
                    indexNo={selectedIndexForPassbook.indexNo}
                />
            )}

            {/* Passbook Preview Dialog (pre-disbursement, for audit) */}
            {passbookPreviewLoan && (
                <LoanPassbookDialog
                    open={!!passbookPreviewLoan}
                    onOpenChange={(open) => { if (!open) setPassbookPreviewLoan(null); }}
                    loanId={passbookPreviewLoan.id}
                    loanNumber={passbookPreviewLoan.loanNumber}
                    clientName={passbookPreviewLoan.clientName}
                    firstDueDate={firstDueDate}
                />
            )}

            {/* Loan Product Edit Modal */}
            {editingLoan && (
                <LoanProductEditModal
                    open={!!editingLoan}
                    onOpenChange={(open) => { if (!open) setEditingLoan(null); }}
                    loanId={editingLoan.id}
                    currentProductId={editingLoan.loanProductId}
                    role="BM"
                    maxAllowedAmount={editingLoan.appliedAmount}
                    onSaved={handleProductEditSaved}
                />
            )}

            {/* Ongoing Loan Confirmation Dialog */}
            <Dialog open={showOngoingConfirm} onOpenChange={() => {}}>
                <DialogContent
                    className="max-w-3xl max-h-[80vh] overflow-y-auto"
                    onInteractOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            Clients With Ongoing Loans
                        </DialogTitle>
                        <DialogDescription>
                            The following clients have active loans. Confirm to proceed with index creation.
                        </DialogDescription>
                    </DialogHeader>

                    {ongoingConfirmData.length > 0 && (
                        <div className="space-y-4 my-6">
                            {ongoingConfirmData.map((clientInfo) => {
                                const totalOutstanding = clientInfo.loans.reduce((sum, loan) => sum + loan.outstandingPrincipal + loan.outstandingInterest, 0);
                                const isExpanded = expandedClients.has(clientInfo.clientId);

                                return (
                                    <div key={clientInfo.clientId} className="border-2 border-amber-200 dark:border-amber-900/30 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 overflow-hidden">
                                        {/* Client Summary Header */}
                                        <div
                                            className="p-4 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors flex items-center justify-between"
                                            onClick={() => {
                                                const newExpanded = new Set(expandedClients);
                                                if (newExpanded.has(clientInfo.clientId)) {
                                                    newExpanded.delete(clientInfo.clientId);
                                                } else {
                                                    newExpanded.add(clientInfo.clientId);
                                                }
                                                setExpandedClients(newExpanded);
                                            }}
                                        >
                                            <div className="flex-1">
                                                <h3 className="font-bold text-base text-amber-900 dark:text-amber-100">
                                                    {clientInfo.clientName}
                                                </h3>
                                                <div className="flex gap-6 mt-2 text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-amber-700 dark:text-amber-300">📋</span>
                                                        <span className="text-sidebar-accent dark:text-slate-300">{clientInfo.loans.length} {clientInfo.loans.length === 1 ? 'loan' : 'loans'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-amber-700 dark:text-amber-300">💰</span>
                                                        <span className="font-semibold text-sidebar-accent dark:text-slate-200">
                                                            ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(totalOutstanding)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-amber-600 dark:text-amber-400 ml-4">
                                                {isExpanded ? '▼' : '▶'}
                                            </div>
                                        </div>

                                        {/* Collapsible Details */}
                                        {isExpanded && (
                                            <div className="border-t border-amber-200 dark:border-amber-900/30 p-4 bg-white/50 dark:bg-green-950/30">
                                                <div className="overflow-x-auto">
                                                    <Table className="w-full text-sm">
                                                        <TableHeader>
                                                            <TableRow className="bg-amber-100/50 dark:bg-amber-900/30">
                                                                <TableHead className="font-semibold text-amber-900 dark:text-amber-100">Loan Account</TableHead>
                                                                <TableHead className="font-semibold text-amber-900 dark:text-amber-100">Product</TableHead>
                                                                <TableHead className="font-semibold text-amber-900 dark:text-amber-100">Amount</TableHead>
                                                                <TableHead className="font-semibold text-amber-900 dark:text-amber-100 text-right">Outstanding</TableHead>
                                                                <TableHead className="font-semibold text-amber-900 dark:text-amber-100 text-right">Arrear</TableHead>
                                                                <TableHead className="font-semibold text-amber-900 dark:text-amber-100">Status</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {clientInfo.loans.map((loan, idx) => (
                                                                <TableRow key={idx} className={cn(
                                                                    "border-amber-100/50 dark:border-amber-900/20",
                                                                    loan.arrear > 0
                                                                        ? "bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60"
                                                                        : "hover:bg-amber-50/50 dark:hover:bg-amber-900/10"
                                                                )}>
                                                                    <TableCell className="font-medium text-foreground dark:text-slate-100">{loan.loanNumber}</TableCell>
                                                                    <TableCell className="text-sidebar-accent dark:text-slate-300">{loan.productName}</TableCell>
                                                                    <TableCell className="text-sidebar-accent dark:text-slate-300">
                                                                        ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.loanAmount)}
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-semibold text-amber-700 dark:text-amber-300">
                                                                        ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.outstandingPrincipal + loan.outstandingInterest)}
                                                                    </TableCell>
                                                                    <TableCell className={cn("text-right font-semibold",
                                                                        loan.arrear > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                                                                    )}>
                                                                        {loan.arrear > 0
                                                                            ? `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.arrear)}`
                                                                            : '—'}
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Badge className="bg-amber-200 text-amber-900 hover:bg-amber-300 dark:bg-amber-900 dark:text-amber-100">{loan.status}</Badge>
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <DialogFooter className="flex gap-3 justify-end pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                setShowOngoingConfirm(false);
                                setPendingSubmitValues(null);
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={() => {
                                setShowOngoingConfirm(false);
                                if (pendingSubmitValues) {
                                    performIndexCreation(pendingSubmitValues);
                                }
                            }}
                            className="bg-primary hover:bg-primary"
                        >
                            Confirm & Proceed
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
