'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Loader2, MapPin, RotateCcw, AlertCircle, CheckCircle2,
    Map, Search, Filter, Navigation,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';
import { Badge } from '@/components/ui/badge';
import { getPersonLabel } from '@/app/lib/person-label';
import LocationSearchBox from '@/components/centers/LocationSearchBox';

// Dynamically import the map component to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('@/components/centers/CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[600px] items-center justify-center rounded-lg border bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    ),
});

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
    phone?: string | null;
    email?: string | null;
    centerId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
};

/** 'all' = all branch clients, 'none' = no-center clients, any other string = centerId */
type CenterFilter = 'all' | 'none' | string;

export function LocateClientClient() {
    const { toast } = useToast();

    // Branch / no-branch state
    const [branchId, setBranchId] = useState<string | null>(null);
    const [noBranch, setNoBranch] = useState(false);

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN'
        || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH'
        || storedUser?.role === 'AREA_MANAGER'
        || storedUser?.role === 'DIVISION_MANAGER';
    const [branches, setBranches] = useState<Center[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Centers for the filter dropdown
    const [centers, setCenters] = useState<Center[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);

    // Center filter: 'all' | 'none' | '<centerId>'
    const [centerFilter, setCenterFilter] = useState<CenterFilter>('all');

    // Clients list
    const [clients, setClients] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [isLoadingClients, setIsLoadingClients] = useState(false);

    // Search
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Manual / override coordinates (used when client has no GPS)
    const [manualLat, setManualLat] = useState('');
    const [manualLng, setManualLng] = useState('');
    const { locate, isLocating: isCapturingGps, locatingLabel } = useAccurateLocation();
    const [gpsError, setGpsError] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);

    // ── Debounce search ──────────────────────────────────────────────────────
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search]);

    // ── Resolve branch on mount — ADMIN/AREA_MANAGER get a branch picker,
    //    others are locked to their own branch ────────────────────────────────
    useEffect(() => {
        if (isAdminOrAM) {
            setIsLoadingBranches(true);
            fetch('/api/branches')
                .then((res) => res.json())
                .then((json) => {
                    let list: Center[] = (json?.data ?? []).map(
                        (b: any) => ({ id: b.id, name: b.name, code: b.code })
                    );
                    if (storedUser?.role === 'AREA_MANAGER') {
                        const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                        if (assignedBranchIds.length > 0) {
                            list = list.filter((b) => assignedBranchIds.includes(b.id));
                        }
                    }
                    setBranches(list);
                    const activeBranch = branchStorage.getActiveBranch();
                    const preferredId = activeBranch?.id ?? storedUser?.branchId;
                    const match = list.find((b) => b.id === preferredId) ?? list[0];
                    if (match) {
                        setBranchId(match.id);
                    } else {
                        setNoBranch(true);
                    }
                })
                .catch(() => {
                    toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                })
                .finally(() => setIsLoadingBranches(false));
        } else {
            const activeBranch = branchStorage.getActiveBranch();
            const id = activeBranch?.id || storedUser?.branchId || null;
            if (!id) {
                setNoBranch(true);
                return;
            }
            setBranchId(id);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Fetch centers whenever the resolved/selected branch changes ─────────
    useEffect(() => {
        if (branchId) {
            setCenterFilter('all');
            void fetchCenters(branchId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    // ── Fetch centers (for filter dropdown) ──────────────────────────────────
    const fetchCenters = async (bid: string) => {
        setIsLoadingCenters(true);
        try {
            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${bid}&includeInactive=false&status=APPROVED`
            );
            if (result.success && result.data) {
                setCenters(Array.isArray(result.data) ? result.data : []);
            } else {
                setCenters([]);
                toast({ title: 'Error', description: 'Failed to load centers.', variant: 'destructive' });
            }
        } catch (e) {
            console.error('Error fetching centers:', e);
            setCenters([]);
            toast({ title: 'Error', description: 'Failed to load centers.', variant: 'destructive' });
        } finally {
            setIsLoadingCenters(false);
        }
    };

    // ── Fetch clients ────────────────────────────────────────────────────────
    const fetchClients = useCallback(async () => {
        if (!branchId) return;
        setIsLoadingClients(true);
        try {
            const params = new URLSearchParams();
            params.set('includeInactive', 'false');
            params.set('pageSize', '200');
            if (branchId) params.set('branchId', branchId);
            if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());

            if (centerFilter === 'none') {
                params.set('noCenter', 'true');
            } else if (centerFilter === 'all') {
                params.set('allBranch', 'true');
            } else {
                params.set('centerId', centerFilter);
            }

            const result = await apiClient.get<{ clients: Client[] }>(
                `/clients?${params.toString()}`
            );

            if (result.success && result.data) {
                const list = Array.isArray(result.data)
                    ? (result.data as Client[])
                    : (result.data.clients ?? []);
                setClients(list);
                // Deselect if current selection no longer in list
                if (selectedClientId && !list.find((c) => c.id === selectedClientId)) {
                    setSelectedClientId('');
                }
            } else {
                setClients([]);
                toast({ title: 'Error', description: 'Failed to load clients.', variant: 'destructive' });
            }
        } catch (error) {
            console.error('Error fetching clients:', error);
            setClients([]);
            toast({ title: 'Error', description: 'Failed to load clients.', variant: 'destructive' });
        } finally {
            setIsLoadingClients(false);
        }
    }, [branchId, debouncedSearch, centerFilter, selectedClientId, toast]);

    useEffect(() => {
        void fetchClients();
    }, [fetchClients]);

    // ── Reset manual coords whenever client changes ──────────────────────────
    useEffect(() => {
        setManualLat('');
        setManualLng('');
        setGpsError('');
    }, [selectedClientId]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const selectedClient = useMemo(
        () => clients.find((c) => c.id === selectedClientId) ?? null,
        [clients, selectedClientId]
    );

    /** Client has coordinates stored in DB */
    const hasStoredCoords =
        selectedClient?.latitude != null && selectedClient?.longitude != null;

    /** Valid manual coordinates typed by user */
    const parsedManualLat = parseFloat(manualLat);
    const parsedManualLng = parseFloat(manualLng);
    const hasValidManualCoords = !isNaN(parsedManualLat) && !isNaN(parsedManualLng);

    /** The effective coordinates to show on the map */
    const effectiveLat = hasStoredCoords ? selectedClient!.latitude! : (hasValidManualCoords ? parsedManualLat : null);
    const effectiveLng = hasStoredCoords ? selectedClient!.longitude! : (hasValidManualCoords ? parsedManualLng : null);
    const hasEffectiveCoords = effectiveLat != null && effectiveLng != null;

    // ── GPS capture ──────────────────────────────────────────────────────────
    const captureGps = () => {
        setGpsError('');
        locate({
            onPosition: (lat, lng) => {
                setManualLat(lat.toFixed(6));
                setManualLng(lng.toFixed(6));
            },
            onError: setGpsError,
            subject: 'Member location',
        });
    };

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleCenterFilterChange = (value: string) => {
        setCenterFilter(value);
        setSelectedClientId('');
    };

    const handleClientChange = (clientId: string) => {
        setSelectedClientId(clientId);
    };

    const handleSubmit = async () => {
        if (!selectedClientId || !selectedClient) {
            toast({ title: 'Validation Error', description: 'Please select a client.', variant: 'destructive' });
            return;
        }
        if (!hasEffectiveCoords) {
            toast({ title: 'Location Required', description: 'Enter coordinates manually or capture via GPS.', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 300));
            toast({ title: 'Located', description: `"${selectedClient.firstName} ${selectedClient.lastName}" shown on map.` });
        } catch {
            toast({ title: 'Error', description: 'Failed to process request.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setSelectedClientId('');
        setSearch('');
        setCenterFilter('all');
        setManualLat('');
        setManualLng('');
        setGpsError('');
        toast({ title: 'Reset', description: 'Form has been reset.' });
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Locate Client
                </h1>
                <p className="text-muted-foreground">
                    Search and select a client to view their location on the map
                </p>
            </div>

            {/* No-branch alert */}
            {noBranch && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>No Branch Assigned</AlertTitle>
                    <AlertDescription>
                        Your account is not linked to any branch. Please contact your administrator to
                        assign a branch before using this page.
                    </AlertDescription>
                </Alert>
            )}

            {/* Main Form Card */}
            {!noBranch && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                    {/* Top Accent Bar */}
                    <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                    <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                <MapPin className="h-5 w-5 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">Member / Client Selection</CardTitle>
                                <CardDescription>Filter by center, then search and choose a member or client</CardDescription>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="pt-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            {/* ── Branch Filter — visible only for Admin / Area Manager ── */}
                            {isAdminOrAM && (
                                <div className="space-y-2">
                                    <Label htmlFor="branch-filter" className="text-sm font-medium leading-none">
                                        Branch
                                    </Label>
                                    <Select
                                        value={branchId ?? ''}
                                        onValueChange={(v) => setBranchId(v)}
                                        disabled={isLoadingBranches || branches.length === 0}
                                    >
                                        <SelectTrigger id="branch-filter" className="w-full h-11">
                                            <SelectValue placeholder="-- SELECT BRANCH --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{b.name}</span>
                                                        <span className="text-muted-foreground text-xs">({b.code})</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* ── Center Filter ── */}
                            <div className="space-y-2">
                                <Label htmlFor="center-filter" className="text-sm font-medium leading-none flex items-center gap-1.5">
                                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                                    Filter by Center
                                </Label>
                                <Select
                                    value={centerFilter}
                                    onValueChange={handleCenterFilterChange}
                                    disabled={isLoadingCenters}
                                >
                                    <SelectTrigger id="center-filter" className="w-full h-11">
                                        <SelectValue placeholder="-- ALL --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">
                                            <span className="font-medium">All Members / Clients</span>
                                        </SelectItem>
                                        <SelectItem value="none">
                                            <div className="flex items-center gap-2">
                                                <span className="text-amber-600 font-medium">⚠ No Center (Unassigned)</span>
                                            </div>
                                        </SelectItem>
                                        {isLoadingCenters ? (
                                            <div className="px-2 py-1.5 text-sm text-muted-foreground flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading centers...
                                            </div>
                                        ) : (
                                            centers.map((center) => (
                                                <SelectItem key={center.id} value={center.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{center.name}</span>
                                                        <span className="text-muted-foreground text-xs">({center.code})</span>
                                                    </div>
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* ── Search Input ── */}
                            <div className="space-y-2">
                                <Label htmlFor="client-search" className="text-sm font-medium leading-none">
                                    Search Member / Client
                                </Label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="client-search"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="ID, name or phone..."
                                        className="pl-9 h-11"
                                    />
                                </div>
                            </div>

                            {/* ── Client Select ── */}
                            <div className="space-y-2">
                                <Label htmlFor="client-select" className="text-sm font-medium leading-none">
                                    Name
                                </Label>
                                <Select
                                    value={selectedClientId}
                                    onValueChange={handleClientChange}
                                    disabled={isLoadingClients || clients.length === 0}
                                >
                                    <SelectTrigger id="client-select" className="w-full h-11">
                                        <SelectValue
                                            placeholder={isLoadingClients ? 'Loading...' : '-- SELECT --'}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {isLoadingClients ? (
                                            <div className="px-2 py-1.5 text-sm text-muted-foreground flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading clients...
                                            </div>
                                        ) : clients.length === 0 ? (
                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                No clients found
                                            </div>
                                        ) : (
                                            clients.map((client) => (
                                                <SelectItem key={client.id} value={client.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span>
                                                            {client.firstName} {client.lastName}{' '}
                                                            <span className="text-muted-foreground text-xs">
                                                                ({client.clientId})
                                                            </span>
                                                        </span>
                                                        {!client.centerId && (
                                                            <span className="text-xs text-amber-600 font-medium">
                                                                ⚠ No center
                                                            </span>
                                                        )}
                                                    </div>
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* ── Coordinates section ── */}
                        {selectedClient && (
                            <>
                                {hasStoredCoords ? (
                                    /* Read-only stored coordinates */
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <Label htmlFor="latitude" className="text-sm font-medium leading-none">
                                                Latitude
                                            </Label>
                                            <Input
                                                id="latitude"
                                                value={selectedClient.latitude?.toFixed(6) || ''}
                                                readOnly
                                                disabled
                                                className="bg-muted cursor-not-allowed"
                                                placeholder="--"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="longitude" className="text-sm font-medium leading-none">
                                                Longitude
                                            </Label>
                                            <Input
                                                id="longitude"
                                                value={selectedClient.longitude?.toFixed(6) || ''}
                                                readOnly
                                                disabled
                                                className="bg-muted cursor-not-allowed"
                                                placeholder="--"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    /* No stored GPS — allow manual entry */
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-4">
                                        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-sm font-medium">No GPS Stored</p>
                                                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                                                    This client has no saved coordinates. Capture your current location or enter coordinates manually to view on map.
                                                </p>
                                            </div>
                                        </div>

                                        {/* GPS capture button */}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={captureGps}
                                            disabled={isCapturingGps}
                                            className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400"
                                        >
                                            {isCapturingGps ? (
                                                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{locatingLabel}</>
                                            ) : (
                                                <><Navigation className="h-3.5 w-3.5 mr-1.5" />Capture My Location</>
                                            )}
                                        </Button>
                                        {gpsError && (
                                            <p className="text-xs text-red-600 dark:text-red-400">{gpsError}</p>
                                        )}

                                        <LocationSearchBox
                                            onSelect={(lat, lng) => { setGpsError(''); setManualLat(lat.toFixed(6)); setManualLng(lng.toFixed(6)); }}
                                        />

                                        {/* Manual entry */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-1.5">
                                                <Label htmlFor="manual-lat" className="text-sm font-medium">
                                                    Latitude <span className="text-xs text-muted-foreground">(manual)</span>
                                                </Label>
                                                <Input
                                                    id="manual-lat"
                                                    value={manualLat}
                                                    onChange={(e) => setManualLat(e.target.value)}
                                                    placeholder="e.g. 11.016844"
                                                    className="font-mono h-10"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label htmlFor="manual-lng" className="text-sm font-medium">
                                                    Longitude <span className="text-xs text-muted-foreground">(manual)</span>
                                                </Label>
                                                <Input
                                                    id="manual-lng"
                                                    value={manualLng}
                                                    onChange={(e) => setManualLng(e.target.value)}
                                                    placeholder="e.g. 76.955833"
                                                    className="font-mono h-10"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-wrap gap-3 pt-2">
                            <Button
                                onClick={handleSubmit}
                                disabled={!selectedClientId || !hasEffectiveCoords || isSubmitting}
                                className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                size="lg"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Locating...
                                    </>
                                ) : (
                                    <>
                                        <MapPin className="mr-2 h-4 w-4" />
                                        Locate on Map
                                    </>
                                )}
                            </Button>

                            <Button
                                onClick={handleReset}
                                disabled={!selectedClientId && !search && centerFilter === 'all'}
                                variant="outline"
                                className="flex-1 min-w-[120px]"
                                size="lg"
                            >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Reset
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Selected Client Details */}
            {selectedClient && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-primary dark:text-primary" />
                                Client Details
                            </CardTitle>
                            {hasStoredCoords ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    GPS Stored
                                </Badge>
                            ) : hasValidManualCoords ? (
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
                                    <Navigation className="h-3 w-3 mr-1" />
                                    Manual Entry
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    No Location
                                </Badge>
                            )}
                        </div>
                        <CardDescription>Information about the selected {getPersonLabel(!!selectedClient.hasLoan).singular.toLowerCase()}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">{getPersonLabel(!!selectedClient.hasLoan).singular} Name</p>
                                <p className="text-base font-semibold">
                                    {selectedClient.firstName} {selectedClient.lastName}
                                </p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">{getPersonLabel(!!selectedClient.hasLoan).singular} ID</p>
                                <p className="text-base font-semibold">{selectedClient.clientId}</p>
                            </div>
                            {selectedClient.phone && (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Phone</p>
                                    <p className="text-base">{selectedClient.phone}</p>
                                </div>
                            )}
                            {selectedClient.email && (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-muted-foreground">Email</p>
                                    <p className="text-base">{selectedClient.email}</p>
                                </div>
                            )}
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Center</p>
                                <p className="text-base">
                                    {selectedClient.centerId ? (
                                        centers.find((c) => c.id === selectedClient.centerId)
                                            ? `${centers.find((c) => c.id === selectedClient.centerId)!.name} (${centers.find((c) => c.id === selectedClient.centerId)!.code})`
                                            : selectedClient.centerId
                                    ) : (
                                        <span className="text-amber-600 text-sm">⚠ No center assigned</span>
                                    )}
                                </p>
                            </div>
                            {hasEffectiveCoords && (
                                <React.Fragment>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-muted-foreground">
                                            Latitude {!hasStoredCoords && <span className="text-xs text-blue-500">(manual)</span>}
                                        </p>
                                        <p className="text-base font-mono text-sm">
                                            {effectiveLat?.toFixed(6)}
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-muted-foreground">
                                            Longitude {!hasStoredCoords && <span className="text-xs text-blue-500">(manual)</span>}
                                        </p>
                                        <p className="text-base font-mono text-sm">
                                            {effectiveLng?.toFixed(6)}
                                        </p>
                                    </div>
                                </React.Fragment>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Map Display */}
            {selectedClient && hasEffectiveCoords && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Map className="h-5 w-5" />
                            Locate Client
                            {!hasStoredCoords && (
                                <Badge variant="outline" className="ml-2 text-xs bg-blue-50 text-blue-700 border-blue-200">
                                    Manual Coordinates
                                </Badge>
                            )}
                        </CardTitle>
                        <CardDescription>
                            Map location of {selectedClient.firstName} {selectedClient.lastName}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <MapComponent
                            latitude={effectiveLat!}
                            longitude={effectiveLng!}
                            centerName={`${selectedClient.firstName} ${selectedClient.lastName}`}
                            centerCode={selectedClient.clientId}
                            address={selectedClient.address || undefined}
                        />
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {!noBranch && !isLoadingClients && clients.length === 0 && !search && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <MapPin className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Members / Clients Found</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            {centerFilter === 'none'
                                ? 'There are no clients without a center assignment in your branch.'
                                : centerFilter !== 'all'
                                ? 'There are no active clients in the selected center.'
                                : 'There are no active clients in your branch. Please enroll clients first.'}
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
