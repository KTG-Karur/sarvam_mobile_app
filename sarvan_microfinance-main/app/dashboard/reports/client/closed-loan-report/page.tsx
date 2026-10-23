import { ClosedLoanReport } from '@/components/reports/ClosedLoanReport';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ClosedLoanReportPage() {
    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="flex min-h-screen flex-col">
                    <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                        <div className="mx-auto max-w-7xl space-y-6">
                            <div className="absolute inset-0 -z-10 overflow-hidden">
                                <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                                <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                            </div>
                            <PageHeader
                                title="Closed Loan Report"
                                description="View all closed, preclosed, and written-off loans within a selected date range with detailed financial breakdown."
                            />
                            <ClosedLoanReport />
                        </div>
                    </div>
                </div>
                <div className="px-6 pb-6">
                    <DashboardFooter />
                </div>
            </div>
        </ProtectedRoute>
    );
}
