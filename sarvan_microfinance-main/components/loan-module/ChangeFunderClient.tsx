'use client';

import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    ArrowLeftRight,
    RotateCcw,
    Loader2,
    Wallet,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';

type Funder = {
    id: string;
    funderId: string;
    funderName: string;
};

// Validation schema
const changeFunderSchema = z.object({
    existFunder: z.string().min(1, 'Existing funder is required'),
    changeFunder: z.string().min(1, 'New funder is required'),
}).refine((data) => data.existFunder !== data.changeFunder, {
    message: 'New funder must be different from existing funder',
    path: ['changeFunder'],
});

type ChangeFunderFormValues = z.infer<typeof changeFunderSchema>;

export function ChangeFunderClient() {
    const { canPage } = usePermission();
    const canEditLoan = canPage('/dashboard/loan-module/change-funder', 'edit');
    const { toast } = useToast();
    const [funders, setFunders] = useState<Funder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<ChangeFunderFormValues>({
        resolver: zodResolver(changeFunderSchema),
        defaultValues: {
            existFunder: '',
            changeFunder: '',
        },
    });

    const existFunderId = form.watch('existFunder');

    // Fetch funders on component mount
    useEffect(() => {
        fetchFunders();
    }, []);

    // Filter out the selected existing funder from the change funder dropdown
    const availableFunders = funders.filter((funder) => funder.id !== existFunderId);

    const fetchFunders = async () => {
        setIsLoading(true);
        try {
            // TODO: Replace with actual API endpoint when available
            // Example: const result = await apiClient.get<Funder[]>('/funders?includeInactive=false');

            // Mock data for demonstration
            const mockFunders: Funder[] = [
                { id: '1', funderId: '1001', funderName: 'OWN FUND' },
                { id: '2', funderId: '1002', funderName: 'BANK OF INDIA' },
                { id: '3', funderId: '1003', funderName: 'STATE BANK OF INDIA' },
                { id: '4', funderId: '1004', funderName: 'HDFC BANK' },
                { id: '5', funderId: '1005', funderName: 'ICICI BANK' },
            ];

            await new Promise((resolve) => setTimeout(resolve, 500));
            setFunders(mockFunders);
        } catch (error) {
            console.error('Error fetching funders:', error);
            toast({
                title: 'Error',
                description: 'Failed to load funders. Please try again.',
                variant: 'destructive',
            });
            setFunders([]);
        } finally {
            setIsLoading(false);
        }
    };

    const onSubmit = async (values: ChangeFunderFormValues) => {
        setIsSubmitting(true);
        try {
            const existFunder = funders.find((f) => f.id === values.existFunder);
            const newFunder = funders.find((f) => f.id === values.changeFunder);

            if (!existFunder || !newFunder) {
                toast({
                    title: 'Error',
                    description: 'Invalid funder selection.',
                    variant: 'destructive',
                });
                setIsSubmitting(false);
                return;
            }

            // TODO: Replace with actual API call to change funder
            // Example: await apiClient.patch('/loans/change-funder', {
            //     fromFunderId: values.existFunder,
            //     toFunderId: values.changeFunder,
            // });
            await new Promise((resolve) => setTimeout(resolve, 1500));

            toast({
                title: 'Success',
                description: `Funder changed from "${existFunder.funderName}" to "${newFunder.funderName}" successfully.`,
            });

            handleReset();
        } catch (error) {
            console.error('Error changing funder:', error);
            toast({
                title: 'Error',
                description: 'Failed to change funder. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        form.reset({
            existFunder: '',
            changeFunder: '',
        });
        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Change Funder
                </h1>
                <p className="text-muted-foreground">
                    Change the funder for existing loans
                </p>
            </div>

            {/* Main Form Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <ArrowLeftRight className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Change Funder Details</CardTitle>
                            <CardDescription>
                                Select existing funder and new funder to transfer loans
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {isLoading ? (
                                <PageLoader label="Loading funders..." fullScreen={false} />
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Exist Funder */}
                                        <FormField
                                            control={form.control}
                                            name="existFunder"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Exist Funder
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={(value) => {
                                                            field.onChange(value);
                                                            // Reset change funder when exist funder changes
                                                            form.setValue('changeFunder', '');
                                                        }}
                                                        value={field.value}
                                                        disabled={funders.length === 0}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-11 w-full">
                                                                <SelectValue placeholder="-- SELECT --" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {funders.length === 0 ? (
                                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                    No funders available
                                                                </div>
                                                            ) : (
                                                                funders.map((funder) => (
                                                                    <SelectItem key={funder.id} value={funder.id}>
                                                                        {funder.funderName}
                                                                    </SelectItem>
                                                                ))
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Change Funder */}
                                        <FormField
                                            control={form.control}
                                            name="changeFunder"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-sm font-medium">
                                                        Change Funder
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={field.onChange}
                                                        value={field.value}
                                                        disabled={!existFunderId || availableFunders.length === 0}
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="h-11 w-full">
                                                                <SelectValue placeholder="-- SELECT --" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {!existFunderId ? (
                                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                    Please select existing funder first
                                                                </div>
                                                            ) : availableFunders.length === 0 ? (
                                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                                                    No other funders available
                                                                </div>
                                                            ) : (
                                                                availableFunders.map((funder) => (
                                                                    <SelectItem key={funder.id} value={funder.id}>
                                                                        {funder.funderName}
                                                                    </SelectItem>
                                                                ))
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex flex-wrap gap-3 pt-4">
                                        <Button
                                            type="submit"
                                            disabled={!canEditLoan || isSubmitting || !form.formState.isValid}
                                            className="flex-1 min-w-[120px] bg-primary hover:bg-primary text-white"
                                            size="lg"
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    Changing...
                                                </>
                                            ) : (
                                                <>
                                                    <ArrowLeftRight className="mr-2 h-4 w-4" />
                                                    Change
                                                </>
                                            )}
                                        </Button>

                                        <Button
                                            type="button"
                                            onClick={handleReset}
                                            disabled={isSubmitting}
                                            variant="destructive"
                                            className="flex-1 min-w-[120px]"
                                            size="lg"
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Reset
                                        </Button>
                                    </div>
                                </>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>

            {/* Empty State */}
            {!isLoading && funders.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <Wallet className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Funders Found</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            There are no funders available. Please create a funder first.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

