'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { Loader2, Coins, Search, Check, X, ArrowLeftRight, Camera, ImageOff, Plus } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { toDisplayDate } from '@/app/lib/date-format';

type GoldLoanDetail = {
    karatType: string;
    gramCount: number;
    goldTakenValue: number;
    cashGiven: number;
};

type LoanInfo = {
    loanNumber: string;
    amount: number;
    disbursedByBMAt?: string;
    branchId: string;
    client: { firstName: string; lastName: string; clientId: string };
    center: { name: string };
    branch: { name: string };
    goldLoanDetail?: GoldLoanDetail | null;
};

type GoldTransaction = {
    id: string;
    loanId: string;
    type: 'TAKE' | 'GIVE';
    gramCount: number;
    goldValue: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    createdAt: string;
    approvedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
    remarks?: string;
    loan: LoanInfo;
    initiatedBy: { firstName: string; lastName: string };
    approvedBy?: { firstName: string; lastName: string };
    rejectedBy?: { firstName: string; lastName: string };
};

type Tab = 'active' | 'pending' | 'completed';

const RELATION_OPTIONS = [
    { value: 'SPOUSE', label: 'Spouse' },
    { value: 'FATHER', label: 'Father' },
    { value: 'MOTHER', label: 'Mother' },
    { value: 'SON', label: 'Son' },
    { value: 'DAUGHTER', label: 'Daughter' },
    { value: 'BROTHER', label: 'Brother' },
    { value: 'SISTER', label: 'Sister' },
    { value: 'OTHER', label: 'Other' },
];

