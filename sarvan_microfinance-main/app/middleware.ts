// ============================================================
// MIDDLEWARE — Lightweight Edge Middleware
// app/middleware.ts
//
// NEW PHILOSOPHY:
//   - NO hardcoded role arrays
//   - NO route permission checks
//   - ONLY validates JWT is present and not expired
//   - Actual permission checks happen in API handlers via guards.ts
//   - Page-level protection: client-side via usePermission hook
//
// Why this is correct:
//   - Edge middleware cannot query database (no Prisma in Edge)
//   - Permission checks require DB lookup — wrong layer for Edge
//   - JWT validation is fast and stateless — correct for Edge
//   - API handlers re-validate fully via requirePermission()
// ============================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAccessTokenEdge } from './lib/auth/jwt';

// ─────────────────────────────────────────────
// PUBLIC ROUTES — No auth required
// ─────────────────────────────────────────────
const PUBLIC_ROUTES = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',
]);

// Static file prefixes — never intercept
const SKIP_PREFIXES = [
  '/_next/',
  '/favicon',
  '/images/',
  '/icons/',
  '/fonts/',
  '/public/',
];

// Unauthenticated app routes, matched by prefix rather than exact path (unlike
// PUBLIC_ROUTES) because each carries a dynamic [token] segment. The joinee-
// facing onboarding page (no login — see app/apply/onboarding/[token]) and its
// API (app/api/public/hr-onboarding/[token]) are deliberately excluded from
// JWT validation here; the token itself (checked server-side, per request) is
// what gates access, not a session.
const PUBLIC_PREFIXES = [
  '/apply/',
  '/api/public/',
];

// ─────────────────────────────────────────────
// MIDDLEWARE FUNCTION
// ─────────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files
  if (SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // Allow public routes
  if (PUBLIC_ROUTES.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // ── JWT Validation ──
  const token =
    request.cookies.get('accessToken')?.value ||
    request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return redirectToLogin(request);
  }

  const payload = await verifyAccessTokenEdge(token);

  if (!payload) {
    // Token expired or invalid — let client refresh
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' },
        { status: 401 }
      );
    }
    return redirectToLogin(request);
  }

  // ── Forward user context in headers for server components ──
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', payload.userId);
  requestHeaders.set('x-branch-id', payload.branchId ?? '');
  requestHeaders.set('x-perm-version', String(payload.permVersion ?? 1));
  requestHeaders.set('x-is-head-office', String(payload.isHeadOffice ?? false));

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

// ─────────────────────────────────────────────
// REDIRECT TO LOGIN
// ─────────────────────────────────────────────
function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('returnUrl', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

// ─────────────────────────────────────────────
// MATCHER — Which routes to run middleware on
// ─────────────────────────────────────────────
export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico|images|icons|fonts).*)',
  ],
};
