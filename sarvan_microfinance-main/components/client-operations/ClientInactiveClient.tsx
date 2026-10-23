'use client';

import { useState, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
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
    UserX,
    CheckCircle2,
    RotateCcw,
    Loader2,
    X,
    CalendarDays,
    Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { PageLoader } from '@/components/ui/page-loader';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { DateInput } from '@/components/ui/date-input';

import { matchesMemberSearch } from '@/app/lib/reports/member-contact-columns';
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
    otherIdNo?: string | null;
    mobileNumber?: string | null;
    centerId: string;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
};

// Inactive reason options
const INACTIVE_REASON_OPTIONS = [
    { value: 'loan_closed', label: 'Loan Closed' },
    { value: 'client_request', label: 'Self Requested' },
    { value: 'default', label: 'Default' },
    { value: 'death', label: 'Death' },
    { value: 'relocation', label: 'Relocation' },
    { value: 'other', label: 'Other' },
];

// Validation schema
const clientInactiveSchema = z.object({
    centerName: z.string().min(1, 'Center name is required'),
    clientName: z.string().min(1, 'Name is required'),
    clientId: z.string().optional(),
    clientNameDisplay: z.string().optional(),
    lastLoanClosedDate: z.string().optional(),
    inactiveDate: z.string().min(1, 'Inactive date is required'),
    inactiveReason: z.string().min(1, 'Inactive reason is required'),
});

type ClientInactiveFormValues = z.infer<typeof clientInactiveSchema>;

