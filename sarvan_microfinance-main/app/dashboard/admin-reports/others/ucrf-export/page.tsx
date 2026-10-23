import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { protectAdminOnlyServerRoute } from '@/app/lib/server-route-protection';
import { UcrfExportClient } from '@/components/admin-reports/UcrfExportClient';
import { Suspense } from 'react';
import { PageLoader } from '@/components/ui/page-loader';

export default async function UcrfExportPage() {
    // ADMIN only — no RBAC page-permission override.
    await protectAdminOnlyServerRoute();

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="container mx-auto px-4 py-8 lg:px-6">
                <Suspense fallback={<PageLoader fullScreen={false} />}>
                    <UcrfExportClient />
                </Suspense>
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
