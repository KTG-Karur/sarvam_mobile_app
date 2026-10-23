import { cn } from '@/lib/utils';
import type { MemberContactFields } from '@/app/lib/reports/member-contact-columns';

/** Header label for the single on-screen column that stacks the three values. */
export const MEMBER_CONTACT_COLUMN_LABEL = 'Aadhaar / Mobile';

/**
 * Stacked Aadhaar / member mobile / co-applicant mobile for a member-level report
 * row — one compact column on screen (exports use three separate columns, see
 * MEMBER_CONTACT_HEADERS in app/lib/reports/member-contact-columns.ts).
 */
export function MemberContactCell({ row, className }: { row: MemberContactFields; className?: string }) {
    return (
        <div className={cn('space-y-0.5 text-[11px] leading-tight whitespace-nowrap tabular-nums', className)}>
            <p><span className="text-slate-400">Aadhaar:</span> <span className="font-medium">{row.aadhaarNumber || '-'}</span></p>
            <p><span className="text-slate-400">Mobile:</span> <span className="font-medium">{row.mobileNumber || '-'}</span></p>
            <p><span className="text-slate-400">Co-App:</span> <span className="font-medium">{row.coApplicantMobile || '-'}</span></p>
        </div>
    );
}
