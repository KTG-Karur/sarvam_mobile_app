"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Building2, Save, RotateCcw, Loader2, Map, LocateFixed, MapPin, CalendarDays } from "lucide-react";
import { PageLoader } from "@/components/ui/page-loader";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/app/lib/api-client";
import { Branch } from "@/app/types";
import { INDIA_STATES, getDistrictsForState } from "@/app/lib/constants/india-states-districts";
import { DateInput } from '@/components/ui/date-input';
import LocationSearchBox from '@/components/centers/LocationSearchBox';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';

// Dynamically import the Leaflet map (avoids SSR issues — same pattern as CenterForm)
const MapComponent = dynamic(() => import("@/components/centers/CenterMap"), {
    ssr: false,
    loading: () => <PageLoader fullScreen={false} />,
});

// Fallback map center (Dindigul, Tamil Nadu) used when no coordinates are set yet.
const DEFAULT_MAP_LAT = 10.3624;
const DEFAULT_MAP_LNG = 77.9695;

// Normalizes a stored date (which may come back as an ISO datetime string) to
// the plain yyyy-MM-dd shape the native date input requires.
const toDateStr = (val?: string | Date | null) => {
    if (!val) return "";
    const s = typeof val === "string" ? val : val.toISOString();
    return s.includes("T") ? s.split("T")[0] : s;
};

interface AreaOption {
    id: string;
    name: string;
    code: string;
    division: { name: string; region: { name: string } };
}

const branchSchema = z.object({
    name: z.string().min(1, "Branch name is required"),
    code: z.string()
        .min(1, "Branch ID is required")
        .regex(/^(\d+|HO)$/i, "Branch ID must be numeric only"),
    address: z.string().optional(),
    state: z.string().optional(),
    district: z.string().optional(),
    branchStartDate: z.string().optional(),
    eodStartDate: z.string().optional(),
    isActive: z.boolean().optional(),
    latitude: z
        .string()
        .optional()
        .refine(
            (val) => !val || /^-?([1-8]?[0-9](\.[0-9]{1,6})?|90(\.0{1,6})?)$/.test(val),
            "Invalid latitude"
        ),
    longitude: z
        .string()
        .optional()
        .refine(
            (val) =>
                !val || /^-?((1[0-7][0-9]|[1-9]?[0-9])(\.[0-9]{1,6})?|180(\.0{1,6})?)$/.test(val),
            "Invalid longitude"
        ),
    areaId: z.string().optional().nullable(),
});

interface BranchFormData {
    name: string;
    code: string;
    address?: string;
}

interface BranchFormProps {
    initialData?: Branch;
    onSuccess?: () => void;
    variant?: "default" | "compact";
}

