'use client';

import { KYCVerificationTable } from './KYCVerificationTable';

export function KYCVerificationClient() {
    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    KYC Verification (LOS)
                </h1>
                <p className="text-muted-foreground">
                    View and update KYC verification status for clients
                </p>
            </div>

            {/* Table View */}
            <KYCVerificationTable />
        </div>
    );
}

