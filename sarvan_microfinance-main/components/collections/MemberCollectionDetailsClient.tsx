'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Loader2,
    Search,
    Eye,
    EyeOff,
    History,
    User,
    IndianRupee,
    Download,
    Skull,
    Upload,
    X,
    CheckCircle2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { StorageLink } from '@/components/storage/StorageMedia';
import { useToast } from '@/hooks/use-toast';
import { compressImageForCategory } from '@/app/lib/image-compress';
import { buildReportSheet, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoanProductType {
    id: string;
    name: string;
}

interface DeathMarkingInfo {
    deceasedPersonType:  string;
    deceasedPersonName:  string;
    deathDate:           string;
    placeOfDeath:        string;
    deathReason:         string;
    demandRequired:      boolean;
    deathCertificateUrl:  string | null;
    deathCertificateName: string | null;
}

interface LoanRow {
    id: string;
    loanNumber: string;
    loanIndex: string | null;
    amount: number;
    outstandingBalance: number;
    dueInterest: number;
    loanStatus: string;
    disbursementStatus: string;
    isClosed: boolean;
    ldDate: string | null;
    startDate: string | null;
    endDate: string | null;
    productTypeName: string | null;
    productName: string | null;
    frequency: string | null;
    isDead: boolean;
    deathMarking: DeathMarkingInfo | null;
}

interface ClientResult {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    phone: string | null;
    mobileNumber: string | null;
    otherIdNo: string | null;
    loanAdvance: number;
    centerId: string | null;
    centerName: string;
    branchName: string;
    groupName: string | null;
    loans: LoanRow[];
}

interface SearchResponse {
    clients: ClientResult[];
}

interface ScheduleApiLoanDetails {
    loanNumber: string;
    clientName: string;
    clientId: string;
    clientPhone: string;
    clientPhotoUrl: string | null;
    centerName: string;
    groupName: string;
    branchName: string;
    productName: string;
    disbursedDate: string;
    amount: number;
    interestRate: number;
    tenure: number;
    frequency: string;
}

interface ScheduleRow {
    installmentNo: number;
    dueDate: string;
    status: string;
    principal: string;
    interest: string;
    totalDue: string;
    collectedAmount: string;
    collectedPrincipal: string;
    collectedInterest: string;
    balance: string;
    paidOn: string | null;
}

interface ScheduleApiSummary {
    currentDueNo: number | null;
    dueInterest: number;
    outstandingBalance: number;
    arrearPrincipal: number;
    arrearInterest: number;
    collectedPrincipal: number;
    collectedInterest: number;
    totalInterest: number;
}

interface ScheduleApiResponse {
    loanDetails: ScheduleApiLoanDetails;
    schedule: ScheduleRow[];
    summary: ScheduleApiSummary;
}

type PassbookInstallment = {
    no: number;
    date: string;
    principal: string;
    interest: string;
    balance: string;
};

type PassbookData = {
    memberDetails: {
        loanAmount: number;
        accountNumber: string;
        branchCode: string;
        branchName: string;
        memberName: string;
        disbursementDate: string;
        loanPurpose: string;
        centerCode: string;
        centerName: string;
        centerMemberNo: string;
        husbandName: string;
        loanType: string;
        firstInstallmentDate: string;
        memberPhone: string;
        upiNumber: string;
    };
    installments: PassbookInstallment[];
};

interface DeathForm {
    deceasedPersonType: 'MEMBER' | 'CO_APPLICANT' | '';
    deceasedPersonName: string;
    deathReason: string;
    deathDate: string;
    placeOfDeath: string;
    demandRequired: boolean;
    certificateFile: File | null;
    certificateUrl: string;
    certificateName: string;
    certificateCompressionNote: string;
}

interface RepaymentHistoryRow {
    installmentNo: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    dueAmount: number;
    transactionDate: string | null;
    amountPaid: number;
    breakdown: { principal: number; interest: number; fees: number; penalty: number };
    loanBalance: number;
    arrearPrincipal: number;
    arrearInterest: number;
    arrearTotal: number;
    arrearReceivedPrincipal: number;
    arrearReceivedInterest: number;
    arrearReceivedTotal: number;
    transactionStatus: string | null;
    approvedByName: string | null;
    collectedByName: string | null;
    loanAdvanceAmount: number | null;
    loanAdvancePayAmount: number | null;
    loanAdvanceBalance: number;
}

interface RepaymentHistoryData {
    rows: RepaymentHistoryRow[];
    groupOfficerName: string | null;
    funderName: string | null;
    loanAdvanceBalance: number;
}

interface PaymentHistoryRow {
    transactionDbId: string;
    dueNo: number | null;
    dueDate: string | null;
    transactionDate: string;
    transactionType: string;
    status: string;
    paymentAmount: number;
    principal: number;
    interest: number;
    advanceAmount: number | null;
    loanBalance: number;
    collectedByName: string | null;
}

interface PaymentHistoryData {
    loanDetails: {
        loanNumber: string;
        clientName: string;
        amount: number;
        frequency: string | null;
    };
    rows: PaymentHistoryRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
    const colorMap: Record<string, string> = {
        Active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        Completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        Preclosed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
        Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
        Rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    return (
        <Badge
            className={`text-xs font-semibold border-0 ${colorMap[status] ?? 'bg-slate-100 text-slate-700'}`}
        >
            {status}
        </Badge>
    );
}

function TransactionStatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        PENDING:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };
    const label: Record<string, string> = {
        PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected',
    };
    return (
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${map[status] ?? map.PENDING}`}>
            {label[status] ?? status}
        </span>
    );
}

function fmt(n: number | string) {
    const val = typeof n === 'string' ? parseFloat(n) : n;
    return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null | undefined) {
    if (!iso) return '—';
    try {
        return toDisplayDate(new Date(iso));
    } catch {
        return iso;
    }
}

function dash(v: string | number | null | undefined) {
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
}

// IST-anchored formatter for business timestamps (Payment History modal + Excel export) —
// unlike fmtDateTime below (browser-local), this always reads Asia/Kolkata wall-clock time.
const istDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
});

function fmtDateTimeIst(iso: string | null | undefined) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        const parts = istDateTimeFormatter.formatToParts(d);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
        const dayPeriod = get('dayPeriod').toUpperCase();
        return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')} ${dayPeriod}`;
    } catch {
        return iso;
    }
}

function fmtDateIst(iso: string | null | undefined) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).format(d);
    } catch {
        return iso;
    }
}

