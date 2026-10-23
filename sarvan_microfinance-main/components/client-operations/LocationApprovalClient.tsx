'use client';

import { useState, useEffect, useCallback } from 'react';
import { StorageImage } from '@/components/storage/StorageMedia';
import dynamic from 'next/dynamic';
import {
    MapPin, CheckCircle2, XCircle, RotateCcw, Loader2, AlertCircle,
    Navigation, Home, QrCode, Image as ImageIcon, ChevronLeft, Eye,
    Clock, CheckCheck, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { isLocationMatch, LOCATION_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';
import { useDrivingDistance } from '@/hooks/useDrivingDistance';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDateTime } from '@/app/lib/date-format';

const MapComponent = dynamic(() => import('@/components/centers/CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[300px] items-center justify-center rounded-lg border bg-muted">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
    ),
});

// ── Types ────────────────────────────────────────────────────────────────────

type LocationApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RELOCATION_REQUESTED';

interface KycDoc { id: string; documentType: string; fileUrl: string | null; }

interface ClientLocationRow {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    permanentAddress?: string | null;
    latitude: number | null;
    longitude: number | null;
    locationApprovalStatus: LocationApprovalStatus;
    locationApprovedAt?: string | null;
    locationApprovalRemarks?: string | null;
    relocationRequestedAt?: string | null;
    relocationRemarks?: string | null;
    createdAt: string;
    center?: { id: string; name: string; code: string } | null;
    locationApprovedBy?: { id: string; firstName: string; lastName: string } | null;
    relocationRequestedBy?: { id: string; firstName: string; lastName: string } | null;
    kycDocuments: KycDoc[];
}

