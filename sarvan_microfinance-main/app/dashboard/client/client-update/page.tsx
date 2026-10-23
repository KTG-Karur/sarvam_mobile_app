'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { RefreshCw, User, CheckCircle2, XCircle, Search, ClipboardList, CreditCard } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KYCDocumentTableSection } from '@/components/client/KYCDocumentTableSection';
import { PrintKYCDocuments } from '@/components/client/PrintKYCDocuments';
import { KYCDetailsFlatForm } from '@/components/client/KYCDetailsFlatForm';
import { CoApplicantForm } from '@/components/client/CoApplicantForm';
import { LoanDetailsUpdateForm } from '@/components/client/LoanDetailsUpdateForm';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { FileText, Users } from 'lucide-react';
import { useEnrollmentValidation } from '@/hooks/useEnrollmentValidation';
import { useClientUpdateCompletion } from '@/hooks/useClientUpdateCompletion';
import { DocumentStatusList } from '@/components/client/DocumentStatusList';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';
import { useDrivingDistance } from '@/hooks/useDrivingDistance';
import { PageLoader } from '@/components/ui/page-loader';

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
    createdAt: string;
}

interface KYCDocument {
    id: string;
    documentType: string;
    fileUrl: string;
    fileName: string;
    fileType: string;
    uploadDate: string;
}

