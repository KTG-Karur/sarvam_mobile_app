/**
 * Route Protection Utilities
 * Provides utilities for role-based access control in pages and components
 */

import { redirect } from 'next/navigation';
import type { UserRole } from '@/app/types';
import { tokenStorage } from './token-storage';

/**
 * Role-based route configuration
 * Maps route patterns to required roles
 */
export const roleBasedRoutes: Record<string, UserRole[]> = {
  '/dashboard/centers': ['BRANCH_MANAGER'],
  '/dashboard/centers/create-center': ['BRANCH_MANAGER'],
  '/dashboard/centers/transfer': ['BRANCH_MANAGER'],
};

/**
 * Check if a user has access to a route based on their role
 * @param pathname The pathname to check
 * @param userRole The user's role
 * @returns true if user has access, false otherwise
 */
export function hasRouteAccess(pathname: string, userRole: UserRole | null): boolean {
  if (!userRole) {
    return false;
  }

  // Find matching route restriction
  const restriction = Object.entries(roleBasedRoutes).find(([pattern]) =>
    pathname.startsWith(pattern)
  );

  if (!restriction) {
    // No restriction means accessible to all authenticated users
    return true;
  }

  const [, allowedRoles] = restriction;
  return allowedRoles.includes(userRole);
}

/**
 * Server-side function to protect a route based on user role
 * Redirects to dashboard if user doesn't have access
 * @param pathname The pathname to check
 */
export function protectRoute(pathname: string): void {
  const storedUser = tokenStorage.getUser();
  const userRole = (storedUser?.role as UserRole) || null;

  if (!hasRouteAccess(pathname, userRole)) {
    redirect('/dashboard?error=insufficient_permissions');
  }
}

/**
 * Get the current user's role from storage
 * @returns User role or null if not authenticated
 */
export function getCurrentUserRole(): UserRole | null {
  const storedUser = tokenStorage.getUser();
  return (storedUser?.role as UserRole) || null;
}

