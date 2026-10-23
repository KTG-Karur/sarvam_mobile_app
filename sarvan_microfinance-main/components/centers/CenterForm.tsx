'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { MapPin, Save, RotateCcw, Loader2, CalendarDays, Clock, Map, LocateFixed } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { InlineBranchSwitcher } from '@/components/branch/InlineBranchSwitcher';
import { DateInput } from '@/components/ui/date-input';
import LocationSearchBox from './LocationSearchBox';
import LocationPreview from './LocationPreview';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';

// Dynamically import the Leaflet map (avoids SSR issues — same pattern as LocateCenterClient)
const MapComponent = dynamic(() => import('./CenterMap'), {
    ssr: false,
    loading: () => <PageLoader fullScreen={false} />,
});

// Fallback map center (Dindigul, Tamil Nadu) used when no coordinates are set yet.
const DEFAULT_MAP_LAT = 10.3624;
const DEFAULT_MAP_LNG = 77.9695;

/** Great-circle (straight-line) distance between two lat/long points, in KM. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Shared fields (everything except `code`)
const baseCenterFields = {
    name: z.string().min(1, 'Center name is required').max(200, 'Center name is too long'),
    fdoId: z.string().optional(),
    address: z.string().optional(),
    localArea: z.string().optional(),
    formationDate: z.string().min(1, 'Formation date is required'),
    meetingDay: z.string().min(1, 'Meeting day is required'),
    meetingTime: z.string().min(1, 'Meeting time is required'),
    meetingPlace: z.string().optional(),
    latitude: z
        .string()
        .min(1, 'Latitude is required')
        .refine(
            (val) => /^-?([1-8]?[0-9](\.[0-9]{1,6})?|90(\.0{1,6})?)$/.test(val),
            'Invalid latitude'
        ),
    longitude: z
        .string()
        .min(1, 'Longitude is required')
        .refine(
            (val) => /^-?((1[0-7][0-9]|[1-9]?[0-9])(\.[0-9]{1,6})?|180(\.0{1,6})?)$/.test(val),
            'Invalid longitude'
        ),
    kmFromBranch: z
        .string()
        .min(1, 'KM from branch is required')
        .refine(
            (val) => /^\d+(\.\d{1,2})?$/.test(val) && parseFloat(val) > 0,
            'Must be a positive number with at most 2 decimal places'
        ),
    contactPerson: z
        .string()
        .min(3, 'Contact person name must be at least 3 characters')
        .max(100, 'Contact person name must be at most 100 characters'),
    contactNumber: z
        .string()
        .regex(/^\d{10}$/, 'Contact person number must be exactly 10 digits'),
};

// Create: code must be numeric (auto-generated, but user can type)
const createCenterSchema = z.object({
    ...baseCenterFields,
    code: z.string().min(1, 'Center ID is required').regex(/^\d+$/, 'Center ID must be numeric only'),
});

// Edit: code is read-only — accept the existing value as-is (may be legacy non-numeric)
const editCenterSchema = z.object({
    ...baseCenterFields,
    code: z.string().min(1, 'Center ID is required'),
});

type CenterFormValues = z.infer<typeof createCenterSchema>;

interface Center {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    localArea?: string | null;
    fdoId?: string;
    formationDate?: string;
    meetingDay?: string;
    meetingTime?: string;
    meetingPlace?: string;
    latitude?: string;
    longitude?: string;
    kmFromBranch?: number | null;
    contactPerson?: string | null;
    contactNumber?: string | null;
}

interface CenterFormProps {
    initialData?: Center;
    onSuccess?: () => void;
    onCancel?: () => void;
    variant?: 'default' | 'compact';
}

const DAYS_OF_WEEK = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
] as const;

const toDateStr = (val?: string | null) => {
    if (!val) return '';
    return val.includes('T') ? val.split('T')[0] : val;
};

const toTimeStr = (val?: string | null) => {
    if (!val) return '';
    val = val.trim();
    // If already in HH:MM format, return as-is
    if (/^\d{1,2}:\d{2}$/.test(val)) return val;
    // Convert "10:00 AM" or "2:00 PM" to 24-hour "HH:MM"
    const match = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
    if (match) {
        let hour = parseInt(match[1]);
        const minute = match[2];
        const period = match[3].toUpperCase();
        if (period === 'PM' && hour !== 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        return `${String(hour).padStart(2, '0')}:${minute}`;
    }
    return val;
};

export function CenterForm({
    initialData,
    onSuccess,
    onCancel,
    variant = 'default',
}: CenterFormProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const { locate, isLocating, locatingLabel } = useAccurateLocation();
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [branchCoords, setBranchCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [branchCoordsChecked, setBranchCoordsChecked] = useState(false);
    const [isCalculatingKm, setIsCalculatingKm] = useState(false);
    // Bumped by InlineBranchSwitcher whenever ADMIN/AREA_MANAGER picks a different
    // active branch — HO isn't a real operating branch, so ADMIN has no branchId of
    // its own to fall back on, and every branch-scoped fetch below (FDOs, branch
    // location, next Center ID) needs to re-run against the newly selected branch.
    const [branchRefreshKey, setBranchRefreshKey] = useState(0);
    // Page-local branch (the selector runs in pageLocal mode, so the session/header
    // branch never changes). null = not picked yet → session branch / home branch.
    const centerBranchIdRef = useRef<string | null>(null);
    const getFormBranchId = () =>
        centerBranchIdRef.current || branchStorage.getActiveBranch()?.id || tokenStorage.getUser()?.branchId;
    const [currentUserId, setCurrentUserId] = useState<string>('');
    const [currentUserName, setCurrentUserName] = useState<string>('');
    const [currentUserRole, setCurrentUserRole] = useState<string>('');
    const [fdos, setFdos] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
    const [isLoadingFdos, setIsLoadingFdos] = useState(false);
    const [meetingPlaces, setMeetingPlaces] = useState<{ id: string; name: string }[]>([]);
    const [isLoadingMeetingPlaces, setIsLoadingMeetingPlaces] = useState(false);

    const isEditMode = !!initialData;
    // Center ID is locked after creation except for Admin/Sub Admin (server re-checks)
    const [canEditCode, setCanEditCode] = useState(false);
    useEffect(() => {
        const user = tokenStorage.getUser();
        setCanEditCode(user?.role === 'ADMIN' || !!user?.isSubAdmin);
    }, []);
    const isCodeLocked = isEditMode && !canEditCode;
    // Reason is required whenever Admin/Sub Admin changes the Center ID — logged to Super Control audit history
    const [codeChangeReason, setCodeChangeReason] = useState('');
    const form = useForm<CenterFormValues>({
        resolver: zodResolver(isEditMode ? editCenterSchema : createCenterSchema),
        defaultValues: initialData
            ? {
                name: initialData.name,
                code: initialData.code,
                fdoId: initialData.fdoId || '',
                address: initialData.address || '',
                localArea: initialData.localArea || '',
                formationDate: toDateStr(initialData.formationDate),
                meetingDay: initialData.meetingDay || '',
                meetingTime: toTimeStr(initialData.meetingTime),
                meetingPlace: initialData.meetingPlace || '',
                latitude: initialData.latitude ? String(initialData.latitude) : '',
                longitude: initialData.longitude ? String(initialData.longitude) : '',
                kmFromBranch: initialData.kmFromBranch != null ? String(initialData.kmFromBranch) : '',
                contactPerson: initialData.contactPerson || '',
                contactNumber: initialData.contactNumber || '',
            }
            : {
                name: '',
                code: '',
                fdoId: '',
                address: '',
                localArea: '',
                formationDate: new Date().toISOString().split('T')[0],
                meetingDay: '',
                meetingTime: '',
                meetingPlace: '',
                latitude: '',
                longitude: '',
                kmFromBranch: '',
                contactPerson: '',
                contactNumber: '',
            },
    });

    // Fetch the branch's own lat/long so "KM From Branch" can be auto-calculated
    // once the center's location is set (see applyAutoKm / the auto-calc effect below).
    // Re-runs on branchRefreshKey so switching branches (InlineBranchSwitcher, below —
    // needed because ADMIN's own branch is HO, not a real operating branch) refetches
    // against the newly selected branch instead of leaving the previous one's data.
    useEffect(() => {
        setBranchCoords(null);
        setBranchCoordsChecked(false);
        const branchId = getFormBranchId();
        if (!branchId) {
            setBranchCoordsChecked(true);
            return;
        }
        apiClient
            .get<{ latitude?: number | null; longitude?: number | null }>(`/branches/${branchId}`)
            .then((res) => {
                if (res.success && res.data?.latitude != null && res.data?.longitude != null) {
                    setBranchCoords({ lat: res.data.latitude, lng: res.data.longitude });
                }
            })
            .finally(() => setBranchCoordsChecked(true));
    }, [branchRefreshKey]);

    // Pre-fill Center ID with next available ID (per-branch) on create mode
    useEffect(() => {
        if (!initialData) {
            const branchId = getFormBranchId();
            const query = branchId ? `?branchId=${branchId}` : '';
            apiClient.get<{ nextId: string }>(`/centers/next-id${query}`).then(res => {
                if (res.success && res.data?.nextId) {
                    form.setValue('code', res.data.nextId);
                }
            });
        }
    }, [branchRefreshKey]);

    // Reset form data when initialData changes (for edit mode)
    useEffect(() => {
        if (initialData) {
            form.reset({
                name: initialData.name,
                code: initialData.code,
                fdoId: initialData.fdoId || '',
                address: initialData.address || '',
                localArea: initialData.localArea || '',
                formationDate: toDateStr(initialData.formationDate),
                meetingDay: initialData.meetingDay || '',
                meetingTime: toTimeStr(initialData.meetingTime),
                meetingPlace: initialData.meetingPlace || '',
                latitude: initialData.latitude ? String(initialData.latitude) : '',
                longitude: initialData.longitude ? String(initialData.longitude) : '',
                kmFromBranch: initialData.kmFromBranch != null ? String(initialData.kmFromBranch) : '',
                contactPerson: initialData.contactPerson || '',
                contactNumber: initialData.contactNumber || '',
            });
        }
    }, [initialData?.id, form]);

    // Load current user identity and lock FDO select if the user is an FDO
    useEffect(() => {
        const storedUser = tokenStorage.getUser();
        if (!storedUser) return;
        const name = [storedUser.firstName, storedUser.lastName].filter(Boolean).join(' ');
        setCurrentUserId(storedUser.id);
        setCurrentUserName(name || storedUser.email || '');
        setCurrentUserRole(storedUser.role || '');
        if (storedUser.role === 'FDO') {
            form.setValue('fdoId', storedUser.id);
        }
    }, []);

    // Fetch FDO list for non-FDO users (BM, Admin, etc.) who need to pick one
    useEffect(() => {
        if (!currentUserRole || currentUserRole === 'FDO') return;
        const branchId = getFormBranchId();
        setFdos([]);
        if (!branchId) return;
        setIsLoadingFdos(true);
        apiClient
            .get<{ users: { id: string; firstName: string; lastName: string }[] }>(
                `/users?role=FDO&branchId=${branchId}&pageSize=100`
            )
            .then((res) => {
                if (res.success && res.data) setFdos(res.data.users);
            })
            .finally(() => setIsLoadingFdos(false));
    }, [currentUserRole, branchRefreshKey]);

    // Fetch the admin-managed list of meeting places for the dropdown
    useEffect(() => {
        setIsLoadingMeetingPlaces(true);
        apiClient
            .get<{ id: string; name: string }[]>('/meeting-places?includeInactive=false')
            .then((res) => {
                if (res.success && res.data) setMeetingPlaces(res.data);
            })
            .finally(() => setIsLoadingMeetingPlaces(false));
    }, []);

    // Recomputes "KM From Branch" from the branch's saved coordinates whenever the
    // center's lat/long change. Called explicitly right after Use My Location / the
    // map picker set new coordinates, rather than left to a passive watch-effect, so
    // the field visibly refreshes the moment either action completes. When the branch
    // itself has no saved location yet (a prerequisite — set it via Hub → Branch →
    // Select on Map), tells the user why instead of silently doing nothing.
    //
    // Fetches actual road (driving) distance from the backend — matches what the same
    // two points would show as driving distance on Google Maps, rather than a
    // straight-line estimate. Falls back to straight-line (server-side) if the routing
    // lookup fails, and flags that to the user so the number isn't silently wrong.
    const kmRequestId = useRef(0);
    const applyAutoKm = async (lat: number, lng: number, { notifyIfMissing = false }: { notifyIfMissing?: boolean } = {}) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (!branchCoords) {
            // Previously gated on branchCoordsChecked to avoid a premature toast before the
            // branch-coords fetch resolved — but that meant a fast click right after the page
            // loaded got zero feedback at all (fetch still in flight, so neither branch nor
            // "not set" toast fired). Always explaining beats sometimes staying silent.
            if (notifyIfMissing) {
                toast({
                    title: branchCoordsChecked ? 'Branch location not set' : 'Still checking branch location',
                    description: branchCoordsChecked
                        ? "This branch has no saved location yet, so KM From Branch can't be auto-calculated. Set it via Hub → Branch → Select on Map."
                        : 'The branch location is still loading — please try again in a moment.',
                });
            }
            return;
        }

        const requestId = ++kmRequestId.current;
        setIsCalculatingKm(true);
        try {
            const res = await apiClient.get<{ distanceKm: number; source: 'osrm' | 'straight-line' }>(
                `/geo/driving-distance?fromLat=${branchCoords.lat}&fromLng=${branchCoords.lng}&toLat=${lat}&toLng=${lng}`
            );
            if (requestId !== kmRequestId.current) return; // a newer request superseded this one
            if (res.success && res.data) {
                form.setValue('kmFromBranch', res.data.distanceKm.toFixed(2), { shouldValidate: true, shouldDirty: true });
                if (res.data.source === 'straight-line') {
                    toast({
                        title: 'Road distance unavailable',
                        description: 'Could not reach the routing service — showing straight-line distance instead.',
                    });
                }
            } else {
                const km = haversineKm(branchCoords.lat, branchCoords.lng, lat, lng);
                form.setValue('kmFromBranch', km.toFixed(2), { shouldValidate: true, shouldDirty: true });
            }
        } finally {
            if (requestId === kmRequestId.current) setIsCalculatingKm(false);
        }
    };

    const handleLocateCenter = () =>
        locate({
            onPosition: (lat, lng) => {
                form.setValue('latitude', lat.toFixed(6), { shouldValidate: true, shouldDirty: true });
                form.setValue('longitude', lng.toFixed(6), { shouldValidate: true, shouldDirty: true });
            },
            // KM-from-branch hits the routing API — only once, for the final fix
            onDone: (pos) => applyAutoKm(pos.latitude, pos.longitude, { notifyIfMissing: true }),
            subject: 'Center location',
        });

    // Live-synced while the marker is dragged / the map is clicked in the picker dialog.
    const handleMapLocationChange = (lat: number, lng: number) => {
        form.setValue('latitude', lat.toFixed(6), { shouldValidate: true, shouldDirty: true });
        form.setValue('longitude', lng.toFixed(6), { shouldValidate: true, shouldDirty: true });
        applyAutoKm(lat, lng, { notifyIfMissing: true });
    };

    const mapLat = parseFloat(form.watch('latitude') || '');
    const mapLng = parseFloat(form.watch('longitude') || '');

    // Fallback for manually typed lat/long — no toast here (would fire on every
    // keystroke); Use My Location / the map picker already notify explicitly above.
    // Skips the very first run so opening the Edit dialog doesn't immediately
    // overwrite an already-saved kmFromBranch before the user has touched anything.
    // Debounced since applyAutoKm now hits the routing API — without this every
    // keystroke while typing coordinates would fire its own network request.
    const skipNextKmCalc = useRef(true);
    useEffect(() => {
        if (skipNextKmCalc.current) {
            skipNextKmCalc.current = false;
            return;
        }
        const timer = setTimeout(() => {
            applyAutoKm(mapLat, mapLng);
        }, 600);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapLat, mapLng, branchCoords]);

    async function onSubmit(values: CenterFormValues) {
        const isCodeChanged = isEditMode && canEditCode && values.code.trim() !== initialData?.code?.trim();
        if (isCodeChanged && codeChangeReason.trim().length < 5) {
            toast({
                title: 'Reason required',
                description: 'Enter a reason (min 5 characters) for changing the Center ID.',
                variant: 'destructive',
            });
            return;
        }
        setIsLoading(true);

        try {
            // Get the branch ID from active branch or user's branchId
            const branchId = getFormBranchId();

            if (!branchId) {
                toast({
                    title: 'Error',
                    description: 'No branch found. Please select a branch first.',
                    variant: 'destructive',
                });
                setIsLoading(false);
                return;
            }

            const payload = {
                name: values.name.trim(),
                // On edit, send code only when Admin/Sub Admin actually changed it
                ...(!isEditMode && { code: values.code ? values.code.trim() : undefined }),
                ...(isCodeChanged && { code: values.code.trim(), codeChangeReason: codeChangeReason.trim() }),
                address: values.address?.trim() || null,
                localArea: values.localArea?.trim() || null,
                branchId,
                fdoId: values.fdoId || undefined,
                formationDate: values.formationDate,
                meetingDay: values.meetingDay,
                meetingTime: values.meetingTime,
                meetingPlace: values.meetingPlace?.trim() || null,
                latitude: values.latitude ? parseFloat(values.latitude) : null,
                longitude: values.longitude ? parseFloat(values.longitude) : null,
                kmFromBranch: values.kmFromBranch ? parseFloat(values.kmFromBranch) : null,
                contactPerson: values.contactPerson?.trim() || null,
                contactNumber: values.contactNumber?.trim() || null,
                status: 'PENDING_APPROVAL',
            };

            // TODO: Replace with actual API endpoint when available
            let result;
            if (initialData) {
                result = await apiClient.patch(`/centers/${initialData.id}`, payload);
            } else {
                result = await apiClient.post('/centers', payload);
            }

            if (!result.success) {
                // Check if endpoint doesn't exist (404)
                if (result.error?.includes('not found') || result.error?.includes('Endpoint not found')) {
                    toast({
                        title: 'API Not Available',
                        description: 'Center API endpoint is not yet implemented. This is a demo action.',
                        variant: 'default',
                    });
                    // Still call onSuccess for demo purposes
                    if (onSuccess) {
                        onSuccess();
                    }
                    return;
                }

                toast({
                    title: 'Error',
                    description: result.error || `Failed to ${initialData ? 'update' : 'create'} center`,
                    variant: 'destructive',
                });
                return;
            }

            toast({
                title: 'Success',
                description: `Center ${initialData ? 'updated' : 'created'} successfully`,
            });

            // Reset form only if creating new center
            if (!initialData) {
                form.reset({
                    name: '',
                    code: '',
                    fdoId: currentUserRole === 'FDO' ? currentUserId : '',
                    address: '',
                    formationDate: new Date().toISOString().split('T')[0],
                    meetingDay: '',
                    meetingTime: '',
                    meetingPlace: '',
                    latitude: '',
                    longitude: '',
                    kmFromBranch: '',
                    contactPerson: '',
                    contactNumber: '',
                });
                // Re-fetch next ID for the reset form
                const branchId = getFormBranchId();
                const query = branchId ? `?branchId=${branchId}` : '';
                apiClient.get<{ nextId: string }>(`/centers/next-id${query}`).then(res => {
                    if (res.success && res.data?.nextId) {
                        form.setValue('code', res.data.nextId);
                    }
                });
            }

            if (onSuccess) {
                onSuccess();
            }
        } catch (error) {
            console.error(`Error ${initialData ? 'updating' : 'creating'} center:`, error);
            toast({
                title: 'Error',
                description: 'Network error. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }

    const isCompact = variant === 'compact';

    const formContent = (
        <>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
                {/* Branch context — only renders for ADMIN/AREA_MANAGER. HO is not a real
                    operating branch, so ADMIN has no branchId of its own; every branch-scoped
                    field below (FDO list, branch location for KM auto-calc, next Center ID)
                    is resolved from whichever branch is picked here. */}
                <InlineBranchSwitcher
                    pageLocal
                    onBranchChange={(branch) => {
                        centerBranchIdRef.current = branch.id;
                        form.setValue('fdoId', '');
                        setBranchRefreshKey((k) => k + 1);
                    }}
                />

                {/* Basic Information Section */}
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                        Basic Information
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center ID <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g., 001"
                                            inputMode="numeric"
                                            disabled={isCodeLocked}  // Only Admin/Sub Admin can change Center ID after creation
                                            {...field}
                                            onChange={
                                                isEditMode
                                                    ? field.onChange  // edit — keep legacy non-numeric codes intact
                                                    : (e) => {
                                                          // Strip non-digits on create
                                                          const numeric = e.target.value.replace(/\D/g, '');
                                                          field.onChange(numeric);
                                                      }
                                            }
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200',
                                                isCodeLocked && 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-800'
                                            )}
                                        />
                                    </FormControl>
                                    {isEditMode && canEditCode && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            Admin only — must be unique within this branch.
                                        </p>
                                    )}
                                    {isEditMode && canEditCode && (form.watch('code') || '').trim() !== (initialData?.code ?? '').trim() && (
                                        <div className="mt-2 space-y-1">
                                            <label htmlFor="center-code-change-reason" className="text-xs font-semibold text-sidebar-accent dark:text-slate-200">
                                                Reason for changing Center ID <span className="text-red-500">*</span>
                                            </label>
                                            <Input
                                                id="center-code-change-reason"
                                                value={codeChangeReason}
                                                onChange={(e) => setCodeChangeReason(e.target.value)}
                                                placeholder="e.g., Wrong ID entered at creation"
                                                className="h-9 text-sm"
                                            />
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Recorded in Super Control → Audit History.
                                            </p>
                                        </div>
                                    )}
                                    {isCodeLocked && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                            Center ID cannot be changed after creation.
                                        </p>
                                    )}
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center Name <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter center name"
                                            {...field}
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Center Address
                                    </FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Enter center address"
                                            {...field}
                                            rows={3}
                                            className={cn(
                                                'w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200 resize-none'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="localArea"
                            render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Local Area
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter local area"
                                            {...field}
                                            disabled={isLoading}
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* FDO & Dates Section */}
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                        FDO & Formation Details
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="fdoId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        FDO Name{currentUserRole !== 'FDO' && <span className="text-red-500"> *</span>}
                                    </FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value}
                                        disabled={currentUserRole === 'FDO'}
                                    >
                                        <FormControl>
                                            <SelectTrigger
                                                className={cn(
                                                    'h-11 w-full border border-primary/30 text-sm font-medium',
                                                    currentUserRole === 'FDO'
                                                        ? 'cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 opacity-80'
                                                        : 'bg-green-50 hover:border-primary focus:border-primary dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                            >
                                                <SelectValue
                                                    placeholder={
                                                        isLoadingFdos ? 'Loading FDOs...' : '-- SELECT FDO --'
                                                    }
                                                />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {currentUserRole === 'FDO' ? (
                                                <SelectItem value={currentUserId}>
                                                    {currentUserName}
                                                </SelectItem>
                                            ) : (
                                                fdos.map((fdo) => (
                                                    <SelectItem key={fdo.id} value={fdo.id}>
                                                        {[fdo.firstName, fdo.lastName]
                                                            .filter(Boolean)
                                                            .join(' ')}
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                    {currentUserRole === 'FDO' && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Automatically assigned to you as the creating FDO.
                                        </p>
                                    )}
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="formationDate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Formation Date <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput
                                                {...field}
                                                className={cn(
                                                    'h-11 w-full border border-primary/30 pr-9 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                            />
                                        </div>
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* Meeting Details Section */}
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                        Meeting Details
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="meetingDay"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Meeting Day <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger
                                                className={cn(
                                                    'h-11 w-full border border-primary/30 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                            >
                                                <SelectValue placeholder="-- SELECT DAY --" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {DAYS_OF_WEEK.map((day) => (
                                                <SelectItem key={day} value={day}>
                                                    {day}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="meetingTime"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Meeting Time <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Clock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input
                                                type="time"
                                                {...field}
                                                className={cn(
                                                    'h-11 w-full border border-primary/30 pr-9 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                            />
                                        </div>
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="meetingPlace"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Meeting Place
                                    </FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger
                                                className={cn(
                                                    'h-11 w-full border border-primary/30 text-sm font-medium',
                                                    'bg-green-50 hover:border-primary focus:border-primary',
                                                    'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                                )}
                                            >
                                                <SelectValue
                                                    placeholder={
                                                        isLoadingMeetingPlaces
                                                            ? 'Loading meeting places...'
                                                            : '-- SELECT MEETING PLACE --'
                                                    }
                                                />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {meetingPlaces.length === 0 ? (
                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                    No meeting places configured
                                                </div>
                                            ) : (
                                                meetingPlaces.map((place) => (
                                                    <SelectItem key={place.id} value={place.name}>
                                                        {place.name}
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* Contact & Location Section */}
                <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                        Contact & Location
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleLocateCenter}
                            disabled={isLocating}
                            className="h-11 w-full border-primary/50 text-sidebar-accent hover:bg-green-50 hover:border-primary"
                        >
                            {isLocating ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    {locatingLabel}
                                </>
                            ) : (
                                <>
                                    <LocateFixed className="h-4 w-4 mr-2" />
                                    Use My Location
                                </>
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsMapOpen(true)}
                            className="h-11 w-full border-primary/50 text-sidebar-accent hover:bg-green-50 hover:border-primary"
                        >
                            <Map className="h-4 w-4 mr-2" />
                            Select on Map
                        </Button>
                    </div>

                    <LocationSearchBox
                        onSelect={(lat, lng) => handleMapLocationChange(lat, lng)}
                        biasLat={parseFloat(form.watch('latitude') || '') || undefined}
                        biasLng={parseFloat(form.watch('longitude') || '') || undefined}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="latitude"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Latitude <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="e.g. 10.362400"
                                            {...field}
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="longitude"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Longitude <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            placeholder="e.g. 77.969500"
                                            {...field}
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>

                    {/* Hidden while the picker dialog is open so two Leaflet maps aren't mounted at once */}
                    {!isMapOpen && (
                        <LocationPreview
                            latitude={form.watch('latitude')}
                            longitude={form.watch('longitude')}
                            title={form.watch('name') || 'New Center'}
                        />
                    )}

                    <FormField
                        control={form.control}
                        name="kmFromBranch"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    KM From Branch <span className="text-red-500">*</span>{' '}
                                    <span className="text-xs font-normal text-slate-400">
                                        {isCalculatingKm
                                            ? '(calculating road distance…)'
                                            : branchCoords
                                            ? '(auto-calculated by road distance — Read Only)'
                                            : branchCoordsChecked
                                            ? "(branch location not set — can't auto-calculate)"
                                            : '(Read Only)'}
                                    </span>
                                </FormLabel>
                                <FormControl>
                                    <div className="relative">
                                        <Input
                                            type="text"
                                            placeholder="Auto-calculated from center location"
                                            {...field}
                                            readOnly
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium cursor-not-allowed',
                                                'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
                                            )}
                                        />
                                        {isCalculatingKm && (
                                            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                                        )}
                                    </div>
                                </FormControl>
                                <FormMessage className="text-xs" />
                            </FormItem>
                        )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="contactPerson"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Contact Person <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter contact person name"
                                            {...field}
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="contactNumber"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Contact Person Number <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter contact person mobile number"
                                            maxLength={10}
                                            {...field}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                                                field.onChange(val);
                                            }}
                                            className={cn(
                                                'h-11 w-full border border-primary/30 text-sm font-medium',
                                                'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                                'dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100',
                                                'transition-all duration-200'
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {initialData ? 'Updating...' : 'Creating...'}
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 mr-2" />
                                {initialData ? 'Update Center' : 'Save Center'}
                            </>
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            if (onCancel) {
                                onCancel();
                            } else {
                                form.reset();
                            }
                        }}
                        disabled={isLoading}
                        className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        {onCancel ? 'Cancel' : 'Reset'}
                    </Button>
                </div>
            </form>
        </Form>

        {/* Map Picker Dialog — click the map or drag the marker to set lat/long */}
        <Dialog open={isMapOpen} onOpenChange={setIsMapOpen}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-primary" />
                        Select Center Location
                    </DialogTitle>
                    <DialogDescription>
                        Click anywhere on the map, or drag the marker, to set the center&apos;s latitude and longitude.
                    </DialogDescription>
                </DialogHeader>
                <MapComponent
                    latitude={Number.isFinite(mapLat) ? mapLat : DEFAULT_MAP_LAT}
                    longitude={Number.isFinite(mapLng) ? mapLng : DEFAULT_MAP_LNG}
                    centerName={form.watch('name') || 'New Center'}
                    centerCode={form.watch('code') || ''}
                    address={form.watch('address') || undefined}
                    editable
                    onLocationChange={handleMapLocationChange}
                    heightClassName="h-[50vh]"
                />
                <DialogFooter>
                    <Button type="button" onClick={() => setIsMapOpen(false)} className="bg-primary hover:bg-sidebar-accent text-white">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );

    if (isCompact) {
        return <div className="w-full">{formContent}</div>;
    }

    return (
        <div className="relative w-full max-w-5xl">
            {/* Background Accent */}
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 blur-2xl" />

            {/* Main Card */}
            <div className="relative overflow-hidden rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95">
                {/* Top Gradient Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary bg-[length:200%_100%] animate-shimmer" />

                {/* Header */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 sm:px-8 py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <MapPin className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                    {initialData ? 'Edit Center Details' : 'Center Formation'}
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    {initialData
                                        ? 'Update center information and details.'
                                        : 'Create and manage center profiles with comprehensive details.'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Form Section */}
                <div className="px-4 sm:px-8 py-6">{formContent}</div>
            </div>
        </div>
    );
}

