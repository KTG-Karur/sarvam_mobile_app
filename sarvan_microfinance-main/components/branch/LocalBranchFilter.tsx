'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';

type BranchOption = { id: string; name: string; code: string };

/**
 * Report-local branch filter — unlike InlineBranchSwitcher, selecting a branch here
 * never calls POST /auth/active-branch, never writes to branchStorage, and never
 * dispatches `branchChanged`. It only changes which branch's data the current page
 * requests, so it can't leak into the user's session-wide active branch (header,
 * other pages, EOD locking, etc). The caller must thread `value` into its own
 * data-fetching (e.g. a `branchId` param on the relevant server actions).
 *
 * Renders for ADMIN (any branch), AREA_MANAGER (their assigned branches via
 * AreaManagerBranch), and any other role explicitly assigned more than one
 * branch (via UserBranchAssignment, embedded at login as `assignedBranchIds`) —
 * a single-branch user (the common case) never sees this control.
 */
export function LocalBranchFilter({
  value,
  onChange,
  className,
  includeAll = false,
}: {
  value: string;
  onChange: (branchId: string) => void;
  className?: string;
  /**
   * Opt-in: prepend an "All Branches" option whose value is 'all'. The caller must
   * forward 'all' to an API that understands it (e.g. resolveScopedBranchIds).
   */
  includeAll?: boolean;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [assignedBranchIds, setAssignedBranchIds] = useState<string[]>([]);
  const [options, setOptions] = useState<BranchOption[]>([]);

  useEffect(() => {
    const user = tokenStorage.getUser();
    setRole(user?.role ?? null);
    setUserId(user?.id ?? null);
    setAssignedBranchIds(user?.assignedBranchIds ?? []);
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
          setOptions(result.data.map((b) => ({ id: b.id, name: b.name, code: b.code })));
        }
      } else if (role === 'AREA_MANAGER' && userId) {
        const result = await apiClient.get<{ branch: BranchOption }[]>(
          `/area-manager-branches?userId=${userId}`
        );
        if (!cancelled && result.success && result.data) {
          setOptions(result.data.map((a) => a.branch));
        }
      } else if (isMultiBranchOtherRole) {
        const result = await apiClient.get<BranchOption[]>('/branches');
        if (!cancelled && result.success && result.data) {
          setOptions(result.data.filter((b) => assignedBranchIds.includes(b.id)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [role, userId, canPickBranch, isMultiBranchOtherRole, assignedBranchIds]);

  if (!canPickBranch) {
    return null;
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor="local-branch-filter">
        Branch
      </Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger id="local-branch-filter" className="h-10 w-full">
          <SelectValue placeholder="Select branch" />
        </SelectTrigger>
        <SelectContent>
          {includeAll && <SelectItem value="all">All Branches</SelectItem>}
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