export default function GoldReturnPage() {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<Tab>('active');
    const [userRole, setUserRole] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Branch filter — ADMIN sees all branches, AREA_MANAGER scoped to their assigned branches
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const isAdminOrAM = userRole === 'ADMIN' || userRole === 'AREA_MANAGER';

    // Center filter — server action already scopes the list per role (FDO -> own
    // centers, BM/AM/ADMIN -> permitted branches), so it's shown to every role.
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('all');
    const filteredCenters = selectedBranchId === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranchId);

    // Search box — matches loan no, client name/id, center name, branch name (server-side)
    const [searchQuery, setSearchQuery] = useState('');

    // Data only loads once the user clicks Submit — filters never auto-fetch.
    const [hasSearched, setHasSearched] = useState(false);

    const PAGE_SIZE = 25;

    // Active gold loans (TAKE with no approved GIVE yet)
    const [activeGoldLoans, setActiveGoldLoans] = useState<GoldTransaction[]>([]);
    const [activePage, setActivePage] = useState(1);
    const [activeTotalPages, setActiveTotalPages] = useState(1);
    const [activeTotalCount, setActiveTotalCount] = useState(0);

    // Pending returns (BM initiated, AM not yet approved) — self-clearing approval
    // queue, stays unpaginated (matches the API's opt-in pagination contract).
    const [pendingReturns, setPendingReturns] = useState<GoldTransaction[]>([]);

    // Completed returns
    const [completedReturns, setCompletedReturns] = useState<GoldTransaction[]>([]);
    const [completedPage, setCompletedPage] = useState(1);
    const [completedTotalPages, setCompletedTotalPages] = useState(1);
    const [completedTotalCount, setCompletedTotalCount] = useState(0);

    // Return initiation state — the Return Gold modal
    const [initiatingTxn, setInitiatingTxn] = useState<GoldTransaction | null>(null);
    const [returnGrams, setReturnGrams] = useState('');
    const [returnGoldValue, setReturnGoldValue] = useState('');
    const [returnRemarks, setReturnRemarks] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Return Gold modal — mandatory evidence photos (multiple, of the gold itself)
    const [cameraOpen, setCameraOpen] = useState(false);
    const [photoCaptureTarget, setPhotoCaptureTarget] = useState<'gold' | 'recipient' | null>(null);
    const [returnPhotos, setReturnPhotos] = useState<{ photoUrl: string; photoKey: string | null; previewUrl: string }[]>([]);
    const [isUploadingGoldPhoto, setIsUploadingGoldPhoto] = useState(false);

    // Return Gold modal — recipient (who physically collected the gold)
    const [recipientName, setRecipientName] = useState('');
    const [recipientMobile, setRecipientMobile] = useState('');
    const [recipientRelation, setRecipientRelation] = useState('');
    const [recipientPhotoPreviewUrl, setRecipientPhotoPreviewUrl] = useState<string | null>(null);
    const [recipientPhotoUrl, setRecipientPhotoUrl] = useState<string | null>(null);
    const [recipientPhotoKey, setRecipientPhotoKey] = useState<string | null>(null);
    const [isUploadingRecipientPhoto, setIsUploadingRecipientPhoto] = useState(false);

    // AM approval state
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');
    const [approveDialogOpen, setApproveDialogOpen] = useState(false);
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

    useEffect(() => {
        const user = tokenStorage.getUser();
        setUserRole(user?.role || '');
    }, []);

    // Load the branch list for ADMIN/AREA_MANAGER once role is known
    useEffect(() => {
        if (!isAdminOrAM) return;
        setIsLoadingBranches(true);
        fetch('/api/branches')
            .then((res) => res.json())
            .then((json) => {
                let list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                if (userRole === 'AREA_MANAGER') {
                    const assignedBranchIds = (tokenStorage.getUser() as any)?.assignedBranchIds ?? [];
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
    }, [isAdminOrAM, userRole]);

    // Load the center list once — the server action already scopes it per role
    useEffect(() => {
        getCentersForDropdown()
            .then(setCenters)
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load centers.', variant: 'destructive' });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    type GoldTxPageResponse = {
        data: GoldTransaction[];
        totalCount: number;
        totalPages: number;
        page: number;
        pageSize: number;
    };

    // Builds the shared filter query string from current filter state. Filters
    // are only read here — changing them never triggers a fetch by itself,
    // only Submit / pagination / Refresh do.
    const buildFilterParams = () => {
        let params = '';
        if (isAdminOrAM && selectedBranchId !== 'all') params += `&branchId=${selectedBranchId}`;
        if (selectedCenterId !== 'all') params += `&centerId=${selectedCenterId}`;
        if (searchQuery.trim()) params += `&search=${encodeURIComponent(searchQuery.trim())}`;
        return params;
    };

    const fetchActivePage = async (pageArg: number) => {
        const res = await apiClient.get<GoldTxPageResponse>(`/gold-transactions?activeOnly=true&page=${pageArg}&pageSize=${PAGE_SIZE}${buildFilterParams()}`);
        if (res.success && res.data) {
            setActiveGoldLoans(res.data.data);
            setActiveTotalCount(res.data.totalCount);
            setActiveTotalPages(res.data.totalPages);
            setActivePage(res.data.page);
        }
    };

    const fetchCompletedPage = async (pageArg: number) => {
        const res = await apiClient.get<GoldTxPageResponse>(`/gold-transactions?type=GIVE&status=APPROVED&page=${pageArg}&pageSize=${PAGE_SIZE}${buildFilterParams()}`);
        if (res.success && res.data) {
            setCompletedReturns(res.data.data);
            setCompletedTotalCount(res.data.totalCount);
            setCompletedTotalPages(res.data.totalPages);
            setCompletedPage(res.data.page);
        }
    };

    const fetchPending = async () => {
        const res = await apiClient.get<GoldTransaction[]>(`/gold-transactions?type=GIVE&status=PENDING${buildFilterParams()}`);
        if (res.success) setPendingReturns(res.data || []);
    };

    const fetchData = async () => {
        setIsLoading(true);
        try {
            await Promise.all([fetchActivePage(1), fetchPending(), fetchCompletedPage(1)]);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch gold data', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    };

    // Submit button — the only thing (besides pagination/Refresh) that fetches data
    const handleSubmit = () => {
        setHasSearched(true);
        fetchData();
    };

    const handleActivePageChange = (p: number) => {
        fetchActivePage(p);
    };

    const handleCompletedPageChange = (p: number) => {
        fetchCompletedPage(p);
    };

    const openReturnModal = (txn: GoldTransaction) => {
        setInitiatingTxn(txn);
        setReturnGrams('');
        setReturnGoldValue('');
        setReturnRemarks('');
        setReturnPhotos([]);
        setRecipientName('');
        setRecipientMobile('');
        setRecipientRelation('');
        setRecipientPhotoPreviewUrl(null);
        setRecipientPhotoUrl(null);
        setRecipientPhotoKey(null);
    };

    const closeReturnModal = () => {
        returnPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        if (recipientPhotoPreviewUrl) URL.revokeObjectURL(recipientPhotoPreviewUrl);
        setInitiatingTxn(null);
        setReturnGrams('');
        setReturnGoldValue('');
        setReturnRemarks('');
        setReturnPhotos([]);
        setRecipientName('');
        setRecipientMobile('');
        setRecipientRelation('');
        setRecipientPhotoPreviewUrl(null);
        setRecipientPhotoUrl(null);
        setRecipientPhotoKey(null);
    };

    const openCameraFor = (target: 'gold' | 'recipient') => {
        setPhotoCaptureTarget(target);
        setCameraOpen(true);
    };

    const removeGoldPhoto = (index: number) => {
        setReturnPhotos((prev) => {
            const target = prev[index];
            if (target) URL.revokeObjectURL(target.previewUrl);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handlePhotoCapture = async (file: File) => {
        if (!initiatingTxn) return;

        if (photoCaptureTarget === 'recipient') {
            if (recipientPhotoPreviewUrl) URL.revokeObjectURL(recipientPhotoPreviewUrl);
            setRecipientPhotoPreviewUrl(URL.createObjectURL(file));
            setIsUploadingRecipientPhoto(true);
            try {
                const formData = new FormData();
                formData.append('photo', file);
                const res = await apiClient.post<{ photoUrl: string; photoKey: string }>(
                    `/loans/${initiatingTxn.loanId}/gold-return-photo`,
                    formData
                );
                if (res.success && res.data) {
                    setRecipientPhotoUrl(res.data.photoUrl);
                    setRecipientPhotoKey(res.data.photoKey);
                } else {
                    toast({ title: 'Upload Failed', description: res.error || 'Could not upload photo', variant: 'destructive' });
                    setRecipientPhotoUrl(null);
                }
            } catch {
                toast({ title: 'Upload Failed', description: 'Could not upload photo', variant: 'destructive' });
                setRecipientPhotoUrl(null);
            } finally {
                setIsUploadingRecipientPhoto(false);
            }
            return;
        }

        // Gold photo — appends to the list rather than replacing a single slot
        const previewUrl = URL.createObjectURL(file);
        setIsUploadingGoldPhoto(true);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            const res = await apiClient.post<{ photoUrl: string; photoKey: string }>(
                `/loans/${initiatingTxn.loanId}/gold-return-photo`,
                formData
            );
            if (res.success && res.data) {
                setReturnPhotos((prev) => [...prev, { photoUrl: res.data!.photoUrl, photoKey: res.data!.photoKey, previewUrl }]);
            } else {
                URL.revokeObjectURL(previewUrl);
                toast({ title: 'Upload Failed', description: res.error || 'Could not upload photo', variant: 'destructive' });
            }
        } catch {
            URL.revokeObjectURL(previewUrl);
            toast({ title: 'Upload Failed', description: 'Could not upload photo', variant: 'destructive' });
        } finally {
            setIsUploadingGoldPhoto(false);
        }
    };

    const handleInitiateReturn = async () => {
        if (!initiatingTxn) return;
        if (!returnGrams || Number(returnGrams) <= 0) {
            toast({ title: 'Validation', description: 'Please enter valid gram count', variant: 'destructive' });
            return;
        }
        if (!returnGoldValue || Number(returnGoldValue) <= 0) {
            toast({ title: 'Validation', description: 'Please enter valid gold value', variant: 'destructive' });
            return;
        }
        if (returnPhotos.length === 0) {
            toast({ title: 'Validation', description: 'Please attach at least one photo of the returned gold', variant: 'destructive' });
            return;
        }
        if (!recipientName.trim() || !recipientMobile.trim() || !recipientRelation.trim()) {
            toast({ title: 'Validation', description: 'Please enter the recipient\'s name, mobile number, and relationship to the client', variant: 'destructive' });
            return;
        }
        if (!recipientPhotoUrl) {
            toast({ title: 'Validation', description: 'Please attach a photo of the recipient', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await apiClient.post('/gold-transactions', {
                loanId: initiatingTxn.loanId,
                gramCount: Number(returnGrams),
                goldValue: Number(returnGoldValue),
                remarks: returnRemarks || undefined,
                photos: returnPhotos.map((p) => ({ photoUrl: p.photoUrl, photoKey: p.photoKey || undefined })),
                recipientName: recipientName.trim(),
                recipientMobile: recipientMobile.trim(),
                recipientRelation: recipientRelation.trim(),
                recipientPhotoUrl,
                recipientPhotoKey: recipientPhotoKey || undefined,
            });
            if (res.success) {
                toast({ title: 'Success', description: 'Gold return initiated. Pending AM approval.' });
                closeReturnModal();
                fetchData();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to initiate return', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to initiate return', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleApprove = async () => {
        if (!approvingId) return;
        setIsSubmitting(true);
        try {
            const res = await apiClient.patch(`/gold-transactions/${approvingId}/approve`, { action: 'APPROVE' });
            if (res.success) {
                toast({ title: 'Success', description: 'Gold return approved' });
                setApproveDialogOpen(false);
                setApprovingId(null);
                fetchData();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to approve', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to approve', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReject = async () => {
        if (!rejectingId || !rejectionReason.trim()) return;
        setIsSubmitting(true);
        try {
            const res = await apiClient.patch(`/gold-transactions/${rejectingId}/approve`, {
                action: 'REJECT',
                rejectionReason,
            });
            if (res.success) {
                toast({ title: 'Success', description: 'Gold return rejected' });
                setRejectDialogOpen(false);
                setRejectingId(null);
                setRejectionReason('');
                fetchData();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to reject', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to reject', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatCurrency = (v: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(v);
    const formatDate = (iso?: string) =>
        iso ? toDisplayDate(new Date(iso)) : '—';

    const tabs: { key: Tab; label: string; count?: number }[] = [
        { key: 'active', label: 'Active Gold Loans', count: activeTotalCount },
        { key: 'pending', label: 'Pending AM Approval', count: pendingReturns.length },
        { key: 'completed', label: 'Completed Returns', count: completedTotalCount },
    ];

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                    <ArrowLeftRight className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-slate-100">Gold Return Module</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Manage gold collateral returns</p>
                </div>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="pt-4 pb-4">
                    <div className="flex flex-wrap gap-4 items-end">
                        {isAdminOrAM && (
                            <div className="space-y-1">
                                <Label className="text-xs text-sidebar-accent">Branch</Label>
                                <Select
                                    value={selectedBranchId}
                                    onValueChange={(v) => { setSelectedBranchId(v); setSelectedCenterId('all'); }}
                                    disabled={isLoadingBranches}
                                >
                                    <SelectTrigger className="h-9 w-[200px]">
                                        <SelectValue placeholder="All Branches" />
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
                            </div>
                        )}
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">Center</Label>
                            <Select value={selectedCenterId} onValueChange={setSelectedCenterId}>
                                <SelectTrigger className="h-9 w-[200px]">
                                    <SelectValue placeholder="All Centers" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Centers</SelectItem>
                                    {filteredCenters.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-sidebar-accent">Search</Label>
                            <Input
                                placeholder="Loan no, client, center, branch..."
                                className="h-9 w-64 text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                            />
                        </div>
                        <Button onClick={handleSubmit} disabled={isLoading} className="h-9 bg-yellow-600 hover:bg-yellow-700 text-white">
                            {isLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                            Submit
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Tabs */}
            <div className="flex gap-1 bg-brand-green-tint dark:bg-sidebar-accent p-1 rounded-lg w-fit">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                            activeTab === t.key
                                ? 'bg-white dark:bg-sidebar-accent text-foreground dark:text-slate-100 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-sidebar-accent'
                        }`}
                    >
                        {t.label}
                        {t.count !== undefined && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${
                                activeTab === t.key ? 'bg-yellow-100 text-yellow-700' : 'bg-brand-green-tint dark:bg-sidebar-accent/80 text-sidebar-accent dark:text-slate-400'
                            }`}>
                                {t.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {!hasSearched ? (
                <Card>
                    <CardContent className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                        Choose a Branch / Center / Search filter as needed, then click <span className="font-medium text-foreground dark:text-slate-200">Submit</span> to load gold return data.
                    </CardContent>
                </Card>
            ) : isLoading ? (
                <PageLoader fullScreen={false} />
            ) : (
                <>
                    {/* Active Gold Loans Tab */}
                    {activeTab === 'active' && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200 flex items-center gap-2">
                                    <Coins className="h-4 w-4 text-yellow-600" />
                                    Gold Currently Held as Collateral
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {activeGoldLoans.length === 0 ? (
                                    <div className="text-center py-10 text-slate-500 text-sm">No active gold loans.</div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                                <TableHead>Loan No</TableHead>
                                                <TableHead>Client</TableHead>
                                                <TableHead>Center</TableHead>
                                                <TableHead>Branch</TableHead>
                                                <TableHead>Karat</TableHead>
                                                <TableHead className="text-right">Grams</TableHead>
                                                <TableHead className="text-right">Gold Value</TableHead>
                                                <TableHead className="text-right">Cash Given</TableHead>
                                                {(userRole === 'BRANCH_MANAGER' || userRole === 'ADMIN') && (
                                                    <TableHead>Action</TableHead>
                                                )}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {activeGoldLoans.map((txn) => (
                                                <TableRow key={txn.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                                    <TableCell className="font-mono text-xs font-medium">{txn.loan.loanNumber}</TableCell>
                                                    <TableCell className="text-sm">
                                                        <div>{txn.loan.client.firstName} {txn.loan.client.lastName}</div>
                                                        <div className="text-xs text-slate-500">{txn.loan.client.clientId}</div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{txn.loan.center?.name}</TableCell>
                                                    <TableCell className="text-sm">{txn.loan.branch?.name}</TableCell>
                                                    <TableCell>
                                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                                                            {txn.loan.goldLoanDetail?.karatType}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right text-sm font-medium">{Number(txn.loan.goldLoanDetail?.gramCount).toFixed(3)}g</TableCell>
                                                    <TableCell className="text-right text-sm">{formatCurrency(Number(txn.loan.goldLoanDetail?.goldTakenValue))}</TableCell>
                                                    <TableCell className="text-right text-sm">{formatCurrency(Number(txn.loan.goldLoanDetail?.cashGiven))}</TableCell>
                                                    {(userRole === 'BRANCH_MANAGER' || userRole === 'ADMIN') && (
                                                        <TableCell>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="text-xs h-7 border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                                                                onClick={() => openReturnModal(txn)}
                                                            >
                                                                Return Gold
                                                            </Button>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                                {activeTotalPages > 1 && (
                                    <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Page {activePage} of {activeTotalPages} · {activeTotalCount} record{activeTotalCount !== 1 ? 's' : ''}
                                        </p>
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="sm" onClick={() => handleActivePageChange(Math.max(1, activePage - 1))} disabled={activePage === 1 || isLoading}>
                                                Previous
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleActivePageChange(Math.min(activeTotalPages, activePage + 1))} disabled={activePage === activeTotalPages || isLoading}>
                                                Next
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Pending AM Approval Tab */}
                    {activeTab === 'pending' && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200">
                                    Gold Returns Awaiting AM Approval
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {pendingReturns.length === 0 ? (
                                    <div className="text-center py-10 text-slate-500 text-sm">No pending approvals.</div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                                <TableHead>Loan No</TableHead>
                                                <TableHead>Client</TableHead>
                                                <TableHead>Center</TableHead>
                                                <TableHead className="text-right">Grams</TableHead>
                                                <TableHead className="text-right">Gold Value</TableHead>
                                                <TableHead>Initiated By</TableHead>
                                                <TableHead>Date</TableHead>
                                                {(userRole === 'AREA_MANAGER' || userRole === 'ADMIN') && (
                                                    <TableHead>Actions</TableHead>
                                                )}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {pendingReturns.map((txn) => (
                                                <TableRow key={txn.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                                    <TableCell className="font-mono text-xs font-medium">{txn.loan.loanNumber}</TableCell>
                                                    <TableCell className="text-sm">
                                                        <div>{txn.loan.client.firstName} {txn.loan.client.lastName}</div>
                                                        <div className="text-xs text-slate-500">{txn.loan.client.clientId}</div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{txn.loan.center?.name}</TableCell>
                                                    <TableCell className="text-right text-sm font-medium">{Number(txn.gramCount).toFixed(3)}g</TableCell>
                                                    <TableCell className="text-right text-sm">{formatCurrency(Number(txn.goldValue))}</TableCell>
                                                    <TableCell className="text-sm text-sidebar-accent">
                                                        {txn.initiatedBy.firstName} {txn.initiatedBy.lastName}
                                                    </TableCell>
                                                    <TableCell className="text-sm">{formatDate(txn.createdAt)}</TableCell>
                                                    {(userRole === 'AREA_MANAGER' || userRole === 'ADMIN') && (
                                                        <TableCell>
                                                            <div className="flex gap-1">
                                                                <Button
                                                                    size="sm"
                                                                    className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                                                    onClick={() => { setApprovingId(txn.id); setApproveDialogOpen(true); }}
                                                                >
                                                                    <Check className="h-3 w-3 mr-0.5" /> Approve
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
                                                                    onClick={() => { setRejectingId(txn.id); setRejectDialogOpen(true); }}
                                                                >
                                                                    <X className="h-3 w-3 mr-0.5" /> Reject
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Completed Returns Tab */}
                    {activeTab === 'completed' && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold text-sidebar-accent dark:text-slate-200">Completed Gold Returns</CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                {completedReturns.length === 0 ? (
                                    <div className="text-center py-10 text-slate-500 text-sm">No completed returns yet.</div>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
                                                <TableHead>Loan No</TableHead>
                                                <TableHead>Client</TableHead>
                                                <TableHead>Center</TableHead>
                                                <TableHead className="text-right">Grams Returned</TableHead>
                                                <TableHead className="text-right">Gold Value</TableHead>
                                                <TableHead>Initiated By</TableHead>
                                                <TableHead>Approved By</TableHead>
                                                <TableHead>Return Date</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {completedReturns.map((txn) => (
                                                <TableRow key={txn.id} className="hover:bg-green-50 dark:hover:bg-sidebar-accent/30">
                                                    <TableCell className="font-mono text-xs font-medium">{txn.loan.loanNumber}</TableCell>
                                                    <TableCell className="text-sm">
                                                        <div>{txn.loan.client.firstName} {txn.loan.client.lastName}</div>
                                                        <div className="text-xs text-slate-500">{txn.loan.client.clientId}</div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{txn.loan.center?.name}</TableCell>
                                                    <TableCell className="text-right text-sm font-medium">{Number(txn.gramCount).toFixed(3)}g</TableCell>
                                                    <TableCell className="text-right text-sm">{formatCurrency(Number(txn.goldValue))}</TableCell>
                                                    <TableCell className="text-sm text-sidebar-accent">
                                                        {txn.initiatedBy.firstName} {txn.initiatedBy.lastName}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-sidebar-accent">
                                                        {txn.approvedBy ? `${txn.approvedBy.firstName} ${txn.approvedBy.lastName}` : '—'}
                                                    </TableCell>
                                                    <TableCell className="text-sm">{formatDate(txn.approvedAt)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                                {completedTotalPages > 1 && (
                                    <div className="flex items-center justify-between border-t border-slate-100 dark:border-sidebar-accent px-4 py-3">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Page {completedPage} of {completedTotalPages} · {completedTotalCount} record{completedTotalCount !== 1 ? 's' : ''}
                                        </p>
                                        <div className="flex gap-1">
                                            <Button variant="outline" size="sm" onClick={() => handleCompletedPageChange(Math.max(1, completedPage - 1))} disabled={completedPage === 1 || isLoading}>
                                                Previous
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleCompletedPageChange(Math.min(completedTotalPages, completedPage + 1))} disabled={completedPage === completedTotalPages || isLoading}>
                                                Next
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </>
            )}

            {/* Return Gold Modal */}
            <Dialog open={!!initiatingTxn} onOpenChange={(open) => { if (!open) closeReturnModal(); }}>
                <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Coins className="h-4 w-4 text-yellow-600" />
                            Return Gold
                        </DialogTitle>
                    </DialogHeader>

                    {initiatingTxn && (
                        <div className="space-y-4">
                            {/* Loan context — read only */}
                            <div className="grid grid-cols-2 gap-2 text-sm bg-slate-50 dark:bg-sidebar-accent/30 rounded-lg p-3">
                                <div><span className="font-semibold">Loan No:</span> {initiatingTxn.loan.loanNumber}</div>
                                <div><span className="font-semibold">Client:</span> {initiatingTxn.loan.client.firstName} {initiatingTxn.loan.client.lastName}</div>
                                <div><span className="font-semibold">Center:</span> {initiatingTxn.loan.center?.name}</div>
                                <div><span className="font-semibold">Branch:</span> {initiatingTxn.loan.branch?.name}</div>
                                <div><span className="font-semibold">Karat:</span> {initiatingTxn.loan.goldLoanDetail?.karatType}</div>
                                <div><span className="font-semibold">Grams:</span> {Number(initiatingTxn.loan.goldLoanDetail?.gramCount).toFixed(3)}g</div>
                                <div><span className="font-semibold">Gold Value:</span> {formatCurrency(Number(initiatingTxn.loan.goldLoanDetail?.goldTakenValue))}</div>
                                <div><span className="font-semibold">Cash Given:</span> {formatCurrency(Number(initiatingTxn.loan.goldLoanDetail?.cashGiven))}</div>
                            </div>

                            {/* Editable fields */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs text-sidebar-accent">Grams to Return</Label>
                                    <Input
                                        type="number"
                                        min="0.001"
                                        step="0.001"
                                        placeholder={`Max: ${Number(initiatingTxn.loan.goldLoanDetail?.gramCount).toFixed(3)}`}
                                        className="h-9 text-sm"
                                        value={returnGrams}
                                        onChange={(e) => setReturnGrams(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-sidebar-accent">Gold Value (₹)</Label>
                                    <Input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="0.00"
                                        className="h-9 text-sm"
                                        value={returnGoldValue}
                                        onChange={(e) => setReturnGoldValue(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-sidebar-accent">Remarks (optional)</Label>
                                <Input
                                    placeholder="Add a note..."
                                    className="h-9 text-sm"
                                    value={returnRemarks}
                                    onChange={(e) => setReturnRemarks(e.target.value)}
                                />
                            </div>

                            {/* Mandatory photo attachments — multiple, of the gold itself */}
                            <div className="space-y-1">
                                <Label className="text-xs text-sidebar-accent">
                                    Photos of Returned Gold <span className="text-red-500">*</span>
                                </Label>
                                <div className="flex flex-wrap gap-2">
                                    {returnPhotos.map((p, i) => (
                                        <div key={p.previewUrl} className="relative">
                                            <img
                                                src={p.previewUrl}
                                                alt={`Return evidence ${i + 1}`}
                                                className="h-20 w-20 rounded-lg object-cover border border-slate-200 dark:border-sidebar-accent"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeGoldPhoto(i)}
                                                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => openCameraFor('gold')}
                                        disabled={isUploadingGoldPhoto}
                                        className="h-20 w-20 rounded-lg border-2 border-dashed border-yellow-300 text-yellow-700 hover:bg-yellow-50 flex flex-col items-center justify-center gap-1 text-xs disabled:opacity-60"
                                    >
                                        {isUploadingGoldPhoto ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Plus className="h-4 w-4" />
                                                Add Photo
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Recipient — who physically collected the gold */}
                            <div className="space-y-3 border-t border-slate-100 dark:border-sidebar-accent pt-4">
                                <Label className="text-xs text-sidebar-accent font-semibold">Received By</Label>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs text-sidebar-accent">
                                            Name <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            placeholder="Recipient's full name"
                                            className="h-9 text-sm"
                                            value={recipientName}
                                            onChange={(e) => setRecipientName(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-sidebar-accent">
                                            Mobile Number <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            type="tel"
                                            placeholder="10-digit mobile number"
                                            className="h-9 text-sm"
                                            value={recipientMobile}
                                            onChange={(e) => setRecipientMobile(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-sidebar-accent">
                                        Relationship to Client <span className="text-red-500">*</span>
                                    </Label>
                                    <Select value={recipientRelation} onValueChange={setRecipientRelation}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Select relationship" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {RELATION_OPTIONS.map((r) => (
                                                <SelectItem key={r.value} value={r.value}>
                                                    {r.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs text-sidebar-accent">
                                        Photo of Recipient <span className="text-red-500">*</span>
                                    </Label>
                                    {recipientPhotoPreviewUrl ? (
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={recipientPhotoPreviewUrl}
                                                alt="Recipient preview"
                                                className="h-20 w-20 rounded-lg object-cover border border-slate-200 dark:border-sidebar-accent"
                                            />
                                            <div className="flex flex-col gap-1">
                                                {isUploadingRecipientPhoto ? (
                                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                                        <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
                                                    </span>
                                                ) : recipientPhotoUrl ? (
                                                    <span className="text-xs text-green-600 flex items-center gap-1">
                                                        <Check className="h-3 w-3" /> Photo attached
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-red-500 flex items-center gap-1">
                                                        <ImageOff className="h-3 w-3" /> Upload failed
                                                    </span>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 text-xs w-fit"
                                                    onClick={() => openCameraFor('recipient')}
                                                >
                                                    Retake Photo
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-9 text-xs border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                                            onClick={() => openCameraFor('recipient')}
                                        >
                                            <Camera className="h-3.5 w-3.5 mr-1" /> Attach Photo
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        <Button variant="outline" size="sm" onClick={closeReturnModal} disabled={isSubmitting}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="bg-yellow-600 hover:bg-yellow-700 text-white"
                            onClick={handleInitiateReturn}
                            disabled={isSubmitting || isUploadingGoldPhoto || isUploadingRecipientPhoto}
                        >
                            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                            Submit Return
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <CameraCapture
                open={cameraOpen}
                onClose={() => { setCameraOpen(false); setPhotoCaptureTarget(null); }}
                onCapture={handlePhotoCapture}
                label={photoCaptureTarget === 'recipient' ? 'Recipient' : 'Returned Gold'}
            />

            {/* Approve Confirmation Dialog */}
            <ConfirmationDialog
                open={approveDialogOpen}
                onOpenChange={(open) => { setApproveDialogOpen(open); if (!open) setApprovingId(null); }}
                onConfirm={handleApprove}
                title="Approve Gold Return"
                description="Are you sure you want to approve this gold return? The gold will be marked as returned to the customer."
                confirmText="Approve Return"
                cancelText="Cancel"
                type="info"
                isLoading={isSubmitting}
            />

            {/* Reject reason inline input (shows before the confirm dialog) */}
            {rejectDialogOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
                    <div className="bg-white dark:bg-brand-green-darker rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
                        <h2 className="text-base font-semibold text-foreground dark:text-slate-100">Reject Gold Return</h2>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400">Please provide a reason for rejecting this gold return.</p>
                        <Input
                            placeholder="Rejection reason..."
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            className="h-9 text-sm"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setRejectDialogOpen(false); setRejectingId(null); setRejectionReason(''); }}
                                disabled={isSubmitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                className="bg-red-600 hover:bg-red-700 text-white"
                                onClick={handleReject}
                                disabled={isSubmitting || !rejectionReason.trim()}
                            >
                                {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                Reject Return
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
