'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Loader2,
    ShieldCheck,
    ChevronRight,
    Users,
    User,
    RefreshCw,
    Search,
    ChevronLeft,
    X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/ui/page-loader';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { ApprovalClientDetail } from './ApprovalClientDetail';
import { CoApplicantApprovalQueue } from './CoApplicantApprovalQueue';
import { RenewalLoanApprovalQueue } from './RenewalLoanApprovalQueue';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';

// ─── Types ───
type EmployeeRef = { name: string; employeeId: string | null } | null;

type QueueClient = {
    id: string; clientId: string; name: string; mobileNumber: string | null;
    approvalStatus: string; verificationStatus: string;
    enrolledBy: EmployeeRef;
    bmReviewedBy: EmployeeRef;
    amReviewedBy: EmployeeRef;
    qcVerifiedBy: EmployeeRef;
    finalReviewedBy: EmployeeRef;
    bmReviewedAt: string | null; kycDocCount: number; enrolledAt: string;
    centerName?: string | null;
};

type BranchOption = { id: string; name: string; code: string; count: number };

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    SUBMITTED:                       { label: 'Submitted',       color: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',       dot: 'bg-amber-500' },
    PENDING_BM_REVIEW:               { label: 'Pending BM',      color: 'text-sidebar-accent dark:text-primary',       bg: 'bg-green-50 dark:bg-green-950/40 border-primary/30 dark:border-sidebar-accent',           dot: 'bg-primary' },
    BM_RETAKE_REQUIRED:              { label: 'BM Retake',       color: 'text-orange-700 dark:text-orange-400',   bg: 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800',   dot: 'bg-orange-500' },
    PENDING_AM_REVIEW:               { label: 'Pending AM',      color: 'text-primary dark:text-primary',   bg: 'bg-green-50 dark:bg-brand-green-darker/40 border-primary dark:border-primary',   dot: 'bg-primary' },
    AM_RETAKE_REQUIRED:              { label: 'AM Retake',       color: 'text-rose-700 dark:text-rose-400',       bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',           dot: 'bg-rose-500' },
    PENDING_QC_VERIFICATION:         { label: 'QC Pending',      color: 'text-teal-700 dark:text-teal-400',       bg: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800',           dot: 'bg-teal-500' },
    QC_VERIFICATION_RETAKE_REQUIRED: { label: 'QC Retake',       color: 'text-cyan-700 dark:text-cyan-400',       bg: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800',           dot: 'bg-cyan-500' },
    PENDING_FINAL_REVIEW:            { label: 'Pending Final',   color: 'text-violet-700 dark:text-violet-400',   bg: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800',   dot: 'bg-violet-500' },
    FINAL_RETAKE_REQUIRED:           { label: 'Final Retake',    color: 'text-fuchsia-700 dark:text-fuchsia-400', bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40 border-fuchsia-200 dark:border-fuchsia-800',dot: 'bg-fuchsia-500' },
    APPROVED:                        { label: 'Approved',        color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',dot: 'bg-emerald-500' },
    REJECTED:                        { label: 'Rejected',        color: 'text-red-700 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',               dot: 'bg-red-500' },
    PENDING_LEVEL_1:                 { label: 'Level 1 Review',  color: 'text-teal-700 dark:text-teal-400',       bg: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800',           dot: 'bg-teal-500' },
    LEVEL_1_RETAKE_REQUIRED:         { label: 'L1 Retake',       color: 'text-cyan-700 dark:text-cyan-400',       bg: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800',           dot: 'bg-cyan-500' },
    PENDING_LEVEL_2:                 { label: 'Level 2 Review',  color: 'text-primary dark:text-primary',   bg: 'bg-green-50 dark:bg-brand-green-darker/40 border-primary dark:border-primary',   dot: 'bg-primary' },
    LEVEL_2_RETAKE_REQUIRED:         { label: 'L2 Retake',       color: 'text-rose-700 dark:text-rose-400',       bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',           dot: 'bg-rose-500' },
};


// ─── Status Chip ───
function StatusChip({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] ?? {
        label: status,
        color: 'text-sidebar-accent',
        bg:    'bg-green-50 border-primary/20',
        dot:   'bg-slate-400',
    };
    return (
        <span className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
            cfg.bg, cfg.color
        )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
            {cfg.label}
        </span>
    );
}

// ─── Stat Card ───
function StatCard({
    icon: Icon, label, value, gradient,
}: {
    icon: React.ElementType; label: string; value: string | number; gradient: string;
}) {
    return (
        <div className={cn('relative overflow-hidden rounded-xl p-4 text-white shadow-lg', gradient)}>
            <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-white/10" />
            <div className="absolute -bottom-4 -right-1 h-20 w-20 rounded-full bg-white/5" />
            <div className="relative flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <p className="text-xs font-medium text-white/80">{label}</p>
                    <p className="text-2xl font-bold">{value}</p>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
//  Member Approval Queue (existing behavior, unchanged)
// ─────────────────────────────────────────────
function ClientApprovalQueue() {
    const { toast }   = useToast();
    const currentUser = tokenStorage.getUser();
    const userRole    = currentUser?.role;

    // Data
    const [clients,      setClients]      = useState<QueueClient[]>([]);
    const [totalPending, setTotalPending] = useState(0);

    // Detail view
    const [detailClientId, setDetailClientId] = useState<string | null>(null);
    const lastClientState = useRef({ page: 1, search: '' });

    // Pagination & Search
    const [searchQuery,     setSearchQuery]     = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [branchId,        setBranchId]        = useState('all');
    const [branches,        setBranches]        = useState<BranchOption[]>([]);
    // Stage(s) this user reviews — from the queue API, so any configured role is named correctly.
    const [myStageNames,    setMyStageNames]    = useState<string[] | null>(null);
    const [page,            setPage]            = useState(1);
    const [limit]                               = useState(10);
    const [totalPages,      setTotalPages]      = useState(1);
    const [totalItems,      setTotalItems]      = useState(0);

    // Loading / UI
    const [loadingClients, setLoadingClients] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [mounted,        setMounted]        = useState(false);

    useEffect(() => { setMounted(true); }, []);

    // ── Fetch all branch clients (no center/group cascade needed) ──
    const fetchClients = useCallback(async (p: number, s: string, b: string) => {
        setLoadingClients(true);
        try {
            const res = await apiClient.get<{
                items: QueueClient[];
                totalPending: number;
                branches?: BranchOption[];
                myStageNames?: string[];
                pagination: { totalPages: number; total: number };
            }>(`/approval/queue?allBranch=true&page=${p}&limit=${limit}&search=${encodeURIComponent(s)}${b !== 'all' ? `&branchId=${encodeURIComponent(b)}` : ''}`);
            if (res.success && res.data) {
                setClients(res.data.items ?? []);
                setBranches(res.data.branches ?? []);
                setMyStageNames(res.data.myStageNames ?? null);
                setTotalPending(res.data.totalPending ?? 0);
                if (res.data.pagination) {
                    setTotalPages(res.data.pagination.totalPages);
                    setTotalItems(res.data.pagination.total);
                }
            } else {
                toast({ title: 'Error', description: res.error ?? 'Failed to load members', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load approval queue', variant: 'destructive' });
        } finally {
            setLoadingClients(false);
        }
    }, [toast, limit]);

    // Search debounce
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchQuery); setPage(1); }, 500);
        return () => clearTimeout(t);
    }, [searchQuery]);

    // Fetch on page / search / refresh change
    useEffect(() => {
        fetchClients(page, debouncedSearch, branchId);
    }, [page, debouncedSearch, branchId, refreshTrigger, fetchClients]);

    // ── Handlers ──
    const handleSelectClient = (clientId: string) => {
        lastClientState.current = { page, search: debouncedSearch };
        setDetailClientId(clientId);
    };

    const handleBackFromDetail = () => {
        setDetailClientId(null);
        setPage(lastClientState.current.page);
        setSearchQuery(lastClientState.current.search);
        setRefreshTrigger(n => n + 1);
    };

    const handleActionComplete = () => {
        setDetailClientId(null);
        setRefreshTrigger(n => n + 1);
    };

    // ── Detail view ──
    if (detailClientId) {
        return (
            <ApprovalClientDetail
                clientId={detailClientId}
                onBack={handleBackFromDetail}
                onActionComplete={handleActionComplete}
                userRole={userRole ?? ''}
                rbacRoleSlug={currentUser?.rbacRoleSlug}
                isSubAdmin={currentUser?.isSubAdmin}
            />
        );
    }

    return (
        <div className="space-y-6">

            {/* ── Page header ── */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                        Member Approval Workbench
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Review and approve pending member enrollments for your branch
                    </p>
                </div>
                <div className="flex items-center gap-2 mt-2 sm:mt-0">
                    {mounted && (
                        <Badge variant="outline" className="text-xs font-medium px-3 py-1 border-2">
                            {myStageNames && myStageNames.length > 0
                                ? `🔍 ${myStageNames.join(' / ')}`
                                : userRole === 'BRANCH_MANAGER' ? '🔍 BM Review'
                                : userRole === 'AREA_MANAGER' ? '✅ AM Review'
                                : userRole === 'QC' || currentUser?.rbacRoleSlug === 'quality-checkers' ? '🔍 QC Verification'
                                : '🏦 Final Review'}
                        </Badge>
                    )}
                    <Button
                        variant="outline" size="sm"
                        onClick={() => setRefreshTrigger(n => n + 1)}
                        disabled={loadingClients}
                        className="h-9 gap-1.5 border-2"
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', loadingClients && 'animate-spin')} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* ── Stat cards ── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard icon={Users} label="Total Pending"   value={totalPending} gradient="bg-gradient-to-br from-primary to-purple-600" />
                <StatCard icon={User}  label="Members in View" value={totalItems}   gradient="bg-gradient-to-br from-violet-500 to-purple-600" />
            </div>

            {/* ── Branch filter + Search bar ── */}
            <div className="flex flex-col gap-3 sm:flex-row">
            {branches.length > 1 || branchId !== 'all' ? (
                <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
                    <SelectTrigger className="h-11 rounded-xl border-2 shadow-sm sm:w-72">
                        <SelectValue placeholder="All Branches" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Branches</SelectItem>
                        {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                                {b.name} ({b.code}) — {b.count}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : null}
            <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    placeholder="Search by member name or ID…"
                    className="h-11 rounded-xl border-2 pl-10 pr-10 shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                {loadingClients && (
                    <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
                )}
                {searchQuery && !loadingClients && (
                    <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-sidebar-accent transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            </div>

            {/* ── Member list ── */}
            {loadingClients && clients.length === 0 ? (
                <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-lg">
                    <CardContent className="py-12">
                        <PageLoader label="Loading members…" fullScreen={false} />
                    </CardContent>
                </Card>
            ) : clients.length === 0 ? (
                <Card className="border-2 border-dashed border-primary/20 dark:border-sidebar-accent/60 shadow-lg">
                    <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-sidebar-accent dark:to-sidebar-accent">
                            <ShieldCheck className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-base font-semibold text-sidebar-accent dark:text-slate-200">
                                {debouncedSearch ? `No members matching "${debouncedSearch}"` : 'No Pending Members'}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {debouncedSearch
                                    ? 'Try a different search term.'
                                    : 'There are no members pending approval at this time.'}
                            </p>
                        </div>
                        {debouncedSearch && (
                            <button onClick={() => setSearchQuery('')} className="text-xs text-primary hover:underline">
                                Clear search
                            </button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">

                    {/* Results meta */}
                    <div className="flex items-center justify-between px-1">
                        <p className="text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground dark:text-slate-200">{totalItems}</span>
                            {' '}member{totalItems !== 1 ? 's' : ''} pending
                            {debouncedSearch && (
                                <> · filtered by <span className="font-semibold">&ldquo;{debouncedSearch}&rdquo;</span></>
                            )}
                        </p>
                        {loadingClients && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        )}
                    </div>

                    {/* Member cards */}
                    <div className="space-y-2.5">
                        {clients.map((client, idx) => (
                            <div
                                key={client.id}
                                className="group relative overflow-hidden rounded-xl border-2 border-primary/20 bg-white shadow-md transition-all duration-200 hover:border-primary/50 hover:shadow-lg dark:border-sidebar-accent/60 dark:bg-brand-green-darker/50 dark:hover:border-primary"
                            >
                                {/* Hover accent line */}
                                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary to-primary opacity-0 transition-opacity group-hover:opacity-100" />

                                <div className="flex items-center gap-3 px-4 py-3.5">
                                    {/* Row number */}
                                    <span className="w-6 flex-shrink-0 text-center text-xs font-medium text-slate-400 dark:text-sidebar-accent">
                                        {(page - 1) * limit + idx + 1}
                                    </span>

                                    {/* Avatar */}
                                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-sidebar-accent text-base font-bold text-white shadow-md ring-2 ring-white transition-transform group-hover:scale-105 dark:ring-sidebar-accent">
                                        {client.name.charAt(0).toUpperCase()}
                                    </div>

                                    {/* Info */}
                                    <button
                                        onClick={() => handleSelectClient(client.clientId)}
                                        className="flex-1 min-w-0 text-left"
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold text-foreground dark:text-white">
                                                {client.name}
                                            </span>
                                            <StatusChip status={client.approvalStatus} />
                                        </div>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                            <span className="font-mono font-medium">{client.clientId}</span>
                                            {client.mobileNumber && <span>📱 {client.mobileNumber}</span>}
                                            <span>📄 {client.kycDocCount} docs</span>
                                            {client.centerName
                                                ? <span>🏠 {client.centerName}</span>
                                                : <span className="text-amber-600 dark:text-amber-400">⚠ No center</span>}
                                            {client.enrolledBy && (
                                                <span>
                                                    <span className="font-semibold text-slate-500 dark:text-slate-400">FDO:</span>{' '}
                                                    {client.enrolledBy.name}
                                                    {client.enrolledBy.employeeId && (
                                                        <span className="ml-1 font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                            {client.enrolledBy.employeeId}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                            {client.bmReviewedBy && (
                                                <span>
                                                    <span className="font-semibold text-slate-500 dark:text-slate-400">BM:</span>{' '}
                                                    {client.bmReviewedBy.name}
                                                    {client.bmReviewedBy.employeeId && (
                                                        <span className="ml-1 font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                            {client.bmReviewedBy.employeeId}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                            {client.amReviewedBy && (
                                                <span>
                                                    <span className="font-semibold text-slate-500 dark:text-slate-400">AM:</span>{' '}
                                                    {client.amReviewedBy.name}
                                                    {client.amReviewedBy.employeeId && (
                                                        <span className="ml-1 font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                            {client.amReviewedBy.employeeId}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                            {client.qcVerifiedBy && (
                                                <span>
                                                    <span className="font-semibold text-slate-500 dark:text-slate-400">QC:</span>{' '}
                                                    {client.qcVerifiedBy.name}
                                                    {client.qcVerifiedBy.employeeId && (
                                                        <span className="ml-1 font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                            {client.qcVerifiedBy.employeeId}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                            {client.finalReviewedBy && (
                                                <span>
                                                    <span className="font-semibold text-slate-500 dark:text-slate-400">Admin:</span>{' '}
                                                    {client.finalReviewedBy.name}
                                                    {client.finalReviewedBy.employeeId && (
                                                        <span className="ml-1 font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                                            {client.finalReviewedBy.employeeId}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </button>

                                    {/* Highmark */}
                                    <HighmarkHistoryButton
                                        clientId={client.id}
                                        clientName={client.name}
                                        centerName={client.centerName}
                                        variant="outline"
                                        className="flex-shrink-0 h-auto py-1.5"
                                    />

                                    {/* Review CTA */}
                                    <button
                                        onClick={() => handleSelectClient(client.clientId)}
                                        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-primary/20 bg-green-50 px-3 py-1.5 text-xs font-medium text-sidebar-accent shadow-sm transition-all hover:border-primary/50 hover:bg-brand-green-tint hover:text-sidebar-accent dark:border-sidebar-accent dark:bg-sidebar-accent/20 dark:text-slate-300 dark:hover:bg-brand-green-darker/60 dark:hover:text-primary"
                                    >
                                        Review
                                        <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/20 pt-4 dark:border-sidebar-accent">
                            <p className="text-xs text-muted-foreground">
                                Showing{' '}
                                <span className="font-semibold text-foreground dark:text-slate-200">
                                    {(page - 1) * limit + 1}
                                </span>
                                {' – '}
                                <span className="font-semibold text-foreground dark:text-slate-200">
                                    {Math.min(page * limit, totalItems)}
                                </span>
                                {' of '}
                                <span className="font-semibold text-foreground dark:text-slate-200">{totalItems}</span>
                                {' '}members
                            </p>
                            <div className="flex items-center gap-1.5">
                                <Button
                                    variant="outline" size="sm"
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1 || loadingClients}
                                    className="h-8 gap-1 border-2"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                                </Button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                                        .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                                        .map((p, i, arr) => (
                                            <React.Fragment key={p}>
                                                {i > 0 && arr[i - 1] !== p - 1 && (
                                                    <span className="px-0.5 text-xs text-slate-400">…</span>
                                                )}
                                                <Button
                                                    variant={page === p ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setPage(p)}
                                                    disabled={loadingClients}
                                                    className={cn(
                                                        'h-8 w-8 p-0 border-2 text-xs',
                                                        page === p && 'bg-primary border-primary hover:bg-primary'
                                                    )}
                                                >
                                                    {p}
                                                </Button>
                                            </React.Fragment>
                                        ))}
                                </div>
                                <Button
                                    variant="outline" size="sm"
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages || loadingClients}
                                    className="h-8 gap-1 border-2"
                                >
                                    Next <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
//  Main Page Component — tabs between Member Approval and Co-Applicant Approval
// ─────────────────────────────────────────────
export function ApprovalWorkbenchClient() {
    const [tab, setTab] = useState<'client' | 'co-applicant' | 'renewal-loan'>('client');

    return (
        <div className="space-y-4">
            <div className="flex border-b border-primary/20 dark:border-sidebar-accent">
                <button
                    onClick={() => setTab('client')}
                    className={cn(
                        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                        tab === 'client'
                            ? 'border-primary text-sidebar-accent dark:text-primary'
                            : 'border-transparent text-slate-500 hover:text-sidebar-accent'
                    )}
                >
                    Member Approval
                </button>
                <button
                    onClick={() => setTab('renewal-loan')}
                    className={cn(
                        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                        tab === 'renewal-loan'
                            ? 'border-teal-500 text-teal-700 dark:text-teal-400'
                            : 'border-transparent text-slate-500 hover:text-teal-600'
                    )}
                >
                    Renewal Loan Approval
                </button>
                <button
                    onClick={() => setTab('co-applicant')}
                    className={cn(
                        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                        tab === 'co-applicant'
                            ? 'border-purple-500 text-purple-700 dark:text-purple-400'
                            : 'border-transparent text-slate-500 hover:text-purple-600'
                    )}
                >
                    Co-Applicant Approval
                </button>
            </div>

            {tab === 'client' && <ClientApprovalQueue />}
            {tab === 'renewal-loan' && <RenewalLoanApprovalQueue />}
            {tab === 'co-applicant' && <CoApplicantApprovalQueue />}
        </div>
    );
}
