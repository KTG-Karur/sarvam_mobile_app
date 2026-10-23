'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmployeePhotoAvatar } from '@/components/hr/EmployeePhotoAvatar';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { LogOut, ArrowLeft, Search, X } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import type { Employee } from './ExitClearanceBoard';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

const EXIT_TYPES = [
    { value: 'VOLUNTARY_RESIGNATION', label: 'Voluntary Resignation' },
    { value: 'ABSCONDING', label: 'Absconding' },
    { value: 'ASK_TO_GO', label: 'Ask to Go' },
    { value: 'APPOINTMENT_CANCELLATION', label: 'Appointment Cancellation' },
    { value: 'TERMINATION', label: 'Termination' },
    { value: 'DECEASED', label: 'Deceased' },
    { value: 'RETIREMENT', label: 'Retirement' },
];

type ExitRequestWorkflowProps = {
    employees: Employee[];
    onCancel: () => void;
    onSubmitted: () => void;
};

function SectionHeading({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground dark:text-white">{title}</h2>
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

export function ExitRequestWorkflow({ employees, onCancel, onSubmitted }: ExitRequestWorkflowProps) {
    const { toast } = useToast();

    const [employeeId, setEmployeeId] = useState('');
    const [employeeSearch, setEmployeeSearch] = useState('');
    const [exitType, setExitType] = useState('');
    const [requestedDate, setRequestedDate] = useState('');
    const [lastWorkingDate, setLastWorkingDate] = useState('');
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const selectedEmployee = useMemo(() => employees.find((e) => e.id === employeeId) ?? null, [employees, employeeId]);

    const filteredEmployees = useMemo(() => {
        const term = employeeSearch.trim().toLowerCase();
        if (!term) return employees;
        return employees.filter((e) =>
            `${e.firstName} ${e.lastName}`.toLowerCase().includes(term) ||
            (e.employeeId ?? '').toLowerCase().includes(term)
        );
    }, [employees, employeeSearch]);

    const exitTypeLabel = EXIT_TYPES.find((t) => t.value === exitType)?.label ?? null;
    const canSubmit = !!employeeId && !!exitType && !!requestedDate && !!lastWorkingDate;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setIsSubmitting(true);
        try {
            const res = await apiClient.post('/hr/exit-requests', {
                employeeId, exitType, requestedDate, lastWorkingDate, reason: reason || null,
            });
            if (res.success) {
                toast({ title: 'Created', description: 'Exit request created with clearance checklist.' });
                onSubmitted();
            } else {
                throw new Error(res.error || 'Creation failed');
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Creation failed.';
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
                            <LogOut className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-foreground dark:text-white">Initiate Exit</h1>
                            <p className="text-xs text-sidebar-accent dark:text-slate-400">Start the parallel department clearance and final HR approval flow.</p>
                        </div>
                    </div>
                </div>

                {/* Employee Selection — full width */}
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
                                                    <p className="truncate text-xs text-slate-500">
                                                        {e.employeeId ?? 'N/A'}{e.designation?.name ? ` · ${e.designation.name}` : ''}
                                                    </p>
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
                                        <p className="truncate text-xs text-slate-500">ID: {selectedEmployee.employeeId ?? 'N/A'} · {selectedEmployee.designation?.name ?? '—'}</p>
                                    </div>
                                </div>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEmployeeId(''); setEmployeeSearch(''); }}>
                                    <X className="mr-1 h-3 w-3" /> Change
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Current Position + Exit Details, side by side on desktop */}
                {selectedEmployee && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card className="shadow-sm">
                            <CardContent className="space-y-2 p-4">
                                <SectionHeading title="Current Position" />
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <InfoRow label="Designation" value={selectedEmployee.designation?.name ?? '—'} />
                                    <InfoRow label="Branch" value={selectedEmployee.branch?.name ?? '—'} />
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="shadow-sm">
                            <CardContent className="space-y-3 p-4">
                                <SectionHeading title="Exit Details" />
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Exit Type</Label>
                                        <Select value={exitType} onValueChange={setExitType}>
                                            <SelectTrigger className="h-9"><SelectValue placeholder="Select exit type" /></SelectTrigger>
                                            <SelectContent>
                                                {EXIT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Requested Date</Label>
                                        <DateInput className="h-9" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Last Working Date</Label>
                                        <DateInput className="h-9" value={lastWorkingDate} onChange={(e) => setLastWorkingDate(e.target.value)} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Reason (optional)</Label>
                                        <Input className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Exit Summary */}
                {selectedEmployee && (
                    <Card className="border-primary/30 bg-primary/5 shadow-sm">
                        <CardContent className="space-y-2 p-4">
                            <SectionHeading title="Exit Summary" />
                            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                <InfoRow label="Employee" value={`${selectedEmployee.firstName} ${selectedEmployee.lastName} (${selectedEmployee.employeeId ?? 'N/A'})`} />
                                <InfoRow label="Exit Type" value={exitTypeLabel ?? 'Not selected yet'} />
                                <InfoRow label="Requested Date" value={requestedDate ? toDisplayDate(new Date(requestedDate)) : 'Not set'} />
                                <InfoRow label="Last Working Date" value={lastWorkingDate ? toDisplayDate(new Date(lastWorkingDate)) : 'Not set'} />
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 border-t border-primary/20 pt-4 pb-4 dark:border-sidebar-accent">
                    <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="bg-primary text-white">
                        {isSubmitting ? 'Submitting…' : 'Submit Exit Request'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
