import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { protectServerRoute } from '@/app/lib/server-route-protection';
import { MemberIdEditClient } from '@/components/masters/MemberIdEditClient';

export default async function MemberIdEditPage() {
    await protectServerRoute('/dashboard/masters/super-control/member-id-edit');

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="container mx-auto px-4 py-8 lg:px-6">
                <MemberIdEditClient />
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
