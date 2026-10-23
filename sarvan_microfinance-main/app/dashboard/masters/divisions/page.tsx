import DivisionPage from '@/components/masters/DivisionPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';

export default function DivisionPageRoute() {
    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-purple-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <DivisionPage />
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
