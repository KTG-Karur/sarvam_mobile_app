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
import { ArrowRightLeft, Plus, CheckCircle2, XCircle, Undo2, Eye, Download } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { downloadBlobFile } from '@/app/lib/download-letter';
import { TransferRequestWorkflow } from './TransferRequestWorkflow';
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
};
export type LookupOption = { id: string; name: string };

export type Position = { type: 'CENTER'; id: string; name: string; code: string; branchName: string } | { type: 'BRANCH'; id: string; name: string; isPrimary: boolean };
export type ReplacementCandidate = {
    id: string;
    employeeCode: string | null;
    fullName: string;
    email: string;
    profilePhotoUrl: string | null;
    currentAssignment: string;
    alreadyAtLocation: boolean;
};
export type ReplacementCandidates = { role: string; requiresReplacement: boolean; positions: Position[]; candidates: ReplacementCandidate[] };

type Transfer = {
    id: string;
    transferType: 'BRANCH' | 'AREA' | 'REGION' | 'DEPARTMENT';
    status: string;
    effectiveDate: string;
    employee: { id: string; firstName: string; lastName: string; employeeId: string | null };
    fromBranch: { name: string } | null;
    toBranch: { name: string } | null;
    fromDepartment: { name: string } | null;
    toDepartment: { name: string } | null;
    replacementEmployee: { id: string; firstName: string; lastName: string } | null;
};

type WorkflowStage = {
    stageId: string;
    stageName: string;
    stageOrder: number;
    approverRoleSlug: string;
    status: string;
    actedAt: string | null;
    remarks: string | null;
};

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
    if (status === 'APPROVED') return 'default';
    if (status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED') return 'destructive';
    return 'outline';
}

