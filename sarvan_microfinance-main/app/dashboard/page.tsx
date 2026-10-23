'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { TaskDetailsCard } from '@/components/dashboard/TaskDetailsCard';
import {
    DashboardFiltersBar,
    DashboardFilters,
    getDefaultFilters,
} from '@/components/dashboard/v2/DashboardFiltersBar';
import {
    StatCardsGrid,
    StatCardsGridSkeleton,
    DashboardStats,
} from '@/components/dashboard/v2/StatCardsGrid';
import {
    DemandCollectionTable,
    DemandCollectionRow,
} from '@/components/dashboard/v2/DemandCollectionTable';
import { LoanIndexTable, LoanIndexRow } from '@/components/dashboard/v2/LoanIndexTable';
import { EODStatusTableV2, EODRowV2 } from '@/components/dashboard/v2/EODStatusTableV2';
import { OfficerLoanTable, OfficerLoanRow } from '@/components/dashboard/v2/OfficerLoanTable';

interface DashboardV2Response {
    stats: DashboardStats;
    demandCollection: DemandCollectionRow[];
    loanIndexes: LoanIndexRow[];
    eodStatus: EODRowV2[];
    officerLoanDetails: OfficerLoanRow[];
}

function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
    return (
        <div className="overflow-hidden rounded-xl border border-primary/20 bg-white shadow-xl dark:border-sidebar-accent dark:bg-brand-green-darker">
            <div className="h-16 bg-brand-green-tint dark:bg-sidebar-accent" />
            <div className="p-4 space-y-2">
                {Array.from({ length: rows }).map((_, i) => (
                    <div key={i} className="flex gap-4">
                        {Array.from({ length: cols }).map((_, j) => (
                            <div key={j} className="h-8 flex-1 rounded bg-brand-green-tint dark:bg-sidebar-accent" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function DashboardPage() {
    const { toast } = useToast();

    // Defer token read to useEffect so server HTML and first client render agree.
    // tokenStorage reads localStorage which doesn't exist on the server, causing
    // isAdmin/isFDO to differ between SSR (null) and client (real user) → hydration mismatch.
    const [user, setUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
    const isFDO = user?.role === 'FDO';
    const isAdmin = user?.role === 'ADMIN';

    const [data, setData] = useState<DashboardV2Response | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [filters, setFilters] = useState<DashboardFilters>(getDefaultFilters);
    const activeReqRef = useRef(0);
    const loadedOnceRef = useRef(false);

    const fetchData = async (f: DashboardFilters) => {
        const reqId = ++activeReqRef.current;
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (f.branchId) params.set('branchId', f.branchId);
            if (f.centerId) params.set('centerId', f.centerId);
            if (f.funderId) params.set('funderId', f.funderId);
            if (f.fromDate) params.set('fromDate', f.fromDate);
            if (f.toDate) params.set('toDate', f.toDate);
            if (f.regionId) params.set('regionId', f.regionId);
            if (f.divisionId) params.set('divisionId', f.divisionId);
            if (f.areaId) params.set('areaId', f.areaId);

            const qs = params.toString();
            const result = await apiClient.get<DashboardV2Response>(
                `/dashboard/v2${qs ? `?${qs}` : ''}`
            );

            if (reqId !== activeReqRef.current) return;

            if (result.success && result.data) {
                setData(result.data);
                loadedOnceRef.current = true;
            } else if (result.error) {
                toast({ title: 'Dashboard', description: result.error, variant: 'default' });
            }
        } catch {
            if (reqId === activeReqRef.current) {
                toast({ title: 'Error', description: 'Failed to connect to server', variant: 'destructive' });
            }
        } finally {
            if (reqId === activeReqRef.current) setIsLoading(false);
        }
    };

    const handleFiltersChange = (f: DashboardFilters) => {
        setFilters(f);
        fetchData(f);
    };

    useEffect(() => {
        // Read user from localStorage only on the client, after hydration
        const loadedUser = tokenStorage.getUser();
        setUser(loadedUser);

        // getDefaultFilters() can't read tokenStorage (SSR-safe), so a
        // BRANCH_MANAGER's default branchId is patched in here instead, once.
        let effectiveFilters = filters;
        if (loadedUser?.role === 'BRANCH_MANAGER' && loadedUser.branchId && !filters.branchId) {
            effectiveFilters = { ...filters, branchId: loadedUser.branchId };
            setFilters(effectiveFilters);
        }

        fetchData(effectiveFilters);

        const onBranchChange = () => fetchData(effectiveFilters);
        window.addEventListener('branchChanged', onBranchChange);
        return () => window.removeEventListener('branchChanged', onBranchChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isInitialLoad = isLoading && !loadedOnceRef.current;
    const isRefreshing = isLoading && loadedOnceRef.current;

    return (
        <div className="relative space-y-6 animate-in fade-in duration-500" aria-busy={isLoading}>
            {/* Header */}
            <PageHeader
                title="Dashboard"
                description="Comprehensive overview of your microfinance operations"
                badge="Live"
                actions={[
                    {
                        label: isLoading ? 'Refreshing...' : 'Refresh',
                        onClick: () => fetchData(filters),
                        icon: isLoading ? Loader2 : RefreshCw,
                        variant: 'outline',
                    },
                ]}
            />

            {/* Filters */}
            <DashboardFiltersBar filters={filters} onChange={handleFiltersChange} />

            {/* Task Details Card for FDO, BM, AM, and Admin */}
            {(isFDO || user?.role === 'BRANCH_MANAGER' || user?.role === 'AREA_MANAGER' || user?.role === 'DIVISION_MANAGER' || user?.role === 'ADMIN') && <TaskDetailsCard filters={filters} />}

            {/* Stat Cards */}
            {isInitialLoad ? (
                <StatCardsGridSkeleton isAdmin={isAdmin} />
            ) : (
                <StatCardsGrid stats={data?.stats} isAdmin={isAdmin} />
            )}

            {/* Tables — hidden for FDO */}
            {!isFDO && (
                <div className="space-y-6">
                    {/* Demand Collection */}
                    {isInitialLoad ? (
                        <TableSkeleton rows={7} cols={12} />
                    ) : (
                        <DemandCollectionTable data={data?.demandCollection} filters={filters} exportLabel={`${filters.fromDate}_${filters.toDate}`} />
                    )}

                    {/* Loan Index + EOD side by side on large screens */}
                    <div className="space-y-6">
                        {isInitialLoad ? (
                            <>
                                <TableSkeleton rows={6} cols={6} />
                                <TableSkeleton rows={6} cols={6} />
                            </>
                        ) : (
                            <>
                                <LoanIndexTable data={data?.loanIndexes} />
                                <EODStatusTableV2 data={data?.eodStatus} />
                            </>
                        )}
                    </div>

                    {/* Officer Loan Details */}
                    {isInitialLoad ? (
                        <TableSkeleton rows={5} cols={10} />
                    ) : (
                        <OfficerLoanTable data={data?.officerLoanDetails} />
                    )}
                </div>
            )}

            <DashboardFooter />

            {/* Refresh overlay */}
            {isRefreshing && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/40 via-white/10 to-transparent backdrop-blur-[1px] dark:from-green-950/20 dark:via-green-950/5" />
                    <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-primary/20 bg-white/80 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                        <Loader2 className="h-4 w-4 animate-spin text-primary dark:text-primary" />
                        <span className="text-xs font-semibold text-sidebar-accent dark:text-slate-200">
                            Updating…
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
