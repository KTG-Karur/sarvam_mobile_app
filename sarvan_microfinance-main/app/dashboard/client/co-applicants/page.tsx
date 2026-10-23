import { Suspense } from 'react';
import { PageLoader } from '@/components/ui/page-loader';
import { CoApplicantManagementClient } from '@/components/client/CoApplicantManagementClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function CoApplicantsPage() {
    return (
        <ProtectedRoute>
            <div className="container mx-auto pt-4 sm:pt-6 pb-8 px-4">
                <Suspense fallback={<PageLoader label="Loading..." fullScreen={false} />}>
                    <CoApplicantManagementClient />
                </Suspense>
            </div>
        </ProtectedRoute>
    );
}
