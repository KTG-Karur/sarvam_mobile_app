import StaffLoanWorkflowPage from '@/components/masters/staff-loans/StaffLoanWorkflowPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function StaffLoanWorkflowRoute() {
    return <ProtectedRoute>
        <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <StaffLoanWorkflowPage />
            <div className="px-6 pb-6"><DashboardFooter /></div>
        </div>
    </ProtectedRoute>;
}
