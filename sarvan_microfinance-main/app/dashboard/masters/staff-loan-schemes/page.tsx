import StaffLoanSchemesPage from '@/components/masters/staff-loans/StaffLoanSchemesPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function StaffLoanSchemesRoute() {
    return <ProtectedRoute>
        <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <StaffLoanSchemesPage />
            <div className="px-6 pb-6"><DashboardFooter /></div>
        </div>
    </ProtectedRoute>;
}
