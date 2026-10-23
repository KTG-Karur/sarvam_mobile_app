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
import { tokenStorage } from '@/app/lib/token-storage';

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface TransactionBranchFilterProps {
    value: string;
    onChange: (branchId: string) => void;
}

export function TransactionBranchFilter({ value, onChange }: TransactionBranchFilterProps) {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isAM, setIsAM] = useState(false);

    const fetchBranches = useCallback(async (admin: boolean, am: boolean, assignedBranchIds: string[]) => {
        if (!admin && !am) return;
        try {
            const res = await fetch('/api/branches?includeInactive=false');
            const data = await res.json();
            if (!res.ok) return;
            let list: Branch[] = data.data || [];
            if (am && assignedBranchIds.length > 0) {
                list = list.filter((b) => assignedBranchIds.includes(b.id));
            }
            setBranches(list);
        } catch (err) {
            console.error('Error fetching branches:', err);
        }
    }, []);

    useEffect(() => {
        const user = tokenStorage.getUser();
        const admin = user?.role === 'ADMIN';
        const am = user?.role === 'AREA_MANAGER';
        setIsAdmin(admin);
        setIsAM(am);
        const assignedBranchIds = (user as any)?.assignedBranchIds ?? [];
        fetchBranches(admin, am, assignedBranchIds);
    }, [fetchBranches]);

    if (!isAdmin && !isAM) return null;

    return (
        <div className="flex items-center gap-2">
            <Label className="text-sm font-medium whitespace-nowrap">Branch</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{isAM ? 'All Assigned Branches' : 'All Branches'}</SelectItem>
                    {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                            {branch.code} - {branch.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
