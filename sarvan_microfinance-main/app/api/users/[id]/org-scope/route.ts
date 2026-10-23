import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';
import { getOrgScope, invalidateOrgScopeCache } from '@/app/lib/permissions/org-scope';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

/**
 * Head Office / Region / Division / Area / Branch coverage for a user (e.g. a
 * Quality Checker) — branch assignment one level up the hierarchy.
 * See app/lib/permissions/org-scope.ts. **Admin only.**
 *
 * Storage is split so "Manage Branches" and "Assign Region / Area" always show
 * the same thing:
 *   - Head Office (all branches) / Region / Division / Area → UserOrgScope
 *   - single Branches → UserBranchAssignment (the Manage Branches list). A Head
 *     Office branch assignment there is only the user's home branch — it is
 *     never shown or counted as coverage, and is left untouched on save.
 *
 * GET  /api/users/{id}/org-scope → org hierarchy + the user's current coverage
 * PUT  /api/users/{id}/org-scope → replace the user's full coverage
 */

const scopeItemSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('HEAD_OFFICE') }),
  z.object({ level: z.enum(['REGION', 'DIVISION', 'AREA', 'BRANCH']), id: z.string().min(1) }),
]);

const putSchema = z.object({
  scopes: z.array(scopeItemSchema).max(500),
});

type ScopeItem = z.infer<typeof scopeItemSchema>;
type IdLevel = 'REGION' | 'DIVISION' | 'AREA' | 'BRANCH';

async function loadHierarchy() {
  const [regions, branches] = await Promise.all([
    prisma.region.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        divisions: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            code: true,
            areas: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
                code: true,
                branches: {
                  where: { isActive: true },
                  orderBy: { name: 'asc' },
                  select: { id: true, name: true, code: true },
                },
              },
            },
          },
        },
      },
    }),
    // Flat list too, so branches not yet linked to any Area are still assignable.
    // (Head Office itself is excluded below; it has its own Head Office option.)
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true },
    }),
  ]);
  const notHeadOffice = await Promise.all(branches.map(async (b) => !(await isHeadOfficeBranch(b.id))));
  return { regions, branches: branches.filter((_, i) => notHeadOffice[i]) };
}

/** Current coverage: Region/Division/Area rows + assigned branches (Head Office as its own flag). */
async function loadCoverage(userId: string): Promise<{ scopes: ScopeItem[]; headOffice: boolean }> {
  const [rows, assignments] = await Promise.all([
    prisma.userOrgScope.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { level: true, regionId: true, divisionId: true, areaId: true },
    }),
    prisma.userBranchAssignment.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { branchId: true },
    }),
  ]);
  const headOffice = rows.some((r) => r.level === 'HEAD_OFFICE');
  const scopes: ScopeItem[] = rows
    .filter((r) => r.level !== 'HEAD_OFFICE')
    .map((r) => ({
      level: r.level as 'REGION' | 'DIVISION' | 'AREA',
      id: (r.regionId ?? r.divisionId ?? r.areaId)!,
    }));
  for (const a of assignments) {
    // A Head Office branch assignment is the user's home branch, not coverage.
    if (!(await isHeadOfficeBranch(a.branchId))) scopes.push({ level: 'BRANCH', id: a.branchId });
  }
  if (headOffice) scopes.unshift({ level: 'HEAD_OFFICE' });
  return { scopes, headOffice };
}

