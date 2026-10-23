import type { Metadata } from 'next';
import { EmployeeVerificationClient } from '@/components/hr/EmployeeVerificationClient';

// Public QR target — keep individual employee pages out of search engines.
export const metadata: Metadata = {
    title: 'Employee Verification',
    robots: { index: false, follow: false },
};

export default async function VerifyEmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
    const { employeeId } = await params;
    let decoded = employeeId;
    try {
        decoded = decodeURIComponent(employeeId);
    } catch {
        // Malformed escape — pass through; the API rejects it as NOT_FOUND.
    }
    return <EmployeeVerificationClient employeeId={decoded} />;
}
