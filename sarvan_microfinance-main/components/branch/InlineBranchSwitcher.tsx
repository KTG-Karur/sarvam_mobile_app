'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage, type StoredBranch } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { useToast } from '@/hooks/use-toast';

type BranchOption = { id: string; name: string; code: string };

/**
 * Session-wide branch picker for pages that only read `branchStorage.getActiveBranch()`
 * (no per-request branchId override exists server-side for these screens). Selecting a
 * branch here calls POST /api/auth/active-branch (the same endpoint the header/session
 * branch context uses), persists it to branchStorage, and notifies the caller so it can
 * refetch — same effect as visiting /dashboard/branch/change first, just inline.
 *
 * Renders for ADMIN (any active branch), AREA_MANAGER (their assigned branches via
 * AreaManagerBranch), and any other role that has been explicitly assigned more than
 * one branch (via UserBranchAssignment, embedded at login as `assignedBranchIds`) —
 * a single-branch user (the common case) never sees this control.
 */
const HO_BRANCH_CODE = 'HO';
const HO_BRANCH_NAME = 'head office';

function isHeadOfficeOption(b: BranchOption): boolean {
    return b.code === HO_BRANCH_CODE || b.name.trim().toLowerCase() === HO_BRANCH_NAME;
}

export function InlineBranchSwitcher({
    onBranchChange,
    className,
    excludeHeadOffice = false,
    autoSelectSingleOption = false,
    pageLocal = false,
}: {
    onBranchChange?: (branch: StoredBranch) => void;
    className?: string;
    /** Drop the Head Office branch from the selectable options (client-side filter — GET /branches has no server-side HO exclusion). */
    excludeHeadOffice?: boolean;
    /** When exactly one option remains (after HO exclusion) and nothing valid is currently selected, auto-pick it — no manual click required. */
    autoSelectSingleOption?: boolean;
    /** Page-local mode: selecting a branch only calls onBranchChange — never POST /auth/active-branch, branchStorage or `branchChanged`, so the header/session branch is untouched. Initial value still defaults from the session's active branch. */
    pageLocal?: boolean;
}) {
    const { toast } = useToast();
    const [role, setRole] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [assignedBranchIds, setAssignedBranchIds] = useState<string[]>([]);
    const [options, setOptions] = useState<BranchOption[]>([]);
    const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
    const [isSwitching, setIsSwitching] = useState(false);

    useEffect(() => {
        const user = tokenStorage.getUser();
        setRole(user?.role ?? null);
        setUserId(user?.id ?? null);
        setAssignedBranchIds(user?.assignedBranchIds ?? []);
        setActiveBranchId(branchStorage.getActiveBranch()?.id ?? null);
    }, []);

    const isMultiBranchOtherRole =
        !!role && role !== 'ADMIN' && role !== 'AREA_MANAGER' && assignedBranchIds.length > 1;
    const canPickBranch = role === 'ADMIN' || role === 'AREA_MANAGER' || isMultiBranchOtherRole;

    useEffect(() => {
        if (!canPickBranch) return;
        let cancelled = false;

        void (async () => {
            if (role === 'ADMIN') {
                const result = await apiClient.get<BranchOption[]>('/branches');
                if (!cancelled && result.success && result.data) {
                    const mapped = result.data.map((b) => ({ id: b.id, name: b.name, code: b.code }));
                    setOptions(excludeHeadOffice ? mapped.filter((b) => !isHeadOfficeOption(b)) : mapped);
                }
            } else if (role === 'AREA_MANAGER' && userId) {
                const result = await apiClient.get<{ branch: BranchOption }[]>(
                    `/area-manager-branches?userId=${userId}`
                );
                if (!cancelled && result.success && result.data) {
                    const mapped = result.data.map((a) => a.branch);
                    setOptions(excludeHeadOffice ? mapped.filter((b) => !isHeadOfficeOption(b)) : mapped);
                }
            } else if (isMultiBranchOtherRole) {
                // Any other role explicitly assigned multiple branches (UserBranchAssignment):
                // fetch the full list and filter client-side to just their assigned set.
                const result = await apiClient.get<BranchOption[]>('/branches');
                if (!cancelled && result.success && result.data) {
                    const mapped = result.data
                        .filter((b) => assignedBranchIds.includes(b.id))
                        .map((b) => ({ id: b.id, name: b.name, code: b.code }));
                    setOptions(excludeHeadOffice ? mapped.filter((b) => !isHeadOfficeOption(b)) : mapped);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [role, userId, canPickBranch, isMultiBranchOtherRole, assignedBranchIds, excludeHeadOffice]);

    const handleChange = async (branchId: string) => {
        const branch = options.find((b) => b.id === branchId);
        if (!branch) return;

        const stored: StoredBranch = { id: branch.id, name: branch.name, code: branch.code };
        if (pageLocal) {
            setActiveBranchId(branch.id);
            onBranchChange?.(stored);
            return;
        }

        setIsSwitching(true);
        try {
            const result = await apiClient.post<{ branchId: string }>('/auth/active-branch', { branchId });
            if (!result.success) {
                toast({
                    title: 'Could not switch branch',
                    description: result.error ?? 'Please try again.',
                    variant: 'destructive',
                });
                return;
            }

            branchStorage.setActiveBranch(stored);
            window.dispatchEvent(new CustomEvent('branchChanged', { detail: stored }));
            setActiveBranchId(branch.id);
            onBranchChange?.(stored);
        } finally {
            setIsSwitching(false);
        }
    };

    // Treat a stored active branch that isn't among the (possibly HO-filtered) options as unset,
    // and auto-pick the sole remaining option when requested — both only once options have loaded.
    useEffect(() => {
        if (options.length === 0) return;

        const isActiveValid = activeBranchId != null && options.some((b) => b.id === activeBranchId);
        if (activeBranchId != null && !isActiveValid) {
            setActiveBranchId(null);
        }

        if (autoSelectSingleOption && options.length === 1 && !isActiveValid) {
            void handleChange(options[0].id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [options, autoSelectSingleOption]);

    if (!canPickBranch) {
        return null;
    }

    return (
        <div className={className}>
            <Label htmlFor="active-branch-switcher" className="text-sm font-semibold text-gray-700 mb-1 block">
                Branch
            </Label>
            <Select
                value={activeBranchId ?? undefined}
                onValueChange={(v) => void handleChange(v)}
                disabled={options.length === 0 || isSwitching}
            >
                <SelectTrigger id="active-branch-switcher" className="h-10 w-[220px]">
                    {isSwitching ? (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Switching…
                        </span>
                    ) : (
                        <SelectValue placeholder="Select branch" />
                    )}
                </SelectTrigger>
                <SelectContent>
                    {options.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                            {b.code} — {b.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
