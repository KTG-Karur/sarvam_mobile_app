import { MpinChangeRequestsClient } from '@/components/employees/MpinChangeRequestsClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function MpinChangeRequestsPage() {
    return (
        <ProtectedRoute>
            <MpinChangeRequestsClient />
        </ProtectedRoute>
    );
}
