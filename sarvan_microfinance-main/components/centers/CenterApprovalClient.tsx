'use client';

import { useState, useEffect } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Loader2,
    RefreshCw,
    Eye,
    ThumbsUp,
    ThumbsDown,
    CheckCircle2,
    XCircle,
    Clock,
    ShieldCheck,
} from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage, type StoredUser } from '@/app/lib/token-storage';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

interface ApprovalCenter {
    id: string;
    name: string;
    code: string;
    branchId: string;
    address?: string | null;
    localArea?: string | null;
    fdoId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    kmFromBranch?: number | null;
    contactPerson?: string | null;
    contactNumber?: string | null;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    rejectionReason?: string | null;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    fdoName?: string | null;
    fdo?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    branch?: {
        id: string;
        name: string;
        code: string;
    } | null;
    createdBy?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    approvedBy?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
}

const statusConfig = {
    PENDING_APPROVAL: {
        label: 'Pending Approval',
        className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300',
        icon: Clock,
    },
    APPROVED: {
        label: 'Approved',
        className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300',
        icon: CheckCircle2,
    },
    REJECTED: {
        label: 'Rejected',
        className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300',
        icon: XCircle,
    },
};

export function CenterApprovalClient() {
    const { toast } = useToast();
    const [centers, setCenters] = useState<ApprovalCenter[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('PENDING_APPROVAL');
    const [searchQuery, setSearchQuery] = useState('');

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // View dialog
    const [viewCenter, setViewCenter] = useState<ApprovalCenter | null>(null);

    // Approve/Reject dialog
    const [actionCenter, setActionCenter] = useState<ApprovalCenter | null>(null);
    const [actionType, setActionType] = useState<'APPROVE' | 'REJECT' | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // Read from localStorage only after mount — reading it during the initial
    // render would return real data on the client but null on the server,
    // causing a hydration mismatch on any UI gated by canApprove.
    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
    useEffect(() => {
        setCurrentUser(tokenStorage.getUser());
    }, []);
    const userRole = currentUser?.role;
    const canApprove = userRole === 'BRANCH_MANAGER' || userRole === 'AREA_MANAGER' || userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH';
    const isAdminOrAM = userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH' || userRole === 'AREA_MANAGER';

    // Load the branch list for the ADMIN/AREA_MANAGER filter — AM scoped to their assignedBranchIds
    useEffect(() => {
        if (!currentUser || !isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                let list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (userRole === 'AREA_MANAGER') {
                    const assignedBranchIds = (currentUser as any)?.assignedBranchIds ?? [];
                    if (assignedBranchIds.length > 0) {
                        list = list.filter((b) => assignedBranchIds.includes(b.id));
                    }
                }
                setBranches(list);
            })
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            })
            .finally(() => setIsLoadingBranches(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser, isAdminOrAM, userRole]);

    const fetchCenters = async () => {
        setIsLoading(true);
        try {
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id || currentUser?.branchId;

            let url = '/centers?includeInactive=false';
            if (statusFilter !== 'all') {
                url += `&status=${statusFilter}`;
            }
            if (userRole === 'BRANCH_MANAGER') {
                // BM is scoped to their own branch
                if (branchId) url += `&branchId=${branchId}`;
            } else if (isAdminOrAM && selectedBranchId !== 'all') {
                // ADMIN / AREA_MANAGER narrowed to one branch via the filter
                url += `&branchId=${selectedBranchId}`;
            }

            const result = await apiClient.get<ApprovalCenter[]>(url);
            if (result.success && result.data) {
                setCenters(result.data);
            } else {
                toast({
                    title: 'Warning',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        } catch (error) {
            console.error('Error fetching centers for approval:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCenters();
    }, [statusFilter, currentUser, selectedBranchId]);

    const handleApproveReject = async () => {
        if (!actionCenter || !actionType) return;
        if (actionType === 'REJECT' && !rejectionReason.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Rejection reason is required',
                variant: 'destructive',
            });
            return;
        }

        setIsProcessing(true);
        try {
            const result = await apiClient.post(`/centers/${actionCenter.id}/approve`, {
                action: actionType,
                rejectionReason: actionType === 'REJECT' ? rejectionReason.trim() : null,
            });

            if (result.success) {
                toast({
                    title: 'Success',
                    description: actionType === 'APPROVE' ? 'Center approved successfully.' : 'Center rejected.',
                });
                setActionCenter(null);
                setActionType(null);
                setRejectionReason('');
                await fetchCenters();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to process center.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error processing center approval:', error);
            toast({
                title: 'Error',
                description: 'Network error. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const filteredCenters = centers.filter((c) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            (c.fdoName ?? '').toLowerCase().includes(q) ||
            (c.branch?.name ?? '').toLowerCase().includes(q) ||
            (c.contactPerson ?? '').toLowerCase().includes(q)
        );
    });

    const pendingCount = centers.filter((c) => c.status === 'PENDING_APPROVAL').length;

    return (
        <>
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
                <div>
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white flex items-center gap-2">
                        <ShieldCheck className="h-6 w-6 text-sidebar-accent" />
                        Center Approval
                    </h1>
                    <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                        {canApprove
                            ? 'Review and approve or reject center creation requests.'
                            : 'Monitor center approval status for your branch.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {pendingCount > 0 && statusFilter === 'PENDING_APPROVAL' && (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                            {pendingCount} pending
                        </Badge>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchCenters}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="mb-4 border-primary/20">
                <CardContent className="pt-4 pb-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                            <Input
                                placeholder="Search by center name, code, FDO, branch..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-9 border-primary/30"
                            />
                        </div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-9 w-[200px] border-primary/30">
                                <SelectValue placeholder="Filter by status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                                <SelectItem value="APPROVED">Approved</SelectItem>
                                <SelectItem value="REJECTED">Rejected</SelectItem>
                                <SelectItem value="all">All Statuses</SelectItem>
                            </SelectContent>
                        </Select>
                        {isAdminOrAM && (
                            <Select
                                value={selectedBranchId}
                                onValueChange={setSelectedBranchId}
                                disabled={isLoadingBranches}
                            >
                                <SelectTrigger className="h-9 w-[200px] border-primary/30">
                                    <SelectValue placeholder="Filter by branch" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        {userRole === 'AREA_MANAGER' ? 'All Assigned Branches' : 'All Branches'}
                                    </SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>
                                            {b.code} - {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card className="border-primary/20 shadow-sm">
                <CardHeader className="pb-0">
                    <CardTitle className="text-base text-foreground dark:text-white">
                        Center Requests
                    </CardTitle>
                    <CardDescription>
                        {isLoading ? 'Loading...' : `${filteredCenters.length} center${filteredCenters.length !== 1 ? 's' : ''} found`}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <PageLoader fullScreen={false} />
                    ) : filteredCenters.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                            <ShieldCheck className="h-12 w-12 mb-2 opacity-30" />
                            <p className="text-sm">No centers found</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/60 dark:bg-brand-green-darker/40">
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Center ID</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Center Name</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Branch</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">FDO Name</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Contact Person</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Contact No.</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">KM</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Coordinates</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Created</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent">Status</TableHead>
                                        <TableHead className="text-xs font-semibold text-sidebar-accent text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredCenters.map((center) => {
                                        const statusInfo = statusConfig[center.status];
                                        return (
                                            <TableRow key={center.id} className="hover:bg-green-50/40 dark:hover:bg-brand-green-darker/20">
                                                <TableCell className="text-xs font-mono font-medium">{center.code}</TableCell>
                                                <TableCell className="text-xs font-medium max-w-[140px] truncate" title={center.name}>
                                                    {center.name}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                                                    {center.branch?.name || '—'}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                                                    {center.fdoName || (center.fdo ? `${center.fdo.firstName} ${center.fdo.lastName}` : '—')}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                                                    {center.contactPerson || '—'}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                                                    {center.contactNumber || '—'}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                                                    {center.kmFromBranch != null ? `${center.kmFromBranch} km` : '—'}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500 font-mono">
                                                    {center.latitude && center.longitude
                                                        ? `${Number(center.latitude).toFixed(4)}, ${Number(center.longitude).toFixed(4)}`
                                                        : '—'}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                                                    {toDisplayDate(new Date(center.createdAt))}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-xs whitespace-nowrap ${statusInfo.className}`}
                                                    >
                                                        {statusInfo.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setViewCenter(center)}
                                                            className="h-7 w-7 p-0 text-slate-500 hover:text-sidebar-accent"
                                                            title="View Details"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        {canApprove && center.status === 'PENDING_APPROVAL' && (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => { setActionCenter(center); setActionType('APPROVE'); }}
                                                                    className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                                    title="Approve"
                                                                >
                                                                    <ThumbsUp className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => { setActionCenter(center); setActionType('REJECT'); }}
                                                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                                                    title="Reject"
                                                                >
                                                                    <ThumbsDown className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* View Details Dialog */}
            <Dialog open={!!viewCenter} onOpenChange={(open) => !open && setViewCenter(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-foreground dark:text-white flex items-center gap-2">
                            Center Details — {viewCenter?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Center ID: {viewCenter?.code}
                        </DialogDescription>
                    </DialogHeader>
                    {viewCenter && (
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Branch</p>
                                    <p className="font-medium text-foreground dark:text-white">{viewCenter.branch?.name || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Status</p>
                                    <Badge variant="outline" className={`text-xs ${statusConfig[viewCenter.status].className}`}>
                                        {statusConfig[viewCenter.status].label}
                                    </Badge>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">FDO (Creator)</p>
                                    <p className="font-medium">
                                        {viewCenter.fdo
                                            ? `${viewCenter.fdo.firstName} ${viewCenter.fdo.lastName}`
                                            : viewCenter.createdBy
                                                ? `${viewCenter.createdBy.firstName} ${viewCenter.createdBy.lastName}`
                                                : '—'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Contact Person</p>
                                    <p className="font-medium">{viewCenter.contactPerson || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Contact Number</p>
                                    <p className="font-medium">{viewCenter.contactNumber || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">KM from Branch</p>
                                    <p className="font-medium">{viewCenter.kmFromBranch != null ? `${viewCenter.kmFromBranch} km` : '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Latitude</p>
                                    <p className="font-mono">{viewCenter.latitude ?? '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Longitude</p>
                                    <p className="font-mono">{viewCenter.longitude ?? '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Address</p>
                                    <p>{viewCenter.address || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Local Area</p>
                                    <p>{viewCenter.localArea || '—'}</p>
                                </div>
                            </div>

                            {/* Audit Trail */}
                            <div className="border-t pt-3 space-y-2">
                                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">Audit Trail</p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                    <div>
                                        <p className="text-xs text-slate-500">Created By</p>
                                        <p className="font-medium text-xs">
                                            {viewCenter.createdBy
                                                ? `${viewCenter.createdBy.firstName} ${viewCenter.createdBy.lastName}`
                                                : '—'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500">Created At</p>
                                        <p className="text-xs">
                                            {toDisplayDateTime(new Date(viewCenter.createdAt))}
                                        </p>
                                    </div>
                                    {viewCenter.approvedBy && (
                                        <>
                                            <div>
                                                <p className="text-xs text-slate-500">
                                                    {viewCenter.status === 'APPROVED' ? 'Approved By' : 'Reviewed By'}
                                                </p>
                                                <p className="font-medium text-xs">
                                                    {`${viewCenter.approvedBy.firstName} ${viewCenter.approvedBy.lastName}`}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500">
                                                    {viewCenter.status === 'APPROVED' ? 'Approved At' : 'Reviewed At'}
                                                </p>
                                                <p className="text-xs">
                                                    {viewCenter.approvedAt
                                                        ? toDisplayDateTime(new Date(viewCenter.approvedAt))
                                                        : '—'}
                                                </p>
                                            </div>
                                        </>
                                    )}
                                    {viewCenter.rejectionReason && (
                                        <div className="col-span-2">
                                            <p className="text-xs text-slate-500">Rejection Reason</p>
                                            <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                                                {viewCenter.rejectionReason}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {canApprove && viewCenter.status === 'PENDING_APPROVAL' && (
                                <div className="flex gap-2 pt-2 border-t">
                                    <Button
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                        onClick={() => { setViewCenter(null); setActionCenter(viewCenter); setActionType('APPROVE'); }}
                                    >
                                        <ThumbsUp className="h-4 w-4 mr-1" />
                                        Approve
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-red-300 text-red-600 hover:bg-red-50"
                                        onClick={() => { setViewCenter(null); setActionCenter(viewCenter); setActionType('REJECT'); }}
                                    >
                                        <ThumbsDown className="h-4 w-4 mr-1" />
                                        Reject
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Approve/Reject Confirmation Dialog */}
            <Dialog
                open={!!actionCenter && !!actionType}
                onOpenChange={(open) => {
                    if (!open) {
                        setActionCenter(null);
                        setActionType(null);
                        setRejectionReason('');
                    }
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className={actionType === 'APPROVE' ? 'text-green-700' : 'text-red-600'}>
                            {actionType === 'APPROVE' ? (
                                <span className="flex items-center gap-2">
                                    <CheckCircle2 className="h-5 w-5" />
                                    Approve Center
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <XCircle className="h-5 w-5" />
                                    Reject Center
                                </span>
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            {actionType === 'APPROVE'
                                ? `Approve "${actionCenter?.name}" (${actionCenter?.code})? It will become active and available for operations.`
                                : `Reject "${actionCenter?.name}" (${actionCenter?.code})? Please provide a reason.`}
                        </DialogDescription>
                    </DialogHeader>
                    {actionType === 'REJECT' && (
                        <div className="space-y-2">
                            <Label htmlFor="rejectionReason" className="text-sm font-medium text-red-600">
                                Rejection Reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="rejectionReason"
                                placeholder="Enter the reason for rejection..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                rows={3}
                                className="border-red-200 focus:border-red-400 focus:ring-red-200"
                            />
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => { setActionCenter(null); setActionType(null); setRejectionReason(''); }}
                            disabled={isProcessing}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleApproveReject}
                            disabled={isProcessing || (actionType === 'REJECT' && !rejectionReason.trim())}
                            className={
                                actionType === 'APPROVE'
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-red-600 hover:bg-red-700 text-white'
                            }
                        >
                            {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : actionType === 'APPROVE' ? (
                                <ThumbsUp className="h-4 w-4 mr-1" />
                            ) : (
                                <ThumbsDown className="h-4 w-4 mr-1" />
                            )}
                            {isProcessing
                                ? 'Processing...'
                                : actionType === 'APPROVE'
                                    ? 'Confirm Approve'
                                    : 'Confirm Reject'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
