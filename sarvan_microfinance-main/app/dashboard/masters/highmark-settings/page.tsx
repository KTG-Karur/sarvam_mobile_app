import { HighmarkSettingsClient } from '@/components/highmark/HighmarkSettingsClient';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function HighmarkSettingsPage() {
    return (
        <ProtectedRoute>
            <div className="container mx-auto pt-4 sm:pt-6 pb-8 px-4">
                <HighmarkSettingsClient />
            </div>
        </ProtectedRoute>
    );
}
