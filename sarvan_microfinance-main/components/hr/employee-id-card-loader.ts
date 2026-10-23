import { apiClient } from '@/app/lib/api-client';
import type { IdCardData } from '@/components/hr/EmployeeIdCardModal';

/** Wire shape of GET /api/hr/employees/[id]/id-card (EmployeeIdCardPayload, dates as ISO strings). */
interface EmployeeIdCardResponse {
    employeeId: string | null;
    fullName: string;
    designation: string | null;
    department: string | null;
    branchName: string | null;
    branchCode: string | null;
    dateOfJoining: string | null;
    dateOfBirth: string | null;
    bloodGroup: string | null;
    address: string | null;
    mobileNumber: string | null;
    emergencyContactName: string | null;
    emergencyContactRelation: string | null;
    emergencyContactMobile: string | null;
    photoKey: string | null;
}

/** One reason a card can't be issued (IdCardIssue in app/lib/hr/id-card-eligibility.ts). */
export interface IdCardIssueView {
    code: string;
    message: string;
}

export type EmployeeIdCardLoadResult =
    | { status: 'ok'; data: IdCardData }
    | { status: 'not-eligible'; issues: IdCardIssueView[] }
    | { status: 'error'; error: string };

/**
 * Live ID card data for a provisioned employee (User.id) — the same User row
 * Employee Master edits, so a saved edit shows on the next card opened. The
 * API refuses (422) when the employee isn't eligible for a card; that comes
 * back as `not-eligible` with the reasons, so the UI can show what to fix.
 */
export async function fetchEmployeeIdCardData(userId: string): Promise<EmployeeIdCardLoadResult> {
    const res = await apiClient.get<EmployeeIdCardResponse>(`/hr/employees/${userId}/id-card`);
    if (!res.success || !res.data) {
        // On failure `data` carries the error payload, not the card.
        const payload = res.data as unknown as { code?: string; issues?: IdCardIssueView[] } | undefined;
        if (payload?.code === 'ID_CARD_NOT_ELIGIBLE' && payload.issues?.length) {
            return { status: 'not-eligible', issues: payload.issues };
        }
        return { status: 'error', error: res.error || 'Failed to load ID card details' };
    }
    const card = res.data;
    return {
        status: 'ok',
        data: {
            fullName: card.fullName,
            employeeId: card.employeeId || 'PENDING',
            designation: card.designation,
            department: card.department,
            branchName: card.branchName,
            branchCode: card.branchCode,
            dateOfJoining: card.dateOfJoining,
            dateOfBirth: card.dateOfBirth,
            bloodGroup: card.bloodGroup,
            address: card.address,
            mobileNumber: card.mobileNumber,
            emergencyContactName: card.emergencyContactName,
            emergencyContactRelation: card.emergencyContactRelation,
            emergencyContactMobile: card.emergencyContactMobile,
            // Same-origin proxy, not a signed GCS URL: html2canvas (PDF export)
            // can't read a cross-origin image back out of its canvas.
            photoUrl: card.photoKey ? `/api/storage/proxy?key=${encodeURIComponent(card.photoKey)}` : null,
        },
    };
}
