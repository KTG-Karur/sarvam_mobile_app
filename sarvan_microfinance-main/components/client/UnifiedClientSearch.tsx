'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
    Search,
    RotateCcw,
    Users,
    MapPin,
    Eye,
    FileText,
    TrendingUp,
    Loader2,
    Filter,
    X,
    Map as MapIcon,
    ChevronLeft,
    ChevronRight,
    Navigation,
    AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { isLocationMatch, LOCATION_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';
import { useDrivingDistance } from '@/hooks/useDrivingDistance';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { LoanInfo, LoanInfoDialog } from '@/components/client/LoanInfoDialog';
import { AdvanceInfoDialog, AdvanceRow } from '@/components/client/AdvanceInfoDialog';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';
import { PageLoader } from '@/components/ui/page-loader';
import { ClientProfileDetail } from '@/components/client/ClientProfileDetail';

// Dynamically import the map component to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('@/components/centers/CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[500px] items-center justify-center rounded-lg border bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    ),
});

type ClientSearchType =
    | 'searchAll'
    | 'clientId'
    | 'clientName'
    | 'phone'
    | 'aadhaar'
    | 'centerCode';

interface SearchOption {
    value: ClientSearchType;
    label: string;
}

/** Branch filter value meaning "every branch the caller may see" (ADMIN / AREA_MANAGER). */
const ALL_BRANCHES = 'all';

const searchOptions: SearchOption[] = [
    { value: 'searchAll', label: 'Search All (ID / Name / Phone)' },
    { value: 'clientId', label: 'ID' },
    { value: 'clientName', label: 'Name' },
    { value: 'phone', label: 'Mobile Number' },
    { value: 'aadhaar', label: 'Aadhaar Number' },
    { value: 'centerCode', label: 'Center Code' },
];

export interface ClientSearchResult {
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
    kycData: string;
    loanData: string;
    advData: string;
    branchId: string;
    branchName?: string;
    accountId: string;
    /** Same as `accountId` — the stored client ID, which never changes on transfer. */
    displayAccountId: string;
    centerName: string;
    clientName: string;
    spouseName: string;
    nomineeName: string;
    relationship: string;
    phone: string;
    otherId: string;
    smartCard: string;
    voterId: string;
    pancard: string;
    status: 'Active' | 'Inactive';
    dedupeFlag: number;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
}

interface PaginationInfo {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
}

