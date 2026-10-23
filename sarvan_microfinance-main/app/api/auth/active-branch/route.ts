import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import {
  errorResponse,
  getAuthToken,
  handleCorsPreflight,
  successResponse,
} from '@/app/lib/api-utils';
import { verifyAccessToken } from '@/app/lib/auth';
import {
  ACTIVE_BRANCH_COOKIE_NAME,
  getActiveBranchCookieOptions,
} from '@/app/lib/branch-session';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { isUserAssignedToBranch } from '@/app/lib/user-branch-assignments';

const bodySchema = z.object({
  branchId: z.string().min(1, 'branchId is required'),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/auth/active-branch
 * Persists selected branch for the caller in an httpOnly cookie.
 *
 * Security hardening (Phase 2.2), generalized to any multi-branch user:
 *   - ADMIN: any active branch is allowed
 *   - AREA_MANAGER: only branches assigned via AreaManagerBranch junction table
 *   - Any other role: only branches assigned via UserBranchAssignment (or their
 *     own primary branch — a trivial no-op switch), so a single-branch user who
 *     was never explicitly multi-branch-assigned cannot switch away from home.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errorResponse('Authentication required', 401);
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return errorResponse('Invalid or expired token', 401);
    }

    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(parsed.error.errors[0]?.message || 'Invalid body', 400);
    }

    const { branchId } = parsed.data;

    // Verify the branch exists and is active
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true, name: true, code: true },
    });

    if (!branch) {
      return errorResponse('Branch not found or inactive', 404);
    }

    // ─── SECURITY: Area Manager branch ownership check ──────────────────────────
    // AM can only switch to branches explicitly assigned to them in the junction table.
    if (payload.role === 'AREA_MANAGER') {
      const isAssigned = await isAmAssignedToBranch(payload.userId, branchId);
      if (!isAssigned) {
        return errorResponse(
          'This branch is not assigned to your Area Manager account',
          403
        );
      }
    } else if (payload.role !== 'ADMIN') {
      // Any other role: allow only their own primary branch (a no-op switch)
      // or a branch explicitly assigned via UserBranchAssignment.
      const isOwnBranch = payload.branchId === branchId;
      const isAssigned = isOwnBranch || (await isUserAssignedToBranch(payload.userId, branchId));
      if (!isAssigned) {
        return errorResponse('This branch is not assigned to your account', 403);
      }
    }
    // ────────────────────────────────────────────────────────────────────────────

    const res = successResponse({ branchId: branch.id }, 'Active branch updated');
    res.cookies.set(ACTIVE_BRANCH_COOKIE_NAME, branch.id, getActiveBranchCookieOptions());
    return res;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

/**
 * DELETE /api/auth/active-branch
 * Clears the active-branch override, returning the session to its unscoped/home
 * default (e.g. after an ADMIN/AREA_MANAGER temporarily switches branch to enroll
 * a client into another branch, then wants to go back to no override).
 */
export async function DELETE(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errorResponse('Authentication required', 401);
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return errorResponse('Invalid or expired token', 401);
    }

    if (payload.role !== 'ADMIN' && payload.role !== 'AREA_MANAGER') {
      return errorResponse('Insufficient permissions', 403);
    }

    const res = successResponse({ cleared: true }, 'Active branch cleared');
    res.cookies.delete(ACTIVE_BRANCH_COOKIE_NAME);
    return res;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}
