import GoldReturnPage from '@/components/gold-return/GoldReturnPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';

export default function GoldReturnPageRoute() {
    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-yellow-50/30 to-amber-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <GoldReturnPage />
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
