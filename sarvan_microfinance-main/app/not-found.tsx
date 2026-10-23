'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageLoader } from '@/components/ui/page-loader';

/**
 * App-wide catch-all for any URL that doesn't match a route. Next.js renders
 * this for every unmatched path in the app, not just ones under /dashboard.
 *
 * Logged in: bounce into a nonexistent /dashboard/* path so the dashboard's
 * catch-all (app/dashboard/[...catchAll]) triggers app/dashboard/not-found.tsx,
 * which renders the 404 UI inside the sidebar/header shell.
 * Logged out: go straight to /login instead of showing a 404 at all.
 */
export default function RootNotFound() {
    const router = useRouter();

    useEffect(() => {
        const user = tokenStorage.getUser();
        if (!user) {
            router.replace('/login');
        } else {
            router.replace('/dashboard/404-page-not-found');
        }
    }, [router]);

    return <PageLoader fullScreen />;
}
