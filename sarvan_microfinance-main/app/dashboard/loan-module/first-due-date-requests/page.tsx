import { FirstDueDateRequestsClient } from '@/components/loan-module/FirstDueDateRequestsClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function FirstDueDateRequestsPage() {
    return (
        <ProtectedRoute>
            <FirstDueDateRequestsClient />
        </ProtectedRoute>
    );
}
