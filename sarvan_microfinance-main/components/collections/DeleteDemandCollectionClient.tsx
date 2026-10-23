'use client';

import { useState, useEffect } from 'react';
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Trash2,
    RotateCcw,
    Loader2,
    Receipt,
    Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { format } from 'date-fns';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

type Center = {
    id: string;
    name: string;
    code: string;
};

type CollectionBatch = {
    batchId: string;
    collectionDate: string;
    centerId: string;
    centerCode: string;
    centerName: string;
    noOfClients: number;
    totalRepayment: number;
    totalLoanAdvance: number;
    status: string;
    canDelete: boolean;
    transactionIds: string[];
    isSelected?: boolean;
};

export function DeleteDemandCollectionClient() {
    const { canPage } = usePermission();
    const canDeleteCollection = canPage('/dashboard/collections/delete-demand-collection', 'delete');
    const { toast } = useToast();
    const today = new Date().toISOString().split('T')[0];

    // Page-local branch filter — does not switch the session-wide active branch.
    const [branchId, setBranchId] = useState<string>(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        return activeBranch?.id || storedUser?.branchId || '';
    });
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [selectedDate, setSelectedDate] = useState(today);
    const [batches, setBatches] = useState<CollectionBatch[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingBatches, setIsLoadingBatches] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [selectAll, setSelectAll] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const fetchCentersForBranch = (forBranchId: string) => {
        setIsLoading(true);

        if (!forBranchId) {
            toast({ title: 'Error', description: 'No branch found. Please select a branch first.', variant: 'destructive' });
            setIsLoading(false);
            return;
        }

        apiClient.get<Center[]>(`/centers?branchId=${forBranchId}&includeInactive=false&status=APPROVED`)
            .then(result => {
                if (result.success && result.data) setCenters(result.data);
                else setCenters([]);
            })
            .catch(() => setCenters([]))
            .finally(() => setIsLoading(false));
    };

    // Fetch centers whenever the (page-local) branch changes
    useEffect(() => {
        if (branchId) fetchCentersForBranch(branchId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId]);

    // Sync selectAll with batch selections
    useEffect(() => {
        setSelectAll(batches.length > 0 && batches.every(b => b.isSelected));
    }, [batches]);

    const fetchBatches = async () => {
        if (!selectedCenterId || !selectedDate) return;
        setIsLoadingBatches(true);
        setBatches([]);
        try {
            const res = await fetch(`/api/collections/demand?centerId=${selectedCenterId}&date=${selectedDate}`, {
                method: 'PATCH',
            });
            const result = await res.json();
            if (result.success && result.data?.batches) {
                setBatches(result.data.batches.map((b: CollectionBatch) => ({ ...b, isSelected: false })));
            } else {
                toast({ title: 'Info', description: result.message || 'No collections found for this date.' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load collections. Please try again.', variant: 'destructive' });
        } finally {
            setIsLoadingBatches(false);
        }
    };

    const handleSelectAll = (checked: boolean) => {
        setSelectAll(checked);
        setBatches(prev => prev.map(b => b.canDelete ? { ...b, isSelected: checked } : b));
    };

    const handleSelectBatch = (batchId: string, checked: boolean) => {
        setBatches(prev => prev.map(b => b.batchId === batchId ? { ...b, isSelected: checked } : b));
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(batches);

    const selectedBatches = batches.filter(b => b.isSelected);
    const selectedCount = selectedBatches.length;

    const handleDeleteClick = () => {
        if (selectedCount === 0) {
            toast({ title: 'No Selection', description: 'Please select at least one batch to delete.', variant: 'destructive' });
            return;
        }
        setDeleteDialogOpen(true);
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const batchIds = selectedBatches.map(b => b.batchId);
            const res = await fetch('/api/collections/demand', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ centerId: selectedCenterId, batchIds }),
            });
            const result = await res.json();
            if (result.success) {
                toast({ title: 'Deleted', description: result.message ?? `Deleted ${selectedCount} batch(es) successfully.` });
                setDeleteDialogOpen(false);
                await fetchBatches();
            } else {
                toast({ title: 'Error', description: result.error || result.message || 'Failed to delete.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to delete collections. Please try again.', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReset = () => {
        setSelectedCenterId('');
        setSelectedDate(today);
        setBatches([]);
        setSelectAll(false);
    };

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Delete Demand Collection
                </h1>
                <p className="text-muted-foreground">
                    Select center and date, then choose demand collection batches to delete
                </p>
            </div>

            {/* Filter Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-600 to-amber-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-red-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                            <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Delete Demand Collection Details</CardTitle>
                            <CardDescription>Select center and date to view submitted collections</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6">
                    {isLoading ? (
                        <PageLoader label="Loading centers…" fullScreen={false} />
                    ) : (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <LocalBranchFilter
                                    value={branchId}
                                    onChange={(id) => {
                                        setBranchId(id);
                                        setSelectedCenterId('');
                                        setBatches([]);
                                    }}
                                />
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Center Name</Label>
                                    <Select value={selectedCenterId} onValueChange={setSelectedCenterId} disabled={centers.length === 0}>
                                        <SelectTrigger className="h-11">
                                            <SelectValue placeholder="-- SELECT --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {centers.length === 0 ? (
                                                <div className="px-2 py-1.5 text-sm text-muted-foreground">No centers available</div>
                                            ) : (
                                                centers.map(c => (
                                                    <SelectItem key={c.id} value={c.id}>
                                                        <span className="font-medium">{c.name}</span>
                                                        <span className="ml-2 text-muted-foreground">({c.code})</span>
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">Collection Date</Label>
                                    <DateInput
                                        value={selectedDate}
                                        max={today}
                                        onChange={e => setSelectedDate(e.target.value)}
                                        className="h-11"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <Button
                                        type="button"
                                        onClick={fetchBatches}
                                        disabled={!selectedCenterId || !selectedDate || isLoadingBatches}
                                        className="h-11 w-full bg-sidebar-accent hover:bg-sidebar-accent"
                                    >
                                        {isLoadingBatches
                                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</>
                                            : <><Search className="mr-2 h-4 w-4" /> Load Collections</>
                                        }
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <Button
                                    type="button"
                                    onClick={handleDeleteClick}
                                    disabled={!canDeleteCollection || isDeleting || selectedCount === 0}
                                    variant="destructive"
                                    className="flex-1 min-w-[140px] bg-red-600 hover:bg-red-700"
                                    size="lg"
                                >
                                    {isDeleting
                                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…</>
                                        : <><Trash2 className="mr-2 h-4 w-4" /> Delete Selected ({selectedCount})</>
                                    }
                                </Button>
                                <Button type="button" onClick={handleReset} disabled={isDeleting} variant="outline" size="lg">
                                    <RotateCcw className="mr-2 h-4 w-4" /> Reset
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Collections Table */}
            {selectedCenterId && batches.length > 0 && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Demand Collections — {selectedDate ? format(new Date(selectedDate), 'dd/MM/yyyy') : ''}</CardTitle>
                                <CardDescription>Select batches to delete. Only PENDING collections can be deleted.</CardDescription>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search batches..."
                                />
                                <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">Select All</label>
                                <input
                                    type="checkbox"
                                    id="select-all"
                                    checked={selectAll}
                                    onChange={e => handleSelectAll(e.target.checked)}
                                    className="h-4 w-4 rounded border-primary/30 text-red-600 focus:ring-red-500"
                                />
                                {selectedCount > 0 && (
                                    <span className="text-sm text-muted-foreground">({selectedCount} selected)</span>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader className="bg-red-800 text-white">
                                    <TableRow className="hover:bg-red-800">
                                        <TableHead className="w-12 text-white">
                                            <input
                                                type="checkbox"
                                                checked={selectAll}
                                                onChange={e => handleSelectAll(e.target.checked)}
                                                className="h-4 w-4 rounded border-primary/30"
                                            />
                                        </TableHead>
                                        <TableHead className="text-white">Batch ID</TableHead>
                                        <TableHead className="text-white">Collection Date</TableHead>
                                        <TableHead className="text-white">Center</TableHead>
                                        <TableHead className="text-white">No. of Clients</TableHead>
                                        <TableHead className="text-white text-right">Demand Collection</TableHead>
                                        <TableHead className="text-white text-right">Loan Advance</TableHead>
                                        <TableHead className="text-white">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map(b => (
                                        <TableRow key={b.batchId} className="even:bg-green-50 dark:even:bg-brand-green-darker/50">
                                            <TableCell>
                                                <input
                                                    type="checkbox"
                                                    checked={b.isSelected || false}
                                                    disabled={!b.canDelete}
                                                    onChange={e => handleSelectBatch(b.batchId, e.target.checked)}
                                                    className="h-4 w-4 rounded border-primary/30 text-red-600 focus:ring-red-500 disabled:opacity-40"
                                                />
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{b.batchId}</TableCell>
                                            <TableCell>{format(new Date(b.collectionDate), 'dd/MM/yyyy')}</TableCell>
                                            <TableCell>{b.centerCode} - {b.centerName}</TableCell>
                                            <TableCell>{b.noOfClients}</TableCell>
                                            <TableCell className="text-right font-medium">{formatCurrency(b.totalRepayment)}</TableCell>
                                            <TableCell className="text-right font-medium text-emerald-700">{formatCurrency(b.totalLoanAdvance)}</TableCell>
                                            <TableCell>
                                                {b.canDelete
                                                    ? <Badge variant="secondary">Pending</Badge>
                                                    : <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>
                                                }
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Empty state after load */}
            {selectedCenterId && !isLoadingBatches && batches.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Receipt className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground text-center">
                            No demand collections found for the selected center and date.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Loading state */}
            {isLoadingBatches && (
                <Card>
                    <CardContent className="py-4">
                        <PageLoader label="Loading demand collections…" fullScreen={false} />
                    </CardContent>
                </Card>
            )}

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                onConfirm={handleDelete}
                title="Delete Demand Collections"
                description={`Are you sure you want to delete ${selectedCount} selected batch(es)? This will also remove any associated loan advance collections from the same batches. This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
