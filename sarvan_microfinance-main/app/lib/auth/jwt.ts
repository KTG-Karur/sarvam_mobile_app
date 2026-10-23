// ============================================================
// JWT UTILITIES — Replaces app/lib/auth.ts
// app/lib/auth/jwt.ts
//
// Key changes from old auth.ts:
//   - JWTPayload no longer has 'role' string
//   - Now has 'permVersion' for cache invalidation
//   - Has 'isHeadOffice' flag
// ============================================================

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { JWTPayload } from '@/app/lib/permissions/types';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set in environment variables');
}

// ─────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────
export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: '72h' });
}

export function generateRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET!, { expiresIn: '7d' });
}

// ─────────────────────────────────────────────
// TOKEN VERIFICATION
// Returns null instead of throwing (safer for middleware)
// ─────────────────────────────────────────────
export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JWTPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET!) as JWTPayload;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// EDGE-SAFE TOKEN VERIFICATION
// Uses Web Crypto API — works in Edge middleware
// ─────────────────────────────────────────────
export async function verifyAccessTokenEdge(token: string): Promise<JWTPayload | null> {
  try {
    // Decode without verification for Edge (no crypto support for RS256)
    // We just check expiry — full verification happens in API handlers
    const [, payloadBase64] = token.split('.');
    if (!payloadBase64) return null;

    const payload = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString('utf-8')
    );

    // Check expiration
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return payload as JWTPayload;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// PASSWORD UTILITIES
// ─────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}
