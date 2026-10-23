'use client';

import { useState, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
    UsersRound,
    RotateCcw,
    Loader2,
    CheckCircle2,
    CalendarDays,
    IndianRupee,
    AlertCircle,
    Camera,
    ArrowLeft,
    ArrowRight,
    Banknote,
    ImageIcon,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { format } from 'date-fns';
import { CameraCapture } from '@/components/ui/CameraCapture';
import {
    DENOMINATION_VALUES,
    normalizeDenominationCounts,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
    type DenominationCounts,
} from '@/app/lib/denomination-money';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

// Local render order for the denomination step (500, 200, 100, 50, ...) — intentionally
// different from DENOMINATION_VALUES' own key order, which other consumers (e.g. the EOD
// checklist detail view) depend on and must not be affected by this page's display order.
const DENOMINATION_ROW_ORDER: Array<keyof DenominationCounts> = [
    'd500', 'd200', 'd100', 'd50', 'd20', 'd10', 'd5', 'd2', 'd1',
];

type Center = {
    id: string;
    name: string;
    code: string;
};

type BulkCollectionResponse = {
    batchId: string;
    successCount: number;
    failureCount: number;
    totalCollected: number;
};

type DemandSheetItem = {
    clientId: string;
    clientCode: string;
    clientMobile?: string | null;
    clientName: string;
    loanId: string;
    loanNumber: string;
    loanAmount: number;
    loanOutstanding: number;
    productName: string;
    frequency: string;
    arrearsPrincipal: number;
    arrearsInterest: number;
    totalArrears: number;
    currentDuePrincipal: number;
    currentDueInterest: number;
    totalCurrentDue: number;
    totalDue: number;
    collectedAmount: number;
    loanAdvance: number;
    isSelected: boolean;
};

// Collection Type options
const COLLECTION_TYPE_OPTIONS = [
    { value: 'CASH_IN_HAND', label: 'CASH IN HAND' },
    { value: 'BANK', label: 'BANK' },
    { value: 'BANK_ACCOUNT_CSB', label: 'BANK ACCOUNT CSB' },
];

// Validation schema
const bulkCollectionSchema = z.object({
    centerName: z.string().min(1, 'Center name is required'),
    collectionDate: z.string().min(1, 'Collection date is required'),
    collectionType: z.string().min(1, 'Collection type is required'),
});

type BulkCollectionFormValues = z.infer<typeof bulkCollectionSchema>;

const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);

type PendingBulkCollection = {
    clientId: string;
    loanId: string;
    amount: number;
    loanAdvance: number;
    isSelected: boolean;
};

type PendingBulkSubmission = {
    centerId: string;
    collectionDate: string;
    collectionType: string;
    collections: PendingBulkCollection[];
};

