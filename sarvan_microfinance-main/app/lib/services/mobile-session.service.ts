import { getLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { prisma } from '@/app/lib/db';
import { generateAccessToken, generateRefreshToken } from '@/app/lib/auth';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getUserAssignedBranchIds } from '@/app/lib/user-branch-assignments';
import { resolveOrgScopedHomeBranchId } from '@/app/lib/permissions/org-scope';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { AuthResponse } from '@/app/types';
import { recordUserLogin } from '@/app/lib/services/user-activity-tracker';

export type MobileSessionResult =
  | { ok: true; authData: AuthResponse }
  | { ok: false; reason: 'NOT_FOUND' | 'INACTIVE' | 'NO_BRANCH' };

/**
 * Issues the real, non-expiring mobile access/refresh token pair once every login
 * factor (credentials, device binding, MPIN) has already passed. Shared by
 * POST /api/mobile/mpin/verify (normal login completion) and POST /api/mobile/mpin/setup
 * (first-time MPIN creation completes login in the same call) so token issuance,
 * branch resolution, and the mpinHash/attempt-field response exclusion exist in exactly
 * one place.
 */
export async function issueMobileSession(userId: string): Promise<MobileSessionResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      branch: {
        select: { id: true, name: true, code: true, address: true },
      },
      areaManagerBranches: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 1,
        include: {
          branch: {
            select: { id: true, name: true, code: true, address: true },
          },
        },
      },
      userRoles: {
        where: { isActive: true },
        select: {
          role: { select: { slug: true, name: true, isSubAdmin: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!user) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (getLoginBlockReason(user, 'MOBILE')) {
    return { ok: false, reason: 'INACTIVE' };
  }

  // ─── Resolve default branch for this login session ──────────────────────────
  let defaultBranchForLogin: {
    id: string;
    name: string;
    code: string;
    address: string | null;
  } | null = null;

  if (user.role === 'ADMIN') {
    defaultBranchForLogin = await prisma.branch.findFirst({
      where: {
        OR: [
          { code: 'HO' },
          { name: { equals: 'Head Office', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, code: true, address: true },
    });
  } else if (user.role === 'AREA_MANAGER') {
    const primaryAssignment = user.areaManagerBranches[0];
    defaultBranchForLogin = primaryAssignment?.branch ?? null;
  } else {
    defaultBranchForLogin = user.branch;
    // Region / Division / Area coverage (UserOrgScope): start in a covered branch
    // rather than Head Office, which would read as "unrestricted".
    const scopedHomeId = await resolveOrgScopedHomeBranchId(user.id, defaultBranchForLogin?.id ?? null);
    if (scopedHomeId && scopedHomeId !== defaultBranchForLogin?.id) {
      defaultBranchForLogin = await prisma.branch.findUnique({
        where: { id: scopedHomeId },
        select: { id: true, name: true, code: true, address: true },
      });
    }
  }

  if (!defaultBranchForLogin && user.role !== 'ADMIN') {
    return { ok: false, reason: 'NO_BRANCH' };
  }
  // ────────────────────────────────────────────────────────────────────────────

  const assignedBranchIds =
    user.role === 'AREA_MANAGER'
      ? await getAreaManagerBranchIds(user.id)
      : await getUserAssignedBranchIds(user.id);

  const payload = {
    userId: user.id,
    email: user.email ?? '',
    role: user.role,
    branchId: defaultBranchForLogin?.id || undefined,
    ...(assignedBranchIds && assignedBranchIds.length > 0 ? { assignedBranchIds } : {}),
    platform: 'MOBILE' as const,
  };

  // Mobile tokens never expire — device binding + MPIN are the security boundary
  // instead of a time-based one. Web login/refresh are untouched and keep their 72h/7d expiry.
  const accessToken = generateAccessToken(payload, null);
  const refreshToken = generateRefreshToken(payload, null);

  // expiresAt has no nullable option in the schema, so a far-future date stands in
  // for "never" to match the non-expiring JWT above.
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date('9999-12-31T23:59:59.000Z'),
    },
  });

  recordUserLogin({ userId: user.id, platform: 'MOBILE', branchId: defaultBranchForLogin?.id ?? null });

  // mpinHash/attempt-tracking fields must never leave this server.
  const {
    password: _password,
    mpinHash: _mpinHash,
    mpinFailedAttempts: _mpinFailedAttempts,
    mpinLastFailedAt: _mpinLastFailedAt,
    branch,
    areaManagerBranches,
    userRoles,
    ...userWithoutPassword
  } = user;
  const rbacRoleSlug = userRoles[0]?.role?.slug ?? null;
  const rbacRoleName = userRoles[0]?.role?.name ?? null;
  const isSubAdmin = userRoles[0]?.role?.isSubAdmin ?? false;
  const defaultBranchIsHeadOffice = defaultBranchForLogin
    ? await isHeadOfficeBranch(defaultBranchForLogin.id)
    : false;

  const authData: AuthResponse = {
    user: {
      ...userWithoutPassword,
      email: userWithoutPassword.email ?? '',
      assignedBranchIds,
      rbacRoleSlug,
      rbacRoleName,
      isSubAdmin,
    },
    accessToken,
    refreshToken,
    branch: defaultBranchForLogin
      ? { ...defaultBranchForLogin, isHeadOffice: defaultBranchIsHeadOffice }
      : undefined,
  };

  return { ok: true, authData };
}
