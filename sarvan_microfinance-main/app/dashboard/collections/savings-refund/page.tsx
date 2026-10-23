import { Suspense } from 'react';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { protectServerRoute } from '@/app/lib/server-route-protection';
import { SavingsRefundClient } from '@/components/collections/SavingsRefundClient';
import { PageLoader } from '@/components/ui/page-loader';

export default async function SavingsRefundPage() {
    await protectServerRoute('/dashboard/collections/savings-refund');

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-blob rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="absolute right-1/4 bottom-1/4 h-96 w-96 animate-blob animation-delay-2000 rounded-full bg-teal-500/10 blur-3xl" />
            </div>

            <div className="container mx-auto px-4 py-8 lg:px-6">
                <Suspense fallback={<PageLoader fullScreen={false} />}>
                    <SavingsRefundClient />
                </Suspense>
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
