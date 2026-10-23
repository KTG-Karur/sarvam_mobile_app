import { prisma } from '@/app/lib/db';

export type LoginPlatform = 'WEB' | 'MOBILE';
export type LoginBlockReason = 'INACTIVE' | 'EXITED' | 'WEB_DISABLED' | 'MOBILE_DISABLED';

export interface LoginAccessFields {
  isActive: boolean;
  dateOfExit?: Date | null;
  webLoginEnabled?: boolean | null;
  mobileLoginEnabled?: boolean | null;
}

export const LOGIN_BLOCK_MESSAGES: Record<LoginBlockReason, string> = {
  INACTIVE: 'Account is inactive. Please contact administrator.',
  EXITED: 'Employee has exited the organisation. Login is disabled.',
  WEB_DISABLED: 'Web login is disabled for this account. Please contact administrator.',
  MOBILE_DISABLED: 'Mobile login is disabled for this account. Please contact administrator.',
};

/** Inactive, soft-deleted (isActive=false) and HR-exited employees are blocked on both platforms. */
export function getLoginBlockReason(
  user: LoginAccessFields,
  platform: LoginPlatform
): LoginBlockReason | null {
  if (!user.isActive) return 'INACTIVE';
  if (user.dateOfExit && user.dateOfExit.getTime() <= Date.now()) return 'EXITED';
  if (platform === 'WEB' && user.webLoginEnabled === false) return 'WEB_DISABLED';
  if (platform === 'MOBILE' && user.mobileLoginEnabled === false) return 'MOBILE_DISABLED';
  return null;
}

// withAuth/withRole call this on every request; a short cache keeps it off the hot path.
// Toggles apply within CACHE_TTL_MS at most (and immediately on this instance via invalidate).
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; fields: LoginAccessFields | null }>();

export function invalidateLoginAccessCache(userId: string): void {
  cache.delete(userId);
}

export async function getRequestLoginBlockReason(
  userId: string,
  platform: LoginPlatform
): Promise<LoginBlockReason | null> {
  const hit = cache.get(userId);
  let fields: LoginAccessFields | null;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    fields = hit.fields;
  } else {
    fields = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, dateOfExit: true, webLoginEnabled: true, mobileLoginEnabled: true },
    });
    cache.set(userId, { at: Date.now(), fields });
  }
  if (!fields) return 'INACTIVE';
  return getLoginBlockReason(fields, platform);
}
