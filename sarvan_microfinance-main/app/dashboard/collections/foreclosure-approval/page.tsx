import { Suspense } from 'react';
import { protectServerRoute } from '@/app/lib/server-route-protection';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ForeclosureApprovalClient } from '@/components/collections/ForeclosureApprovalClient';
import { PageLoader } from '@/components/ui/page-loader';

export default async function ForeclosureApprovalPage() {
  await protectServerRoute('/dashboard/collections/foreclosure-approval');

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
      <div className="container mx-auto px-4 py-8 lg:px-6">
        <Suspense
          fallback={<PageLoader fullScreen={false} />}
        >
          <ForeclosureApprovalClient />
        </Suspense>
      </div>
      <div className="px-6 pb-6">
        <DashboardFooter />
      </div>
    </div>
  );
}

