"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { UserX, Save, RotateCcw, User, Calendar, FileText, Briefcase, Building2 } from "lucide-react";

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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DateInput } from '@/components/ui/date-input';

const relieveEmployeeSchema = z.object({
    employeeName: z.string().min(1, "Employee name is required"),
    dateOfJoin: z.string().min(1, "Date of join is required"),
    designation: z.string().min(1, "Designation is required"),
    centers: z.string().min(1, "Centers is required"),
    reason: z.string().min(1, "Reason is required"),
});

type RelieveEmployeeFormData = z.infer<typeof relieveEmployeeSchema>;

interface RelieveEmployeeFormProps {
    initialData?: Partial<RelieveEmployeeFormData>;
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

export function RelieveEmployeeForm({
    initialData,
    onSuccess,
    variant = "default",
}: RelieveEmployeeFormProps) {
    const { toast } = useToast();
    const form = useForm<RelieveEmployeeFormData>({
        resolver: zodResolver(relieveEmployeeSchema),
        defaultValues: initialData || {
            employeeName: "",
            dateOfJoin: "",
            designation: "",
            centers: "",
            reason: "",
        },
    });

    function onSubmit(values: RelieveEmployeeFormData) {
        console.log("Relieve Employee:", values);
        // TODO: Handle API submission
        toast({
            title: "Employee Relieved Successfully",
            description: `${values.employeeName} has been relieved from service.`,
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
                aria-label="Relieve employee form"
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

                    {/* Date of Join */}
                    <FormField
                        control={form.control}
                        name="dateOfJoin"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-primary dark:text-primary" />
                                    Date of Join
                                </FormLabel>
                                <FormControl>
                                    <DateInput
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

                    {/* Designation */}
                    <FormField
                        control={form.control}
                        name="designation"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <Briefcase className="h-4 w-4 text-primary dark:text-primary" />
                                    Designation
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        placeholder="Enter designation"
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

                    {/* Reason */}
                    <FormField
                        control={form.control}
                        name="reason"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-primary dark:text-primary" />
                                    Reason
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        placeholder="Enter reason for relieving"
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

                    {/* Centers */}
                    <FormField
                        control={form.control}
                        name="centers"
                        render={({ field }) => (
                            <FormItem className="md:col-span-2">
                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-primary dark:text-primary" />
                                    Centers
                                </FormLabel>
                                <FormControl>
                                    <Textarea
                                        placeholder="Enter center details"
                                        rows={4}
                                        {...field}
                                        className={cn(
                                            "w-full border border-primary/30 text-sm font-medium resize-y",
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

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        type="submit"
                        className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm transition-all duration-200 hover:shadow-md"
                    >
                        <Save className="h-4 w-4 mr-2" />
                        Relieve
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
                                <UserX className="h-6 w-6 text-white" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                    Relieve Employee
                                </h1>
                                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                    Relieve employees from service with proper documentation and records.
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

