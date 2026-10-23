import { MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One remark written at any approval stage (stage action or per-document review). */
export type StageRemarkEntry = {
    id: string;
    /** Stage name as shown in the trail, e.g. "BM", "AM", "QC", "Admin", or a custom stage name. */
    stage: string;
    /** What the stage did, e.g. "Retake Requested", "Approved & Forwarded". */
    action: string | null;
    /** Set when the remark was written on a single document rather than the whole stage. */
    documentLabel?: string | null;
    person: string | null;
    employeeId: string | null;
    /** Already formatted for display (DD/MM/YYYY hh:mm). */
    date: string | null;
    remark: string;
};

/**
 * Every remark written so far, by every stage, oldest first — so each later
 * stage (and Admin) sees what BM / AM / QC / custom stages wrote, not only the
 * remark of the stage chip they click. Renders nothing when there are none.
 */
export function StageRemarksPanel({ entries, className }: { entries: StageRemarkEntry[]; className?: string }) {
    if (entries.length === 0) return null;
    return (
        <div className={cn('border-t border-border print:break-inside-avoid', className)}>
            <div className="border-b border-border border-l-4 border-l-secondary bg-muted px-3 py-2 flex items-center gap-2">
                <MessageSquareText className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                    Remarks from All Stages ({entries.length})
                </span>
            </div>
            <ol className="divide-y divide-border">
                {entries.map((e) => (
                    <li key={e.id} className="px-3 py-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                {e.stage}
                            </span>
                            {e.action && <span className="font-semibold text-foreground">{e.action}</span>}
                            {e.documentLabel && (
                                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {e.documentLabel}
                                </span>
                            )}
                            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{e.date}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{e.remark}</p>
                        {e.person && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                — {e.person}
                                {e.employeeId && <span className="ml-1 font-mono">({e.employeeId})</span>}
                            </p>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}