export function ClientInactiveClient() {
    const { canPage } = usePermission();
    const canEditClient = canPage('/dashboard/client-operations/inactive', 'edit');
    const { toast } = useToast();
    const router = useRouter();

    // Branch state — Admin/Area Manager can pick any branch; others are locked to their own
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branchName, setBranchName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [centers, setCenters] = useState<Center[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [clientSearch, setClientSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const filteredClients = useMemo(() => {
        const q = clientSearch.trim().toLowerCase();
        if (!q) return clients;
        return clients.filter((c) =>
            matchesMemberSearch(q, { aadhaarNumber: c.otherIdNo, mobileNumber: c.mobileNumber }, c.clientId, `${c.firstName} ${c.lastName}`)
        );
    }, [clients, clientSearch]);

    // Get today's date in YYYY-MM-DD format
    const getTodayDate = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const form = useForm<ClientInactiveFormValues>({
        resolver: zodResolver(clientInactiveSchema),
        defaultValues: {
            centerName: '',
            clientName: '',
            clientId: '',
            clientNameDisplay: '',
            lastLoanClosedDate: '',
            inactiveDate: getTodayDate(),
            inactiveReason: '',
        },
    });

    const selectedCenterId = form.watch('centerName');
    const selectedClientId = form.watch('clientName');

    useEffect(() => {
        loadBranches();
    }, []);

    useEffect(() => {
        if (selectedBranchId) {
            form.setValue('centerName', '');
            setCenters([]);
            fetchCenters(selectedBranchId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId]);

    useEffect(() => {
        if (selectedCenterId) {
            fetchClients(selectedCenterId);
        } else {
            setClients([]);
            form.setValue('clientName', '');
            form.setValue('clientId', '');
            form.setValue('clientNameDisplay', '');
        }
        setClientSearch('');
    }, [selectedCenterId, form]);

    useEffect(() => {
        if (selectedClientId) {
            const client = clients.find((c) => c.id === selectedClientId);
            if (client) {
                form.setValue('clientId', client.clientId);
                form.setValue('clientNameDisplay', `${client.firstName} ${client.lastName}`.trim());
            }
        } else {
            form.setValue('clientId', '');
            form.setValue('clientNameDisplay', '');
        }
    }, [selectedClientId, clients, form]);

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
                `/clients?centerId=${centerId}&includeInactive=false`
            ).catch(() => {
                // Fallback to empty array if endpoint doesn't exist yet
                return { success: true, data: [] };
            });

            if (result.success && result.data) {
                // Handle both array and object response structures
                const clientsData = Array.isArray(result.data) 
                    ? result.data 
                    : result.data.clients || [];
                setClients(clientsData);
            } else {
                toast({
                    title: 'Warning',
                    description: 'No clients found for the selected center.',
                    variant: 'default',
                });
                setClients([]);
            }
        } catch (error) {
            console.error('Error fetching clients:', error);
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    };

   const onSubmit = async (values: ClientInactiveFormValues) => {
    setIsSubmitting(true);
    try {
        const selected = clients.find((c) => c.id === values.clientName);
        const result = await apiClient.post('/client-operations/inactive', {
            clientId: values.clientName, // clientName holds the client's internal ID
            centerId: values.centerName, // centerName holds the center's internal ID
            lastLoanClosedDate: values.lastLoanClosedDate || undefined,
            inactiveDate: values.inactiveDate,
            inactiveReason: values.inactiveReason,
        });

        if (result.success) {
            toast({
                title: 'Success',
                description: `${getPersonLabel(!!selected?.hasLoan).singular} marked as inactive successfully.`,
            });

            // Reset form after successful submission
            handleReset();
        } else {
                    toast({
                title: 'Error',
                description: result.error || 'Failed to mark client as inactive. Please try again.',
                variant: 'destructive',
            });
        }
    } catch (error: any) {
        console.error('Error marking client as inactive:', error);
        
        let errorMessage = 'Failed to mark client as inactive. Please try again.';
        
        if (error?.response?.data?.error) {
            errorMessage = error.response.data.error;
        } else if (error?.message) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }
        
        toast({
            title: 'Error',
            description: errorMessage,
            variant: 'destructive',
        });
    } finally {
        setIsSubmitting(false);
    }
};

    const handleReset = () => {
        form.reset({
            centerName: '',
            clientName: '',
            clientId: '',
            clientNameDisplay: '',
            lastLoanClosedDate: '',
            inactiveDate: getTodayDate(),
            inactiveReason: '',
        });
        setClients([]);

        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    const handleClose = () => {
        router.back();
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Client Inactive
                </h1>
                <p className="text-muted-foreground">
                    Mark clients as inactive and specify the reason and date
                </p>
            </div>

            {/* Main Form Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-600 to-amber-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-red-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                            <UserX className="h-5 w-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Inactive Details</CardTitle>
                            <CardDescription>
                                Select client and provide inactive reason and date
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {isLoading ? (
                                <PageLoader label="Loading..." fullScreen={false} />
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

                                    {/* Member/Client Search */}
                                    <FormItem>
                                        <FormLabel className="text-sm font-medium">
                                            Search Member / Client
                                        </FormLabel>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                value={clientSearch}
                                                onChange={(e) => setClientSearch(e.target.value)}
                                                placeholder="ID (e.g. 34-1-1-1), name, Aadhaar or mobile…"
                                                disabled={!selectedCenterId || isLoadingClients}
                                                className="h-11 pl-9"
                                            />
                                        </div>
                                    </FormItem>

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
                                                    disabled={!selectedCenterId || isLoadingClients || clients.length === 0}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {isLoadingClients ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                Loading clients...
                                                            </div>
                                                        ) : clients.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                No clients available
                                                            </div>
                                                        ) : filteredClients.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                No clients match &quot;{clientSearch}&quot;
                                                            </div>
                                                        ) : (
                                                            filteredClients.map((client) => (
                                                                <SelectItem key={client.id} value={client.id}>
                                                                    {`${client.firstName} ${client.lastName}`.trim()} ({client.clientId})
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Client Id */}
                                    <FormField
                                        control={form.control}
                                        name="clientId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Client Id
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        className="h-11 bg-muted cursor-not-allowed"
                                                        readOnly
                                                        disabled
                                                        placeholder="--"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Client Name Display */}
                                    <FormField
                                        control={form.control}
                                        name="clientNameDisplay"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Client Name
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        className="h-11 bg-muted cursor-not-allowed"
                                                        readOnly
                                                        disabled
                                                        placeholder="--"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Last Loan Closed Date */}
                                    <FormField
                                        control={form.control}
                                        name="lastLoanClosedDate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Last Loan Closed Date
                                                </FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                        <DateInput
                                                            {...field}
                                                            className="h-11 w-full pr-9"
                                                            placeholder="Select date"
                                                        />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Inactive Date */}
                                    <FormField
                                        control={form.control}
                                        name="inactiveDate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Inactive Date
                                                </FormLabel>
                                                <FormControl>
                                                    <div className="relative">
                                                        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                        <DateInput
                                                            {...field}
                                                            className="h-11 w-full pr-9"
                                                            placeholder="Select date"
                                                        />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Inactive Reason */}
                                    <FormField
                                        control={form.control}
                                        name="inactiveReason"
                                        render={({ field }) => (
                                            <FormItem className="md:col-span-2">
                                                <FormLabel className="text-sm font-medium">
                                                    Inactive Reason
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {INACTIVE_REASON_OPTIONS.map((reason) => (
                                                            <SelectItem key={reason.value} value={reason.value}>
                                                                {reason.label}
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

                            {/* Action Buttons */}
                            {!isLoading && (
                                <>
                                    <div className="flex flex-wrap gap-3 pt-4">
                                        <Button
                                            type="submit"
                                            disabled={!canEditClient || isSubmitting}
                                            className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                            size="lg"
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Processing...
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                                    Inactive
                                                </>
                                            )}
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

                                    <div className="pt-2">
                                        <Button
                                            type="button"
                                            onClick={handleClose}
                                            disabled={isSubmitting}
                                            variant="outline"
                                            className="w-full bg-primary hover:bg-primary text-white border-primary"
                                            size="lg"
                                        >
                                            <X className="mr-2 h-4 w-4" />
                                            Close
                                        </Button>
                                    </div>
                                </>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}

