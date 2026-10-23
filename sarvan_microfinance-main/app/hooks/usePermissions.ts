'use client';

import { useState, useEffect } from 'react';
import { tokenStorage } from '@/app/lib/token-storage';
import { hasPermission, hasAnyPermission, hasAllPermissions, PERMISSIONS } from '@/app/lib/permissions';
import type { UserRole } from '@/app/types';

/**
 * Hook to check user permissions on the client side
 * @returns Object with permission checking functions and user role
 */
export function usePermissions() {
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Get user role from token storage
        const storedUser = tokenStorage.getUser();
        if (storedUser?.role) {
            setUserRole(storedUser.role as UserRole);
        }
        setIsLoading(false);
    }, []);

    return {
        userRole,
        isLoading,
        /**
         * Check if the current user has a specific permission
         */
        can: (permission: keyof typeof PERMISSIONS) => hasPermission(userRole, permission),
        /**
         * Check if the current user has any of the specified permissions
         */
        canAny: (permissions: Array<keyof typeof PERMISSIONS>) => hasAnyPermission(userRole, permissions),
        /**
         * Check if the current user has all of the specified permissions
         */
        canAll: (permissions: Array<keyof typeof PERMISSIONS>) => hasAllPermissions(userRole, permissions),
        /**
         * Check if the current user has a specific role
         */
        hasRole: (role: UserRole) => userRole === role,
        /**
         * Check if the current user has any of the specified roles
         */
        hasAnyRole: (roles: UserRole[]) => userRole ? roles.includes(userRole) : false,
    };
}
