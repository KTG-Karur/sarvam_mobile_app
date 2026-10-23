'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui/page-loader';

export default function EmployeeCreationPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/dashboard/employees/create');
    }, [router]);

    return <PageLoader />;
}
