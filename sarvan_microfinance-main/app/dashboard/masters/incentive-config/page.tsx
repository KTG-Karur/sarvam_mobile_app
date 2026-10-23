import { IncentiveConfigPage } from '@/components/masters/IncentiveConfigPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function IncentiveConfigRoute() {
    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="px-3 sm:px-6 py-4 sm:py-8">
                    <div className="mx-auto max-w-6xl">
                        <IncentiveConfigPage />
                    </div>
                </div>
                <div className="px-6 pb-6">
                    <DashboardFooter />
                </div>
            </div>
        </ProtectedRoute>
    );
}
