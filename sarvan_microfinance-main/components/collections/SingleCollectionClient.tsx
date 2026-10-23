'use client';

import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
    UserCircle,
    RotateCcw,
    Loader2,
    CheckCircle2,
    CalendarDays,
    AlertTriangle,
    Camera,
    ArrowLeft,
    ArrowRight,
    Banknote,
    ImageIcon,
    // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
    // Printer,
} from 'lucide-react';
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
import { PageLoader } from '@/components/ui/page-loader';
// TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
// import {
//     Dialog,
//     DialogContent,
//     DialogHeader,
//     DialogTitle,
// } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { DateInput } from '@/components/ui/date-input';
// import { ReportHeader } from '@/components/reports/ReportHeader';

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

type Client = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    centerId: string;
    mobileNumber?: string | null;
    phone?: string | null;
    loanId?: string;
    loanNumber?: string;
    loanAmount?: number;
    loanOutstanding?: number;
    funderName?: string;
};

// A client/member can have more than one active loan — this is the shape of
// each entry in the loan switcher so they can be viewed/collected one by one.
type AvailableLoan = {
    loanId: string;
    loanNumber: string;
    loanAmount: number;
    productName?: string;
};

// Fixed default Loan Advance shown whenever a loan is (re)selected — the FDO
// can edit it freely, but it never auto-scales up from this default.
const DEFAULT_LOAN_ADVANCE = '100';

// Collection Type options
const COLLECTION_TYPE_OPTIONS = [
    { value: 'CASH_IN_HAND', label: 'CASH IN HAND' },
    { value: 'BANK', label: 'BANK' },
    { value: 'BANK_ACCOUNT_CSB', label: 'BANK ACCOUNT CSB' },
];

// TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
// type ReceiptData = {
//     clientName: string;
//     loanAcNo: string;
//     collectionType: string;
//     loanCollected: number;
//     loanAdvance: number;
//     totalCollected: number;
//     collectionDate: string;
// };

// Validation schema
const singleCollectionSchema = z.object({
    centerName: z.string().min(1, 'Center name is required'),
    collectionDate: z.string().min(1, 'Collection date is required'),
    disbursalDate: z.string().optional(),
    dueWeeks: z.string().optional(),
    interestBalance: z.string().optional(),
    collectionType: z.string().min(1, 'Collection type is required'),
    clientName: z.string().min(1, 'Client name is required'),
    loanId: z.string().min(1, 'Loan is required'),
    funderName: z.string().optional(),
    collWeeks: z.string().optional(),
    arrears: z.string().optional(),
    currentDue: z.string().optional(),
    totalDue: z.string().optional(),
    collected: z.string().optional(),
    loanAmount: z.string().optional(),
    loanOutstanding: z.string().optional(),
    loanAdvance: z.string().optional(),
});

type SingleCollectionFormValues = z.infer<typeof singleCollectionSchema>;

const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);

type PendingSingleSubmission = {
    clientId: string;
    loanId: string;
    collectionType: string;
    amount: number;
    loanAdvance: number;
    collectionDate: string;
};

