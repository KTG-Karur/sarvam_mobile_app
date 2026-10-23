/**
 * Staff Loan / Staff Advance Schedule reports work like the MFI Client Loan Schedule report: a list of loans (or
 * advances) first, then "View Schedule" opens the repayment schedule of the chosen one. Types only, so the browser
 * can import them without pulling in Prisma.
 */
export type ScheduleKind = 'LOAN' | 'ADVANCE';

export type ScheduleListItem = {
    id: string;
    number: string;
    employeeCode: string;
    employeeName: string;
    department: string;
    designation: string;
    branch: string;
    amount: number;
    installments: number;
    /** Loan: ACTIVE / CLOSED. Advance: ACTIVE / COMPLETED. */
    status: string;
    totalOutstanding: number;
};

export type ScheduleList = {
    items: ScheduleListItem[];
    summary: { label: string; value: number; money: boolean }[];
};

export type ScheduleRowView = {
    installmentNo: number;
    /** e.g. "Sep 2026"; the exact due date stays in the database. */
    month: string;
    principal: number;
    /** Always 0 for a Staff Advance, which carries no interest (the column is not shown). */
    interest: number;
    totalDue: number;
    paid: number;
    outstanding: number;
    status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE' | 'SETTLED';
};

export type ScheduleDetail = {
    kind: ScheduleKind;
    id: string;
    number: string;
    status: string;
    employee: { code: string; name: string; department: string; designation: string; branch: string };
    amount: number;
    /** Staff Loan only, e.g. "Flat 12% p.a."; null for a Staff Advance. */
    interestLabel: string | null;
    tenureMonths: number;
    schedule: ScheduleRowView[];
};
