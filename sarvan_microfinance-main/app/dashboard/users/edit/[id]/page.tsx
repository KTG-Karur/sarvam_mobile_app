'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { UserForm } from '@/app/components/users/UserForm';
import { useUserManagement } from '@/app/hooks/use-user-management';
import { Loader2 } from 'lucide-react';

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { fetchUsers } = useUserManagement();

  const handleSuccess = () => {
    router.push('/dashboard/users');
  };

  const handleCancel = () => {
    router.push('/dashboard/users');
  };

  return (
    <div className="space-y-6 p-6">
      <UserForm userId={resolvedParams.id} onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
