import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set. Please set it in your environment variables.');
}

if (!JWT_REFRESH_SECRET) {
  throw new Error('JWT_REFRESH_SECRET environment variable is not set. Please set it in your environment variables.');
}

// Type assertions after runtime checks
const JWT_SECRET_STRING: string = JWT_SECRET;
const JWT_REFRESH_SECRET_STRING: string = JWT_REFRESH_SECRET;

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  /** Human-readable RBAC role name (the custom Role record's name), when a caller attaches
   *  it. Not embedded in every access token — treat as optional; consumers must handle it
   *  being undefined. Mirrors the same optional field on the stored-user shapes in
   *  token-storage.ts / role-display.ts. */
  rbacRoleName?: string | null;
  branchId?: string; // Optional: active branch ID for access control
  /**
   * All branch IDs this user is assigned to (AREA_MANAGER via AreaManagerBranch,
   * every other role via UserBranchAssignment). Omitted entirely for a
   * single-branch user (the common case) — absence means "just `branchId`",
   * not "no access". Avoids an extra DB round-trip per request.
   */
  assignedBranchIds?: string[];
  /**
   * Marks a token as narrowly-scoped for a specific bootstrap flow (e.g. 'mpin_setup')
   * instead of a normal login session. Never set on regular access/refresh tokens.
   * getAuthenticatedUser() rejects any token carrying this — such tokens must be
   * verified manually by the one route they're meant for.
   */
  purpose?: string;
  /** Client the session was issued for. Set on mobile sessions ('MOBILE') so usage
   *  tracking can tell web from mobile; absent on older tokens (see
   *  user-activity-tracker.ts detectPlatformFromToken for the fallback). */
  platform?: 'WEB' | 'MOBILE';
}

/**
 * @param expiresIn Overrides the default '72h' expiry. Pass `null` to issue a token
 * that never expires (used for mobile login, which is device-bound instead of time-bound).
 */
export function generateAccessToken(payload: JWTPayload, expiresIn: string | null = '72h'): string {
  const options: jwt.SignOptions = expiresIn === null ? {} : { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, JWT_SECRET_STRING, options);
}

/**
 * @param expiresIn Overrides the default '7d' expiry. Pass `null` to issue a token
 * that never expires (used for mobile login, which is device-bound instead of time-bound).
 */
export function generateRefreshToken(payload: JWTPayload, expiresIn: string | null = '7d'): string {
  const options: jwt.SignOptions = expiresIn === null ? {} : { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, JWT_REFRESH_SECRET_STRING, options);
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET_STRING) as JWTPayload;
}

export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET_STRING) as JWTPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

