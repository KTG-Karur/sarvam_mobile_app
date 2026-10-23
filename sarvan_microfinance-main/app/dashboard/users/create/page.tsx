'use client';

import { useRouter } from 'next/navigation';
import { UserForm } from '@/app/components/users/UserForm';

export default function CreateUserPage() {
  const router = useRouter();

  const handleSuccess = () => {
    router.push('/dashboard/users');
  };

  const handleCancel = () => {
    router.push('/dashboard/users');
  };

  return (
    <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
      <UserForm onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
