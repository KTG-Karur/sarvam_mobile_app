import { LoanAdvanceLedgerReport } from '@/components/reports/LoanAdvanceLedgerReport';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { protectServerRoute } from '@/app/lib/server-route-protection';
import { Wallet } from 'lucide-react';

export default async function LoanAdvanceLedgerPage() {
    await protectServerRoute('/dashboard/reports/client/loan-advance');

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30">
                            <Wallet className="h-6 w-6 text-white" />
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Loan Advance Ledger
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                View all loan advance collections and refunds per client across all loans
                            </p>
                        </div>
                    </div>
                </div>

                <LoanAdvanceLedgerReport />
            </div>

            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
