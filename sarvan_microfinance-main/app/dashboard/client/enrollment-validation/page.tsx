import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { EnrollmentValidationPage } from '@/components/client/EnrollmentValidationPage';

export default function ClientEnrollmentValidationPage() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto py-8 px-4">
        <EnrollmentValidationPage />
      </div>
    </ProtectedRoute>
  );
}