/** Branches covered, or null for Head Office (= every branch). */
async function coveredBranchCount(userId: string, headOffice: boolean): Promise<number | null> {
  if (headOffice) return null;
  const scope = await getOrgScope(userId);
  if (scope) return scope.headOffice ? null : scope.branchIds.length;
  return prisma.userBranchAssignment.count({ where: { userId } });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async () => {
    try {
      const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) return errorResponse('User not found', 404);

      const [hierarchy, coverage] = await Promise.all([loadHierarchy(), loadCoverage(id)]);
      return successResponse(
        { ...hierarchy, ...coverage, coveredBranchCount: await coveredBranchCount(id, coverage.headOffice) },
        'Coverage fetched'
      );
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any -- matches repo error-handling pattern
      console.error('Error fetching coverage:', error);
      return errorResponse(error.message || 'Failed to fetch coverage', 500);
    }
  })(request);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req, actor) => {
    try {
      const body = await req.json();
      const { scopes } = putSchema.parse(body);

      const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
      if (!user) return errorResponse('User not found', 404);

      const idItems = scopes.filter((s): s is { level: IdLevel; id: string } => s.level !== 'HEAD_OFFICE');
      // De-duplicate the requested set.
      const unique = [...new Map(idItems.map((s) => [`${s.level}:${s.id}`, s])).values()];
      const idsOf = (level: IdLevel) => unique.filter((s) => s.level === level).map((s) => s.id);

      // Every referenced Region/Division/Area/Branch must exist.
      const checks: [IdLevel, string[], (ids: string[]) => Promise<number>][] = [
        ['REGION', idsOf('REGION'), (ids) => prisma.region.count({ where: { id: { in: ids } } })],
        ['DIVISION', idsOf('DIVISION'), (ids) => prisma.division.count({ where: { id: { in: ids } } })],
        ['AREA', idsOf('AREA'), (ids) => prisma.area.count({ where: { id: { in: ids } } })],
        ['BRANCH', idsOf('BRANCH'), (ids) => prisma.branch.count({ where: { id: { in: ids } } })],
      ];
      for (const [level, ids, count] of checks) {
        if (ids.length > 0 && (await count(ids)) !== ids.length) {
          return errorResponse(`One or more selected ${level.toLowerCase()}s no longer exist`, 400);
        }
      }

      // "Head Office (all branches)" is its own coverage row — not a Head Office
      // branch assignment (that is only where the user sits).
      let headOffice = scopes.some((s) => s.level === 'HEAD_OFFICE');
      const desiredBranchIds: string[] = [];
      for (const branchId of idsOf('BRANCH')) {
        if (await isHeadOfficeBranch(branchId)) headOffice = true;
        else desiredBranchIds.push(branchId);
      }

      await prisma.$transaction(async (tx) => {
        // Head Office / Region / Division / Area rows.
        await tx.userOrgScope.deleteMany({ where: { userId: id } });
        const orgRows = [
          ...(headOffice ? [{ level: 'HEAD_OFFICE' as const, id: null }] : []),
          ...unique.filter((s) => s.level !== 'BRANCH'),
        ];
        if (orgRows.length > 0) {
          await tx.userOrgScope.createMany({
            data: orgRows.map((s) => ({
              userId: id,
              level: s.level as 'HEAD_OFFICE' | 'REGION' | 'DIVISION' | 'AREA',
              regionId: s.level === 'REGION' ? s.id : null,
              divisionId: s.level === 'DIVISION' ? s.id : null,
              areaId: s.level === 'AREA' ? s.id : null,
              createdById: actor.userId,
            })),
          });
        }

        // Sync single branches into Manage Branches. An existing Head Office
        // assignment is the user's home branch — kept as-is, never coverage.
        const existing = await tx.userBranchAssignment.findMany({
          where: { userId: id },
          select: { id: true, branchId: true, isPrimary: true },
        });
        for (const a of existing) {
          if (await isHeadOfficeBranch(a.branchId)) desiredBranchIds.unshift(a.branchId);
        }
        const desired = new Set(desiredBranchIds);
        const toRemove = existing.filter((a) => !desired.has(a.branchId));
        const existingIds = new Set(existing.map((a) => a.branchId));
        const toAdd = desiredBranchIds.filter((b) => !existingIds.has(b));
        if (toRemove.length > 0) {
          await tx.userBranchAssignment.deleteMany({ where: { id: { in: toRemove.map((a) => a.id) } } });
        }
        if (toAdd.length > 0) {
          await tx.userBranchAssignment.createMany({
            data: toAdd.map((branchId) => ({ userId: id, branchId, isPrimary: false })),
          });
        }

        // Keep exactly one primary (and User.branchId in sync, as Manage
        // Branches does): the existing primary if still assigned, else Head
        // Office if ticked, else the first branch. With no branches left,
        // User.branchId is left as-is (login falls back to a covered branch).
        const keptPrimary = existing.find((a) => a.isPrimary && desired.has(a.branchId));
        const primaryBranchId = keptPrimary?.branchId ?? desiredBranchIds[0];
        if (primaryBranchId) {
          await tx.userBranchAssignment.updateMany({ where: { userId: id }, data: { isPrimary: false } });
          await tx.userBranchAssignment.update({
            where: { userId_branchId: { userId: id, branchId: primaryBranchId } },
            data: { isPrimary: true },
          });
          if (user.role !== 'AREA_MANAGER') {
            await tx.user.update({ where: { id }, data: { branchId: primaryBranchId } });
          }
        }
      });

      invalidateOrgScopeCache(id);
      await bumpMasterDataVersion('employees');

      const coverage = await loadCoverage(id);
      return successResponse(
        { ...coverage, coveredBranchCount: await coveredBranchCount(id, coverage.headOffice) },
        coverage.scopes.length > 0 ? 'Coverage saved' : 'Coverage cleared'
      );
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any -- matches repo error-handling pattern
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      console.error('Error saving coverage:', error);
      return errorResponse(error.message || 'Failed to save coverage', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
