'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { LocalBranchFilter } from '@/components/branch/LocalBranchFilter';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    ArrowRightLeft,
    CheckCircle2,
    Loader2,
    Search,
    Trash2,
    Users,
    Calendar,
    UserCheck,
    AlertCircle,
    TrendingUp,
    FileText,
    AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

// Types
type FDO = {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    fullName?: string;
};

type Center = {
    id: string;
    name: string;
    code: string;
    meetingDay: string | null;
    fdoId: string | null;
    fdoName: string | null;
    branchId: string;
};

type CenterTransferRow = Center & {
    selected: boolean;
    transferredToFdoId: string | null;
    transferredToFdoName: string | null;
    previousFdoId?: string | null;
    previousFdoName?: string | null;
    transferId?: string; // ID of the transfer record in database
};

type TransferMetadata = {
    meetingDays: string[];
    assignedFDOs: FDO[];
    availableFDOs: FDO[];
};

const WEEK_DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
] as const;

/**
 * Center Transfer Client Component
 * 
 * Expert UI Changes:
 * - Added explicit Center Selection Table
 * - Added Confirmation Dialog before save
 * - Cleaned up visual hierarchy
 * - Improved empty states and guidances
 * - Fixed Hydration Mismatch issues
 * - Fixed Layout Overlap issues (Sticky Footer)
 * - Fixed Footer Alignment (Floating Dock Style)
 */