interface DetailInfo extends ClientLocationRow {
    pendingLatitude?: number | null;
    pendingLongitude?: number | null;
    bmVisitLatitude?: number | null;
    bmVisitLongitude?: number | null;
    lastVisitDistance?: number | null;
    matchRadiusMeters?: number;
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<LocationApprovalStatus, { label: string; color: string; icon: React.ReactNode }> = {
    PENDING_APPROVAL: {
        label: 'Pending Approval',
        color: 'bg-amber-100 text-amber-700 border-amber-200',
        icon: <Clock className="h-3 w-3" />,
    },
    APPROVED: {
        label: 'Approved',
        color: 'bg-green-100 text-green-700 border-green-200',
        icon: <CheckCircle2 className="h-3 w-3" />,
    },
    REJECTED: {
        label: 'Rejected',
        color: 'bg-red-100 text-red-700 border-red-200',
        icon: <XCircle className="h-3 w-3" />,
    },
    RELOCATION_REQUESTED: {
        label: 'Relocation Pending',
        color: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: <RefreshCw className="h-3 w-3" />,
    },
};

// ── Main Component ────────────────────────────────────────────────────────────

export function LocationApprovalClient() {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<'PENDING_APPROVAL' | 'RELOCATION_REQUESTED' | 'APPROVED' | 'REJECTED'>('PENDING_APPROVAL');
    const [clients, setClients] = useState<ClientLocationRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [pagination, setPagination] = useState({ currentPage: 1, totalItems: 0, totalPages: 0, pageSize: 20 });

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    useEffect(() => {
        if (!isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                let list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (storedUser?.role === 'AREA_MANAGER') {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdminOrAM]);

    // Detail panel
    const [selectedClient, setSelectedClient] = useState<DetailInfo | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);

    // BM GPS
    const [bmLat, setBmLat] = useState('');
    const [bmLng, setBmLng] = useState('');
    const [bmAccuracy, setBmAccuracy] = useState<number | null>(null);
    const { locate, isLocating: isCapturingGps, locatingLabel } = useAccurateLocation();
    const [gpsError, setGpsError] = useState('');

    // Road (driving) distance between the BM's captured GPS and the FDO-verified /
    // pending-relocation client location.
    const isRelocationReview = selectedClient?.locationApprovalStatus === 'RELOCATION_REQUESTED';
    const distanceTargetLat = isRelocationReview ? selectedClient?.pendingLatitude ?? null : selectedClient?.latitude ?? null;
    const distanceTargetLng = isRelocationReview ? selectedClient?.pendingLongitude ?? null : selectedClient?.longitude ?? null;
    const parsedGpsLat = bmLat.trim() === '' ? null : parseFloat(bmLat);
    const parsedGpsLng = bmLng.trim() === '' ? null : parseFloat(bmLng);
    const gpsDistance = useDrivingDistance(
        distanceTargetLat, distanceTargetLng,
        parsedGpsLat != null && Number.isFinite(parsedGpsLat) ? parsedGpsLat : null,
        parsedGpsLng != null && Number.isFinite(parsedGpsLng) ? parsedGpsLng : null,
    );

    // Action state
    const [remarks, setRemarks] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Photo viewer
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);

    // ── Data fetching ──────────────────────────────────────────────────────────

    const fetchClients = useCallback(async (tab: string, page = 1) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ status: tab, page: String(page), pageSize: '20' });
            if (isAdminOrAM && selectedBranchId !== 'all') params.set('branchId', selectedBranchId);
            const result = await apiClient.get<{ clients: ClientLocationRow[]; pagination: typeof pagination }>(
                `/clients/location-approval?${params.toString()}`,
            );
            if (result.success && result.data) {
                setClients(result.data.clients);
                setPagination(result.data.pagination);
            } else {
                setClients([]);
            }
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Failed to load clients.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast, isAdminOrAM, selectedBranchId]);

    useEffect(() => {
        void fetchClients(activeTab);
    }, [activeTab, fetchClients]);

    const openDetail = async (row: ClientLocationRow) => {
        setIsDetailOpen(true);
        setIsLoadingDetail(true);
        setBmLat(''); setBmLng(''); setRemarks(''); setGpsError('');
        try {
            const result = await apiClient.get<{ client: DetailInfo; lastVisitDistance: number | null; matchRadiusMeters: number }>(
                `/clients/${row.clientId}/location`,
            );
            if (result.success && result.data) {
                setSelectedClient({ ...result.data.client, lastVisitDistance: result.data.lastVisitDistance, matchRadiusMeters: result.data.matchRadiusMeters });
            }
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Failed to load client details.', variant: 'destructive' });
        } finally {
            setIsLoadingDetail(false);
        }
    };

    // ── GPS Capture ────────────────────────────────────────────────────────────

    const captureGps = () => {
        setGpsError('');
        locate({
            onPosition: (lat, lng) => {
                setBmLat(lat.toFixed(6));
                setBmLng(lng.toFixed(6));
            },
            onDone: (pos) => setBmAccuracy(pos.accuracy),
            onError: setGpsError,
            silent: true,
            // one final update; each change recalculates the road distance
            liveUpdates: false,
        });
    };

    // ── Distance display (road/driving distance, via gpsDistance hook above) ────

    const getDistanceInfo = () => {
        if (gpsDistance.distanceMeters == null) return null;
        const dist = gpsDistance.distanceMeters;
        const isMatch = isLocationMatch(dist, bmAccuracy);
        const label = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`;
        return { dist, isMatch, label };
    };

    // ── Submit actions ─────────────────────────────────────────────────────────

    const submitAction = async (action: string) => {
        if (!selectedClient) return;
        const lat = parseFloat(bmLat), lng = parseFloat(bmLng);

        if ((action === 'approve' || action === 'approve_relocation') && (isNaN(lat) || isNaN(lng))) {
            toast({ title: 'GPS required', description: 'Capture or enter your current GPS coordinates first.', variant: 'destructive' });
            return;
        }
        if (action === 'approve' || action === 'approve_relocation') {
            const dist = getDistanceInfo();
            if (dist && !dist.isMatch) {
                toast({
                    title: 'Location mismatch',
                    description: `Your GPS is ${dist.label} from the FDO-verified client location — exceeds the ${LOCATION_MATCH_RADIUS_METERS} m limit. Move closer or recapture.`,
                    variant: 'destructive',
                });
                return;
            }
        }
        if ((action === 'reject' || action === 'reject_relocation') && !remarks.trim()) {
            toast({ title: 'Remarks required', description: 'Please enter rejection remarks.', variant: 'destructive' });
            return;
        }

        setIsSubmitting(true);
        try {
            const body: Record<string, unknown> = { action, remarks: remarks.trim() || undefined };
            if (action === 'approve' || action === 'approve_relocation') {
                body.bmLatitude = lat;
                body.bmLongitude = lng;
                if (bmAccuracy != null) body.bmAccuracy = bmAccuracy;
            }

            const result = await apiClient.post(`/clients/${selectedClient.clientId}/location`, body);
            if (result.success) {
                toast({ title: 'Success', description: result.message || 'Action completed.' });
                setIsDetailOpen(false);
                void fetchClients(activeTab);
            } else {
                toast({ title: 'Error', description: result.error || 'Action failed.', variant: 'destructive' });
            }
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'An error occurred.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Render helpers ─────────────────────────────────────────────────────────

    const distInfo = getDistanceInfo();
    const houseImages = selectedClient?.kycDocuments?.filter(d => d.documentType.startsWith('house_image') && d.fileUrl) ?? [];
    const qrDoc = selectedClient?.kycDocuments?.find(d => d.documentType === 'location_qr' && d.fileUrl);
    const isRelocation = selectedClient?.locationApprovalStatus === 'RELOCATION_REQUESTED';
    const mapLat = isRelocation ? (selectedClient?.pendingLatitude ?? selectedClient?.latitude) : selectedClient?.latitude;
    const mapLng = isRelocation ? (selectedClient?.pendingLongitude ?? selectedClient?.longitude) : selectedClient?.longitude;

    const TAB_COUNTS_KEY = activeTab;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                        Location Approval
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Verify client house locations by comparing enrolled GPS with your field visit GPS.
                    </p>
                </div>
                {isAdminOrAM && (
                    <div className="w-full max-w-xs space-y-1.5">
                        <Label className="text-sm font-medium">Branch</Label>
                        <Select
                            value={selectedBranchId}
                            onValueChange={setSelectedBranchId}
                            disabled={isLoadingBranches}
                        >
                            <SelectTrigger className="h-10 w-full">
                                <SelectValue placeholder="All Branches" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">
                                    {storedUser?.role === 'AREA_MANAGER' ? 'All Assigned Branches' : 'All Branches'}
                                </SelectItem>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.code} - {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                <TabsList className="grid grid-cols-4 w-full max-w-2xl">
                    <TabsTrigger value="PENDING_APPROVAL" className="gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> Pending
                    </TabsTrigger>
                    <TabsTrigger value="RELOCATION_REQUESTED" className="gap-1.5">
                        <RefreshCw className="h-3.5 w-3.5" /> Relocation
                    </TabsTrigger>
                    <TabsTrigger value="APPROVED" className="gap-1.5">
                        <CheckCheck className="h-3.5 w-3.5" /> Approved
                    </TabsTrigger>
                    <TabsTrigger value="REJECTED" className="gap-1.5">
                        <XCircle className="h-3.5 w-3.5" /> Rejected
                    </TabsTrigger>
                </TabsList>

                {(['PENDING_APPROVAL', 'RELOCATION_REQUESTED', 'APPROVED', 'REJECTED'] as const).map((tab) => (
                    <TabsContent key={tab} value={tab} className="mt-4">
                        {isLoading ? (
                            <PageLoader fullScreen={false} />
                        ) : clients.length === 0 ? (
                            <Card>
                                <CardContent className="flex flex-col items-center justify-center py-16">
                                    <MapPin className="h-10 w-10 text-muted-foreground mb-3" />
                                    <p className="text-lg font-semibold">No clients in this category</p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {tab === 'PENDING_APPROVAL' ? 'All enrolled clients have been verified.' :
                                            tab === 'RELOCATION_REQUESTED' ? 'No relocation requests pending.' :
                                                tab === 'APPROVED' ? 'No approved locations yet.' : 'No rejected locations.'}
                                    </p>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {clients.map((client) => {
                                    const cfg = STATUS_CONFIG[client.locationApprovalStatus];
                                    return (
                                        <Card
                                            key={client.id}
                                            className="border hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
                                            onClick={() => openDetail(client)}
                                        >
                                            <div className="h-1 bg-gradient-to-r from-primary to-primary" />
                                            <CardContent className="pt-4 pb-4 space-y-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div>
                                                        <p className="font-semibold text-sm">{client.firstName} {client.lastName}</p>
                                                        <p className="text-xs text-muted-foreground">{client.clientId}</p>
                                                    </div>
                                                    <Badge variant="outline" className={cn('text-xs flex items-center gap-1', cfg.color)}>
                                                        {cfg.icon} {cfg.label}
                                                    </Badge>
                                                </div>

                                                <div className="space-y-1 text-xs text-muted-foreground">
                                                    {client.center && (
                                                        <div className="flex items-center gap-1">
                                                            <Home className="h-3 w-3" />
                                                            {client.center.code} – {client.center.name}
                                                        </div>
                                                    )}
                                                    {client.latitude != null && (
                                                        <div className="flex items-center gap-1">
                                                            <MapPin className="h-3 w-3" />
                                                            {client.latitude.toFixed(5)}, {client.longitude?.toFixed(5)}
                                                        </div>
                                                    )}
                                                    {client.locationApprovalStatus === 'RELOCATION_REQUESTED' && client.relocationRemarks && (
                                                        <p className="text-blue-600 italic">"{client.relocationRemarks}"</p>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-1.5 pt-1">
                                                    {client.kycDocuments.some(d => d.documentType.startsWith('house_image') && d.fileUrl) && (
                                                        <Badge variant="outline" className="text-xs gap-1">
                                                            <ImageIcon className="h-3 w-3" /> House Photo
                                                        </Badge>
                                                    )}
                                                    {client.kycDocuments.some(d => d.documentType === 'location_qr' && d.fileUrl) && (
                                                        <Badge variant="outline" className="text-xs gap-1">
                                                            <QrCode className="h-3 w-3" /> QR
                                                        </Badge>
                                                    )}
                                                </div>

                                                <Button
                                                    size="sm"
                                                    className="w-full bg-primary hover:bg-sidebar-accent text-white"
                                                    onClick={(e) => { e.stopPropagation(); void openDetail(client); }}
                                                >
                                                    <Eye className="h-3.5 w-3.5 mr-1.5" />
                                                    {tab === 'PENDING_APPROVAL' || tab === 'RELOCATION_REQUESTED' ? 'Review & Approve' : 'View Details'}
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}

                        {/* Pagination */}
                        {pagination.totalPages > 1 && (
                            <div className="flex justify-center gap-2 mt-6">
                                <Button
                                    variant="outline" size="sm"
                                    disabled={pagination.currentPage === 1}
                                    onClick={() => fetchClients(tab, pagination.currentPage - 1)}
                                >Previous</Button>
                                <span className="text-sm self-center">
                                    Page {pagination.currentPage} of {pagination.totalPages}
                                </span>
                                <Button
                                    variant="outline" size="sm"
                                    disabled={pagination.currentPage >= pagination.totalPages}
                                    onClick={() => fetchClients(tab, pagination.currentPage + 1)}
                                >Next</Button>
                            </div>
                        )}
                    </TabsContent>
                ))}
            </Tabs>

            {/* ── Detail Dialog ──────────────────────────────────────────────────── */}
            <Dialog open={isDetailOpen} onOpenChange={(o) => { setIsDetailOpen(o); if (!o) setSelectedClient(null); }}>
                <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
                    {/* DialogTitle must always be present for accessibility */}
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MapPin className="h-5 w-5 text-primary" />
                            {selectedClient
                                ? `Location Review — ${selectedClient.firstName} ${selectedClient.lastName}`
                                : 'Location Review'}
                        </DialogTitle>
                        {selectedClient && (
                            <DialogDescription>
                                {selectedClient.clientId} · {selectedClient.center?.name ?? 'No center'}
                            </DialogDescription>
                        )}
                    </DialogHeader>
                    {isLoadingDetail || !selectedClient ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <>
                            <div className="space-y-5 mt-2">
                                {/* Status badge */}
                                {(() => {
                                    const cfg = STATUS_CONFIG[selectedClient.locationApprovalStatus];
                                    return (
                                        <Badge variant="outline" className={cn('text-sm flex items-center gap-1.5 w-fit', cfg.color)}>
                                            {cfg.icon} {cfg.label}
                                        </Badge>
                                    );
                                })()}

                                {/* Relocation notice */}
                                {isRelocation && (
                                    <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                                        <RefreshCw className="h-4 w-4 text-blue-600" />
                                        <AlertTitle>Relocation Request</AlertTitle>
                                        <AlertDescription>
                                            FDO {selectedClient.relocationRequestedBy
                                                ? `${selectedClient.relocationRequestedBy.firstName} ${selectedClient.relocationRequestedBy.lastName}`
                                                : ''} submitted new coordinates.
                                            {selectedClient.relocationRemarks && <> Reason: <em>"{selectedClient.relocationRemarks}"</em></>}
                                        </AlertDescription>
                                    </Alert>
                                )}

                                {/* Coordinates info */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                    <div className="space-y-1 p-3 rounded-lg bg-muted/50">
                                        <p className="font-semibold text-xs text-muted-foreground uppercase">
                                            {isRelocation ? 'Current (Enrolled) Location' : 'Enrolled Location'}
                                        </p>
                                        {selectedClient.latitude != null ? (
                                            <>
                                                <p className="font-mono text-xs">Lat: {selectedClient.latitude?.toFixed(6)}</p>
                                                <p className="font-mono text-xs">Lng: {selectedClient.longitude?.toFixed(6)}</p>
                                            </>
                                        ) : (
                                            <p className="text-amber-600 text-xs">No coordinates recorded</p>
                                        )}
                                    </div>
                                    {isRelocation && selectedClient.pendingLatitude != null && (
                                        <div className="space-y-1 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                                            <p className="font-semibold text-xs text-blue-700 uppercase">New Requested Location</p>
                                            <p className="font-mono text-xs">Lat: {selectedClient.pendingLatitude?.toFixed(6)}</p>
                                            <p className="font-mono text-xs">Lng: {selectedClient.pendingLongitude?.toFixed(6)}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Map */}
                                {mapLat != null && mapLng != null && (
                                    <div>
                                        <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                                            {isRelocation ? 'Proposed New Location on Map' : 'Enrolled Location on Map'}
                                        </p>
                                        <MapComponent
                                            latitude={mapLat}
                                            longitude={mapLng}
                                            centerName={`${selectedClient.firstName} ${selectedClient.lastName}`}
                                            centerCode={selectedClient.clientId}
                                            address={selectedClient.permanentAddress ?? undefined}
                                        />
                                    </div>
                                )}

                                {/* House images */}
                                {houseImages.length > 0 && (
                                    <div>
                                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                                            <Home className="h-3.5 w-3.5" /> House Images
                                        </p>
                                        <div className="flex gap-2 flex-wrap">
                                            {houseImages.map((doc) => (
                                                <StorageImage
                                                    key={doc.id}
                                                    src={doc.fileUrl}
                                                    alt={doc.documentType}
                                                    className="h-24 w-24 object-cover rounded-lg border cursor-pointer hover:opacity-80 transition"
                                                    onClick={() => setPhotoUrl(doc.fileUrl!)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* QR code */}
                                {qrDoc && (
                                    <div>
                                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                                            <QrCode className="h-3.5 w-3.5" /> Location QR Code
                                        </p>
                                        <StorageImage
                                            src={qrDoc.fileUrl}
                                            alt="Location QR"
                                            className="h-32 w-32 object-contain rounded-lg border cursor-pointer hover:opacity-80 transition"
                                            onClick={() => setPhotoUrl(qrDoc.fileUrl!)}
                                        />
                                    </div>
                                )}

                                {/* Only show BM GPS + action buttons for pending states */}
                                {(selectedClient.locationApprovalStatus === 'PENDING_APPROVAL' ||
                                    selectedClient.locationApprovalStatus === 'RELOCATION_REQUESTED') && (
                                    <>
                                        {/* BM GPS capture */}
                                        <div className="space-y-3 border rounded-lg p-4 bg-green-50/60 dark:bg-brand-green-darker/30">
                                            <p className="font-semibold text-sm flex items-center gap-1.5">
                                                <Navigation className="h-4 w-4 text-primary" />
                                                Your Current GPS (BM Visit Location)
                                            </p>

                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={captureGps}
                                                disabled={isCapturingGps}
                                                className="border-primary/40 text-sidebar-accent"
                                            >
                                                {isCapturingGps ? (
                                                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> {locatingLabel}</>
                                                ) : (
                                                    <><Navigation className="h-3.5 w-3.5 mr-1.5" /> Capture My Location</>
                                                )}
                                            </Button>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <Label className="text-xs">My Latitude</Label>
                                                    <Input
                                                        value={bmLat}
                                                        onChange={(e) => setBmLat(e.target.value)}
                                                        placeholder="e.g. 11.016844"
                                                        className="h-9 text-sm font-mono"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-xs">My Longitude</Label>
                                                    <Input
                                                        value={bmLng}
                                                        onChange={(e) => setBmLng(e.target.value)}
                                                        placeholder="e.g. 76.955833"
                                                        className="h-9 text-sm font-mono"
                                                    />
                                                </div>
                                            </div>

                                            {gpsError && (
                                                <p className="text-xs text-red-600">{gpsError}</p>
                                            )}
                                            {bmAccuracy != null && (
                                                <p className="text-xs text-muted-foreground">
                                                    GPS accuracy: ±{Math.round(bmAccuracy)} m
                                                </p>
                                            )}

                                            {/* Distance match indicator (road/driving distance) */}
                                            {gpsDistance.isLoading && (
                                                <div className="flex items-center gap-2 rounded-lg p-3 text-sm font-medium bg-muted text-muted-foreground">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Calculating road distance…
                                                </div>
                                            )}
                                            {!gpsDistance.isLoading && distInfo && (
                                                <div className={cn(
                                                    'flex items-center gap-2 rounded-lg p-3 text-sm font-medium',
                                                    distInfo.isMatch
                                                        ? 'bg-green-50 text-green-700 border border-green-200'
                                                        : 'bg-amber-50 text-amber-700 border border-amber-200',
                                                )}>
                                                    {distInfo.isMatch
                                                        ? <CheckCircle2 className="h-4 w-4" />
                                                        : <AlertCircle className="h-4 w-4" />}
                                                    Distance: {distInfo.label} (threshold: {LOCATION_MATCH_RADIUS_METERS} m)
                                                </div>
                                            )}
                                        </div>

                                        {/* Remarks */}
                                        <div>
                                            <Label className="text-sm">Remarks {(selectedClient.locationApprovalStatus === 'PENDING_APPROVAL') ? '(optional)' : ''}</Label>
                                            <Textarea
                                                value={remarks}
                                                onChange={(e) => setRemarks(e.target.value)}
                                                placeholder="Enter any remarks..."
                                                className="mt-1.5 h-20 resize-none"
                                            />
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex gap-3 pt-1">
                                            <Button
                                                className="flex-1 bg-primary hover:bg-sidebar-accent text-white"
                                                disabled={isSubmitting || gpsDistance.isLoading || (distInfo != null && !distInfo.isMatch)}
                                                title={distInfo != null && !distInfo.isMatch ? `GPS is ${distInfo.label} — must be within ${LOCATION_MATCH_RADIUS_METERS} m of the FDO-verified location` : undefined}
                                                onClick={() => submitAction(isRelocation ? 'approve_relocation' : 'approve')}
                                            >
                                                {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                                                {isRelocation ? 'Approve Relocation' : 'Approve Location'}
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                className="flex-1"
                                                disabled={isSubmitting}
                                                onClick={() => submitAction(isRelocation ? 'reject_relocation' : 'reject')}
                                            >
                                                {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <XCircle className="h-4 w-4 mr-1.5" />}
                                                {isRelocation ? 'Reject Relocation' : 'Reject Location'}
                                            </Button>
                                        </div>
                                    </>
                                )}

                                {/* Approved / Rejected history */}
                                {(selectedClient.locationApprovalStatus === 'APPROVED' || selectedClient.locationApprovalStatus === 'REJECTED') && (
                                    <div className="border rounded-lg p-4 space-y-2 text-sm">
                                        <p className="font-semibold">
                                            {selectedClient.locationApprovalStatus === 'APPROVED' ? '✅ Approved' : '❌ Rejected'} by{' '}
                                            {selectedClient.locationApprovedBy
                                                ? `${selectedClient.locationApprovedBy.firstName} ${selectedClient.locationApprovedBy.lastName}`
                                                : 'Unknown'}
                                        </p>
                                        {selectedClient.locationApprovedAt && (
                                            <p className="text-muted-foreground text-xs">
                                                {toDisplayDateTime(new Date(selectedClient.locationApprovedAt))}
                                            </p>
                                        )}
                                        {selectedClient.locationApprovalRemarks && (
                                            <p className="italic text-muted-foreground">"{selectedClient.locationApprovalRemarks}"</p>
                                        )}
                                        {selectedClient.bmVisitLatitude != null && (
                                            <p className="font-mono text-xs text-muted-foreground">
                                                BM visit GPS: {selectedClient.bmVisitLatitude?.toFixed(5)}, {selectedClient.bmVisitLongitude?.toFixed(5)}
                                            </p>
                                        )}
                                        {selectedClient.lastVisitDistance != null && (
                                            <p className={cn('text-xs font-medium', selectedClient.lastVisitDistance <= LOCATION_MATCH_RADIUS_METERS ? 'text-green-700' : 'text-amber-700')}>
                                                Distance at approval: {selectedClient.lastVisitDistance < 1000
                                                    ? `${Math.round(selectedClient.lastVisitDistance)} m`
                                                    : `${(selectedClient.lastVisitDistance / 1000).toFixed(2)} km`}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Photo lightbox */}
            {photoUrl && (
                <Dialog open={!!photoUrl} onOpenChange={() => setPhotoUrl(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogTitle className="sr-only">Document Photo</DialogTitle>
                        <StorageImage src={photoUrl} alt="Document" className="w-full rounded-lg object-contain max-h-[80vh]" />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
