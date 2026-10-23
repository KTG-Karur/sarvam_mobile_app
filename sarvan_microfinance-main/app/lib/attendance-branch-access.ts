import type { NextRequest } from 'next/server';
import { verifyAccessToken } from '@/app/lib/auth';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import type { UserContext } from '@/app/lib/permissions/types';

/** Branches the caller may write attendance schedule config for; `null` = unrestricted.
 * Uses the same rule as the register/read routes (getPermittedBranchIds). */
export async function getWritableBranchIds(request: NextRequest, ctx: UserContext): Promise<string[] | null> {
  const token =
    request.cookies.get('accessToken')?.value ||
    request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyAccessToken(token) : null;
  return getPermittedBranchIds({
    userId: ctx.userId,
    role: payload?.role ?? '',
    branchId: ctx.branchId,
    assignedBranchIds: payload?.assignedBranchIds,
  });
}
