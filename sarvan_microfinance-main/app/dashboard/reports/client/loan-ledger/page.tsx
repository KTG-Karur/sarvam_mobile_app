import { LoanLedgerReport } from '@/components/reports/LoanLedgerReport';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { FileText } from 'lucide-react';

export default function LoanLedgerPage() {
    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <FileText className="h-6 w-6 text-white" />
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Loan Ledger
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                View detailed transaction history for client loan accounts
                            </p>
                        </div>
                    </div>
                </div>

                {/* Report Component */}
                <LoanLedgerReport />
            </div>

            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
        </ProtectedRoute>
    );
}
