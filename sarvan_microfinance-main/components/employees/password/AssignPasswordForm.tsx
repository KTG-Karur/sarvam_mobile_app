"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { KeyRound, Save, RotateCcw, User, Lock, LockKeyhole } from "lucide-react";

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

// Password validation schema
const passwordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

const assignPasswordSchema = z
    .object({
        employeeName: z.string().min(1, "Employee name is required"),
        username: z.string().min(1, "Username is required"),
        newPassword: passwordSchema,
        retypePassword: z.string().min(1, "Please retype your password"),
    })
    .refine((data) => data.newPassword === data.retypePassword, {
        message: "Passwords do not match",
        path: ["retypePassword"],
    });

type AssignPasswordFormData = z.infer<typeof assignPasswordSchema>;

interface AssignPasswordFormProps {
    initialData?: Partial<AssignPasswordFormData>;
    onSuccess?: () => void;
    variant?: "default" | "compact";
}

// Mock employee data - in production, this would come from an API
const mockEmployees = [
    { id: "0.2", name: "ACCOUNTANT" },
    { id: "1.4", name: "VIJAYAKUMAR BM" },
    { id: "3.9", name: "BM" },
    { id: "2.17", name: "YUVARAJ" },
    { id: "1.21", name: "AREA MANAGER" },
    { id: "1.24", name: "MANIKANDAN E" },
    { id: "4.25", name: "BM-TRICHY" },
    { id: "4.26", name: "FDO-TRY" },
];

export function AssignPasswordForm({
    initialData,
    onSuccess,
    variant = "default",
}: AssignPasswordFormProps) {
    const { toast } = useToast();
    const form = useForm<AssignPasswordFormData>({
        resolver: zodResolver(assignPasswordSchema),
        defaultValues: initialData || {
            employeeName: "",
            username: "",
            newPassword: "",
            retypePassword: "",
        },
    });

    const watchedPassword = form.watch("newPassword");

    function onSubmit(values: AssignPasswordFormData) {
        console.log("Assign Password:", values);
        // TODO: Handle API submission
        toast({
            title: "Password Assigned Successfully",
            description: `Password has been assigned to ${values.employeeName}.`,
        });
        if (onSuccess) onSuccess();
    }

    function handleReset() {
        form.reset();
        toast({
            title: "Form Reset",
            description: "All form fields have been cleared.",
        });
    }

    const isCompact = variant === "compact";

    const formContent = (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex flex-col gap-6"
                aria-label="Assign password form"
            >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Employee Name */}
                    <FormField
                        control={form.control}
                        name="employeeName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <User className="h-4 w-4 text-primary dark:text-primary" />
                                    Employee Name
                                </FormLabel>
                                <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
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
                                            <SelectValue placeholder="-- SELECT --" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {mockEmployees.map((employee) => (
                                            <SelectItem
                                                key={employee.id}
                                                value={employee.name}
                                            >
                                                {employee.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage className="text-xs" />
                            </FormItem>
                        )}
                    />

                    {/* Username */}
                    <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <User className="h-4 w-4 text-primary dark:text-primary" />
                                    Username
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        placeholder="Enter username"
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
                        <ul className="space-y-1.5 text-xs text-sidebar-accent dark:text-slate-400">
                            <li
                                className={cn(
                                    "flex items-center gap-2",
                                    watchedPassword.length >= 8
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : ""
                                )}
                            >
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        watchedPassword.length >= 8
                                            ? "bg-emerald-600 dark:bg-emerald-400"
                                            : "bg-slate-400"
                                    )}
                                />
                                At least 8 characters long
                            </li>
                            <li
                                className={cn(
                                    "flex items-center gap-2",
                                    /[A-Z]/.test(watchedPassword)
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : ""
                                )}
                            >
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        /[A-Z]/.test(watchedPassword)
                                            ? "bg-emerald-600 dark:bg-emerald-400"
                                            : "bg-slate-400"
                                    )}
                                />
                                One uppercase letter
                            </li>
                            <li
                                className={cn(
                                    "flex items-center gap-2",
                                    /[a-z]/.test(watchedPassword)
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : ""
                                )}
                            >
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        /[a-z]/.test(watchedPassword)
                                            ? "bg-emerald-600 dark:bg-emerald-400"
                                            : "bg-slate-400"
                                    )}
                                />
                                One lowercase letter
                            </li>
                            <li
                                className={cn(
                                    "flex items-center gap-2",
                                    /[0-9]/.test(watchedPassword)
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : ""
                                )}
                            >
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        /[0-9]/.test(watchedPassword)
                                            ? "bg-emerald-600 dark:bg-emerald-400"
                                            : "bg-slate-400"
                                    )}
                                />
                                One numeric character
                            </li>
                            <li
                                className={cn(
                                    "flex items-center gap-2",
                                    /[^A-Za-z0-9]/.test(watchedPassword)
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : ""
                                )}
                            >
                                <span
                                    className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        /[^A-Za-z0-9]/.test(watchedPassword)
                                            ? "bg-emerald-600 dark:bg-emerald-400"
                                            : "bg-slate-400"
                                    )}
                                />
                                One special character
                            </li>
                        </ul>
                    </div>
                )}

                {/* Password Validation Helper Text */}
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                        <span className="font-semibold">*</span> Password must have one Upper case, one Lower case, one Symbol, one Numeric character with 8 characters length above.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        type="submit"
                        className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm transition-all duration-200 hover:shadow-md"
                    >
                        <Save className="h-4 w-4 mr-2" />
                        Save Password
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleReset}
                        className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30 transition-all duration-200"
                    >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reset
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
                                    Assign Password
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    Assign secure passwords to employees with strong authentication requirements.
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

