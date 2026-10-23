'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Backpack, PackageCheck, Users2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { Skeleton } from '@/components/ui/skeleton';
import { BelongingProofList, type BelongingProof } from '@/components/hr/BelongingProofList';
import { toDisplayDate } from '@/app/lib/date-format';

type Employee = {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string | null;
    role: string;
    branch: { id: string; name: string; code: string } | null;
};

type BelongingItem = { id: string; roleSlug: string; itemName: string };

type IssuedRecord = {
    id: string;
    status: 'ISSUED' | 'RETURNED' | 'LOST' | 'DAMAGED';
    issuedDate: string;
    returnedDate: string | null;
    condition: string | null;
    recoveryAmount: string | null;
    belongingItem: BelongingItem;
    issuedBy: { firstName: string; lastName: string } | null;
    returnedTo: { firstName: string; lastName: string } | null;
    returnProofs: BelongingProof[];
};

const REVERSE_ROLE_MAP: Record<string, string> = {
    FDO: 'fdo',
    BRANCH_MANAGER: 'branch-manager',
    AREA_MANAGER: 'area-manager',
    ADMIN: 'admin',
    DIVISION_MANAGER: 'division-manager',
    QC: 'quality-checkers',
};

const ROLE_LABELS: Record<string, string> = {
    fdo: 'Field Development Officer',
    'branch-manager': 'Branch Manager',
    'area-manager': 'Area Manager',
    admin: 'Admin',
    'division-manager': 'Division Manager',
    'quality-checkers': 'Quality Checkers',
};

function statusVariant(status: string): 'default' | 'outline' | 'destructive' {
    if (status === 'ISSUED') return 'default';
    if (status === 'RETURNED') return 'outline';
    return 'destructive';
}

function employeeLabel(e: Employee): string {
    const code = e.employeeId ? ` (${e.employeeId})` : '';
    const branch = e.branch?.name ? ` · ${e.branch.name}` : '';
    return `${e.firstName} ${e.lastName}${code}${branch}`;
}

