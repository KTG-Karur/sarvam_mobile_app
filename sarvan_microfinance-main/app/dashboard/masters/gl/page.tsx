import { GLMasterPage } from '@/components/masters/GLMasterPage';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { getActiveBrandNames } from '@/app/lib/brand-server';

export async function generateMetadata() {
    const { companyNameShort } = await getActiveBrandNames();
    return {
        title: `GL Master | ${companyNameShort} Microfinance`,
        description: 'Manage General Ledger accounts for Principal and Interest components.',
    };
}

export default function GLMasterRoute() {
    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/20 to-green-50/20 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <GLMasterPage />
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