export default function ClientUpdatePage() {
    const { toast } = useToast();
    const userRole = useMemo(() => tokenStorage.getUser()?.role, []);
    const isAdmin = userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH';
    // Sub Admin (dynamic RBAC flag) should see approved clients same as Admin,
    // without inheriting the admin branch-picker-required UX (isAdmin stays
    // as-is for that purpose — see fetchClients/branch selector below). FDO is
    // NOT included here — whether FDO sees APPROVED clients is decided entirely
    // server-side (app/api/clients/route.ts `isPrivileged`) based on the Admin
    // kill-switch below, so the exclude param must always be sent for FDO and
    // let the backend decide live rather than baking a stale answer in here.
    const canSeeApprovedClients = isAdmin || !!tokenStorage.getUser()?.isSubAdmin;

    // Admin-only kill-switch: whether FDO can view/edit already-APPROVED clients
    // from this page (FdoApprovedClientEditConfig, singleton, default ON).
    const [allowFdoEditApproved, setAllowFdoEditApproved] = useState(true);
    const [isSavingFdoToggle, setIsSavingFdoToggle] = useState(false);

    // Admin-only kill-switch: whether Branch Manager can view/edit already-
    // APPROVED clients from the Approval Workbench "Edit Client" dialog
    // (BmApprovedClientEditConfig, singleton, default ON).
    const [allowBmEditApproved, setAllowBmEditApproved] = useState(true);
    const [isSavingBmToggle, setIsSavingBmToggle] = useState(false);

    // Branch/client selection state
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [selectedClient, setSelectedClient] = useState('');
    const [clients, setClients] = useState<Client[]>([]);
    const [currentClient, setCurrentClient] = useState<any>(null);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isLoadingClientDetails, setIsLoadingClientDetails] = useState(false);

    // KYC documents state (lifted to allow refresh across tabs)
    const [documents, setDocuments] = useState<KYCDocument[]>([]);
    const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

    // Live form value overrides — used only for real-time completion icons; never merged into currentClient
    const [formFieldOverrides, setFormFieldOverrides] = useState<Record<string, any>>({});
    const [coAppFieldOverrides, setCoAppFieldOverrides] = useState<Record<string, any>>({});

    // Reset overrides whenever the API data is refreshed (new client selected or form saved)
    useEffect(() => {
        setFormFieldOverrides({});
        setCoAppFieldOverrides({});
    }, [currentClient]);

    // Tab state — new order: client-details → client-other-details → co-applicant → loan-details → kyc-documents
    const [activeTab, setActiveTab] = useState<'client-details' | 'client-other-details' | 'co-applicant' | 'loan-details' | 'kyc-documents'>('client-details');

    const { configArray } = useEnrollmentValidation();

    const clientForCompletion = useMemo(() => {
        if (!currentClient) return null;
        return {
            ...currentClient,
            ...formFieldOverrides,
            coApplicant: Object.keys(coAppFieldOverrides).length > 0
                ? { ...(currentClient.coApplicant ?? {}), ...coAppFieldOverrides }
                : currentClient.coApplicant,
        };
    }, [currentClient, formFieldOverrides, coAppFieldOverrides]);

    const { kycDetailsComplete, clientOtherDetailsComplete, kycDocsComplete, coApplicantComplete, loanDetailsComplete } =
        useClientUpdateCompletion(clientForCompletion, documents, configArray);

    // Road (driving) distance from branch/center — shown next to House Image 1
    // on the KYC Documents tab (same OSRM calculation Create Center uses).
    const kmFromCenter = useDrivingDistance(
        currentClient?.latitude ?? null, currentClient?.longitude ?? null,
        currentClient?.center?.latitude ?? null, currentClient?.center?.longitude ?? null,
    );
    const kmFromBranch = useDrivingDistance(
        currentClient?.latitude ?? null, currentClient?.longitude ?? null,
        currentClient?.center?.branch?.latitude ?? null, currentClient?.center?.branch?.longitude ?? null,
    );

    // Debounce search input
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

    // Admin: Fetch the FDO approved-client-edit kill-switch on mount
    useEffect(() => {
        if (!isAdmin) return;
        (async () => {
            try {
                const result = await apiClient.get<{ enabled: boolean }>('/settings/fdo-approved-client-edit');
                if (result.success && result.data) {
                    setAllowFdoEditApproved(result.data.enabled);
                }
            } catch { /* keep default (true) */ }
        })();
    }, [isAdmin]);

    const handleToggleFdoEditApproved = async (checked: boolean) => {
        setAllowFdoEditApproved(checked); // optimistic
        setIsSavingFdoToggle(true);
        try {
            const result = await apiClient.put<{ enabled: boolean }>('/settings/fdo-approved-client-edit', { enabled: checked });
            if (!result.success) {
                setAllowFdoEditApproved(!checked); // revert
                toast({ title: 'Error', description: result.error || 'Failed to save setting', variant: 'destructive' });
            }
        } catch {
            setAllowFdoEditApproved(!checked); // revert
            toast({ title: 'Error', description: 'Failed to save setting', variant: 'destructive' });
        } finally {
            setIsSavingFdoToggle(false);
        }
    };

    // Admin: Fetch the BM approved-client-edit kill-switch on mount
    useEffect(() => {
        if (!isAdmin) return;
        (async () => {
            try {
                const result = await apiClient.get<{ enabled: boolean }>('/settings/bm-approved-client-edit');
                if (result.success && result.data) {
                    setAllowBmEditApproved(result.data.enabled);
                }
            } catch { /* keep default (true) */ }
        })();
    }, [isAdmin]);

    const handleToggleBmEditApproved = async (checked: boolean) => {
        setAllowBmEditApproved(checked); // optimistic
        setIsSavingBmToggle(true);
        try {
            const result = await apiClient.put<{ enabled: boolean }>('/settings/bm-approved-client-edit', { enabled: checked });
            if (!result.success) {
                setAllowBmEditApproved(!checked); // revert
                toast({ title: 'Error', description: result.error || 'Failed to save setting', variant: 'destructive' });
            }
        } catch {
            setAllowBmEditApproved(!checked); // revert
            toast({ title: 'Error', description: 'Failed to save setting', variant: 'destructive' });
        } finally {
            setIsSavingBmToggle(false);
        }
    };

    // Fetch clients when search or branch changes
    const fetchClients = useCallback(async () => {
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
            if (!canSeeApprovedClients) {
                params.set('excludeFinalApproved', 'true');
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
    }, [debouncedSearch, selectedBranch, isAdmin, canSeeApprovedClients]);

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    // Fetch client details when client is selected
    useEffect(() => {
        if (selectedClient) {
            fetchClientDetails(selectedClient);
        } else {
            setCurrentClient(null);
            setDocuments([]);
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
                fetchKycDocuments(clientId);
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

    const fetchKycDocuments = async (clientId: string) => {
        setIsLoadingDocuments(true);
        try {
            const result = await apiClient.get<any>(`/clients/${clientId}/kyc-documents?scope=all`);
            if (result.success && result.data) {
                const docs = (result.data.documents || []).map((doc: any) => ({
                    id: doc.id,
                    documentType: doc.documentType,
                    fileName: doc.fileName || 'Unnamed file',
                    fileType: doc.mimeType || 'application/octet-stream',
                    uploadDate: doc.uploadedAt,
                    fileUrl: doc.fileUrl || undefined,
                }));
                setDocuments(docs);
            } else {
                setDocuments([]);
            }
        } catch {
            setDocuments([]);
        } finally {
            setIsLoadingDocuments(false);
        }
    };

    const handleBranchChange = (value: string) => {
        setSelectedBranch(value);
        setSelectedClient('');
        setCurrentClient(null);
        setSearch('');
    };

    const handleClientSelect = (clientId: string) => {
        const client = clients.find(c => c.clientId === clientId);
        if (client) {
            setSelectedClient(clientId);
        }
    };

    const handleDocumentUploaded = () => {
        if (selectedClient) {
            fetchKycDocuments(selectedClient);
        }
    };

    const handleKycUpdateSuccess = () => {
        setSelectedClient('');
        setCurrentClient(null);
        setDocuments([]);
        toast({
            title: 'Update Complete',
            description: 'KYC information has been updated successfully. You can now select another client.',
            variant: 'default',
        });
    };

    const handleKycFormChange = useCallback((partial: Record<string, any>) => {
        setFormFieldOverrides(prev => ({ ...prev, ...partial }));
    }, []);

    const handleCoAppFormChange = useCallback((partial: Record<string, any>) => {
        const { coApplicant: coAppPart, ...clientPart } = partial;
        if (Object.keys(clientPart).length > 0) {
            setFormFieldOverrides(prev => ({ ...prev, ...clientPart }));
        }
        if (coAppPart) {
            setCoAppFieldOverrides(coAppPart);
        }
    }, []);

    const clientDocs = documents.filter((d) => !d.documentType.startsWith('co_applicant_'));
    const coApplicantDocs = documents.filter((d) => d.documentType.startsWith('co_applicant_'));
    const uploadedDocumentTypes = documents.map((d) => d.documentType);

    // Memoize to prevent CoApplicantForm effects from re-firing on every parent render
    const coApplicantPreselectedClient = useMemo(() => {
        if (!currentClient) return undefined;
        return {
            id: currentClient.id,
            clientId: selectedClient,
            firstName: currentClient.firstName,
            lastName: currentClient.lastName,
            centerId: currentClient.centerId,
            createdAt: currentClient.createdAt,
            spouseName: currentClient.spouseName,
            spouseMobileNumber: currentClient.spouseMobileNumber,
            spouseDob: currentClient.spouseDob,
            spouseGender: currentClient.spouseGender,
            spouseEconomicActivityTypeId: currentClient.spouseEconomicActivityTypeId,
            spouseEconomicActivityId: currentClient.spouseEconomicActivityId,
            // Prefer the actual assigned center's branch; while still unassigned, use
            // the REQUESTED center's branch (Loan Details tab selection) rather than
            // the enroller's own branch, which may differ.
            branchId: currentClient.center?.branchId || currentClient.requestedCenter?.branchId || currentClient.enrolledBy?.branchId,
            requestedLoanProductTypeId: currentClient.requestedLoanProductTypeId,
            requestedLoanFrequency: currentClient.requestedLoanFrequency,
            requestedLoanProductId: currentClient.requestedLoanProductId,
            hasLoan: currentClient.hasLoan,
        };
    }, [currentClient, selectedClient]);

    return (
        <ProtectedRoute requiredPermission="KYC_UPDATE">
            {/* min-h-full avoids inflating the scroll container height artificially */}
            <div className="relative min-h-full bg-gradient-to-br from-background via-green-50/30 to-emerald-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">

                {/* ── Section 1: Header + Member/Client Selection ── always visible ── */}
                <div className="container mx-auto px-3 sm:px-6">
                    {/* pt provides breathing room; no py-top on outer div so the
                        sticky tab bar below can sit flush at <main>'s top edge. */}
                    <div className="pt-4 sm:pt-8 mb-8">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 shadow-lg shadow-green-500/30">
                                <RefreshCw className="h-6 w-6 text-white" />
                                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    {currentClient ? `${getPersonLabel(!!currentClient.hasLoan).singular} Update` : 'Member / Client Update'}
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Manage KYC documents, details, and co-applicant information
                                </p>
                            </div>
                        </div>

                        {isAdmin && (
                            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                                <div className="flex items-center gap-3 rounded-lg border border-[#037f35]/20 bg-white px-4 py-3 dark:bg-[#022214] dark:border-[#025c27]/40 w-fit">
                                    <Switch
                                        checked={allowFdoEditApproved}
                                        onCheckedChange={handleToggleFdoEditApproved}
                                        disabled={isSavingFdoToggle}
                                    />
                                    <div>
                                        <p className="text-sm font-semibold text-[#013318] dark:text-white">
                                            Allow FDO to edit approved clients
                                        </p>
                                        <p className="text-xs text-[#025c27] dark:text-slate-400">
                                            {allowFdoEditApproved
                                                ? 'ON — FDO can see and update already-approved clients here without re-triggering approval.'
                                                : 'OFF — FDO cannot see or edit already-approved clients on this page.'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 rounded-lg border border-[#037f35]/20 bg-white px-4 py-3 dark:bg-[#022214] dark:border-[#025c27]/40 w-fit">
                                    <Switch
                                        checked={allowBmEditApproved}
                                        onCheckedChange={handleToggleBmEditApproved}
                                        disabled={isSavingBmToggle}
                                    />
                                    <div>
                                        <p className="text-sm font-semibold text-[#013318] dark:text-white">
                                            Allow BM to edit approved clients
                                        </p>
                                        <p className="text-xs text-[#025c27] dark:text-slate-400">
                                            {allowBmEditApproved
                                                ? 'ON — Branch Manager can edit already-approved clients from the Approval Workbench without re-triggering approval.'
                                                : 'OFF — Branch Manager cannot edit already-approved clients from the Approval Workbench.'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Member/Client Selection Card */}
                    <Card className="mb-8 border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                        <CardHeader>
                            <CardTitle className="text-lg">Select Member / Client</CardTitle>
                            <CardDescription>Choose a member or client to manage their KYC information</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isAdmin && (
                                <div className="space-y-2">
                                    <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={selectedBranch} onValueChange={handleBranchChange} disabled={isLoadingBranches}>
                                        <SelectTrigger
                                            id="branch"
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent',
                                                isLoadingBranches && 'opacity-50 cursor-not-allowed',
                                            )}
                                        >
                                            <SelectValue placeholder={isLoadingBranches ? 'Loading branches...' : '-- SELECT --'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branches.length > 0 ? (
                                                branches.map((branch) => (
                                                    <SelectItem key={branch.id} value={branch.id}>
                                                        {branch.code} - {branch.name}
                                                    </SelectItem>
                                                ))
                                            ) : (
                                                <SelectItem value="no-branches" disabled>
                                                    No branches available
                                                </SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {userRole === 'FDO' && (
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch
                                    </Label>
                                    <Input
                                        value={branchStorage.getActiveBranch()?.name ?? ''}
                                        disabled
                                        className={cn(
                                            'h-11 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 dark:bg-brand-green-darker dark:border-sidebar-accent',
                                        )}
                                    />
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="clientSearch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Search Member / Client
                                </Label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <input
                                        id="clientSearch"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search by name, ID or phone…"
                                        disabled={isAdmin && !selectedBranch}
                                        className={cn(
                                            'h-11 w-full pl-9 rounded-md border border-primary/30 text-sm',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                            isAdmin && !selectedBranch && 'opacity-50 cursor-not-allowed',
                                        )}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="client" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Name <span className="text-red-500">*</span>
                                </Label>
                                <Select value={selectedClient} onValueChange={handleClientSelect} disabled={isLoadingClients || (isAdmin && !selectedBranch)}>
                                    <SelectTrigger
                                        id="client"
                                        className={cn(
                                            'h-11 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent',
                                            (isLoadingClients || (isAdmin && !selectedBranch)) && 'opacity-50 cursor-not-allowed',
                                        )}
                                    >
                                        <SelectValue
                                            placeholder={
                                                isLoadingClients
                                                    ? 'Loading clients…'
                                                    : isAdmin && !selectedBranch
                                                        ? 'Select branch first'
                                                        : clients.length === 0
                                                            ? 'No clients found'
                                                            : '-- SELECT --'
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {clients.length > 0 ? (
                                            clients.map((client) => (
                                                <SelectItem key={client.id} value={client.clientId}>
                                                    {client.clientId} — {client.firstName} {client.lastName}
                                                    {!client.centerId && <span className="ml-1 text-amber-600 text-xs"> ⚠ No center</span>}
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
                                    <p className="text-xs text-slate-500">{clients.length} client{clients.length !== 1 ? 's' : ''} found{search ? ` for "${search}"` : ''}</p>
                                )}
                            </div>

                            {currentClient && (
                                <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-brand-green-darker dark:to-sidebar-accent rounded-lg border border-green-200 dark:border-primary/30">
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <User className="h-4 w-4 text-primary" />
                                                <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">
                                                    {currentClient.firstName} {currentClient.lastName}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-xs">
                                                <div>
                                                    <span className="text-slate-600 dark:text-slate-400">Client ID:</span>
                                                    <span className="ml-2 font-semibold text-sidebar-accent dark:text-slate-100">{currentClient.clientId}</span>
                                                </div>
                                                {currentClient.center && (
                                                    <div>
                                                        <span className="text-slate-600 dark:text-slate-400">Center:</span>
                                                        <span className="ml-2 font-semibold text-sidebar-accent dark:text-slate-100">{currentClient.center.name}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <HighmarkHistoryButton
                                            clientId={currentClient.id}
                                            clientName={`${currentClient.firstName} ${currentClient.lastName}`}
                                            centerName={currentClient.center?.name}
                                            variant="outline"
                                        />
                                        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 flex-shrink-0" />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* ── Section 2: Tabs (shown when client is fully loaded) ── */}
                {selectedClient && currentClient && (
                    <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)}>
                        {/* Sticky tab bar — lives OUTSIDE the container so w-full
                            here is relative to the full-width outer div, not the
                            centered container. This eliminates the right-side gap
                            that the old -mx trick couldn't fully close. */}
                        <div className="sticky top-0 z-30 w-full bg-white dark:bg-brand-green-darker shadow-md border-b border-primary/20 dark:border-sidebar-accent">
                            <div className="container mx-auto px-3 sm:px-6">
                                {/* py-2 gives the bar a comfortable click height.
                                    Each trigger uses justify-between so the label
                                    group sits at the left and the status icon anchors
                                    to the right — filling the full 25% column width
                                    with no wasted centre-space. */}
                                <TabsList className="grid w-full grid-cols-5 h-auto rounded-none bg-transparent py-2">
                                    <TabsTrigger
                                        value="client-details"
                                        className="flex w-full items-center justify-between gap-2 px-3 sm:px-5 data-[state=active]:bg-primary data-[state=active]:text-white rounded-md"
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <User className="h-4 w-4 shrink-0" />
                                            <span className="hidden sm:inline truncate font-medium">{currentClient ? `${getPersonLabel(!!currentClient.hasLoan).singular} Details` : 'Member / Client Details'}</span>
                                            <span className="sm:hidden text-xs font-medium">Details</span>
                                        </span>
                                        {kycDetailsComplete
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 data-[state=active]:text-green-200" />
                                            : <XCircle className="h-4 w-4 shrink-0 text-red-400 data-[state=active]:text-red-300" />}
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="client-other-details"
                                        className="flex w-full items-center justify-between gap-2 px-3 sm:px-5 data-[state=active]:bg-primary data-[state=active]:text-white rounded-md"
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <ClipboardList className="h-4 w-4 shrink-0" />
                                            <span className="hidden sm:inline truncate font-medium">Other Details</span>
                                            <span className="sm:hidden text-xs font-medium">Other</span>
                                        </span>
                                        {clientOtherDetailsComplete
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 data-[state=active]:text-green-200" />
                                            : <XCircle className="h-4 w-4 shrink-0 text-red-400 data-[state=active]:text-red-300" />}
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="co-applicant"
                                        className="flex w-full items-center justify-between gap-2 px-3 sm:px-5 data-[state=active]:bg-primary data-[state=active]:text-white rounded-md"
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <Users className="h-4 w-4 shrink-0" />
                                            <span className="hidden sm:inline truncate font-medium">Co-Applicant</span>
                                            <span className="sm:hidden text-xs font-medium">Co-App</span>
                                        </span>
                                        {coApplicantComplete
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 data-[state=active]:text-green-200" />
                                            : <XCircle className="h-4 w-4 shrink-0 text-red-400 data-[state=active]:text-red-300" />}
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="loan-details"
                                        className="flex w-full items-center justify-between gap-2 px-3 sm:px-5 data-[state=active]:bg-primary data-[state=active]:text-white rounded-md"
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <CreditCard className="h-4 w-4 shrink-0" />
                                            <span className="hidden sm:inline truncate font-medium">Loan Details</span>
                                            <span className="sm:hidden text-xs font-medium">Loan</span>
                                        </span>
                                        {loanDetailsComplete
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 data-[state=active]:text-green-200" />
                                            : <XCircle className="h-4 w-4 shrink-0 text-red-400 data-[state=active]:text-red-300" />}
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="kyc-documents"
                                        className="flex w-full items-center justify-between gap-2 px-3 sm:px-5 data-[state=active]:bg-primary data-[state=active]:text-white rounded-md"
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <FileText className="h-4 w-4 shrink-0" />
                                            <span className="hidden sm:inline truncate font-medium">KYC Documents</span>
                                            <span className="sm:hidden text-xs font-medium">KYC</span>
                                        </span>
                                        {kycDocsComplete
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 data-[state=active]:text-green-200" />
                                            : <XCircle className="h-4 w-4 shrink-0 text-red-400 data-[state=active]:text-red-300" />}
                                    </TabsTrigger>
                                </TabsList>
                            </div>
                        </div>

                        {/* Tab content — back inside a container for alignment */}
                        <div className="container mx-auto px-3 sm:px-6 pt-6 pb-4 sm:pb-8">
                            {/* Tabs 1+2: Member/Client Details & Other Details — single mounted form instance */}
                            <TabsContent
                                value="client-details"
                                forceMount
                                className={cn(
                                    activeTab === 'client-details' || activeTab === 'client-other-details' ? '' : 'hidden'
                                )}
                            >
                                {isLoadingClientDetails ? (
                                    <PageLoader label="Fetching client details..." fullScreen={false} />
                                ) : (
                                    <KYCDetailsFlatForm
                                        key={selectedClient}
                                        selectedClient={selectedClient}
                                        clientData={currentClient}
                                        onSuccess={handleKycUpdateSuccess}
                                        visibleSection={activeTab === 'client-other-details' ? 'other-details' : 'details'}
                                        onFormChange={handleKycFormChange}
                                        enableFullApprovalRestart
                                    />
                                )}
                            </TabsContent>
                            {/* Dummy: keeps Radix Tabs state valid for the other-details trigger */}
                            <TabsContent value="client-other-details" forceMount className="hidden" />

                            {/* Tab 3: Co-Applicant */}
                            <TabsContent
                                value="co-applicant"
                                forceMount
                                className={cn(activeTab === 'co-applicant' ? '' : 'hidden')}
                            >
                                <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                                    <CardContent className="pt-6 space-y-4">
                                        {/* This tab edits the Primary co-applicant only (unchanged, for the
                                            requested loan product fields below). A client may now have
                                            several co-applicants over time, each going through its own
                                            BM->AM->QC->Admin approval — add/manage those on the dedicated page. */}
                                        {selectedClient && (
                                            <Link
                                                href={`/dashboard/client/co-applicants?clientId=${selectedClient}`}
                                                className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300 w-fit"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                                Manage all co-applicants (add new, view approval status, activate) →
                                            </Link>
                                        )}
                                        <CoApplicantForm
                                            preselectedClient={coApplicantPreselectedClient}
                                            permissionPage="/dashboard/client/client-update"
                                            onDocumentUploaded={handleDocumentUploaded}
                                            uploadedDocumentTypes={coApplicantDocs.map((d) => d.documentType)}
                                            hideKycSection={true}
                                            hideLoanProductSection={true}
                                            onSuccess={() => fetchClientDetails(selectedClient)}
                                            onFormChange={handleCoAppFormChange}
                                        />
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {/* Tab 4: Loan Details */}
                            <TabsContent
                                value="loan-details"
                                forceMount
                                className={cn(activeTab === 'loan-details' ? '' : 'hidden')}
                            >
                                <LoanDetailsUpdateForm
                                    selectedClient={selectedClient}
                                    currentClient={currentClient}
                                    onSuccess={() => fetchClientDetails(selectedClient)}
                                />
                            </TabsContent>

                            {/* Tab 5: KYC Documents */}
                            <TabsContent value="kyc-documents">
                                <div className="flex justify-end mb-4">
                                    {selectedClient && <PrintKYCDocuments clientId={selectedClient} />}
                                </div>

                                <div className="flex gap-6 items-start">
                                    {/* Left: document tables */}
                                    <div className="flex-1 min-w-0 space-y-6">
                                        <KYCDocumentTableSection
                                            selectedClient={selectedClient}
                                            clientInternalId={currentClient.id}
                                            clientCreatedAt={currentClient.createdAt}
                                            documents={clientDocs}
                                            isLoading={isLoadingDocuments}
                                            onDocumentUploaded={handleDocumentUploaded}
                                            permissionPage="/dashboard/client/client-update"
                                            scope="client"
                                            title={`${getPersonLabel(!!currentClient.hasLoan).singular} Documents`}
                                            distanceFromBranchMeters={kmFromBranch.distanceMeters}
                                            distanceFromCenterMeters={kmFromCenter.distanceMeters}
                                            isLoadingDistance={kmFromBranch.isLoading || kmFromCenter.isLoading}
                                        />
                                        <KYCDocumentTableSection
                                            selectedClient={selectedClient}
                                            clientInternalId={currentClient.id}
                                            clientCreatedAt={currentClient.createdAt}
                                            documents={coApplicantDocs}
                                            isLoading={isLoadingDocuments}
                                            onDocumentUploaded={handleDocumentUploaded}
                                            permissionPage="/dashboard/client/client-update"
                                            scope="co_applicant"
                                            title="Co-Applicant Documents"
                                        />
                                    </div>

                                    {/* Right: required documents status */}
                                    <div className="w-72 flex-shrink-0 sticky top-16">
                                        <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm font-semibold text-foreground dark:text-slate-100">Required Documents</CardTitle>
                                            </CardHeader>
                                            <CardContent className="pt-0">
                                                <DocumentStatusList
                                                    configArray={configArray}
                                                    page="kyc"
                                                    uploadedDocumentTypes={uploadedDocumentTypes}
                                                />
                                            </CardContent>
                                        </Card>
                                    </div>
                                </div>
                            </TabsContent>

                            <DashboardFooter />
                        </div>
                    </Tabs>
                )}

                {/* ── Section 3: Empty state + Footer (no client selected) ── */}
                {!selectedClient && (
                    <div className="container mx-auto px-3 sm:px-6 pb-4 sm:pb-8">
                        <Card className="border-dashed border-2 border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-brand-green-darker/50">
                            <CardContent className="flex flex-col items-center justify-center py-16 px-4">
                                <User className="h-16 w-16 text-slate-400 dark:text-sidebar-accent mb-4" />
                                <h3 className="text-lg font-semibold text-foreground dark:text-slate-100 mb-2">
                                    No Member / Client Selected
                                </h3>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 text-center max-w-md">
                                    Select a member or client above to view and manage their KYC documents, details, and co-applicant information.
                                </p>
                            </CardContent>
                        </Card>
                        <DashboardFooter />
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
