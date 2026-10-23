'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { DenominationEntryPanel } from '@/components/utilities/DenominationEntryPanel';

export default function DenominationEntryContent() {
    const searchParams = useSearchParams();
    const [selectedDate, setSelectedDate] = useState<string>(
        () => searchParams.get('date') || new Date().toISOString().split('T')[0]
    );

    useEffect(() => {
        const dateFromQuery = searchParams.get('date');
        if (dateFromQuery) {
            setSelectedDate(dateFromQuery);
        }
    }, [searchParams]);

    return (
        <ProtectedRoute requiredRoles={['FDO', 'BRANCH_MANAGER', 'ADMIN']}>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-emerald-50/30 to-teal-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="absolute inset-0 -z-10 overflow-hidden">
                    <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-blob rounded-full bg-emerald-500/10 blur-3xl" />
                    <div className="absolute right-1/4 bottom-1/4 h-96 w-96 animate-blob animation-delay-2000 rounded-full bg-teal-500/10 blur-3xl" />
                    <div className="absolute left-1/2 top-1/2 h-96 w-96 animate-blob animation-delay-4000 rounded-full bg-cyan-500/10 blur-3xl" />
                </div>

                <div className="container mx-auto px-4 py-8 lg:px-6">
                    <DenominationEntryPanel dateYmd={selectedDate} variant="page" showDateSelector />
                </div>
            </div>
        </ProtectedRoute>
    );
}
