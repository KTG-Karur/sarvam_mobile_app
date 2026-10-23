
import { Suspense } from 'react';
import { VoucherModificationComponent } from '@/components/transactions/VoucherModificationClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLoader } from '@/components/ui/page-loader';

export default function VoucherModificationPage() {
    return (
        <ProtectedRoute requiredRoles={['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO']}>
            <div className="min-h-screen bg-background p-6">
                <div className="mx-auto max-w-7xl space-y-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-slate-50">
                            Voucher Modification
                        </h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Search, modify, or delete existing transaction vouchers.
                        </p>
                    </div>

                    <Suspense fallback={<PageLoader fullScreen={false} />}>
                        <VoucherModificationComponent />
                    </Suspense>
                </div>
            </div>
        </ProtectedRoute>
    );
}
