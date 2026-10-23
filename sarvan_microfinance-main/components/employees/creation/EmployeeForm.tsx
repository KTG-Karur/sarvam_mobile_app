"use client";

import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { UserPlus, Save, RotateCcw, Loader2 } from "lucide-react";

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
import { PasswordInput } from "@/components/ui/password-input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/app/lib/api-client";
import { UserRole } from "@/app/types";
import { AmBranchMultiSelect } from "@/components/employees/creation/AmBranchMultiSelect";
import { FIELD_PATTERNS, FIELD_ERROR_MESSAGES } from "@/app/lib/hr/onboarding-form-fields";
import { filterDigits } from "@/app/lib/hr/onboarding-validation-rules";

// ── RBAC role type ────────────────────────────────────────────────────────────
interface RbacRole {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    color?: string | null;
    /** Base system UserRole enum this role maps to. Comes from Role.legacyRole in the DB. */
    legacyRole?: UserRole | null;
}

/**
 * Derive the legacy UserRole enum from an RbacRole.
 * Uses the `legacyRole` field added to the Role model (preferred path).
 * Falls back to a slug-based map for safety (e.g. while using FALLBACK_ROLES
 * which don't have a legacyRole field).
 */
/**
 * Derive the legacy UserRole enum from an RbacRole.
 * Uses the `legacyRole` field from the DB record (preferred).
 * Falls back to the authoritative slug map for all system roles.
 * Default: 'FDO' (most-restricted system role) for unknown custom roles.
 */
function getLegacyRole(role: RbacRole | undefined): UserRole {
    if (!role) return 'FDO';

    // Authoritative slug map — matches the server-side SYSTEM_SLUG_TO_ROLE map
    // in /api/users/route.ts. Both must stay in sync.
    const SLUG_MAP: Record<string, UserRole> = {
        'admin':             'ADMIN',
        'area-manager':      'AREA_MANAGER',
        'branch-manager':    'BRANCH_MANAGER',
        'fdo':               'FDO',
        'division-manager':  'DIVISION_MANAGER',
        'quality-checkers':  'QC',
    };

    // Slug map takes priority over legacyRole for system roles (guards against
    // stale "FDO" DB default on roles seeded without an explicit legacyRole).
    if (SLUG_MAP[role.slug]) return SLUG_MAP[role.slug];

    // Custom roles: trust the legacyRole computed by computeRoleCode() at creation
    if (role.legacyRole) return role.legacyRole;

    return 'FDO';
}

// Hardcoded fallback roles shown when /api/roles is unavailable
const FALLBACK_ROLES: RbacRole[] = [
    { id: 'admin',             name: 'Admin',                       slug: 'admin',             color: '#ef4444', legacyRole: 'ADMIN' },
    { id: 'branch-manager',    name: 'Branch Manager',              slug: 'branch-manager',    color: '#3b82f6', legacyRole: 'BRANCH_MANAGER' },
    { id: 'area-manager',      name: 'Area Manager',                slug: 'area-manager',      color: '#8b5cf6', legacyRole: 'AREA_MANAGER' },
    { id: 'division-manager',  name: 'Division Manager',            slug: 'division-manager',  color: '#f59e0b', legacyRole: 'DIVISION_MANAGER' },
    { id: 'fdo',               name: 'Field Development Officer',   slug: 'fdo',               color: '#22c55e', legacyRole: 'FDO' },
    { id: 'quality-checkers',  name: 'Quality Checkers',            slug: 'quality-checkers',  color: '#0d9488', legacyRole: 'QC' },
];

