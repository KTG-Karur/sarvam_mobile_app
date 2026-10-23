"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { KeyRound, Save, RotateCcw, User, Lock, LockKeyhole, Loader2, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
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
import { tokenStorage } from "@/app/lib/token-storage";
import { Skeleton } from "@/components/ui/skeleton";

// --- Types ---
type User = {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    employeeId?: string | null;
    branchId?: string | null;
};

// --- Validation Schemas ---
const passwordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

const resetPasswordSchema = z
    .object({
        employeeId: z.string().min(1, "Please select an employee"),
        newPassword: passwordSchema,
        retypePassword: z.string().min(1, "Please retype your password"),
    })
    .refine((data) => data.newPassword === data.retypePassword, {
        message: "Passwords do not match",
        path: ["retypePassword"],
    });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

interface ResetPasswordFormProps {
    variant?: "default" | "compact";
}

export function ResetPasswordForm({ variant = "default" }: ResetPasswordFormProps) {
    const { toast } = useToast();
    const [employees, setEmployees] = useState<User[]>([]);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isMounted, setIsMounted] = useState(false);

    // Get current user to handle auto-selection early
    const currentUser = typeof window !== 'undefined' ? tokenStorage.getUser() : null;
    const isAdmin = currentUser?.role === 'ADMIN';

    // Form setup - moved to top
    const form = useForm<ResetPasswordFormData>({
        resolver: zodResolver(resetPasswordSchema),
        defaultValues: {
            employeeId: (!isAdmin && currentUser?.id) ? currentUser.id : "",
            newPassword: "",
            retypePassword: "",
        },
    });

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Fetch Employees
    useEffect(() => {
        const fetchEmployees = async () => {
            if (!isMounted) return;
            setIsLoadingEmployees(true);
            try {
                // /users caps pageSize at 50 — walk every page so employees beyond
                // the first 50 still appear in the dropdown.
                const result = await apiClient.get<{ users: User[]; totalPages: number }>("/users?isActive=true&pageSize=50&page=1");

                if (result.success && result.data) {
                    const users = [...result.data.users];
                    for (let page = 2; page <= (result.data.totalPages ?? 1); page++) {
                        const next = await apiClient.get<{ users: User[] }>(`/users?isActive=true&pageSize=50&page=${page}`);
                        if (next.success && next.data) users.push(...next.data.users);
                    }
                    const storedUser = tokenStorage.getUser();
                    if (storedUser?.role === 'ADMIN') {
                        setEmployees(users);
                    } else if (storedUser?.id) {
                        // Securely constrain non-admins to themselves
                        const selfEmp = users.find(emp => emp.id === storedUser.id);
                        if (selfEmp) {
                            setEmployees([selfEmp]);
                        } else {
                            // Fallback if backend doesn't return them
                            setEmployees([{
                                id: storedUser.id,
                                firstName: storedUser.firstName || "My",
                                lastName: storedUser.lastName || "Account",
                                role: storedUser.role || "USER"
                            }]);
                        }
                        // Ensure selection is synced
                        form.setValue("employeeId", storedUser.id);
                    } else {
                        setEmployees([]);
                    }
                } else {
                    console.error("Failed to load employees:", result.error);
                    toast({
                        title: "Warning",
                        description: "Could not load employee list. Please try refreshing.",
                        variant: "destructive",
                    });
                }
            } catch (error) {
                console.error("Error fetching employees:", error);
                toast({
                    title: "Error",
                    description: "An unexpected error occurred while loading employees.",
                    variant: "destructive",
                });
            } finally {
                setIsLoadingEmployees(false);
            }
        };

        fetchEmployees();
    }, [isMounted, toast, form]);

    // Ensure selection stays locked for non-admins
    useEffect(() => {
        if (!isAdmin && currentUser?.id) {
            form.setValue("employeeId", currentUser.id);
        }
    }, [employees, isAdmin, currentUser, form]);

    const watchedPassword = form.watch("newPassword");

    // Form Submission
    async function onSubmit(values: ResetPasswordFormData) {
        setIsSaving(true);
        try {
            const result = await apiClient.post(`/users/${values.employeeId}/reset-password`, {
                newPassword: values.newPassword,
            });

            if (result.success) {
                toast({
                    title: "Password Reset Successful",
                    description: "The employee's password has been updated securely.",
                });
                form.reset();
            } else {
                toast({
                    title: "Reset Failed",
                    description: result.error || "Could not reset password. Please try again.",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Submission Error:", error);
            toast({
                title: "Error",
                description: "An unexpected error occurred. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    }

    function handleReset() {
        form.reset();
    }

    const isCompact = variant === "compact";

    // --- Loading State ---
    if (!isMounted) return null;

    const formContent = (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex flex-col gap-6"
                aria-label="Reset password form"
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Employee Selection */}
                    <div className="md:col-span-2">
                        <FormField
                            control={form.control}
                            name="employeeId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                        <User className="h-4 w-4 text-primary dark:text-primary" />
                                        Select Employee
                                    </FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value}
                                        disabled={isLoadingEmployees || !isAdmin}
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
                                                <SelectValue placeholder={isLoadingEmployees ? "Loading employees..." : "-- Select Employee --"} />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {employees.map((employee) => (
                                                <SelectItem
                                                    key={employee.id}
                                                    value={employee.id}
                                                >
                                                    {employee.employeeId ? `${employee.employeeId} - ` : ''}{employee.firstName} {employee.lastName} ({employee.role})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                    </div>

                    {/* New Password */}
                    <FormField
                        control={form.control}
                        name="newPassword"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <Lock className="h-4 w-4 text-primary dark:text-primary" />
                                    New Password
                                </FormLabel>
                                <FormControl>
                                    <PasswordInput
                                        placeholder="Enter new password"
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

                    {/* Retype Password */}
                    <FormField
                        control={form.control}
                        name="retypePassword"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <LockKeyhole className="h-4 w-4 text-primary dark:text-primary" />
                                    Retype Password
                                </FormLabel>
                                <FormControl>
                                    <PasswordInput
                                        placeholder="Retype password"
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

                {/* Password Requirements */}
                {watchedPassword && (
                    <div className="rounded-lg border border-primary/20 bg-green-50/50 p-4 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <p className="text-xs font-semibold text-sidebar-accent dark:text-slate-300 mb-2">
                            Password Requirements:
                        </p>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-sidebar-accent dark:text-slate-400">
                            <li className={cn("flex items-center gap-2", watchedPassword.length >= 8 ? "text-emerald-600 dark:text-emerald-400" : "")}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", watchedPassword.length >= 8 ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400")} />
                                At least 8 characters long
                            </li>
                            <li className={cn("flex items-center gap-2", /[A-Z]/.test(watchedPassword) ? "text-emerald-600 dark:text-emerald-400" : "")}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", /[A-Z]/.test(watchedPassword) ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400")} />
                                One uppercase letter
                            </li>
                            <li className={cn("flex items-center gap-2", /[a-z]/.test(watchedPassword) ? "text-emerald-600 dark:text-emerald-400" : "")}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", /[a-z]/.test(watchedPassword) ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400")} />
                                One lowercase letter
                            </li>
                            <li className={cn("flex items-center gap-2", /[0-9]/.test(watchedPassword) ? "text-emerald-600 dark:text-emerald-400" : "")}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", /[0-9]/.test(watchedPassword) ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400")} />
                                One numeric character
                            </li>
                            <li className={cn("flex items-center gap-2", /[^A-Za-z0-9]/.test(watchedPassword) ? "text-emerald-600 dark:text-emerald-400" : "")}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", /[^A-Za-z0-9]/.test(watchedPassword) ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400")} />
                                One special character
                            </li>
                        </ul>
                    </div>
                )}

                {/* Password Validation Helper Text */}
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-start gap-2">
                        <AlertCircle className="size-4 shrink-0 mt-0.5" />
                        <span>This action will force a password change for the selected user. They must use the new password for their next login.</span>
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        type="submit"
                        disabled={isSaving}
                        className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm transition-all duration-200 hover:shadow-md"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 mr-2" />
                                Reset Password
                            </>
                        )}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleReset}
                        disabled={isSaving}
                        className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all duration-200"
                    >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reset Form
                    </Button>
                </div>
            </form>
        </Form>
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
                                <KeyRound className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                    Reset Password
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    Reset employee passwords securely. No old password required for admins.
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