export function UnifiedClientSearch() {
    const [searchType, setSearchType] = useState<ClientSearchType | ''>('searchAll');
    const [searchValue, setSearchValue] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [centerFilter, setCenterFilter] = useState('all_centers');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [isMounted, setIsMounted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<ClientSearchResult[]>([]);
    const [centers, setCenters] = useState<{ id: string; name: string; code: string }[]>([]);

    // Pagination state
    const [pagination, setPagination] = useState<PaginationInfo>({
        currentPage: 1,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0,
    });

    // Dialog states
    const [selectedClientForDetail, setSelectedClientForDetail] = useState<ClientSearchResult | null>(null);
    const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
    const [selectedClientForLoan, setSelectedClientForLoan] = useState<ClientSearchResult | null>(null);
    const [isLoanDialogOpen, setIsLoanDialogOpen] = useState(false);
    const [loanData, setLoanData] = useState<LoanInfo[]>([]);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [selectedClientForAdvance, setSelectedClientForAdvance] = useState<ClientSearchResult | null>(null);
    const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
    const [advanceData, setAdvanceData] = useState<AdvanceRow[]>([]);
    const [isLoadingAdvance, setIsLoadingAdvance] = useState(false);
    const [selectedClientForMap, setSelectedClientForMap] = useState<ClientSearchResult | null>(null);
    const [isMapDialogOpen, setIsMapDialogOpen] = useState(false);
    // Location management state
    const [locationData, setLocationData] = useState<{
        latitude: number | null;
        longitude: number | null;
        locationApprovalStatus: string;
        pendingLatitude: number | null;
        pendingLongitude: number | null;
        relocationRemarks: string | null;
        locationApprovalRemarks: string | null;
        centerName: string | null;
        centerLatitude: number | null;
        centerLongitude: number | null;
        branchName: string | null;
        branchLatitude: number | null;
        branchLongitude: number | null;
        distanceFromCenterMeters: number | null;
        distanceFromBranchMeters: number | null;
    } | null>(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(false);
    const [locationRemarks, setLocationRemarks] = useState('');
    const [isSubmittingLocationAction, setIsSubmittingLocationAction] = useState(false);
    const [bmLat, setBmLat] = useState('');
    const [bmLng, setBmLng] = useState('');
    const [bmGpsAccuracy, setBmGpsAccuracy] = useState<number | null>(null);
    const { locate: locateBm, isLocating: isCapturingBmGps, locatingLabel: bmLocatingLabel } = useAccurateLocation();
    const [bmGpsError, setBmGpsError] = useState('');
    // Road (driving) distance between the BM's captured GPS and the FDO-verified /
    // pending-relocation client location — recomputed whenever either changes.
    const isBmRelocationReview = locationData?.locationApprovalStatus === 'RELOCATION_REQUESTED';
    const bmApprovalTargetLat = isBmRelocationReview ? locationData?.pendingLatitude ?? null : locationData?.latitude ?? null;
    const bmApprovalTargetLng = isBmRelocationReview ? locationData?.pendingLongitude ?? null : locationData?.longitude ?? null;
    const parsedBmLatForDistance = bmLat.trim() === '' ? null : parseFloat(bmLat);
    const parsedBmLngForDistance = bmLng.trim() === '' ? null : parseFloat(bmLng);
    const bmApprovalDistance = useDrivingDistance(
        bmApprovalTargetLat, bmApprovalTargetLng,
        parsedBmLatForDistance != null && Number.isFinite(parsedBmLatForDistance) ? parsedBmLatForDistance : null,
        parsedBmLngForDistance != null && Number.isFinite(parsedBmLngForDistance) ? parsedBmLngForDistance : null,
    );
    // FDO relocation inline form
    const [showRelocForm, setShowRelocForm] = useState(false);
    const [relocLat, setRelocLat] = useState('');
    const [relocLng, setRelocLng] = useState('');
    const [relocReason, setRelocReason] = useState('');
    const { locate: locateReloc, isLocating: isCapturingRelocGps, locatingLabel: relocLocatingLabel } = useAccurateLocation();
    const [relocGpsError, setRelocGpsError] = useState('');
    const [isSubmittingReloc, setIsSubmittingReloc] = useState(false);
    // Track whether the current results are from a search (so pagination doesn't overwrite them)
    const [isSearchMode, setIsSearchMode] = useState(false);

    const { toast } = useToast();

    // Roles that can see clients across more than one branch — only these get a branch filter
    const currentUserRole = tokenStorage.getUser()?.role;
    const isMultiBranchRole = currentUserRole === 'ADMIN'
        || currentUserRole === 'ADMIN_NON_HO_BRANCH_SWITCH'
        || currentUserRole === 'AREA_MANAGER'
        || currentUserRole === 'DIVISION_MANAGER';

    // Resolves the branch to scope client/center fetches to: the picked filter for
    // multi-branch roles (falling back to their active branch until one is picked),
    // or always the active/assigned branch for single-branch roles.
    const isAllBranchesView = isMultiBranchRole && branchFilter === ALL_BRANCHES;

    const resolveBranchId = (): string | undefined => {
        if (isMultiBranchRole && branchFilter) return branchFilter;
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        return activeBranch?.id || storedUser?.branchId || undefined;
    };

    useEffect(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        setBranchFilter(activeBranch?.id || storedUser?.branchId || '');
        setIsMounted(true);
    }, []);

    // Refetch centers + clients whenever the branch scope changes (including the
    // initial resolution above) and reset filters that no longer apply.
    useEffect(() => {
        if (!isMounted) return;
        setCenterFilter('all_centers');
        setIsSearchMode(false);
        fetchCenters();
        fetchAllClients();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMounted, branchFilter]);

    // Reload clients when pagination changes — skip if in search mode (user clicked Search)
    useEffect(() => {
        if (isMounted && !isSearchMode) {
            fetchAllClients();
        }
    }, [pagination.currentPage, pagination.pageSize]);

    const fetchCenters = async () => {
        try {
            const branchId = resolveBranchId();

            if (!branchId) return;

            // 'all' → omit branchId so /centers returns every center in the caller's scope
            const branchQuery = branchId === ALL_BRANCHES ? '' : `branchId=${branchId}&`;
            const result = await apiClient.get<{ id: string; name: string; code: string }[]>(
                `/centers?${branchQuery}includeInactive=false&status=APPROVED`
            );

            if (result.success && result.data) {
                setCenters(result.data);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
        }
    };

    const fetchAllClients = async () => {
        setIsLoading(true);
        try {
            const branchId = resolveBranchId();

            if (!branchId) {
                toast({
                    title: 'Error',
                    description: 'No branch selected. Please select a branch first.',
                    variant: 'destructive',
                });
                setIsLoading(false);
                return;
            }

            // Build query parameters (allBranch=true includes clients with no center assigned)
            const params = new URLSearchParams({
                branchId: branchId.toString(),
                allBranch: 'true',
                page: pagination.currentPage.toString(),
                pageSize: pagination.pageSize.toString(),
            });
            // ADMIN "All Branches" = truly every branch, independent of the admin's
            // own active-branch context (AREA_MANAGER stays limited to assigned branches).
            if (branchId === ALL_BRANCHES && currentUserRole === 'ADMIN') {
                params.set('global', 'true');
            }

            const result = await apiClient.get<{
                clients: ClientSearchResult[];
                pagination: PaginationInfo;
            }>(`/clients?${params.toString()}`);

            if (result.success && result.data) {
                setResults(result.data.clients || []);
                setPagination(result.data.pagination || {
                    currentPage: 1,
                    pageSize: 10,
                    totalItems: result.data.clients?.length || 0,
                    totalPages: 1,
                });
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load results.',
                    variant: 'destructive',
                });
                setResults([]);
            }
        } catch (error) {
            console.error('Error fetching clients:', error);
            toast({
                title: 'Error',
                description: 'Failed to load results. Please try again.',
                variant: 'destructive',
            });
            setResults([]);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredResults = useMemo(() => {
        return results.filter((client) => {
            const matchesCenter = centerFilter === 'all_centers' || client.centerName.includes(centerFilter);
            const matchesStatus =
                statusFilter === 'all' ||
                (statusFilter === 'active' && client.status === 'Active') ||
                (statusFilter === 'inactive' && client.status !== 'Active');
            return matchesCenter && matchesStatus;
        });
    }, [results, centerFilter, statusFilter]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!searchType || !searchValue.trim()) {
            toast({
                title: 'Search criteria required',
                description: 'Please choose a search type and enter a search value.',
                variant: 'destructive',
            });
            return;
        }

        setIsSearching(true);

        try {
            const branchId = resolveBranchId();

            if (!branchId) {
                toast({
                    title: 'Error',
                    description: 'No branch selected.',
                    variant: 'destructive',
                });
                setIsSearching(false);
                return;
            }

            // Build search query
            const params = new URLSearchParams({
                branchId: branchId.toString(),
                searchType: searchType,
                searchValue: searchValue.trim(),
                page: '1',
                pageSize: pagination.pageSize.toString(),
            });

            const result = await apiClient.get<{
                clients: ClientSearchResult[];
                pagination: PaginationInfo;
            }>(`/clients/search?${params.toString()}`);

            if (result.success && result.data) {
                setIsSearchMode(true);
                setResults(result.data.clients || []);
                setPagination(result.data.pagination || {
                    currentPage: 1,
                    pageSize: pagination.pageSize,
                    totalItems: result.data.clients?.length || 0,
                    totalPages: 1,
                });

                toast({
                    title: 'Search completed',
                    description: `Found ${result.data.pagination?.totalItems ?? result.data.clients?.length ?? 0} result(s) matching your criteria.`,
                });
            } else {
                toast({
                    title: 'No results',
                    description: result.error || 'No clients found matching your search.',
                    variant: 'default',
                });
                setResults([]);
            }
        } catch (error) {
            console.error('Error searching clients:', error);
            toast({
                title: 'Search failed',
                description: 'An error occurred while searching. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSearching(false);
        }
    };

    const handleReset = () => {
        setSearchType('searchAll');
        setSearchValue('');
        setCenterFilter('all_centers');
        setStatusFilter('all');
        setIsSearchMode(false);
        setPagination(prev => ({ ...prev, currentPage: 1 }));
        setSelectedClientForDetail(null);
        setIsDetailDialogOpen(false);
        setSelectedClientForLoan(null);
        setIsLoanDialogOpen(false);
        setSelectedClientForAdvance(null);
        setIsAdvanceDialogOpen(false);
        setSelectedClientForMap(null);
        setIsMapDialogOpen(false);
        setLocationData(null); setLocationRemarks('');
        setBmLat(''); setBmLng(''); setBmGpsError('');
        setShowRelocForm(false); setRelocLat(''); setRelocLng(''); setRelocReason('');

        // Reload all clients
        fetchAllClients();
    };

    const userRole = tokenStorage.getUser()?.role ?? '';

    const formatDistanceMeters = (m: number | null): string => {
        if (m == null) return '—';
        return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
    };

    // Normalizes the /clients/[id]/location response (client + precomputed distances)
    // into the flat shape locationData holds — shared by the initial fetch and every
    // post-action refresh so center/branch/distance fields stay in sync everywhere.
    const buildLocationData = (resData: any) => {
        const c = resData.client ?? resData;
        return {
            latitude: c.latitude ?? null,
            longitude: c.longitude ?? null,
            locationApprovalStatus: c.locationApprovalStatus,
            pendingLatitude: c.pendingLatitude ?? null,
            pendingLongitude: c.pendingLongitude ?? null,
            relocationRemarks: c.relocationRemarks ?? null,
            locationApprovalRemarks: c.locationApprovalRemarks ?? null,
            centerName: c.center?.name ?? null,
            centerLatitude: c.center?.latitude ?? null,
            centerLongitude: c.center?.longitude ?? null,
            branchName: c.center?.branch?.name ?? null,
            branchLatitude: c.center?.branch?.latitude ?? null,
            branchLongitude: c.center?.branch?.longitude ?? null,
            distanceFromCenterMeters: resData.distanceFromCenterMeters ?? null,
            distanceFromBranchMeters: resData.distanceFromBranchMeters ?? null,
        };
    };

    const handleLocateClient = (client: ClientSearchResult) => {
        setSelectedClientForMap(client);
        setLocationData(null);
        setLocationRemarks('');
        setBmLat(''); setBmLng(''); setBmGpsError('');
        setShowRelocForm(false);
        setRelocLat(''); setRelocLng(''); setRelocReason('');
        setIsMapDialogOpen(true);
    };

    // ── Fetch location data when map dialog opens ────────────────────────────
    useEffect(() => {
        if (!isMapDialogOpen || !selectedClientForMap) return;
        setIsLoadingLocation(true);
        apiClient.get<any>(`/clients/${selectedClientForMap.accountId}/location`)
            .then((res) => {
                if (res.success && res.data) {
                    setLocationData(buildLocationData(res.data));
                }
            })
            .catch(() => {}) // silent — map still works without status
            .finally(() => setIsLoadingLocation(false));
    }, [isMapDialogOpen, selectedClientForMap]);

    // ── Location action (BM: approve/reject/approve_relocation/reject_relocation) ──
    const handleLocationAction = async (action: string) => {
        if (!selectedClientForMap) return;
        if ((action === 'reject' || action === 'reject_relocation') && !locationRemarks.trim()) {
            toast({ title: 'Remarks Required', description: 'Please provide a reason for rejection.', variant: 'destructive' });
            return;
        }
        setIsSubmittingLocationAction(true);
        try {
            const payload: Record<string, unknown> = { action, remarks: locationRemarks.trim() || undefined };
        if (action === 'approve' || action === 'approve_relocation') {
            payload.bmLatitude  = parseFloat(bmLat);
            payload.bmLongitude = parseFloat(bmLng);
        }
        const res = await apiClient.post<any>(`/clients/${selectedClientForMap.accountId}/location`, payload);
            if (res.success) {
                toast({ title: 'Done', description: res.message || 'Location updated.' });
                setLocationRemarks('');
                // Refresh location data inline
                const refreshed = await apiClient.get<any>(`/clients/${selectedClientForMap.accountId}/location`);
                if (refreshed.success && refreshed.data) {
                    setLocationData(buildLocationData(refreshed.data));
                }
            } else {
                toast({ title: 'Error', description: res.error || 'Action failed', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Request failed', variant: 'destructive' });
        } finally { setIsSubmittingLocationAction(false); }
    };

    // ── BM: capture GPS for location approval ───────────────────────────────
    const captureBmGps = () => {
        setBmGpsError('');
        locateBm({
            onPosition: (lat, lng) => { setBmLat(lat.toFixed(6)); setBmLng(lng.toFixed(6)); },
            onDone: (pos) => setBmGpsAccuracy(pos.accuracy),
            onError: setBmGpsError,
            silent: true,
            liveUpdates: false,
        });
    };

    // ── FDO: capture GPS for relocation form ────────────────────────────────
    const captureRelocGps = () => {
        setRelocGpsError('');
        locateReloc({
            onPosition: (lat, lng) => { setRelocLat(lat.toFixed(6)); setRelocLng(lng.toFixed(6)); },
            onError: setRelocGpsError,
            subject: 'New location',
        });
    };

    // ── FDO: submit relocation request ──────────────────────────────────────
    const handleSubmitRelocation = async () => {
        if (!selectedClientForMap) return;
        const lat = parseFloat(relocLat), lng = parseFloat(relocLng);
        if (isNaN(lat) || isNaN(lng)) { toast({ title: 'GPS Required', description: 'Capture or enter new coordinates.', variant: 'destructive' }); return; }
        if (!relocReason.trim()) { toast({ title: 'Reason Required', description: 'Enter a reason for relocation.', variant: 'destructive' }); return; }
        setIsSubmittingReloc(true);
        try {
            const res = await apiClient.post<any>(`/clients/${selectedClientForMap.accountId}/location`, {
                action: 'relocate', newLatitude: lat, newLongitude: lng, remarks: relocReason.trim(),
            });
            if (res.success) {
                toast({ title: 'Relocation Submitted', description: 'Awaiting Branch Manager approval.' });
                setShowRelocForm(false); setRelocLat(''); setRelocLng(''); setRelocReason('');
                // Refresh status
                const refreshed = await apiClient.get<any>(`/clients/${selectedClientForMap.accountId}/location`);
                if (refreshed.success && refreshed.data) { setLocationData(buildLocationData(refreshed.data)); }
            } else { toast({ title: 'Error', description: res.error || 'Failed', variant: 'destructive' }); }
        } catch { toast({ title: 'Error', description: 'Request failed', variant: 'destructive' }); }
        finally { setIsSubmittingReloc(false); }
    };

    const handlePageChange = (newPage: number) => {
        setPagination(prev => ({ ...prev, currentPage: newPage }));
    };

    const handlePageSizeChange = (newPageSize: string) => {
        setPagination(prev => ({
            ...prev,
            pageSize: parseInt(newPageSize),
            currentPage: 1, // Reset to first page when changing page size
        }));
    };

    const fetchLoans = async (clientId: string): Promise<LoanInfo[]> => {
        setIsLoadingLoans(true);
        try {
            const result = await apiClient.get<{
                clientId: string;
                loans: LoanInfo[];
            }>(`/clients/${clientId}/loans`);

            if (result.success && result.data) {
                return result.data.loans;
            }

            return [];
        } catch (error) {
            console.error('Error fetching loans:', error);
            toast({
                title: 'Error',
                description: 'Failed to load loan information. Please try again.',
                variant: 'destructive',
            });
            return [];
        } finally {
            setIsLoadingLoans(false);
        }
    };

    const handleShowLoan = async (client: ClientSearchResult) => {
        setSelectedClientForLoan(client);
        setIsLoanDialogOpen(true);

        // Fetch loan data
        const loans = await fetchLoans(client.accountId);
        setLoanData(loans);
    };


    const fetchAdvance = async (clientId: string): Promise<AdvanceRow[]> => {
        setIsLoadingAdvance(true);
        try {
            const result = await apiClient.get<{
                clientId: string;
                advanceRows: AdvanceRow[];
            }>(`/clients/${clientId}/advance`);

            if (result.success && result.data) {
                return result.data.advanceRows;
            }

            return [];
        } catch (error) {
            console.error('Error fetching advance:', error);
            toast({
                title: 'Error',
                description: 'Failed to load advance information. Please try again.',
                variant: 'destructive',
            });
            return [];
        } finally {
            setIsLoadingAdvance(false);
        }
    };

    const handleShowAdvance = async (client: ClientSearchResult) => {
        setSelectedClientForAdvance(client);
        setIsAdvanceDialogOpen(true);
        
        // Fetch advance data
        const advanceRows = await fetchAdvance(client.accountId);
        setAdvanceData(advanceRows);
    };

    // ApprovalClientDetail (in readOnly mode) fetches everything itself from
    // GET /api/approval/clients/[clientId] once mounted with a clientId — no
    // separate fetch needed here.
    const handleShowClientDetail = (client: ClientSearchResult) => {
        setSelectedClientForDetail(client);
        setIsDetailDialogOpen(true);
    };

    return (
        <div className="relative w-full">
            {/* Background Accent */}
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/15 via-primary/10 to-purple-600/15 blur-2xl" />

            {/* Main Card */}
            <div
                className={cn(
                    'relative overflow-hidden rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl transition-all duration-700 dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95',
                    isMounted && 'animate-in fade-in slide-in-from-bottom-4 duration-700'
                )}
            >
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600 bg-[length:200%_100%] animate-shimmer" />

                {/* Header */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 sm:px-8 py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Users className="h-6 w-6 text-white" />
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                Search & Locate
                            </h1>
                            <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                Search for clients and view their location on the map
                            </p>
                        </div>
                    </div>
                </div>

                {/* Search Form */}
                <div className="px-4 sm:px-8 py-6 border-b border-primary/20 dark:border-sidebar-accent">
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-6"
                        aria-label="Client search form"
                    >
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {/* Search Type */}
                            <div className="space-y-2">
                                <Label
                                    htmlFor="searchType"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Search Type
                                </Label>
                                <Select
                                    value={searchType}
                                    onValueChange={(value: ClientSearchType) =>
                                        setSearchType(value)
                                    }
                                >
                                    <SelectTrigger
                                        id="searchType"
                                        className={cn(
                                            'h-11 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                    >
                                        <SelectValue placeholder="-- SELECT --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {searchOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                                className="cursor-pointer text-sm"
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Search Value */}
                            <div className="space-y-2">
                                <Label
                                    htmlFor="searchValue"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Search Value
                                </Label>
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        id="searchValue"
                                        value={searchValue}
                                        onChange={(event) => setSearchValue(event.target.value)}
                                        placeholder="Enter value to search"
                                        className="h-11 pl-9 text-sm bg-green-50 border border-primary/30 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-brand-green-darker dark:border-sidebar-accent"
                                    />
                                </div>
                            </div>

                            {/* Branch Filter — only for roles with access to more than one branch */}
                            {isMounted && isMultiBranchRole && (
                                <LocalBranchFilter value={branchFilter} onChange={setBranchFilter} includeAll />
                            )}

                            {/* Action Buttons */}
                            <div className="flex items-end gap-3">
                                <Button
                                    type="submit"
                                    disabled={isSearching || isLoading}
                                    className="h-11 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm flex-1"
                                >
                                    {isSearching ? (
                                        <span className="flex items-center gap-2">
                                            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Searching...
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2">
                                            <Search className="h-4 w-4" />
                                            Search
                                        </span>
                                    )}
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleReset}
                                    disabled={isSearching || isLoading}
                                    className="h-11 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Filters */}
                        {results.length > 0 && (
                            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-primary/20 dark:border-sidebar-accent">
                                <div className="flex items-center gap-2 text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                    <Filter className="h-4 w-4" />
                                    Filters:
                                </div>

                                {/* Center Filter */}
                                <Select value={centerFilter} onValueChange={setCenterFilter}>
                                    <SelectTrigger className="h-9 w-[200px] text-sm">
                                        <SelectValue placeholder="All Centers" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all_centers">All Centers</SelectItem>
                                        {Array.from(new Map(centers.map((c) => [c.name, c])).values()).map((center) => (
                                            <SelectItem key={center.id} value={center.name}>
                                                {center.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* Status Filter */}
                                <Select value={statusFilter} onValueChange={(value: 'all' | 'active' | 'inactive') => setStatusFilter(value)}>
                                    <SelectTrigger className="h-9 w-[150px] text-sm">
                                        <SelectValue placeholder="All Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Status</SelectItem>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="inactive">Inactive</SelectItem>
                                    </SelectContent>
                                </Select>

                                {(centerFilter !== 'all_centers' || statusFilter !== 'all') && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setCenterFilter('all_centers');
                                            setStatusFilter('all');
                                        }}
                                        className="h-9 text-xs"
                                    >
                                        <X className="h-3 w-3 mr-1" />
                                        Clear Filters
                                    </Button>
                                )}

                                <div className="ml-auto text-sm text-sidebar-accent dark:text-slate-400">
                                    Showing {filteredResults.length} of {results.length} clients
                                </div>
                            </div>
                        )}
                    </form>
                </div>

                {/* Results Table */}
                {isLoading ? (
                    <div className="px-4 sm:px-8 py-12">
                        <PageLoader label="Loading results..." fullScreen={false} />
                    </div>
                ) : results.length > 0 ? (
                    <>
                        <div className="px-4 pb-4 pt-4">
                            <div className="rounded-lg border border-primary/20 dark:border-sidebar-accent overflow-hidden">
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50 dark:bg-brand-green-darker/50 hover:bg-green-50 dark:hover:bg-brand-green-darker/50">
                                                <TableHead className="font-semibold">Account ID</TableHead>
                                                <TableHead className="font-semibold">Name</TableHead>
                                                {isAllBranchesView && (
                                                    <TableHead className="font-semibold">Branch</TableHead>
                                                )}
                                                <TableHead className="font-semibold">Center</TableHead>
                                                <TableHead className="font-semibold">Phone</TableHead>
                                                <TableHead className="font-semibold">Status</TableHead>
                                                <TableHead className="font-semibold text-center">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredResults.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={isAllBranchesView ? 7 : 6} className="text-center py-8 text-slate-500">
                                                        No results match the current filters
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                filteredResults.map((result) => (
                                                    <TableRow
                                                        key={result.accountId}
                                                        className="hover:bg-green-50 dark:hover:bg-brand-green-darker/30 transition-colors"
                                                    >
                                                        <TableCell className="font-medium">{result.displayAccountId}</TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <span className="font-medium">{result.clientName}</span>
                                                                    <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                                        {getPersonLabel(!!result.hasLoan).singular}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs text-slate-500">
                                                                    S/o: {result.spouseName}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        {isAllBranchesView && (
                                                            <TableCell className="text-sm">{result.branchName || '—'}</TableCell>
                                                        )}
                                                        <TableCell className="text-sm">
                                                            {result.centerName || (
                                                                <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                                                                    <span>⚠</span> No Center
                                                                </span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-sm">{result.phone}</TableCell>
                                                        <TableCell>
                                                            <Badge
                                                                variant={result.status === 'Active' ? 'default' : 'secondary'}
                                                                className={cn(
                                                                    result.status === 'Active'
                                                                        ? 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'
                                                                        : 'bg-brand-green-tint text-sidebar-accent hover:bg-brand-green-tint dark:bg-sidebar-accent dark:text-slate-400'
                                                                )}
                                                            >
                                                                {result.status}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center justify-center gap-2">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleLocateClient(result)}
                                                                    className="h-8 px-3 text-xs hover:bg-green-50 hover:text-primary dark:hover:bg-green-950/30"
                                                                    title="Locate on Map"
                                                                >
                                                                    <MapPin className="h-4 w-4 mr-1" />
                                                                    Locate
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleShowClientDetail(result)}
                                                                    className="h-8 px-3 text-xs hover:bg-green-50 hover:text-primary dark:hover:bg-brand-green-darker/30"
                                                                    title="View Client Profile"
                                                                >
                                                                    <Eye className="h-4 w-4 mr-1" />
                                                                    KYC
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        void handleShowLoan(result);
                                                                    }}
                                                                    className="h-8 px-3 text-xs hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-950/30"
                                                                    title="View Loans"
                                                                >
                                                                    <FileText className="h-4 w-4 mr-1" />
                                                                    Loans
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        void handleShowAdvance(result);
                                                                    }}
                                                                    className="h-8 px-3 text-xs hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30"
                                                                    title="View Advance"
                                                                >
                                                                    <TrendingUp className="h-4 w-4 mr-1" />
                                                                    Advance
                                                                </Button>
                                                                <HighmarkHistoryButton
                                                                    clientId={result.accountId}
                                                                    clientName={result.clientName}
                                                                    centerName={result.centerName}
                                                                    className="h-8 px-3 text-xs hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-950/30"
                                                                />
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </div>

                        {/* Pagination Controls */}
                        <div className="px-8 pb-6 pt-2">
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="flex items-center gap-2 text-sm text-sidebar-accent dark:text-slate-400">
                                    <span>Show</span>
                                    <Select
                                        value={pagination.pageSize.toString()}
                                        onValueChange={handlePageSizeChange}
                                    >
                                        <SelectTrigger className="h-9 w-[80px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="25">25</SelectItem>
                                            <SelectItem value="50">50</SelectItem>
                                            <SelectItem value="100">100</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <span>entries</span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(pagination.currentPage - 1)}
                                        disabled={pagination.currentPage === 1 || isLoading}
                                        className="h-9"
                                    >
                                        <ChevronLeft className="h-4 w-4 mr-1" />
                                        Previous
                                    </Button>

                                    <div className="flex items-center gap-1 px-3 text-sm">
                                        <span className="font-medium">{pagination.currentPage}</span>
                                        <span className="text-slate-500">of</span>
                                        <span className="font-medium">{pagination.totalPages}</span>
                                    </div>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(pagination.currentPage + 1)}
                                        disabled={pagination.currentPage >= pagination.totalPages || isLoading}
                                        className="h-9"
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </Button>
                                </div>

                                <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                    Total: {pagination.totalItems} clients
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="px-4 sm:px-8 py-12">
                        <div className="flex flex-col items-center justify-center text-center">
                            <div className="rounded-full bg-brand-green-tint dark:bg-sidebar-accent p-6 mb-4">
                                <Users className="h-12 w-12 text-slate-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground dark:text-white mb-2">
                                No clients found
                            </h3>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 max-w-md">
                                {searchValue ? 'No clients match your search criteria. Try adjusting your search.' : 'No clients available in the system.'}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Map Dialog */}
            <Dialog open={isMapDialogOpen} onOpenChange={setIsMapDialogOpen}>
                <DialogContent className="w-[98vw] sm:w-[98vw] !max-w-none max-h-[98vh] overflow-y-auto p-6">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MapIcon className="h-5 w-5 text-primary" />
                            Client Location
                        </DialogTitle>
                        <DialogDescription>
                            {selectedClientForMap && (
                                <>
                                    Viewing location for {selectedClientForMap.clientName} - {selectedClientForMap.accountId}
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedClientForMap && (() => {
                        // Prefer the dedicated location API (locationData) for the "has stored GPS" check,
                    // because the search result may not carry lat/lng (search endpoint omits it).
                    // Fall back to the search result while locationData is still loading.
                    const hasStored = locationData
                        ? (locationData.latitude != null && locationData.longitude != null)
                        : (!!selectedClientForMap.latitude && !!selectedClientForMap.longitude);
                        const effectiveLat = hasStored ? (locationData?.latitude ?? selectedClientForMap.latitude ?? null) : null;
                        const effectiveLng = hasStored ? (locationData?.longitude ?? selectedClientForMap.longitude ?? null) : null;
                        return (
                            <div className="space-y-4">
                                {/* Member/Client Info Card */}
                                <Card className="bg-green-50 dark:bg-brand-green-darker/50">
                                    <CardContent className="pt-4">
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">{getPersonLabel(!!selectedClientForMap.hasLoan).singular} Name</p>
                                                <p className="font-semibold">{selectedClientForMap.clientName}</p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Center</p>
                                                <p className="font-semibold">
                                                    {selectedClientForMap.centerName || (
                                                        <span className="text-amber-600 text-sm">⚠ No center</span>
                                                    )}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Phone</p>
                                                <p className="font-semibold">{selectedClientForMap.phone}</p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Latitude</p>
                                                <p className="font-mono text-xs">
                                                    {isLoadingLocation ? '…' : effectiveLat != null ? effectiveLat.toFixed(6) : '—'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Longitude</p>
                                                <p className="font-mono text-xs">
                                                    {isLoadingLocation ? '…' : effectiveLng != null ? effectiveLng.toFixed(6) : '—'}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Status</p>
                                                <Badge
                                                    variant={selectedClientForMap.status === 'Active' ? 'default' : 'secondary'}
                                                    className={cn(
                                                        selectedClientForMap.status === 'Active'
                                                            ? 'bg-green-100 text-green-700 hover:bg-green-100'
                                                            : 'bg-brand-green-tint text-sidebar-accent hover:bg-brand-green-tint'
                                                    )}
                                                >
                                                    {selectedClientForMap.status}
                                                </Badge>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Center Location</p>
                                                <p className="font-mono text-xs">
                                                    {isLoadingLocation ? '…' : (
                                                        locationData?.centerLatitude != null && locationData?.centerLongitude != null
                                                            ? `${locationData.centerLatitude.toFixed(6)}, ${locationData.centerLongitude.toFixed(6)}`
                                                            : '—'
                                                    )}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Distance from Center</p>
                                                <p className="font-semibold">
                                                    {isLoadingLocation ? '…' : formatDistanceMeters(locationData?.distanceFromCenterMeters ?? null)}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sidebar-accent dark:text-slate-400 mb-1">Distance from Branch</p>
                                                <p className="font-semibold">
                                                    {isLoadingLocation ? '…' : formatDistanceMeters(locationData?.distanceFromBranchMeters ?? null)}
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* ── Location approval status ── */}
                                {isLoadingLocation && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading location status…
                                    </div>
                                )}
                                {hasStored && !isLoadingLocation && locationData && locationData.locationApprovalStatus && (
                                    <div className={cn(
                                        'flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold',
                                        locationData.locationApprovalStatus === 'APPROVED'             ? 'border-emerald-200 bg-emerald-50 text-emerald-700'  :
                                        locationData.locationApprovalStatus === 'REJECTED'             ? 'border-red-200 bg-red-50 text-red-700'               :
                                        locationData.locationApprovalStatus === 'RELOCATION_REQUESTED' ? 'border-blue-200 bg-blue-50 text-blue-700'            :
                                        'border-amber-200 bg-amber-50 text-amber-700'
                                    )}>
                                        <span>Location: {(locationData.locationApprovalStatus as string).replace(/_/g, ' ')}</span>
                                        {locationData.locationApprovalStatus === 'RELOCATION_REQUESTED' && locationData.pendingLatitude != null && (
                                            <span className="font-mono font-normal text-[11px]">
                                                Pending → {locationData.pendingLatitude.toFixed(4)}, {locationData.pendingLongitude?.toFixed(4)}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* ── No GPS stored ── */}
                                {!isLoadingLocation && !hasStored && (
                                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        Location not mapped
                                    </div>
                                )}

                                {/* Map */}
                                {effectiveLat != null && effectiveLng != null && (
                                    <div className="rounded-lg overflow-hidden border border-primary/20 dark:border-sidebar-accent">
                                        <MapComponent latitude={effectiveLat} longitude={effectiveLng}
                                            centerName={selectedClientForMap.clientName} centerCode={selectedClientForMap.accountId}
                                            address={selectedClientForMap.address || undefined} />
                                    </div>
                                )}

                                {/* ── BM: Location approval actions ── */}
                                {(userRole === 'BRANCH_MANAGER' || userRole === 'ADMIN') && hasStored && !isLoadingLocation && locationData &&
                                    !!locationData.locationApprovalStatus && locationData.locationApprovalStatus !== 'APPROVED' && (() => {
                                    const isRelocation = locationData.locationApprovalStatus === 'RELOCATION_REQUESTED';
                                    const parsedBmLat = parseFloat(bmLat);
                                    const parsedBmLng = parseFloat(bmLng);
                                    const hasBmGps = !isNaN(parsedBmLat) && !isNaN(parsedBmLng);
                                    const distanceM = bmApprovalDistance.distanceMeters;
                                    const isMatch = distanceM != null && isLocationMatch(distanceM, bmGpsAccuracy);
                                    return (
                                        <div className="rounded-lg border border-primary/20 bg-green-50 dark:bg-brand-green-darker/30 p-4 space-y-3">
                                            <p className="text-xs font-semibold text-sidebar-accent dark:text-primary">
                                                {isRelocation ? '🔄 Relocation Request — Review & Approve' : '📍 Location Approval'}
                                            </p>
                                            {isRelocation && locationData.relocationRemarks && (
                                                <p className="text-xs text-muted-foreground italic">Reason: {locationData.relocationRemarks}</p>
                                            )}

                                            {/* Step 1: Capture BM GPS */}
                                            <div className="space-y-2">
                                                <p className="text-[11px] font-medium text-sidebar-accent">Step 1 — Capture your location to verify proximity</p>
                                                <Button size="sm" variant="outline" onClick={captureBmGps} disabled={isCapturingBmGps}
                                                    className="border-primary/40 text-sidebar-accent text-xs h-8">
                                                    {isCapturingBmGps ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{bmLocatingLabel}</> : <><Navigation className="h-3.5 w-3.5 mr-1.5" />Capture My Location</>}
                                                </Button>
                                                {bmGpsError && <p className="text-xs text-red-600">{bmGpsError}</p>}
                                                {hasBmGps && (
                                                    <p className="font-mono text-[11px] text-muted-foreground">
                                                        {parsedBmLat.toFixed(6)}, {parsedBmLng.toFixed(6)}
                                                        {bmGpsAccuracy != null && ` (±${Math.round(bmGpsAccuracy)} m accuracy)`}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Distance meter (road/driving distance) */}
                                            {hasBmGps && bmApprovalDistance.isLoading && (
                                                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating road distance…
                                                </div>
                                            )}
                                            {!bmApprovalDistance.isLoading && distanceM != null && (
                                                <div className={cn(
                                                    'flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold',
                                                    isMatch
                                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                        : 'border-red-200 bg-red-50 text-red-700'
                                                )}>
                                                    <span>{isMatch ? '✓ Match' : '✗ Mismatch'}</span>
                                                    <span className="font-normal">
                                                        {distanceM < 1000
                                                            ? `${Math.round(distanceM)} m from client`
                                                            : `${(distanceM / 1000).toFixed(2)} km from client`}
                                                        {' '}(limit {LOCATION_MATCH_RADIUS_METERS} m)
                                                    </span>
                                                </div>
                                            )}

                                            {/* Step 2: Remarks + approve/reject */}
                                            <div className="space-y-2">
                                                <p className="text-[11px] font-medium text-sidebar-accent">Step 2 — Remarks &amp; decision</p>
                                                <Input
                                                    value={locationRemarks}
                                                    onChange={(e) => setLocationRemarks(e.target.value)}
                                                    placeholder="Remarks (required to reject)…"
                                                    className="h-9 text-xs"
                                                    disabled={isSubmittingLocationAction}
                                                />
                                                <div className="flex gap-2">
                                                    <Button size="sm"
                                                        disabled={isSubmittingLocationAction || bmApprovalDistance.isLoading || !isMatch}
                                                        title={!isMatch ? 'You must be within 100 m of the client to approve' : ''}
                                                        onClick={() => handleLocationAction(isRelocation ? 'approve_relocation' : 'approve')}
                                                        className="bg-primary hover:bg-sidebar-accent text-white text-xs h-8 disabled:opacity-40">
                                                        {isSubmittingLocationAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '✓ Approve'}
                                                    </Button>
                                                    <Button size="sm" variant="outline"
                                                        disabled={isSubmittingLocationAction}
                                                        onClick={() => handleLocationAction(isRelocation ? 'reject_relocation' : 'reject')}
                                                        className="border-red-300 text-red-600 hover:bg-red-50 text-xs h-8">
                                                        {isSubmittingLocationAction ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '✕ Reject'}
                                                    </Button>
                                                </div>
                                                {!isMatch && hasBmGps && (
                                                    <p className="text-[11px] text-red-600">
                                                        You must be within {LOCATION_MATCH_RADIUS_METERS} m of the client location to approve
                                                        {bmGpsAccuracy != null && bmGpsAccuracy > 20 && ` (your GPS accuracy is ±${Math.round(bmGpsAccuracy)} m — try moving to open sky and recapturing for a tighter fix)`}.
                                                    </p>
                                                )}
                                                {!hasBmGps && (
                                                    <p className="text-[11px] text-amber-600">Capture your GPS location first to enable approval.</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ── FDO: Request relocation ── */}
                                {userRole === 'FDO' && hasStored && !isLoadingLocation && locationData && !!locationData.locationApprovalStatus && (
                                    <div className="space-y-2">
                                        {locationData.locationApprovalStatus === 'RELOCATION_REQUESTED' ? (
                                            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                                                A relocation request is already pending BM approval.
                                            </div>
                                        ) : !showRelocForm ? (
                                            <Button size="sm" variant="outline" onClick={() => setShowRelocForm(true)}
                                                className="border-primary/40 text-sidebar-accent text-xs h-8">
                                                <Navigation className="h-3.5 w-3.5 mr-1.5" /> Request Relocation
                                            </Button>
                                        ) : (
                                            <div className="rounded-lg border border-primary/20 bg-green-50 dark:bg-brand-green-darker/30 p-4 space-y-3">
                                                <p className="text-xs font-semibold text-sidebar-accent">New Location Coordinates</p>
                                                <Button size="sm" variant="outline" onClick={captureRelocGps} disabled={isCapturingRelocGps}
                                                    className="border-primary/40 text-sidebar-accent text-xs h-8">
                                                    {isCapturingRelocGps ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{relocLocatingLabel}</> : <><Navigation className="h-3.5 w-3.5 mr-1.5" />Capture GPS</>}
                                                </Button>
                                                {relocGpsError && <p className="text-xs text-red-600">{relocGpsError}</p>}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div><Label className="text-xs mb-1 block">New Latitude</Label>
                                                        <Input value={relocLat} onChange={(e) => setRelocLat(e.target.value)} placeholder="11.016844" className="font-mono h-9 text-xs" /></div>
                                                    <div><Label className="text-xs mb-1 block">New Longitude</Label>
                                                        <Input value={relocLng} onChange={(e) => setRelocLng(e.target.value)} placeholder="76.955833" className="font-mono h-9 text-xs" /></div>
                                                </div>
                                                <div><Label className="text-xs mb-1 block">Reason <span className="text-red-500">*</span></Label>
                                                    <Input value={relocReason} onChange={(e) => setRelocReason(e.target.value)} placeholder="Client moved to a new address…" className="h-9 text-xs" /></div>
                                                <div className="flex gap-2">
                                                    <Button size="sm" disabled={isSubmittingReloc} onClick={handleSubmitRelocation}
                                                        className="bg-primary hover:bg-sidebar-accent text-white text-xs h-8">
                                                        {isSubmittingReloc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Submit Relocation'}
                                                    </Button>
                                                    <Button size="sm" variant="ghost" onClick={() => setShowRelocForm(false)} className="text-xs h-8">Cancel</Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* Client Profile Detail (read-only) */}
            <Dialog
                open={isDetailDialogOpen}
                onOpenChange={(open) => {
                    setIsDetailDialogOpen(open);
                    if (!open) setSelectedClientForDetail(null);
                }}
            >
                <DialogContent className="w-[95vw] sm:w-[95vw] !max-w-5xl max-h-[95vh] overflow-y-auto p-4 sm:p-6">
                    <DialogTitle className="sr-only">
                        Client Profile — {selectedClientForDetail?.clientName}
                    </DialogTitle>
                    {selectedClientForDetail && (
                        <ClientProfileDetail clientId={selectedClientForDetail.accountId} />
                    )}
                </DialogContent>
            </Dialog>

            {/* Loan Info */}
            <LoanInfoDialog
                isOpen={isLoanDialogOpen}
                onOpenChange={(open) => {
                    setIsLoanDialogOpen(open);
                    if (!open) {
                        setSelectedClientForLoan(null);
                        setLoanData([]);
                    }
                }}
                clientName={selectedClientForLoan?.clientName ?? null}
                centerName={selectedClientForLoan?.centerName ?? null}
                loans={loanData}
                isLoading={isLoadingLoans}
            />

            {/* Advance Info */}
            <AdvanceInfoDialog
                isOpen={isAdvanceDialogOpen}
                onOpenChange={(open) => {
                    setIsAdvanceDialogOpen(open);
                    if (!open) {
                        setSelectedClientForAdvance(null);
                        setAdvanceData([]);
                    }
                }}
                clientName={selectedClientForAdvance?.clientName ?? null}
                centerName={selectedClientForAdvance?.centerName ?? null}
                rows={advanceData}
                isLoading={isLoadingAdvance}
            />

        </div>
    );
}