const userSchema = z.object({
    mobileNumber: z.string()
        .min(1, "Mobile number is required")
        .regex(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.MOBILE),
    email: z.union([
        z.string().regex(FIELD_PATTERNS.EMAIL, FIELD_ERROR_MESSAGES.EMAIL),
        z.literal("")
    ]).optional(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().optional(),
    // roleSlug holds the RBAC role slug (or legacy role value from fallback)
    roleSlug: z.string().min(1, "Role is required"),
    rbacRoleId: z.string().optional(),
    branchId: z.string().optional().nullable(),
});

interface Branch {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    isActive?: boolean;
}

interface UserFormData {
    mobileNumber?: string;
    email?: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    branchId?: string | null;
}

interface EmployeeFormProps {
    initialData?: UserFormData;
    onSuccess?: () => void;
    variant?: "default" | "compact";
}
export function EmployeeForm({ initialData, onSuccess, variant = "default" }: EmployeeFormProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(true);
    const [rbacRoles, setRbacRoles] = useState<RbacRole[]>(FALLBACK_ROLES);
    const [isLoadingRoles, setIsLoadingRoles] = useState(true);

    // AM-specific multi-branch state (managed outside react-hook-form for flexibility)
    const [amSelectedBranchIds, setAmSelectedBranchIds] = useState<string[]>([]);
    const [amPrimaryBranchId, setAmPrimaryBranchId] = useState<string | null>(null);

    const form = useForm<z.infer<typeof userSchema>>({
        resolver: zodResolver(userSchema),
        defaultValues: {
            mobileNumber: initialData?.mobileNumber ?? "",
            email: initialData?.email ?? "",
            password: "",
            firstName: initialData?.firstName ?? "",
            lastName: initialData?.lastName ?? "",
            // Empty string — user must explicitly select a role; no default pre-selection
            roleSlug: "",
            rbacRoleId: undefined,
            branchId: initialData?.branchId ?? null,
        },
    });

    // Fetch RBAC roles on mount
    useEffect(() => {
        const fetchRoles = async () => {
            try {
                const res = await fetch('/api/roles');
                if (res.ok) {
                    const data = await res.json();
                    const roles = data.data || data.roles;
                    if (data.success && Array.isArray(roles) && roles.length > 0) {
                        setRbacRoles(roles);
                    }
                }
            } catch {
                // Non-fatal — fallback roles are already set
            } finally {
                setIsLoadingRoles(false);
            }
        };
        fetchRoles();
    }, []);

    // Fetch branches on mount — show ALL active branches
    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const result = await apiClient.get<Branch[]>("/branches");
                if (result.success && result.data) {
                    setBranches(result.data.filter((b) => b.isActive !== false));
                }
            } catch (error) {
                console.error("Error fetching branches:", error);
                toast({
                    title: "Error",
                    description: "Failed to load branches",
                    variant: "destructive",
                });
            } finally {
                setIsLoadingBranches(false);
            }
        };

        fetchBranches();
    }, [toast]);

    async function onSubmit(values: z.infer<typeof userSchema>) {
        setIsLoading(true);

        try {
            // Find the matching RBAC role record; use its legacyRole to set user.role.
            const matchedRbacRole = rbacRoles.find(
                (r) => r.slug === values.roleSlug || r.id === values.roleSlug
            );
            const rbacRoleId = matchedRbacRole?.id ?? values.rbacRoleId;

            // Resolve legacy UserRole: prefer role.legacyRole (from DB), fall back to slug map.
            const legacyRole: UserRole = getLegacyRole(matchedRbacRole);
            const isAreaManager = legacyRole === 'AREA_MANAGER';

            if (isAreaManager && amSelectedBranchIds.length === 0) {
                toast({
                    title: "Branch Assignment Required",
                    description: "Please assign at least one branch to the Area Manager.",
                    variant: "destructive",
                });
                setIsLoading(false);
                return;
            }

            // Do NOT send `role` in the payload — the server derives effectiveRole
            // from rbacRoleId.legacyRole (DB lookup). Sending it caused the
            // client-side getLegacyRole fallback to always default to "FDO".
            const payload = isAreaManager
                ? {
                      mobileNumber: values.mobileNumber.trim(),
                      email: values.email?.trim() || undefined,
                      password: values.password,
                      firstName: values.firstName.trim(),
                      lastName: (values.lastName || '').trim(),
                      branchId: null, // Always null for AM — junction table is authoritative
                      assignedBranchIds: amSelectedBranchIds,
                      primaryBranchId: amPrimaryBranchId ?? amSelectedBranchIds[0],
                      rbacRoleId,
                  }
                : {
                      mobileNumber: values.mobileNumber.trim(),
                      email: values.email?.trim() || undefined,
                      password: values.password,
                      firstName: values.firstName.trim(),
                      lastName: (values.lastName || '').trim(),
                      branchId: values.branchId || null,
                      rbacRoleId,
                  };

            const result = await apiClient.post("/users", payload);

            if (!result.success) {
                toast({
                    title: "Error",
                    description: result.error || "Failed to create user",
                    variant: "destructive",
                });
                return;
            }

            toast({
                title: "Success",
                description: "User created successfully",
            });

            // Reset form + AM state
            form.reset({
                mobileNumber: "",
                email: "",
                password: "",
                firstName: "",
                lastName: "",
                roleSlug: "",   // no default — user must select explicitly
                rbacRoleId: undefined,
                branchId: null,
            });
            setAmSelectedBranchIds([]);
            setAmPrimaryBranchId(null);

            if (onSuccess) {
                onSuccess();
            }
        } catch (error) {
            console.error("Error creating user:", error);
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

    const fieldCls = cn(
        "h-11 w-full border border-primary/30 text-sm font-medium",
        "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
        "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
        "aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500/20",
        "transition-all duration-200"
    );

    const formContent = (
        <>
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-6"
                    aria-label="Employee creation form"
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FormField
                            control={form.control}
                            name="mobileNumber"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Mobile Number <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="tel"
                                            inputMode="numeric"
                                            maxLength={10}
                                            placeholder="10-digit mobile number"
                                            {...field}
                                            onChange={(e) => field.onChange(filterDigits(e.target.value, 10))}
                                            className={fieldCls}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Email <span className="text-xs font-normal text-slate-400">(optional)</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="email"
                                            placeholder="user@example.com"
                                            {...field}
                                            className={fieldCls}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Password <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <PasswordInput
                                            placeholder="Enter password (min 8 characters)"
                                            {...field}
                                            className={fieldCls}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="firstName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        First Name <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter first name"
                                            {...field}
                                            className={fieldCls}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="lastName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Last Name
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Enter last name"
                                            {...field}
                                            className={fieldCls}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="roleSlug"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Role <span className="text-red-500">*</span>
                                    </FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value}
                                        disabled={isLoadingRoles}
                                    >
                                        <FormControl>
                                            <SelectTrigger
                                                className={cn(
                                                    "h-11 w-full border border-primary/30 text-sm font-medium",
                                                    "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                    "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                    "transition-all duration-200"
                                                )}
                                            >
                                                <SelectValue placeholder={isLoadingRoles ? "Loading roles..." : "-- SELECT ROLE --"} />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {rbacRoles.map((role) => (
                                                <SelectItem key={role.id} value={role.slug}>
                                                    <span className="flex items-center gap-2">
                                                        {role.color && (
                                                            <span
                                                                className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                                                style={{ backgroundColor: role.color }}
                                                            />
                                                        )}
                                                        {role.name}
                                                    </span>
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
                            name="branchId"
                            render={({ field }) => {
                                const watchedSlug = form.watch('roleSlug');
                                const watchedRole = rbacRoles.find((r) => r.slug === watchedSlug || r.id === watchedSlug);
                                const isAreaManager = getLegacyRole(watchedRole) === 'AREA_MANAGER';

                                if (isAreaManager) {
                                    return (
                                        <FormItem className="col-span-full">
                                            <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                                Assigned Branches{' '}
                                                <span className="text-red-500">*</span>
                                                <span className="ml-1 text-xs font-normal text-slate-500">
                                                    (up to 4, select ★ for primary)
                                                </span>
                                            </FormLabel>
                                            <AmBranchMultiSelect
                                                branches={branches}
                                                selectedIds={amSelectedBranchIds}
                                                primaryId={amPrimaryBranchId}
                                                onChange={(ids, primary) => {
                                                    setAmSelectedBranchIds(ids);
                                                    setAmPrimaryBranchId(primary);
                                                }}
                                                isLoading={isLoadingBranches}
                                                disabled={isLoading}
                                            />
                                        </FormItem>
                                    );
                                }

                                return (
                                    <FormItem>
                                        <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Branch <span className="text-red-500">*</span>
                                        </FormLabel>
                                        <Select
                                            onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                                            value={field.value || "none"}
                                            disabled={isLoadingBranches}
                                        >
                                            <FormControl>
                                                <SelectTrigger
                                                    className={cn(
                                                        "h-11 w-full border border-primary/30 text-sm font-medium",
                                                        "bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                        "dark:bg-brand-green-darker dark:border-sidebar-accent dark:text-slate-100",
                                                        "transition-all duration-200"
                                                    )}
                                                >
                                                    <SelectValue placeholder={isLoadingBranches ? "Loading..." : "-- SELECT BRANCH --"} />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="none">No Branch</SelectItem>
                                                {branches.map((branch) => (
                                                    <SelectItem key={branch.id} value={branch.id}>
                                                        {branch.name} ({branch.code})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                );
                            }}
                        />
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
                                    Creating...
                                </>
                            ) : (
                                <>
                            <Save className="h-4 w-4 mr-2" />
                                    Create User
                                </>
                            )}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => form.reset()}
                            disabled={isLoading}
                            className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                        </Button>
                    </div>
                </form>
            </Form>
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
                                <UserPlus className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                    {initialData ? "Edit Employee Details" : "Employee Creation"}
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    {initialData
                                        ? "Update employee information and personal details."
                                        : "Create and manage employee profiles with personal and professional information."}
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
