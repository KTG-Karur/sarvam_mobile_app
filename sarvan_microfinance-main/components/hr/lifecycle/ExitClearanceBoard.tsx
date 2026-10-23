'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { LogOut, Plus, Eye, CheckCircle2, Flag, Download, Backpack, ExternalLink, XCircle, PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { AwaitingApprovalStage, type RecordApproval } from '@/components/hr/AwaitingApprovalStage';
import { downloadBlobFile } from '@/app/lib/download-letter';
import { BelongingProofList, type BelongingProof } from '@/components/hr/BelongingProofList';
import { OUTCOME_LABELS } from '@/app/lib/hr/belonging-return-rules';
import { ExitRequestWorkflow } from './ExitRequestWorkflow';
import { toDisplayDate } from '@/app/lib/date-format';

export type Employee = {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string | null;
    profilePhotoUrl?: string | null;
    /** ID-card photo storage key from GET /hr/employees (see app/lib/hr/employee-photo.ts). */
    photoKey?: string | null;
    branch?: { name: string } | null;
    designation?: { name: string } | null;
};

const EXIT_TYPES = [
    { value: 'VOLUNTARY_RESIGNATION', label: 'Voluntary Resignation' },
    { value: 'ABSCONDING', label: 'Absconding' },
    { value: 'ASK_TO_GO', label: 'Ask to Go' },
    { value: 'APPOINTMENT_CANCELLATION', label: 'Appointment Cancellation' },
    { value: 'TERMINATION', label: 'Termination' },
    { value: 'DECEASED', label: 'Deceased' },
    { value: 'RETIREMENT', label: 'Retirement' },
];

type ClearanceItem = {
    id: string;
    department: string;
    itemName: string;
    status: 'PENDING' | 'CLEARED' | 'FLAGGED';
    remarks: string | null;
    clearedBy: { firstName: string; lastName: string } | null;
};

type OutstandingBelonging = { id: string; itemName: string; issuedDate: string };
type ReturnedBelonging = {
    id: string;
    itemName: string;
    status: 'RETURNED' | 'LOST' | 'DAMAGED';
    returnedDate: string | null;
    condition: string | null;
    remarks: string | null;
    recoveryAmount: string | null;
    returnedTo: { firstName: string; lastName: string } | null;
    proofs: BelongingProof[];
};

type ExitRequest = {
    id: string;
    exitType: string;
    status: 'IN_PROGRESS' | 'HR_APPROVED' | 'REJECTED' | 'COMPLETED';
    lastWorkingDate: string;
    relievingLetterUrl: string | null;
    employee: { id: string; firstName: string; lastName: string; employeeId: string | null; branch: { name: string } | null };
    clearanceItems: ClearanceItem[];
    approval: RecordApproval | null;
    // List rows carry just the count (cheap, batched); the detail fetch carries
    // the full list (fetchDetail below) — both live on this one shared type.
    outstandingBelongingsCount?: number;
    outstandingBelongings?: OutstandingBelonging[];
    returnedBelongings?: ReturnedBelonging[];
};

function exitTypeLabel(value: string) {
    return EXIT_TYPES.find((t) => t.value === value)?.label ?? value;
}

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'COMPLETED') return 'default';
    if (status === 'REJECTED') return 'destructive';
    return 'outline';
}

function itemStatusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'CLEARED') return 'default';
    if (status === 'FLAGGED') return 'destructive';
    return 'outline';
}

