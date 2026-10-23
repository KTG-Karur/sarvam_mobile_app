'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { apiClient } from '@/app/lib/api-client';

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface TransactionBranchFieldProps {
    value: string;
    onChange: (branchId: string) => void;
    error?: string;
    disabled?: boolean;
}

/**
 * Required create-time branch selector — distinct from TransactionBranchFilter
 * (a list *filter* with an "all" sentinel). ADMIN / Sub-Admin must pick one of
 * all branches; BRANCH_MANAGER gets a locked, read-only field pre-filled with
 * their own branch.
 */
export function TransactionBranchField({ value, onChange, error, disabled }: TransactionBranchFieldProps) {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isPrivileged, setIsPrivileged] = useState(false);
    const [ownBranch, setOwnBranch] = useState<{ id: string; label: string } | null>(null);

    const fetchBranches = useCallback(async () => {
        try {
            const res = await apiClient.get<Branch[]>('/branches?includeInactive=false');
            if (res.success && res.data) setBranches(res.data);
        } catch (err) {
            console.error('Error fetching branches:', err);
        }
    }, []);

    useEffect(() => {
        const user = tokenStorage.getUser();
        const privileged = user?.role === 'ADMIN' || !!user?.isSubAdmin;
        setIsPrivileged(privileged);

        if (privileged) {
            fetchBranches();
            return;
        }

        // Non-privileged (BRANCH_MANAGER, FDO, etc.) — locked to their own branch.
        // Show the cached activeBranch immediately if present (avoids a blank flash;
        // BM never switches branches, so any cached value is theirs by construction),
        // but always resolve/confirm from the branches API too — using apiClient (not
        // raw fetch) so an expired access token is refreshed instead of silently
        // failing, and so a stale or missing localStorage cache never leaves the
        // field blank as long as the JWT still carries a branchId.
        const activeBranch = branchStorage.getActiveBranch();
        if (activeBranch) {
            setOwnBranch({ id: activeBranch.id, label: `${activeBranch.code} - ${activeBranch.name}` });
        }

        const targetBranchId = user?.branchId || activeBranch?.id;
        if (targetBranchId) {
            apiClient.get<Branch[]>('/branches?includeInactive=true')
                .then((res) => {
                    if (!res.success || !res.data) return;
                    const match = res.data.find((b) => b.id === targetBranchId);
                    if (match) setOwnBranch({ id: match.id, label: `${match.code} - ${match.name}` });
                })
                .catch((err) => console.error('Error fetching branches:', err));
        }
    }, [fetchBranches]);

    // Keep the controlled value in sync with the resolved own-branch id — a
    // read-only field can't be re-picked, so if the parent form clears/resets
    // it (e.g. after a successful save), re-apply it here.
    useEffect(() => {
        if (!isPrivileged && ownBranch && value !== ownBranch.id) {
            onChange(ownBranch.id);
        }
    }, [isPrivileged, ownBranch, value, onChange]);

    return (
        <div className="flex flex-col gap-1.5">
            <Label>Branch</Label>
            {isPrivileged ? (
                <Select value={value} onValueChange={onChange} disabled={disabled}>
                    <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a branch" />
                    </SelectTrigger>
                    <SelectContent>
                        {branches.map((branch) => (
                            <SelectItem key={branch.id} value={branch.id}>
                                {branch.code} - {branch.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : (
                <Input value={ownBranch?.label ?? ''} disabled readOnly />
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
    );
}
