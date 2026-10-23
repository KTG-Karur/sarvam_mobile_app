import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

const ROLE_PARAM_TO_PRISMA: Record<string, string> = {
  AM: 'AREA_MANAGER',
  BM: 'BRANCH_MANAGER',
  FDO: 'FDO',
};

const ALLOWED_LEVELS: Record<string, string[]> = {
  BRANCH_MANAGER: ['FDO'],
  AREA_MANAGER: ['BM', 'FDO'],
  DIVISION_MANAGER: ['AM', 'BM', 'FDO'],
  ADMIN: ['AM', 'BM', 'FDO'],
};

type UserRow = { id: string; firstName: string; lastName: string };

async function getSubordinatesOfUser(
  userRole: string,
  userBranchId: string | null,
  userId: string,
  levelParam: string,
  prismaRole: string,
): Promise<UserRow[]> {
  if (userRole === 'BRANCH_MANAGER') {
    if (!userBranchId) return [];
    return prisma.user.findMany({
      where: { branchId: userBranchId, role: 'FDO', isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });
  }

  if (userRole === 'AREA_MANAGER') {
    const amBranches = await prisma.areaManagerBranch.findMany({
      where: { userId },
      select: { branchId: true },
    });
    const branchIds = amBranches.map((ab) => ab.branchId);
    if (levelParam === 'BM') {
      return prisma.user.findMany({
        where: { branchId: { in: branchIds }, role: 'BRANCH_MANAGER', isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      });
    }
    return prisma.user.findMany({
      where: { branchId: { in: branchIds }, role: 'FDO', isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });
  }

  if (userRole === 'DIVISION_MANAGER') {
    const divBranches = await prisma.branch.findMany({
      where: { areas: { some: { division: { managers: { some: { id: userId } } } } } },
      select: { id: true },
    });
    const branchIds = divBranches.map((b) => b.id);
    if (levelParam === 'AM') {
      const amAssignments = await prisma.areaManagerBranch.findMany({
        where: { branchId: { in: branchIds } },
        distinct: ['userId'],
        select: { user: { select: { id: true, firstName: true, lastName: true } } },
      });
      return amAssignments
        .map((a) => a.user)
        .filter((u): u is UserRow => Boolean(u))
        .sort((a, b) => a.firstName.localeCompare(b.firstName));
    }
    return prisma.user.findMany({
      where: { branchId: { in: branchIds }, role: prismaRole, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });
  }

  if (userRole === 'ADMIN') {
    return prisma.user.findMany({
      where: { role: prismaRole, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });
  }

  return [];
}

export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (!user.userId) return errorResponse('User ID not found', 401);

      const userData = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { id: true, role: true, branchId: true },
      });
      if (!userData) return errorResponse('User not found', 404);

      const levelParam = req.nextUrl.searchParams.get('role');
      if (!levelParam) return errorResponse('role query param required (AM|BM|FDO)', 400);

      const prismaRole = ROLE_PARAM_TO_PRISMA[levelParam];
      if (!prismaRole) return errorResponse('Invalid role level', 400);

      const fromUserIdParam = req.nextUrl.searchParams.get('fromUserId');

      // ── fromUserId mode: fetch subordinates of a specific user the requester can view ──
      if (fromUserIdParam) {
        const fromUser = await prisma.user.findUnique({
          where: { id: fromUserIdParam },
          select: { id: true, role: true, branchId: true },
        });
        if (!fromUser) return errorResponse('fromUser not found', 404);

        // Auth: verify fromUser is a subordinate of the current user
        let authorized = false;
        if (userData.role === 'ADMIN') {
          authorized = true;
        } else if (userData.role === 'BRANCH_MANAGER') {
          authorized = fromUser.branchId === userData.branchId;
        } else if (userData.role === 'AREA_MANAGER') {
          const amBranches = await prisma.areaManagerBranch.findMany({
            where: { userId: userData.id },
            select: { branchId: true },
          });
          const branchIds = new Set(amBranches.map((ab) => ab.branchId));
          if (fromUser.role === 'AREA_MANAGER') {
            // Another AM is not a subordinate of this AM
            authorized = false;
          } else if (fromUser.branchId) {
            authorized = branchIds.has(fromUser.branchId);
          } else {
            // fromUser might be an AM — check branch overlap via areaManagerBranch
            const fromAmBranches = await prisma.areaManagerBranch.findMany({
              where: { userId: fromUser.id },
              select: { branchId: true },
            });
            authorized = fromAmBranches.some((ab) => branchIds.has(ab.branchId));
          }
        } else if (userData.role === 'DIVISION_MANAGER') {
          const divBranches = await prisma.branch.findMany({
            where: { areas: { some: { division: { managers: { some: { id: userData.id } } } } } },
            select: { id: true },
          });
          const branchIds = new Set(divBranches.map((b) => b.id));
          if (fromUser.branchId) {
            authorized = branchIds.has(fromUser.branchId);
          } else {
            // fromUser is likely an AM — check branch overlap
            const fromAmBranches = await prisma.areaManagerBranch.findMany({
              where: { userId: fromUser.id },
              select: { branchId: true },
            });
            authorized = fromAmBranches.some((ab) => branchIds.has(ab.branchId));
          }
        }

        if (!authorized) return errorResponse('Not authorized to view this user\'s subordinates', 403);

        // Verify the requested level is valid for fromUser's role
        const fromAllowed = ALLOWED_LEVELS[fromUser.role] ?? [];
        if (!fromAllowed.includes(levelParam)) {
          return errorResponse(`${fromUser.role} has no ${levelParam} subordinates`, 400);
        }

        const users = await getSubordinatesOfUser(
          fromUser.role,
          fromUser.branchId,
          fromUser.id,
          levelParam,
          prismaRole,
        );

        const formatted = users.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          role: levelParam,
        }));
        return successResponse({ users: formatted }, 'Subordinates retrieved');
      }

      // ── Standard mode: fetch subordinates of the current user ──
      const allowed = ALLOWED_LEVELS[userData.role] ?? [];
      if (!allowed.includes(levelParam)) {
        return errorResponse(`${userData.role} cannot list ${levelParam} subordinates`, 403);
      }

      const users = await getSubordinatesOfUser(
        userData.role,
        userData.branchId,
        userData.id,
        levelParam,
        prismaRole,
      );

      const formatted = users.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        role: levelParam,
      }));

      return successResponse({ users: formatted }, 'Subordinates retrieved');
    } catch (error) {
      console.error('Error fetching subordinates:', error);
      return errorResponse('Failed to fetch subordinates', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
