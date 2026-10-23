'use client';

import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    XCircle,
    RotateCcw,
    Loader2,
    Save,
    Trash2,
    CalendarDays,
    Phone,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { Badge } from '@/components/ui/badge';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

type ForeclosureRequestSummary = {
    id: string;
    status: 'INITIATED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    initiatedAt: string;
    initiatedBy: { id: string; firstName: string; lastName: string; role: string };
} | null;

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
    phone?: string | null;
    mobileNumber?: string | null;
    loanId?: string | null;
    loanAccountNo?: string | null;
    loanNumber?: string | null;
    loanAmount?: number | null;
    disbursalDate?: string | null;
};

// Payment Mode options - Only Cash in Hand for now
const PAYMENT_MODE_OPTIONS = [
    { value: 'CASH', label: 'Cash in Hand' },
];

// Validation schema
const foreclosureSchema = z.object({
    centerName: z.string().min(1, 'Center name is required'),
    phoneNumber: z.string().optional(),
    collInWeeks: z.string().optional(), // Coll. In Weeks
    arrearInterest: z.string().optional(),
    amountCollected: z.string().min(1, 'Amount collected is required'),
    clientName: z.string().min(1, 'Client name is required'),
    disbursalDate: z.string().optional(),
    osPrincipal: z.string().optional(), // O/S Principal
    toBeCollPri: z.string().optional(), // To Be Coll Pri.
    loanAcNo: z.string().optional(), // Loan A/c No.
    loanAmount: z.string().optional(),
    osInterest: z.string().optional(), // O/S Interest
    toBeCollInt: z.string().optional(), // To Be Coll Int.
    paymentMode: z.string().min(1, 'Payment mode is required'),
    dueInWeeks: z.string().optional(),
    arrearPrincipal: z.string().optional(),
    toBeCollTotal: z.string().optional(), // To Be Coll Total
    collectionDate: z.string().optional(), // Branch's EOD working date
});

type ForeclosureFormValues = z.infer<typeof foreclosureSchema>;