export function SingleCollectionClient() {
    const { canPage } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const canCreateCollection = canPage('/dashboard/collections/client-late-collection/single-collection', 'add');
    const { toast } = useToast();

    // Branch state — Admin/Area Manager can pick any branch; others are locked to their own
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branchName, setBranchName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [centers, setCenters] = useState<Center[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loans, setLoans] = useState<AvailableLoan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
    // const [receipt, setReceipt] = useState<ReceiptData | null>(null);

    // Wizard: collect (existing form) -> photo (meeting photo capture) -> denomination (cash count)
    const [step, setStep] = useState<'collect' | 'photo' | 'denomination'>('collect');
    const [pendingSubmission, setPendingSubmission] = useState<PendingSingleSubmission | null>(null);
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

    const form = useForm<SingleCollectionFormValues>({
        resolver: zodResolver(singleCollectionSchema),
        defaultValues: {
            centerName: '',
            collectionDate: format(new Date(), 'yyyy-MM-dd'),
            disbursalDate: '',
            dueWeeks: '',
            interestBalance: '',
            collectionType: '',
            clientName: '',
            loanId: '',
            funderName: '',
            collWeeks: '',
            arrears: '',
            currentDue: '',
            totalDue: '',
            collected: '',
            loanAmount: '',
            loanOutstanding: '',
            loanAdvance: '',
        },
    });

    const selectedCenterId = form.watch('centerName');
    const selectedClientId = form.watch('clientName');
    const collectionDate = form.watch('collectionDate');

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

    // Fetch clients when center changes
    useEffect(() => {
        if (selectedCenterId) {
            fetchClients(selectedCenterId);
        } else {
            setClients([]);
            setLoans([]);
            form.setValue('clientName', '');
            form.setValue('loanId', '');
            form.setValue('funderName', '');
            form.setValue('loanAmount', '');
            form.setValue('loanOutstanding', '');
        }
    }, [selectedCenterId, form]);

    // When the client changes, only populate the Loan dropdown — no loan is
    // auto-selected. Loan Amt/Outstanding/Arrears/Current Due/Total Due/
    // Collected/Loan Advance stay blank until the FDO explicitly picks a loan.
    useEffect(() => {
        const client = clients.find((c) => c.id === selectedClientId);

        setLoans([]);
        form.setValue('loanId', '');
        form.setValue('funderName', '');
        form.setValue('loanAmount', '');
        form.setValue('loanOutstanding', '');
        form.setValue('disbursalDate', '');
        form.setValue('dueWeeks', '');
        form.setValue('interestBalance', '');
        form.setValue('arrears', '');
        form.setValue('currentDue', '');
        form.setValue('totalDue', '');
        form.setValue('collected', '');
        form.setValue('loanAdvance', '');

        if (client && client.loanId) {
            fetchLoanList(client.id);
        }
    }, [selectedClientId, clients, form]);

    // If the collection date changes after a loan has already been picked,
    // refresh that same loan's due amounts for the new date. Does nothing
    // until a loan is actually selected.
    useEffect(() => {
        const loanId = form.getValues('loanId');
        if (selectedClientId && loanId && collectionDate) {
            fetchLoanDetails(selectedClientId, collectionDate, loanId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collectionDate]);

    // A client/member can have multiple active loans. Selecting one from the
    // Loan dropdown is what triggers fetching/showing its due details — they
    // are viewed/collected one at a time, never all at once.
    const handleLoanChange = (loanId: string) => {
        if (selectedClientId && collectionDate) {
            fetchLoanDetails(selectedClientId, collectionDate, loanId);
        }
    };

    // Fetches just the list of a client's active loans, for the Loan dropdown
    // — does not select or fetch due details for any of them.
    const fetchLoanList = async (clientId: string) => {
        try {
            const result = await apiClient.get<any>(`/collections/single-collection?clientId=${clientId}`);
            if (result.success && result.data) {
                setLoans(Array.isArray(result.data.availableLoans) ? result.data.availableLoans : []);
            }
        } catch (error) {
            console.error('Error fetching loans:', error);
        }
    };

    const fetchLoanDetails = async (clientId: string, collectionDate: string, loanId: string) => {
        try {
            const result = await apiClient.get<any>(
                `/collections/single-collection?clientId=${clientId}&collectionDate=${collectionDate}&loanId=${loanId}`
            );

            if (result.success && result.data) {
                const data = result.data;

                // Set all loan details
                form.setValue('loanId', data.loanId || '');
                setLoans(Array.isArray(data.availableLoans) ? data.availableLoans : []);
                form.setValue('funderName', data.productName || '');
                form.setValue('disbursalDate', data.disbursementDate || '');
                form.setValue('dueWeeks', data.dueWeeks?.toString() || '');
                form.setValue('collWeeks', data.collectedWeeks?.toString() || '');
                form.setValue('interestBalance', data.interestBalance?.toString() || '');
                form.setValue('arrears', data.totalArrears?.toString() || '');
                form.setValue('currentDue', data.totalCurrentDue?.toString() || '');
                form.setValue('totalDue', data.totalDue?.toString() || '');
                form.setValue('loanAmount', data.loanAmount?.toString() || '');
                form.setValue('loanOutstanding', data.loanOutstanding?.toString() || '');
                // Pre-fill the collected amount with the total due for the selected
                // date, mirroring Bulk Collection's default-to-totalDue behavior.
                form.setValue('collected', data.totalDue?.toString() || '0');
                // Loan Advance defaults to a fixed ₹100 whenever a loan is
                // (re)selected — never auto-increases, but stays editable.
                form.setValue('loanAdvance', loanAdvanceEnabled ? DEFAULT_LOAN_ADVANCE : '');
            }
        } catch (error) {
            console.error('Error fetching loan details:', error);
            toast({
                title: 'Warning',
                description: 'Could not fetch complete loan details.',
                variant: 'default',
            });
        }
    };

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

    const fetchClients = async (centerId: string) => {
        setIsLoadingClients(true);
        try {
            const result = await apiClient.get<any>(
                `/clients?centerId=${centerId}&includeInactive=false&includeLoanInfo=true&pageSize=1000`
            );

            if (result.success && result.data) {
                // API returns { clients: [...], pagination: {...} }
                const clientsData = result.data.clients || result.data;
                setClients(Array.isArray(clientsData) ? clientsData : []);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load clients.',
                    variant: 'destructive',
                });
                setClients([]);
            }
        } catch (error) {
            console.error('Error fetching clients:', error);
            toast({
                title: 'Error',
                description: 'Failed to load clients. Please try again.',
                variant: 'destructive',
            });
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    };

    // Step 1 -> Step 2: validate & stash the collection, then move to photo capture.
    // Nothing is persisted yet — the batch is only created once all 3 steps are done.
    const onSubmit = async (values: SingleCollectionFormValues) => {
        const client = clients.find((c) => c.id === values.clientName);

        if (!client || !values.loanId) {
            toast({
                title: 'Error',
                description: 'Client or loan information not found.',
                variant: 'destructive',
            });
            return;
        }

        // Validate that an amount is entered
        const amount = parseFloat(values.collected || '0');
        const loanAdvanceAmount = parseFloat(values.loanAdvance || '0');
        if (amount <= 0 && loanAdvanceAmount <= 0) {
            toast({
                title: 'Validation Error',
                description: 'Please enter a collection amount.',
                variant: 'destructive',
            });
            return;
        }

        const collectionDate = values.collectionDate!;
        setPendingSubmission({
            clientId: client.id,
            loanId: values.loanId,
            collectionType: values.collectionType,
            amount,
            loanAdvance: loanAdvanceAmount,
            collectionDate,
        });
        setPendingCashTotal(Number((amount + loanAdvanceAmount).toFixed(2)));
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

    // Step 3 -> Final submit: everything (collection + photo + denomination) goes to the
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
            formData.append('clientId', pendingSubmission.clientId);
            formData.append('loanId', pendingSubmission.loanId);
            formData.append('collectionType', pendingSubmission.collectionType);
            formData.append('amount', String(pendingSubmission.amount));
            formData.append('loanAdvance', String(pendingSubmission.loanAdvance));
            formData.append('paymentMode', 'CASH');
            formData.append('collectionDate', pendingSubmission.collectionDate);
            formData.append('remarks', `Single collection - ${pendingSubmission.collectionType}`);
            formData.append('denomination', JSON.stringify({
                ...normalizeDenominationCounts(denomCounts),
                upi: Math.max(0, Number(denomUpi) || 0),
            }));
            formData.append('photo', meetingPhotoFile);
            if (photoLocation) {
                formData.append('latitude', String(photoLocation.latitude));
                formData.append('longitude', String(photoLocation.longitude));
            }

            const result = await apiClient.post('/collections/single-collection', formData);

            if (result.success) {
                const batchId = (result.data as any)?.batchId as string | undefined;
                toast({
                    title: 'Success',
                    description: batchId
                        ? `${result.message || 'Collection submitted for Review.'}\nBatch ID: ${batchId}`
                        : (result.message || 'Collection submitted for Review.'),
                });
                handleReset();
            } else {
                toast({
                    title: 'Submission Failed',
                    description: result.error || 'Failed to save single collection.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error saving single collection:', error);
            toast({
                title: 'Error',
                description: 'Failed to save single collection. Please try again.',
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
            disbursalDate: '',
            dueWeeks: '',
            interestBalance: '',
            collectionType: '',
            clientName: '',
            loanId: '',
            funderName: '',
            collWeeks: '',
            arrears: '',
            currentDue: '',
            totalDue: '',
            collected: '',
            loanAmount: '',
            loanOutstanding: '',
            loanAdvance: '',
        });
        setClients([]);
        setLoans([]);
        resetWizardState();
        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Client Collection
                </h1>
                <p className="text-muted-foreground">
                    Record collection details for a single client
                </p>
            </div>

            {/* Instruction Alert */}
            <Alert className="bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                    <span className="font-semibold">*</span> Use bulk collection for entering more than one client(s)
                </AlertDescription>
            </Alert>

            {/* Main Form Card */}
            {step === 'collect' && (
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <UserCircle className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Step 1 of 3 — Single Collection Details</CardTitle>
                            <CardDescription>
                                Enter collection information for a single client
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
                                                        Center Name
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        value={field.value}
                                                        disabled={centers.length === 0 || !selectedBranchId}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-11 w-full">
                                                                <SelectValue placeholder="-- SELECT --" />
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
                                                        Collection Date
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
                                                        Collection Type
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        value={field.value}
                                                        disabled={COLLECTION_TYPE_OPTIONS.length === 0}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-11 w-full">
                                                                <SelectValue placeholder="-- SELECT --" />
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

                                        {/* Client Name */}
                                        <FormField
                                            control={form.control}
                                            name="clientName"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Client Name
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        value={field.value}
                                                        disabled={!selectedCenterId || clients.length === 0 || isLoadingClients}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-11 w-full">
                                                                <SelectValue placeholder="-- SELECT --" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {isLoadingClients ? (
                                                                <div className="flex items-center justify-center py-2">
                                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                                    <span className="ml-2 text-sm text-muted-foreground">Loading clients...</span>
                                                                </div>
                                                            ) : clients.length === 0 ? (
                                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                    No clients available for this center
                                                                </div>
                                                            ) : (
                                                                clients.map((client) => (
                                                                    <SelectItem key={client.id} value={client.id}>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium">{client.firstName} {client.lastName}</span>
                                                                            <span className="text-muted-foreground">({client.clientId})</span>
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

                                        {/* Mobile Number — read-only, follows the selected client */}
                                        <FormItem>
                                            <FormLabel className="text-sm font-medium">Mobile Number</FormLabel>
                                            <Input
                                                readOnly
                                                value={(() => {
                                                    const c = clients.find((x) => x.id === selectedClientId);
                                                    return c?.mobileNumber || c?.phone || '';
                                                })()}
                                                placeholder="—"
                                                className="h-11 bg-muted/50"
                                            />
                                        </FormItem>

                                        {/* Loan No. — a member can have multiple active loans; this
                                            switches between them one at a time. */}
                                        <FormField
                                            control={form.control}
                                            name="loanId"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Loan No.
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={(value) => {
                                                            field.onChange(value);
                                                            handleLoanChange(value);
                                                        }}
                                                        value={field.value}
                                                        disabled={loans.length === 0}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-11 w-full">
                                                                <SelectValue placeholder="-- SELECT --" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {loans.length === 0 ? (
                                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                    No active loans
                                                                </div>
                                                            ) : (
                                                                loans.map((loan) => (
                                                                    <SelectItem key={loan.loanId} value={loan.loanId}>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium">{loan.loanNumber}</span>
                                                                            {loan.productName && (
                                                                                <span className="text-muted-foreground">({loan.productName})</span>
                                                                            )}
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

                                        {/* Loan Amount */}
                                        <FormField
                                            control={form.control}
                                            name="loanAmount"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Loan Amt
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            readOnly
                                                            disabled
                                                            className="bg-muted cursor-not-allowed h-11"
                                                            placeholder="0.00"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Loan Outstanding */}
                                        <FormField
                                            control={form.control}
                                            name="loanOutstanding"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Outstanding
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="number"
                                                            step="0.01"
                                                            readOnly
                                                            disabled
                                                            className="bg-muted cursor-not-allowed h-11"
                                                            placeholder="0.00"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Arrears */}
                                        <FormField
                                            control={form.control}
                                            name="arrears"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Arrears
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="number"
                                                            step="0.01"
                                                            readOnly
                                                            disabled
                                                            className="bg-muted cursor-not-allowed h-11"
                                                            placeholder="0.00"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Current Due */}
                                        <FormField
                                            control={form.control}
                                            name="currentDue"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Current Due
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="number"
                                                            step="0.01"
                                                            readOnly
                                                            disabled
                                                            className="bg-muted cursor-not-allowed h-11"
                                                            placeholder="0.00"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Total Due */}
                                        <FormField
                                            control={form.control}
                                            name="totalDue"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Total Due
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="number"
                                                            step="0.01"
                                                            readOnly
                                                            disabled
                                                            className="bg-muted cursor-not-allowed h-11"
                                                            placeholder="0.00"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Collected */}
                                        <FormField
                                            control={form.control}
                                            name="collected"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Collected
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            type="number"
                                                            step="0.01"
                                                            className="h-11"
                                                            placeholder="0.00"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Loan Advance */}
                                        {loanAdvanceEnabled && (
                                            <FormField
                                                control={form.control}
                                                name="loanAdvance"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                                            Loan Advance
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="number"
                                                                step="0.01"
                                                                className="h-11 border-emerald-300 focus:border-emerald-500"
                                                                placeholder="0.00"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}
                                    </div>

                                    {/* Additional Details */}
                                    <div className="pt-2 border-t">
                                        <h3 className="text-sm font-semibold text-muted-foreground mb-4 mt-4">
                                            Additional Details
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            {/* Funder Name */}
                                            <FormField
                                                control={form.control}
                                                name="funderName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Funder Name
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                readOnly
                                                                disabled
                                                                className="bg-muted cursor-not-allowed h-11"
                                                                placeholder="--"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Disbursal Date */}
                                            <FormField
                                                control={form.control}
                                                name="disbursalDate"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Disbursal Date
                                                        </FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                                <DateInput
                                                                    {...field}
                                                                    readOnly
                                                                    disabled
                                                                    className="bg-muted cursor-not-allowed h-11 pr-9"
                                                                />
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Due Weeks */}
                                            <FormField
                                                control={form.control}
                                                name="dueWeeks"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Due Weeks
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="number"
                                                                readOnly
                                                                disabled
                                                                className="bg-muted cursor-not-allowed h-11"
                                                                placeholder="0"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Interest Balance */}
                                            <FormField
                                                control={form.control}
                                                name="interestBalance"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Interest Balance
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="number"
                                                                step="0.01"
                                                                readOnly
                                                                disabled
                                                                className="bg-muted cursor-not-allowed h-11"
                                                                placeholder="0.00"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Coll Weeks */}
                                            <FormField
                                                control={form.control}
                                                name="collWeeks"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Coll Weeks
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="number"
                                                                readOnly
                                                                disabled
                                                                className="bg-muted cursor-not-allowed h-11"
                                                                placeholder="0"
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex flex-wrap gap-3 pt-4">
                                        <Button
                                            type="submit"
                                            disabled={!canCreateCollection || !form.formState.isValid}
                                            className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                            size="lg"
                                        >
                                            <ArrowRight className="mr-2 h-4 w-4" />
                                            Continue to Photo
                                        </Button>

                                        <Button
                                            type="button"
                                            onClick={handleReset}
                                            disabled={isSubmitting}
                                            variant="destructive"
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
                                <CardDescription>Capture a photo before entering the cash count</CardDescription>
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
                                <p className="text-sm text-muted-foreground">No photo captured yet</p>
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
                                        Submit Collection
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
                label="Single Collection"
            />

            {/* Empty State */}
            {!isLoading && centers.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <UserCircle className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Centers Found</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            There are no active centers available. Please create a center first or check your branch selection.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
            <Dialog open={!!receipt} onOpenChange={(open) => { if (!open) setReceipt(null); }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="text-center">Collection Receipt</DialogTitle>
                    </DialogHeader>
                    {receipt && (
                        <div className="space-y-3 text-sm">
                            <div className="border rounded p-3 space-y-2 font-mono text-xs">
                                <ReportHeader title="Collection Receipt" />
                                <div className="flex justify-between"><span>Client:</span><span>{receipt.clientName}</span></div>
                                <div className="flex justify-between"><span>Loan A/c:</span><span>{receipt.loanAcNo}</span></div>
                                <div className="flex justify-between"><span>Date:</span><span>{receipt.collectionDate}</span></div>
                                <div className="flex justify-between"><span>Mode:</span><span>{receipt.collectionType.replace(/_/g, ' ')}</span></div>
                                <div className="border-t pt-2 space-y-1">
                                    {receipt.loanCollected > 0 && (
                                        <div className="flex justify-between"><span>Loan Collected:</span><span>₹{receipt.loanCollected.toFixed(2)}</span></div>
                                    )}
                                    {receipt.loanAdvance > 0 && (
                                        <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>Loan Advance:</span><span>₹{receipt.loanAdvance.toFixed(2)}</span></div>
                                    )}
                                    <div className="flex justify-between font-bold border-t pt-1"><span>Total:</span><span>₹{receipt.totalCollected.toFixed(2)}</span></div>
                                </div>
                            </div>
                            <Button
                                className="w-full"
                                onClick={() => window.print()}
                                variant="outline"
                            >
                                <Printer className="mr-2 h-4 w-4" />
                                Print Receipt
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
            */}
        </div>
    );
}