export function BranchForm({ initialData, onSuccess, variant = "default" }: BranchFormProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const { locate, isLocating, locatingLabel } = useAccurateLocation();
    const [isMapOpen, setIsMapOpen] = useState(false);
    const [areas, setAreas] = useState<AreaOption[]>([]);
    // Stays editable until the branch actually closes its first EOD — only then
    // does it lock for good (enforced server-side too, in app/api/branches/[id]/route.ts).
    const eodStartDateLocked = !!initialData?.eodCompleted;

    useEffect(() => {
        apiClient.get('/areas').then(res => {
            if (res.success) setAreas((res.data as AreaOption[]) || []);
        });
    }, []);

    const form = useForm<z.infer<typeof branchSchema>>({
        resolver: zodResolver(branchSchema),
        defaultValues: initialData ? {
            name: initialData.name,
            code: initialData.code,
            address: initialData.address || undefined,
            state: initialData.state || undefined,
            district: initialData.district || undefined,
            branchStartDate: toDateStr(initialData.branchStartDate),
            eodStartDate: toDateStr(initialData.eodStartDate),
            isActive: initialData.isActive ?? true,
            latitude: initialData.latitude != null ? String(initialData.latitude) : "",
            longitude: initialData.longitude != null ? String(initialData.longitude) : "",
            areaId: initialData.areas?.[0]?.id || null,
        } : {
            name: "",
            code: "",
            address: "",
            state: "",
            district: "",
            branchStartDate: "",
            eodStartDate: "",
            isActive: true,
            latitude: "",
            longitude: "",
            areaId: null,
        },
    });

    useEffect(() => {
        if (!initialData) {
            apiClient.get<{ nextId: string }>('/branches/next-id').then(res => {
                if (res.success && res.data?.nextId) {
                    form.setValue('code', res.data.nextId);
                }
            });
        }
    }, []);

    // Live-synced while the marker is dragged / the map is clicked in the picker dialog.
    const handleMapLocationChange = (lat: number, lng: number) => {
        form.setValue("latitude", lat.toFixed(6), { shouldValidate: true, shouldDirty: true });
        form.setValue("longitude", lng.toFixed(6), { shouldValidate: true, shouldDirty: true });
    };

    const handleLocateBranch = () =>
        locate({ onPosition: handleMapLocationChange, subject: "Branch location" });

    const mapLat = parseFloat(form.watch("latitude") || "");
    const mapLng = parseFloat(form.watch("longitude") || "");
    const hasValidMapCoords =
        Number.isFinite(mapLat) && Number.isFinite(mapLng) &&
        Math.abs(mapLat) <= 90 && Math.abs(mapLng) <= 180;

    async function onSubmit(values: z.infer<typeof branchSchema>) {
        // Only required when creating a new branch — existing branches predate this
        // field and must stay editable even though theirs is still blank.
        if (!initialData && !values.eodStartDate) {
            form.setError('eodStartDate', {
                type: 'manual',
                message: 'Branch started working date (EOD start day) is required',
            });
            return;
        }

        setIsLoading(true);

        try {
            const payload = {
                name: values.name.trim(),
                code: values.code?.trim() || null,
                address: values.address?.trim() || null,
                state: values.state?.trim() || null,
                district: values.district?.trim() || null,
                branchStartDate: values.branchStartDate || null,
                eodStartDate: values.eodStartDate || null,
                isActive: values.isActive ?? true,
                latitude: values.latitude ? parseFloat(values.latitude) : null,
                longitude: values.longitude ? parseFloat(values.longitude) : null,
                areaId: values.areaId || null,
            };

            let result;
            if (initialData) {
                // Update existing branch
                result = await apiClient.patch(`/branches/${initialData.id}`, payload);
            } else {
                // Create new branch
                result = await apiClient.post("/branches", payload);
            }

            if (!result.success) {
                toast({
                    title: "Error",
                    description: result.error || `Failed to ${initialData ? "update" : "create"} branch`,
                    variant: "destructive",
                });
                return;
            }

            toast({
                title: "Success",
                description: result.message || `Branch ${initialData ? "updated" : "created"} successfully`,
            });

            // Reset form only if creating new branch
            if (!initialData) {
                form.reset({
                    name: "",
                    code: "",
                    address: "",
                    state: "",
                    district: "",
                    branchStartDate: "",
                    eodStartDate: "",
                    isActive: true,
                    latitude: "",
                    longitude: "",
                    areaId: null,
                });
            }

            if (onSuccess) {
                onSuccess();
            }
        } catch (error) {
            console.error(`Error ${initialData ? "updating" : "creating"} branch:`, error);
            toast({
                title: "Error",
                description: "Network error. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }

    const isCompact = variant === "compact";

    const formContent = (
        <>
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-6"
                    aria-label="Branch creation form"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch Name <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter branch name"
                                            {...field}
                                            className={cn(
                                                "h-11 w-full border border-primary/30 text-sm font-medium",
                                                "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                "transition-all duration-200"
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch ID <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="e.g., 001"
                                            {...field}
                                            value={field.value ?? ""}
                                            className={cn(
                                                "h-11 w-full border border-primary/30 text-sm font-medium",
                                                "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                "transition-all duration-200"
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        {/* <FormField
                            control={form.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch Code {initialData && <span className="text-red-500">*</span>}
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder={initialData ? "Enter unique branch code (e.g., BR001)" : "System Generated ID"}
                                            {...field}
                                            value={initialData ? (field.value || "") : (field.value || "AUTO-GENERATED")}
                                            readOnly={!initialData}
                                            onChange={(e) => {
                                                if (!initialData) return;
                                                field.onChange(e.target.value.toUpperCase());
                                            }}
                                            className={cn(
                                                "h-11 w-full border border-primary/30 text-sm font-medium uppercase",
                                                !initialData ? "bg-brand-green-tint dark:bg-sidebar-accent cursor-not-allowed opacity-70" : "bg-green-50",
                                                "hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:border-sidebar-accent dark:text-slate-100",
                                                "transition-all duration-200"
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {initialData ? "Unique code for this branch" : "Branch code will be automatically assigned by the system"}
                                    </p>
                                </FormItem>
                            )}
                        />*/}

                        <FormField
                            control={form.control}
                            name="areaId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Area <span className="text-slate-400 font-normal">(optional)</span>
                                    </FormLabel>
                                    <Select
                                        value={field.value ?? 'none'}
                                        onValueChange={v => field.onChange(v === 'none' ? null : v)}
                                    >
                                        <FormControl>
                                            <SelectTrigger className={cn(
                                                "h-11 border border-primary/30 text-sm",
                                                "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100"
                                            )}>
                                                <SelectValue placeholder="Select Area" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="none">None / Unassigned</SelectItem>
                                            {areas.map(a => (
                                                <SelectItem key={a.id} value={a.id}>
                                                    {a.name} ({a.division.name} — {a.division.region.name})
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
                            name="address"
                            render={({ field }) => (
                                <FormItem className="md:col-span-2">
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Address
                                    </FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Enter branch address (optional)"
                                            {...field}
                                            rows={3}
                                            className={cn(
                                                "w-full border border-primary/30 text-sm font-medium",
                                                "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                "transition-all duration-200 resize-none"
                                            )}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="state"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        State
                                    </FormLabel>
                                    <Select
                                        value={field.value || undefined}
                                        onValueChange={(v) => {
                                            field.onChange(v);
                                            // Clear district when state changes — old district may not belong to the new state.
                                            form.setValue("district", "", { shouldValidate: true, shouldDirty: true });
                                        }}
                                    >
                                        <FormControl>
                                            <SelectTrigger className={cn(
                                                "h-11 border border-primary/30 text-sm",
                                                "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100"
                                            )}>
                                                <SelectValue placeholder="Select State" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {INDIA_STATES.map((s) => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="district"
                            render={({ field }) => {
                                const selectedState = form.watch("state");
                                const districts = getDistrictsForState(selectedState);
                                return (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            District
                                        </FormLabel>
                                        <Select
                                            value={field.value || undefined}
                                            onValueChange={field.onChange}
                                            disabled={!selectedState}
                                        >
                                            <FormControl>
                                                <SelectTrigger className={cn(
                                                    "h-11 border border-primary/30 text-sm",
                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100"
                                                )}>
                                                    <SelectValue placeholder={selectedState ? "Select District" : "Select a state first"} />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {districts.map((d) => (
                                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                );
                            }}
                        />

                        <FormField
                            control={form.control}
                            name="branchStartDate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch Started Date
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput
                                                {...field}
                                                value={field.value ?? ""}
                                                className={cn(
                                                    "h-11 w-full border border-primary/30 pr-9 text-sm font-medium",
                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                    "transition-all duration-200"
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
                            name="eodStartDate"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch Started Working Date <span className="text-slate-400 font-normal">(EOD start day)</span>
                                        {!initialData && <span className="text-red-500"> *</span>}
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput
                                                {...field}
                                                // When locked with nothing on record, show the derived date directly in the
                                                // field for visibility — purely a display override (never fed through
                                                // field.onChange), so the actual form state driving Save stays untouched
                                                // and a locked branch's other edits can never accidentally re-trigger the
                                                // "cannot be changed once an EOD has been completed" guard server-side.
                                                value={
                                                    eodStartDateLocked && !field.value && initialData?.derivedEodStartDate
                                                        ? toDateStr(initialData.derivedEodStartDate)
                                                        : field.value ?? ""
                                                }
                                                readOnly={eodStartDateLocked}
                                                disabled={eodStartDateLocked}
                                                title={eodStartDateLocked ? "Locked — this branch has already completed an EOD, so it can no longer be changed" : undefined}
                                                className={cn(
                                                    "h-11 w-full border border-primary/30 pr-9 text-sm font-medium",
                                                    eodStartDateLocked
                                                        ? "bg-brand-green-tint dark:bg-sidebar-accent cursor-not-allowed opacity-70"
                                                        : "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                    "transition-all duration-200"
                                                )}
                                            />
                                        </div>
                                    </FormControl>
                                    {!field.value && initialData?.derivedEodStartDate && (
                                        <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                            {eodStartDateLocked ? (
                                                'No date was ever recorded — shown above is the earliest activity found for this branch. It cannot be edited now since an EOD has already been closed.'
                                            ) : (
                                                <>
                                                    No date on record — earliest activity found for this branch was{' '}
                                                    <span className="font-semibold">{toDateStr(initialData.derivedEodStartDate)}</span>.{' '}
                                                    <button
                                                        type="button"
                                                        className="font-semibold text-primary underline underline-offset-2 hover:opacity-80"
                                                        onClick={() => field.onChange(toDateStr(initialData.derivedEodStartDate))}
                                                    >
                                                        Use this date
                                                    </button>
                                                </>
                                            )}
                                        </p>
                                    )}
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="isActive"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Status
                                    </FormLabel>
                                    <Select
                                        value={field.value === false ? "inactive" : "active"}
                                        onValueChange={(v) => field.onChange(v === "active")}
                                    >
                                        <FormControl>
                                            <SelectTrigger className={cn(
                                                "h-11 border border-primary/30 text-sm",
                                                "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100"
                                            )}>
                                                <SelectValue placeholder="Select Status" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>

                    {/* Location Section */}
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2">
                            Location
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleLocateBranch}
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
                        biasLat={hasValidMapCoords ? mapLat : undefined}
                        biasLng={hasValidMapCoords ? mapLng : undefined}
                    />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField
                                control={form.control}
                                name="latitude"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Latitude
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                placeholder="e.g. 10.362400"
                                                {...field}
                                                className={cn(
                                                    "h-11 w-full border border-primary/30 text-sm font-medium",
                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                    "transition-all duration-200"
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
                                            Longitude
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="text"
                                                inputMode="decimal"
                                                placeholder="e.g. 77.969500"
                                                {...field}
                                                className={cn(
                                                    "h-11 w-full border border-primary/30 text-sm font-medium",
                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                    "transition-all duration-200"
                                                )}
                                            />
                                        </FormControl>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Read-only preview of the entered coordinates — hidden while the picker
                            dialog is open so two Leaflet maps aren't mounted at once. */}
                        {hasValidMapCoords && !isMapOpen ? (
                            <MapComponent
                                latitude={mapLat}
                                longitude={mapLng}
                                centerName={form.watch("name") || "New Branch"}
                                centerCode={form.watch("code") || ""}
                                address={form.watch("address") || undefined}
                                heightClassName="h-64"
                            />
                        ) : (
                            !hasValidMapCoords && (
                                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-primary/30 text-sm text-sidebar-accent dark:text-slate-400">
                                    <MapPin className="h-4 w-4 mr-2" />
                                    Enter latitude/longitude or select on map to preview the location
                                </div>
                            )
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    {initialData ? "Updating..." : "Creating..."}
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    {initialData ? "Update Branch" : "Create Branch"}
                                </>
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => form.reset(initialData ? {
                                name: initialData.name,
                                code: initialData.code,
                                address: initialData.address || undefined,
                                state: initialData.state || undefined,
                                district: initialData.district || undefined,
                                branchStartDate: toDateStr(initialData.branchStartDate),
                                eodStartDate: toDateStr(initialData.eodStartDate),
                                isActive: initialData.isActive ?? true,
                                latitude: initialData.latitude != null ? String(initialData.latitude) : "",
                                longitude: initialData.longitude != null ? String(initialData.longitude) : "",
                                areaId: initialData.areas?.[0]?.id || null,
                            } : {
                                name: "",
                                code: "",
                                address: "",
                                state: "",
                                district: "",
                                branchStartDate: "",
                                eodStartDate: "",
                                isActive: true,
                                latitude: "",
                                longitude: "",
                                areaId: null,
                            })}
                            disabled={isLoading}
                            className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
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
                            Select Branch Location
                        </DialogTitle>
                        <DialogDescription>
                            Search for a place, click anywhere on the map, or drag the marker to set the branch&apos;s latitude and longitude.
                        </DialogDescription>
                    </DialogHeader>
                    <MapComponent
                        latitude={Number.isFinite(mapLat) ? mapLat : DEFAULT_MAP_LAT}
                        longitude={Number.isFinite(mapLng) ? mapLng : DEFAULT_MAP_LNG}
                        centerName={form.watch("name") || "New Branch"}
                        centerCode={form.watch("code") || ""}
                        address={form.watch("address") || undefined}
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
                                <Building2 className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                    {initialData ? "Edit Branch Details" : "Branch Creation"}
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    {initialData
                                        ? "Update branch information and details."
                                        : "Create and manage branch profiles with name, ID, and address."}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Form Section */}
                <div className="px-4 sm:px-8 py-6">
                    {formContent}
                </div>
            </div>
        </div>
    );
}
