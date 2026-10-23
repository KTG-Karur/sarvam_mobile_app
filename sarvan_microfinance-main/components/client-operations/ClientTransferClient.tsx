'use client';

import { useState, useEffect, useMemo } from 'react';
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
    ArrowLeftRight,
    CheckCircle2,
    RotateCcw,
    Loader2,
    Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageLoader } from '@/components/ui/page-loader';

import { matchesMemberSearch } from '@/app/lib/reports/member-contact-columns';
type Center = {
    id: string;
    name: string;
    code: string;
    branchId: string;
    status?: string;
};

type Branch = {
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
    address?: string | null;
    centerId: string;
    groupId?: string | null;
    center?: {
        address?: string | null;
    } | null;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
};

// Validation schema — group and new client ID are determined by the backend
const clientTransferSchema = z.object({
    oldCenterName: z.string().min(1, 'Old center name is required'),
    clientName: z.string().min(1, 'Name is required'),
    oldClientId: z.string().optional(),
    clientNameDisplay: z.string().optional(),
    address: z.string().optional(),
    branchName: z.string().min(1, 'Branch name is required'),
    newCenterName: z.string().min(1, 'New center name is required'),
    // 'auto' (default) = server picks the first group with space; otherwise a group id
    newGroupId: z.string().optional(),
});

const AUTO_GROUP = 'auto';

type TargetGroup = {
    id: string;
    name: string;
    code: string | null;
    memberCount: number;
    maxMembers: number;
    isFull: boolean;
};

type ClientTransferFormValues = z.infer<typeof clientTransferSchema>;

