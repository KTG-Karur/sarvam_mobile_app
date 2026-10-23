import { Suspense } from 'react';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { protectServerRoute } from '@/app/lib/server-route-protection';
import { DisbursementRevertClient } from '@/components/revert/DisbursementRevertClient';
import { PageLoader } from '@/components/ui/page-loader';

export default async function DisbursementRevertPage() {
    await protectServerRoute('/dashboard/revert/disbursement-revert');

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-rose-50/30 to-rose-50/30 dark:from-background dark:via-[#330d0d] dark:to-[#1a0505]">
            <div className="container mx-auto px-4 py-8 lg:px-6">
                <Suspense fallback={<PageLoader label="Loading Disbursement Revert..." fullScreen={false} />}>
                    <DisbursementRevertClient />
                </Suspense>
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
