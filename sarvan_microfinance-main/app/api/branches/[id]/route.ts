import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
  withAuth,
} from '@/app/lib/api-utils';
import {
  BRANCH_DEFAULT_CLOSE_MINUTES,
  BRANCH_DEFAULT_OPEN_MINUTES,
  BRANCH_LOCK_TIMEZONE,
  computeDefaultWindowForWorkingDate,
} from '@/app/lib/branch-lock';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { hasBranchLockPolicyColumns } from '@/app/lib/branch-lock-policy-schema';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

/**
 * Update branch schema
 */
const updateBranchSchema = z.object({
  name: z.string().min(1, 'Branch name is required').optional(),
  code: z.string().min(1, 'Branch ID is required').optional(),
  address: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  isActive: z.boolean().optional(),
  branchStartDate: z.string().optional().nullable(),
  eodStartDate: z.string().optional().nullable(),
  areaId: z.string().optional().nullable(),
});

// Date-only comparison (ignores time-of-day / parsing artifacts) for checking
// whether an incoming eodStartDate actually differs from the stored one.
function toYmd(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

/**
 * @swagger
 * /api/branches/{id}:
 *   get:
 *     tags:
 *       - Branches
 *     summary: Get Branch by ID
 *     description: |
 *       Fetch a specific branch by ID.
 *       - **Admin**: Can fetch any branch
 *       - **Other roles**: Can only fetch their assigned branch
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Branch fetched successfully
 *       403:
 *         description: Cannot access other branches
 *       404:
 *         description: Branch not found
 *   patch:
 *     tags:
 *       - Branches
 *     summary: Update Branch
 *     description: Update branch details. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               address:
 *                 type: string
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Branch updated successfully
 *       404:
 *         description: Branch not found
 *       409:
 *         description: Branch code already exists
 *   delete:
 *     tags:
 *       - Branches
 *     summary: Delete Branch
 *     description: Soft delete a branch. Cannot delete with active users or centers. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Branch deleted successfully
 *       400:
 *         description: Cannot delete branch with active users/centers
 *       404:
 *         description: Branch not found
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/branches/[id]
 * Get branch by ID
 * - Admins can fetch any branch
 * - Other users can only fetch their own assigned branch
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(async (req, user) => {
    try {
      // If user is not admin, check if they're fetching their own branch
      if (user.role !== 'ADMIN') {
        const userRecord = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });

        if (!userRecord || userRecord.branchId !== id) {
          return errorResponse('Insufficient permissions', 403);
        }
      }

      const branch = await prisma.branch.findUnique({
        where: { id },
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
      });

      if (!branch) {
        return errorResponse('Branch not found', 404);
      }

      // eodStartDate locks in the edit form only once an EOD has actually been
      // closed for the branch — see PATCH below for the matching enforcement.
      const { lock, ...branchFields } = branch;

      // For a branch with no eodStartDate on record, derive what it actually was
      // from the earliest real activity — display-only (never written here); the
      // edit form offers it as a one-click fill so an admin can review and
      // confirm it before saving. Mirrors GET /api/branches's batched version.
      let derivedEodStartDate: string | null = null;
      if (!branchFields.eodStartDate) {
        const [denomMin, loanTxMin, finTxMin, meetingMin] = await Promise.all([
          prisma.denominationEntry.aggregate({ where: { branchId: id }, _min: { entryDate: true } }),
          prisma.loanTransaction.aggregate({ where: { branchId: id }, _min: { transactionDate: true } }),
          prisma.financialTransaction.aggregate({ where: { branchId: id, isActive: true }, _min: { transactionDate: true } }),
          prisma.collectionMeetingRecord.aggregate({ where: { branchId: id }, _min: { collectionDate: true } }),
        ]);
        const candidates = [
          denomMin._min.entryDate,
          loanTxMin._min.transactionDate,
          finTxMin._min.transactionDate,
          meetingMin._min.collectionDate,
        ].filter((d): d is Date => d != null);
        if (candidates.length > 0) {
          derivedEodStartDate = candidates.reduce((min, d) => (d < min ? d : min)).toISOString();
        }
      }

      const branchWithEodStatus = {
        ...branchFields,
        eodCompleted: Boolean(lock?.lastEodClosedAt),
        derivedEodStartDate,
      };

      return successResponse(branchWithEodStatus, 'Branch fetched successfully');
    } catch (error) {
      console.error('Error fetching branch:', error);
      return errorResponse('Failed to fetch branch', 500);
    }
  })(request);
}

/**
 * PATCH /api/branches/[id]
 * Update branch (Admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();

      // Validate request body
      const validationResult = updateBranchSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const { name, code, address, state, district, latitude, longitude, isActive, branchStartDate, eodStartDate, areaId } = validationResult.data;

      // Check if branch exists
      const existingBranch = await prisma.branch.findUnique({
        where: { id },
        include: { lock: { select: { lastEodClosedAt: true } } },
      });

      if (!existingBranch) {
        return errorResponse('Branch not found', 404);
      }

      // Check code uniqueness and reserved codes if code is being updated
      if (code) {
        const normalizedCode = code.trim().toUpperCase();

        // Prevent changing a non-HO branch to HO code
        if (normalizedCode === 'HO' && existingBranch.code !== 'HO') {
          return errorResponse('Cannot change branch code to reserved "HO" code.', 400);
        }

        if (normalizedCode !== existingBranch.code) {
          const codeExists = await prisma.branch.findUnique({
            where: { code: normalizedCode },
          });

          if (codeExists) {
            return errorResponse('Branch with this code already exists', 409);
          }
        }
      }

      // Check for reserved name if name is being updated
      if (name) {
        const normalizedName = name.trim().toLowerCase();
        if (normalizedName === 'head office' && existingBranch.name.toLowerCase() !== 'head office') {
          return errorResponse('The name "Head Office" is reserved.', 400);
        }
      }

      // EOD start date stays editable until the branch actually closes its first
      // EOD (BranchLock.lastEodClosedAt) — only then does it lock for good. Merely
      // having a value already (from initial branch creation) does not lock it, so
      // an FDO/BM mistake made before any EOD has run can still be corrected.
      if (eodStartDate !== undefined && existingBranch.lock?.lastEodClosedAt) {
        const attemptedYmd = eodStartDate ? toYmd(eodStartDate) : null;
        const currentYmd = existingBranch.eodStartDate ? toYmd(existingBranch.eodStartDate) : null;
        if (attemptedYmd !== currentYmd) {
          return errorResponse('Branch started working date (EOD start day) cannot be changed once an EOD has been completed.', 400);
        }
      }

      // Build update data
      const updateData: {
        name?: string;
        code?: string;
        address?: string | null;
        state?: string | null;
        district?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        isActive?: boolean;
        branchStartDate?: Date | null;
        eodStartDate?: Date | null;
        areas?: { connect: { id: string } } | { disconnect: { id: string }[] };
      } = {};

      if (name) updateData.name = name.trim();
      if (code) updateData.code = code.trim();
      if (address !== undefined) updateData.address = address?.trim() || null;
      if (state !== undefined) updateData.state = state?.trim() || null;
      if (district !== undefined) updateData.district = district?.trim() || null;
      if (latitude !== undefined) updateData.latitude = latitude;
      if (longitude !== undefined) updateData.longitude = longitude;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (branchStartDate !== undefined) updateData.branchStartDate = branchStartDate ? new Date(branchStartDate) : null;
      if (eodStartDate !== undefined) updateData.eodStartDate = eodStartDate ? new Date(eodStartDate) : null;
      // Area is a many-to-many; connect to the new area if provided
      if (areaId !== undefined && areaId) {
        updateData.areas = { connect: { id: areaId } };
      }

      // Update branch
      const branch = await prisma.branch.update({
        where: { id },
        data: updateData,
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

      // A branch that hasn't closed its first EOD yet has no real working-date
      // history — syncing eodStartDate here also moves the live
      // BranchLock.currentWorkingDate the EOD Process page reads, so there's no
      // separate "why didn't my edit take effect" surprise. Once the first EOD
      // closes, eodStartDate itself locks (guard above) and this sync stops
      // applying — from then on the working date can only move via the EOD
      // Revert flow (app/api/utilities/eod-process/revert/route.ts). Activity
      // already recorded on the old working date doesn't block the sync — that
      // date was never EOD-closed, and the start date is what's being corrected.
      let workingDateSynced = false;
      if (eodStartDate && !existingBranch.lock?.lastEodClosedAt) {
        const newWorkingDate = parseDenominationEntryDateUtc(eodStartDate);
        const existingLock = await prisma.branchLock.findUnique({
          where: { branchId: id },
          select: { timezone: true },
        });
        const timezone = existingLock?.timezone || BRANCH_LOCK_TIMEZONE;

        const newWindow = computeDefaultWindowForWorkingDate(
          newWorkingDate,
          timezone,
          BRANCH_DEFAULT_OPEN_MINUTES,
          BRANCH_DEFAULT_CLOSE_MINUTES
        );
        const policyColumnsAvailable = await hasBranchLockPolicyColumns();
        try {
          if (policyColumnsAvailable) {
            await prisma.branchLock.upsert({
              where: { branchId: id },
              update: {
                currentWorkingDate: newWorkingDate,
                lockTime: newWindow.end,
                effectiveWindowStartAt: newWindow.start,
                effectiveWindowEndAt: newWindow.end,
              },
              create: {
                branchId: id,
                currentWorkingDate: newWorkingDate,
                lockTime: newWindow.end,
                timezone: BRANCH_LOCK_TIMEZONE,
                defaultOpenMinutes: BRANCH_DEFAULT_OPEN_MINUTES,
                defaultCloseMinutes: BRANCH_DEFAULT_CLOSE_MINUTES,
                effectiveWindowStartAt: newWindow.start,
                effectiveWindowEndAt: newWindow.end,
              },
            });
          } else {
            await prisma.branchLock.upsert({
              where: { branchId: id },
              update: { currentWorkingDate: newWorkingDate, lockTime: newWindow.end },
              create: { branchId: id, currentWorkingDate: newWorkingDate, lockTime: newWindow.end },
            });
          }
          workingDateSynced = true;
        } catch (lockSyncError) {
          console.error('Error syncing branch working date to eodStartDate:', lockSyncError);
        }
      }

      await bumpMasterDataVersion('branches');
      return successResponse(
        branch,
        workingDateSynced
          ? 'Branch updated successfully. EOD working date synced to the new start date.'
          : 'Branch updated successfully'
      );
    } catch (error) {
      console.error('Error updating branch:', error);
      // Handle Prisma unique constraint error
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return errorResponse('Branch code must be unique', 409);
      }
      return errorResponse('Failed to update branch', 500);
    }
  })(request);
}

/**
 * DELETE /api/branches/[id]
 * Delete branch (Admin only) - Soft delete by setting isActive to false
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      // Check if branch exists
      const branch = await prisma.branch.findUnique({
        where: { id },
        include: {
          users: {
            where: { isActive: true },
            select: { id: true },
          },
          centers: {
            where: { isActive: true },
            select: { id: true },
          },
        },
      });

      if (!branch) {
        return errorResponse('Branch not found', 404);
      }

      // Check if branch has active users or centers
      if (branch.users.length > 0) {
        return errorResponse(
          'Cannot delete branch with active users. Please reassign or deactivate users first.',
          400
        );
      }

      if (branch.centers.length > 0) {
        return errorResponse(
          'Cannot delete branch with active centers. Please deactivate centers first.',
          400
        );
      }

      // Soft delete by setting isActive to false
      await prisma.branch.update({
        where: { id },
        data: { isActive: false },
      });

      await bumpMasterDataVersion('branches');
      return successResponse(null, 'Branch deleted successfully');
    } catch (error) {
      console.error('Error deleting branch:', error);
      return errorResponse('Failed to delete branch', 500);
    }
  })(request);
}
