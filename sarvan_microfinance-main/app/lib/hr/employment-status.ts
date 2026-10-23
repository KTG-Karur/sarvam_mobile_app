// ============================================================
// EMPLOYMENT STATUS — is this person currently employed?
// app/lib/hr/employment-status.ts
//
// One rule shared by the public QR verification page
// (/api/public/verify-employee) and ID card eligibility
// (app/lib/hr/id-card-eligibility.ts), so a card is never issued to someone
// the QR page would report as exited, and vice versa.
// ============================================================

import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * ACTIVE   — isActive and no exit date in the past
 * INACTIVE — User.isActive is false, no past exit date
 * EXITED   — dateOfExit is before today (IST), regardless of isActive
 */
export type CurrentEmploymentStatus = 'ACTIVE' | 'INACTIVE' | 'EXITED';

// dateOfExit is the last working day, so the person is still employed on it.
export function deriveEmploymentStatus(
    isActive: boolean,
    dateOfExit: Date | null,
    now: Date = new Date()
): CurrentEmploymentStatus {
    if (dateOfExit && getKolkataCalendarYmd(dateOfExit) < getKolkataCalendarYmd(now)) return 'EXITED';
    return isActive ? 'ACTIVE' : 'INACTIVE';
}
