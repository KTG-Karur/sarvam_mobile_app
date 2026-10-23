'use client';

import { useState, useEffect, useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Trash2,
    RotateCcw,
    Loader2,
    Wallet,
    CalendarIcon,
    AlertCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type Center = {
    id: string;
    name: string;
    code: string;
    status?: string;
};

type LoanDisbursement = {
    id: string;
    disbursementId: string;
    indexNo: string;
    indexDate: string;
    centerId: string;
    centerCode: string;
    centerName: string;
    funderName: string;
    totalClients: number;
    totalAmount: number;
    disbursalDate: string;
    isSelected?: boolean;
};

// Validation schema
const deleteDisbursementSchema = z.object({
    centerName: z.string().min(1, 'Center name is required'),
});

type DeleteDisbursementFormValues = z.infer<typeof deleteDisbursementSchema>;

export function DeleteDisbursementClient() {
    const { canPage } = usePermission();
    const canDeleteLoan = canPage('/dashboard/loan-module/delete-disbursement', 'delete');
    const { toast } = useToast();
    // Page-local branch filter — does not switch the session-wide active branch.
    const [branchId, setBranchId] = useState<string>(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        return activeBranch?.id || storedUser?.branchId || '';
    });
    const [centers, setCenters] = useState<Center[]>([]);
    const [disbursements, setDisbursements] = useState<LoanDisbursement[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDisbursements, setIsLoadingDisbursements] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [selectAll, setSelectAll] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [workingDate, setWorkingDate] = useState<string>('');

    const form = useForm<DeleteDisbursementFormValues>({
        resolver: zodResolver(deleteDisbursementSchema),
        defaultValues: {
            centerName: '',
        },
    });

    const selectedCenterId = form.watch('centerName');

    const formatDateToInput = (date: Date) => {
        return date.toISOString().split('T')[0];
    };

    const formatDateDisplay = (dateString: string) => {
        const date = new Date(dateString);
        return toDisplayDate(date);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Fetch centers and active date whenever the (page-local) branch changes
    const isFirstBranchLoad = useRef(true);
    useEffect(() => {
        if (!isFirstBranchLoad.current) {
            form.setValue('centerName', '');
            setDisbursements([]);
        }
        isFirstBranchLoad.current = false;
        fetchInitialData(branchId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    // Fetch disbursements when center changes
    useEffect(() => {
        if (selectedCenterId) {
            fetchDisbursements(selectedCenterId);
        } else {
            setDisbursements([]);
        }
    }, [selectedCenterId]);

    // Update select all when individual selections change
    useEffect(() => {
        const allSelected = disbursements.length > 0 && disbursements.every((disb) => disb.isSelected);
        setSelectAll(allSelected);
    }, [disbursements]);

    const fetchInitialData = async (forBranchId: string) => {
        setIsLoading(true);
        try {
            setWorkingDate(formatDateToInput(new Date()));

            if (!forBranchId) {
                toast({
                    title: 'Error',
                    description: 'No branch found. Please select a branch first.',
                    variant: 'destructive',
                });
                setIsLoading(false);
                return;
            }

            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${forBranchId}&includeInactive=false&status=APPROVED`
            );

            if (result.success && result.data) {
                setCenters(result.data.filter((c) => c.status === 'APPROVED'));
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        } catch (error) {
            console.error('Error fetching initial data:', error);
            toast({
                title: 'Error',
                description: 'Failed to load data. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchDisbursements = async (centerId: string) => {
        setIsLoadingDisbursements(true);
        try {
            const result = await apiClient.get<LoanDisbursement[]>(
                `/disbursements/deletable?centerId=${centerId}`
            );

            if (result.success && result.data) {
                setDisbursements(result.data.map((d) => ({ ...d, isSelected: false })));
            } else {
                toast({
                    title: 'Info',
                    description: result.error || 'No pending disbursements found for the selected center.',
                    variant: 'default',
                });
                setDisbursements([]);
            }
        } catch (error) {
            console.error('Error fetching disbursements:', error);
            toast({
                title: 'Error',
                description: 'Failed to load disbursements. Please try again.',
                variant: 'destructive',
            });
            setDisbursements([]);
        } finally {
            setIsLoadingDisbursements(false);
        }
    };

    const handleSelectAll = (checked: boolean) => {
        setSelectAll(checked);
        setDisbursements((prev) =>
            prev.map((disb) => ({ ...disb, isSelected: checked }))
        );
    };

    const handleSelectDisbursement = (disbursementId: string, checked: boolean) => {
        setDisbursements((prev) =>
            prev.map((disb) =>
                disb.id === disbursementId ? { ...disb, isSelected: checked } : disb
            )
        );
    };

    const handleDeleteClick = () => {
        const selectedDisbursements = disbursements.filter((disb) => disb.isSelected);
        if (selectedDisbursements.length === 0) {
            toast({
                title: 'No Selection',
                description: 'Please select at least one disbursement to delete.',
                variant: 'destructive',
            });
            return;
        }
        setDeleteDialogOpen(true);
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const selectedDisbursements = disbursements.filter((disb) => disb.isSelected);
            const indexIds = selectedDisbursements.map((disb) => disb.id);

            const result = await apiClient.post<{ revertedLoans: number; indexIds: string[] }>(
                '/disbursements/delete',
                { indexIds }
            );

            if (!result.success) {
                throw new Error(result.error || 'Failed to delete disbursements');
            }

            toast({
                title: 'Successfully Deleted',
                description: `Successfully disabled/reverted ${result.data?.revertedLoans ?? 0} loan(s) across ${selectedDisbursements.length} batch(es).`,
            });

            // Refresh disbursements
            if (selectedCenterId) {
                await fetchDisbursements(selectedCenterId);
            }
            setDeleteDialogOpen(false);
        } catch (error) {
            console.error('Error deleting disbursements:', error);
            toast({
                title: 'Deletion Error',
                description:
                    error instanceof Error
                        ? error.message
                        : 'Failed to delete disbursements. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReset = () => {
        form.reset({
            centerName: '',
        });
        setDisbursements([]);
        setSelectAll(false);
        toast({
            title: 'Reset Completed',
            description: 'Form has been completely reset to initial state.',
        });
    };

    const selectedCount = disbursements.filter((disb) => disb.isSelected).length;
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(disbursements);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-red-700 to-orange-600 dark:from-red-400 dark:to-orange-400 bg-clip-text text-transparent flex items-center gap-3">
                    Delete Loan Disbursement
                </h1>
                <p className="text-sidebar-accent dark:text-slate-400 text-sm font-medium">
                    Remove pending or wrongly processed loan disbursements before finalization.
                </p>
            </div>

            <Card className="border-0 shadow-2xl bg-white/90 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden rounded-3xl border-b-4 border-red-600">
                <CardHeader className="bg-gradient-to-r from-red-50 to-orange-50/50 dark:from-red-950/20 dark:to-orange-950/20 px-4 sm:px-8 py-6 border-b border-slate-100 dark:border-sidebar-accent/50">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/40">
                            <Trash2 className="h-6 w-6 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold text-foreground dark:text-white">Deletion Parameters</CardTitle>
                            <CardDescription className="text-slate-500 font-medium pt-1">
                                Confirm the Disbursal Date and choose a Center to find deletable batches.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-8">
                    <Form {...form}>
                        <form className="space-y-8">
                            {isLoading ? (
                                <PageLoader label="Loading active centers..." fullScreen={false} />
                            ) : (
                                <>
                                    <LocalBranchFilter value={branchId} onChange={setBranchId} />

                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">

                                        <div className="md:col-span-4 space-y-2">
                                            <Label className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 uppercase">
                                                Disbursal Date
                                            </Label>
                                            <div className="relative">
                                                <CalendarIcon className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                                                <DateInput
                                                    value={workingDate}
                                                    disabled
                                                    className="h-11 pl-10 bg-brand-green-tint border-primary/20 text-sidebar-accent font-bold dark:bg-sidebar-accent/50 dark:border-sidebar-accent cursor-not-allowed rounded-xl"
                                                />
                                            </div>
                                        </div>

                                        <div className="md:col-span-5 space-y-2">
                                            <FormField
                                                control={form.control}
                                                name="centerName"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 uppercase">
                                                            Center Name <span className="text-red-500">*</span>
                                                        </FormLabel>
                                                        <Select
                                                            onValueChange={field.onChange}
                                                            value={field.value}
                                                            disabled={centers.length === 0}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger className="h-11 w-full border-primary/30 dark:border-sidebar-accent focus:ring-red-500 rounded-xl font-medium">
                                                                    <SelectValue placeholder="-- SELECT CENTER --" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {centers.length === 0 ? (
                                                                    <div className="px-3 py-2 text-sm text-slate-500 font-medium">
                                                                        No centers available
                                                                    </div>
                                                                ) : (
                                                                    centers.map((center) => (
                                                                        <SelectItem key={center.id} value={center.id} className="font-medium">
                                                                            <span className="text-slate-500 mr-2">[{center.code}]</span> {center.name}
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

                                        <div className="md:col-span-3 flex items-center justify-end gap-3 pb-1">
                                            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/10 px-4 py-2.5 rounded-xl border border-red-100 dark:border-red-900/30">
                                                <Label htmlFor="select-all" className="text-sm font-bold cursor-pointer text-red-700 dark:text-red-400">
                                                    SELECT ALL
                                                </Label>
                                                <Switch
                                                    id="select-all"
                                                    checked={selectAll}
                                                    onCheckedChange={handleSelectAll}
                                                    disabled={disbursements.length === 0 || isLoadingDisbursements}
                                                    className="data-[state=checked]:bg-red-600"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-4 pt-4 border-t border-slate-100 dark:border-sidebar-accent">
                                        <Button
                                            type="button"
                                            onClick={handleDeleteClick}
                                            disabled={!canDeleteLoan || isDeleting || selectedCount === 0}
                                            className="h-11 px-8 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-500/20 transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {isDeleting ? (
                                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> PROCESSING DELETE...</>
                                            ) : (
                                                <><Trash2 className="mr-2 h-4 w-4" /> DELETE SELECTED {selectedCount > 0 ? `(${selectedCount})` : ''}</>
                                            )}
                                        </Button>

                                        <Button
                                            type="button"
                                            onClick={handleReset}
                                            disabled={isDeleting}
                                            variant="outline"
                                            className="h-11 px-8 font-bold border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 rounded-xl transition-all"
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4" /> RESET
                                        </Button>
                                    </div>
                                </>
                            )}
                        </form>
                    </Form>
                </CardContent>
            </Card>

            {selectedCenterId && (
                <Card className="border-0 shadow-2xl bg-white dark:bg-brand-green-darker rounded-3xl overflow-hidden mt-8">
                    <CardHeader className="bg-green-50 dark:bg-sidebar-accent/50 py-5 px-4 sm:px-8 border-b border-slate-100 dark:border-sidebar-accent">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <CardTitle className="text-lg font-bold text-sidebar-accent dark:text-white flex items-center gap-2">
                                <Wallet className="w-5 h-5 text-red-600" />
                                Pending Disbursements Found
                            </CardTitle>
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search disbursements..."
                                className="ml-auto"
                            />
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {isLoadingDisbursements ? (
                            <PageLoader label="Fetching deletable batches..." fullScreen={false} />
                        ) : searchedRows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 bg-green-50/50 dark:bg-brand-green-darker/50">
                                <div className="p-4 bg-white dark:bg-sidebar-accent rounded-full shadow-sm mb-4">
                                    <AlertCircle className="h-8 w-8 text-orange-500" />
                                </div>
                                <h3 className="text-lg font-bold text-sidebar-accent dark:text-slate-200">No Pending Disbursements</h3>
                                <p className="text-sm text-slate-500 font-medium max-w-sm text-center mt-2">
                                    There are no pending Level-2 disbursements available for deletion in this center.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-brand-green-tint dark:bg-sidebar-accent/80 hover:bg-brand-green-tint dark:hover:bg-sidebar-accent/80">
                                            <TableHead className="w-16 text-center">Select</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300">Disbursement ID</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300">Index No</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300">Index Date</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300">Center</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300">Funder</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 text-center">Total Clients</TableHead>
                                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300 text-right pr-6">Total Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.map((disb) => (
                                            <TableRow
                                                key={disb.id}
                                                className="hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors cursor-pointer"
                                                onClick={() => handleSelectDisbursement(disb.id, !disb.isSelected)}
                                            >
                                                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={disb.isSelected || false}
                                                        onChange={(e) => handleSelectDisbursement(disb.id, e.target.checked)}
                                                        className="h-4 w-4 rounded border-primary/30 text-red-600 focus:ring-red-500 cursor-pointer"
                                                    />
                                                </TableCell>
                                                <TableCell className="font-bold text-sidebar-accent dark:text-slate-200">{disb.disbursementId}</TableCell>
                                                <TableCell className="font-medium text-sidebar-accent dark:text-slate-400">{disb.indexNo}</TableCell>
                                                <TableCell className="font-medium text-sidebar-accent dark:text-slate-400">{formatDateDisplay(disb.indexDate)}</TableCell>
                                                <TableCell className="font-medium text-sidebar-accent dark:text-slate-200">
                                                    <span className="text-slate-500 mr-2">[{disb.centerCode}]</span> {disb.centerName}
                                                </TableCell>
                                                <TableCell className="font-medium text-sidebar-accent dark:text-slate-400">{disb.funderName}</TableCell>
                                                <TableCell className="text-center font-bold text-primary dark:text-primary">{disb.totalClients}</TableCell>
                                                <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400 pr-6">
                                                    ₹ {formatCurrency(disb.totalAmount)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {!isLoading && centers.length === 0 && (
                <Card className="border-0 shadow-lg bg-orange-50/50 dark:bg-orange-950/20 rounded-2xl">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-orange-100 dark:bg-orange-900/50 p-4 mb-4">
                            <AlertCircle className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                        </div>
                        <h3 className="text-lg font-bold text-sidebar-accent dark:text-slate-200 mb-1">No Active Centers</h3>
                        <p className="text-sm font-medium text-slate-500 text-center max-w-md">
                            No active centers were found in your branch. Verify your branch context or ensure centers are configured correctly.
                        </p>
                    </CardContent>
                </Card>
            )}

            <ConfirmationDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                onConfirm={handleDelete}
                title="Confirm Multi-Deletion"
                description={`You are about to permanently delete and revert ${selectedCount} selected pending disbursement batch(es) for the selected center. This action cannot be undone. Do you wish to proceed?`}
                confirmText="Permanently Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
