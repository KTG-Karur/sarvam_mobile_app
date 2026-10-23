'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
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
import {
    Search,
    Loader2,
    AlertCircle,
    XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { RevertReasonDialog } from '@/components/revert/RevertReasonDialog';
import type { RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

const ALL = 'all';

type Branch = {
    id: string;
    name: string;
    code: string;
};

type Center = {
    id: string;
    name: string;
    code: string;
    branchId: string;
    branch?: { code: string; name: string };
};

type ForeclosureRow = {
    transactionId: string;
    branchId: string;
    transactionDate: string;
    clientName: string;
    loanAccountNo: string;
    amount: number;
    principalAmount: number;
    interestAmount: number;
    collectedByName: string;
    collectedByEmployeeId: string | null;
    approvedByName: string | null;
    isReversed: boolean;
    canRevert: boolean;
    revertBlockedReason: string | null;
    revertedAt: string | null;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
};

const NO_PERMISSION_REASON = 'You do not have permission to revert preclosures.';

const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);

// IST calendar day, YYYY-MM-DD — matches getKolkataCalendarYmd's convention
// (app/lib/branch-lock.ts) so the date filter's "today" agrees with business-date logic.
const getTodayIstYmd = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function DeleteForeclosureClient() {
    const { canPage } = usePermission();
    const canRevertForeclosure = canPage('/dashboard/collections/delete-foreclosure', 'delete');
    const { toast } = useToast();
    // isAdmin depends on localStorage, which isn't available during SSR — start
    // false (matches the server-rendered markup) and resolve it after mount to
    // avoid a hydration mismatch.
    const [isAdmin, setIsAdmin] = useState(false);

    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    // Empty until the user picks one (a specific branch or "All Branches") — never preselected.
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [bmBranchId, setBmBranchId] = useState('');

    const [centers, setCenters] = useState<Center[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [selectedCenterId, setSelectedCenterId] = useState(ALL);

    // Separate filter: Active foreclosures (default) vs. the reverted history view.
    const [showReverted, setShowReverted] = useState(false);

    // Preclosure Date range filter — defaults to today
    const [fromDate, setFromDate] = useState(getTodayIstYmd);
    const [toDate, setToDate] = useState(getTodayIstYmd);

    const [rows, setRows] = useState<ForeclosureRow[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const [isReverting, setIsReverting] = useState(false);
    const [revertDialogOpen, setRevertDialogOpen] = useState(false);
    const [selectedRow, setSelectedRow] = useState<ForeclosureRow | null>(null);

    // Resolve branch context: BM's branch is fixed; Admin gets a picker
    // with no default selection.
    useEffect(() => {
        const storedUser = tokenStorage.getUser();
        const admin = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || storedUser?.role === 'AREA_MANAGER';
        setIsAdmin(admin);

        if (admin) {
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
            const activeBranch = branchStorage.getActiveBranch();
            setBmBranchId(activeBranch?.id ?? storedUser?.branchId ?? '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchCenters = useCallback(async (branchIdForCenters: string) => {
        if (!branchIdForCenters) {
            setCenters([]);
            return;
        }
        setIsLoadingCenters(true);
        try {
            const response = await apiClient.get<Center[]>(`/collections/delete-foreclosure?action=centers&branchId=${branchIdForCenters}`);
            setCenters(response.success && Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Error fetching centers:', error);
            setCenters([]);
        } finally {
            setIsLoadingCenters(false);
        }
    }, []);

    const fetchWorkingDate = useCallback(async (branchIdForWorkingDate: string): Promise<string | null> => {
        if (!branchIdForWorkingDate || branchIdForWorkingDate === ALL) {
            return null;
        }
        try {
            const response = await apiClient.get<{ workingDate: string | null }>(
                `/collections/delete-foreclosure?action=workingDate&branchId=${branchIdForWorkingDate}`
            );
            return response.success && response.data ? response.data.workingDate : null;
        } catch (error) {
            console.error('Error fetching branch working date:', error);
            return null;
        }
    }, []);

    // Reload centers whenever the relevant branch scope changes
    useEffect(() => {
        const branchIdForCenters = isAdmin ? selectedBranchId : bmBranchId;
        setSelectedCenterId(ALL);
        fetchCenters(branchIdForCenters);

        fetchWorkingDate(branchIdForCenters).then((workingDate) => {
            const fallback = getTodayIstYmd();
            setFromDate(workingDate ?? fallback);
            setToDate(workingDate ?? fallback);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, selectedBranchId, bmBranchId]);

    const handleSearch = async () => {
        const branchIdForSearch = isAdmin ? selectedBranchId : bmBranchId;
        if (!branchIdForSearch) return;

        if (fromDate && toDate && fromDate > toDate) {
            toast({ title: 'Invalid Date Range', description: 'From Date cannot be after To Date.', variant: 'destructive' });
            return;
        }

        setIsSearching(true);
        setHasSearched(true);
        try {
            const statusParam = showReverted ? 'reverted' : 'active';
            const params = new URLSearchParams({
                action: 'search',
                branchId: branchIdForSearch,
                centerId: selectedCenterId,
                status: statusParam,
            });
            if (fromDate) params.set('fromDate', fromDate);
            if (toDate) params.set('toDate', toDate);

            const response = await apiClient.get<ForeclosureRow[]>(
                `/collections/delete-foreclosure?${params.toString()}`
            );
            if (response.success && Array.isArray(response.data)) {
                setRows(response.data);
            } else {
                setRows([]);
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to load preclosure records',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error searching foreclosures:', error);
            setRows([]);
            toast({ title: 'Error', description: 'Failed to load preclosure records', variant: 'destructive' });
        } finally {
            setIsSearching(false);
        }
    };

    const getRevertBlockedReason = (row: ForeclosureRow): string | null =>
        !canRevertForeclosure ? NO_PERMISSION_REASON : row.revertBlockedReason;

    const handleRevertClick = (row: ForeclosureRow) => {
        const blockedReason = getRevertBlockedReason(row);
        if (blockedReason) {
            toast({ title: 'Cannot Revert', description: blockedReason, variant: 'destructive' });
            return;
        }
        setSelectedRow(row);
        setRevertDialogOpen(true);
    };

    const handleRevert = async (reason: string, location: RevertLocationValue | null) => {
        if (!selectedRow || !location) return;
        try {
            setIsReverting(true);
            const response = await apiClient.delete(
                `/collections/delete-foreclosure?transactionId=${selectedRow.transactionId}&branchId=${selectedRow.branchId}`,
                { reason, latitude: location.latitude, longitude: location.longitude }
            );
            if (response.success) {
                toast({ title: 'Success', description: response.message || 'Preclosure reverted successfully' });
                setRevertDialogOpen(false);
                setSelectedRow(null);
                await handleSearch();
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to revert preclosure',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error reverting foreclosure:', error);
            toast({ title: 'Error', description: 'Failed to revert preclosure', variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(rows);

    const canSearch = isAdmin ? !!selectedBranchId : !!bmBranchId;
    const showBranchDisambiguation = isAdmin && selectedBranchId === ALL;

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Delete Preclosure
                </h1>
                <p className="text-muted-foreground">
                    Search and revert eligible preclosure records
                </p>
            </div>

            {/* Warning Alert */}
            <Alert variant="destructive" className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> Reverting a preclosure restores the loan to Active status and reverses all preclosure transactions. This action cannot be undone.
                </AlertDescription>
            </Alert>

            {/* Filter Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-600 to-amber-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-red-50/60 to-orange-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <CardTitle className="flex items-center gap-2 text-xl">
                        <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                        Delete Preclosure
                    </CardTitle>
                    <CardDescription>
                        {isAdmin
                            ? 'Select a branch and center, then click Search to view preclosure records'
                            : 'Select a center and click Search to view preclosure records for your branch'}
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 ${isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
                        {isAdmin && (
                            <div className="space-y-2">
                                <Label className="text-base font-semibold">Branch</Label>
                                {isLoadingBranches ? (
                                    <div className="flex items-center h-11 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading branches...
                                    </div>
                                ) : (
                                    <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                                        <SelectTrigger className="h-11">
                                            <SelectValue placeholder="Select Branch" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={ALL}>All Branches</SelectItem>
                                            {branches.map((b) => (
                                                <SelectItem key={b.id} value={b.id}>
                                                    {b.code} - {b.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label className="text-base font-semibold">Center</Label>
                            {isLoadingCenters ? (
                                <div className="flex items-center h-11 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading centers...
                                </div>
                            ) : (
                                <Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
                                    <SelectTrigger className="h-11">
                                        <SelectValue placeholder="All Centers" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ALL}>All Centers</SelectItem>
                                        {centers.map((center) => (
                                            <SelectItem key={center.id} value={center.id}>
                                                {center.name} ({center.code})
                                                {showBranchDisambiguation && center.branch ? ` — ${center.branch.code}` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label className="text-base font-semibold">From Date</Label>
                            <DateInput
                                value={fromDate}
                                max={toDate || undefined}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="h-11"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="text-base font-semibold">To Date</Label>
                            <DateInput
                                value={toDate}
                                min={fromDate || undefined}
                                onChange={(e) => setToDate(e.target.value)}
                                className="h-11"
                            />
                        </div>

                        <div className="flex items-end">
                            <Button
                                type="button"
                                onClick={handleSearch}
                                disabled={!canSearch || isSearching}
                                className="h-11 w-full bg-sidebar-accent hover:bg-sidebar-accent"
                            >
                                {isSearching ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching...
                                    </>
                                ) : (
                                    <>
                                        <Search className="mr-2 h-4 w-4" /> Search
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    <div className="mt-6 flex items-center gap-3 border-t pt-4">
                        <Switch
                            checked={showReverted}
                            onCheckedChange={(checked) => {
                                setShowReverted(checked);
                                setHasSearched(false);
                                setRows([]);
                            }}
                        />
                        <div>
                            <Label className="text-sm font-semibold">Show Reverted Preclosures</Label>
                            <p className="text-xs text-muted-foreground">
                                {showReverted
                                    ? 'Viewing reverted preclosures — showing who reverted each one and when. Click Search to load.'
                                    : 'Off shows active preclosures. Turn on and click Search to view the reverted history instead.'}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Results */}
            {isSearching && (
                <Card>
                    <CardContent className="py-4">
                        <PageLoader label="Searching preclosure records..." fullScreen={false} />
                    </CardContent>
                </Card>
            )}

            {!isSearching && hasSearched && rows.length > 0 && (
                <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-end mb-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search foreclosure records..."
                            />
                        </div>
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader className="bg-red-800 text-white">
                                    <TableRow className="hover:bg-red-800">
                                        <TableHead className="text-white">S.No</TableHead>
                                        <TableHead className="text-white">Preclosure Date</TableHead>
                                        <TableHead className="text-white">Client Name</TableHead>
                                        <TableHead className="text-white">Loan Account</TableHead>
                                        <TableHead className="text-white">Amount Collected</TableHead>
                                        <TableHead className="text-white">Collected By</TableHead>
                                        <TableHead className="text-white">Approved By</TableHead>
                                        {showReverted ? (
                                            <>
                                                <TableHead className="text-white">Reverted By</TableHead>
                                                <TableHead className="text-white">Reverted On</TableHead>
                                                <TableHead className="text-white">Revert Reason</TableHead>
                                                <TableHead className="text-white">Revert Location</TableHead>
                                            </>
                                        ) : (
                                            <TableHead className="text-white">Action</TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map((row, idx) => (
                                        <TableRow key={row.transactionId} className="even:bg-green-50 dark:even:bg-brand-green-darker/50">
                                            <TableCell>{idx + 1}</TableCell>
                                            <TableCell>{format(new Date(row.transactionDate), 'dd/MM/yyyy')}</TableCell>
                                            <TableCell className="font-medium">{row.clientName}</TableCell>
                                            <TableCell className="font-mono text-xs">{row.loanAccountNo}</TableCell>
                                            <TableCell>
                                                <div className="font-mono text-xs leading-tight whitespace-nowrap">
                                                    <div>Principal : {formatCurrency(row.principalAmount)}</div>
                                                    <div>Interest&nbsp;&nbsp;: {formatCurrency(row.interestAmount)}</div>
                                                    <div className="my-0.5 border-t border-dashed border-current" />
                                                    <div className="font-semibold">Total&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {formatCurrency(row.amount)}</div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {row.collectedByName}
                                                {row.collectedByEmployeeId && (
                                                    <span className="block text-muted-foreground">({row.collectedByEmployeeId})</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-xs">{row.approvedByName ?? '-'}</TableCell>
                                            {showReverted ? (
                                                <>
                                                    <TableCell className="text-xs">
                                                        {row.revertedByName ?? '-'}
                                                        {row.revertedByEmployeeId && (
                                                            <span className="block text-muted-foreground">({row.revertedByEmployeeId})</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        {row.revertedAt ? format(new Date(row.revertedAt), 'dd/MM/yyyy hh:mm a') : '-'}
                                                    </TableCell>
                                                    <TableCell className="text-xs max-w-[220px] whitespace-pre-wrap break-words">
                                                        {row.revertReason ?? '-'}
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        <RevertLocationCell location={row.revertLocation} />
                                                    </TableCell>
                                                </>
                                            ) : (
                                                <TableCell>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => handleRevertClick(row)}
                                                        title={getRevertBlockedReason(row) ?? undefined}
                                                        className={cn(
                                                            'text-white',
                                                            row.canRevert && canRevertForeclosure
                                                                ? 'bg-red-600 hover:bg-red-700'
                                                                : 'bg-gray-400 hover:bg-gray-400 cursor-not-allowed opacity-70'
                                                        )}
                                                    >
                                                        Revert
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!isSearching && hasSearched && rows.length === 0 && (
                <Card className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-lg font-semibold text-muted-foreground mb-2">No Records Found</p>
                        <p className="text-sm text-muted-foreground text-center">
                            {showReverted
                                ? 'No reverted preclosures match the selected filters.'
                                : 'No preclosure records match the selected filters.'}
                        </p>
                    </CardContent>
                </Card>
            )}

            {!isSearching && !hasSearched && (
                <Card className="border-2 border-dashed border-primary/30 dark:border-sidebar-accent">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Search className="h-12 w-12 text-muted-foreground mb-4" />
                        <p className="text-sm text-muted-foreground text-center">
                            Use the filters above and click Search to view preclosure records.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Revert Confirmation Dialog */}
            <RevertReasonDialog
                open={revertDialogOpen}
                onOpenChange={(open) => { setRevertDialogOpen(open); if (!open) setSelectedRow(null); }}
                onConfirm={handleRevert}
                title="Revert Preclosure"
                description="Are you sure you want to revert this preclosure? This action will restore the loan to Active status and reverse all preclosure transactions."
                isSubmitting={isReverting}
            />
        </div>
    );
}
