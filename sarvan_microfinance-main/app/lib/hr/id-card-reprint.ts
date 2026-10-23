// ============================================================
// ID CARD REPRINT DETECTION
// app/lib/hr/id-card-reprint.ts
//
// A printed card can't update itself. When HR prints or downloads a card
// (POST /api/hr/employees/[id]/id-card/issue) we store a fingerprint of the
// fields physically printed on it (User.idCardFingerprint). If the live record
// later produces a different fingerprint, the card in the employee's hand is
// out of date and the Employee List shows "Reprint required".
//
// Only printed fields count (see EmployeeIdCardModal): front — photo, name,
// employee code, blood group, emergency contact; back — date of joining, date
// of birth, address; the QR encodes the employee code. Designation/branch only
// appear in the on-screen dialog header, so changing them needs no reprint.
// ============================================================

import { createHash } from 'crypto';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

export interface PrintedIdCardFields {
    employeeId: string | null;
    fullName: string;
    photoKey: string | null;
    bloodGroup: string | null;
    emergencyContactMobile: string | null;
    dateOfJoining: Date | null;
    dateOfBirth: Date | null;
    address: string | null;
}

const norm = (value: string | null): string => (value ?? '').trim();
// Dates are printed as calendar days, so compare the IST calendar day, not the instant.
const day = (value: Date | null): string => (value ? getKolkataCalendarYmd(value) : '');

export function computeIdCardFingerprint(card: PrintedIdCardFields): string {
    const printed = [
        norm(card.employeeId),
        norm(card.fullName),
        norm(card.photoKey),
        norm(card.bloodGroup),
        norm(card.emergencyContactMobile),
        day(card.dateOfJoining),
        day(card.dateOfBirth),
        norm(card.address),
    ];
    return createHash('sha256').update(JSON.stringify(printed)).digest('hex');
}
