import StaffLoanManagementPage from '@/components/hr/staff-loans/StaffLoanManagementPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function StaffLoanManagementRoute() {
    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/20 to-teal-50/20 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <StaffLoanManagementPage />
                <div className="px-6 pb-6">
                    <DashboardFooter />
                </div>
            </div>
        </ProtectedRoute>
    );
}
