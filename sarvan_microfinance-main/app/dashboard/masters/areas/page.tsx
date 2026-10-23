import AreaPage from '@/components/masters/AreaPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';

export default function AreaPageRoute() {
    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <AreaPage />
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
