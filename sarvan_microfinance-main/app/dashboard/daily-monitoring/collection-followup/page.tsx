import { CollectionFollowupClient } from '@/components/daily-monitoring/CollectionFollowupClient';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';

export default function CollectionFollowupPage() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
      <div className="px-3 sm:px-6 py-4 sm:py-8">
        <div className="mx-auto max-w-7xl">
          <CollectionFollowupClient />
        </div>
      </div>
      <div className="px-6 pb-6">
        <DashboardFooter />
      </div>
    </div>
  );
}


