import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { deriveEodStartDates } from '@/app/lib/branch-eod-start';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
  withRole,
} from '@/app/lib/api-utils';
import {
  BRANCH_DEFAULT_CLOSE_MINUTES,
  BRANCH_DEFAULT_OPEN_MINUTES,
  BRANCH_LOCK_TIMEZONE,
  computeDefaultWindowForWorkingDate,
} from '@/app/lib/branch-lock';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { hasBranchLockPolicyColumns } from '@/app/lib/branch-lock-policy-schema';
import { cachedMasterData, stableParamsKey, bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * Create branch schema
 */
const createBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required'),
  code: z.string().min(1, 'Branch code is required').toUpperCase(),
  address: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  isActive: z.boolean().optional(),
  branchStartDate: z.string().optional().nullable(),
  eodStartDate: z
    .string({ required_error: 'Branch started working date (EOD start day) is required' })
    .min(1, 'Branch started working date (EOD start day) is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid EOD start date'),
});

/**
 * @swagger
 * /api/branches:
 *   get:
 *     tags:
 *       - Branches
 *     summary: List Branches
 *     description: Fetch all branches. By default returns only active branches.
 *     parameters:
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *         description: Include inactive branches
 *     responses:
 *       200:
 *         description: Branches fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Branch'
 *       401:
 *         description: Authentication required
 *   post:
 *     tags:
 *       - Branches
 *     summary: Create Branch
 *     description: Create a new branch. **Admin only.**
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - code
 *             properties:
 *               name:
 *                 type: string
 *                 example: Main Branch
 *               code:
 *                 type: string
 *                 example: MB001
 *                 description: Unique branch code (auto-uppercased)
 *               address:
 *                 type: string
 *                 nullable: true
 *                 example: 123 Main Street
 *     responses:
 *       201:
 *         description: Branch created successfully
 *       400:
 *         description: Invalid request data
 *       403:
 *         description: Admin access required
 *       409:
 *         description: Branch code already exists
 */

/**
 * GET /api/branches
 * Fetch all active branches
 */
export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);
      // ?permitted=true limits the list to branches the caller may actually report on / filter by
      // (filter dropdowns); the default stays the full list that masters and pickers rely on.
      const onlyPermitted = searchParams.get('permitted') === 'true';
      const includeInactive = searchParams.get('includeInactive') === 'true';
      const areaId = searchParams.get('areaId') || undefined;

      const where: Record<string, unknown> = {};
      if (!includeInactive) {
        where.isActive = true;
      }
      if (areaId) {
        where.areas = { some: { id: areaId } };
      }

      const branchesWithDerivedStart = await cachedMasterData(
        'branches',
        stableParamsKey({ includeInactive, areaId: areaId ?? null }),
        async () => {
          const branches = await prisma.branch.findMany({
            where,
            select: {
              id: true,
              name: true,
              code: true,
              address: true,
              state: true,
              district: true,
              latitude: true,
              longitude: true,
              isActive: true,
              branchStartDate: true,
              eodStartDate: true,
              areas: { select: { id: true, name: true, code: true } },
              createdAt: true,
              updatedAt: true,
              lock: { select: { lastEodClosedAt: true } },
            },
            orderBy: {
              name: 'asc',
            },
          });

          // eodStartDate locks in the edit form only once an EOD has actually been
          // closed for the branch (not merely once the date itself is set) — see
          // PATCH /api/branches/[id] for the matching server-side enforcement.
          const branchesWithEodStatus = branches.map(({ lock, ...branch }) => ({
            ...branch,
            eodCompleted: Boolean(lock?.lastEodClosedAt),
          }));

          // For branches with no eodStartDate on record, derive what it actually was
          // from the earliest real activity — display-only (never written here); the
          // edit form offers it as a one-click fill so an admin can review and
          // confirm it before saving. Batched via groupBy (not per-branch queries) to
          // avoid an N+1 across the whole branch list.
          const nullEodBranchIds = branchesWithEodStatus.filter((b) => !b.eodStartDate).map((b) => b.id);
          const derivedStartByBranch = await deriveEodStartDates(nullEodBranchIds);

          return branchesWithEodStatus.map((b) => ({
            ...b,
            derivedEodStartDate: b.eodStartDate ? null : derivedStartByBranch.get(b.id)?.toISOString() ?? null,
          }));
        }
      );

      let result = branchesWithDerivedStart;
      if (onlyPermitted) {
        const permittedBranchIds = await getPermittedBranchIds(user);
        if (permittedBranchIds) {
          const allowed = new Set(permittedBranchIds);
          result = branchesWithDerivedStart.filter((b) => allowed.has(b.id));
        }
      }

      return successResponse(result, 'Branches fetched successfully');
    } catch (error) {
      console.error('Error fetching branches:', error);
      return errorResponse(
        'Failed to fetch branches',
        500
      );
    }
  })(request);
}

