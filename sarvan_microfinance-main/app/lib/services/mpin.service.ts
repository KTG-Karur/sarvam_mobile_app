import { prisma } from '@/app/lib/db';
import { comparePassword } from '@/app/lib/auth';

export const MPIN_MAX_ATTEMPTS = 3;
export const MPIN_RETRY_SECONDS = 60;

/**
 * Pure read-only check — does not touch the DB. Used both as a pre-check (so a locked
 * employee never gets their MPIN compared at all) and internally by verifyEmployeeMpin.
 */
export function getMpinLockoutStatus(
  failedAttempts: number,
  lastFailedAt: Date | null
): { locked: boolean; retryAfterSeconds: number } {
  if (failedAttempts >= MPIN_MAX_ATTEMPTS && lastFailedAt) {
    const elapsedSeconds = (Date.now() - lastFailedAt.getTime()) / 1000;
    if (elapsedSeconds < MPIN_RETRY_SECONDS) {
      return { locked: true, retryAfterSeconds: Math.ceil(MPIN_RETRY_SECONDS - elapsedSeconds) };
    }
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export type MpinVerifyOutcome =
  | { status: 'success' }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'invalid'; attempts: number }
  | { status: 'invalid_limit'; attempts: number; retryAfterSeconds: number };

/**
 * Compares a submitted MPIN against the stored hash, persisting the resulting
 * attempt-counter state. Shared by the inline login gate and the standalone
 * /api/mobile/mpin/verify route so the lockout logic exists in exactly one place.
 *
 * Reset-on-expiry is lazy: an expired lockout window is never eagerly written back
 * to 0/null just from being observed here — the DB row may still show a stale
 * mpinFailedAttempts count between window-expiry and the next actual attempt. The
 * next attempt's baseline is computed as 0 regardless, so this doesn't affect
 * correctness, only what a raw DB read shows in between.
 */
export async function verifyEmployeeMpin(
  userId: string,
  mpinHash: string,
  failedAttempts: number,
  lastFailedAt: Date | null,
  submittedMpin: string
): Promise<MpinVerifyOutcome> {
  const lockout = getMpinLockoutStatus(failedAttempts, lastFailedAt);
  if (lockout.locked) {
    return { status: 'locked', retryAfterSeconds: lockout.retryAfterSeconds };
  }

  // Window expired (or never locked) — baseline for this attempt starts fresh.
  const baseline = failedAttempts >= MPIN_MAX_ATTEMPTS ? 0 : failedAttempts;

  const isMatch = await comparePassword(submittedMpin, mpinHash);

  if (isMatch) {
    await prisma.user.update({
      where: { id: userId },
      data: { mpinFailedAttempts: 0, mpinLastFailedAt: null },
    });
    return { status: 'success' };
  }

  const newAttempts = baseline + 1;
  await prisma.user.update({
    where: { id: userId },
    data: { mpinFailedAttempts: newAttempts, mpinLastFailedAt: new Date() },
  });

  return newAttempts >= MPIN_MAX_ATTEMPTS
    ? { status: 'invalid_limit', attempts: newAttempts, retryAfterSeconds: MPIN_RETRY_SECONDS }
    : { status: 'invalid', attempts: newAttempts };
}
