'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { TrendingUp, Plus, CheckCircle2, XCircle, Download } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { AwaitingApprovalStage, type RecordApproval } from '@/components/hr/AwaitingApprovalStage';
import { downloadBlobFile } from '@/app/lib/download-letter';
import { PromotionRequestWorkflow } from './PromotionRequestWorkflow';
import { toDisplayDate } from '@/app/lib/date-format';

export type Employee = {
    id: string;
    firstName: string;
    lastName: string;
    employeeId: string | null;
    role?: string;
    profilePhotoUrl?: string | null;
    /** ID-card photo storage key from GET /hr/employees (see app/lib/hr/employee-photo.ts). */
    photoKey?: string | null;
    branch?: { name: string } | null;
    designation?: { name: string } | null;
};
export type Designation = { id: string; name: string };

type Promotion = {
    id: string;
    effectiveDate: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    letterUrl: string | null;
    employee: { id: string; firstName: string; lastName: string; employeeId: string | null; branch: { name: string } | null };
    fromDesignation: { name: string } | null;
    toDesignation: { name: string };
    initiatedBy: { firstName: string; lastName: string } | null;
    reviewedBy: { firstName: string; lastName: string } | null;
    approval: RecordApproval | null;
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED') return 'destructive';
    return 'outline';
}

export function PromotionList() {
    const { toast } = useToast();
    const [rows, setRows] = useState<Promotion[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [rejectTarget, setRejectTarget] = useState<Promotion | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const [rowsRes, employeesRes, designationsRes] = await Promise.all([
                apiClient.get<Promotion[]>('/hr/promotions'),
                apiClient.get<Employee[]>('/hr/employees?status=active'),
                apiClient.get<Designation[]>('/hr/designations'),
            ]);
            if (rowsRes.success && rowsRes.data) setRows(rowsRes.data);
            if (employeesRes.success && employeesRes.data) setEmployees(employeesRes.data);
            if (designationsRes.success && designationsRes.data) setDesignations(designationsRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch promotions.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleApprove = async (row: Promotion) => {
        try {
            const res = await apiClient.post(`/hr/promotions/${row.id}/approve`);
            if (res.success) {
                toast({ title: 'Approved', description: res.message || 'Promotion approved and letter generated.' });
                await fetchAll();
            } else {
                throw new Error(res.error || 'Approval failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Approval failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleRejectConfirm = async () => {
        if (!rejectTarget || !rejectReason.trim()) return;
        try {
            const res = await apiClient.post(`/hr/promotions/${rejectTarget.id}/reject`, { reviewRemarks: rejectReason.trim() });
            if (res.success) {
                toast({ title: 'Rejected', description: 'Promotion rejected.' });
                setRejectTarget(null);
                setRejectReason('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Rejection failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Rejection failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleDownloadLetter = async (row: Promotion) => {
        try {
            const empCode = row.employee.employeeId || row.id;
            await downloadBlobFile(`/hr/promotions/${row.id}/letter`, `promotion-letter-${empCode}.pdf`);
            toast({ title: 'Success', description: 'Promotion letter downloaded.' });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Could not download promotion letter.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Promotions..." fullScreen={false} />;
    }

    if (isCreateOpen) {
        return (
            <PromotionRequestWorkflow
                employees={employees}
                designations={designations}
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
                            <TrendingUp className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Employee Promotion</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Initiation → Approval → Promotion Completed → Promotion Letter.
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => setIsCreateOpen(true)} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Initiate Promotion
                    </Button>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Employee</TableHead>
                                        <TableHead>From → To</TableHead>
                                        <TableHead>Effective Date</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="px-4 py-12 text-center text-slate-500">No promotion requests yet.</TableCell>
                                        </TableRow>
                                    ) : (
                                        rows.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="text-sm font-medium">
                                                    {row.employee.firstName} {row.employee.lastName}
                                                    <div className="text-xs text-slate-500">
                                                        {row.employee.employeeId ?? '—'}
                                                        {row.employee.branch?.name ? ` · ${row.employee.branch.name}` : ''}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">{row.fromDesignation?.name ?? '—'} → {row.toDesignation.name}</TableCell>
                                                <TableCell className="text-sm">{toDisplayDate(new Date(row.effectiveDate))}</TableCell>
                                                <TableCell>
                                                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                                                    {row.status === 'PENDING' && <AwaitingApprovalStage approval={row.approval} />}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center justify-center gap-1">
                                                        {row.status === 'PENDING' && row.approval?.canAct !== false && (
                                                            <>
                                                                <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleApprove(row)} title="Approve">
                                                                    <CheckCircle2 className="h-4 w-4" />
                                                                </Button>
                                                                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRejectTarget(row)} title="Reject">
                                                                    <XCircle className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                        {(row.status === 'APPROVED' || row.letterUrl) && (
                                                            <Button size="sm" variant="ghost" onClick={() => handleDownloadLetter(row)} title="Download Letter">
                                                                <Download className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Reject Promotion</DialogTitle></DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label>Reason</Label>
                        <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleRejectConfirm} disabled={!rejectReason.trim()}>Reject</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
