import { DeathMemberReport } from '@/components/reports/DeathMemberReport';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';

export default function DeathMemberReportPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-background to-[#e8f5e9] dark:from-background dark:to-brand-green-darker">
            <div className="container mx-auto px-4 py-6 max-w-[1600px]">
                <DeathMemberReport />
                <DashboardFooter />
            </div>
        </div>
    );
}
