import { redirect } from 'next/navigation';

/**
 * Redirect old enrollment route to the better UI enrollment form
 * This route is deprecated - all users should use /dashboard/client/enrollment
 */
export default async function EnrollmentPage() {
    redirect('/dashboard/client/enrollment');
}

