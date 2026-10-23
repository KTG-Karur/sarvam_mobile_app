'use client';

import { useEffect, useState } from 'react';
import { Filter, ChevronDown } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { DateInput } from '@/components/ui/date-input';

interface SelectOption { id: string; name?: string; funderName?: string; code?: string }

export interface DashboardFilters {
    branchId: string;
    centerId: string;
    funderId: string;
    fromDate: string;
    toDate: string;
    // Admin-only hierarchical filters
    regionId: string;
    divisionId: string;
    areaId: string;
}

interface Props {
    filters: DashboardFilters;
    onChange: (f: DashboardFilters) => void;
}

const IST_TIME_ZONE = 'Asia/Kolkata';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** YYYY-MM-DD + delta days, via UTC-anchored arithmetic — never local Date methods. */
function addCalendarDaysToYmd(ymd: string, deltaDays: number): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) throw new Error(`Invalid YMD: ${ymd}`);
    const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Current week (Mon–Sun) in IST, computed with the viewer's browser timezone taken
 * out of the equation entirely. Previously this mixed `today.getDay()` (read in the
 * BROWSER's local timezone) with `.toISOString()` (always UTC) on the same Date —
 * those two disagree whenever the browser's local midnight sits on a different UTC
 * calendar day, which showed the wrong weekday next to a date in the dashboard's
 * per-day table. Anchoring "today" to the IST calendar day via Intl.DateTimeFormat,
 * then doing all arithmetic on that YYYY-MM-DD string, is timezone-independent — the
 * business week is defined by IST regardless of where the browser happens to be set.
 */
function getWeekRange() {
    const todayYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: IST_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    const todayDayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
        new Date(`${todayYmd}T00:00:00.000Z`)
    );
    const dow = DAYS.indexOf(todayDayName);
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const from = addCalendarDaysToYmd(todayYmd, mondayOffset);
    const to = addCalendarDaysToYmd(from, 6);
    return { from, to };
}

function SelectDropdown({
    label, value, onChange, options, placeholder, disabled,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: SelectOption[];
    placeholder: string;
    disabled?: boolean;
}) {
    return (
        <label className="flex flex-col gap-1 w-full sm:w-auto">
            <span className="text-xs font-medium text-slate-500">{label}</span>
            <div className="relative">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className="w-full appearance-none rounded-lg border border-primary/20 bg-green-50 py-1.5 pl-3 pr-8 text-sm text-sidebar-accent focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-100"
                >
                    <option value="">{placeholder}</option>
                    {options.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.code ? `${o.code} - ${(o.funderName ?? o.name)}` : (o.funderName ?? o.name)}
                        </option>
                    ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
        </label>
    );
}

