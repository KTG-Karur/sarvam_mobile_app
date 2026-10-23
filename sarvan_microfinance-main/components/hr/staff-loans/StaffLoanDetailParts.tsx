'use client';

import { Fragment, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EmployeeProfileDetail, PastLoanRow, ScheduleRow } from '@/app/lib/staff-loans/application';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

export const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(val);
};

export const formatDateTime = (dateStr: string) => {
    try {
        return toDisplayDateTime(new Date(dateStr));
    } catch {
        return dateStr;
    }
};

export const formatDay = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    try {
        return toDisplayDate(new Date(dateStr));
    } catch {
        return dateStr;
    }
};

const LOAN_STATUS_LABEL: Record<string, string> = {
    SUBMITTED: 'Under Review', RETURNED: 'Returned', APPROVED: 'Approved', REJECTED: 'Rejected', ACTIVE: 'Active', CLOSED: 'Closed',
};

export function LoanStatusBadge({ status }: { status: string }) {
    const label = LOAN_STATUS_LABEL[status] ?? status;
    if (status === 'ACTIVE' || status === 'APPROVED') return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">{label}</Badge>;
    if (status === 'REJECTED') return <Badge variant="destructive">{label}</Badge>;
    if (status === 'SUBMITTED') return <Badge className="bg-blue-600 hover:bg-blue-700 text-white">{label}</Badge>;
    return <Badge variant="outline">{label}</Badge>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-muted-foreground">{label}</div>
            <div className="font-semibold text-foreground break-words">{children}</div>
        </div>
    );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

/** Employee/member details shown to the approver — reused by the view and review modals. */
export function EmployeePanel({ employee }: { employee: EmployeeProfileDetail }) {
    return (
        <div className="space-y-3">
            <SectionTitle>Employee Details</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/40 p-4 rounded-lg">
                <Field label="Employee Name">{employee.name}</Field>
                <Field label="Employee ID">{employee.employeeId ?? '—'}</Field>
                <Field label="Joining Date">{formatDay(employee.dateOfJoining)}</Field>
                <Field label="Experience in Company">{employee.experience}</Field>
                <Field label="Department">{employee.department ?? '—'}</Field>
                <Field label="Designation">{employee.designation}</Field>
                <Field label="Branch">{employee.branch ?? '—'}</Field>
                <Field label="Employment Status">
                    <Badge variant={employee.employmentStatus === 'Active' ? 'default' : 'secondary'}>{employee.employmentStatus}</Badge>
                </Field>
                <Field label="Current Salary (Gross)">{formatCurrency(employee.grossSalary)}</Field>
                <Field label="Monthly CTC">{employee.monthlyCtc === null ? '—' : formatCurrency(employee.monthlyCtc)}</Field>
                <Field label="Confirmation Date">{formatDay(employee.confirmationDate)}</Field>
            </div>
            {employee.salaryComponents.length > 0 && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                    {employee.salaryComponents.map(component => (
                        <span key={component.name} className="rounded-md border bg-muted/30 px-2 py-1">
                            <span className="text-muted-foreground">{component.name}{component.type === 'DEDUCTIONS' ? ' (deduction)' : ''}: </span>
                            <span className="font-medium text-foreground">{formatCurrency(component.amount)}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export function PastLoansTable({ loans }: { loans: PastLoanRow[] }) {
    // Each past loan opens its own repayment track; tracks are never merged into one.
    const [openTracks, setOpenTracks] = useState<Set<string>>(new Set());
    const toggleTrack = (id: string) => setOpenTracks(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    return (
        <div className="space-y-2">
            <SectionTitle>Past Loans</SectionTitle>
            {loans.length === 0 ? (
                <p className="text-xs text-muted-foreground">No previous staff loans for this employee.</p>
            ) : (
                <div className="border rounded-md overflow-x-auto text-xs">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40">
                                <TableHead>Loan No.</TableHead>
                                <TableHead>Loan Date</TableHead>
                                <TableHead className="text-right">Loan Amount</TableHead>
                                <TableHead className="text-right">Interest</TableHead>
                                <TableHead className="text-right">Total Payable</TableHead>
                                <TableHead className="text-center">Tenure</TableHead>
                                <TableHead className="text-right">Paid</TableHead>
                                <TableHead className="text-right">Outstanding</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Closed On</TableHead>
                                <TableHead className="text-right">Repayment Track</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loans.map(loan => {
                                const open = openTracks.has(loan.id);
                                return (
                                <Fragment key={loan.id}>
                                <TableRow>
                                    <TableCell className="font-mono font-medium">{loan.loanNumber}</TableCell>
                                    <TableCell>{formatDay(loan.loanDate)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(loan.loanAmount)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(loan.interestAmount)}</TableCell>
                                    <TableCell className="text-right font-medium">{formatCurrency(loan.totalPayable)}</TableCell>
                                    <TableCell className="text-center">{loan.tenureMonths} mo</TableCell>
                                    <TableCell className="text-right">{loan.paidAmount === null ? '—' : formatCurrency(loan.paidAmount)}</TableCell>
                                    <TableCell className="text-right">{loan.outstandingAmount === null ? '—' : formatCurrency(loan.outstandingAmount)}</TableCell>
                                    <TableCell><LoanStatusBadge status={loan.status} /></TableCell>
                                    <TableCell>{formatDay(loan.closedAt)}</TableCell>
                                    <TableCell className="text-right">
                                        {loan.schedules ? (
                                            <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" aria-expanded={open} onClick={() => toggleTrack(loan.id)}>
                                                <ListOrdered className="h-3 w-3" /> {open ? 'Hide' : 'View'}
                                            </Button>
                                        ) : <span className="text-muted-foreground" title="The repayment schedule is created when the loan is disbursed">—</span>}
                                    </TableCell>
                                </TableRow>
                                {open && loan.schedules && (
                                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                                        <TableCell colSpan={11} className="space-y-2 p-3">
                                            <div className="text-xs font-semibold">Repayment Track — {loan.loanNumber}</div>
                                            <RepaymentTrackTable schedules={loan.schedules} />
                                        </TableCell>
                                    </TableRow>
                                )}
                                </Fragment>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

const SCHEDULE_STATUS: Record<ScheduleRow['status'], { label: string; className: string }> = {
    PAID: { label: 'Paid', className: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    PARTIAL: { label: 'Partial', className: 'bg-amber-500 hover:bg-amber-600 text-white' },
    PENDING: { label: 'Pending', className: 'bg-muted text-foreground hover:bg-muted' },
    OVERDUE: { label: 'Overdue', className: 'bg-destructive hover:bg-destructive/90 text-white' },
};

export function RepaymentTrackTable({ schedules }: { schedules: ScheduleRow[] }) {
    return (
        <div className="border rounded-md overflow-x-auto text-xs">
            <Table>
                <TableHeader>
                    <TableRow className="bg-muted/40">
                        <TableHead>#</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                        <TableHead className="text-right">Interest</TableHead>
                        <TableHead className="text-right">Total Due</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead>Payment Date</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {schedules.map(row => (
                        <TableRow key={row.id}>
                            <TableCell className="font-medium">{row.installmentNo}</TableCell>
                            <TableCell>{formatDay(row.dueDate)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.principalDue)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.interestDue)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(row.totalDue)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.totalPaid)}</TableCell>
                            <TableCell>{formatDay(row.paymentDate)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(row.totalOutstanding)}</TableCell>
                            <TableCell><Badge className={SCHEDULE_STATUS[row.status].className}>{SCHEDULE_STATUS[row.status].label}</Badge></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
