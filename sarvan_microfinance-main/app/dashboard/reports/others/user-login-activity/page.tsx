import { UserLoginActivityReport } from '@/components/reports/UserLoginActivityReport';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function UserLoginActivityPage() {
    return (
        <ProtectedRoute>
            <div className="container mx-auto pt-4 sm:pt-6 pb-8 px-4">
                <UserLoginActivityReport />
            </div>
        </ProtectedRoute>
    );
}
