'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
    Search, Navigation, Loader2, MapPin, RotateCcw, AlertCircle,
    CheckCircle2, RefreshCw, Home,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import LocationSearchBox from '@/components/centers/LocationSearchBox';

const MapComponent = dynamic(() => import('@/components/centers/CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[280px] items-center justify-center rounded-lg border bg-muted">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
    ),
});

type SearchType = 'clientId' | 'clientName' | 'phone';

interface ClientLocation {
    id?: string;
    clientId: string;
    firstName: string;
    lastName: string;
    latitude: number | null;
    longitude: number | null;
    permanentAddress?: string | null;
    locationApprovalStatus: string;
    pendingLatitude?: number | null;
    pendingLongitude?: number | null;
    center?: { name: string; code: string } | null;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
}

export function RelocateClientClient() {
    const { toast } = useToast();

    // Search
    const [searchType, setSearchType] = useState<SearchType>('clientId');
    const [searchValue, setSearchValue] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<ClientLocation[]>([]);
    const [selectedClient, setSelectedClient] = useState<ClientLocation | null>(null);

    // New location
    const [newLat, setNewLat] = useState('');
    const [newLng, setNewLng] = useState('');
    const { locate, isLocating: isCapturingGps, locatingLabel } = useAccurateLocation();
    const [gpsError, setGpsError] = useState('');
    const [relocReason, setRelocReason] = useState('');

    // Submission
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ── Search ─────────────────────────────────────────────────────────────────

    const handleSearch = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchValue.trim()) return;
        setIsSearching(true);
        setSearchResults([]);
        setSelectedClient(null);
        try {
            const result = await apiClient.get<{ clients: ClientLocation[] }>(
                `/clients/search?searchType=${searchType}&searchValue=${encodeURIComponent(searchValue.trim())}`,
            );
            if (result.success && result.data) {
                const list = result.data.clients ?? [];
                setSearchResults(list);
                if (list.length === 0) {
                    toast({ title: 'No clients found', description: 'Try a different search.', variant: 'destructive' });
                }
            }
        } catch (e) {
            toast({ title: 'Search failed', description: 'An error occurred.', variant: 'destructive' });
        } finally {
            setIsSearching(false);
        }
    }, [searchType, searchValue, toast]);

    // ── GPS capture ────────────────────────────────────────────────────────────

    const captureGps = () => {
        setGpsError('');
        locate({
            onPosition: (lat, lng) => { setNewLat(lat.toFixed(6)); setNewLng(lng.toFixed(6)); },
            onError: setGpsError,
            subject: 'New location',
        });
    };

    // ── Submit relocation ──────────────────────────────────────────────────────

    const handleSubmit = async () => {
        if (!selectedClient) return;
        const lat = parseFloat(newLat), lng = parseFloat(newLng);
        if (isNaN(lat) || isNaN(lng)) {
            toast({ title: 'GPS required', description: 'Enter or capture new coordinates.', variant: 'destructive' });
            return;
        }
        if (!relocReason.trim()) {
            toast({ title: 'Reason required', description: 'Please enter a reason for relocation.', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const result = await apiClient.post(`/clients/${selectedClient.clientId}/location`, {
                action: 'relocate',
                newLatitude: lat,
                newLongitude: lng,
                remarks: relocReason.trim(),
            });
            if (result.success) {
                toast({ title: 'Relocation Submitted', description: 'Waiting for Branch Manager approval.' });
                // Reset form
                setSelectedClient(null);
                setSearchResults([]);
                setSearchValue('');
                setNewLat(''); setNewLng(''); setRelocReason('');
            } else {
                toast({ title: 'Failed', description: result.error || 'Submission failed.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An error occurred.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setSelectedClient(null); setSearchResults([]); setSearchValue('');
        setNewLat(''); setNewLng(''); setRelocReason(''); setGpsError('');
    };

    // ── New preview lat/lng (for live map preview while typing) ───────────────
    const previewLat = parseFloat(newLat);
    const previewLng = parseFloat(newLng);
    const hasValidNewCoords = !isNaN(previewLat) && !isNaN(previewLng);

    const statusColor: Record<string, string> = {
        PENDING_APPROVAL: 'bg-amber-100 text-amber-700 border-amber-200',
        APPROVED: 'bg-green-100 text-green-700 border-green-200',
        REJECTED: 'bg-red-100 text-red-700 border-red-200',
        RELOCATION_REQUESTED: 'bg-blue-100 text-blue-700 border-blue-200',
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Client Relocation
                </h1>
                <p className="text-muted-foreground mt-1">
                    Submit a new GPS location for a client who has moved. Branch Manager will re-verify.
                </p>
            </div>

            {/* Step 1: Search */}
            <Card className="border-2 border-primary/20 shadow-lg overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary to-primary" />
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Search className="h-4 w-4 text-primary" /> Step 1 — Find Member / Client
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                        <Select value={searchType} onValueChange={(v) => setSearchType(v as SearchType)}>
                            <SelectTrigger className="w-full sm:w-44 h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="clientId">ID</SelectItem>
                                <SelectItem value="clientName">Name</SelectItem>
                                <SelectItem value="phone">Phone</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            value={searchValue}
                            onChange={(e) => setSearchValue(e.target.value)}
                            placeholder="Search value..."
                            className="flex-1 h-10"
                        />
                        <Button type="submit" disabled={isSearching} className="bg-primary hover:bg-sidebar-accent text-white h-10 px-6">
                            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                    </form>

                    {/* Search results */}
                    {searchResults.length > 0 && !selectedClient && (
                        <div className="mt-4 space-y-2">
                            <p className="text-xs text-muted-foreground">{searchResults.length} result(s) found — select one:</p>
                            {searchResults.map((c) => (
                                <div
                                    key={c.clientId}
                                    className="flex items-center justify-between p-3 rounded-lg border hover:border-primary/50 hover:bg-green-50/50 cursor-pointer transition"
                                    onClick={() => { setSelectedClient(c); setSearchResults([]); }}
                                >
                                    <div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <p className="font-medium text-sm">{c.firstName} {c.lastName}</p>
                                            <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                {getPersonLabel(!!c.hasLoan).singular}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{c.clientId} · {c.center?.name ?? 'No center'}</p>
                                    </div>
                                    <Badge variant="outline" className={cn('text-xs', statusColor[c.locationApprovalStatus] ?? '')}>
                                        {c.locationApprovalStatus?.replace(/_/g, ' ')}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Step 2: Selected client + new location */}
            {selectedClient && (
                <>
                    {/* Pending relocation warning */}
                    {selectedClient.locationApprovalStatus === 'RELOCATION_REQUESTED' && (
                        <Alert className="border-amber-200 bg-amber-50">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <AlertTitle>Relocation Already Pending</AlertTitle>
                            <AlertDescription>
                                This {getPersonLabel(!!selectedClient.hasLoan).singular.toLowerCase()} already has a relocation request awaiting BM approval. You cannot submit another until it is resolved.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Current location */}
                    <Card className="border overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-primary to-primary" />
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-primary" />
                                Current Location — {selectedClient.firstName} {selectedClient.lastName}
                            </CardTitle>
                            <CardDescription>{selectedClient.clientId} · {selectedClient.center ? `${selectedClient.center.code} – ${selectedClient.center.name}` : 'No center'}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {selectedClient.latitude != null ? (
                                <>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <p className="text-xs text-muted-foreground">Latitude</p>
                                            <p className="font-mono">{selectedClient.latitude.toFixed(6)}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Longitude</p>
                                            <p className="font-mono">{selectedClient.longitude?.toFixed(6)}</p>
                                        </div>
                                    </div>
                                    <MapComponent
                                        latitude={selectedClient.latitude}
                                        longitude={selectedClient.longitude!}
                                        centerName={`${selectedClient.firstName} ${selectedClient.lastName} (Current)`}
                                        centerCode={selectedClient.clientId}
                                        address={selectedClient.permanentAddress ?? undefined}
                                    />
                                </>
                            ) : (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>No current coordinates on record.</AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                    </Card>

                    {/* New location input */}
                    {selectedClient.locationApprovalStatus !== 'RELOCATION_REQUESTED' && (
                        <Card className="border-2 border-primary/20 overflow-hidden">
                            <div className="h-1.5 bg-gradient-to-r from-primary to-primary" />
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Navigation className="h-4 w-4 text-primary" /> Step 2 — New Location
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Button
                                    variant="outline"
                                    onClick={captureGps}
                                    disabled={isCapturingGps}
                                    className="border-primary/40 text-sidebar-accent"
                                >
                                    {isCapturingGps
                                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{locatingLabel}</>
                                        : <><Navigation className="h-3.5 w-3.5 mr-1.5" />Capture Current Location</>}
                                </Button>
                                {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}

                                <LocationSearchBox
                                    onSelect={(lat, lng) => { setGpsError(''); setNewLat(lat.toFixed(6)); setNewLng(lng.toFixed(6)); }}
                                    biasLat={selectedClient.latitude ?? undefined}
                                    biasLng={selectedClient.longitude ?? undefined}
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-sm">New Latitude</Label>
                                        <Input value={newLat} onChange={(e) => setNewLat(e.target.value)} placeholder="e.g. 11.016844" className="mt-1 font-mono" />
                                    </div>
                                    <div>
                                        <Label className="text-sm">New Longitude</Label>
                                        <Input value={newLng} onChange={(e) => setNewLng(e.target.value)} placeholder="e.g. 76.955833" className="mt-1 font-mono" />
                                    </div>
                                </div>

                                {/* Live preview map */}
                                {hasValidNewCoords && (
                                    <div>
                                        <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                                            <Home className="h-3 w-3" /> New Location Preview
                                        </p>
                                        <MapComponent
                                            latitude={previewLat}
                                            longitude={previewLng}
                                            centerName={`${selectedClient.firstName} ${selectedClient.lastName} (New)`}
                                            centerCode={selectedClient.clientId}
                                        />
                                    </div>
                                )}

                                <div>
                                    <Label className="text-sm">Reason for Relocation <span className="text-red-500">*</span></Label>
                                    <Textarea
                                        value={relocReason}
                                        onChange={(e) => setRelocReason(e.target.value)}
                                        placeholder="e.g. Member moved to a new house in the same area..."
                                        className="mt-1.5 h-24 resize-none"
                                    />
                                </div>

                                <div className="flex gap-3">
                                    <Button
                                        className="flex-1 bg-primary hover:bg-sidebar-accent text-white"
                                        onClick={handleSubmit}
                                        disabled={isSubmitting}
                                    >
                                        {isSubmitting
                                            ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Submitting...</>
                                            : <><RefreshCw className="h-4 w-4 mr-1.5" />Submit Relocation Request</>}
                                    </Button>
                                    <Button variant="outline" onClick={handleReset} disabled={isSubmitting}>
                                        <RotateCcw className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}