/**
 * Helper to generate the next unique numeric branch ID (e.g. "001", "002")
 */
async function generateBranchCode() {
  const branches = await prisma.branch.findMany({
    select: { code: true },
  });

  const maxNum = branches.reduce((max, b) => {
    if (/^\d+$/.test(b.code)) {
      const n = parseInt(b.code, 10);
      return n > max ? n : max;
    }
    return max;
  }, 0);

  return (maxNum + 1).toString();
}

/**
 * POST /api/branches
 * Create a new branch (Admin only)
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();

      // Validate request body - make code optional for auto-generation
      const createBranchSchemaExtended = createBranchSchema.extend({
        code: z.string().optional().nullable(),
        areaId: z.string().optional().nullable(),
      });

      const validationResult = createBranchSchemaExtended.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const { name, address, state, district, areaId, latitude, longitude, isActive, branchStartDate, eodStartDate } = validationResult.data;
      let { code } = validationResult.data;

      // Auto-generate code if not provided
      if (!code) {
        code = await generateBranchCode();
      }

      // Check for reserved Head Office names or codes
      const normalizedName = name.trim().toLowerCase();
      const normalizedCode = code.trim();

      if (normalizedCode === 'HO' || normalizedName === 'head office') {
        return errorResponse('Cannot create another Head Office branch. Only one is allowed.', 400);
      }

      // Check if branch with code already exists (especially important for auto-generated or manual codes)
      const existingBranch = await prisma.branch.findUnique({
        where: { code: normalizedCode },
      });

      if (existingBranch) {
        return errorResponse('Branch with this code already exists', 409);
      }

      // Create branch
      const branch = await prisma.branch.create({
        data: {
          name: name.trim(),
          code: code.trim(),
          address: address?.trim() || null,
          state: state?.trim() || null,
          district: district?.trim() || null,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          isActive: isActive ?? true,
          branchStartDate: branchStartDate ? new Date(branchStartDate) : null,
          eodStartDate: eodStartDate ? new Date(eodStartDate) : null,
          // Area is a many-to-many; connect if an areaId was supplied
          ...(areaId ? { areas: { connect: { id: areaId } } } : {}),
        },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          state: true,
          district: true,
          latitude: true,
          longitude: true,
          isActive: true,
          branchStartDate: true,
          eodStartDate: true,
          areas: { select: { id: true, name: true, code: true } },
          createdAt: true,
          updatedAt: true,
        },
      });

      // Seed the branch's working-day lock from the given EOD start date right away,
      // instead of leaving it to the lazy upsert (which defaults to "today" the first
      // time someone opens an EOD-related screen — see eod-process/eod-checklist-details).
      if (eodStartDate && /^\d{4}-\d{2}-\d{2}$/.test(eodStartDate.trim())) {
        try {
          const workingDate = parseDenominationEntryDateUtc(eodStartDate.trim());
          const defaultWindow = computeDefaultWindowForWorkingDate(
            workingDate,
            BRANCH_LOCK_TIMEZONE,
            BRANCH_DEFAULT_OPEN_MINUTES,
            BRANCH_DEFAULT_CLOSE_MINUTES
          );
          const policyColumnsAvailable = await hasBranchLockPolicyColumns();

          await prisma.branchLock.upsert({
            where: { branchId: branch.id },
            update: {},
            create: policyColumnsAvailable
              ? {
                  branchId: branch.id,
                  currentWorkingDate: workingDate,
                  lockTime: defaultWindow.end,
                  timezone: BRANCH_LOCK_TIMEZONE,
                  defaultOpenMinutes: BRANCH_DEFAULT_OPEN_MINUTES,
                  defaultCloseMinutes: BRANCH_DEFAULT_CLOSE_MINUTES,
                  effectiveWindowStartAt: defaultWindow.start,
                  effectiveWindowEndAt: defaultWindow.end,
                }
              : {
                  branchId: branch.id,
                  currentWorkingDate: workingDate,
                  lockTime: defaultWindow.end,
                },
          });
        } catch (lockError) {
          // Don't fail branch creation over the lock seed — it'll just fall back to
          // the normal lazy-init behavior on first EOD touch.
          console.error('Error seeding branch lock from eodStartDate:', lockError);
        }
      }

      await bumpMasterDataVersion('branches');
      return successResponse(branch, 'Branch created successfully', 201);
    } catch (error) {
      console.error('Error creating branch:', error);
      // Handle Prisma unique constraint error
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return errorResponse('Branch code must be unique', 409);
      }
      return errorResponse(
        'Failed to create branch',
        500
      );
    }
  })(request);
}
