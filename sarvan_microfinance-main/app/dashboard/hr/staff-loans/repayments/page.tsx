import { redirect } from 'next/navigation';

// Retired: Early Settlement now lives on the combined Staff Loan / Staff Advance settlement page.
export default function StaffLoanRepaymentsRoute() {
    redirect('/dashboard/hr/staff-settlement');
}