export function ForeclosureClient() {
    const { canPage } = usePermission();
    const canCreateCollection = canPage('/dashboard/collections/foreclosure', 'add');
    const canDeleteCollection  = canPage('/dashboard/collections/foreclosure', 'delete');
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
    const [activeLoans, setActiveLoans] = useState<Array<{ id: string; loanNumber: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [activeLoanId, setActiveLoanId] = useState<string | null>(null); // Store the correct loan ID from API
    const [foreclosureRequest, setForeclosureRequest] = useState<ForeclosureRequestSummary>(null);

    const form = useForm<ForeclosureFormValues>({
        resolver: zodResolver(foreclosureSchema),
        defaultValues: {
            centerName: '',
            phoneNumber: '',
            collInWeeks: '',
            arrearInterest: '',
            amountCollected: '',
            clientName: '',
            disbursalDate: '',
            osPrincipal: '',
            toBeCollPri: '',
            loanAcNo: '',
            loanAmount: '',
            osInterest: '',
            toBeCollInt: '',
            paymentMode: 'CASH', // Default to Cash in Hand
            dueInWeeks: '',
            arrearPrincipal: '',
            toBeCollTotal: '',
            collectionDate: '',
        },
    });

    const selectedCenterId = form.watch('centerName');
    const selectedClientId = form.watch('clientName');
    const selectedLoanNumber = form.watch('loanAcNo');

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
            fetchBranchWorkingDate(selectedBranchId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    // Fetch clients when center changes
    useEffect(() => {
        if (selectedCenterId) {
            fetchClients(selectedCenterId);
        } else {
            setClients([]);
            setActiveLoans([]);
            form.setValue('clientName', '');
            form.setValue('phoneNumber', '');
            form.setValue('loanAcNo', '');
            form.setValue('loanAmount', '');
            form.setValue('disbursalDate', '');
        }
    }, [selectedCenterId, form]);

    // Fetch loans when client changes
    useEffect(() => {
        const client = clients.find((c) => c.id === selectedClientId);
        if (client) {
            // Set phone number from client
            form.setValue('phoneNumber', client.mobileNumber || client.phone || '');

            // Fetch all active loans for this client
            fetchClientLoans(client.id);
        } else {
            // Clear all fields
            setActiveLoans([]);
            form.setValue('phoneNumber', '');
            form.setValue('loanAcNo', '');
            form.setValue('loanAmount', '');
            form.setValue('disbursalDate', '');
            form.setValue('osPrincipal', '');
            form.setValue('osInterest', '');
            form.setValue('arrearPrincipal', '');
            form.setValue('arrearInterest', '');
            form.setValue('toBeCollPri', '');
            form.setValue('toBeCollInt', '');
            form.setValue('toBeCollTotal', '');
            form.setValue('amountCollected', '');
            form.setValue('dueInWeeks', '');
            form.setValue('collInWeeks', '');
            setActiveLoanId(null);
            setForeclosureRequest(null);
        }
    }, [selectedClientId, clients, form]);

    // Fetch foreclosure details when loan is selected
    useEffect(() => {
        if (selectedLoanNumber && selectedClientId) {
            const selectedLoan = activeLoans.find(loan => loan.loanNumber === selectedLoanNumber);
            if (selectedLoan) {
                setActiveLoanId(selectedLoan.id);
                fetchForeclosureDetails(selectedClientId, selectedLoan.id);
                fetchForeclosureRequestStatus(selectedLoan.id);
            }
        } else {
            // Clear foreclosure details
            form.setValue('loanAmount', '');
            form.setValue('disbursalDate', '');
            form.setValue('osPrincipal', '');
            form.setValue('osInterest', '');
            form.setValue('arrearPrincipal', '');
            form.setValue('arrearInterest', '');
            form.setValue('toBeCollPri', '');
            form.setValue('toBeCollInt', '');
            form.setValue('toBeCollTotal', '');
            form.setValue('amountCollected', '');
            form.setValue('dueInWeeks', '');
            form.setValue('collInWeeks', '');
            setActiveLoanId(null);
            setForeclosureRequest(null);
        }
    }, [selectedLoanNumber, selectedClientId, activeLoans, form]);

    const fetchClientLoans = async (clientId: string) => {
        setIsLoadingLoans(true);
        try {
            const result = await apiClient.get<any>(`/clients/${clientId}/loans?status=active&simple=true`);

            if (result.success && result.data) {
                setActiveLoans(result.data);
            }
        } catch (error) {
            toast({
                title: 'Warning',
                description: 'Could not fetch client loans.',
                variant: 'default',
            });
            setActiveLoans([]);
        } finally {
            setIsLoadingLoans(false);
        }
    };

    const fetchForeclosureDetails = async (clientId: string, loanId: string) => {
        try {
            const result = await apiClient.get<any>(`/collections/foreclosure?clientId=${clientId}&loanId=${loanId}`);

            if (result.success && result.data) {
                const data = result.data;

                // Set loan details from API
                if (data.disbursementDate) {
                    form.setValue('disbursalDate', data.disbursementDate);
                }
                if (data.loanAmount) {
                    form.setValue('loanAmount', data.loanAmount.toString());
                }

                // Set all foreclosure details
                form.setValue('osPrincipal', data.osPrincipal?.toString() || '0');
                form.setValue('osInterest', data.osInterest?.toString() || '0');
                form.setValue('arrearPrincipal', data.arrearPrincipal?.toString() || '0');
                form.setValue('arrearInterest', data.arrearInterest?.toString() || '0');

                // Pre-fill "To Be Collected" fields with foreclosure amounts
                form.setValue('toBeCollPri', data.toBeCollPrincipal?.toString() || '0');
                form.setValue('toBeCollInt', data.toBeCollInterest?.toString() || '0');
                form.setValue('toBeCollTotal', data.toBeCollTotal?.toString() || '0');

                // Auto-fill amount collected with total foreclosure amount
                form.setValue('amountCollected', data.toBeCollTotal?.toString() || '0');

                // Set weeks data
                form.setValue('dueInWeeks', data.dueWeeks?.toString() || '0');
                form.setValue('collInWeeks', data.collectedWeeks?.toString() || '0');

                // setValue above doesn't recompute formState.isValid on its own —
                // without this, the Save button stays disabled even once every
                // required field (e.g. amountCollected) has been auto-filled.
                form.trigger();
            }
        } catch (error) {
            toast({
                title: 'Warning',
                description: 'Could not fetch complete preclosure details.',
                variant: 'default',
            });
        }
    };

    const fetchForeclosureRequestStatus = async (loanId: string) => {
        try {
            const result = await apiClient.get<{ request: ForeclosureRequestSummary }>(
                `/foreclosures/by-loan?loanId=${loanId}`
            );
            if (result.success && result.data) {
                setForeclosureRequest(result.data.request);
                return;
            }
            setForeclosureRequest(null);
        } catch {
            setForeclosureRequest(null);
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

    // Resolve the selected branch's current EOD working date server-side,
    // so the foreclosure transaction is recorded against that branch's
    // working day rather than the browser's local date.
    const fetchBranchWorkingDate = async (branchId: string) => {
        if (!branchId) return;
        try {
            const result = await apiClient.get<{ workingDateYmd: string }>(
                `/branches/${branchId}/working-date`
            );
            if (result.success && result.data?.workingDateYmd) {
                form.setValue('collectionDate', result.data.workingDateYmd);
            }
        } catch {
            // Non-fatal — submit falls back to client-side today if unset.
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
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        } catch (error) {
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
                // Filter only clients with active loans
                const clientsWithLoans = Array.isArray(clientsData)
                    ? clientsData.filter((c: any) => c.loanId)
                    : [];
                setClients(clientsWithLoans);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load clients.',
                    variant: 'destructive',
                });
                setClients([]);
            }
        } catch (error) {
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

    const onSubmit = async (values: ForeclosureFormValues) => {
        if (foreclosureRequest?.status === 'PENDING_APPROVAL') {
            toast({
                title: 'Already Submitted',
                description: 'This preclosure is already pending approval.',
                variant: 'default',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const client = clients.find((c) => c.id === values.clientName);

            if (!client || !client.loanId) {
                toast({
                    title: 'Error',
                    description: 'Client or loan information not found.',
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            // Validate that amount collected is provided
            const amountCollected = parseFloat(values.amountCollected || '0');
            if (amountCollected <= 0) {
                toast({
                    title: 'Validation Error',
                    description: 'Please enter the amount collected.',
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            // Validate that amount collected equals total due
            const totalDue = parseFloat(values.toBeCollTotal || '0');
            const tolerance = 0.01; // Allow 1 paisa tolerance for rounding
            if (Math.abs(amountCollected - totalDue) > tolerance) {
                toast({
                    title: 'Validation Error',
                    description: `Amount collected (₹${amountCollected}) must equal total preclosure amount (₹${totalDue.toFixed(2)})`,
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            // Validate payment mode is selected
            if (!values.paymentMode) {
                toast({
                    title: 'Validation Error',
                    description: 'Please select a payment mode.',
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            // Validate that we have the correct loan ID
            if (!activeLoanId) {
                toast({
                    title: 'Error',
                    description: 'Loan information not loaded. Please select the client again.',
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            const result = await apiClient.post('/collections/foreclosure', {
                clientId: client.id,
                loanId: activeLoanId, // Use the loan ID from the foreclosure API response
                paymentMode: values.paymentMode,
                amountCollected: amountCollected,
                // Server resolves the branch EOD working date itself when this is unset —
                // never fall back to the browser's calendar date.
                collectionDate: values.collectionDate || undefined,
                remarks: `Loan preclosure - Full settlement`,
            });

            if (result.success) {
                toast({
                    title: 'Success',
                    description: result.message || 'Preclosure submitted for approval.',
                });
                handleReset();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to process preclosure.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to process preclosure. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteClick = () => {
        const clientName = form.watch('clientName');
        if (!clientName) {
            toast({
                title: 'No Selection',
                description: 'Please select a client before deleting.',
                variant: 'destructive',
            });
            return;
        }
        setDeleteDialogOpen(true);
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const values = form.getValues();
            // TODO: Replace with actual API call to delete foreclosure
            // Example: await apiClient.delete(`/collections/foreclosure/${values.clientName}`);
            await new Promise((resolve) => setTimeout(resolve, 1500));

            toast({
                title: 'Success',
                description: 'Loan preclosure deleted successfully.',
            });

            handleReset();
            setDeleteDialogOpen(false);
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to delete preclosure. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReset = () => {
        form.reset({
            centerName: '',
            phoneNumber: '',
            collInWeeks: '',
            arrearInterest: '',
            amountCollected: '',
            clientName: '',
            disbursalDate: '',
            osPrincipal: '',
            toBeCollPri: '',
            loanAcNo: '',
            loanAmount: '',
            osInterest: '',
            toBeCollInt: '',
            paymentMode: 'CASH', // Default to Cash in Hand
            dueInWeeks: '',
            arrearPrincipal: '',
            toBeCollTotal: '',
            collectionDate: '',
        });
        setActiveLoanId(null); // Clear the active loan ID
        setForeclosureRequest(null);
        setDeleteDialogOpen(false);
        setClients([]);
        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    const isPendingApproval = foreclosureRequest?.status === 'PENDING_APPROVAL';

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Loan Preclosure
                </h1>
                <p className="text-muted-foreground">
                    Record and manage loan preclosure details
                </p>
                {isPendingApproval && foreclosureRequest ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Badge variant="secondary">Pending Approval</Badge>
                        <span className="text-xs text-muted-foreground">
                            Submitted on {toDisplayDateTime(new Date(foreclosureRequest.initiatedAt))}
                        </span>
                    </div>
                ) : null}
            </div>

            {/* Main Form Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <XCircle className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Loan Preclosure Details</CardTitle>
                            <CardDescription>
                                Enter preclosure information for loan closure
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
                                        {/* Column 1 */}
                                        <div className="space-y-6">
                                            {/* Branch — visible only for Admin / Area Manager */}
                                            {isAdminOrAM ? (
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Branch</Label>
                                                    <Select
                                                        value={selectedBranchId}
                                                        onValueChange={setSelectedBranchId}
                                                        disabled={isLoadingBranches || branches.length === 0 || isPendingApproval}
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

                                             {/* Payment Mode */}
                                            <FormField
                                                control={form.control}
                                                name="paymentMode"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Payment Mode
                                                        </FormLabel>
                                                        <Select
                                                            onValueChange={field.onChange}
                                                            value={field.value}
                                                            disabled={PAYMENT_MODE_OPTIONS.length === 0}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger className="h-11 w-full">
                                                                    <SelectValue placeholder="-- SELECT --" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {PAYMENT_MODE_OPTIONS.map((mode) => (
                                                                    <SelectItem key={mode.value} value={mode.value}>
                                                                        {mode.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Foreclosure Date — resolved from the selected branch's EOD working date */}
                                            <FormField
                                                control={form.control}
                                                name="collectionDate"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Preclosure Date
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

                                            {/* Phone Number */}
                                            <FormField
                                                control={form.control}
                                                name="phoneNumber"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Phone Number
                                                        </FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                                <Input
                                                                    {...field}
                                                                    type="tel"
                                                                    className="h-11 pl-9"
                                                                    placeholder="--"
                                                                    readOnly
                                                                    disabled
                                                                />
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Coll. In Weeks */}
                                            <FormField
                                                control={form.control}
                                                name="collInWeeks"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Coll. In Weeks
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

                                        {/* Column 2 */}
                                        <div className="space-y-6">

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
                                                            disabled={centers.length === 0 || isPendingApproval || !selectedBranchId}
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

                                            {/* O/S Principal */}
                                            <FormField
                                                control={form.control}
                                                name="osPrincipal"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            O/S Principal
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

                                            {/* To Be Coll Pri. */}
                                            <FormField
                                                control={form.control}
                                                name="toBeCollPri"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            To Be Coll Pri.
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

                                            {/* Arrear Interest */}
                                            <FormField
                                                control={form.control}
                                                name="arrearInterest"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Arrear Interest
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

                                        </div>

                                        {/* Column 3 */}
                                        <div className="space-y-6">
                                            
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
                                                            disabled={!selectedCenterId || clients.length === 0 || isLoadingClients || isPendingApproval}
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
                                            

                                            {/* Loan Amount */}
                                            <FormField
                                                control={form.control}
                                                name="loanAmount"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Loan Amount
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

                                            {/* O/S Interest */}
                                            <FormField
                                                control={form.control}
                                                name="osInterest"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            O/S Interest
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

                                            {/* To Be Coll Int. */}
                                            <FormField
                                                control={form.control}
                                                name="toBeCollInt"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            To Be Coll Int.
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

                                             {/* Amount Collected */}
                                            <FormField
                                                control={form.control}
                                                name="amountCollected"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Amount Collected
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="number"
                                                                step="0.01"
                                                                className="h-11"
                                                                placeholder="0.00"
                                                                disabled={isPendingApproval}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            
                                        </div>

                                        {/* Column 4 */}
                                        <div className="space-y-6">
                                            
                                            {/* Loan A/c No. - Dropdown to select which loan to foreclose */}
                                            <FormField
                                                control={form.control}
                                                name="loanAcNo"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Loan A/c No. <span className="text-red-500">*</span>
                                                        </FormLabel>
                                                        <Select
                                                            onValueChange={field.onChange}
                                                            value={field.value}
                                                            disabled={isLoadingLoans || activeLoans.length === 0 || isPendingApproval}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger className="h-11">
                                                                    <SelectValue placeholder={
                                                                        isLoadingLoans
                                                                            ? "Loading loans..."
                                                                            : activeLoans.length === 0
                                                                                ? "No active loans"
                                                                                : "Select loan to foreclose"
                                                                    } />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {activeLoans.map((loan) => (
                                                                    <SelectItem key={loan.id} value={loan.loanNumber}>
                                                                        {loan.loanNumber}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            {/* Due In Weeks */}
                                            <FormField
                                                control={form.control}
                                                name="dueInWeeks"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Due In Weeks
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

                                            {/* Arrear Principal */}
                                            <FormField
                                                control={form.control}
                                                name="arrearPrincipal"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            Arrear Principal
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

                                            {/* To Be Coll Total */}
                                            <FormField
                                                control={form.control}
                                                name="toBeCollTotal"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-medium">
                                                            To Be Coll Total
                                                        </FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                type="number"
                                                                step="0.01"
                                                                readOnly
                                                                disabled
                                                                className="bg-muted cursor-not-allowed h-11 font-semibold"
                                                                placeholder="0.00"
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
                                            disabled={!canCreateCollection || isSubmitting || !form.formState.isValid || isPendingApproval}
                                            className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                            size="lg"
                                        >
                                            {isSubmitting ? (
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
                                            onClick={handleDeleteClick}
                                            disabled={!canDeleteCollection || isDeleting || !selectedClientId || isPendingApproval}
                                            variant="destructive"
                                            className="flex-1 min-w-[120px] bg-red-500 hover:bg-red-600 text-white"
                                            size="lg"
                                        >
                                            {isDeleting ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Deleting...
                                                </>
                                            ) : (
                                                <>
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Delete
                                                </>
                                            )}
                                        </Button>

                                        <Button
                                            type="button"
                                            onClick={handleReset}
                                            disabled={isSubmitting || isDeleting}
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

            {/* Empty State */}
            {!isLoading && centers.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <XCircle className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Centers Found</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            There are no active centers available. Please create a center first or check your branch selection.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                onConfirm={handleDelete}
                title="Delete Loan Preclosure"
                description="Are you sure you want to delete this loan preclosure record? This action cannot be undone."
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}