export function BulkCollectionClient() {
    const { canPage } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const canCreateCollection = canPage('/dashboard/collections/client-late-collection/bulk-collection', 'add');
    const { toast } = useToast();

    // Branch state — Admin/Area Manager can pick any branch; others are locked to their own
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branchName, setBranchName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [centers, setCenters] = useState<Center[]>([]);
    const [demandSheet, setDemandSheet] = useState<DemandSheetItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDemand, setIsLoadingDemand] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Wizard: collect (existing grid) -> photo (meeting photo capture) -> denomination (cash count)
    const [step, setStep] = useState<'collect' | 'photo' | 'denomination'>('collect');
    const [pendingSubmission, setPendingSubmission] = useState<PendingBulkSubmission | null>(null);
    const [pendingCashTotal, setPendingCashTotal] = useState(0);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [meetingPhotoFile, setMeetingPhotoFile] = useState<File | null>(null);
    const [meetingPhotoPreviewUrl, setMeetingPhotoPreviewUrl] = useState<string | null>(null);
    // Soft GPS capture at the photo step — recorded for audit only, never blocks submission.
    const [photoLocation, setPhotoLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [denomCounts, setDenomCounts] = useState<Record<keyof DenominationCounts, string>>({
        d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '',
    });
    const [denomUpi, setDenomUpi] = useState('');

    const form = useForm<BulkCollectionFormValues>({
        resolver: zodResolver(bulkCollectionSchema),
        defaultValues: {
            centerName: '',
            collectionDate: format(new Date(), 'yyyy-MM-dd'),
            collectionType: '',
        },
    });

    const selectedCenterId = form.watch('centerName');
    const collectionDate = form.watch('collectionDate');
    const collectionType = form.watch('collectionType');

    // Load branches on component mount
    useEffect(() => {
        loadBranches();
    }, []);

    // Fetch centers whenever the selected branch changes
    useEffect(() => {
        if (selectedBranchId) {
            form.setValue('centerName', '');
            setCenters([]);
            fetchCenters(selectedBranchId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    // Fetch demand sheet when center or date changes
    useEffect(() => {
        if (selectedCenterId && collectionDate) {
            fetchDemandSheet(selectedCenterId, collectionDate);
        } else {
            setDemandSheet([]);
        }
    }, [selectedCenterId, collectionDate]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(demandSheet);

    // Calculate real-time summary
    const summary = useMemo(() => {
        const selectedItems = demandSheet.filter(item => item.isSelected);
        const totalExpected = selectedItems.reduce((sum, item) => sum + item.totalDue, 0);
        const totalCollecting = selectedItems.reduce((sum, item) => sum + item.collectedAmount, 0);
        const clientsCount = selectedItems.length;

        return {
            totalExpected: Number(totalExpected.toFixed(2)),
            totalCollecting: Number(totalCollecting.toFixed(2)),
            clientsCount,
        };
    }, [demandSheet]);

    const loadBranches = async () => {
        if (isAdminOrAM) {
            setIsLoadingBranches(true);
            try {
                const res = await fetch('/api/branches');
                const json = await res.json();
                const list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                setBranches(list);
                const activeBranch = branchStorage.getActiveBranch();
                const preferredId = activeBranch?.id ?? storedUser?.branchId;
                const match = list.find((b) => b.id === preferredId) ?? list[0];
                if (match) {
                    setSelectedBranchId(match.id);
                } else {
                    setIsLoading(false);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                setIsLoading(false);
            } finally {
                setIsLoadingBranches(false);
            }
        } else {
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id ?? storedUser?.branchId ?? '';
            setBranchName(activeBranch?.name ?? '');
            setSelectedBranchId(branchId);
        }
    };

    const fetchCenters = async (branchId: string) => {
        if (!branchId) return;
        setIsLoading(true);
        try {
            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`
            );

            if (result.success && result.data) {
                setCenters(result.data);
                if (result.data.length === 1 && !form.getValues('centerName')) {
                    form.setValue('centerName', result.data[0].id);
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
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

    const fetchDemandSheet = async (centerId: string, date: string) => {
        setIsLoadingDemand(true);
        try {
            const result = await apiClient.get<any>(
                `/collections/bulk-collection?centerId=${centerId}&collectionDate=${date}`
            );

            if (result.success && result.data) {
                const sheet = (result.data.demandSheet || []).map((item: DemandSheetItem) => ({
                    ...item,
                    loanAdvance: item.loanAdvance ?? 0,
                }));
                setDemandSheet(sheet);

                if (result.data.demandSheet.length === 0) {
                    toast({
                        title: 'No Dues Found',
                        description: 'No clients with pending dues found for this center.',
                    });
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load demand sheet.',
                    variant: 'destructive',
                });
                setDemandSheet([]);
            }
        } catch (error) {
            console.error('Error fetching demand sheet:', error);
            toast({
                title: 'Error',
                description: 'Failed to load demand sheet. Please try again.',
                variant: 'destructive',
            });
            setDemandSheet([]);
        } finally {
            setIsLoadingDemand(false);
        }
    };

    const handleSelectAll = (checked: boolean) => {
        setDemandSheet(prev => prev.map(item => ({
            ...item,
            isSelected: checked,
        })));
    };

    const handleSelectItem = (index: number, checked: boolean) => {
        setDemandSheet(prev => {
            const updated = [...prev];
            updated[index] = {
                ...updated[index],
                isSelected: checked,
            };
            return updated;
        });
    };

    const handleAmountChange = (index: number, value: string) => {
        const amount = parseFloat(value) || 0;
        setDemandSheet(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], collectedAmount: amount };
            return updated;
        });
    };

    const handleLoanAdvanceChange = (index: number, value: string) => {
        const amount = parseFloat(value) || 0;
        setDemandSheet(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], loanAdvance: amount };
            return updated;
        });
    };

    // Step 1 -> Step 2: validate & stash the selected collections, then move to photo capture.
    // Nothing is persisted yet — the batch is only created once all 3 steps are done.
    const handleContinueToPhoto = async () => {
        // Validate form
        const isValid = await form.trigger();
        if (!isValid) {
            toast({
                title: 'Validation Error',
                description: 'Please fill in all required fields.',
                variant: 'destructive',
            });
            return;
        }

        const values = form.getValues();

        // Validate at least one collection — a client with only a loan advance
        // entered (collected amount left at 0) is a valid selection.
        const selectedCollections = demandSheet.filter(
            item => item.isSelected && (item.collectedAmount > 0 || item.loanAdvance > 0)
        );
        if (selectedCollections.length === 0) {
            toast({
                title: 'Validation Error',
                description: 'Please select at least one client with a collection amount or loan advance.',
                variant: 'destructive',
            });
            return;
        }

        // Validate no negative amounts
        const hasNegative = selectedCollections.some(item => item.collectedAmount < 0 || item.loanAdvance < 0);
        if (hasNegative) {
            toast({
                title: 'Validation Error',
                description: 'Collection amounts cannot be negative.',
                variant: 'destructive',
            });
            return;
        }

        const collections = demandSheet.map(item => ({
            clientId: item.clientId,
            loanId: item.loanId,
            amount: item.collectedAmount,
            loanAdvance: item.loanAdvance,
            isSelected: item.isSelected,
        }));

        const cashTotal = selectedCollections.reduce(
            (sum, item) => sum + item.collectedAmount + (item.loanAdvance || 0),
            0
        );

        setPendingSubmission({
            centerId: values.centerName,
            collectionDate: values.collectionDate,
            collectionType: values.collectionType,
            collections,
        });
        setPendingCashTotal(Number(cashTotal.toFixed(2)));
        setStep('photo');
    };

    const handlePhotoCaptured = (file: File) => {
        if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
        setMeetingPhotoFile(file);
        setMeetingPhotoPreviewUrl(URL.createObjectURL(file));
        setStep('denomination');

        // Soft GPS capture — recorded for audit only, never blocks the flow.
        setPhotoLocation(null);
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setPhotoLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => setPhotoLocation(null),
                { enableHighAccuracy: true, timeout: 8000 }
            );
        }
    };

    const handleDenomCountChange = (key: keyof DenominationCounts, value: string) => {
        setDenomCounts((prev) => ({ ...prev, [key]: value }));
    };

    const denomTotalEntered = Number(
        (
            calculateDenominationTotal(normalizeDenominationCounts(denomCounts)) +
            (Math.max(0, Number(denomUpi) || 0))
        ).toFixed(2)
    );
    const denomMatchesCollected = denominationMatchesFlooredCollection(denomTotalEntered, pendingCashTotal);

    const handleBackToCollect = () => setStep('collect');
    const handleBackToPhoto = () => setStep('photo');

    const resetWizardState = () => {
        setStep('collect');
        setPendingSubmission(null);
        setPendingCashTotal(0);
        if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
        setMeetingPhotoFile(null);
        setMeetingPhotoPreviewUrl(null);
        setPhotoLocation(null);
        setDenomCounts({ d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '' });
        setDenomUpi('');
    };

    // Step 3 -> Final submit: everything (collections + photo + denomination) goes to the
    // server together in one multipart request — nothing was persisted before this.
    const handleFinalSubmit = async () => {
        if (!pendingSubmission || !meetingPhotoFile) {
            toast({
                title: 'Error',
                description: 'Missing collection, photo or denomination data. Please restart the submission.',
                variant: 'destructive',
            });
            return;
        }

        if (!denomMatchesCollected) {
            toast({
                title: 'Denomination Mismatch',
                description: `Denomination total (${formatCurrency(denomTotalEntered)}) must match collected cash (${formatCurrency(pendingCashTotal)}).`,
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('centerId', pendingSubmission.centerId);
            formData.append('collectionDate', pendingSubmission.collectionDate);
            formData.append('collectionType', pendingSubmission.collectionType);
            formData.append('collections', JSON.stringify(pendingSubmission.collections));
            formData.append('denomination', JSON.stringify({
                ...normalizeDenominationCounts(denomCounts),
                upi: Math.max(0, Number(denomUpi) || 0),
            }));
            formData.append('photo', meetingPhotoFile);
            if (photoLocation) {
                formData.append('latitude', String(photoLocation.latitude));
                formData.append('longitude', String(photoLocation.longitude));
            }

            const result = await apiClient.post<BulkCollectionResponse>('/collections/bulk-collection', formData);

            if (result.success) {
                toast({
                    title: 'Success',
                    description: result.message || 'Collections submitted for Review.',
                });

                // Show detailed results
                if (result.data) {
                    const { successCount, failureCount, totalCollected, batchId } = result.data;
                    const warnings = (result.data as any)?.warnings as string[] | undefined;
                    toast({
                        title: 'Collection Summary',
                        description: [
                            `Batch ID: ${batchId}`,
                            `Successful: ${successCount}`,
                            `Failed: ${failureCount}`,
                            `Total Collected: ₹${totalCollected}`,
                            warnings?.length ? `Warnings: ${warnings.slice(0, 3).join(' | ')}${warnings.length > 3 ? ' ...' : ''}` : null,
                        ].filter(Boolean).join('\n'),
                    });
                }

                handleReset();
            } else {
                toast({
                    title: 'Submission Failed',
                    description: result.error || 'Failed to process bulk collection.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error processing bulk collection:', error);
            toast({
                title: 'Error',
                description: 'Failed to process bulk collection. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        form.reset({
            centerName: '',
            collectionDate: format(new Date(), 'yyyy-MM-dd'),
            collectionType: '',
        });
        setDemandSheet([]);
        resetWizardState();
        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    const allSelected = demandSheet.length > 0 && demandSheet.every(item => item.isSelected);
    const someSelected = demandSheet.some(item => item.isSelected) && !allSelected;

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Bulk Center Collection
                </h1>
                <p className="text-muted-foreground">
                    Record payments for an entire center in a single batch (Center Meeting style)
                </p>
            </div>

            {/* Filter Card */}
            {step === 'collect' && (
            <>
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <UsersRound className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Step 1 of 3 — Collection Context</CardTitle>
                            <CardDescription>
                                Select center, date, and collection type
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <Form {...form}>
                        <form className="space-y-6">
                            {isLoading ? (
                                <PageLoader label="Loading centers..." fullScreen={false} />
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    {/* Branch — visible only for Admin / Area Manager */}
                                    {isAdminOrAM ? (
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">Branch</Label>
                                            <Select
                                                value={selectedBranchId}
                                                onValueChange={setSelectedBranchId}
                                                disabled={isLoadingBranches || branches.length === 0}
                                            >
                                                <SelectTrigger className="h-11 w-full">
                                                    <SelectValue placeholder="-- SELECT BRANCH --" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {branches.map((b) => (
                                                        <SelectItem key={b.id} value={b.id}>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-medium">{b.name}</span>
                                                                <span className="text-muted-foreground">({b.code})</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">Branch</Label>
                                            <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                                                {branchName || 'Current Branch'}
                                            </div>
                                        </div>
                                    )}

                                    {/* Center Name */}
                                    <FormField
                                        control={form.control}
                                        name="centerName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Center Name *
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={centers.length === 0 || !selectedBranchId}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT CENTER --" />
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
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-medium">{center.name}</span>
                                                                        <span className="text-muted-foreground">({center.code})</span>
                                                                    </div>
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Collection Date */}
                                    <FormField
                                        control={form.control}
                                        name="collectionDate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Collection Date *
                                                </FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                        <DateInput
                                                            {...field}
                                                            className="h-11 pr-9"
                                                        />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Collection Type */}
                                    <FormField
                                        control={form.control}
                                        name="collectionType"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Collection Type *
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT TYPE --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {COLLECTION_TYPE_OPTIONS.map((type) => (
                                                            <SelectItem key={type.value} value={type.value}>
                                                                {type.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>

            {/* Demand Sheet Grid */}
            {isLoadingDemand ? (
                <Card>
                    <CardContent className="py-4">
                        <PageLoader label="Loading demand sheet..." fullScreen={false} />
                    </CardContent>
                </Card>
            ) : demandSheet.length > 0 ? (
                <>
                    {/* Batch Grid */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600" />

                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-emerald-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-xl">Demand Sheet</CardTitle>
                                    <CardDescription>
                                        {searchedRows.length} clients with pending dues
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-4 flex-wrap">
                                    <TableSearchInput
                                        value={tableSearchQuery}
                                        onChange={setTableSearchQuery}
                                        placeholder="Search demand sheet..."
                                    />
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            checked={allSelected}
                                            onCheckedChange={handleSelectAll}
                                            className="h-5 w-5"
                                        />
                                        <span className="text-sm font-medium">Select All</span>
                                    </div>
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead className="w-12">Select</TableHead>
                                            <TableHead>Client</TableHead>
                                            <TableHead className="min-w-[110px]">Mobile</TableHead>
                                            <TableHead>Loan No.</TableHead>
                                            <TableHead className="text-right">Loan Amt</TableHead>
                                            <TableHead className="text-right">Outstanding</TableHead>
                                            <TableHead className="text-right">Arrears</TableHead>
                                            <TableHead className="text-right">Current Due</TableHead>
                                            <TableHead className="text-right">Total Due</TableHead>
                                            <TableHead className="text-right">Collected</TableHead>
                                            {loanAdvanceEnabled && (
                                                <TableHead className="text-right text-emerald-700 dark:text-emerald-400">Loan Advance</TableHead>
                                            )}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.map((item) => {
                                            const index = demandSheet.findIndex((d) => d.loanId === item.loanId);
                                            return (
                                            <TableRow
                                                key={item.loanId}
                                                className={item.isSelected ? 'bg-green-50/50 dark:bg-green-950/20' : ''}
                                            >
                                                <TableCell>
                                                    <Checkbox
                                                        checked={item.isSelected}
                                                        onCheckedChange={(checked) => handleSelectItem(index, checked as boolean)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div>
                                                        <div className="font-medium">{item.clientName}</div>
                                                        <div className="text-xs text-muted-foreground">{item.clientCode}</div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="min-w-[110px] text-sm">{item.clientMobile || '—'}</TableCell>
                                                <TableCell>
                                                    <div className="text-sm">{item.loanNumber}</div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="font-medium">₹{item.loanAmount.toLocaleString()}</div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="font-medium">₹{item.loanOutstanding.toLocaleString()}</div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className={item.totalArrears > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                                                        ₹{item.totalArrears.toLocaleString()}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="font-medium">₹{item.totalCurrentDue.toLocaleString()}</div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="font-semibold text-primary dark:text-primary">
                                                        ₹{item.totalDue.toLocaleString()}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        value={item.collectedAmount}
                                                        onChange={(e) => handleAmountChange(index, e.target.value)}
                                                        disabled={!item.isSelected}
                                                        className="w-32 text-right font-semibold"
                                                    />
                                                </TableCell>
                                                {loanAdvanceEnabled && (
                                                    <TableCell className="text-right">
                                                        <Input
                                                            type="number"
                                                            step="0.01"
                                                            value={item.loanAdvance}
                                                            onChange={(e) => handleLoanAdvanceChange(index, e.target.value)}
                                                            disabled={!item.isSelected}
                                                            className="w-32 text-right font-semibold border-emerald-300"
                                                        />
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Sticky Summary Footer */}
                    <Card className="sticky bottom-0 z-10 border-2 border-green-200 dark:border-green-800 shadow-2xl">
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600" />
                        <CardContent className="py-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-8">
                                    <div className="flex items-center gap-2">
                                        <UsersRound className="h-5 w-5 text-primary" />
                                        <div>
                                            <div className="text-xs text-muted-foreground">Clients Selected</div>
                                            <div className="text-2xl font-bold">{summary.clientsCount}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <IndianRupee className="h-5 w-5 text-orange-600" />
                                        <div>
                                            <div className="text-xs text-muted-foreground">Total Expected</div>
                                            <div className="text-2xl font-bold text-orange-600">₹{summary.totalExpected.toLocaleString()}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <IndianRupee className="h-5 w-5 text-green-600" />
                                        <div>
                                            <div className="text-xs text-muted-foreground">Total Collecting</div>
                                            <div className="text-2xl font-bold text-green-600">₹{summary.totalCollecting.toLocaleString()}</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <Button
                                        type="button"
                                        onClick={handleReset}
                                        disabled={isSubmitting}
                                        variant="destructive"
                                        size="lg"
                                    >
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Reset
                                    </Button>

                                    <Button
                                        type="button"
                                        onClick={handleContinueToPhoto}
                                        disabled={!canCreateCollection || isSubmitting || summary.clientsCount === 0}
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                        size="lg"
                                    >
                                        <ArrowRight className="mr-2 h-4 w-4" />
                                        Continue to Photo
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </>
            ) : selectedCenterId && collectionDate ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <AlertCircle className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Pending Dues</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            No clients with pending dues found for the selected center and date.
                        </p>
                    </CardContent>
                </Card>
            ) : null}
            </>
            )}

            {/* Step 2: Meeting Photo */}
            {step === 'photo' && (
                <Card className="border-2 border-primary/20 shadow-xl">
                    <CardHeader>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Camera className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle>Step 2 of 3 — Meeting Photo</CardTitle>
                                <CardDescription>Capture a photo of the center meeting before entering the cash count</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {meetingPhotoPreviewUrl ? (
                            <div className="flex flex-col items-center gap-4">
                                <img
                                    src={meetingPhotoPreviewUrl}
                                    alt="Meeting photo preview"
                                    className="max-h-80 rounded-lg border object-contain"
                                />
                                <Button variant="outline" onClick={() => setCameraOpen(true)}>
                                    <Camera className="mr-2 h-4 w-4" />
                                    Retake Photo
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-12">
                                <ImageIcon className="h-10 w-10 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">No meeting photo captured yet</p>
                                <Button onClick={() => setCameraOpen(true)} className="bg-primary hover:bg-primary">
                                    <Camera className="mr-2 h-4 w-4" />
                                    Take Photo
                                </Button>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <Button variant="outline" onClick={handleBackToCollect} disabled={isSubmitting}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back
                            </Button>
                            {meetingPhotoFile && (
                                <Button onClick={() => setStep('denomination')} className="flex-1 bg-primary hover:bg-primary">
                                    <ArrowRight className="mr-2 h-4 w-4" />
                                    Continue to Denomination
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 3: Denomination Entry */}
            {step === 'denomination' && (
                <Card className="border-2 border-primary/20 shadow-xl">
                    <CardHeader>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <Banknote className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle>Step 3 of 3 — Cash Denomination</CardTitle>
                                <CardDescription>Count the physical cash collected and enter the note breakdown</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {DENOMINATION_ROW_ORDER.map((key) => (
                                <div key={key} className="space-y-1">
                                    <Label htmlFor={`denom-${key}`} className="text-xs text-muted-foreground">
                                        ₹{DENOMINATION_VALUES[key]}
                                    </Label>
                                    <Input
                                        id={`denom-${key}`}
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={denomCounts[key]}
                                        onChange={(e) => handleDenomCountChange(key, e.target.value)}
                                        className="text-right"
                                        disabled={isSubmitting}
                                    />
                                </div>
                            ))}
                            <div className="space-y-1">
                                <Label htmlFor="denom-upi" className="text-xs text-muted-foreground">UPI (₹)</Label>
                                <Input
                                    id="denom-upi"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={denomUpi}
                                    onChange={(e) => setDenomUpi(e.target.value)}
                                    className="text-right"
                                    disabled={isSubmitting}
                                />
                            </div>
                        </div>

                        <div className={cn(
                            "flex items-center justify-between rounded-lg border px-4 py-3",
                            denomMatchesCollected
                                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/30"
                                : "border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/30"
                        )}>
                            <div>
                                <p className="text-sm font-medium">
                                    Denomination Total: {formatCurrency(denomTotalEntered)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Must match collected cash: {formatCurrency(pendingCashTotal)}
                                </p>
                            </div>
                            {denomMatchesCollected ? (
                                <Badge className="bg-emerald-600 hover:bg-emerald-600">Matched</Badge>
                            ) : (
                                <Badge variant="destructive">Mismatch</Badge>
                            )}
                        </div>

                        <div className="flex gap-3">
                            <Button variant="outline" onClick={handleBackToPhoto} disabled={isSubmitting}>
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back
                            </Button>
                            <Button
                                onClick={handleFinalSubmit}
                                disabled={isSubmitting || !denomMatchesCollected}
                                className="flex-1 bg-primary hover:bg-primary"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="mr-2 h-4 w-4" />
                                        Approve Collection
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <CameraCapture
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={handlePhotoCaptured}
                label="Bulk Center Collection"
            />

            {/* Empty State */}
            {!isLoading && centers.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <UsersRound className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Centers Found</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            There are no active centers available. Please create a center first or check your branch selection.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
