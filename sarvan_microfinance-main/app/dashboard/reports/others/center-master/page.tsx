import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, FileText } from 'lucide-react';
import { CenterMasterClient } from '@/components/reports/CenterMasterClient';

export default function CenterMasterPage() {
    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="flex min-h-screen flex-col">
                    <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                        <div className="mx-auto max-w-7xl space-y-6">
                            {/* Background Glow Effect */}
                            <div className="absolute inset-0 -z-10 overflow-hidden">
                                <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                                <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                            </div>

                            {/* Page Header */}
                            <PageHeader
                                title="Center Master"
                                description="View and manage center master data including center details, FDO assignments, and center statistics."
                            />

                            <CenterMasterClient />
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

