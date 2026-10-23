'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { StorageImage } from '@/components/storage/StorageMedia';
import { ImageViewerDialog, type ImageViewerTarget } from '@/components/ui/ImageViewerDialog';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { useToast } from '@/hooks/use-toast';
import { useLocalDraft } from '@/hooks/useLocalDraft';
import { apiClient } from '@/app/lib/api-client';
import { LoanProductEditModal } from '@/components/loan-module/LoanProductEditModal';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';
import { HOUSEHOLD_VISIT_CENTER_RADIUS_METERS, LOCATION_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import { useAccurateLocation, LOW_ACCURACY_WARN_METERS } from '@/hooks/useAccurateLocation';
import LocationPreview from '@/components/centers/LocationPreview';
import LocationSearchBox from '@/components/centers/LocationSearchBox';
import { PageLoader } from '@/components/ui/page-loader';
import { useDrivingDistance } from '@/hooks/useDrivingDistance';
import {
    ArrowLeft, CheckCircle2, Circle, Loader2, Wallet, ClipboardCheck, Home, MessageSquareText,
    MapPin, Camera, X, AlertTriangle, Pencil, Utensils, HeartPulse, Flame, Zap, Bus, Droplet,
    GraduationCap, Receipt, Percent, CalendarClock, Repeat, Map, LocateFixed,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Dynamically import the Leaflet map (avoids SSR issues) — reuses the same picker as Create Center.
const LocationMapPicker = dynamic(() => import('@/components/centers/CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[40vh] items-center justify-center rounded-lg border bg-muted">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
    ),
});

// Fallback map center (Dindigul, Tamil Nadu) used when no coordinates are available yet.
const DEFAULT_MAP_LAT = 10.3624;
const DEFAULT_MAP_LNG = 77.9695;

interface MemberIndividualDetailPageProps {
    loanId: string;
    onClose: () => void;
}

type LoanInfo = {
    id: string; loanNumber: string; amount: number; maxAllowedAmount: number; interestRate: number; tenureMonths: number;
    frequency: string; loanProductId: string | null; productName: string | null;
    disbursementStatus: string; clientName: string; clientDisplayId: string;
};
type CenterInfo = { name: string | null; code: string | null; latitude: number | null; longitude: number | null };
type BranchInfo = { name: string | null; latitude: number | null; longitude: number | null };
type ClientInfo = { latitude: number | null; longitude: number | null };

type CashFlowValues = {
    foodExpense: number | null; medicalExpense: number | null; cookingFuelExpense: number | null;
    electricityExpense: number | null; transportExpense: number | null; waterExpense: number | null;
    educationalExpense: number | null; monthlyExpense: number | null; completedAt: string | null;
};

type HouseholdPhoto = {
    id: string; photoUrl: string; isMandatory: boolean; latitude: number | null; longitude: number | null;
    distanceMeters: number | null; distanceFromClientMeters: number | null; distanceFromBranchMeters: number | null;
    notes: string | null; createdAt: string;
    uploadedByName: string;
};

type MemberIndividualData = {
    id: string;
    loan: LoanInfo;
    center: CenterInfo;
    branch: BranchInfo;
    client: ClientInfo;
    cashFlow: CashFlowValues;
    loanAppraisal: { reviewedAt: string | null };
    houseHoldVisit: {
        latitude: number | null; longitude: number | null;
        distanceMeters: number | null; distanceFromClientMeters: number | null; distanceFromBranchMeters: number | null;
        completedAt: string | null;
        fdoHouseImage: { photoUrl: string | null; uploadedByName: string; createdAt: string } | null;
        photos: HouseholdPhoto[];
    };
    grt: { completedSessionId: string | null; completedAt: string | null };
    isComplete: boolean;
};

const EXPENSE_FIELDS: { key: keyof CashFlowValues; label: string; icon: typeof Utensils }[] = [
    { key: 'foodExpense', label: 'Food Expense', icon: Utensils },
    { key: 'medicalExpense', label: 'Medical Expense', icon: HeartPulse },
    { key: 'cookingFuelExpense', label: 'Cooking Fuel Expense', icon: Flame },
    { key: 'electricityExpense', label: 'Electricity Expense', icon: Zap },
    { key: 'transportExpense', label: 'Transport Expense', icon: Bus },
    { key: 'waterExpense', label: 'Water Expense', icon: Droplet },
    { key: 'educationalExpense', label: 'Educational Expense', icon: GraduationCap },
    { key: 'monthlyExpense', label: 'Monthly Expense', icon: Receipt },
];

function initials(name: string) {
    return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

function TabStatusIcon({ done }: { done: boolean }) {
    return done
        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-1.5" />
        : <Circle className="h-3.5 w-3.5 text-slate-300 ml-1.5" />;
}

function formatDistanceKm(distance: number): string {
    return distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(2)}km`;
}

/** `radius` is omitted for informational-only distances (e.g. Branch) that don't gate approval. */
function DistanceChip({ label, distance, radius }: { label: string; distance: number | null; radius?: number }) {
    if (distance == null) {
        return (
            <div className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-[11px] text-slate-500">
                <MapPin className="h-3 w-3" /> {label}: not available
            </div>
        );
    }
    if (radius == null) {
        return (
            <div className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                <MapPin className="h-3 w-3" /> {label}: {formatDistanceKm(distance)}
            </div>
        );
    }
    const ok = distance <= radius;
    return (
        <div className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium',
            ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        )}>
            <MapPin className="h-3 w-3" /> {label}: {formatDistanceKm(distance)} {ok ? '✓ within' : `✗ outside`} {radius}m
        </div>
    );
}

export function MemberIndividualDetailPage({ loanId, onClose }: MemberIndividualDetailPageProps) {
    const { toast } = useToast();
    const [data, setData] = useState<MemberIndividualData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('cash-flow');

    // Cash Flow
    const [expenses, setExpenses] = useState<Record<string, string>>({});
    const [isSavingCashFlow, setIsSavingCashFlow] = useState(false);
    // Offline autosave — mirrors the (still-typing, not-yet-saved) expense fields to
    // localStorage so poor/no connectivity during a field visit never loses them.
    // Keyed per loan; cleared once saveCashFlow succeeds.
    const cashFlowDraft = useLocalDraft<Record<string, string>>(`member-individual-cashflow-${loanId}`);
    const isApplyingCashFlowDraftRef = useRef(false);
    const [restoredCashFlowDraft, setRestoredCashFlowDraft] = useState(false);

    // Loan Appraisal
    const [productModalOpen, setProductModalOpen] = useState(false);
    const [isMarkingReviewed, setIsMarkingReviewed] = useState(false);

    // House Hold Visit
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraForMandatory, setCameraForMandatory] = useState(true);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [gpsError, setGpsError] = useState('');
    const [isCompletingVisit, setIsCompletingVisit] = useState(false);
    const [viewerTarget, setViewerTarget] = useState<ImageViewerTarget | null>(null);
    // Location the mandatory photo will actually be uploaded with — set via GPS
    // ("Use My Location"), the map picker, or typed in manually. The device is
    // never re-queried for GPS at the moment of capture; whatever is set here
    // (and shown in the Branch/Center/FDO preview chips) is what gets sent.
    const [liveCoords, setLiveCoords] = useState<{ lat: number; lng: number } | null>(null);
    const { locate, isLocating: isFetchingLiveLocation, locatingLabel } = useAccurateLocation();
    // Accuracy (meters) of the last GPS fix — cleared when the location is set by map/search/typing
    const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
    const [liveLocationError, setLiveLocationError] = useState('');
    const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);
    const [manualLat, setManualLat] = useState('');
    const [manualLng, setManualLng] = useState('');

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<MemberIndividualData>(`/member-individual/${loanId}`);
            if (result.success && result.data) {
                setData(result.data);
                const cf: Record<string, string> = {};
                EXPENSE_FIELDS.forEach(({ key }) => {
                    const v = result.data!.cashFlow[key];
                    cf[key as string] = v != null ? String(v) : '';
                });

                // A not-yet-saved local draft beats the server snapshot (it's newer,
                // possibly typed while offline) — but never override an already
                // completed/submitted cash flow with stale local data.
                const stored = !result.data.cashFlow.completedAt ? cashFlowDraft.load() : null;
                if (stored?.data) {
                    isApplyingCashFlowDraftRef.current = true;
                    setExpenses({ ...cf, ...stored.data });
                    setRestoredCashFlowDraft(true);
                    toast({
                        title: 'Unsaved Data Restored',
                        description: `Recovered Cash Flow entries autosaved locally at ${new Date(stored.savedAt).toLocaleTimeString()}.`,
                    });
                    setTimeout(() => { isApplyingCashFlowDraftRef.current = false; }, 0);
                } else {
                    setExpenses(cf);
                }
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to load record.', variant: 'destructive' });
            }
        } finally {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loanId, toast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Debounced offline autosave for the expense fields — fires on every edit.
    useEffect(() => {
        if (isLoading || isApplyingCashFlowDraftRef.current || Object.keys(expenses).length === 0) return;
        cashFlowDraft.save(expenses);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expenses, isLoading]);

    const hasMandatoryPhoto = !!data?.houseHoldVisit.photos.some((p) => p.isMandatory);

    // ── Cash Flow ────────────────────────────────────────────────────────────
    const totalExpense = EXPENSE_FIELDS.reduce((sum, { key }) => sum + (parseFloat(expenses[key as string]) || 0), 0);

    const saveCashFlow = async () => {
        setIsSavingCashFlow(true);
        try {
            const payload: Record<string, number> = {};
            for (const { key } of EXPENSE_FIELDS) {
                payload[key as string] = parseFloat(expenses[key as string] || '0') || 0;
            }
            const result = await apiClient.patch(`/member-individual/${loanId}/cash-flow`, payload);
            if (result.success) {
                cashFlowDraft.clear();
                setRestoredCashFlowDraft(false);
                toast({ title: 'Saved', description: 'Cash Flow details saved.' });
                fetchData();
                setActiveTab('loan-appraisal');
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to save.', variant: 'destructive' });
            }
        } finally {
            setIsSavingCashFlow(false);
        }
    };

    // ── Loan Appraisal ──────────────────────────────────────────────────────
    const handleProductSaved = () => {
        fetchData();
    };

    const markLoanAppraisalReviewed = async () => {
        setIsMarkingReviewed(true);
        try {
            const result = await apiClient.patch(`/member-individual/${loanId}/loan-appraisal/complete`, {});
            if (result.success) {
                toast({ title: 'Reviewed', description: 'Loan Appraisal marked reviewed.' });
                fetchData();
                setActiveTab('household-visit');
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to mark reviewed.', variant: 'destructive' });
            }
        } finally {
            setIsMarkingReviewed(false);
        }
    };

    // ── House Hold Visit ─────────────────────────────────────────────────────
    // Samples high-accuracy GPS and keeps the best fix (the browser's first reading is
    // often a coarse Wi-Fi/IP guess). One final update only — every liveCoords change
    // recalculates three driving distances.
    const fetchLiveLocation = useCallback(() => {
        setLiveLocationError('');
        setLiveAccuracy(null);
        locate({
            onPosition: (lat, lng) => setLiveCoords({ lat, lng }),
            onDone: (pos) => setLiveAccuracy(pos.accuracy),
            onError: setLiveLocationError,
            silent: true,
            liveUpdates: false,
        });
    }, [locate]);

    const handleMapLocationChange = (lat: number, lng: number) => {
        setLiveLocationError('');
        setLiveAccuracy(null);
        setLiveCoords({ lat, lng });
    };

    // Keep the manual lat/long fields showing whatever GPS/map last set, without
    // fighting the user's own typing (only overwritten when liveCoords changes
    // from those two sources, not on every keystroke here).
    useEffect(() => {
        if (liveCoords) {
            setManualLat(liveCoords.lat.toFixed(6));
            setManualLng(liveCoords.lng.toFixed(6));
        }
    }, [liveCoords]);

    const applyManualCoords = (latStr: string, lngStr: string) => {
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            setLiveLocationError('');
            if (liveCoords?.lat !== lat || liveCoords?.lng !== lng) setLiveAccuracy(null);
            setLiveCoords((prev) => (prev?.lat === lat && prev?.lng === lng ? prev : { lat, lng }));
        }
    };

    const handleManualLatChange = (value: string) => {
        setManualLat(value);
        applyManualCoords(value, manualLng);
    };

    const handleManualLngChange = (value: string) => {
        setManualLng(value);
        applyManualCoords(manualLat, value);
    };

    // Auto-check the BM's current GPS against Branch/Center/FDO as soon as the
    // House Hold Assessment tab is opened and no mandatory photo exists yet —
    // lets the BM see they're in range before spending a capture attempt.
    useEffect(() => {
        if (activeTab === 'household-visit' && !hasMandatoryPhoto && !liveCoords && !isFetchingLiveLocation) {
            fetchLiveLocation();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, hasMandatoryPhoto]);

    const openCamera = (mandatory: boolean) => {
        setGpsError('');
        setCameraForMandatory(mandatory);
        setCameraOpen(true);
    };

    const handlePhotoCaptured = async (file: File) => {
        // The mandatory photo must carry a location — one already set above via
        // "Use My Location", "Select on Map", or typed in manually. We don't
        // re-query the device GPS here; whatever was previewed in the distance
        // chips is exactly what gets uploaded.
        if (cameraForMandatory && !liveCoords) {
            setGpsError('Set your location first — use "Use My Location", "Select on Map", or enter latitude/longitude manually.');
            return;
        }
        setIsUploadingPhoto(true);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            if (liveCoords) {
                formData.append('latitude', String(liveCoords.lat));
                formData.append('longitude', String(liveCoords.lng));
            }
            formData.append('isMandatory', cameraForMandatory ? 'true' : 'false');
            const result = await apiClient.post(`/member-individual/${loanId}/household-visit/photos`, formData);
            if (result.success) {
                toast({ title: 'Photo Uploaded', description: 'House photo captured.' });
                fetchData();
            } else {
                toast({ title: 'Error', description: result.error || 'Upload failed.', variant: 'destructive' });
            }
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const removePhoto = async (photoId: string) => {
        const result = await apiClient.delete(`/member-individual/${loanId}/household-visit/photos/${photoId}`);
        if (result.success) fetchData();
    };

    const completeHouseholdVisit = async () => {
        setIsCompletingVisit(true);
        try {
            const result = await apiClient.patch(`/member-individual/${loanId}/household-visit/complete`, {});
            if (result.success) {
                toast({ title: 'Complete', description: 'House Hold Assessment marked complete.' });
                onClose();
            } else {
                toast({ title: 'Cannot Approve', description: result.error || 'Failed to complete.', variant: 'destructive' });
            }
        } finally {
            setIsCompletingVisit(false);
        }
    };

    // Live driving-distance checks from the BM's current GPS to Branch/Center/FDO —
    // shown before the mandatory photo is captured. Hooks must run unconditionally,
    // so these stay above the loading guard below.
    const liveBranchDistance = useDrivingDistance(liveCoords?.lat, liveCoords?.lng, data?.branch.latitude, data?.branch.longitude);
    const liveCenterDistance = useDrivingDistance(liveCoords?.lat, liveCoords?.lng, data?.center.latitude, data?.center.longitude);
    const liveFdoDistance = useDrivingDistance(liveCoords?.lat, liveCoords?.lng, data?.client.latitude, data?.client.longitude);

    if (isLoading || !data) {
        return <PageLoader label="Loading Member Individual..." fullScreen={false} />;
    }

    const mandatoryPhoto = data.houseHoldVisit.photos.find((p) => p.isMandatory);
    const optionalPhotos = data.houseHoldVisit.photos.filter((p) => !p.isMandatory);
    const centerOutOfRange = mandatoryPhoto != null && (mandatoryPhoto.distanceMeters == null || mandatoryPhoto.distanceMeters > HOUSEHOLD_VISIT_CENTER_RADIUS_METERS);
    const clientOutOfRange = mandatoryPhoto != null && mandatoryPhoto.distanceFromClientMeters != null && mandatoryPhoto.distanceFromClientMeters > LOCATION_MATCH_RADIUS_METERS;
    const isOutOfRange = centerOutOfRange || clientOutOfRange;

    const completedCount = [!!data.cashFlow.completedAt, !!data.loanAppraisal.reviewedAt, !!data.houseHoldVisit.completedAt].filter(Boolean).length;

    return (
        <div className="space-y-6">
            {/* Hero header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-green-darker via-sidebar-accent to-primary px-6 py-5 shadow-xl">
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
                <div className="relative flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white" onClick={onClose}>
                            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
                        </Button>
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white ring-1 ring-white/20">
                            {initials(data.loan.clientName)}
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-white">
                                {data.loan.clientDisplayId} — {data.loan.clientName}
                            </h1>
                            <p className="text-xs text-green-200">{data.loan.loanNumber} · {data.center.name ?? '—'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className="bg-white/15 text-white hover:bg-white/15 border-white/20">
                            {completedCount}/3 tabs complete
                        </Badge>
                        {data.isComplete
                            ? <Badge className="bg-emerald-400 text-emerald-950 hover:bg-emerald-400">All Complete</Badge>
                            : <Badge className="bg-amber-300 text-amber-950 hover:bg-amber-300">Pending</Badge>}
                    </div>
                </div>
            </div>

            {/* GRT is filled center-wide (group) on the GRT Sessions tab, not per member here */}
            <div className={cn(
                'flex items-center gap-2 rounded-lg border px-4 py-3 text-xs',
                data.grt.completedAt
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20'
            )}>
                <MessageSquareText className="h-4 w-4 shrink-0" />
                {data.grt.completedAt
                    ? <span>GRT complete — covered by session <strong>{data.grt.completedSessionId}</strong>.</span>
                    : <span>GRT not yet complete for this member — fill it on the <strong>GRT Sessions</strong> tab (center-wise, covers multiple members at once).</span>}
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid grid-cols-3 w-full h-auto p-1">
                    <TabsTrigger value="cash-flow" className="flex items-center py-2.5 data-[state=active]:bg-brand-green-tint data-[state=active]:text-sidebar-accent dark:data-[state=active]:bg-brand-green-darker">
                        <Wallet className="h-4 w-4 mr-1.5" />Cash Flow<TabStatusIcon done={!!data.cashFlow.completedAt} />
                    </TabsTrigger>
                    <TabsTrigger value="loan-appraisal" className="flex items-center py-2.5 data-[state=active]:bg-brand-green-tint data-[state=active]:text-sidebar-accent dark:data-[state=active]:bg-brand-green-darker">
                        <ClipboardCheck className="h-4 w-4 mr-1.5" />Loan Appraisal<TabStatusIcon done={!!data.loanAppraisal.reviewedAt} />
                    </TabsTrigger>
                    <TabsTrigger value="household-visit" className="flex items-center py-2.5 data-[state=active]:bg-brand-green-tint data-[state=active]:text-sidebar-accent dark:data-[state=active]:bg-brand-green-darker">
                        <Home className="h-4 w-4 mr-1.5" />House Hold Assessment<TabStatusIcon done={!!data.houseHoldVisit.completedAt} />
                    </TabsTrigger>
                </TabsList>

                {/* Cash Flow */}
                <TabsContent value="cash-flow" className="pt-4">
                    <Card className="border-primary/20 dark:border-sidebar-accent/60">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <CardTitle className="text-base">Household Income & Expense Details</CardTitle>
                                <Badge variant="outline" className="text-sidebar-accent border-primary/30 font-mono">
                                    Total: ₹{new Intl.NumberFormat('en-IN').format(totalExpense)}
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                {EXPENSE_FIELDS.map(({ key, label, icon: Icon }) => (
                                    <div key={key as string} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-green-50/40 dark:bg-brand-green-darker/20">
                                        <Label className="text-xs font-semibold flex items-center gap-1.5 text-sidebar-accent dark:text-slate-300">
                                            <Icon className="h-3.5 w-3.5" /> {label}
                                        </Label>
                                        <div className="relative">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                                            <Input
                                                type="number" min={0} step="0.01"
                                                className="pl-6 bg-white dark:bg-green-950"
                                                value={expenses[key as string] ?? ''}
                                                onChange={(e) => setExpenses((prev) => ({ ...prev, [key as string]: e.target.value }))}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
                                <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                    {cashFlowDraft.isOnline ? (
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    ) : (
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    )}
                                    {cashFlowDraft.isOnline ? 'Online' : 'Offline — saving on this device'}
                                    {cashFlowDraft.lastSavedAt && (
                                        <span className="text-slate-400 dark:text-slate-500">
                                            · autosaved {new Date(cashFlowDraft.lastSavedAt).toLocaleTimeString()}
                                        </span>
                                    )}
                                    {restoredCashFlowDraft && (
                                        <span className="text-amber-600 dark:text-amber-400">· restored unsaved entries</span>
                                    )}
                                </span>
                                <Button onClick={saveCashFlow} disabled={isSavingCashFlow} className="bg-primary hover:bg-primary text-white">
                                    {isSavingCashFlow ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                                    Save & Continue
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Loan Appraisal */}
                <TabsContent value="loan-appraisal" className="pt-4">
                    <Card className="border-primary/20 dark:border-sidebar-accent/60">
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <CardTitle className="text-base">Loan Details</CardTitle>
                                <HighmarkHistoryButton
                                    clientId={data.loan.clientDisplayId}
                                    clientName={data.loan.clientName}
                                    centerName={data.center.name}
                                    variant="outline"
                                    size="sm"
                                />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1 bg-green-50/40 dark:bg-brand-green-darker/20">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ClipboardCheck className="h-3 w-3" />Product</Label>
                                    <p className="font-semibold text-sm">{data.loan.productName ?? '—'}</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1 bg-green-50/40 dark:bg-brand-green-darker/20">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" />Amount</Label>
                                    <p className="font-semibold text-sm text-primary dark:text-primary">₹{new Intl.NumberFormat('en-IN').format(data.loan.amount)}</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1 bg-green-50/40 dark:bg-brand-green-darker/20">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Percent className="h-3 w-3" />Interest Rate</Label>
                                    <p className="font-semibold text-sm">{data.loan.interestRate}%</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1 bg-green-50/40 dark:bg-brand-green-darker/20">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" />Tenure</Label>
                                    <p className="font-semibold text-sm">{data.loan.tenureMonths} mo</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1 bg-green-50/40 dark:bg-brand-green-darker/20">
                                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Repeat className="h-3 w-3" />Frequency</Label>
                                    <p className="font-semibold text-sm capitalize">{data.loan.frequency}</p>
                                </div>
                            </div>
                            <Separator />
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" onClick={() => setProductModalOpen(true)}>
                                    <Pencil className="h-4 w-4 mr-2" /> Change Product
                                </Button>
                                <Button onClick={markLoanAppraisalReviewed} disabled={isMarkingReviewed} className="bg-primary hover:bg-primary text-white">
                                    {isMarkingReviewed ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                                    Save & Continue
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* House Hold Visit */}
                <TabsContent value="household-visit" className="pt-4">
                    <Card className="border-primary/20 dark:border-sidebar-accent/60">
                        <CardHeader className="pb-3"><CardTitle className="text-base">House Photo & Location</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {gpsError && (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs dark:bg-red-900/20 dark:border-red-800">
                                    <AlertTriangle className="h-4 w-4 shrink-0" /> {gpsError}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold flex items-center gap-1.5"><Home className="h-3.5 w-3.5" />FDO Uploaded House Image (at enrollment)</Label>
                                {data.houseHoldVisit.fdoHouseImage ? (
                                    <StorageImage
                                        src={data.houseHoldVisit.fdoHouseImage.photoUrl}
                                        alt="FDO House Image"
                                        className="h-24 w-32 object-cover rounded-lg border shrink-0 cursor-pointer hover:opacity-90"
                                        onClick={() => setViewerTarget({
                                            src: data.houseHoldVisit.fdoHouseImage!.photoUrl,
                                            alt: 'FDO House Image',
                                            title: 'FDO Uploaded House Image',
                                            uploadedByName: data.houseHoldVisit.fdoHouseImage!.uploadedByName,
                                            uploadedAt: data.houseHoldVisit.fdoHouseImage!.createdAt,
                                        })}
                                    />
                                ) : (
                                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                        <AlertTriangle className="h-3 w-3 shrink-0" /> FDO did not upload a house image at enrollment.
                                    </p>
                                )}
                            </div>

                            <Separator />

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />BM Verification Photo (mandatory)</Label>
                                {mandatoryPhoto ? (
                                    <div className="flex items-start gap-4 flex-wrap">
                                        <StorageImage
                                            src={mandatoryPhoto.photoUrl}
                                            alt="House"
                                            className="h-24 w-32 object-cover rounded-lg border shrink-0 cursor-pointer hover:opacity-90"
                                            onClick={() => setViewerTarget({
                                                src: mandatoryPhoto.photoUrl,
                                                alt: 'BM Verification Photo',
                                                title: 'BM Verification Photo',
                                                uploadedByName: mandatoryPhoto.uploadedByName,
                                                uploadedAt: mandatoryPhoto.createdAt,
                                            })}
                                        />
                                        <div className="text-xs space-y-2">
                                            <div className="flex flex-wrap gap-2">
                                                <DistanceChip label="Branch" distance={mandatoryPhoto.distanceFromBranchMeters} />
                                                <DistanceChip label="Center" distance={mandatoryPhoto.distanceMeters} radius={HOUSEHOLD_VISIT_CENTER_RADIUS_METERS} />
                                                <DistanceChip label="FDO" distance={mandatoryPhoto.distanceFromClientMeters} radius={LOCATION_MATCH_RADIUS_METERS} />
                                            </div>
                                            <Button type="button" size="sm" variant="ghost" className="text-red-500 hover:text-red-600 h-7 px-2" onClick={() => removePhoto(mandatoryPhoto.id)}>
                                                <X className="h-3.5 w-3.5 mr-1" /> Remove & Retake
                                            </Button>
                                        </div>
                                        {/* Where the verification photo was taken */}
                                        <LocationPreview
                                            className="w-full"
                                            latitude={mandatoryPhoto.latitude}
                                            longitude={mandatoryPhoto.longitude}
                                            title={`${data.loan.clientName} — House Visit`}
                                            code={data.loan.clientDisplayId}
                                            heightClassName="h-48"
                                            hideWhenEmpty
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-2">
                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                                    Set your location before capturing
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    <Button
                                                        type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                                                        disabled={isFetchingLiveLocation}
                                                        onClick={fetchLiveLocation}
                                                    >
                                                        {isFetchingLiveLocation
                                                            ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                                            : <LocateFixed className="h-3 w-3 mr-1" />}
                                                        {isFetchingLiveLocation ? locatingLabel : 'Use My Location'}
                                                    </Button>
                                                    <Button
                                                        type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                                                        onClick={() => setIsMapPickerOpen(true)}
                                                    >
                                                        <Map className="h-3 w-3 mr-1" /> Select on Map
                                                    </Button>
                                                </div>
                                            </div>
                                            <LocationSearchBox
                                                onSelect={(lat, lng) => handleMapLocationChange(lat, lng)}
                                                biasLat={liveCoords?.lat ?? data.center.latitude ?? undefined}
                                                biasLng={liveCoords?.lng ?? data.center.longitude ?? undefined}
                                            />
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-400">Latitude</Label>
                                                    <Input
                                                        value={manualLat}
                                                        onChange={(e) => handleManualLatChange(e.target.value)}
                                                        placeholder="e.g. 10.362400"
                                                        inputMode="decimal"
                                                        className="h-7 text-[11px]"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-400">Longitude</Label>
                                                    <Input
                                                        value={manualLng}
                                                        onChange={(e) => handleManualLngChange(e.target.value)}
                                                        placeholder="e.g. 77.969500"
                                                        inputMode="decimal"
                                                        className="h-7 text-[11px]"
                                                    />
                                                </div>
                                            </div>
                                            {liveAccuracy != null && (
                                                <p className={`text-[11px] flex items-center gap-1.5 ${liveAccuracy > LOW_ACCURACY_WARN_METERS ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                    <LocateFixed className="h-3 w-3 shrink-0" />
                                                    GPS accuracy ±{Math.round(liveAccuracy)} m
                                                    {liveAccuracy > LOW_ACCURACY_WARN_METERS && ' — approximate (no GPS / indoors), drag the pin onto the exact spot if needed'}
                                                </p>
                                            )}
                                            {liveLocationError && (
                                                <p className="text-[11px] text-red-600 flex items-center gap-1.5">
                                                    <AlertTriangle className="h-3 w-3 shrink-0" /> {liveLocationError}
                                                </p>
                                            )}
                                            {liveCoords && (
                                                liveBranchDistance.isLoading || liveCenterDistance.isLoading || liveFdoDistance.isLoading ? (
                                                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                                        <Loader2 className="h-3 w-3 animate-spin shrink-0" /> Calculating distances...
                                                    </p>
                                                ) : (
                                                    <div className="flex flex-wrap gap-2">
                                                        <DistanceChip label="Branch" distance={liveBranchDistance.distanceMeters} />
                                                        <DistanceChip label="Center" distance={liveCenterDistance.distanceMeters} radius={HOUSEHOLD_VISIT_CENTER_RADIUS_METERS} />
                                                        <DistanceChip label="FDO" distance={liveFdoDistance.distanceMeters} radius={LOCATION_MATCH_RADIUS_METERS} />
                                                    </div>
                                                )
                                            )}
                                            {!isMapPickerOpen && (
                                                <LocationPreview
                                                    latitude={liveCoords?.lat}
                                                    longitude={liveCoords?.lng}
                                                    title={data.loan.clientName}
                                                    code={data.loan.clientDisplayId}
                                                    heightClassName="h-48"
                                                    hideWhenEmpty
                                                />
                                            )}
                                        </div>
                                        <Button type="button" variant="outline" disabled={isUploadingPhoto} onClick={() => openCamera(true)}>
                                            {isUploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
                                            Capture Mandatory Photo
                                        </Button>
                                    </div>
                                )}
                                {isOutOfRange && (
                                    <p className="text-xs text-red-600 flex items-center gap-1.5">
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                        {centerOutOfRange
                                            ? `Outside the ${HOUSEHOLD_VISIT_CENTER_RADIUS_METERS}m center range.`
                                            : `Outside the ${LOCATION_MATCH_RADIUS_METERS}m range of the location FDO recorded at enrollment.`} Cannot approve this client until retaken within range.
                                    </p>
                                )}
                                {!data.client.latitude && (
                                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                        <AlertTriangle className="h-3 w-3 shrink-0" /> No FDO enrollment location on file for this client — that check is skipped.
                                    </p>
                                )}
                            </div>

                            <Separator />

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold">Optional Additional Photos</Label>
                                <div className="flex flex-wrap gap-3">
                                    {optionalPhotos.map((p) => (
                                        <div key={p.id} className="relative">
                                            <StorageImage
                                                src={p.photoUrl}
                                                alt="House"
                                                className="h-20 w-24 object-cover rounded-lg border cursor-pointer hover:opacity-90"
                                                onClick={() => setViewerTarget({
                                                    src: p.photoUrl,
                                                    alt: 'Additional House Photo',
                                                    title: 'Additional House Photo',
                                                    uploadedByName: p.uploadedByName,
                                                    uploadedAt: p.createdAt,
                                                })}
                                            />
                                            <button
                                                type="button"
                                                className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                                                onClick={() => removePhoto(p.id)}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" disabled={isUploadingPhoto} onClick={() => openCamera(false)}>
                                        <Camera className="h-3.5 w-3.5 mr-1.5" /> Add Photo
                                    </Button>
                                </div>
                            </div>

                            <div className="flex justify-end pt-2">
                                <Button onClick={completeHouseholdVisit} disabled={isCompletingVisit || !mandatoryPhoto} className="bg-primary hover:bg-primary text-white">
                                    {isCompletingVisit ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                                    Complete
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <CameraCapture
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={(file) => { setCameraOpen(false); handlePhotoCaptured(file); }}
                label={cameraForMandatory ? 'House Photo' : 'Additional Photo'}
            />

            <ImageViewerDialog target={viewerTarget} onClose={() => setViewerTarget(null)} />

            <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MapPin className="h-5 w-5 text-primary" /> Select Your Location
                        </DialogTitle>
                        <DialogDescription>
                            Click anywhere on the map, or drag the marker, to set your current location for the distance check.
                        </DialogDescription>
                    </DialogHeader>
                    <LocationMapPicker
                        latitude={liveCoords?.lat ?? data.center.latitude ?? DEFAULT_MAP_LAT}
                        longitude={liveCoords?.lng ?? data.center.longitude ?? DEFAULT_MAP_LNG}
                        centerName={data.loan.clientName}
                        centerCode={data.loan.clientDisplayId}
                        editable
                        onLocationChange={handleMapLocationChange}
                        heightClassName="h-[50vh]"
                    />
                    <DialogFooter>
                        <Button type="button" onClick={() => setIsMapPickerOpen(false)} className="bg-primary hover:bg-sidebar-accent text-white">
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {productModalOpen && (
                <LoanProductEditModal
                    open={productModalOpen}
                    onOpenChange={setProductModalOpen}
                    loanId={loanId}
                    currentProductId={data.loan.loanProductId}
                    role="AM"
                    stage="MEMBER_INDIVIDUAL"
                    maxAllowedAmount={data.loan.maxAllowedAmount}
                    onSaved={handleProductSaved}
                />
            )}
        </div>
    );
}