export function CenterTransferClient() {
    const { canPage } = usePermission();
    const canEditCenter = canPage('/dashboard/centers/transfer', 'edit');
    const { toast } = useToast();

    // State
    const [centers, setCenters] = useState<CenterTransferRow[]>([]);
    const [availableFDOs, setAvailableFDOs] = useState<FDO[]>([]);
    const [assignedFDOs, setAssignedFDOs] = useState<FDO[]>([]);
    const [meetingDays, setMeetingDays] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [savedTransfers, setSavedTransfers] = useState<CenterTransferRow[]>([]);

    // Auth & Hydration state
    const [branchId, setBranchId] = useState<string | null>(null);
    const [isMounted, setIsMounted] = useState(false);

    // Filter state
    const [selectedMeetingDay, setSelectedMeetingDay] = useState<string>('all');
    const [selectedOfficerId, setSelectedOfficerId] = useState<string>('all');
    const [changeOfficerId, setChangeOfficerId] = useState<string>('');
    const [selectAll, setSelectAll] = useState(false);

    // Dialog states
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [centerToDelete, setCenterToDelete] = useState<CenterTransferRow | null>(null);
    const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);

    // Initialize component safely
    useEffect(() => {
        setIsMounted(true);
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        const id = activeBranch?.id || storedUser?.branchId || null;
        setBranchId(id);
    }, []);

    // Clear selection when Current Officer changes to prevent mixing
    useEffect(() => {
        setSelectAll(false);
        setCenters(prev => prev.map(c => ({ ...c, selected: false })));
    }, [selectedOfficerId]);

    // Fetch centers
    const fetchCenters = useCallback(async () => {
        if (!branchId) return;

        setIsLoading(true);
        try {
            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${branchId}&includeInactive=true`
            );

            if (result.success && result.data) {
                const centersWithTransfer: CenterTransferRow[] = result.data.map((center) => ({
                    ...center,
                    selected: false,
                    transferredToFdoId: null,
                    transferredToFdoName: null,
                }));
                // Sort by name for easier scanning
                centersWithTransfer.sort((a, b) => a.name.localeCompare(b.name));
                setCenters(centersWithTransfer);
            } else {
                toast({
                    title: 'Warning',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
        } finally {
            setIsLoading(false);
        }
    }, [branchId, toast]);

    // Fetch transfer metadata (meeting days, assigned FDOs, available FDOs)
    const fetchTransferMetadata = useCallback(async () => {
        if (!branchId) return;

        try {
            const result = await apiClient.get<TransferMetadata>(
                `/centers/transfer/metadata?branchId=${branchId}`
            );

            if (result.success && result.data) {
                setMeetingDays(result.data.meetingDays);
                setAssignedFDOs(result.data.assignedFDOs);
                setAvailableFDOs(result.data.availableFDOs);
            } else {
                toast({
                    title: 'Warning',
                    description: result.error || 'Failed to load transfer metadata.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching transfer metadata:', error);
            toast({
                title: 'Error',
                description: 'Failed to load transfer metadata. Please try again.',
                variant: 'destructive',
            });
        }
    }, [branchId, toast]);

    // Fetch transfer history from database
    const fetchTransferHistory = useCallback(async () => {
        if (!branchId) return;

        try {
            const result = await apiClient.get<CenterTransferRow[]>(
                `/centers/transfer/history`
            );

            if (result.success && result.data) {
                setSavedTransfers(result.data);
            } else {
                console.error('Failed to fetch transfer history:', result.error);
                setSavedTransfers([]);
            }
        } catch (error) {
            console.error('Error fetching transfer history:', error);
            setSavedTransfers([]);
        }
    }, [branchId]);

    // Trigger fetches when branchId is available
    useEffect(() => {
        if (branchId) {
            fetchCenters();
            fetchTransferMetadata();
            fetchTransferHistory();
        }
    }, [branchId, fetchCenters, fetchTransferMetadata, fetchTransferHistory]);

    // Filter centers based on selected filters
    const filteredCenters = useMemo(() => {
        // Only show centers if a Current Officer is selected
        if (selectedOfficerId === 'all') return [];

        return centers.filter((center) => {
            // Must belong to selected officer
            if (center.fdoId !== selectedOfficerId) {
                return false;
            }
            // Optional meeting day filter
            if (selectedMeetingDay !== 'all' && center.meetingDay !== selectedMeetingDay) {
                return false;
            }
            return true;
        });
    }, [centers, selectedMeetingDay, selectedOfficerId]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(filteredCenters);
    const { query: tableSearchQuery2, setQuery: setTableSearchQuery2, filtered: searchedRows2 } = useTableSearch(savedTransfers);

    // Update select all header checkbox state
    useEffect(() => {
        if (filteredCenters.length === 0) {
            setSelectAll(false);
            return;
        }
        const allSelected = filteredCenters.every((c) => c.selected);
        setSelectAll(allSelected);
    }, [filteredCenters, centers]); // Depend on centers to catch deep updates

    // Handle select all toggle
    const handleSelectAll = (checked: boolean) => {
        setSelectAll(checked);
        setCenters((prev) =>
            prev.map((center) => {
                // Only toggle items currently visible in the filter
                const isVisible = filteredCenters.some((fc) => fc.id === center.id);
                if (isVisible) {
                    return { ...center, selected: checked };
                }
                return center;
            })
        );
    };

    // Handle individual center selection
    const handleCenterSelect = (centerId: string, checked: boolean) => {
        setCenters((prev) =>
            prev.map((center) =>
                center.id === centerId ? { ...center, selected: checked } : center
            )
        );
    };

    // Calculate summary stats
    const summaryStats = useMemo(() => {
        const selectedCenters = filteredCenters.filter((c) => c.selected);
        return {
            total: filteredCenters.length,
            selected: selectedCenters.length,
        };
    }, [filteredCenters]);

    // Initial validation before opening confirmation
    const handlePreSaveValidation = () => {
        if (selectedOfficerId === 'all') {
            toast({ title: 'Validation Needed', description: 'Please select a Current Officer.', variant: 'destructive' });
            return;
        }
        if (!changeOfficerId) {
            toast({ title: 'Validation Needed', description: 'Please select a Transfer To Officer.', variant: 'destructive' });
            return;
        }
        if (summaryStats.selected === 0) {
            toast({ title: 'Validation Needed', description: 'Please select at least one center to transfer.', variant: 'destructive' });
            return;
        }

        // Open confirmation dialog
        setConfirmTransferOpen(true);
    };

    // Handle save (executed after confirmation)
    const handleExecuteTransfer = async () => {
        if (selectedOfficerId === 'all' || !changeOfficerId) return;

        // Get ONLY selected centers
        const centersToTransfer = centers.filter((center) => {
            return center.fdoId === selectedOfficerId && center.selected;
        });

        setIsSaving(true);
        setConfirmTransferOpen(false); // Close dialog

        try {
            const transfers = centersToTransfer.map((center) => ({
                centerId: center.id,
                fdoId: changeOfficerId,
            }));

            const result = await apiClient.post<{
                total: number;
                successful: number;
                failed: number;
            }>('/centers/transfer', {
                transfers,
                fromFdoId: selectedOfficerId,
            });

            if (result.success && result.data) {
                const { successful, failed } = result.data;

                if (failed > 0) {
                    toast({
                        title: 'Partial Success',
                        description: `Transferred ${successful} center(s). ${failed} failed.`,
                        variant: 'destructive',
                    });
                } else {
                    toast({
                        title: 'Transfer Complete',
                        description: `Successfully transferred ${successful} center(s).`,
                    });
                }

                // Reset and refresh
                handleReset();
                await Promise.all([
                    fetchCenters(),
                    fetchTransferMetadata(),
                    fetchTransferHistory(),
                ]);
            } else {
                throw new Error(result.error || 'Transfer failed');
            }
        } catch (error) {
            console.error('Error saving transfers:', error);
            toast({
                title: 'Error',
                description: 'Failed to process transfer. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    // Handle reset
    const handleReset = () => {
        setSelectedMeetingDay('all');
        setSelectedOfficerId('all');
        setChangeOfficerId('');
        setSelectAll(false);
        setCenters((prev) =>
            prev.map((center) => ({
                ...center,
                selected: false,
                transferredToFdoId: null,
                transferredToFdoName: null,
            }))
        );
    };

    // Handle delete saved transfer
    const handleDeleteSavedTransfer = (centerId: string) => {
        const transfer = savedTransfers.find((t) => t.id === centerId);
        if (transfer) {
            setCenterToDelete(transfer);
            setDeleteDialogOpen(true);
        }
    };

    const handleDeleteConfirm = async () => {
        if (!centerToDelete || !centerToDelete.transferId) return;

        try {
            const result = await apiClient.delete('/centers/transfer/history', {
                transferId: centerToDelete.transferId,
                centerId: centerToDelete.id,
            });

            if (result.success) {
                toast({
                    title: 'Reverted',
                    description: `Transfer reverted. User assigned back to ${centerToDelete.previousFdoName}.`,
                });
                await Promise.all([
                    fetchCenters(),
                    fetchTransferMetadata(),
                    fetchTransferHistory(),
                ]);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to revert transfer.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error reverting transfer:', error);
            toast({
                title: 'Error',
                description: 'Failed to revert transfer.',
                variant: 'destructive',
            });
        } finally {
            setDeleteDialogOpen(false);
            setCenterToDelete(null);
        }
    };

    const sourceOfficerName = assignedFDOs.find(f => f.id === selectedOfficerId)?.fullName;
    const targetOfficerName = availableFDOs.find(f => f.id === changeOfficerId)?.fullName;

    // Prevent hydration mismatch
    if (!isMounted) {
        return (
            <div className="space-y-6">
                <PageHeader
                    title="Center Transfer"
                    description="Loading..."
                />
                <Card className="border border-primary/20/50 bg-white/80 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/80">
                    <CardHeader>
                        <Skeleton className="h-8 w-1/3" />
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-6 sm:grid-cols-3">
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-1/2" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-1/2" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-1/2" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card><CardContent className="h-64"><div className="flex size-full items-center justify-center"><Loader2 className="animate-spin text-slate-300" /></div></CardContent></Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Center Transfer"
                description="Reassign centers from one officer to another."
            />

            {/* Branch — page-local filter only (Admin/Area Manager); does not switch
                the session-wide active branch. */}
            <Card className="border border-primary/20/50 bg-white/80 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/80">
                <CardContent className="pt-4 pb-4">
                    <LocalBranchFilter
                        value={branchId ?? ''}
                        onChange={(id) => {
                            setBranchId(id);
                            setSelectedOfficerId('all');
                            setChangeOfficerId('');
                        }}
                    />
                </CardContent>
            </Card>

            {/* Filter Section */}
            <Card className="border border-primary/20/50 bg-white/80 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/80">
                <CardHeader>
                    <CardTitle className="text-lg">Step 1: Select Routing Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-6 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="officer">Transfer From (Current Officer)</Label>
                            <Select
                                value={selectedOfficerId}
                                onValueChange={setSelectedOfficerId}
                            >
                                <SelectTrigger id="officer" className="w-full">
                                    <SelectValue placeholder="Select Officer" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Select Source Officer...</SelectItem>
                                    {assignedFDOs.map((fdo) => (
                                        <SelectItem key={fdo.id} value={fdo.id}>
                                            {fdo.fullName || `${fdo.firstName} ${fdo.lastName}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500">
                                This will load all centers currently assigned to this officer.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="change-officer">Transfer To (Available Officer)</Label>
                            <Select
                                value={changeOfficerId}
                                onValueChange={setChangeOfficerId}
                            >
                                <SelectTrigger id="change-officer" className={cn("w-full transition-colors",
                                    !changeOfficerId && "border-dashed border-slate-400 bg-green-50/50 dark:border-sidebar-accent dark:bg-brand-green-darker/50"
                                )}>
                                    <SelectValue placeholder="Select Target Officer" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableFDOs
                                        .filter((fdo) => fdo.id !== selectedOfficerId || selectedOfficerId === 'all')
                                        .map((fdo) => (
                                            <SelectItem key={fdo.id} value={fdo.id}>
                                                {fdo.fullName || `${fdo.firstName} ${fdo.lastName}`}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="meeting-day">Filter by Meeting Day (Optional)</Label>
                            <Select
                                value={selectedMeetingDay}
                                onValueChange={setSelectedMeetingDay}
                            >
                                <SelectTrigger id="meeting-day">
                                    <SelectValue placeholder="All Days" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Days</SelectItem>
                                    {WEEK_DAYS.map((day) => (
                                        <SelectItem key={day} value={day}>
                                            {day}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Selection Table - Only visible if source officer selected */}
            <Card className={cn("border border-primary/20/50 bg-white/80 transition-all duration-300 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/80",
                selectedOfficerId === 'all' ? "opacity-60" : "opacity-100 ring-2 ring-primary/10"
            )}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                        <CardTitle className="text-lg">Step 2: Select Centers</CardTitle>
                        <CardDescription>
                            {selectedOfficerId === 'all'
                                ? "Select a 'Transfer From' officer above to see their centers."
                                : `Showing ${searchedRows.length} centers for ${sourceOfficerName}. Select ones to move.`
                            }
                        </CardDescription>
                    </div>
                    {summaryStats.selected > 0 && (
                        <Badge className="bg-primary text-white hover:bg-sidebar-accent">
                            {summaryStats.selected} Selected
                        </Badge>
                    )}
                </CardHeader>
                <CardContent>
                    {selectedOfficerId === 'all' ? (
                        <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-primary/20 bg-green-50 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                            <Users className="mb-2 size-8 text-slate-300" />
                            <p className="text-sm font-medium text-slate-500">Waiting for selection...</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-4">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search centers..."
                                className="ml-auto"
                            />
                        </div>
                        <div className="rounded-md border border-primary/20 dark:border-sidebar-accent overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50 hover:bg-green-50 dark:bg-brand-green-darker dark:hover:bg-brand-green-darker">
                                        <TableHead className="w-12">
                                            <Checkbox
                                                checked={selectAll}
                                                onCheckedChange={handleSelectAll}
                                                aria-label="Select all"
                                            />
                                        </TableHead>
                                        <TableHead>Center Name / Code</TableHead>
                                        <TableHead>Meeting Day</TableHead>
                                        <TableHead>Location Details</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-24 text-center">
                                                No centers found for this filter criteria.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        searchedRows.map((center) => (
                                            <TableRow
                                                key={center.id}
                                                className={cn("cursor-pointer transition-colors",
                                                    center.selected
                                                        ? "bg-green-50/60 dark:bg-brand-green-darker/10"
                                                        : "hover:bg-green-50 dark:hover:bg-sidebar-accent/50"
                                                )}
                                                onClick={() => handleCenterSelect(center.id, !center.selected)}
                                            >
                                                <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox
                                                        checked={center.selected}
                                                        onCheckedChange={(checked) => handleCenterSelect(center.id, checked as boolean)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium text-foreground dark:text-slate-100">{center.name}</div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400">{center.code}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={cn(
                                                        "min-w-[80px] justify-center",
                                                        center.meetingDay ? "bg-white dark:bg-green-950" : "opacity-50"
                                                    )}>
                                                        {center.meetingDay || "N/A"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm text-sidebar-accent dark:text-slate-400">
                                                    {center.branchId ? "Main Branch" : "Remote"}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* History Table */}
            <Card className="border border-primary/20/50 bg-white/80 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/80">
                <CardHeader>
                    <CardTitle className="text-lg">Recent Transfer History</CardTitle>
                    <CardDescription>
                        Centers transferred in the last 7 days. You can revert mistakes here.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-center gap-4 mb-3">
                        <TableSearchInput
                            value={tableSearchQuery2}
                            onChange={setTableSearchQuery2}
                            placeholder="Search transfer history..."
                            className="ml-auto"
                        />
                    </div>
                    <div className="overflow-x-auto rounded-md border border-primary/20 dark:border-sidebar-accent">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Center</TableHead>
                                    <TableHead>Meeting Schedule</TableHead>
                                    <TableHead>Previous Officer</TableHead>
                                    <TableHead>Assigned To</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {searchedRows2.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-sm text-slate-500">
                                            No recent transfers found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    searchedRows2.map((center) => (
                                        <TableRow key={center.id}>
                                            <TableCell>
                                                <div className="font-medium">{center.name}</div>
                                                <div className="text-xs text-slate-500 text-nowrap">{center.code}</div>
                                            </TableCell>
                                            <TableCell className="text-sm text-sidebar-accent">
                                                {center.meetingDay || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex size-6 items-center justify-center rounded-full bg-brand-green-tint text-xs font-semibold text-sidebar-accent dark:bg-sidebar-accent dark:text-slate-300">
                                                        {center.previousFdoName?.charAt(0) || '?'}
                                                    </div>
                                                    <span className="text-sm">{center.previousFdoName || 'Unassigned'}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2 rounded-full bg-green-50 px-2 py-1 text-primary dark:bg-brand-green-darker/30 dark:text-primary w-fit">
                                                    <ArrowRightLeft className="size-3" />
                                                    <span className="text-sm font-semibold">{center.transferredToFdoName}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {canEditCenter && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDeleteSavedTransfer(center.id)}
                                                        className="h-8 p-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30"
                                                        title="Revert this transfer"
                                                    >
                                                        <Trash2 className="size-4" />
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Sticky Action Bar -- Fixed Alignment to Floating Dock */}
            <div className="sticky bottom-6 mt-6 rounded-xl border border-primary/20/50 bg-white/95 px-6 py-4 backdrop-blur shadow-lg dark:border-sidebar-accent/50 dark:bg-green-950/95">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="hidden text-sm text-slate-500 sm:block">
                            {summaryStats.selected > 0
                                ? `${summaryStats.selected} center(s) ready to transfer`
                                : "Select centers to enable transfer"}
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={handleReset}
                            disabled={isSaving}
                        >
                            Cancel / Reset
                        </Button>
                        <Button
                            onClick={handlePreSaveValidation}
                            disabled={!canEditCenter || isSaving || summaryStats.selected === 0 || !changeOfficerId}
                            className="bg-primary text-white hover:bg-sidebar-accent"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="mr-2 size-4" />
                                    Confirm Transfer
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Confirm Transfer Dialog */}
            <Dialog open={confirmTransferOpen} onOpenChange={setConfirmTransferOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-primary dark:text-primary">
                            <AlertTriangle className="size-5" />
                            Confirm Transfer
                        </DialogTitle>
                        <DialogDescription>
                            Please review the transfer details carefully.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="rounded-lg bg-green-50 p-4 dark:bg-sidebar-accent">
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
                                <div className="text-center font-semibold text-sidebar-accent dark:text-slate-300">
                                    {sourceOfficerName || 'Source'}
                                </div>
                                <ArrowRightLeft className="size-4 text-slate-400" />
                                <div className="text-center font-semibold text-primary dark:text-primary">
                                    {targetOfficerName || 'Target'}
                                </div>
                            </div>
                            <div className="mt-3 text-center text-xs text-slate-500">
                                Moving <span className="font-bold text-foreground dark:text-slate-100">{summaryStats.selected}</span> Center(s)
                            </div>
                        </div>

                        <p className="text-sm text-slate-500">
                            These centers and all their associated client records will be reassigned immediately.
                        </p>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmTransferOpen(false)}>Back</Button>
                        <Button
                            className="bg-primary hover:bg-sidebar-accent"
                            onClick={handleExecuteTransfer}
                        >
                            Yes, Transfer Centers
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Revert/Delete Dialog */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Revert Transfer</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to revert the transfer for "{centerToDelete?.name}"?
                            It will be assigned back to {centerToDelete?.previousFdoName || 'Previous Officer'}.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteConfirm}>
                            Revert Transfer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
