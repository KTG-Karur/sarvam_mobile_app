import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { NotFoundContent } from '@/components/errors/NotFoundContent';

export default function DashboardNotFound() {
    return (
        <ProtectedRoute>
            <NotFoundContent />
        </ProtectedRoute>
    );
}
