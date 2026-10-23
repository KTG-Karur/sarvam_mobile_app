'use client';

import { Check, Clock, RotateCcw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toDisplayDateTime } from '@/app/lib/date-format';

type Reviewer = { firstName: string; lastName: string; employeeId: string | null } | null | undefined;

/** One review stage's outcome on a KYC image. */
export type DocStage = {
    /** Stage label — 'BM' / 'AM' / 'QC', or a dynamic workflow stage's name. */
    key: string;
    decision: string | null | undefined;
    at?: string | null;
    by?: Reviewer;
};

const fmtDateTime = (iso: string) =>
    toDisplayDateTime(new Date(iso));

const OTHER_STATUS: Record<string, { label: string; icon: typeof Clock; cls: string }> = {
    PENDING:         { label: 'Pending',         icon: Clock,     cls: 'border-border bg-muted/40 text-muted-foreground' },
    RETAKE_REQUIRED: { label: 'Retake Required', icon: RotateCcw, cls: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300' },
    REJECTED:        { label: 'Rejected',        icon: XCircle,   cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' },
    DELETED:         { label: 'Deleted',         icon: XCircle,   cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' },
};

/**
 * Per-image approval status shown under a KYC image on the approval screens
 * (member approval and renewal loan approval): every stage that approved it as a
 * bold green "Approved by <stage>" row with a round tick, reviewer and date-time;
 * stages not yet approved as small status chips underneath (hidden with showOthers=false).
 */
export function DocStageApprovals({ stages, showOthers = true, className }: { stages: DocStage[]; showOthers?: boolean; className?: string }) {
    const approved = stages.filter((s) => s.decision === 'VERIFIED');
    const others = showOthers ? stages.filter((s) => s.decision !== 'VERIFIED') : [];
    if (approved.length === 0 && others.length === 0) return null;
    return (
        <div className={cn('space-y-1.5 px-2 py-2', approved.length > 0 && 'bg-emerald-50/60 dark:bg-emerald-950/20', className)}>
            {approved.map((s) => (
                <div key={s.key} className="flex items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                        <Check className="h-4 w-4" strokeWidth={3.5} />
                    </span>
                    <div className="min-w-0 leading-tight">
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Approved by {s.key}</p>
                        <p className="text-[10px] text-muted-foreground">
                            {s.by && <span className="font-medium text-foreground">{`${s.by.firstName} ${s.by.lastName}`.trim()}{s.by.employeeId ? ` (${s.by.employeeId})` : ''}</span>}
                            {s.by && s.at && ' · '}
                            {s.at && fmtDateTime(s.at)}
                        </p>
                    </div>
                </div>
            ))}
            {others.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {others.map((s) => {
                        const st = OTHER_STATUS[s.decision ?? 'PENDING'] ?? OTHER_STATUS.PENDING;
                        const Icon = st.icon;
                        return (
                            <span
                                key={s.key}
                                className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', st.cls)}
                                title={s.by ? `${s.by.firstName} ${s.by.lastName}${s.at ? ` · ${fmtDateTime(s.at)}` : ''}` : undefined}
                            >
                                <Icon className="h-3 w-3" /> {s.key}: {st.label}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
