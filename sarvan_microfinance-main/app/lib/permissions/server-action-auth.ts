import { cookies, headers } from 'next/headers';
import { verifyAccessToken, type JWTPayload } from '@/app/lib/auth';
import { ACTIVE_BRANCH_COOKIE_NAME } from '@/app/lib/branch-session';

/**
 * Resolves the authenticated user for a Next.js Server Action.
 *
 * Server Actions (functions marked 'use server') can be called directly from
 * client components with NO API route in front of them — withAuth/withRole
 * never run. Any Server Action that returns branch-scoped data MUST call this
 * (or getPermittedBranchIds built on top of it) itself; there is no other
 * enforcement point.
 *
 * Mirrors getAuthenticatedUser() in app/lib/api-utils.ts (branch header/cookie
 * merge for ADMIN/AREA_MANAGER), adapted for the Server Action context where
 * the request isn't directly available.
 */
export async function getServerActionUser(): Promise<JWTPayload | null> {
  try {
    const cookieStore = await cookies();
    const headerList = await headers();

    let token = cookieStore.get('accessToken')?.value ?? null;
    if (!token) {
      const authHeader = headerList.get('authorization');
      if (authHeader?.toLowerCase().startsWith('bearer ')) {
        token = authHeader.slice(7).trim();
      }
    }
    if (!token) return null;

    const payload = verifyAccessToken(token);

    if (payload.role === 'ADMIN' || payload.role === 'AREA_MANAGER') {
      const branchHeader = headerList.get('x-branch-id');
      const resolvedBranch = branchHeader || cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;
      if (resolvedBranch) {
        payload.branchId = resolvedBranch;
      }
    }

    return payload;
  } catch {
    return null;
  }
}
