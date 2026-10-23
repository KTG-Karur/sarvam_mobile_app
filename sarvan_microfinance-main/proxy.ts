// ============================================================
// CORS-ONLY PROXY — project root
// proxy.ts  (Next.js 16 renamed the "middleware" file convention to "proxy")
//
// Next.js only recognizes proxy.ts at the project root (or src/) as its
// special request-interception file. app/proxy.ts — despite its name and
// doc comments — lives one level too deep and has never actually executed
// (confirmed: no CORS/auth headers from it ever appear on a response, and
// Next's own default OPTIONS handler answers preflight instead of it).
//
// This file is intentionally CORS-only. It must NOT add auth/redirect
// logic: the web app currently relies entirely on route-level checks
// (app/lib/permissions/guards.ts) and client-side redirects for
// protection, so adding auth here would silently change that behavior
// app-wide rather than just fixing CORS.
//
// Why CORS is needed at all: browser-based clients (Flutter Web dev
// build, any future SPA) send a preflight OPTIONS request before a
// cross-origin call carrying an Authorization header. Without explicit
// CORS headers on both the preflight and the real response, the browser
// blocks the request — visible to fetch()/dio as an opaque network
// failure even though curl/node against the same route succeeds.
// ============================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): HeadersInit {
  const allowOrigin =
    ALLOWED_ORIGINS.includes('*')
      ? '*'
      : origin && ALLOWED_ORIGINS.includes(origin)
        ? origin
        : (ALLOWED_ORIGINS[0] ?? '*');

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Branch-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    res.headers.set(key, value);
  }
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
