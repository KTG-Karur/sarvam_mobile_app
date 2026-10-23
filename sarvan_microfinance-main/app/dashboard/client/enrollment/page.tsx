import { Suspense } from 'react';
import { ClientEnrollmentForm } from '@/components/client/ClientEnrollmentForm';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ClientEnrollmentPage() {
    return (
        <ProtectedRoute>
            {/* pt-4/pt-6 gives the form card visual breathing room from the top
                while keeping the tab bar able to reach main's edge when sticky. */}
            <div className="container mx-auto pt-4 sm:pt-6 pb-8 px-4">
                <Suspense fallback={null}>
                    <ClientEnrollmentForm />
                </Suspense>
            </div>
        </ProtectedRoute>
    );
}
