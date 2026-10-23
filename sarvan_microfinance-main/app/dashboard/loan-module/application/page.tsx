import { redirect } from 'next/navigation';

// Renewal Loan Application has been folded into the Member Enrollment page
// ("Loan Type = Renewal Loan"). This route is kept only so old links /
// bookmarks land in the right place.
export default function ApplicationPage() {
    redirect('/dashboard/client/enrollment?loanType=renewal');
}