export function DashboardFiltersBar({ filters, onChange }: Props) {
    // Defer token read to useEffect so server HTML and first client render agree —
    // tokenStorage reads localStorage, which is available synchronously in the
    // browser but not during SSR, so reading it directly in the render body makes
    // the client's first render diverge from the server's (hydration mismatch).
    const [user, setUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
    useEffect(() => {
        setUser(tokenStorage.getUser());
    }, []);
    const isAdmin = user?.role === 'ADMIN';
    const isFDO = user?.role === 'FDO';
    const isBM = user?.role === 'BRANCH_MANAGER';
    const bmBranchId = isBM ? (user?.branchId ?? '') : '';

    const [branches, setBranches] = useState<SelectOption[]>([]);
    const [centers, setCenters] = useState<SelectOption[]>([]);
    const [funders, setFunders] = useState<SelectOption[]>([]);
    // Admin-only hierarchical state
    const [regions, setRegions] = useState<SelectOption[]>([]);
    const [divisions, setDivisions] = useState<SelectOption[]>([]);
    const [areas, setAreas] = useState<SelectOption[]>([]);

    // Initial load: branches (not for BM), funders, and (Admin) regions
    useEffect(() => {
        if (isFDO) return;
        const loads: Promise<void>[] = [];
        if (!isBM) {
            loads.push(
                apiClient.get<any>('/branches?isActive=true').then((r) => {
                    if (r.success) setBranches((r.data as any)?.data ?? r.data ?? []);
                })
            );
        }
        loads.push(
            apiClient.get<any>('/masters/funder?isActive=true').then((r) => {
                if (r.success) setFunders((r.data as any)?.data ?? r.data ?? []);
            })
        );
        if (isAdmin) {
            loads.push(
                apiClient.get<any>('/regions').then((r) => {
                    if (r.success) setRegions((r.data as any)?.data ?? r.data ?? []);
                })
            );
        }
        Promise.all(loads);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFDO, isAdmin, isBM]);

    // Load divisions when regionId changes (Admin only)
    useEffect(() => {
        if (!isAdmin || !filters.regionId) { setDivisions([]); return; }
        apiClient.get<any>(`/divisions?regionId=${filters.regionId}`).then((r) => {
            if (r.success) setDivisions((r.data as any)?.data ?? r.data ?? []);
        });
    }, [filters.regionId, isAdmin]);

    // Load areas when divisionId changes (Admin only)
    useEffect(() => {
        if (!isAdmin || !filters.divisionId) { setAreas([]); return; }
        apiClient.get<any>(`/areas?divisionId=${filters.divisionId}`).then((r) => {
            if (r.success) setAreas((r.data as any)?.data ?? r.data ?? []);
        });
    }, [filters.divisionId, isAdmin]);

    // Load centers when branchId changes
    useEffect(() => {
        if (!filters.branchId || isFDO) { setCenters([]); return; }
        apiClient.get<any>(`/centers?branchId=${filters.branchId}&isActive=true`).then((r) => {
            if (r.success) setCenters((r.data as any)?.data ?? r.data ?? []);
        });
    }, [filters.branchId, isFDO]);

    const set = (key: keyof DashboardFilters, value: string) => {
        const next = { ...filters, [key]: value };
        // Cascade resets
        if (key === 'regionId') {
            next.divisionId = '';
            next.areaId = '';
            next.branchId = '';
            next.centerId = '';
        } else if (key === 'divisionId') {
            next.areaId = '';
            next.branchId = '';
            next.centerId = '';
        } else if (key === 'areaId') {
            next.branchId = '';
            next.centerId = '';
        } else if (key === 'branchId') {
            next.centerId = '';
        }
        onChange(next);
    };

    if (isFDO) return null;

    return (
        <div className="flex flex-wrap items-end gap-2 sm:gap-3 rounded-xl border border-primary/20 bg-white px-3 sm:px-5 py-3 sm:py-4 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker">
            <div className="flex items-center gap-2 text-sm font-semibold text-sidebar-accent dark:text-slate-400">
                <Filter className="h-4 w-4" />
                Filters
            </div>

            {/* Date Range */}
            <label className="flex flex-col gap-1 w-full sm:w-auto">
                <span className="text-xs font-medium text-slate-500">From Date</span>
                <DateInput
                    value={filters.fromDate}
                    max={filters.toDate}
                    onChange={(e) => set('fromDate', e.target.value)}
                    className="w-full rounded-lg border border-primary/20 bg-green-50 px-3 py-1.5 text-sm text-sidebar-accent focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-100"
                />
            </label>
            <label className="flex flex-col gap-1 w-full sm:w-auto">
                <span className="text-xs font-medium text-slate-500">To Date</span>
                <DateInput
                    value={filters.toDate}
                    min={filters.fromDate}
                    onChange={(e) => set('toDate', e.target.value)}
                    className="w-full rounded-lg border border-primary/20 bg-green-50 px-3 py-1.5 text-sm text-sidebar-accent focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-100"
                />
            </label>

            {/* Admin-only: Region → Division → Area */}
            {isAdmin && regions.length > 0 && (
                <SelectDropdown
                    label="Region"
                    value={filters.regionId}
                    onChange={(v) => set('regionId', v)}
                    options={regions}
                    placeholder="All Regions"
                />
            )}
            {isAdmin && filters.regionId && divisions.length > 0 && (
                <SelectDropdown
                    label="Division"
                    value={filters.divisionId}
                    onChange={(v) => set('divisionId', v)}
                    options={divisions}
                    placeholder="All Divisions"
                />
            )}
            {isAdmin && filters.divisionId && areas.length > 0 && (
                <SelectDropdown
                    label="Area"
                    value={filters.areaId}
                    onChange={(v) => set('areaId', v)}
                    options={areas}
                    placeholder="All Areas"
                />
            )}

            {/* Branch — hidden for BM (always scoped to their own branch) */}
            {!isBM && branches.length > 0 && (
                <SelectDropdown
                    label="Branch"
                    value={filters.branchId}
                    onChange={(v) => set('branchId', v)}
                    options={branches}
                    placeholder="All Branches"
                />
            )}

            {/* Center */}
            {centers.length > 0 && (
                <SelectDropdown
                    label="Center"
                    value={filters.centerId}
                    onChange={(v) => set('centerId', v)}
                    options={centers}
                    placeholder="All Centers"
                />
            )}

            {/* Funder */}
            {funders.length > 0 && (
                <SelectDropdown
                    label="Funder"
                    value={filters.funderId}
                    onChange={(v) => set('funderId', v)}
                    options={funders}
                    placeholder="All Funders"
                />
            )}

            {/* Reset */}
            <button
                type="button"
                onClick={() => {
                    const { from, to } = getWeekRange();
                    onChange({
                        branchId: isBM ? bmBranchId : '',
                        centerId: '', funderId: '',
                        fromDate: from, toDate: to,
                        regionId: '', divisionId: '', areaId: '',
                    });
                }}
                className="mt-5 rounded-lg border border-primary/20 bg-green-50 px-4 py-1.5 text-sm font-medium text-sidebar-accent transition hover:bg-brand-green-tint dark:border-sidebar-accent dark:bg-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent"
            >
                Reset
            </button>
        </div>
    );
}

export function getDefaultFilters(): DashboardFilters {
    // SSR-safe: never reads tokenStorage here — a useState initializer re-runs on
    // the client during hydration, so branching on localStorage here would cause
    // the same server/client mismatch this component works around above.
    // Callers should patch branchId in for BRANCH_MANAGER after mount instead.
    const { from, to } = getWeekRange();
    return {
        branchId: '',
        centerId: '', funderId: '',
        fromDate: from, toDate: to,
        regionId: '', divisionId: '', areaId: '',
    };
}
