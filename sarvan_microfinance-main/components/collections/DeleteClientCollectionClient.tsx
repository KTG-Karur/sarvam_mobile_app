'use client';

import { useState, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
} from "@/components/ui/table";
import {
    Trash2,
    RotateCcw,
    Loader2,
    AlertCircle,
    Search,
    Receipt,
    User,
    Home,
    Calendar,
    ArrowRight,
    RefreshCw,
    History,
    CheckCircle2,
    XCircle,
    Copy,
    BadgeCheck
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { RevertLocationPicker, type RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

type Center = {
    id: string;
    name: string;
    code: string;
};

type Branch = {
    id: string;
    name: string;
    code: string;
};

type Client = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    centerId: string;
};

type LoanAccount = {
    id: string;
    loanNumber: string;
    amount: number;
    disbursementDate?: string;
};

type CollectionTransaction = {
    id: string;
    transactionId: string;
    loanId: string;
    loanNumber: string;
    amount: number;
    transactionDate: string;
    collectedBy: string;
    remarks: string;
    principalAmount: number;
    interestAmount: number;
    feesAmount: number;
    penaltyAmount: number;
    isReversed?: boolean;
    revertedAt?: string | null;
    revertedByName?: string | null;
    revertedByEmployeeId?: string | null;
    revertReason?: string | null;
    revertLocation?: RevertLocationDto;
};

const deleteClientCollectionSchema = z.object({
    centerId: z.string().min(1, 'Center is required'),
    clientId: z.string().min(1, 'Client is required'),
    loanId: z.string().min(1, 'Loan A/c is required'),
});

type DeleteFormValues = z.infer<typeof deleteClientCollectionSchema>;

export function DeleteClientCollectionClient() {
    const { canPage } = usePermission();
    const canDeleteCollection = canPage('/dashboard/collections/delete-client-collection', 'delete');
    const { toast } = useToast();
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [centers, setCenters] = useState<Center[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loanAccounts, setLoanAccounts] = useState<LoanAccount[]>([]);
    const [history, setHistory] = useState<CollectionTransaction[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isReversing, setIsReversing] = useState(false);
    const [revertLocation, setRevertLocation] = useState<RevertLocationValue | null>(null);

    const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<CollectionTransaction | null>(null);

    // Separate filter: Active collections (default) vs. the reverted history view.
    const [showReverted, setShowReverted] = useState(false);

    const form = useForm<DeleteFormValues>({
        resolver: zodResolver(deleteClientCollectionSchema),
        defaultValues: {
            centerId: '',
            clientId: '',
            loanId: '',
        },
    });

    const selectedCenterId = form.watch('centerId');
    const selectedClientId = form.watch('clientId');
    const selectedLoanId = form.watch('loanId');

    // Resolve branch context: BM/FDO use their active branch directly; Admin/AM
    // (who may have no active branch, e.g. HO Admin) get a branch picker.
    useEffect(() => {
        const activeBranch = branchStorage.getActiveBranch();
        if (isAdminOrAM) {
            setIsLoadingBranches(true);
            fetch('/api/branches')
                .then((res) => res.json())
                .then((json) => {
                    const list: Branch[] = (json?.data ?? []).map((b: Branch) => ({ id: b.id, name: b.name, code: b.code }));
                    setBranches(list);
                })
                .catch(() => {
                    toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
                })
                .finally(() => setIsLoadingBranches(false));
        } else {
            setBranchId(activeBranch?.id ?? storedUser?.branchId ?? '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch centers whenever the resolved branch changes
    useEffect(() => {
        if (!branchId) {
            setCenters([]);
            return;
        }
        const fetchCenters = async () => {
            try {
                setIsLoading(true);
                const response = await apiClient.get(`/centers?branchId=${branchId}&status=APPROVED`);
                setCenters(Array.isArray(response.data) ? response.data : []);
            } catch (error) {
                console.error('Error fetching centers:', error);
                toast({ title: 'Error', description: 'Failed to load centers', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        };
        fetchCenters();
    }, [branchId, toast]);

    // Fetch clients
    useEffect(() => {
        if (!selectedCenterId) {
            setClients([]);
            return;
        }
        const fetchClients = async () => {
            try {
                setIsLoadingClients(true);
                const response = await apiClient.get(`/clients?centerId=${selectedCenterId}&pageSize=100`);
                setClients(Array.isArray((response.data as any)?.clients) ? (response.data as any).clients : []);
            } catch (error) {
                console.error('Error fetching clients:', error);
            } finally {
                setIsLoadingClients(false);
            }
        };
        fetchClients();
    }, [selectedCenterId]);

    // Fetch loans
    useEffect(() => {
        if (!selectedClientId) {
            setLoanAccounts([]);
            return;
        }
        const fetchLoans = async () => {
            try {
                setIsLoadingLoans(true);
                // We use the single collection endpoint logic but just to get active loans
                const response = await apiClient.get(`/collections/single-collection?clientId=${selectedClientId}`);
                const data = response.data as any;
                // Single collection response structure for active loan
                if (data && data.loanId) {
                    setLoanAccounts([{
                        id: data.loanId,
                        loanNumber: data.loanNumber,
                        amount: data.loanAmount,
                        disbursementDate: data.disbursementDate
                    }]);
                } else {
                    setLoanAccounts([]);
                }
            } catch (error) {
                console.error('Error fetching loans:', error);
                setLoanAccounts([]);
            } finally {
                setIsLoadingLoans(false);
            }
        };
        fetchLoans();
        fetchHistory(); // Fetch history too
    }, [selectedClientId]);

    const fetchHistory = async () => {
        if (!selectedClientId) {
            setHistory([]);
            return;
        }
        try {
            setIsLoadingHistory(true);
            const statusParam = showReverted ? 'reverted' : 'active';
            const response = await apiClient.get(`/collections/client/non-demand?clientId=${selectedClientId}&status=${statusParam}`);
            setHistory(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Re-fetch whenever the reverted-history toggle flips.
    useEffect(() => {
        fetchHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showReverted]);

    const handleReverse = async () => {
        if (!selectedTransaction || !revertLocation) return;

        try {
            setIsReversing(true);
            await apiClient.post('/collections/client/reverse', {
                transactionId: selectedTransaction.id,
                remarks: 'Reversed via Delete Client Collection screen',
                latitude: revertLocation.latitude,
                longitude: revertLocation.longitude,
            });

            toast({
                title: 'Reversal Successful',
                description: `Transaction ${selectedTransaction.transactionId} has been reversed.`,
            });

            setReverseDialogOpen(false);
            setRevertLocation(null);
            setSelectedTransaction(null);
            fetchHistory(); // Refresh table
        } catch (error: any) {
            console.error('Error reversing:', error);
            toast({
                title: 'Reversal Failed',
                description: error.response?.data?.message || 'Internal server error',
                variant: 'destructive',
            });
        } finally {
            setIsReversing(false);
        }
    };

    const handleReset = () => {
        form.reset();
        setClients([]);
        setLoanAccounts([]);
        setHistory([]);
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(history);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast({ description: 'Transaction ID copied to clipboard' });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Header Section with Glassmorphism */}
            <div className="relative p-8 rounded-3xl overflow-hidden bg-white/40 dark:bg-brand-green-darker/40 border border-white/20 dark:border-sidebar-accent/40 backdrop-blur-2xl shadow-2xl">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                    <Trash2 className="w-32 h-32 text-red-500 rotate-12" />
                </div>

                <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/20">
                                <Trash2 className="w-6 h-6 text-white" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-foreground dark:text-white italic">
                                DELETE CLIENT <span className="text-red-500">COLLECTION</span>
                            </h1>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 font-medium max-w-xl">
                            Reverse non-demand collection records with full transactional integrity.
                            Select a client to view and manage their recent activity.
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            onClick={handleReset}
                            className="rounded-xl border-primary/20 dark:border-sidebar-accent hover:bg-brand-green-tint dark:hover:bg-sidebar-accent transition-all duration-300"
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reset Form
                        </Button>
                    </div>
                </div>
            </div>

            {/* Selection Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-1 border-none bg-white/60 dark:bg-brand-green-darker/60 shadow-xl backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                            <Search className="w-5 h-5 text-primary" />
                            Identification
                        </CardTitle>
                        <CardDescription>Locate the client record</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Form {...form}>
                            <form className="space-y-6">
                                {isAdminOrAM && (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Branch</FormLabel>
                                        {isLoadingBranches ? (
                                            <Skeleton className="h-12 w-full rounded-xl" />
                                        ) : (
                                            <Select
                                                value={branchId}
                                                onValueChange={(val) => {
                                                    setBranchId(val);
                                                    form.setValue('centerId', '');
                                                    form.setValue('clientId', '');
                                                    form.setValue('loanId', '');
                                                }}
                                            >
                                                <SelectTrigger className="h-12 rounded-xl bg-white/50 dark:bg-sidebar-accent/50 border-primary/20/60 dark:border-sidebar-accent/60">
                                                    <SelectValue placeholder="-- SELECT BRANCH --" />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-primary/20 dark:border-sidebar-accent">
                                                    {branches.map((b) => (
                                                        <SelectItem key={b.id} value={b.id} className="rounded-lg">{b.code} - {b.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    </FormItem>
                                )}
                                <FormField
                                    control={form.control}
                                    name="centerId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Center Name</FormLabel>
                                            {isLoading ? (
                                                <Skeleton className="h-12 w-full rounded-xl" />
                                            ) : (
                                                <Select
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        form.setValue('clientId', '');
                                                        form.setValue('loanId', '');
                                                    }}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-xl bg-white/50 dark:bg-sidebar-accent/50 border-primary/20/60 dark:border-sidebar-accent/60">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-xl border-primary/20 dark:border-sidebar-accent">
                                                        {centers.map(c => (
                                                            <SelectItem key={c.id} value={c.id} className="rounded-lg">{c.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="clientId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Client Name</FormLabel>
                                            {isLoadingClients ? (
                                                <Skeleton className="h-12 w-full rounded-xl" />
                                            ) : (
                                                <Select
                                                    disabled={!selectedCenterId}
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        form.setValue('loanId', '');
                                                    }}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-xl bg-white/50 dark:bg-sidebar-accent/50 border-primary/20/60 dark:border-sidebar-accent/60">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-xl border-primary/20 dark:border-sidebar-accent">
                                                        {clients.map(c => (
                                                            <SelectItem key={c.id} value={c.id} className="rounded-lg">{c.firstName} {c.lastName} ({c.clientId})</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="loanId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Loan A/c No.</FormLabel>
                                            {isLoadingLoans ? (
                                                <Skeleton className="h-12 w-full rounded-xl" />
                                            ) : (
                                                <Select
                                                    disabled={!selectedClientId}
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-xl bg-white/50 dark:bg-sidebar-accent/50 border-primary/20/60 dark:border-sidebar-accent/60">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-xl border-primary/20 dark:border-sidebar-accent">
                                                        {loanAccounts.map(l => (
                                                            <SelectItem key={l.id} value={l.id} className="rounded-lg">{l.loanNumber}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </form>
                        </Form>
                    </CardContent>
                </Card>

                <div className="lg:col-span-2 space-y-6">
                    {/* Activity Feed / History */}
                    <Card className="border-none bg-white/60 dark:bg-brand-green-darker/60 shadow-xl backdrop-blur-xl min-h-[400px]">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle className="text-lg font-bold flex items-center gap-2">
                                    <History className="w-5 h-5 text-red-500" />
                                    {showReverted ? 'Reverted History' : 'Non-Demand Activity'}
                                </CardTitle>
                                <CardDescription>
                                    {showReverted
                                        ? 'Reverted non-demand collections for selected client'
                                        : 'Recent reversible collections for selected client'}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search transactions..."
                                />
                                <Switch checked={showReverted} onCheckedChange={setShowReverted} />
                                <Label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Show Reverted</Label>
                                <Badge variant="outline" className="rounded-full px-4 py-1 border-red-500/20 text-red-500 bg-red-500/5">
                                    REVERSIBLE DATA
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {isLoadingHistory ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map(i => (
                                        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
                                    ))}
                                </div>
                            ) : searchedRows.length > 0 ? (
                                <div className="rounded-2xl border border-primary/20/60 dark:border-sidebar-accent/60 overflow-hidden">
                                    <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                            <TableRow className="hover:bg-transparent border-primary/20/60 dark:border-sidebar-accent/60">
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4">Transaction ID</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4">Date</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4 text-right">Amount</TableHead>
                                                {showReverted ? (
                                                    <>
                                                        <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4">Reverted By</TableHead>
                                                        <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4">Reverted On</TableHead>
                                                        <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4">Revert Reason</TableHead>
                                                        <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4">Revert Location</TableHead>
                                                    </>
                                                ) : (
                                                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4 text-right">Actions</TableHead>
                                                )}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {searchedRows.map((t) => (
                                                <TableRow key={t.id} className="group hover:bg-brand-green-tint/40 dark:hover:bg-sidebar-accent/40 transition-colors border-primary/20/60 dark:border-sidebar-accent/60">
                                                    <TableCell className="p-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                                                <Receipt className="w-4 h-4" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-foreground dark:text-white">{t.transactionId}</p>
                                                                <button
                                                                    onClick={() => copyToClipboard(t.transactionId)}
                                                                    className="text-xs text-slate-400 hover:text-primary flex items-center gap-1 transition-colors"
                                                                >
                                                                    <Copy className="w-2.5 h-2.5" />
                                                                    Copy ID
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="p-4">
                                                        <p className="text-sm font-medium text-sidebar-accent dark:text-slate-400">
                                                            {format(new Date(t.transactionDate), 'dd/MM/yyyy')}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 uppercase tracking-tighter">
                                                            BY {t.collectedBy}
                                                        </p>
                                                    </TableCell>
                                                    <TableCell className="p-4 text-right">
                                                        <p className="text-lg font-black text-foreground dark:text-white">
                                                            ₹{t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                                        </p>
                                                    </TableCell>
                                                    {showReverted ? (
                                                        <>
                                                            <TableCell className="p-4 text-xs">
                                                                {t.revertedByName ?? '-'}
                                                                {t.revertedByEmployeeId && (
                                                                    <span className="block text-muted-foreground">({t.revertedByEmployeeId})</span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="p-4 text-xs">
                                                                {t.revertedAt ? format(new Date(t.revertedAt), 'dd/MM/yyyy hh:mm a') : '-'}
                                                            </TableCell>
                                                            <TableCell className="p-4 text-xs max-w-[220px] whitespace-pre-wrap break-words">
                                                                {t.revertReason ?? '-'}
                                                            </TableCell>
                                                            <TableCell className="p-4 text-xs">
                                                                <RevertLocationCell location={t.revertLocation} />
                                                            </TableCell>
                                                        </>
                                                    ) : (
                                                        <TableCell className="p-4 text-right">
                                                            {canDeleteCollection && (
                                                                <Button
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    onClick={() => {
                                                                        setSelectedTransaction(t);
                                                                        setReverseDialogOpen(true);
                                                                    }}
                                                                    className="h-10 w-10 text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-xl transition-all"
                                                                >
                                                                    <Trash2 className="h-5 w-5" />
                                                                </Button>
                                                            )}
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                    </div>
                                </div>
                            ) : !selectedClientId ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                                    <div className="p-6 rounded-full bg-brand-green-tint dark:bg-sidebar-accent/50">
                                        <Search className="w-12 h-12 text-slate-300" />
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-slate-400 italic">READY TO SEARCH</p>
                                        <p className="text-sm text-slate-500 max-w-[200px]">Select a client to see their recent transactions</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                                    <div className="p-6 rounded-full bg-orange-500/10">
                                        <Receipt className="w-12 h-12 text-orange-400" />
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-orange-500 italic">NO COLLECTIONS FOUND</p>
                                        <p className="text-sm text-slate-500 max-w-[200px]">
                                            {showReverted
                                                ? 'This client has no reverted "Non-Demand" collections'
                                                : 'This client has no "Non-Demand" collection records'}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Warning Footer */}
            <Alert className="border-none bg-amber-500/10 backdrop-blur-xl border border-amber-500/20 p-6 rounded-3xl">
                <AlertCircle className="h-6 w-6 text-amber-500" />
                <div className="ml-4 space-y-1">
                    <h5 className="font-bold text-amber-500 uppercase tracking-widest text-xs">Correction Protocol</h5>
                    <AlertDescription className="text-sidebar-accent dark:text-slate-400 font-medium">
                        Deleting a collection will automatically reverse schedule allocations and adjust the loan principal balance in real-time.
                        This action reflects immediately in the Cash Collection Report (CCR) and ledger.
                    </AlertDescription>
                </div>
            </Alert>

            {/* Reversal Confirmation Dialog */}
            <ConfirmationDialog
                open={reverseDialogOpen}
                onOpenChange={(open) => { setReverseDialogOpen(open); if (!open) setRevertLocation(null); }}
                onConfirm={handleReverse}
                title="REVERSE TRANSACTION"
                description={`You are about to reverse the collection of ₹${selectedTransaction?.amount.toLocaleString()} for transaction ${selectedTransaction?.transactionId}. This will restore the dues on the client's schedule.`}
                confirmText={isReversing ? "PROCESSING..." : "CONFIRM REVERSAL"}
                cancelText="CANCEL"
                type="delete"
                isLoading={isReversing}
                confirmDisabled={!revertLocation}
                contentClassName="max-w-2xl"
            >
                {reverseDialogOpen && <RevertLocationPicker value={revertLocation} onChange={setRevertLocation} disabled={isReversing} />}
            </ConfirmationDialog>
        </div>
    );
}
