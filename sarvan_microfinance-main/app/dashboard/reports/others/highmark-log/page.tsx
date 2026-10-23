import { HighmarkLogClient } from '@/components/highmark/HighmarkLogClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function HighmarkLogPage() {
    return (
        <ProtectedRoute>
            <div className="container mx-auto pt-4 sm:pt-6 pb-8 px-4">
                <HighmarkLogClient />
            </div>
        </ProtectedRoute>
    );
}