export function ClientTransferClient() {
    const { canPage } = usePermission();
    const canEditClient = canPage('/dashboard/client-operations/transfer', 'edit');
    const { toast } = useToast();

    // Source-side branch filter — Admin/Area Manager can pick any branch to
    // transfer FROM; others are locked to their own branch (unchanged).
    // The destination "Branch Name" field below is intentionally unrestricted
    // for all roles and is not affected by this.
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    // A Branch Manager can only transfer inside their own branch — the destination
    // Branch Name is locked to it (the API enforces the same rule).
    const isBranchManager = storedUser?.role === 'BRANCH_MANAGER';
    const [sourceBranches, setSourceBranches] = useState<Branch[]>([]);
    const [selectedSourceBranchId, setSelectedSourceBranchId] = useState('');
    const [sourceBranchName, setSourceBranchName] = useState('');
    const [isLoadingSourceBranches, setIsLoadingSourceBranches] = useState(false);

    const [oldCenters, setOldCenters] = useState<Center[]>([]);
    const [newCenters, setNewCenters] = useState<Center[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [targetGroups, setTargetGroups] = useState<TargetGroup[]>([]);
    const [isLoadingGroups, setIsLoadingGroups] = useState(false);
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

    const form = useForm<ClientTransferFormValues>({
        resolver: zodResolver(clientTransferSchema),
        defaultValues: {
            oldCenterName: '',
            clientName: '',
            oldClientId: '',
            clientNameDisplay: '',
            address: '',
            branchName: '',
            newCenterName: '',
            newGroupId: AUTO_GROUP,
        },
    });

    const selectedOldCenterId = form.watch('oldCenterName');
    const selectedClientId = form.watch('clientName');
    const selectedBranchId = form.watch('branchName');
    const selectedNewCenterId = form.watch('newCenterName');

    // Get active branch on mount
    useEffect(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        const branchId = activeBranch?.id || storedUser?.branchId;

        if (branchId) {
            form.setValue('branchName', branchId);
        }
    }, [form]);

    useEffect(() => {
        fetchBranches();
        loadSourceBranches();
    }, []);

    // Branch Manager: destination branch is always the source (own) branch
    useEffect(() => {
        if (isBranchManager && selectedSourceBranchId) {
            form.setValue('branchName', selectedSourceBranchId);
        }
    }, [isBranchManager, selectedSourceBranchId, form]);

    // Fetch the "old centers" list whenever the selected source branch changes
    useEffect(() => {
        if (selectedSourceBranchId) {
            form.setValue('oldCenterName', '');
            setOldCenters([]);
            fetchOldCenters(selectedSourceBranchId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSourceBranchId]);

    useEffect(() => {
        if (selectedOldCenterId) {
            fetchClients(selectedOldCenterId);
        } else {
            setClients([]);
            form.setValue('clientName', '');
            form.setValue('oldClientId', '');
            form.setValue('clientNameDisplay', '');
            form.setValue('address', '');
        }
        setClientSearch('');
    }, [selectedOldCenterId, form]);

    useEffect(() => {
        if (selectedClientId) {
            const client = clients.find((c) => c.id === selectedClientId);
            if (client) {
                form.setValue('oldClientId', client.clientId);
                form.setValue('clientNameDisplay', `${client.firstName} ${client.lastName}`.trim());
                // Use client address if available, otherwise fallback to center address
                const address = client.address || client.center?.address || '';
                form.setValue('address', address);
            }
        } else {
            form.setValue('oldClientId', '');
            form.setValue('clientNameDisplay', '');
            form.setValue('address', '');
        }
    }, [selectedClientId, clients, form]);

    useEffect(() => {
        if (selectedBranchId) {
            fetchNewCenters(selectedBranchId);
        } else {
            setNewCenters([]);
            form.setValue('newCenterName', '');
        }
    }, [selectedBranchId, form]);

    // Load the destination center's groups; reset the group choice to auto-assign
    useEffect(() => {
        form.setValue('newGroupId', AUTO_GROUP);
        if (!selectedNewCenterId) {
            setTargetGroups([]);
            return;
        }
        let cancelled = false;
        setIsLoadingGroups(true);
        apiClient
            .get<TargetGroup[]>(`/client-operations/transfer?centerId=${selectedNewCenterId}`)
            .then((result) => {
                if (cancelled) return;
                if (result.success && result.data) {
                    // Full groups can't take another member — don't offer them
                    setTargetGroups(result.data.filter((g) => !g.isFull));
                } else {
                    setTargetGroups([]);
                    toast({
                        title: 'Error',
                        description: result.error || 'Failed to load groups.',
                        variant: 'destructive',
                    });
                }
            })
            .catch(() => {
                if (cancelled) return;
                setTargetGroups([]);
                toast({ title: 'Error', description: 'Failed to load groups.', variant: 'destructive' });
            })
            .finally(() => {
                if (!cancelled) setIsLoadingGroups(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNewCenterId]);

    // Filter out the current center from new centers list
    const availableNewCenters = useMemo(() => {
        if (!selectedOldCenterId) return newCenters;
        return newCenters.filter(center => center.id !== selectedOldCenterId);
    }, [newCenters, selectedOldCenterId]);

    const fetchBranches = async () => {
        try {
            const result = await apiClient.get<Branch[]>('/branches?includeInactive=false');

            if (result.success && result.data) {
                setBranches(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load branches.',
                    variant: 'destructive',
                });
                setBranches([]);
            }
        } catch (error) {
            console.error('Error fetching branches:', error);
            toast({
                title: 'Error',
                description: 'Failed to load branches. Please try again.',
                variant: 'destructive',
            });
            setBranches([]);
        } finally {
            setIsLoading(false);
        }
    };

    const loadSourceBranches = async () => {
        if (isAdminOrAM) {
            setIsLoadingSourceBranches(true);
            try {
                const branchesResult = await apiClient.get<Branch[]>('/branches');
                if (!branchesResult.success || !branchesResult.data) {
                    throw new Error(branchesResult.error || 'Failed to load branches.');
                }
                let list: Branch[] = branchesResult.data.map(
                    (b) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (storedUser?.role === 'AREA_MANAGER') {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setSourceBranches(list);
                const activeBranch = branchStorage.getActiveBranch();
                const preferredId = activeBranch?.id ?? storedUser?.branchId;
                const match = list.find((b) => b.id === preferredId) ?? list[0];
                if (match) {
                    setSelectedSourceBranchId(match.id);
                } else {
                    setIsLoading(false);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                setIsLoading(false);
            } finally {
                setIsLoadingSourceBranches(false);
            }
        } else {
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id ?? storedUser?.branchId ?? '';
            setSourceBranchName(activeBranch?.name ?? '');
            setSelectedSourceBranchId(branchId);
        }
    };

    const fetchOldCenters = async (branchId: string) => {
        if (!branchId) return;
        try {
            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`
            );

            if (result.success && result.data) {
                setOldCenters(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setOldCenters([]);
            }
        } catch (error) {
            console.error('Error fetching old centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setOldCenters([]);
        }
    };

    const fetchNewCenters = async (branchId: string) => {
        try {
            // Dedicated endpoint: /centers pins BM/AM to their own branch(es), so it
            // can never list another branch's centers (cross-branch transfer).
            const result = await apiClient.get<Center[]>(
                `/client-operations/transfer?branchId=${branchId}`
            );

            if (result.success && result.data) {
                setNewCenters(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setNewCenters([]);
            }
        } catch (error) {
            console.error('Error fetching new centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setNewCenters([]);
        }
    };

    const fetchClients = async (centerId: string) => {
        setIsLoadingClients(true);
        try {
            const result = await apiClient.get<{
                clients: Client[];
                pagination: {
                    currentPage: number;
                    pageSize: number;
                    totalItems: number;
                    totalPages: number;
                };
            }>(`/clients?centerId=${centerId}&includeInactive=false&pageSize=1000`);

            if (result.success && result.data && result.data.clients) {
                // Map clients to include address from center if not available on client
                const mappedClients = result.data.clients.map((client) => ({
                    ...client,
                    address: client.address || client.center?.address || null,
                }));
                setClients(mappedClients);
            } else {
                toast({
                    title: 'Warning',
                    description: result.error || 'No clients found for the selected center.',
                    variant: 'default',
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

    const onSubmit = async (values: ClientTransferFormValues) => {
        setIsSubmitting(true);
        try {
            // Get the selected client's database ID
            const selectedClient = clients.find((c) => c.id === values.clientName);
            if (!selectedClient) {
                toast({
                    title: 'Error',
                    description: 'Selected record not found.',
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            // Call the transfer API — group and new client ID are assigned server-side
            const result = await apiClient.post<{
                clientId: string;
                oldClientId: string;
                newClientId: string;
                centerId: string;
                groupId: string | null;
                assignedGroup: { id: string; name: string };
                clientName: string;
                movedLoanCount: number;
            }>('/client-operations/transfer', {
                clientId: selectedClient.id, // Database ID
                oldCenterId: values.oldCenterName,
                newCenterId: values.newCenterName,
                ...(values.newGroupId && values.newGroupId !== AUTO_GROUP
                    ? { groupId: values.newGroupId }
                    : {}),
            });

            if (result.success && result.data) {
                const groupInfo = result.data.assignedGroup
                    ? ` Assigned to ${result.data.assignedGroup.name}.`
                    : '';
                toast({
                    title: 'Success',
                    description: `${getPersonLabel(!!selectedClient.hasLoan).singular} "${result.data.clientName}" transferred successfully. ${getPersonLabel(!!selectedClient.hasLoan).singular} ID is unchanged: ${result.data.clientId}.${groupInfo}`,
                });

                // Reset form after successful submission
                handleReset();
            } else {
                throw new Error(result.error || 'Transfer failed');
            }
        } catch (error) {
            console.error('Error transferring client:', error);
            toast({
                title: 'Error',
                description:
                    error instanceof Error
                        ? error.message
                        : 'Failed to transfer client. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        const branchId = activeBranch?.id || storedUser?.branchId;

        form.reset({
            oldCenterName: '',
            clientName: '',
            oldClientId: '',
            clientNameDisplay: '',
            address: '',
            branchName: branchId || '',
            newCenterName: '',
            newGroupId: AUTO_GROUP,
        });
        setClients([]);
        setNewCenters([]);
        setTargetGroups([]);

        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    const selectedBranch = useMemo(() => {
        return branches.find((branch) => branch.id === selectedBranchId) || null;
    }, [branches, selectedBranchId]);

    const selectedOldCenter = useMemo(() => {
        return oldCenters.find((center) => center.id === selectedOldCenterId) || null;
    }, [oldCenters, selectedOldCenterId]);

    const selectedNewCenter = useMemo(() => {
        return availableNewCenters.find((center) => center.id === selectedNewCenterId) || null;
    }, [availableNewCenters, selectedNewCenterId]);

    const selectedClient = useMemo(() => {
        return clients.find((client) => client.id === selectedClientId) || null;
    }, [clients, selectedClientId]);

    // Check if transfer is ready
    const isTransferReady = useMemo(() => {
        return !!(
            selectedOldCenterId &&
            selectedClientId &&
            selectedBranchId &&
            selectedNewCenterId
        );
    }, [selectedOldCenterId, selectedClientId, selectedBranchId, selectedNewCenterId]);

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Client Transfer
                </h1>
                <p className="text-muted-foreground">
                    Transfer clients between centers. All client details and loan information will be preserved.
                </p>
            </div>

            {/* Main Form Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <ArrowLeftRight className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Transfer Details</CardTitle>
                            <CardDescription>
                                Select old center, client, and new center details
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
                                    {/* Source Branch — visible only for Admin / Area Manager */}
                                    {isAdminOrAM ? (
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">Source Branch</Label>
                                            <Select
                                                value={selectedSourceBranchId}
                                                onValueChange={setSelectedSourceBranchId}
                                                disabled={isLoadingSourceBranches || sourceBranches.length === 0}
                                            >
                                                <SelectTrigger className="h-11 w-full">
                                                    <SelectValue placeholder="-- SELECT BRANCH --" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {sourceBranches.map((b) => (
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
                                            <Label className="text-sm font-medium">Source Branch</Label>
                                            <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                                                {sourceBranchName || 'Current Branch'}
                                            </div>
                                        </div>
                                    )}

                                    {/* Old Center Name */}
                                    <FormField
                                        control={form.control}
                                        name="oldCenterName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Old Center Name
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={oldCenters.length === 0 || !selectedSourceBranchId}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {oldCenters.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                No centers available
                                                            </div>
                                                        ) : (
                                                            oldCenters.map((center) => (
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
                                                disabled={!selectedOldCenterId || isLoadingClients}
                                                className="h-11 pl-9"
                                            />
                                        </div>
                                    </FormItem>

                                    {/* Member/Client Name */}
                                    <FormField
                                        control={form.control}
                                        name="clientName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Name
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={!selectedOldCenterId || isLoadingClients || clients.length === 0}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {isLoadingClients ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                Loading...
                                                            </div>
                                                        ) : clients.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                No records available
                                                            </div>
                                                        ) : filteredClients.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                No records match &quot;{clientSearch}&quot;
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

                                    {/* Old Member/Client Id */}
                                    <FormField
                                        control={form.control}
                                        name="oldClientId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Old {getPersonLabel(!!selectedClient?.hasLoan).singular} Id
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

                                    {/* Member/Client Name Display */}
                                    <FormField
                                        control={form.control}
                                        name="clientNameDisplay"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    {getPersonLabel(!!selectedClient?.hasLoan).singular} Name
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

                                    {/* Address */}
                                    <FormField
                                        control={form.control}
                                        name="address"
                                        render={({ field }) => (
                                            <FormItem className="md:col-span-2">
                                                <FormLabel className="text-sm font-medium">
                                                    Address
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

                                    {/* Branch Name */}
                                    <FormField
                                        control={form.control}
                                        name="branchName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Branch Name
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={branches.length === 0 || isBranchManager}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {branches.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                No branches available
                                                            </div>
                                                        ) : (
                                                            branches.map((branch) => (
                                                                <SelectItem key={branch.id} value={branch.id}>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-medium">{branch.name}</span>
                                                                        <span className="text-muted-foreground">({branch.code})</span>
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

                                    {/* New Center Name */}
                                    <FormField
                                        control={form.control}
                                        name="newCenterName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    New Center Name
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={!selectedBranchId || availableNewCenters.length === 0}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {availableNewCenters.length === 0 ? (
                                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                {selectedBranchId
                                                                    ? (selectedOldCenterId
                                                                        ? 'No other centers available in this branch'
                                                                        : 'No centers available in this branch')
                                                                    : 'Select branch first'}
                                                            </div>
                                                        ) : (
                                                            availableNewCenters.map((center) => (
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

                                    {/* New Group — optional; 'auto' lets the server pick the first group with space */}
                                    <FormField
                                        control={form.control}
                                        name="newGroupId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    New Group
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value ?? AUTO_GROUP}
                                                    disabled={!selectedNewCenterId || isLoadingGroups}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11 w-full">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value={AUTO_GROUP}>
                                                            Auto-assign (first group with space)
                                                        </SelectItem>
                                                        {targetGroups.map((group) => (
                                                            <SelectItem key={group.id} value={group.id}>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-medium">{group.name}</span>
                                                                    <span className="text-muted-foreground">
                                                                        ({group.memberCount}/{group.maxMembers})
                                                                    </span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* The client ID never changes on transfer */}
                                    <div className="md:col-span-2 flex flex-col justify-end">
                                        <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-primary/40 p-3">
                                            ℹ️ The {getPersonLabel(!!selectedClient?.hasLoan).singular} ID does not change when you transfer.
                                            Pick a group, or leave it on Auto-assign to use the first group
                                            in the new center with space. If every group is full, the transfer is
                                            rejected — create a new group first.{' '}
                                            {isBranchManager
                                                ? 'Branch Managers can transfer only within their own branch.'
                                                : 'Transfers to another branch are only allowed for clients with no active (indexed or disbursed) loan.'}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Transfer Summary */}
                            {!isLoading && isTransferReady && (
                                <div className="mt-6 p-4 bg-green-50 dark:bg-green-950/20 border-2 border-primary/30 dark:border-sidebar-accent rounded-lg">
                                    <h3 className="text-sm font-semibold text-foreground dark:text-green-100 mb-3 flex items-center gap-2">
                                        <ArrowLeftRight className="h-4 w-4" />
                                        Transfer Summary
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                        <div>
                                            <p className="text-muted-foreground mb-1">Center</p>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sidebar-accent dark:text-slate-300">
                                                    {selectedOldCenter?.name}
                                                </span>
                                                <ArrowLeftRight className="h-3 w-3 text-primary" />
                                                <span className="font-medium text-sidebar-accent dark:text-primary">
                                                    {selectedNewCenter?.name}
                                                </span>
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground mb-1">{getPersonLabel(!!selectedClient?.hasLoan).singular} ID</p>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sidebar-accent dark:text-slate-300">
                                                    {form.watch('oldClientId')}
                                                </span>
                                                <ArrowLeftRight className="h-3 w-3 text-primary" />
                                                <span className="font-medium text-sidebar-accent dark:text-primary">
                                                    {form.watch('oldClientId')} (unchanged)
                                                </span>
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground mb-1">Group</p>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sidebar-accent dark:text-slate-300">
                                                    {selectedClient?.groupId ? 'Assigned' : 'None'}
                                                </span>
                                                <ArrowLeftRight className="h-3 w-3 text-primary" />
                                                <span className="font-medium text-sidebar-accent dark:text-primary">
                                                    {targetGroups.find((g) => g.id === form.watch('newGroupId'))?.name ??
                                                        'Auto-assigned'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        ℹ️ All client personal details and loan information will be preserved during transfer.
                                    </p>
                                </div>
                            )}


                            {/* Action Buttons */}
                            {!isLoading && (
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
                                                Transferring...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Transfer
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
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}

