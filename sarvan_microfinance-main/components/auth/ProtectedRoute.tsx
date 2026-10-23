'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { PERMISSIONS } from '@/app/lib/permissions';
import type { UserRole } from '@/app/types';
import { useAuthStore, type PagePermissionsMap } from '@/app/store/authStore';
import { computeEffectiveRole, resolvePageAuthorization } from '@/app/lib/permissions/route-authorization';
import { getAllowedRolesForHref } from '@/app/config/navigation.config';
import { PageLoader } from '@/components/ui/page-loader';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredPermission?: keyof typeof PERMISSIONS;
    /**
     * Optional explicit override. When omitted, the allowed roles are derived
     * from navigation.config.ts's allowedRoles for the current pathname —
     * that's the single static source of truth now; only pass this when a
     * page's access rules must genuinely differ from its nav entry.
     */
    requiredRoles?: UserRole[];
    fallbackUrl?: string;
}

/**
 * Component to protect routes based on permissions or roles
 * Redirects to fallback URL if user doesn't have required access
 */
export function ProtectedRoute({
    children,
    requiredPermission,
    requiredRoles,
    fallbackUrl = '/dashboard',
}: ProtectedRouteProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    // Live page permissions from Zustand store (populated by usePermissionHydration)
    const storePagePermissions = useAuthStore((s) => s.pagePermissions);
    // True once /api/auth/permissions has settled at least once this session
    const permissionsHydrated = useAuthStore((s) => s.permissionsHydrated);

    useEffect(() => {
        const checkAuthorization = () => {
            const storedUser = tokenStorage.getUser();
            const userRole = storedUser?.role as UserRole | null;

            if (!userRole) {
                // No user logged in, redirect to login
                router.push('/login');
                return;
            }

            const effectiveRole = computeEffectiveRole(userRole, branchStorage.getActiveBranch());

            // ── RBAC page permissions (new system) ──────────────────────────────
            // Primary source: Zustand store (live, loaded by usePermissionHydration).
            // Fallback: localStorage (sarvan-page-permissions) for cold page loads
            //           where the store hasn't been hydrated yet.
            let pagePermissions: PagePermissionsMap | null = storePagePermissions;
            if (pagePermissions === null) {
                try {
                    const raw = localStorage.getItem('sarvan-page-permissions');
                    if (raw) pagePermissions = JSON.parse(raw) as PagePermissionsMap;
                } catch { /* ignore parse errors */ }
            }

            // Explicit prop wins (transitional override); otherwise fall back to
            // navigation.config.ts's allowedRoles for this pathname — the single
            // static source of truth for "who can see this page by default".
            const resolvedRequiredRoles = requiredRoles ?? getAllowedRolesForHref(pathname);

            const decision = resolvePageAuthorization({
                userRole,
                effectiveRole,
                pathname,
                requiredPermission,
                requiredRoles: resolvedRequiredRoles,
                pagePermissions,
                permissionsHydrated,
            });

            if (decision === 'pending') {
                // RBAC permissions haven't finished loading yet and the legacy
                // static check alone doesn't allow this page — wait for the
                // fetch to settle instead of bouncing the user prematurely.
                // The effect re-runs once storePagePermissions/permissionsHydrated update.
                return;
            }

            if (decision === 'deny') {
                router.push(`${fallbackUrl}?error=insufficient_permissions`);
                setIsAuthorized(false);
                return;
            }

            setIsAuthorized(true);
        };

        checkAuthorization();
    }, [requiredPermission, requiredRoles, fallbackUrl, router, storePagePermissions, permissionsHydrated, pathname]);

    // Show loading state while checking authorization
    if (isAuthorized === null) {
        return <PageLoader label="Checking permissions..." fullScreen />;
    }

    // Don't render children if not authorized (will redirect)
    if (!isAuthorized) {
        return null;
    }

    return <>{children}</>;
}

/**
 * Higher-order component to wrap page components with permission checks
 * @param Component - The page component to protect
 * @param requiredPermission - Optional permission key required to access the page
 * @param requiredRoles - Optional array of roles required to access the page
 * @returns Protected component
 */
export function withPermission<P extends object>(
    Component: React.ComponentType<P>,
    requiredPermission?: keyof typeof PERMISSIONS,
    requiredRoles?: UserRole[]
) {
    return function ProtectedComponent(props: P) {
        return (
            <ProtectedRoute
                requiredPermission={requiredPermission}
                requiredRoles={requiredRoles}
            >
                <Component {...props} />
            </ProtectedRoute>
        );
    };
}
