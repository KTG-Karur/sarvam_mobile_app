import { RunCreditCheckClient } from '@/components/highmark/RunCreditCheckClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function CreditCheckPage() {
    return (
        <ProtectedRoute>
            <div className="container mx-auto pt-4 sm:pt-6 pb-8 px-4">
                <RunCreditCheckClient />
            </div>
        </ProtectedRoute>
    );
}
