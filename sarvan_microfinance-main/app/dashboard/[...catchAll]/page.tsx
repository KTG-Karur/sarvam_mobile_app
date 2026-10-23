import { notFound } from 'next/navigation';

/**
 * Catches any /dashboard/* path that doesn't match a real page so it renders
 * app/dashboard/not-found.tsx (keeping the sidebar/header shell) instead of
 * falling through to the bare root app/not-found.tsx.
 */
export default function DashboardCatchAll() {
    notFound();
}
