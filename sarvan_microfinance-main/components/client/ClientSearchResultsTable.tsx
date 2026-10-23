'use client';

import { useState, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, MapPin, Phone, IdCard, Users } from 'lucide-react';
import { getPersonLabel } from '@/app/lib/person-label';

export interface ClientSearchResult {
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
    kycData: string;
    loanData: string;
    advData: string;
    branchId: string;
    /** Branch name resolved from center.branch or enrolledBy.branch */
    branchName?: string;
    accountId: string;
    centerName: string;
    clientName: string;
    spouseName?: string;
    nomineeName?: string;
    relationship?: string;
    phone?: string;
    otherId?: string;
    smartCard?: string;
    voterId?: string;
    pancard?: string;
    status: 'Active' | 'Inactive';
    dedupeFlag: number;
}

interface ClientSearchResultsTableProps {
    results: ClientSearchResult[];
    className?: string;
    onShowKyc?: (result: ClientSearchResult) => void;
    onShowLoan?: (result: ClientSearchResult) => void;
    onShowAdvance?: (result: ClientSearchResult) => void;
}

export function ClientSearchResultsTable({
    results,
    className,
    onShowKyc,
    onShowLoan,
    onShowAdvance,
}: ClientSearchResultsTableProps) {
    const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);

    if (results.length === 0) {
        return null;
    }

    return (
        <div
            className={cn(
                'mt-4 overflow-hidden rounded-2xl border border-primary/20 bg-green-50/60 dark:border-sidebar-accent dark:bg-brand-green-darker/40',
                className
            )}
        >
            <div className="max-h-[420px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                <Table className="min-w-full text-xs">
                    <TableHeader className="bg-primary text-white">
                        <TableRow className="hover:bg-primary/80">
                            <TableHead className="font-semibold text-white">Name</TableHead>
                            <TableHead className="font-semibold text-white">Center</TableHead>
                            <TableHead className="font-semibold text-white">Contact</TableHead>
                            <TableHead className="font-semibold text-white">Status</TableHead>
                            <TableHead className="font-semibold text-white">Dedupe</TableHead>
                            <TableHead className="text-center font-semibold text-white">
                                Actions
                            </TableHead>
                            <TableHead className="w-10 text-center font-semibold text-white">
                                Details
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="bg-white dark:bg-green-950/30">
                        {results.map((result, index) => {
                            const isExpanded = expandedAccountId === result.accountId;

                            return (
                                <Fragment key={result.accountId}>
                                    <TableRow
                                        className={cn(
                                            index % 2 === 1
                                                ? 'bg-green-50/80 dark:bg-brand-green-darker/40'
                                                : 'bg-white dark:bg-green-950/20'
                                        )}
                                    >
                                        <TableCell className="min-w-[220px]">
                                            <div className="flex flex-col gap-0.5">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className="font-semibold text-foreground dark:text-slate-100">
                                                        {result.clientName}
                                                    </span>
                                                    <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/20 dark:text-emerald-400">
                                                        {getPersonLabel(!!result.hasLoan).singular}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                                    <span className="inline-flex rounded-full border border-primary/20 bg-green-50 px-2 py-0.5 dark:border-sidebar-accent/60 dark:bg-brand-green-darker/60">
                                                        <Users className="mr-1 h-3 w-3" />
                                                        <span>Acc: {result.accountId}</span>
                                                    </span>
                                                    <span className="inline-flex rounded-full border border-primary/20 bg-green-50 px-2 py-0.5 dark:border-sidebar-accent/60 dark:bg-brand-green-darker/60">
                                                        Branch {result.branchId}
                                                    </span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="min-w-[200px]">
                                            <div className="flex flex-col gap-0.5 text-[11px] text-sidebar-accent dark:text-slate-300">
                                                <span className="inline-flex items-center gap-1">
                                                    <MapPin className="h-3 w-3" />
                                                    {result.centerName}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="min-w-[160px]">
                                            <div className="flex flex-col gap-0.5 text-[11px] text-sidebar-accent dark:text-slate-300">
                                                {result.phone && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Phone className="h-3 w-3" />
                                                        {result.phone}
                                                    </span>
                                                )}
                                                {result.otherId && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <IdCard className="h-3 w-3" />
                                                        {result.otherId}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span
                                                className={cn(
                                                    'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                                    result.status === 'Active'
                                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                                                )}
                                            >
                                                {result.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {result.dedupeFlag}
                                        </TableCell>
                                        <TableCell className="min-w-[130px]">
                                            <div className="flex flex-wrap items-center gap-1.5 justify-center">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="h-7 px-3 text-[11px] font-semibold bg-primary hover:bg-primary text-white"
                                                    onClick={
                                                        onShowKyc
                                                            ? () => {
                                                                  onShowKyc(result);
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    KYC
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="h-7 px-3 text-[11px] font-semibold bg-primary hover:bg-primary text-white"
                                                    onClick={
                                                        onShowLoan
                                                            ? () => {
                                                                  onShowLoan(result);
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    Loan
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="h-7 px-3 text-[11px] font-semibold bg-primary hover:bg-primary text-white"
                                                    onClick={
                                                        onShowAdvance
                                                            ? () => {
                                                                  onShowAdvance(result);
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    Adv
                                                </Button>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <button
                                                type="button"
                                                aria-label={
                                                    isExpanded
                                                        ? 'Collapse client details'
                                                        : 'Expand client details'
                                                }
                                                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-white text-slate-500 hover:border-primary hover:text-primary dark:border-sidebar-accent/60 dark:bg-brand-green-darker dark:hover:border-primary"
                                                onClick={() => {
                                                    setExpandedAccountId(
                                                        isExpanded ? null : result.accountId
                                                    );
                                                }}
                                            >
                                                {isExpanded ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                )}
                                            </button>
                                        </TableCell>
                                    </TableRow>

                                    {isExpanded && (
                                        <TableRow className="bg-green-50/80 dark:bg-brand-green-darker/60">
                                            <TableCell colSpan={7}>
                                                <div className="grid gap-3 text-[11px] text-sidebar-accent dark:text-slate-300 md:grid-cols-4">
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-sidebar-accent dark:text-slate-100">
                                                            Family Details
                                                        </p>
                                                        <p>Spouse: {result.spouseName || '-'}</p>
                                                        <p>Nominee: {result.nomineeName || '-'}</p>
                                                        <p>Relationship: {result.relationship || '-'}</p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-sidebar-accent dark:text-slate-100">
                                                            Identity
                                                        </p>
                                                        <p>Smart Card: {result.smartCard || '-'}</p>
                                                        <p>Voter ID: {result.voterId || '-'}</p>
                                                        <p>Pancard: {result.pancard || '-'}</p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-sidebar-accent dark:text-slate-100">
                                                            Account
                                                        </p>
                                                        <p>Account ID: {result.accountId}</p>
                                                        <p>Branch ID: {result.branchId}</p>
                                                        <p>Center: {result.centerName}</p>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-sidebar-accent dark:text-slate-100">
                                                            System
                                                        </p>
                                                        <p>Dedupe Flag: {result.dedupeFlag}</p>
                                                        <p>Status: {result.status}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}


