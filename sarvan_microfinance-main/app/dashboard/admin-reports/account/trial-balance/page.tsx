import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { TrialBalanceClient } from '@/components/accounts/TrialBalanceClient';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';

export default function TrialBalancePage() {
    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    <TrialBalanceClient />
                </div>
                <div className="px-6 pb-6">
                    <DashboardFooter />
                </div>
            </div>
        </ProtectedRoute>
    );
}
