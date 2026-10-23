import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CompanyProfileClient } from '@/components/reports/CompanyProfileClient';

export default function CompanyProfilePage() {
    return (
        <ProtectedRoute requiredRoles={['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER']}>
            <div className="flex-col md:flex">
                <div className="flex-1 space-y-4 p-8 pt-6">
                    <CompanyProfileClient />
                </div>
            </div>
            <DashboardFooter />
        </ProtectedRoute>
    );
}
