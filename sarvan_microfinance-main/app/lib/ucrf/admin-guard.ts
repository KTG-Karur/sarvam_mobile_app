import type { NextRequest, NextResponse } from 'next/server';
import { errorResponse, withRole } from '@/app/lib/api-utils';
import type { JWTPayload } from '@/app/lib/auth';

/**
 * Hard gate for every UCRF API: the authenticated role must be exactly `ADMIN`.
 *
 * `withRole(['ADMIN'], …)` already rejects other roles with 403 on POST/PUT, but it deliberately
 * lets Head-Office users through on GET (api-utils.ts), so the literal role is re-checked here —
 * custom RBAC roles, ADMIN_NON_HO_BRANCH_SWITCH, AREA_MANAGER, BRANCH_MANAGER and FDO never pass.
 */
export function isUcrfAdmin(user: Pick<JWTPayload, 'role'>): boolean {
    return user.role === 'ADMIN';
}

export function withUcrfAdmin(handler: (request: NextRequest, user: JWTPayload) => Promise<NextResponse>) {
    return withRole(['ADMIN'], async (request, user) => {
        if (!isUcrfAdmin(user)) return errorResponse('Only administrators can access UCRF exports', 403);
        return handler(request, user);
    });
}