export function TransferList() {
    const { toast } = useToast();
    const [rows, setRows] = useState<Transfer[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [branches, setBranches] = useState<LookupOption[]>([]);
    const [areas, setAreas] = useState<LookupOption[]>([]);
    const [regions, setRegions] = useState<LookupOption[]>([]);
    const [departments, setDepartments] = useState<LookupOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const [detailTarget, setDetailTarget] = useState<Transfer | null>(null);
    const [detailWorkflow, setDetailWorkflow] = useState<WorkflowStage[] | null>(null);
    const [actionRemarks, setActionRemarks] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const [rowsRes, employeesRes, branchesRes, areasRes, regionsRes, departmentsRes] = await Promise.all([
                apiClient.get<Transfer[]>('/hr/transfers'),
                apiClient.get<Employee[]>('/hr/employees?status=active'),
                apiClient.get<LookupOption[]>('/branches'),
                apiClient.get<LookupOption[]>('/areas'),
                apiClient.get<LookupOption[]>('/regions'),
                apiClient.get<LookupOption[]>('/hr/departments'),
            ]);
            if (rowsRes.success && rowsRes.data) setRows(rowsRes.data);
            if (employeesRes.success && employeesRes.data) setEmployees(employeesRes.data);
            if (branchesRes.success && branchesRes.data) setBranches(branchesRes.data);
            if (areasRes.success && areasRes.data) setAreas(areasRes.data);
            if (regionsRes.success && regionsRes.data) setRegions(regionsRes.data);
            if (departmentsRes.success && departmentsRes.data) setDepartments(departmentsRes.data);
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch transfers.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const openDetail = async (row: Transfer) => {
        setDetailTarget(row);
        setDetailWorkflow(null);
        try {
            const res = await apiClient.get<{ transfer: Transfer; workflow: { stages: WorkflowStage[] } | null }>(`/hr/transfers/${row.id}`);
            if (res.success && res.data?.workflow) setDetailWorkflow(res.data.workflow.stages);
        } catch {
            // non-fatal — detail dialog still shows the record without a timeline
        }
    };

    const handleAction = async (action: 'approve' | 'reject' | 'send_back') => {
        if (!detailTarget) return;
        try {
            const res = await apiClient.post(`/hr/transfers/${detailTarget.id}/action`, { action, remarks: actionRemarks || undefined });
            if (res.success) {
                toast({ title: 'Done', description: `Transfer ${action.replace('_', ' ')} recorded.` });
                setDetailTarget(null);
                setActionRemarks('');
                await fetchAll();
            } else {
                throw new Error(res.error || 'Action failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Action failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    const handleDownloadLetter = async (row: Transfer) => {
        try {
            const empCode = row.employee.employeeId || row.id;
            await downloadBlobFile(`/hr/transfers/${row.id}/letter`, `transfer-letter-${empCode}.pdf`);
            toast({ title: 'Success', description: 'Transfer letter downloaded.' });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Could not download transfer letter.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        }
    };

    if (isLoading) {
        return <PageLoader label="Loading Transfers..." fullScreen={false} />;
    }

    if (isCreateOpen) {
        return (
            <TransferRequestWorkflow
                employees={employees}
                branches={branches}
                areas={areas}
                regions={regions}
                departments={departments}
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
                            <ArrowRightLeft className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Employee Transfer</h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Requested → Level 1 → Final Approval → Transfer Completed. Levels configurable by Admin.
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => setIsCreateOpen(true)} className="bg-primary text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Request Transfer
                    </Button>
                </div>

                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-green-50/50 dark:bg-brand-green-darker/50">
                                        <TableHead>Employee</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>From → To</TableHead>
                                        <TableHead>Effective Date</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-center">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="px-4 py-12 text-center text-slate-500">No transfer requests yet.</TableCell>
                                        </TableRow>
                                    ) : (
                                        rows.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="text-sm font-medium">
                                                    {row.employee.firstName} {row.employee.lastName}
                                                    <div className="text-xs text-slate-500">{row.employee.employeeId ?? '—'}</div>
                                                </TableCell>
                                                <TableCell className="text-sm">{row.transferType}</TableCell>
                                                <TableCell className="text-sm">
                                                    {row.transferType === 'DEPARTMENT'
                                                        ? `${row.fromDepartment?.name ?? '—'} → ${row.toDepartment?.name ?? '—'}`
                                                        : `${row.fromBranch?.name ?? '—'} → ${row.toBranch?.name ?? '—'}`}
                                                </TableCell>
                                                <TableCell className="text-sm">{toDisplayDate(new Date(row.effectiveDate))}</TableCell>
                                                <TableCell><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
                                                <TableCell className="text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button size="sm" variant="ghost" onClick={() => openDetail(row)} title="View">
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        {row.status === 'APPROVED' && (
                                                            <Button size="sm" variant="ghost" onClick={() => handleDownloadLetter(row)} title="Download Transfer Letter">
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

            <Dialog open={!!detailTarget} onOpenChange={(open) => !open && setDetailTarget(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Transfer Details</DialogTitle></DialogHeader>
                    {detailTarget && (
                        <div className="space-y-4 py-2">
                            <div className="text-sm">
                                <span className="font-semibold">{detailTarget.employee.firstName} {detailTarget.employee.lastName}</span>
                                {' — '}{detailTarget.transferType} transfer, status <Badge variant={statusVariant(detailTarget.status)}>{detailTarget.status}</Badge>
                            </div>
                            {detailTarget.replacementEmployee && (
                                <div className="text-xs text-slate-500">
                                    Replacement: {detailTarget.replacementEmployee.firstName} {detailTarget.replacementEmployee.lastName}
                                </div>
                            )}
                            {detailWorkflow && (
                                <div className="space-y-2">
                                    <Label>Approval Timeline</Label>
                                    <ul className="space-y-1">
                                        {detailWorkflow.map((stage) => (
                                            <li key={stage.stageId} className="text-xs flex items-center justify-between border-b pb-1">
                                                <span>{stage.stageOrder}. {stage.stageName} ({stage.approverRoleSlug})</span>
                                                <Badge variant={stage.status === 'APPROVED' ? 'default' : stage.status === 'REJECTED' ? 'destructive' : 'outline'}>
                                                    {stage.status}
                                                </Badge>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {(detailTarget.status === 'PENDING' || detailTarget.status === 'IN_PROGRESS') && (
                                <div className="space-y-2">
                                    <Label>Remarks (optional)</Label>
                                    <Input value={actionRemarks} onChange={(e) => setActionRemarks(e.target.value)} />
                                </div>
                            )}
                        </div>
                    )}
                    {detailTarget && (detailTarget.status === 'PENDING' || detailTarget.status === 'IN_PROGRESS') && (
                        <DialogFooter className="flex-wrap gap-2">
                            <Button variant="outline" onClick={() => handleAction('send_back')}>
                                <Undo2 className="h-4 w-4 mr-2" />
                                Send Back
                            </Button>
                            <Button variant="destructive" onClick={() => handleAction('reject')}>
                                <XCircle className="h-4 w-4 mr-2" />
                                Reject
                            </Button>
                            <Button onClick={() => handleAction('approve')} className="bg-primary text-white">
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Approve
                            </Button>
                        </DialogFooter>
                    )}
                    {detailTarget && detailTarget.status === 'APPROVED' && (
                        <DialogFooter>
                            <Button onClick={() => handleDownloadLetter(detailTarget)} className="bg-primary text-white">
                                <Download className="h-4 w-4 mr-2" />
                                Download Transfer Letter
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
