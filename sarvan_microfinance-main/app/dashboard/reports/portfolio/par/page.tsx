'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PortfolioAtRiskClient } from '@/components/reports/PortfolioAtRiskClient';

export default function PARPage() {
    return (
        <ProtectedRoute requiredPermission="PAR_REPORT">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Background Glow Effects */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-red-500/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl" />
                    </div>

                    <PortfolioAtRiskClient />
                </div>
            </div>
        </ProtectedRoute>
    );
}
