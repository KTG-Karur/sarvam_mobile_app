import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, JWTPayload } from './auth';
import { ACTIVE_BRANCH_COOKIE_NAME } from '@/app/lib/branch-session';
import { userMatchesAllowedApiRoles } from '@/app/lib/user-role-access';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { ApiResponse } from '@/app/types';
import { detectPlatformFromToken, getClientIp, trackRequestActivity } from '@/app/lib/services/user-activity-tracker';
import { getRequestLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { recordApiCall } from '@/app/lib/services/api-traffic-tracker';

export { resolveOperationalBranchId } from '@/app/lib/user-role-access';

/**
 * Get CORS headers based on environment configuration
 * Allows mobile apps and other external clients to access the API
 */
function getCorsHeaders(): Record<string, string> {
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  const origin = allowedOrigins ? allowedOrigins.split(',')[0] : '*'; // Use first origin or allow all

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

export const corsHeaders = getCorsHeaders();

/**
 * Extract authentication token from request
 * Supports both Authorization header (for mobile) and cookies (for web)
 */
export function getAuthToken(request: NextRequest): string | null {
  // First, try Authorization header (for mobile apps)
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Fallback to cookie (for web apps)
  const cookieToken = request.cookies.get('accessToken')?.value;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

/**
 * Verify authentication token and return payload
 * Throws error if token is invalid
 */
export function getAuthenticatedUser(request: NextRequest): JWTPayload {
  const token = getAuthToken(request);

  if (!token) {
    throw new Error('Authentication required');
  }

  try {
    const user = verifyAccessToken(token);

    // Purpose-scoped tokens (e.g. the mobile MPIN setup ticket) are narrowly issued for
    // one specific bootstrap route and must never grant access to any normal endpoint.
    // Regular access/refresh tokens never carry this claim, so this is a no-op for them.
    if (user.purpose) {
      throw new Error('Invalid or expired token');
    }

    // Branch context: X-Branch-Id (API clients) > httpOnly active-branch cookie (web) > JWT.
    // Any role may now be assigned to multiple branches (AREA_MANAGER via
    // AreaManagerBranch, everyone else via UserBranchAssignment) — the primary
    // gate for switching is POST /api/auth/active-branch, which validates the
    // target branch against the user's assignment before ever setting the
    // cookie. This is a defense-in-depth check using the JWT-embedded
    // assignedBranchIds so we don't need a DB round trip on every request.
    {
      const branchHeader = request.headers.get('x-branch-id');
      const resolvedBranch =
        branchHeader || request.cookies.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;

      if (resolvedBranch && resolvedBranch !== user.branchId) {
        if (user.role === 'ADMIN') {
          user.branchId = resolvedBranch;
        } else if (user.assignedBranchIds && user.assignedBranchIds.length > 0) {
          if (!user.assignedBranchIds.includes(resolvedBranch)) {
            throw new Error('Branch not assigned to this user');
          }
          user.branchId = resolvedBranch;
        }
        // Single-branch user (no assignedBranchIds claim on the token) -- header/
        // cookie override ignored; branchId stays pinned to their primary branch,
        // exactly as before.
      }
    }

    // Daily usage tracking for the User Login Activity report (throttled, fire-and-forget).
    const platform = detectPlatformFromToken(user as JWTPayload & { exp?: number });
    trackRequestActivity({
      userId: user.userId,
      platform,
      branchId: user.branchId ?? null,
      ipAddress: getClientIp(request.headers),
    });
    recordApiCall(platform, request.nextUrl?.pathname ?? '');

    return user;
  } catch {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse<T>(
  data: ApiResponse<T>,
  status: number = 200,
  additionalHeaders?: Record<string, string>
): NextResponse {
  const response = NextResponse.json<ApiResponse<T>>(data, { status });

  // Add CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Add any additional headers
  if (additionalHeaders) {
    Object.entries(additionalHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  return response;
}

/**
 * Create an error response with CORS headers
 */
export function errorResponse(
  error: string,
  status: number = 400,
  data?: unknown
): NextResponse {
  return jsonResponse(
    { success: false, error, ...(data !== undefined && { data }) },
    status
  );
}

/**
 * Create a success response with CORS headers
 */
export function successResponse<T>(
  data: T,
  message?: string,
  status: number = 200
): NextResponse {
  return jsonResponse(
    { success: true, data, ...(message && { message }) },
    status
  );
}

/**
 * Handle OPTIONS request for CORS preflight
 */
export function handleCorsPreflight(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Rejects tokens of employees who are inactive, deleted, exited, or whose login for the
 * token's platform was switched off (Employees > Login Access). Returns an error response or null.
 */
async function rejectIfLoginBlocked(user: JWTPayload): Promise<NextResponse | null> {
  const platform = detectPlatformFromToken(user as JWTPayload & { exp?: number });
  const reason = await getRequestLoginBlockReason(user.userId, platform);
  return reason ? errorResponse(LOGIN_BLOCK_MESSAGES[reason], 401) : null;
}

/**
 * Middleware wrapper for protected API routes
 * Verifies authentication and extracts user info
 */
export function withAuth<T>(
  handler: (request: NextRequest, user: JWTPayload) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = getAuthenticatedUser(request);
      const blocked = await rejectIfLoginBlocked(user);
      if (blocked) return blocked;
      return await handler(request, user);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : 'Authentication failed',
        401
      );
    }
  };
}

/**
 * Middleware wrapper for role-based access control
 *
 * Fallback for GET requests: a route's `allowedRoles` list is a fixed set of
 * the 5 built-in role codes (ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER,
 * DIVISION_MANAGER) — it has no way to know about a custom dynamic-RBAC role
 * (e.g. an admin-created "Zonal Head" role, whose `user.role` is an
 * auto-generated code like "ZH" that no route lists). Rather than requiring
 * every report/list route to be hand-edited for every custom role an admin
 * ever creates, any user based at Head Office is allowed through on
 * read-only (GET) requests — the frontend already gates which pages such a
 * role can navigate to via its RBAC page permissions (pagePermissions[...].view),
 * so by the time a GET request reaches here the user was already cleared to
 * view this data; branch/center scoping (getPermittedBranchIds) then still
 * limits *which* branches' data they see. Mutating requests (POST/PUT/PATCH/
 * DELETE) are never relaxed this way — those still require a literal
 * allowedRoles match (or ADMIN).
 */
export function withRole(
  allowedRoles: string[],
  handler: (request: NextRequest, user: JWTPayload) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = getAuthenticatedUser(request);
      const blocked = await rejectIfLoginBlocked(user);
      if (blocked) return blocked;

      if (!(await userMatchesAllowedApiRoles(user, allowedRoles))) {
        const isReadOnlyRequest = request.method === 'GET';
        const isHoBasedUser = user.branchId ? await isHeadOfficeBranch(user.branchId) : false;

        if (!isReadOnlyRequest || !isHoBasedUser) {
          return errorResponse('Insufficient permissions', 403);
        }
      }

      return await handler(request, user);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : 'Authentication failed',
        401
      );
    }
  };
}