export function ExitClearanceBoard() {
    const { toast } = useToast();
    const [rows, setRows] = useState<ExitRequest[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const router = useRouter();
    const searchParams = useSearchParams();
    // ?exitId= reopens that exit's checklist — the Return Belonging page sends
    // the user back here with it after recording a return.
    const [detailId, setDetailId] = useState<string | null>(() => searchParams.get('exitId'));
    const [isRejectOpen, setIsRejectOpen] = useState(false);
    const [rejectRemarks, setRejectRemarks] = useState('');
    const [detail, setDetail] = useState<ExitRequest | null>(null);

    const fetchAll = useCallback(async () => {
        try {
            const [rowsRes, employeesRes] = await Promise.all([
                apiClient.get<ExitRequest[]>('/hr/exit-requests'),
                apiClient.get<Employee[]>('/hr/employees?status=active'),
            ]);
            if (rowsRes.success && rowsRes.data) setRows(rowsRes.data);
            if (employeesRes.success && employeesRes.data) setEmployees(employeesRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch exit requests.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const fetchDetail = useCallback(async (id: string) => {
        try {
            const res = await apiClient.get<ExitRequest>(`/hr/exit-requests/${id}`);
            if (res.success && res.data) setDetail(res.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch exit request detail.', variant: 'destructive' });
        }
    }, [toast]);

    useEffect(() => {
        if (detailId) fetchDetail(detailId);
        else setDetail(null);
    }, [detailId, fetchDetail]);

    const handleClearItem = async (item: ClearanceItem, status: 'CLEARED' | 'FLAGGED') => {
        if (!detailId) return;
        try {
            const res = await apiClient.post(`/hr/exit-requests/${detailId}/clearance-items/${item.id}/clear`, { status });
            if (res.success) {
                await fetchDetail(detailId);
                await fetchAll();
            } else {
                throw new Error(res.error || 'Update failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Update failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleFinalApprove = async () => {
        if (!detailId) return;
        try {
            const res = await apiClient.post(`/hr/exit-requests/${detailId}/final-approve`);
            if (res.success) {
                toast({ title: 'Approved', description: res.message || 'NDC issued, relieving letter generated, employee deactivated.' });
                await fetchDetail(detailId);
                await fetchAll();
            } else {
                throw new Error(res.error || 'Finalization failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Finalization failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    // Without this an exit request that was started by mistake (or where the
    // employee stays) could only ever be completed — the reject endpoint existed
    // but nothing on the page called it.
    const handleRejectExit = async () => {
        if (!detailId || !rejectRemarks.trim()) return;
        try {
            const res = await apiClient.post(`/hr/exit-requests/${detailId}/reject`, { reviewRemarks: rejectRemarks.trim() });
            if (res.success) {
                toast({ title: 'Rejected', description: 'Exit request rejected — the employee stays active.' });
                setIsRejectOpen(false);
                setRejectRemarks('');
                await fetchDetail(detailId);
                await fetchAll();
            } else {
                throw new Error(res.error || 'Rejection failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Rejection failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleDownloadLetter = async () => {
        if (!detail) return;
        try {
            const empCode = detail.employee.employeeId || detail.id;
            await downloadBlobFile(`/hr/exit-requests/${detail.id}/letter`, `relieving-letter-${empCode}.pdf`);
            toast({ title: 'Success', description: 'Relieving letter downloaded.' });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Could not download relieving letter.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const groupedItems = useMemo(() => {
        if (!detail) return {} as Record<string, ClearanceItem[]>;
        return detail.clearanceItems.reduce((acc, item) => {
            (acc[item.department] ??= []).push(item);
            return acc;
        }, {} as Record<string, ClearanceItem[]>);
    }, [detail]);

    const allCleared = detail
        ? detail.clearanceItems.every((i) => i.status === 'CLEARED') && (detail.outstandingBelongings?.length ?? 0) === 0
        : false;
    // Lost / damaged items to settle against the employee's final dues.
    const recoveryTotal = (detail?.returnedBelongings ?? []).reduce((sum, b) => sum + (Number(b.recoveryAmount) || 0), 0);

    if (isLoading) {
        return <PageLoader label="Loading Exit Requests..." fullScreen={false} />;
    }

    if (isCreateOpen) {
        return (
            <ExitRequestWorkflow
                employees={employees}
                onCancel={() => setIsCreateOpen(false)}
                onSubmitted={async () => {
                    setIsCreateOpen(false);
                    await fetchAll();
                }}
            />
        );
    }

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-8 flex items-center justify-between mt-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <LogOut className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Exit &amp; Clearance</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Parallel department clearance → Final HR Approval → NDC → Relieving Letter.
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => setIsCreateOpen(true)} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Initiate Exit
                    </Button>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Employee</TableHead>
                                        <TableHead>Exit Type</TableHead>
                                        <TableHead>Last Working Date</TableHead>
                                        <TableHead>Clearance Progress</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">No exit requests yet.</TableCell>
                                        </TableRow>
                                    ) : (
                                        rows.map((row) => {
                                            const cleared = row.clearanceItems.filter((i) => i.status === 'CLEARED').length;
                                            return (
                                                <TableRow key={row.id}>
                                                    <TableCell className="text-sm font-medium">
                                                        {row.employee.firstName} {row.employee.lastName}
                                                        <div className="text-xs text-slate-500">
                                                            {row.employee.employeeId ?? '—'}
                                                            {row.employee.branch?.name ? ` · ${row.employee.branch.name}` : ''}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{exitTypeLabel(row.exitType)}</TableCell>
                                                    <TableCell className="text-sm">{toDisplayDate(new Date(row.lastWorkingDate))}</TableCell>
                                                    <TableCell className="text-sm">
                                                        {/* 0/0 would read like "nothing done yet" — there's simply nothing to clear. */}
                                                        {row.clearanceItems.length === 0
                                                            ? <span className="text-slate-500">No clearance items</span>
                                                            : `${cleared}/${row.clearanceItems.length} cleared`}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                                                        {row.status === 'IN_PROGRESS' && !!row.outstandingBelongingsCount && (
                                                            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                                                                <Backpack className="h-3 w-3" />
                                                                {row.outstandingBelongingsCount} belonging{row.outstandingBelongingsCount > 1 ? 's' : ''} not returned
                                                            </div>
                                                        )}
                                                        {row.status === 'IN_PROGRESS' && cleared === row.clearanceItems.length && !row.outstandingBelongingsCount && (
                                                            <AwaitingApprovalStage approval={row.approval} />
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <Button size="sm" variant="ghost" onClick={() => setDetailId(row.id)} title="View">
                                                                <Eye className="h-4 w-4" />
                                                            </Button>
                                                            {(row.status === 'HR_APPROVED' || row.status === 'COMPLETED' || row.relievingLetterUrl) && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={async () => {
                                                                        try {
                                                                            const empCode = row.employee.employeeId || row.id;
                                                                            await downloadBlobFile(`/hr/exit-requests/${row.id}/letter`, `relieving-letter-${empCode}.pdf`);
                                                                            toast({ title: 'Success', description: 'Relieving letter downloaded.' });
                                                                        } catch (err: unknown) {
                                                                            const msg = err instanceof Error ? err.message : 'Download failed';
                                                                            toast({ title: 'Error', description: msg, variant: 'destructive' });
                                                                        }
                                                                    }}
                                                                    title="Download Relieving Letter"
                                                                >
                                                                    <Download className="h-4 w-4" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog
                open={!!detailId}
                onOpenChange={(open) => {
                    if (open) return;
                    setDetailId(null);
                    if (searchParams.get('exitId')) router.replace('/dashboard/hr/lifecycle/exit');
                }}
            >
                {/* sm:max-w-2xl, not max-w-2xl — DialogContent's own sm:max-w-lg
                    otherwise wins at desktop widths and squeezes the footer. */}
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
                    <DialogHeader><DialogTitle>Exit Clearance Checklist</DialogTitle></DialogHeader>
                    {detail && (
                        <div className="space-y-4 py-2">
                            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
                                <span className="min-w-0 truncate font-semibold">{detail.employee.firstName} {detail.employee.lastName}</span>
                                <Badge variant={statusVariant(detail.status)} className="shrink-0">{detail.status.replace(/_/g, ' ')}</Badge>
                            </div>
                            {Object.keys(groupedItems).length === 0 && (
                                <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-slate-500">
                                    No clearance items for this exit request.
                                </p>
                            )}
                            {Object.entries(groupedItems).map(([department, items]) => {
                                const clearedCount = items.filter((i) => i.status === 'CLEARED').length;
                                return (
                                    <div key={department} className="border rounded-md p-3">
                                        <div className="text-xs font-bold uppercase text-slate-500 mb-2">
                                            {department.replace(/_/g, ' ')} ({clearedCount}/{items.length} cleared)
                                        </div>
                                        <ul className="space-y-2">
                                            {items.map((item) => (
                                                <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                                    <span className="min-w-0 break-words">{item.itemName}</span>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        <Badge variant={itemStatusVariant(item.status)}>{item.status}</Badge>
                                                        {item.status === 'PENDING' && detail.status === 'IN_PROGRESS' && (
                                                            <>
                                                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-green-600" onClick={() => handleClearItem(item, 'CLEARED')} title="Clear">
                                                                    <CheckCircle2 className="h-4 w-4" />
                                                                </Button>
                                                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-amber-600" onClick={() => handleClearItem(item, 'FLAGGED')} title="Flag">
                                                                    <Flag className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                        {item.status === 'FLAGGED' && detail.status === 'IN_PROGRESS' && (
                                                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-green-600" onClick={() => handleClearItem(item, 'CLEARED')} title="Re-clear">
                                                                <CheckCircle2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                            {detail.status === 'IN_PROGRESS' && !!detail.outstandingBelongings?.length && (
                                <div className="border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 rounded-md p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-bold uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                            <Backpack className="h-3.5 w-3.5" />
                                            Outstanding Belongings ({detail.outstandingBelongings.length})
                                        </div>
                                        <Link
                                            href={`/dashboard/hr/belongings?employeeId=${detail.employee.id}`}
                                            className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                                        >
                                            Open Belongings page <ExternalLink className="h-3 w-3" />
                                        </Link>
                                    </div>
                                    <p className="text-xs text-amber-800 dark:text-amber-300">
                                        Not returned yet — Final HR Approval is blocked until each one is recorded as returned
                                        (with a photo), damaged (with a photo) or lost (with a recovery amount).
                                    </p>
                                    <ul className="space-y-1.5">
                                        {detail.outstandingBelongings.map((b) => (
                                            <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                                                <span className="min-w-0">
                                                    <span className="block truncate">{b.itemName}</span>
                                                    <span className="text-xs text-slate-500">Issued {toDisplayDate(new Date(b.issuedDate))}</span>
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 shrink-0 gap-1.5 bg-white dark:bg-transparent"
                                                    onClick={() => router.push(
                                                        `/dashboard/hr/belongings/return/${b.id}?returnTo=${encodeURIComponent(`/dashboard/hr/lifecycle/exit?exitId=${detail.id}`)}`
                                                    )}
                                                >
                                                    <PackageCheck className="h-3.5 w-3.5" /> Return
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {!!detail.returnedBelongings?.length && (
                                <div className="border rounded-md p-3 space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
                                            <PackageCheck className="h-3.5 w-3.5" />
                                            Returned Belongings ({detail.returnedBelongings.length})
                                        </div>
                                        {recoveryTotal > 0 && (
                                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                                                To recover: ₹{recoveryTotal.toLocaleString('en-IN')}
                                            </span>
                                        )}
                                    </div>
                                    <ul className="space-y-3">
                                        {detail.returnedBelongings.map((b) => (
                                            <li key={b.id} className="space-y-1.5 border-t pt-3 first:border-t-0 first:pt-0">
                                                <div className="flex items-start justify-between gap-3 text-sm">
                                                    <span className="min-w-0 font-medium break-words">{b.itemName}</span>
                                                    <Badge variant={b.status === 'RETURNED' ? 'outline' : 'destructive'} className="shrink-0">
                                                        {OUTCOME_LABELS[b.status]}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-slate-500">
                                                    {b.returnedDate ? toDisplayDate(new Date(b.returnedDate)) : '—'}
                                                    {b.returnedTo ? ` · received by ${b.returnedTo.firstName} ${b.returnedTo.lastName}` : ''}
                                                    {b.condition ? ` · condition: ${b.condition}` : ''}
                                                    {b.recoveryAmount && Number(b.recoveryAmount) > 0 ? ` · recover ₹${Number(b.recoveryAmount).toLocaleString('en-IN')}` : ''}
                                                </p>
                                                {b.remarks && <p className="text-xs text-slate-600 dark:text-slate-400">{b.remarks}</p>}
                                                <BelongingProofList
                                                    proofs={b.proofs}
                                                    emptyText={b.status === 'LOST' ? 'No photo (lost item)' : 'No photo — returned before photos were required'}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {(detail.status === 'HR_APPROVED' || detail.status === 'COMPLETED' || detail.relievingLetterUrl) && (
                                <Button variant="outline" size="sm" onClick={handleDownloadLetter}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download Relieving Letter
                                </Button>
                            )}
                        </div>
                    )}
                    {detail && detail.status === 'IN_PROGRESS' && (
                        <DialogFooter className="items-stretch gap-2 border-t pt-4 sm:items-center">
                            {detail.approval?.canAct === false ? (
                                <p className="text-sm text-slate-500 sm:mr-auto">
                                    Waiting for {detail.approval.stageName}
                                    {detail.approval.totalStages > 1 && ` (level ${detail.approval.stageNumber} of ${detail.approval.totalStages})`}
                                </p>
                            ) : (
                                <>
                                <Button variant="outline" className="text-red-600" onClick={() => setIsRejectOpen(true)}>
                                    <XCircle className="h-4 w-4 mr-2" />
                                    Reject Exit
                                </Button>
                                <Button
                                    onClick={handleFinalApprove}
                                    disabled={!allCleared}
                                    className="h-auto min-h-9 whitespace-normal bg-primary text-center text-white"
                                    title={
                                        !allCleared
                                            ? (detail.outstandingBelongings?.length
                                                ? 'Blocked — belongings not yet returned'
                                                : 'Blocked — clearance items not yet cleared')
                                            : undefined
                                    }
                                >
                                    {detail.approval && detail.approval.stageNumber < detail.approval.totalStages
                                        ? `Approve — ${detail.approval.stageName}`
                                        : 'Final HR Approval — Issue NDC & Relieving Letter'}
                                </Button>
                                </>
                            )}
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Reject Exit Request</DialogTitle></DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label>Reason</Label>
                        <Input value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsRejectOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleRejectExit} disabled={!rejectRemarks.trim()}>Reject</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
