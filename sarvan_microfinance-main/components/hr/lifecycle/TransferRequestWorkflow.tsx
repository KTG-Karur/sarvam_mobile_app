'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmployeePhotoAvatar } from '@/components/hr/EmployeePhotoAvatar';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ArrowRightLeft, ArrowLeft, Search, X, Building2, MapPin } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import type { Employee, LookupOption, ReplacementCandidates } from './TransferList';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type TransferType = 'BRANCH' | 'AREA' | 'REGION' | 'DEPARTMENT';

type TransferRequestWorkflowProps = {
    employees: Employee[];
    branches: LookupOption[];
    areas: LookupOption[];
    regions: LookupOption[];
    departments: LookupOption[];
    onCancel: () => void;
    onSubmitted: () => void;
};

function SectionHeading({ title, required }: { title: string; required?: boolean }) {
    return (
        <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground dark:text-white">{title}</h2>
            {required && <Badge variant="outline" className="text-[10px]">Required</Badge>}
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-sm font-medium">{value}</p>
        </div>
    );
}

export function TransferRequestWorkflow({ employees, branches, areas, regions, departments, onCancel, onSubmitted }: TransferRequestWorkflowProps) {
    const { toast } = useToast();

    const [employeeId, setEmployeeId] = useState('');
    const [employeeSearch, setEmployeeSearch] = useState('');
    const [transferType, setTransferType] = useState<TransferType>('BRANCH');
    const [toBranchId, setToBranchId] = useState('');
    const [toAreaId, setToAreaId] = useState('');
    const [toRegionId, setToRegionId] = useState('');
    const [toDepartmentId, setToDepartmentId] = useState('');
    const [effectiveDate, setEffectiveDate] = useState('');
    const [reason, setReason] = useState('');
    const [replacementEmployeeId, setReplacementEmployeeId] = useState('');
    const [replacementInfo, setReplacementInfo] = useState<ReplacementCandidates | null>(null);
    const [isLoadingReplacement, setIsLoadingReplacement] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!employeeId) {
            setReplacementInfo(null);
            setReplacementEmployeeId('');
            return;
        }
        let cancelled = false;
        setIsLoadingReplacement(true);
        apiClient.get<ReplacementCandidates>(`/hr/transfers/replacement-candidates?employeeId=${employeeId}`)
            .then((res) => {
                if (cancelled) return;
                setReplacementInfo(res.success && res.data ? res.data : null);
                setReplacementEmployeeId('');
            })
            .catch(() => {
                if (!cancelled) setReplacementInfo(null);
            })
            .finally(() => {
                if (!cancelled) setIsLoadingReplacement(false);
            });
        return () => { cancelled = true; };
    }, [employeeId]);

    const selectedEmployee = useMemo(() => employees.find((e) => e.id === employeeId) ?? null, [employees, employeeId]);

    const filteredEmployees = useMemo(() => {
        const term = employeeSearch.trim().toLowerCase();
        if (!term) return employees;
        return employees.filter((e) =>
            `${e.firstName} ${e.lastName}`.toLowerCase().includes(term) ||
            (e.employeeId ?? '').toLowerCase().includes(term)
        );
    }, [employees, employeeSearch]);

    const newAssignmentLabel = transferType === 'DEPARTMENT'
        ? departments.find((d) => d.id === toDepartmentId)?.name ?? null
        : branches.find((b) => b.id === toBranchId)?.name ?? null;

    const requiresReplacement = !!replacementInfo?.requiresReplacement;
    const selectedReplacement = replacementInfo?.candidates.find((c) => c.id === replacementEmployeeId) ?? null;
    const canSubmit = !!employeeId && !!effectiveDate && !!newAssignmentLabel && (!requiresReplacement || !!replacementEmployeeId);

    const handleSubmit = async () => {
        if (requiresReplacement && !replacementEmployeeId) {
            toast({ title: 'Replacement required', description: 'Choose a replacement employee for this position before submitting.', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await apiClient.post('/hr/transfers', {
                employeeId,
                transferType,
                toBranchId: transferType !== 'DEPARTMENT' ? toBranchId : undefined,
                toAreaId: transferType === 'AREA' ? toAreaId : undefined,
                toRegionId: transferType === 'REGION' ? toRegionId : undefined,
                toDepartmentId: transferType === 'DEPARTMENT' ? toDepartmentId : undefined,
                effectiveDate,
                reason: reason || null,
                replacementEmployeeId: requiresReplacement ? replacementEmployeeId : undefined,
            });
            if (res.success) {
                toast({ title: 'Submitted', description: 'Transfer request submitted for approval.' });
                onSubmitted();
            } else {
                throw new Error(res.error || 'Submission failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Submission failed.';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="relative">
            <div className="mx-auto w-full max-w-[1150px] space-y-4">
                <div className="mb-1 mt-3 flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1">
                        <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-md shadow-primary/30">
                            <ArrowRightLeft className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-foreground dark:text-white">Request Transfer</h1>
                            <p className="text-xs text-sidebar-accent dark:text-slate-400">Move an employee to a new branch, area, region, or department.</p>
                        </div>
                    </div>
                </div>

                {/* 1. Employee Selection — full width */}
                <Card className="border-primary/20 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="space-y-2 p-4">
                        <SectionHeading title="Employee Selection" />
                        {!selectedEmployee ? (
                            <>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        className="h-9 pl-9"
                                        placeholder="Search by name or employee ID"
                                        value={employeeSearch}
                                        onChange={(e) => setEmployeeSearch(e.target.value)}
                                    />
                                </div>
                                <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {filteredEmployees.length === 0 ? (
                                        <p className="col-span-full py-6 text-center text-sm text-slate-500">No employees found</p>
                                    ) : (
                                        filteredEmployees.map((e) => (
                                            <button
                                                key={e.id}
                                                type="button"
                                                onClick={() => setEmployeeId(e.id)}
                                                className="flex items-center gap-2 rounded-md border border-transparent p-2 text-left transition hover:border-primary/40 hover:bg-primary/5"
                                            >
                                                <EmployeePhotoAvatar photoKey={e.photoKey} name={`${e.firstName} ${e.lastName}`} className="h-9 w-9" />
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">{e.firstName} {e.lastName}</p>
                                                    <p className="truncate text-xs text-slate-500">{e.employeeId ?? 'N/A'} · {e.role ?? '—'}</p>
                                                </div>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2">
                                <div className="flex items-center gap-3">
                                    <EmployeePhotoAvatar photoKey={selectedEmployee.photoKey} name={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`} className="h-11 w-11" />
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">{selectedEmployee.firstName} {selectedEmployee.lastName}</p>
                                        <p className="truncate text-xs text-slate-500">ID: {selectedEmployee.employeeId ?? 'N/A'} · {selectedEmployee.role ?? '—'}</p>
                                    </div>
                                </div>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEmployeeId(''); setEmployeeSearch(''); }}>
                                    <X className="mr-1 h-3 w-3" /> Change
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* 2 & 3: Current Position + Transfer Details, side by side on desktop */}
                {selectedEmployee && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card className="shadow-sm">
                            <CardContent className="space-y-2 p-4">
                                <SectionHeading title="Current Position" />
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <InfoRow label="Role" value={selectedEmployee.role ?? '—'} />
                                    <InfoRow label="Current Branch" value={selectedEmployee.branch?.name ?? '—'} />
                                </div>
                                {isLoadingReplacement && <p className="text-xs text-slate-500">Checking assigned centers/branches…</p>}
                                {replacementInfo && replacementInfo.positions.length > 0 && (
                                    <div className="space-y-1 rounded-md border border-dashed p-2">
                                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                            Assigned {replacementInfo.positions[0].type === 'CENTER' ? 'Centers' : 'Branches'}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {replacementInfo.positions.map((p) => (
                                                <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                    {p.type === 'CENTER' ? <MapPin className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                                                    {p.type === 'CENTER' ? `${p.name} (${p.code})` : `${p.name}${p.isPrimary ? ' · Primary' : ''}`}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="shadow-sm">
                            <CardContent className="space-y-3 p-4">
                                <SectionHeading title="Transfer Details" />
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Transfer Type</Label>
                                        <Select value={transferType} onValueChange={(v) => setTransferType(v as TransferType)}>
                                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="BRANCH">Branch</SelectItem>
                                                <SelectItem value="AREA">Area</SelectItem>
                                                <SelectItem value="REGION">Region</SelectItem>
                                                <SelectItem value="DEPARTMENT">Department</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Effective Date</Label>
                                        <DateInput className="h-9" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                                    </div>
                                    {transferType === 'DEPARTMENT' ? (
                                        <div className="space-y-1">
                                            <Label className="text-xs">New Department</Label>
                                            <Select value={toDepartmentId} onValueChange={setToDepartmentId}>
                                                <SelectTrigger className="h-9"><SelectValue placeholder="Select department" /></SelectTrigger>
                                                <SelectContent>
                                                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : (
                                        <>
                                            {transferType === 'AREA' && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs">New Area</Label>
                                                    <Select value={toAreaId} onValueChange={setToAreaId}>
                                                        <SelectTrigger className="h-9"><SelectValue placeholder="Select area" /></SelectTrigger>
                                                        <SelectContent>
                                                            {areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                            {transferType === 'REGION' && (
                                                <div className="space-y-1">
                                                    <Label className="text-xs">New Region</Label>
                                                    <Select value={toRegionId} onValueChange={setToRegionId}>
                                                        <SelectTrigger className="h-9"><SelectValue placeholder="Select region" /></SelectTrigger>
                                                        <SelectContent>
                                                            {regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                            <div className="space-y-1">
                                                <Label className="text-xs">New Branch / Center</Label>
                                                <Select value={toBranchId} onValueChange={setToBranchId}>
                                                    <SelectTrigger className="h-9"><SelectValue placeholder="Select branch" /></SelectTrigger>
                                                    <SelectContent>
                                                        {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </>
                                    )}
                                    <div className="space-y-1">
                                        <Label className="text-xs">Notes / Reason (optional)</Label>
                                        <Input className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* 4. Replacement Employee — only when this role requires one */}
                {selectedEmployee && requiresReplacement && (
                    <Card className="shadow-sm">
                        <CardContent className="space-y-2 p-4">
                            <SectionHeading title="Replacement Employee" required />
                            <Select value={replacementEmployeeId} onValueChange={setReplacementEmployeeId}>
                                <SelectTrigger className="h-9"><SelectValue placeholder="Select replacement employee" /></SelectTrigger>
                                <SelectContent>
                                    {!replacementInfo || replacementInfo.candidates.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-slate-500">No eligible replacement found</div>
                                    ) : (
                                        replacementInfo.candidates.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                <div className="flex w-full items-center justify-between gap-2">
                                                    <span className="truncate">{c.fullName} · {c.employeeCode ?? 'N/A'} · {replacementInfo.role}</span>
                                                    {c.alreadyAtLocation ? (
                                                        <Badge variant="secondary" className="border-amber-200 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                                            Already Assigned
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary" className="border-green-200 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                                                            Available
                                                        </Badge>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                            {selectedReplacement && (
                                <p className="text-xs text-slate-500">Current assignment: {selectedReplacement.currentAssignment}</p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Transfer Summary */}
                {selectedEmployee && (
                    <Card className="border-primary/30 bg-primary/5 shadow-sm">
                        <CardContent className="space-y-2 p-4">
                            <SectionHeading title="Transfer Summary" />
                            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                <InfoRow label="Employee" value={`${selectedEmployee.firstName} ${selectedEmployee.lastName} (${selectedEmployee.employeeId ?? 'N/A'})`} />
                                <InfoRow label="Assignment" value={`${selectedEmployee.branch?.name ?? '—'}  →  ${newAssignmentLabel ?? 'Not selected yet'}`} />
                                <InfoRow
                                    label="Replacement Employee"
                                    value={requiresReplacement ? (selectedReplacement?.fullName ?? 'Not selected yet') : 'Not required for this role'}
                                />
                                <InfoRow label="Effective Date" value={effectiveDate ? toDisplayDate(new Date(effectiveDate)) : 'Not set'} />
                            </div>
                            {replacementInfo && replacementInfo.positions.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                        Assignments that will be handed over{selectedReplacement ? ` to ${selectedReplacement.fullName}` : ''}:
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {replacementInfo.positions.map((p) => (
                                            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                {p.type === 'CENTER' ? `${p.name} (${p.code})` : p.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 border-t border-primary/20 pt-4 pb-4 dark:border-sidebar-accent">
                    <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="bg-primary text-white">
                        {isSubmitting ? 'Submitting…' : 'Submit Transfer'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