export function EmployeeBelongings() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    // Mirrors the URL — no separate local state, so deep links and
    // back/forward navigation just work via useSearchParams' own reactivity.
    const employeeId = searchParams.get('employeeId') || undefined;
    const { toast } = useToast();

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [employeesLoading, setEmployeesLoading] = useState(true);

    const [records, setRecords] = useState<IssuedRecord[]>([]);
    const [recordsLoading, setRecordsLoading] = useState(false);

    const [catalog, setCatalog] = useState<BelongingItem[]>([]);
    const [catalogLoaded, setCatalogLoaded] = useState(false);

    const [busyItemId, setBusyItemId] = useState<string | null>(null);
    const [showAllRoles, setShowAllRoles] = useState(false);

    // Reset show-all toggle when the selected employee changes so previous scope is not leaked
    useEffect(() => {
        setShowAllRoles(false);
    }, [employeeId]);

    // Employee list + catalog are independent of which employee is selected —
    // loaded once so the selector and the "empty catalog" hint are ready
    // immediately, before any employee is picked.
    useEffect(() => {
        (async () => {
            try {
                const [employeesRes, catalogRes] = await Promise.all([
                    apiClient.get<Employee[]>('/hr/employees'),
                    apiClient.get<BelongingItem[]>('/hr/belongings/catalog'),
                ]);
                if (employeesRes.success && employeesRes.data) setEmployees(employeesRes.data);
                if (catalogRes.success && catalogRes.data) setCatalog(catalogRes.data);
            } catch {
                toast({ title: 'Error', description: 'Failed to load employees or catalog.', variant: 'destructive' });
            } finally {
                setEmployeesLoading(false);
                setCatalogLoaded(true);
            }
        })();
    }, [toast]);

    // Records are fetched ONLY once an employee is selected — hitting
    // /hr/belongings/issued with no employeeId on a direct page visit was
    // the root cause of the reported failure (issuing then 400s because
    // there was never a selected employee to attach the item to).
    const fetchRecords = useCallback(async () => {
        if (!employeeId) {
            setRecords([]);
            return;
        }
        setRecordsLoading(true);
        try {
            const res = await apiClient.get<IssuedRecord[]>(`/hr/belongings/issued?employeeId=${employeeId}`);
            if (res.success && res.data) setRecords(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch belongings.', variant: 'destructive' });
        } finally {
            setRecordsLoading(false);
        }
    }, [employeeId, toast]);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);

    const handleEmployeeChange = (value: string) => {
        router.replace(`${pathname}?employeeId=${value}`);
    };

    const selectedEmployee = employees.find((e) => e.id === employeeId) ?? null;
    // Note: Multi-assignment users resolve via the synced legacy User.role column.
    const employeeSlug = selectedEmployee ? REVERSE_ROLE_MAP[selectedEmployee.role] : undefined;

    const visibleItems = showAllRoles || !employeeSlug
        ? catalog
        : catalog.filter((i) => i.roleSlug === employeeSlug);

    // Returning happens on its own full page (outcome, photo evidence, recovery
    // amount — see belonging-return-rules.ts), which brings the user back here.
    const openReturn = (record: IssuedRecord) => {
        const back = `${pathname}?employeeId=${employeeId ?? ''}`;
        router.push(`/dashboard/hr/belongings/return/${record.id}?returnTo=${encodeURIComponent(back)}`);
    };

    const handleToggle = async (item: BelongingItem, next: boolean) => {
        if (!employeeId) return;
        setBusyItemId(item.id);
        try {
            if (next) {
                // Defensive check: no-op if open record already exists
                // Note: Concurrent admin issuances may race as the server has no duplicate-open guard.
                const alreadyIssued = records.some(
                    (r) => r.belongingItem.id === item.id && r.status === 'ISSUED'
                );
                if (alreadyIssued) return;

                const res = await apiClient.post('/hr/belongings/issued', {
                    employeeId,
                    belongingItemId: item.id,
                });
                if (res.success) {
                    toast({ title: 'Issued', description: `${item.itemName} issued successfully.` });
                    await fetchRecords();
                } else {
                    throw new Error(res.error || 'Issue failed');
                }
            } else {
                // Unticking no longer closes the item silently — it opens the
                // Return dialog, which collects the required proof.
                const openRecord = records.find(
                    (r) => r.belongingItem.id === item.id && r.status === 'ISSUED'
                );
                if (openRecord) openReturn(openRecord);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Operation failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setBusyItemId(null);
        }
    };

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-4xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4 flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Backpack className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Employee Belongings</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Issued items such as collection bags and ID cards.
                            </p>
                        </div>
                    </div>
                    {catalogLoaded && catalog.length === 0 && (
                        <div className="flex flex-col items-end gap-1">
                            <button
                                type="button"
                                onClick={() => router.push('/dashboard/admin/hr-belonging-catalog')}
                                className="text-xs text-amber-600 hover:underline dark:text-amber-400"
                            >
                                No items in catalog — ask an Admin to add items first
                            </button>
                        </div>
                    )}
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="p-4 sm:p-6 space-y-2">
                        <Label className="text-xs text-gray-500">Employee</Label>
                        {employeesLoading ? (
                            <Skeleton className="h-10 w-full max-w-sm" />
                        ) : (
                            <Select value={employeeId ?? ''} onValueChange={handleEmployeeChange}>
                                <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select employee" /></SelectTrigger>
                                <SelectContent>
                                    {employees.map((e) => (
                                        <SelectItem key={e.id} value={e.id}>{employeeLabel(e)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </CardContent>
                </Card>

                {!employeeId ? (
                    <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <CardContent className="px-4 py-14 text-center text-slate-500 flex flex-col items-center gap-2">
                            <Users2 className="h-8 w-8 opacity-30" />
                            Select an employee above to view and issue belongings.
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardHeader className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-sidebar-accent">
                                <div className="flex items-center justify-between flex-wrap gap-3">
                                    <div>
                                        <CardTitle className="text-base font-semibold text-foreground dark:text-white">
                                            Quick Issue — tick to issue, untick to return
                                        </CardTitle>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                            {employeeSlug ? (
                                                <>Showing {visibleItems.length} items for role: {ROLE_LABELS[employeeSlug] ?? employeeSlug} ({employeeSlug})</>
                                            ) : selectedEmployee ? (
                                                <>Role &apos;{selectedEmployee.role}&apos; is not mapped — showing all items</>
                                            ) : null}
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                                        <Checkbox
                                            checked={showAllRoles}
                                            onCheckedChange={(checked) => setShowAllRoles(Boolean(checked))}
                                        />
                                        Show all roles&apos; items
                                    </label>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4 sm:p-6">
                                {visibleItems.length === 0 ? (
                                    <p className="text-sm text-slate-500">
                                        {catalog.length === 0
                                            ? 'No items available in the catalog.'
                                            : 'No items configured for this role in the catalog.'}
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                        {visibleItems.map((item) => {
                                            const isIssued = records.some(
                                                (r) => r.belongingItem.id === item.id && r.status === 'ISSUED'
                                            );
                                            const isBusy = busyItemId === item.id;
                                            return (
                                                <label
                                                    key={item.id}
                                                    className={`flex items-center gap-3 p-3 rounded-lg border border-primary/10 bg-white/50 dark:bg-brand-green-darker/50 transition-colors ${
                                                        isBusy
                                                            ? 'opacity-60 cursor-not-allowed'
                                                            : 'cursor-pointer hover:bg-green-50/50 dark:hover:bg-brand-green-darker/80'
                                                    }`}
                                                >
                                                    <Checkbox
                                                        checked={isIssued}
                                                        disabled={isBusy}
                                                        onCheckedChange={(checked) => handleToggle(item, Boolean(checked))}
                                                    />
                                                    <span className="text-sm font-medium text-foreground dark:text-slate-200">
                                                        {item.itemName} ({item.roleSlug})
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {recordsLoading ? (
                            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                                <CardContent className="p-6 space-y-3">
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                    <Skeleton className="h-8 w-full" />
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                                    <TableHead>Item</TableHead>
                                                    <TableHead>Issued Date</TableHead>
                                                    <TableHead>Issued By</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead>Return Proof</TableHead>
                                                    <TableHead className="text-center">Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {records.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                                            No belongings issued yet.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    records.map((record) => (
                                                        <TableRow key={record.id}>
                                                            <TableCell className="text-sm font-medium">{record.belongingItem.itemName}</TableCell>
                                                            <TableCell className="text-sm">{toDisplayDate(new Date(record.issuedDate))}</TableCell>
                                                            <TableCell className="text-sm">
                                                                {record.issuedBy ? `${record.issuedBy.firstName} ${record.issuedBy.lastName}` : '—'}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
                                                                {record.status !== 'ISSUED' && (
                                                                    <p className="mt-1 text-[11px] text-slate-500">
                                                                        {record.returnedDate ? toDisplayDate(new Date(record.returnedDate)) : ''}
                                                                        {record.returnedTo ? ` · to ${record.returnedTo.firstName} ${record.returnedTo.lastName}` : ''}
                                                                        {record.recoveryAmount && Number(record.recoveryAmount) > 0 ? ` · recover ₹${Number(record.recoveryAmount).toLocaleString('en-IN')}` : ''}
                                                                    </p>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {record.status === 'ISSUED'
                                                                    ? <span className="text-xs text-slate-400">—</span>
                                                                    : <BelongingProofList
                                                                        proofs={record.returnProofs ?? []}
                                                                        emptyText={record.status === 'LOST' ? 'No photo (lost item)' : 'None (returned before photos were required)'}
                                                                    />}
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                {record.status === 'ISSUED' && (
                                                                    <Button size="sm" variant="outline" onClick={() => openReturn(record)} className="gap-1.5 text-green-700">
                                                                        <PackageCheck className="h-4 w-4" /> Return
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
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
