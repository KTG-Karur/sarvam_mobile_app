import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { protectServerRoute } from '@/app/lib/server-route-protection';
import { AgewiseArrearClient } from '@/components/mis-reports/AgewiseArrearClient';
import { Suspense } from 'react';
import { PageLoader } from '@/components/ui/page-loader';

export default async function AgewiseArrearPage() {
    // Protect route - only ADMIN can access
    await protectServerRoute('/dashboard/mis-reports/agewise-arrear');

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            {/* Background Glow Effects */}
            <div className="absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-blob rounded-full bg-primary/10 blur-3xl" />
                <div className="absolute right-1/4 bottom-1/4 h-96 w-96 animate-blob animation-delay-2000 rounded-full bg-primary/10 blur-3xl" />
                <div className="absolute left-1/2 top-1/2 h-96 w-96 animate-blob animation-delay-4000 rounded-full bg-purple-500/10 blur-3xl" />
            </div>

            <div className="container mx-auto px-4 py-8 lg:px-6">
                <Suspense fallback={<PageLoader fullScreen={false} />}>
                    <AgewiseArrearClient />
                </Suspense>
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}

