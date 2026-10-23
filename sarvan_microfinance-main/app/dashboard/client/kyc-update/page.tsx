'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { RefreshCw, User, Building2, CheckCircle2, Loader2, Search } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KYCUpdateForm } from '@/components/client/KYCUpdateForm';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface Client {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    centerId: string | null;
    center?: { id: string; name: string; code: string } | null;
}

export default function KYCUpdatePage() {
    const { toast } = useToast();
    const userRole = useMemo(() => tokenStorage.getUser()?.role, []);
    const isAdmin = userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH';

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedClient, setSelectedClient] = useState('');
    const [clients, setClients] = useState<Client[]>([]);
    const [currentClient, setCurrentClient] = useState<any>(null);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isLoadingClientDetails, setIsLoadingClientDetails] = useState(false);

    // Debounce search input
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(search);
        }, 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search]);

    // Admin: Fetch branches on mount
    useEffect(() => {
        if (isAdmin) {
            fetchBranches();
        }
    }, [isAdmin]);

    // Fetch clients when search or branch changes
    const fetchClients = useCallback(async () => {
        // For admin, require a branch first
        if (isAdmin && !selectedBranch) {
            setClients([]);
            return;
        }

        setIsLoadingClients(true);
        try {
            const params = new URLSearchParams();
            params.set('allBranch', 'true');
            params.set('includeInactive', 'false');
            params.set('pageSize', '200');
            if (debouncedSearch.trim()) {
                params.set('search', debouncedSearch.trim());
            }
            if (isAdmin && selectedBranch) {
                params.set('branchId', selectedBranch);
            }

            const result = await apiClient.get<any>(`/clients?${params.toString()}`);
            if (result.success && result.data) {
                const data = result.data;
                let list: Client[] = [];
                if (Array.isArray(data)) {
                    list = data;
                } else if (data.clients && Array.isArray(data.clients)) {
                    list = data.clients;
                }
                setClients(list);
            } else {
                setClients([]);
            }
        } catch {
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    }, [debouncedSearch, selectedBranch, isAdmin]);

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    // Fetch client details when client is selected
    useEffect(() => {
        if (selectedClient) {
            fetchClientDetails(selectedClient);
        } else {
            setCurrentClient(null);
        }
    }, [selectedClient]);

    const fetchBranches = async () => {
        setIsLoadingBranches(true);
        try {
            const result = await apiClient.get<any>('/branches');
            if (result.success && result.data) {
                setBranches(Array.isArray(result.data) ? result.data : []);
            } else {
                setBranches([]);
            }
        } catch {
            setBranches([]);
        } finally {
            setIsLoadingBranches(false);
        }
    };

    const fetchClientDetails = async (clientId: string) => {
        setIsLoadingClientDetails(true);
        try {
            const result = await apiClient.get<any>(`/clients/${clientId}`);
            if (result.success && result.data) {
                setCurrentClient(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load client details',
                    variant: 'destructive',
                });
                setCurrentClient(null);
            }
        } catch {
            setCurrentClient(null);
        } finally {
            setIsLoadingClientDetails(false);
        }
    };

    const handleBranchChange = (value: string) => {
        setSelectedBranch(value);
        setSelectedClient('');
        setCurrentClient(null);
        setSearch('');
    };

    const handleUpdateSuccess = () => {
        setSelectedClient('');
        setCurrentClient(null);
        toast({
            title: 'Update Complete',
            description: 'KYC information has been updated successfully. You can now select another client.',
            variant: 'default',
        });
    };

    return (
        <ProtectedRoute requiredPermission="KYC_UPDATE">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-emerald-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 shadow-lg shadow-green-500/30">
                                <RefreshCw className="h-6 w-6 text-white" />
                                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    KYC Update
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Update client KYC information and details
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Client Selection Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        {/* Top Accent Bar */}
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-green-600" />

                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-emerald-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                                    <User className="h-5 w-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Select Client</CardTitle>
                                    <CardDescription>
                                        Search and select a client to update KYC information
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {/* Admin Branch Selection */}
                            {isAdmin && (
                                <div className="mb-6 space-y-2">
                                    <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={selectedBranch} onValueChange={handleBranchChange} disabled={isLoadingBranches}>
                                        <SelectTrigger
                                            id="branch"
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-green-400 focus:border-green-500',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent',
                                                isLoadingBranches && 'opacity-50 cursor-not-allowed'
                                            )}
                                        >
                                            <SelectValue placeholder={isLoadingBranches ? 'Loading branches...' : '-- SELECT BRANCH --'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branches.map((branch) => (
                                                <SelectItem key={branch.id} value={branch.id}>
                                                    {branch.code} - {branch.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Search Input */}
                                <div className="space-y-2">
                                    <Label htmlFor="search" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Search Client
                                    </Label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            id="search"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Search by name, client ID or phone…"
                                            disabled={isAdmin && !selectedBranch}
                                            className={cn(
                                                'h-11 pl-9 border border-primary/30 text-sm',
                                                'bg-green-50 hover:border-green-400 focus:border-green-500',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent',
                                                isAdmin && !selectedBranch && 'opacity-50 cursor-not-allowed'
                                            )}
                                        />
                                    </div>
                                </div>

                                {/* Client Selection */}
                                <div className="space-y-2">
                                    <Label htmlFor="client" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Client Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Select
                                        value={selectedClient}
                                        onValueChange={setSelectedClient}
                                        disabled={isLoadingClients || (isAdmin && !selectedBranch)}
                                    >
                                        <SelectTrigger
                                            id="client"
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-green-400 focus:border-green-500',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent',
                                                (isLoadingClients || (isAdmin && !selectedBranch)) && 'opacity-50 cursor-not-allowed'
                                            )}
                                        >
                                            <SelectValue placeholder={
                                                isLoadingClients
                                                    ? 'Loading clients…'
                                                    : (isAdmin && !selectedBranch)
                                                        ? 'Select branch first'
                                                        : clients.length === 0
                                                            ? 'No clients found'
                                                            : '-- SELECT CLIENT --'
                                            } />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {clients.length > 0 ? (
                                                clients.map((client) => (
                                                    <SelectItem key={client.id} value={client.clientId}>
                                                        {client.clientId} — {client.firstName} {client.lastName}
                                                        {!client.centerId && (
                                                            <span className="ml-1 text-amber-600 text-xs"> ⚠ No center</span>
                                                        )}
                                                    </SelectItem>
                                                ))
                                            ) : (
                                                <SelectItem value="no-clients" disabled>
                                                    No clients found
                                                </SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                    {clients.length > 0 && !isLoadingClients && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {clients.length} client{clients.length !== 1 ? 's' : ''} found
                                            {search && ` for "${search}"`}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Client Info Summary */}
                            {isLoadingClientDetails && (
                                <div className="mt-6 p-4 bg-green-50 dark:bg-brand-green-darker/50 border border-primary/20 dark:border-sidebar-accent rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                                        <span className="text-sm text-sidebar-accent dark:text-slate-400">Loading client details…</span>
                                    </div>
                                </div>
                            )}
                            {currentClient && !isLoadingClientDetails && (
                                <div className="mt-6 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/50">
                                            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-2">
                                                Client Selected
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                                                <div>
                                                    <span className="text-green-700 dark:text-green-300 font-medium">Client ID:</span>
                                                    <span className="ml-2 text-green-900 dark:text-green-100">{currentClient.clientId}</span>
                                                </div>
                                                <div>
                                                    <span className="text-green-700 dark:text-green-300 font-medium">Name:</span>
                                                    <span className="ml-2 text-green-900 dark:text-green-100">{currentClient.firstName} {currentClient.lastName}</span>
                                                </div>
                                                <div>
                                                    <span className="text-green-700 dark:text-green-300 font-medium">Center:</span>
                                                    <span className="ml-2 text-green-900 dark:text-green-100">
                                                        {currentClient.center?.name || <span className="text-amber-600">Not assigned</span>}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* KYC Update Form Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        {/* Top Accent Bar */}
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600" />

                        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                    <Building2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Client Information</CardTitle>
                                    <CardDescription>
                                        Update client personal, contact, bank, and identity details
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <KYCUpdateForm
                                selectedClient={selectedClient}
                                clientData={currentClient}
                                onSuccess={handleUpdateSuccess}
                            />
                        </CardContent>
                    </Card>
                </div>

                <div className="px-6 pb-6">
                    <DashboardFooter />
                </div>
            </div>
        </ProtectedRoute>
    );
}