function fmtDateTime(iso: string | null | undefined) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const hh = d.getHours();
        const min = String(d.getMinutes()).padStart(2, '0');
        const ampm = hh >= 12 ? 'PM' : 'AM';
        const h12 = hh % 12 || 12;
        return `${dd}/${mm}/${yyyy} ${String(h12).padStart(2, '0')}:${min} ${ampm}`;
    } catch {
        return iso;
    }
}

// ─── Loan Detail Panel ────────────────────────────────────────────────────────

function LoanDetailPanel({
    loan,
    client,
    detail,
    loading,
    repHistory,
    repHistoryLoading,
    onPassbookDownload,
    isPassbookDownloading,
    showMarkDeath,
    onMarkDeath,
}: {
    loan: LoanRow;
    client: ClientResult;
    detail: ScheduleApiResponse | null;
    loading: boolean;
    repHistory: RepaymentHistoryData | null;
    repHistoryLoading: boolean;
    onPassbookDownload: () => void;
    isPassbookDownloading: boolean;
    showMarkDeath: boolean;
    onMarkDeath: () => void;
}) {
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();

    if (loading) {
        return <PageLoader label="Loading details..." fullScreen={false} />;
    }

    const schedule = detail?.schedule ?? [];
    const ld = detail?.loanDetails ?? null;
    const summary = detail?.summary ?? null;
    const repRows = repHistory?.rows ?? [];
    const groupOfficerName = repHistory?.groupOfficerName ?? null;
    const funderName = repHistory?.funderName ?? null;

    const leftCol: [string, string][] = [
        ['Member Name', dash(client.fullName)],
        ['Phone Number', dash(client.mobileNumber ?? client.phone)],
        ['Branch Name', dash(client.branchName)],
        ['Group Name', dash(client.groupName)],
        ['Total No. of Due', String(schedule.length || repRows.length)],
        ['Loan Index #', dash(loan.loanIndex ?? loan.loanNumber)],
        ['Current Due', summary?.currentDueNo != null ? String(summary.currentDueNo) : '—'],
    ];

    const rightCol: [string, string | null][] = [
        ['Member Unique ID', client.clientId],
        ['Aadhaar Number', client.otherIdNo],
        ['Center Name', client.centerName],
        ['Product Type', loan.productTypeName],
        ['Product Name', loan.productName],
        ['Disbursement Date', loan.ldDate],
        ['Start Date', loan.startDate],
        ['End Date', loan.endDate],
        ...(loanAdvanceEnabled ? ([['Loan Advance', `₹${fmt(client.loanAdvance ?? 0)}`]] as [string, string | null][]) : []),
        ['Funder', funderName],
    ];

    const summaryCards: [string, string][] = [
        ['Principal Amount',    `₹${fmt(loan.amount)}`],
        ['Interest Amount',     summary ? `₹${fmt(summary.totalInterest)}` : '—'],
        ['Outstanding Balance', summary ? `₹${fmt(summary.outstandingBalance)}` : '—'],
        ['Due Interest',        summary ? `₹${fmt(summary.dueInterest)}` : '—'],
        ['Arrear Principal',    summary ? `₹${fmt(summary.arrearPrincipal)}` : '—'],
        ['Arrear Interest',     summary ? `₹${fmt(summary.arrearInterest)}` : '—'],
        ['Collected Principal', summary ? `₹${fmt(summary.collectedPrincipal)}` : '—'],
        ['Collected Interest',  summary ? `₹${fmt(summary.collectedInterest)}` : '—'],
    ];

    return (
        <div className="space-y-4">
            {/* ── Section 1: Member info ─────────────────────────────────── */}
            <div className="relative flex flex-col sm:flex-row gap-5">
                {/* Status badges — top right */}
                <div className="absolute top-0 right-0 flex flex-wrap items-center gap-1 justify-end">
                    <StatusBadge status={loan.loanStatus} />
                    {loan.isDead && (
                        <Badge className="text-xs font-semibold border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                            Dead
                        </Badge>
                    )}
                </div>

                {/* Photo */}
                <div className="flex-shrink-0">
                    <div className="w-24 h-24 rounded-xl overflow-hidden border bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        {ld?.clientPhotoUrl ? (
                            <img
                                src={ld.clientPhotoUrl}
                                alt="Member Photo"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <User className="w-10 h-10 text-slate-400" />
                        )}
                    </div>
                </div>

                {/* Two columns of member details */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 pr-20 sm:pr-24">
                    {/* Left column */}
                    <div className="space-y-3">
                        {leftCol.map(([label, value]) => (
                            <div key={label}>
                                <p className="text-xs text-muted-foreground">{label}</p>
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                    {value}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Right column */}
                    <div className="space-y-3">
                        {rightCol.map(([label, value]) => (
                            <div key={label}>
                                <p className="text-xs text-muted-foreground">{label}</p>
                                <p className={`text-sm font-medium ${label === 'Loan Advance' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                    {dash(value)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Section 2: Financial summary ──────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 pt-2 border-t">
                {summaryCards.map(([label, value]) => (
                    <div
                        key={label}
                        className="rounded-lg border bg-slate-50 dark:bg-slate-800 p-3 text-center"
                    >
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
                            {value}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-tight">{label}</p>
                    </div>
                ))}
            </div>

            {/* ── Section 3: Death info ───────────────────────────────────── */}
            {loan.isDead && loan.deathMarking && (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4 pt-3 space-y-3">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
                        Death Marking
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                        <div>
                            <p className="text-xs text-muted-foreground">Deceased Person</p>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {loan.deathMarking.deceasedPersonType === 'CO_APPLICANT' ? 'Co-Applicant' : 'Member'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Name</p>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {loan.deathMarking.deceasedPersonName || '—'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Death Date</p>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {fmtDate(loan.deathMarking.deathDate)}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Place of Death</p>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {loan.deathMarking.placeOfDeath || '—'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Death Reason</p>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                {loan.deathMarking.deathReason || '—'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Demand Required</p>
                            <p className={`text-sm font-medium ${loan.deathMarking.demandRequired ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                                {loan.deathMarking.demandRequired ? 'Yes' : 'No'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Death Certificate</p>
                            {loan.deathMarking.deathCertificateUrl ? (
                                <StorageLink
                                    href={loan.deathMarking.deathCertificateUrl}
                                    className="text-sm font-medium text-blue-600 dark:text-blue-400 underline hover:text-blue-800"
                                >
                                    {loan.deathMarking.deathCertificateName || 'View Certificate'}
                                </StorageLink>
                            ) : (
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">—</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Action Buttons (above table) ──────────────────────────── */}
            <div className="flex items-center gap-3 py-3 border-y">
                <Button
                    variant="outline"
                    className="gap-2 border-primary text-primary hover:bg-primary/10"
                    disabled={isPassbookDownloading}
                    onClick={onPassbookDownload}
                >
                    {isPassbookDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Download className="h-4 w-4" />
                    )}
                    Loan Card
                </Button>
                {showMarkDeath && (
                    <Button
                        variant="outline"
                        className="ml-auto gap-2 border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                        onClick={onMarkDeath}
                    >
                        <Skull className="h-4 w-4" />
                        Mark Death
                    </Button>
                )}
            </div>

            {/* ── Section 4: Repayment Schedule Table ────────────────────── */}
            <div className="pt-2 border-t">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                    <IndianRupee className="h-4 w-4 text-primary" />
                    Repayment Schedule
                </h3>
                {repHistoryLoading ? (
                    <PageLoader label="Loading schedule..." fullScreen={false} />
                ) : repRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-6">
                        No repayment schedule found.
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border">
                        <table className="min-w-max w-full text-[11px] border-collapse">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-slate-800 border-b">
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Due Date</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Due No</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Date Of Payment</th>
                                    <th colSpan={3} className="border px-2 py-1.5 text-center font-semibold bg-blue-50 dark:bg-blue-950/30">EMI Amount</th>
                                    {loanAdvanceEnabled && (
                                        <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold bg-emerald-50 dark:bg-emerald-950/30">Loan Advance</th>
                                    )}
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold bg-sky-50 dark:bg-sky-950/30">Total Amount</th>
                                    <th colSpan={3} className="border px-2 py-1.5 text-center font-semibold bg-amber-50 dark:bg-amber-950/30">Arrear Amount</th>
                                    <th colSpan={3} className="border px-2 py-1.5 text-center font-semibold bg-amber-100 dark:bg-amber-900/30">Arrear Received</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Penalty</th>
                                    <th colSpan={3} className="border px-2 py-1.5 text-center font-semibold bg-orange-50 dark:bg-orange-950/30">EMI Received</th>
                                    <th colSpan={2} className="border px-2 py-1.5 text-center font-semibold bg-green-50 dark:bg-green-950/30">Amount Received</th>
                                    {loanAdvanceEnabled && (
                                        <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Loan Advance Received</th>
                                    )}
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Loan Balance</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Group Officer</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Collected By</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold">Funder</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold bg-violet-50 dark:bg-violet-950/30">Status</th>
                                    <th rowSpan={2} className="border px-2 py-1.5 whitespace-nowrap text-center font-semibold bg-violet-50 dark:bg-violet-950/30">Approved By</th>
                                </tr>
                                <tr className="bg-slate-50 dark:bg-slate-800/60">
                                    <th className="border px-2 py-1 text-center font-medium bg-blue-50 dark:bg-blue-950/20">Pri</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-blue-50 dark:bg-blue-950/20">Int</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-blue-50 dark:bg-blue-950/20">Total</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-amber-50 dark:bg-amber-950/20">Principal</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-amber-50 dark:bg-amber-950/20">Interest</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-amber-50 dark:bg-amber-950/20">Total</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-amber-100 dark:bg-amber-900/20">Principal</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-amber-100 dark:bg-amber-900/20">Interest</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-amber-100 dark:bg-amber-900/20">Total</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-orange-50 dark:bg-orange-950/20">Principal</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-orange-50 dark:bg-orange-950/20">Interest</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-orange-50 dark:bg-orange-950/20">Total</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-green-50 dark:bg-green-950/20">Amount</th>
                                    <th className="border px-2 py-1 text-center font-medium bg-green-50 dark:bg-green-950/20">Paid Amt</th>
                                </tr>
                            </thead>
                            <tbody>
                                {repRows.map((row) => {
                                    const isPaid = row.amountPaid > 0;
                                    const totalAmountDisplay = row.dueAmount + (loanAdvanceEnabled ? (row.loanAdvanceAmount ?? 0) : 0);

                                    return (
                                        <tr
                                            key={row.installmentNo}
                                            className={`border-b hover:bg-slate-50 dark:hover:bg-slate-800/30 ${isPaid ? 'bg-green-50/30 dark:bg-green-950/10' : ''}`}
                                        >
                                            <td className="border px-2 py-1.5 whitespace-nowrap text-center">{row.dueDate}</td>
                                            <td className="border px-2 py-1.5 text-center font-semibold">{row.installmentNo}</td>
                                            <td className="border px-2 py-1.5 whitespace-nowrap text-center text-slate-600 dark:text-slate-400">
                                                {row.transactionDate ? fmtDateTime(row.transactionDate) : '—'}
                                            </td>
                                            {/* EMI Amount */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums">{fmt(row.principalDue)}</td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums">{fmt(row.interestDue)}</td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums font-medium">{fmt(row.dueAmount)}</td>
                                            {/* Loan Advance */}
                                            {loanAdvanceEnabled && (
                                                <td className="border px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                                                    {row.loanAdvanceAmount != null ? fmt(row.loanAdvanceAmount) : '—'}
                                                </td>
                                            )}
                                            {/* Total Amount — read-only display */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums font-medium">
                                                {fmt(totalAmountDisplay)}
                                            </td>
                                            {/* Arrear Amount — 3 sub-columns */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                                                {row.arrearPrincipal > 0 ? fmt(row.arrearPrincipal) : '0'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                                                {row.arrearInterest > 0 ? fmt(row.arrearInterest) : '0'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400 font-medium">
                                                {row.arrearTotal > 0 ? fmt(row.arrearTotal) : '0'}
                                            </td>
                                            {/* Arrear Received — 3 sub-columns */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-amber-800 dark:text-amber-300">
                                                {row.arrearReceivedPrincipal > 0 ? fmt(row.arrearReceivedPrincipal) : '0'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-amber-800 dark:text-amber-300">
                                                {row.arrearReceivedInterest > 0 ? fmt(row.arrearReceivedInterest) : '0'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-amber-800 dark:text-amber-300 font-medium">
                                                {row.arrearReceivedTotal > 0 ? fmt(row.arrearReceivedTotal) : '0'}
                                            </td>
                                            {/* Penalty */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">
                                                {row.breakdown.penalty > 0 ? fmt(row.breakdown.penalty) : '—'}
                                            </td>
                                            {/* EMI Received — Principal | Interest | Total */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-orange-600 dark:text-orange-400">
                                                {isPaid ? fmt(row.breakdown.principal) : '0'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-orange-600 dark:text-orange-400">
                                                {isPaid ? fmt(row.breakdown.interest) : '0'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums text-orange-600 dark:text-orange-400 font-medium">
                                                {isPaid ? fmt(row.amountPaid) : '0'}
                                            </td>
                                            {/* Amount Received — Amount | Paid Amt */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums font-medium text-green-700 dark:text-green-400">
                                                {isPaid ? fmt(row.amountPaid) : '—'}
                                            </td>
                                            <td className="border px-2 py-1.5 text-right tabular-nums font-medium text-green-700 dark:text-green-400">
                                                {isPaid ? fmt(row.amountPaid) : '—'}
                                            </td>
                                            {/* Loan Advance Received */}
                                            {loanAdvanceEnabled && (
                                                <td className="border px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                                                    {row.loanAdvanceAmount != null && row.loanAdvanceAmount > 0 ? fmt(row.loanAdvanceAmount) : '—'}
                                                </td>
                                            )}
                                            {/* Loan Balance */}
                                            <td className="border px-2 py-1.5 text-right tabular-nums font-semibold">
                                                {fmt(row.loanBalance)}
                                            </td>
                                            {/* Group Officer */}
                                            <td className="border px-2 py-1.5 whitespace-nowrap">{groupOfficerName ?? '—'}</td>
                                            {/* Collected By */}
                                            <td className="border px-2 py-1.5 whitespace-nowrap">{row.collectedByName ?? '—'}</td>
                                            {/* Funder */}
                                            <td className="border px-2 py-1.5 whitespace-nowrap">{funderName ?? '—'}</td>
                                            {/* Status */}
                                            <td className="border px-2 py-1.5 text-center">
                                                {row.transactionStatus ? (
                                                    <TransactionStatusBadge status={row.transactionStatus} />
                                                ) : (
                                                    <span className="text-slate-300">—</span>
                                                )}
                                            </td>
                                            {/* Approved By */}
                                            <td className="border px-2 py-1.5 whitespace-nowrap">
                                                {row.transactionStatus === 'APPROVED' ? (row.approvedByName ?? '—') : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Payment History Modal (actual transactions only — /payment-history) ──────

const PAYMENT_HISTORY_PAGE_SIZE = 20;

function PaymentHistoryModal({
    loanId,
    loanNumber,
    open,
    onClose,
}: {
    loanId: string;
    loanNumber: string;
    open: boolean;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [data, setData] = useState<PaymentHistoryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();

    useEffect(() => {
        if (!open || !loanId) return;
        setData(null);
        setPage(1);
        setLoading(true);
        apiClient
            .get<PaymentHistoryData>(`/collections/member-collection-details/payment-history?loanId=${loanId}`)
            .then((res) => {
                if (res.success && res.data) {
                    setData(res.data);
                } else {
                    toast({
                        title: 'Error',
                        description: (res as any).error || 'Failed to load payment history',
                        variant: 'destructive',
                    });
                }
            })
            .catch(() =>
                toast({
                    title: 'Error',
                    description: 'Failed to load payment history',
                    variant: 'destructive',
                })
            )
            .finally(() => setLoading(false));
    }, [open, loanId, toast]);

    const rows = data?.rows ?? [];
    const totalPages = Math.max(1, Math.ceil(rows.length / PAYMENT_HISTORY_PAGE_SIZE));
    const pageRows = rows.slice((page - 1) * PAYMENT_HISTORY_PAGE_SIZE, page * PAYMENT_HISTORY_PAGE_SIZE);

    function handleDownloadExcel() {
        if (rows.length === 0) return;
        const exportRows = rows.map((row) => ({
            'Due No': row.dueNo ?? '—',
            'Due Date': fmtDateIst(row.dueDate),
            'Transaction Date & Time': fmtDateTimeIst(row.transactionDate),
            'Transaction Type': row.transactionType,
            'Status': row.status,
            'Payment Amount': row.paymentAmount,
            'Principal': row.principal,
            'Interest': row.interest,
            ...(loanAdvanceEnabled ? { 'Loan Advance / Advance Amount': row.advanceAmount ?? '—' } : {}),
            'Loan Balance': row.loanBalance,
            'Collected By': row.collectedByName ?? '—',
        }));
        const ws = buildReportSheet(`Payment History - ${loanNumber}`, exportRows);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Payment History');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `payment_history_${loanNumber}.xlsx`);
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="w-screen h-screen max-h-screen rounded-none sm:w-[98vw] sm:h-[90vh] sm:max-w-[1800px] sm:max-h-[90vh] sm:rounded-lg lg:w-[95vw] flex flex-col p-0">
                <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0 flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                        <DialogTitle className="text-base font-semibold">
                            Payment History — {loanNumber}
                        </DialogTitle>
                        {data?.loanDetails && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {data.loanDetails.clientName} &nbsp;|&nbsp;
                                ₹{fmt(data.loanDetails.amount)} &nbsp;|&nbsp;
                                {data.loanDetails.frequency} &nbsp;|&nbsp;
                                {rows.length} transaction{rows.length !== 1 ? 's' : ''}
                            </p>
                        )}
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 shrink-0"
                        disabled={rows.length === 0}
                        onClick={handleDownloadExcel}
                    >
                        <Download className="h-3.5 w-3.5" />
                        Download Excel
                    </Button>
                </DialogHeader>

                {loading ? (
                    <PageLoader label="Loading payment history..." fullScreen={false} />
                ) : rows.length === 0 ? (
                    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                        No payment transactions found for this loan.
                    </div>
                ) : (
                    <>
                        <div className="overflow-auto flex-1 px-4 pb-2">
                            <Table className="min-w-[1200px] text-xs">
                                <TableHeader className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                                    <TableRow className="bg-slate-50 dark:bg-slate-800">
                                        <TableHead className="whitespace-nowrap">Due No</TableHead>
                                        <TableHead className="whitespace-nowrap">Due Date</TableHead>
                                        <TableHead className="whitespace-nowrap">Transaction Date & Time</TableHead>
                                        <TableHead className="whitespace-nowrap">Transaction Type</TableHead>
                                        <TableHead className="whitespace-nowrap">Status</TableHead>
                                        <TableHead className="whitespace-nowrap text-right">Payment Amount</TableHead>
                                        <TableHead className="whitespace-nowrap text-right">Principal</TableHead>
                                        <TableHead className="whitespace-nowrap text-right">Interest</TableHead>
                                        {loanAdvanceEnabled && (
                                            <TableHead className="whitespace-nowrap text-right">Loan Advance</TableHead>
                                        )}
                                        <TableHead className="whitespace-nowrap text-right">Loan Balance</TableHead>
                                        <TableHead className="whitespace-nowrap">Collected By</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pageRows.map((row, idx) => (
                                        <TableRow key={`${row.transactionDbId}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                            <TableCell className="font-medium">{row.dueNo ?? '—'}</TableCell>
                                            <TableCell className="whitespace-nowrap">{fmtDateIst(row.dueDate)}</TableCell>
                                            <TableCell className="whitespace-nowrap">{fmtDateTimeIst(row.transactionDate)}</TableCell>
                                            <TableCell className="whitespace-nowrap">{row.transactionType}</TableCell>
                                            <TableCell>
                                                <TransactionStatusBadge status={row.status} />
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums font-medium">{fmt(row.paymentAmount)}</TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {row.principal > 0 ? fmt(row.principal) : '—'}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {row.interest > 0 ? fmt(row.interest) : '—'}
                                            </TableCell>
                                            {loanAdvanceEnabled && (
                                                <TableCell className="text-right tabular-nums">
                                                    {row.advanceAmount != null ? fmt(row.advanceAmount) : '—'}
                                                </TableCell>
                                            )}
                                            <TableCell className="text-right tabular-nums font-semibold">{fmt(row.loanBalance)}</TableCell>
                                            <TableCell className="whitespace-nowrap">{row.collectedByName ?? '—'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="flex items-center justify-between px-6 py-3 border-t shrink-0 text-xs">
                            <span className="text-muted-foreground">
                                Showing {(page - 1) * PAYMENT_HISTORY_PAGE_SIZE + 1}
                                –{Math.min(page * PAYMENT_HISTORY_PAGE_SIZE, rows.length)} of {rows.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                    Previous
                                </Button>
                                <span className="text-muted-foreground">Page {page} of {totalPages}</span>
                                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                    Next
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── Death Marking Modal ──────────────────────────────────────────────────────

function DeathMarkingModal({
    loan,
    clientId,
    memberName,
    open,
    onClose,
    onSuccess,
}: {
    loan: LoanRow;
    clientId: string;
    memberName: string;
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const { toast } = useToast();
    const [form, setForm] = useState<DeathForm>({
        deceasedPersonType: '',
        deceasedPersonName: '',
        deathReason:        '',
        deathDate:          '',
        placeOfDeath:       '',
        demandRequired:     false,
        certificateFile:    null,
        certificateUrl:     '',
        certificateName:    '',
        certificateCompressionNote: '',
    });
    const [errors, setErrors] = useState<Partial<Record<keyof DeathForm | 'certificate', string>>>({});
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [coApplicantLoading, setCoApplicantLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            setForm({
                deceasedPersonType: '',
                deceasedPersonName: '',
                deathReason:        '',
                deathDate:          '',
                placeOfDeath:       '',
                demandRequired:     false,
                certificateFile:    null,
                certificateUrl:     '',
                certificateName:    '',
                certificateCompressionNote: '',
            });
            setErrors({});
            setUploading(false);
        }
    }, [open]);

    useEffect(() => {
        if (!form.deceasedPersonType) {
            setForm((f) => ({ ...f, deceasedPersonName: '' }));
            return;
        }
        if (form.deceasedPersonType === 'MEMBER') {
            setForm((f) => ({ ...f, deceasedPersonName: memberName }));
            return;
        }
        // CO_APPLICANT — fetch name
        setCoApplicantLoading(true);
        apiClient.get<{ name: string } | null>(`/co-applicants?clientId=${clientId}`)
            .then((res) => {
                const name = res.success && res.data ? (res.data as any).name ?? '' : '';
                setForm((f) => ({ ...f, deceasedPersonName: name }));
            })
            .catch(() => setForm((f) => ({ ...f, deceasedPersonName: '' })))
            .finally(() => setCoApplicantLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.deceasedPersonType]);

    function validate(): boolean {
        const e: Partial<Record<keyof DeathForm | 'certificate', string>> = {};
        if (!form.deceasedPersonType) e.deceasedPersonType = 'Please select the deceased person';
        if (!form.deathReason.trim()) e.deathReason = 'Death reason is required';
        if (!form.deathDate) e.deathDate = 'Death date is required';
        if (!form.placeOfDeath.trim()) e.placeOfDeath = 'Place of death is required';
        if (!form.certificateUrl) e.certificate = 'Death certificate is required';
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    async function handleCertificateChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setErrors((prev) => ({ ...prev, certificate: undefined }));
        try {
            const compressionResult = await compressImageForCategory(file, 'document');
            const { compressedFile, previewUrl } = compressionResult;
            URL.revokeObjectURL(previewUrl);
            const certificateCompressionNote = compressionResult.wasCompressed
                ? `Compressed ${compressionResult.originalSizeLabel} → ${compressionResult.compressedSizeLabel} (saved ${compressionResult.reductionPercent}%)`
                : '';

            const formData = new FormData();
            formData.append('file', compressedFile);
            const token = tokenStorage.getAccessToken();
            const res = await fetch(`/api/loans/${loan.id}/death-marking/upload-certificate`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData,
                credentials: 'include',
            });
            const json = await res.json();
            if (json.success) {
                setForm((f) => ({
                    ...f,
                    certificateFile: compressedFile,
                    certificateUrl:  json.data.fileUrl,
                    certificateName: json.data.fileName,
                    certificateCompressionNote,
                }));
            } else {
                toast({ title: 'Upload Failed', description: json.error || 'Could not upload certificate', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Upload Failed', description: 'Failed to upload death certificate', variant: 'destructive' });
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    }

    function handleRemoveCertificate() {
        setForm((f) => ({ ...f, certificateFile: null, certificateUrl: '', certificateName: '', certificateCompressionNote: '' }));
    }

    async function handleSubmit() {
        if (!validate()) return;
        setSubmitting(true);
        try {
            const res = await apiClient.post(`/loans/${loan.id}/death-marking`, {
                deceasedPersonType:  form.deceasedPersonType,
                deceasedPersonName:  form.deceasedPersonName.trim(),
                deathReason:         form.deathReason.trim(),
                deathDate:           new Date(form.deathDate).toISOString(),
                placeOfDeath:        form.placeOfDeath.trim(),
                demandRequired:      form.demandRequired,
                deathCertificateUrl: form.certificateUrl,
                deathCertificateName: form.certificateName,
            });
            if (res.success) {
                toast({ title: 'Success', description: 'Death marking saved successfully.' });
                onSuccess();
                onClose();
            } else {
                toast({ title: 'Error', description: (res as any).error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save death marking', variant: 'destructive' });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-4xl flex flex-col max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle className="text-base font-semibold flex items-center gap-2">
                        <Skull className="h-4 w-4 text-red-600" />
                        Death Marking — {loan.loanIndex ?? loan.loanNumber}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2 overflow-y-auto flex-1">
                    {/* Row 1: Deceased Person + Auto-filled Name */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">
                                Deceased Person <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={form.deceasedPersonType}
                                onValueChange={(v) =>
                                    setForm((f) => ({ ...f, deceasedPersonType: v as 'MEMBER' | 'CO_APPLICANT' }))
                                }
                            >
                                <SelectTrigger className={errors.deceasedPersonType ? 'border-red-500' : ''}>
                                    <SelectValue placeholder="Select deceased person" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="MEMBER">Member</SelectItem>
                                    <SelectItem value="CO_APPLICANT">Co-Applicant</SelectItem>
                                </SelectContent>
                            </Select>
                            {errors.deceasedPersonType && (
                                <p className="text-xs text-red-500">{errors.deceasedPersonType}</p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">
                                {form.deceasedPersonType === 'CO_APPLICANT' ? 'Co-Applicant Name' : 'Member Name'}
                            </Label>
                            {coApplicantLoading ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Fetching name...
                                </div>
                            ) : (
                                <Input
                                    value={form.deceasedPersonName}
                                    readOnly
                                    className="bg-muted text-muted-foreground cursor-default"
                                    placeholder="Auto-filled after selection"
                                />
                            )}
                            {form.deceasedPersonType === 'CO_APPLICANT' && !coApplicantLoading && !form.deceasedPersonName && (
                                <p className="text-xs text-amber-600">No co-applicant found for this client.</p>
                            )}
                        </div>
                    </div>

                    {/* Row 2: Death Reason + Death Date */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="death-reason" className="text-sm font-medium">
                                Death Reason <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="death-reason"
                                placeholder="Enter reason for death..."
                                value={form.deathReason}
                                onChange={(e) => setForm((f) => ({ ...f, deathReason: e.target.value }))}
                                rows={3}
                                className={errors.deathReason ? 'border-red-500' : ''}
                            />
                            {errors.deathReason && (
                                <p className="text-xs text-red-500">{errors.deathReason}</p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="death-date" className="text-sm font-medium">
                                Death Date <span className="text-red-500">*</span>
                            </Label>
                            <DateInput
                                id="death-date"
                                value={form.deathDate}
                                onChange={(e) => setForm((f) => ({ ...f, deathDate: e.target.value }))}
                                className={errors.deathDate ? 'border-red-500' : ''}
                            />
                            {errors.deathDate && (
                                <p className="text-xs text-red-500">{errors.deathDate}</p>
                            )}
                        </div>
                    </div>

                    {/* Row 3: Place of Death + Demand Required */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="place-of-death" className="text-sm font-medium">
                                Place Of Death <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="place-of-death"
                                placeholder="Enter place of death..."
                                value={form.placeOfDeath}
                                onChange={(e) => setForm((f) => ({ ...f, placeOfDeath: e.target.value }))}
                                className={errors.placeOfDeath ? 'border-red-500' : ''}
                            />
                            {errors.placeOfDeath && (
                                <p className="text-xs text-red-500">{errors.placeOfDeath}</p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Demand Required</Label>
                            <div className="flex items-center justify-between rounded-lg border p-3 h-10">
                                <p className="text-xs text-muted-foreground">
                                    {form.demandRequired
                                        ? 'Demand continues after death marking'
                                        : 'No demand after death marking'}
                                </p>
                                <Switch
                                    checked={form.demandRequired}
                                    onCheckedChange={(v) => setForm((f) => ({ ...f, demandRequired: v }))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Row 4: Death Certificate Upload */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">
                                Death Certificate <span className="text-red-500">*</span>
                            </Label>
                            {form.certificateUrl ? (
                                <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                                        <StorageLink
                                            href={form.certificateUrl}
                                            className="text-xs text-green-700 dark:text-green-400 underline truncate flex-1"
                                            title={form.certificateName}
                                        >
                                            {form.certificateName}
                                        </StorageLink>
                                        <button
                                            type="button"
                                            onClick={handleRemoveCertificate}
                                            className="text-muted-foreground hover:text-red-500 shrink-0"
                                            title="Remove"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    {form.certificateCompressionNote && (
                                        <p className="mt-1 pl-6 text-[10px] text-blue-600 dark:text-blue-400">
                                            {form.certificateCompressionNote}
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <label className={`flex items-center gap-2 cursor-pointer rounded-lg border-2 border-dashed px-3 py-3 transition-colors hover:border-primary/50 ${errors.certificate ? 'border-red-500 bg-red-50 dark:bg-red-950/10' : 'border-border'}`}>
                                    <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        className="sr-only"
                                        onChange={handleCertificateChange}
                                        disabled={uploading}
                                    />
                                    {uploading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                            <span className="text-xs text-muted-foreground">Uploading…</span>
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="h-4 w-4 text-muted-foreground" />
                                            <span className="text-xs text-muted-foreground">Click to upload PDF, JPG, or PNG (max 10 MB)</span>
                                        </>
                                    )}
                                </label>
                            )}
                            {errors.certificate && (
                                <p className="text-xs text-red-500">{errors.certificate}</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t">
                    <Button variant="outline" onClick={onClose} disabled={submitting || uploading}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={submitting || uploading}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Saving...
                            </>
                        ) : (
                            'Confirm Death Marking'
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MemberCollectionDetailsClient() {
    const { toast } = useToast();

    const [searchType, setSearchType] = useState<'phone' | 'aadhaar' | 'memberId'>('phone');
    const [searchValue, setSearchValue] = useState('');
    const [productTypeId, setProductTypeId] = useState('all');
    const [productTypes, setProductTypes] = useState<LoanProductType[]>([]);

    const [searchResults, setSearchResults] = useState<ClientResult[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
    const [loanDetails, setLoanDetails] = useState<Record<string, ScheduleApiResponse>>({});
    const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
    const [repaymentHistories, setRepaymentHistories] = useState<Record<string, RepaymentHistoryData>>({});
    const [loadingRepHistoryId, setLoadingRepHistoryId] = useState<string | null>(null);

    const [repaymentModalLoanId, setRepaymentModalLoanId] = useState<string | null>(null);
    const [repaymentModalLoanNumber, setRepaymentModalLoanNumber] = useState('');

    const [passbookDownloadingId, setPassbookDownloadingId] = useState<string | null>(null);

    const [deathMarkingLoan, setDeathMarkingLoan] = useState<LoanRow | null>(null);
    const [deathMarkingClient, setDeathMarkingClient] = useState<ClientResult | null>(null);

    useEffect(() => {
        apiClient
            .get<{ productTypes?: LoanProductType[] } | LoanProductType[]>('/loan-product-types')
            .then((res) => {
                if (res.success && res.data) {
                    const data = res.data as any;
                    const list: LoanProductType[] = Array.isArray(data)
                        ? data
                        : Array.isArray(data.productTypes)
                          ? data.productTypes
                          : [];
                    setProductTypes(list);
                }
            });
    }, []);

    const handleSearch = useCallback(async () => {
        const trimmed = searchValue.trim();
        if (!trimmed) return;
        setIsSearching(true);
        setSearchResults(null);
        setExpandedLoanId(null);

        const params = new URLSearchParams({ searchType, searchValue: trimmed });
        if (productTypeId && productTypeId !== 'all') params.set('productTypeId', productTypeId);

        const res = await apiClient.get<SearchResponse>(
            `/collections/member-collection-details/search?${params.toString()}`
        );
        setIsSearching(false);

        if (res.success && res.data) {
            setSearchResults(res.data.clients ?? []);
            if ((res.data.clients ?? []).length === 0) {
                toast({ title: 'No results', description: 'No members found for this search.' });
            }
        } else {
            toast({
                title: 'Search failed',
                description: (res as any).error || 'Could not fetch member data.',
                variant: 'destructive',
            });
        }
    }, [searchType, searchValue, productTypeId, toast]);

    const handleViewToggle = useCallback(
        async (loan: LoanRow) => {
            if (expandedLoanId === loan.id) {
                setExpandedLoanId(null);
                return;
            }
            setExpandedLoanId(loan.id);

            // Fetch schedule if not cached
            if (!loanDetails[loan.id]) {
                setLoadingDetailId(loan.id);
                const res = await apiClient.get<ScheduleApiResponse>(`/loans/${loan.id}/schedule`);
                setLoadingDetailId(null);
                if (res.success && res.data) {
                    setLoanDetails((prev) => ({ ...prev, [loan.id]: res.data! }));
                } else {
                    toast({ title: 'Error', description: 'Could not load loan details.', variant: 'destructive' });
                }
            }

            // Fetch repayment history if not cached
            if (!repaymentHistories[loan.id]) {
                setLoadingRepHistoryId(loan.id);
                const rh = await apiClient.get<RepaymentHistoryData>(
                    `/collections/member-collection-details/repayment-history?loanId=${loan.id}`
                );
                setLoadingRepHistoryId(null);
                if (rh.success && rh.data) {
                    setRepaymentHistories((prev) => ({ ...prev, [loan.id]: rh.data! }));
                }
            }
        },
        [expandedLoanId, loanDetails, repaymentHistories, toast]
    );

    const openRepaymentModal = useCallback((loan: LoanRow) => {
        setRepaymentModalLoanId(loan.id);
        setRepaymentModalLoanNumber(loan.loanNumber);
    }, []);

    const handlePassbookDownload = useCallback(async (loan: LoanRow) => {
        setPassbookDownloadingId(loan.id);
        try {
            const pbRes = await apiClient.get<PassbookData>(`/loans/${loan.id}/passbook`);
            if (!pbRes.success || !pbRes.data) {
                toast({ title: 'Error', description: (pbRes as any).error || 'Failed to fetch passbook data', variant: 'destructive' });
                return;
            }

            const { memberDetails, installments } = pbRes.data;
            const payload = {
                memberDetails: {
                    loanAmount:          String(memberDetails.loanAmount),
                    upiNumber:           memberDetails.upiNumber,
                    accountNumber:       memberDetails.accountNumber,
                    branchCode:          memberDetails.branchCode,
                    branchName:          memberDetails.branchName,
                    memberName:          memberDetails.memberName,
                    disbursementDate:    memberDetails.disbursementDate,
                    loanPurpose:         memberDetails.loanPurpose,
                    centerCode:          memberDetails.centerCode,
                    centerName:          memberDetails.centerName,
                    centerMemberNo:      memberDetails.centerMemberNo,
                    husbandName:         memberDetails.husbandName,
                    loanType:            memberDetails.loanType,
                    firstInstallmentDate: memberDetails.firstInstallmentDate,
                    memberPhone:         memberDetails.memberPhone,
                },
                installments: installments.map((inst) => ({
                    no:        inst.no,
                    date:      inst.date,
                    principal: parseFloat(inst.principal),
                    interest:  parseFloat(inst.interest),
                    balance:   parseFloat(inst.balance),
                })),
            };

            const token = tokenStorage.getAccessToken();
            const response = await fetch('/api/generate-passbook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                toast({ title: 'Error', description: (err as any).error || 'PDF generation failed', variant: 'destructive' });
                return;
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `passbook_${memberDetails.memberName.replace(/\s+/g, '_')}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({ title: 'Downloaded', description: `Passbook PDF downloaded for ${memberDetails.memberName}.` });
        } catch {
            toast({ title: 'Error', description: 'Failed to generate passbook PDF', variant: 'destructive' });
        } finally {
            setPassbookDownloadingId(null);
        }
    }, [toast]);

    const allLoanRows: Array<{ client: ClientResult; loan: LoanRow }> = (
        searchResults ?? []
    ).flatMap((client) => client.loans.map((loan) => ({ client, loan })));

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(allLoanRows);

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                    Member Collection Details
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Search for a member to view all loans and repayment history.
                </p>
            </div>

            {/* ── Search Card ─────────────────────────────────────────────── */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Search className="h-4 w-4 text-primary" />
                        Search Member
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label className="text-xs font-medium text-muted-foreground mb-2 block">
                            Search By
                        </Label>
                        <RadioGroup
                            value={searchType}
                            onValueChange={(v) => setSearchType(v as typeof searchType)}
                            className="flex flex-wrap gap-4"
                        >
                            {[
                                { value: 'phone', label: 'Phone Number' },
                                { value: 'aadhaar', label: 'Aadhaar Card Number' },
                                { value: 'memberId', label: 'Member ID' },
                            ].map((opt) => (
                                <div key={opt.value} className="flex items-center gap-2">
                                    <RadioGroupItem value={opt.value} id={`st-${opt.value}`} />
                                    <Label htmlFor={`st-${opt.value}`} className="text-sm cursor-pointer">
                                        {opt.label}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <Input
                            placeholder={
                                searchType === 'phone'
                                    ? 'Enter phone number'
                                    : searchType === 'aadhaar'
                                      ? 'Enter Aadhaar number'
                                      : 'Enter Member ID'
                            }
                            value={searchValue}
                            onChange={(e) => setSearchValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="flex-1"
                        />

                        <Select value={productTypeId} onValueChange={setProductTypeId}>
                            <SelectTrigger className="w-full sm:w-56">
                                <SelectValue placeholder="All Product Types" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Product Types</SelectItem>
                                {productTypes.map((pt) => (
                                    <SelectItem key={pt.id} value={pt.id}>
                                        {pt.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Button
                            onClick={handleSearch}
                            disabled={isSearching || !searchValue.trim()}
                            className="bg-primary hover:bg-sidebar-accent text-white"
                        >
                            {isSearching ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Search className="h-4 w-4 mr-2" />
                            )}
                            Search
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* ── Results Table ─────────────────────────────────────────────── */}
            {searchResults !== null && (
                <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-3 space-y-0">
                        <CardTitle className="text-base flex items-center gap-2">
                            <IndianRupee className="h-4 w-4 text-primary" />
                            Loan Details
                            {searchedRows.length > 0 && (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    ({searchedRows.length} loan{searchedRows.length !== 1 ? 's' : ''})
                                </span>
                            )}
                        </CardTitle>
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search loans..."
                        />
                    </CardHeader>
                    <CardContent className="p-0">
                        {searchedRows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
                                <User className="h-10 w-10 mb-3 opacity-30" />
                                <p className="text-sm">No loans found for this member.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table className="min-w-[1350px]">
                                    <TableHeader>
                                        <TableRow className="bg-slate-50 dark:bg-slate-800">
                                            <TableHead className="whitespace-nowrap text-xs">Member ID</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">Loan Index #</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">Member Name</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">LD Date</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">Start Date</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">End Date</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs text-right">Loan Amount</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs text-right">Outstanding</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs text-right">Due Interest</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">Loan Status</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs">Death Certificate</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs text-center">View</TableHead>
                                            <TableHead className="whitespace-nowrap text-xs text-center">Repayment</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.map(({ client, loan }) => (
                                            <React.Fragment key={loan.id}>
                                                <TableRow className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                    <TableCell className="text-xs font-mono">
                                                        {client.clientId}
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        {loan.loanIndex ?? loan.loanNumber}
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium whitespace-nowrap">
                                                        {client.fullName}
                                                    </TableCell>
                                                    <TableCell className="text-xs whitespace-nowrap">
                                                        {dash(loan.ldDate)}
                                                    </TableCell>
                                                    <TableCell className="text-xs whitespace-nowrap">
                                                        {dash(loan.startDate)}
                                                    </TableCell>
                                                    <TableCell className="text-xs whitespace-nowrap">
                                                        {dash(loan.endDate)}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-right tabular-nums">
                                                        ₹{fmt(loan.amount)}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-right tabular-nums">
                                                        ₹{fmt(loan.outstandingBalance)}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-right tabular-nums">
                                                        ₹{fmt(loan.dueInterest)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-wrap items-center gap-1">
                                                            <StatusBadge status={loan.loanStatus} />
                                                            {loan.isDead && (
                                                                <Badge className="text-xs font-semibold border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                                                    Dead
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        {loan.deathMarking?.deathCertificateUrl ? (
                                                            <StorageLink
                                                                href={loan.deathMarking.deathCertificateUrl}
                                                                className="text-blue-600 underline hover:text-blue-800 truncate max-w-[140px] block"
                                                                title={loan.deathMarking.deathCertificateName ?? undefined}
                                                            >
                                                                {loan.deathMarking.deathCertificateName || 'View'}
                                                            </StorageLink>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="h-7 w-7 p-0"
                                                            onClick={() => handleViewToggle(loan)}
                                                        >
                                                            {expandedLoanId === loan.id ? (
                                                                <EyeOff className="h-3.5 w-3.5" />
                                                            ) : (
                                                                <Eye className="h-3.5 w-3.5" />
                                                            )}
                                                        </Button>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Button
                                                            size="sm"
                                                            className="h-7 px-2 text-xs gap-1 bg-primary hover:bg-sidebar-accent text-white"
                                                            onClick={() => openRepaymentModal(loan)}
                                                        >
                                                            <History className="h-3 w-3" />
                                                            History
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            </React.Fragment>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Loan Detail Panel (below table) ─────────────────────────── */}
            {expandedLoanId && (() => {
                const found = allLoanRows.find(({ loan }) => loan.id === expandedLoanId);
                if (!found) return null;
                const { loan, client } = found;

                return (
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Eye className="h-4 w-4 text-primary" />
                                Loan Details — {loan.loanIndex ?? loan.loanNumber}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <LoanDetailPanel
                                loan={loan}
                                client={client}
                                detail={loanDetails[loan.id] ?? null}
                                loading={loadingDetailId === loan.id}
                                repHistory={repaymentHistories[loan.id] ?? null}
                                repHistoryLoading={loadingRepHistoryId === loan.id}
                                onPassbookDownload={() => handlePassbookDownload(loan)}
                                isPassbookDownloading={passbookDownloadingId === loan.id}
                                showMarkDeath={loan.disbursementStatus === 'DISBURSED' && !loan.isClosed && !loan.isDead}
                                onMarkDeath={() => { setDeathMarkingLoan(loan); setDeathMarkingClient(client); }}
                            />
                        </CardContent>
                    </Card>
                );
            })()}

            {/* ── Payment History Modal ──────────────────────────────────── */}
            {repaymentModalLoanId && (
                <PaymentHistoryModal
                    loanId={repaymentModalLoanId}
                    loanNumber={repaymentModalLoanNumber}
                    open={!!repaymentModalLoanId}
                    onClose={() => {
                        setRepaymentModalLoanId(null);
                        setRepaymentModalLoanNumber('');
                    }}
                />
            )}

            {/* ── Death Marking Modal ──────────────────────────────────────── */}
            {deathMarkingLoan && (
                <DeathMarkingModal
                    loan={deathMarkingLoan}
                    clientId={deathMarkingClient?.id ?? ''}
                    memberName={deathMarkingClient?.fullName ?? ''}
                    open={!!deathMarkingLoan}
                    onClose={() => { setDeathMarkingLoan(null); setDeathMarkingClient(null); }}
                    onSuccess={() => { handleSearch(); }}
                />
            )}
        </div>
    );
}
