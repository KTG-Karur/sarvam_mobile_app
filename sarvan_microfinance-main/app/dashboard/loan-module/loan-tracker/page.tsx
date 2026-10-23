import { LoanTrackerClient } from '@/components/loan-module/LoanTrackerClient';

export default function LoanTrackerPage() {
    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-teal-50/30 to-cyan-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="w-full px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
                <LoanTrackerClient />
            </div>
        </div>
    );
}
