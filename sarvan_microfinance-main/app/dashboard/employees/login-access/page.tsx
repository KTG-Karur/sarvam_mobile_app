import { LoginAccessClient } from '@/components/employees/LoginAccessClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function LoginAccessPage() {
    return (
        <ProtectedRoute>
            <LoginAccessClient />
        </ProtectedRoute>
    );
}
