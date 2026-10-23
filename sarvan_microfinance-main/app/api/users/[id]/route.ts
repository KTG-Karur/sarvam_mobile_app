import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { hashPassword } from '@/app/lib/auth';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
  withAuth,
} from '@/app/lib/api-utils';
import { resolveLegacyRoleForRbacRole } from '@/app/lib/rbac-role-sync';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';
import { FIELD_PATTERNS, FIELD_ERROR_MESSAGES } from '@/app/lib/hr/onboarding-form-fields';
import { resolveEmployeePhotoKeys } from '@/app/lib/hr/employee-photo';

const optionalPattern = (pattern: RegExp, errorMessage: string) =>
  z.string().nullable().optional().refine(
    (val) => !val || val.trim() === '' || pattern.test(val.trim()),
    { message: errorMessage }
  );

const optionalPan = z.string().nullable().optional().refine(
  (val) => !val || val.trim() === '' || FIELD_PATTERNS.PAN.test(val.trim().toUpperCase()),
  { message: FIELD_ERROR_MESSAGES.PAN }
);

/**
 * Update user schema
 */
const updateUserSchema = z.object({
  mobileNumber: optionalPattern(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.MOBILE),
  email: z.string().nullable().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.EMAIL.test(val.trim()),
    { message: FIELD_ERROR_MESSAGES.EMAIL }
  ),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  firstName: z.string().min(1, 'First name is required').optional(),
  lastName: z.string().optional(),
  // Plain string, not a fixed enum — role is a dynamic code (system role like
  // 'QC'/'DIVISION_MANAGER', or an auto-generated custom RBAC role code), same
  // as User.role in the schema and the POST /api/users create route.
  role: z.string().min(1).optional(),
  branchId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  assignedBranchIds: z.array(z.string().min(1)).max(4).optional(),
  primaryBranchId: z.string().optional(),
  /** Optional RBAC role ID — updates UserRoleAssignment; deactivates previous assignments. */
  rbacRoleId: z.string().optional(),
  // Extended profile
  fatherName: z.string().nullable().optional(),
  motherName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  education: z.string().nullable().optional(),
  aadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.AADHAAR),
  aadhaarDocUrl: z.string().nullable().optional(),
  panNumber: optionalPan,
  panDocUrl: z.string().nullable().optional(),
  profilePhotoUrl: z.string().nullable().optional(),
  esiNumber: optionalPattern(FIELD_PATTERNS.ESI, FIELD_ERROR_MESSAGES.ESI),
  pfNumber: optionalPattern(FIELD_PATTERNS.UAN, FIELD_ERROR_MESSAGES.UAN),
  esiPfDocUrl: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  locationPhotoUrl: z.string().nullable().optional(),
  dateOfJoining: z.string().nullable().optional(),
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get User by ID
 *     description: Fetch a specific user by their ID. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update User
 *     description: Update user details. **Admin only.**
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
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *                 description: Legacy role code (e.g. ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER, QC, DIVISION_MANAGER, or a custom RBAC role code)
 *               branchId:
 *                 type: string
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already exists
 *   delete:
 *     tags:
 *       - Users
 *     summary: Delete User
 *     description: Soft delete a user by setting isActive to false. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       404:
 *         description: User not found
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/users/[id]
 * Get user by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(async (req, currentUser) => {
    // Allow self-fetch for any role; admin can fetch any user
    if (currentUser.userId !== id && currentUser.role !== 'ADMIN') {
      return errorResponse('Insufficient permissions', 403);
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          employeeId: true,
          mobileNumber: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          branchId: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          fatherName: true,
          motherName: true,
          address: true,
          education: true,
          aadhaarNumber: true,
          aadhaarDocUrl: true,
          panNumber: true,
          panDocUrl: true,
          profilePhotoUrl: true,
          esiNumber: true,
          pfNumber: true,
          esiPfDocUrl: true,
          latitude: true,
          longitude: true,
          locationPhotoUrl: true,
          dateOfJoining: true,
          hasChangedPassword: true,
          hasChangedProfilePhoto: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          userRoles: {
            where: { isActive: true },
            select: {
              role: {
                select: { id: true, name: true, slug: true, color: true },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      const { userRoles, ...rest } = user;
      // Additive: the ID-card photo (KYC "Photo" document, else the onboarding
      // copy) — the profile popup shows it when no profile photo was uploaded.
      // profilePhotoUrl is passed as null so this is only the document photo.
      const idCardPhotoKey = (await resolveEmployeePhotoKeys([{ id: user.id, profilePhotoUrl: null }])).get(user.id) ?? null;
      return successResponse({ ...rest, rbacRole: userRoles[0]?.role ?? null, idCardPhotoKey }, 'User fetched successfully');
    } catch (error) {
      console.error('Error fetching user:', error);
      return errorResponse('Failed to fetch user', 500);
    }
  })(request);
}

/**
 * PATCH /api/users/[id]
 * Update user (Admin only)
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
      const validationResult = updateUserSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const {
        mobileNumber, email, password, firstName, lastName, role, branchId, isActive,
        assignedBranchIds, primaryBranchId, rbacRoleId,
        fatherName, motherName, address, education,
        aadhaarNumber, aadhaarDocUrl, panNumber, panDocUrl,
        profilePhotoUrl, esiNumber, pfNumber, esiPfDocUrl,
        latitude, longitude, locationPhotoUrl, dateOfJoining,
      } = validationResult.data;

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        return errorResponse('User not found', 404);
      }

      // Check mobile number uniqueness if mobile is being updated
      if (mobileNumber && mobileNumber !== existingUser.mobileNumber) {
        const mobileExists = await prisma.user.findUnique({
          where: { mobileNumber },
        });

        if (mobileExists) {
          return errorResponse('User with this mobile number already exists', 409);
        }
      }

      // Validate branch if provided
      if (branchId !== undefined && branchId !== null) {
        const branch = await prisma.branch.findUnique({
          where: { id: branchId },
        });

        if (!branch) {
          return errorResponse('Invalid branch ID', 400);
        }

        if (!branch.isActive) {
          return errorResponse('Branch is not active', 400);
        }
      }

      // Resolve User.role (JWT claim) from the RBAC role being assigned, mirroring
      // POST /api/users's create-time resolution. The RBAC role must win over the
      // legacy `role` field whenever rbacRoleId is provided — UserForm always sends
      // both (role = the base-role dropdown, rbacRoleId = the custom RBAC role
      // picker), so gating this on `!role` meant it never actually ran in practice
      // and a custom role's legacyRole (e.g. "Quality Checkers" -> "QC") was silently
      // discarded in favor of the stale base role. Without this, reassigning a user
      // to a new custom role (e.g. FDO -> Quality Checkers) leaves the old User.role
      // in place, so the JWT keeps granting the previous role's access instead of the
      // new role's configured pagePermissions/branch scoping (most visibly: FDO's
      // buildFdoCenterScope keeps applying, hiding centers the user isn't personally
      // assigned as FDO on).
      let resolvedRoleFromRbac: string | null = null;
      if (rbacRoleId) {
        const rbacRoleRecord = await prisma.role.findUnique({
          where: { id: rbacRoleId, isActive: true },
          select: { slug: true, legacyRole: true },
        });
        if (rbacRoleRecord) {
          resolvedRoleFromRbac = resolveLegacyRoleForRbacRole(rbacRoleRecord);
        }
      }

      // Build update data - only include fields that are being updated
      const updateData: Record<string, unknown> = {};

      if (mobileNumber) updateData.mobileNumber = mobileNumber;
      if (email !== undefined) updateData.email = email || null;
      if (password) updateData.password = await hashPassword(password);
      if (firstName) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName || '';
      if (resolvedRoleFromRbac) updateData.role = resolvedRoleFromRbac;
      else if (role) updateData.role = role;
      if (branchId !== undefined) updateData.branchId = branchId;
      if (isActive !== undefined) updateData.isActive = isActive;
      // Extended profile fields
      if (fatherName !== undefined) updateData.fatherName = fatherName ?? null;
      if (motherName !== undefined) updateData.motherName = motherName ?? null;
      if (address !== undefined) updateData.address = address ?? null;
      if (education !== undefined) updateData.education = education ?? null;
      if (aadhaarNumber !== undefined) updateData.aadhaarNumber = aadhaarNumber ?? null;
      if (aadhaarDocUrl !== undefined) updateData.aadhaarDocUrl = aadhaarDocUrl ?? null;
      if (panNumber !== undefined) updateData.panNumber = panNumber ?? null;
      if (panDocUrl !== undefined) updateData.panDocUrl = panDocUrl ?? null;
      if (profilePhotoUrl !== undefined) updateData.profilePhotoUrl = profilePhotoUrl ?? null;
      if (esiNumber !== undefined) updateData.esiNumber = esiNumber ?? null;
      if (pfNumber !== undefined) updateData.pfNumber = pfNumber ?? null;
      if (esiPfDocUrl !== undefined) updateData.esiPfDocUrl = esiPfDocUrl ?? null;
      if (latitude !== undefined) updateData.latitude = latitude ?? null;
      if (longitude !== undefined) updateData.longitude = longitude ?? null;
      if (locationPhotoUrl !== undefined) updateData.locationPhotoUrl = locationPhotoUrl ?? null;
      if (dateOfJoining !== undefined) updateData.dateOfJoining = dateOfJoining ? new Date(dateOfJoining) : null;

      // Update user
      const user = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            employeeId: true,
            mobileNumber: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            branchId: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            fatherName: true,
            motherName: true,
            address: true,
            education: true,
            aadhaarNumber: true,
            aadhaarDocUrl: true,
            panNumber: true,
            panDocUrl: true,
            profilePhotoUrl: true,
            esiNumber: true,
            pfNumber: true,
            esiPfDocUrl: true,
            latitude: true,
            longitude: true,
            locationPhotoUrl: true,
            dateOfJoining: true,
            hasChangedPassword: true,
            hasChangedProfilePhoto: true,
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        });

        // Handle Area Manager branch assignments if provided
        const finalRole = resolvedRoleFromRbac || role || existingUser.role;
        if (finalRole === 'AREA_MANAGER' && assignedBranchIds !== undefined) {
          // Clear existing assignments
          await tx.areaManagerBranch.deleteMany({
            where: { userId: id },
          });

          if (assignedBranchIds.length > 0) {
            const effectivePrimary = primaryBranchId ?? assignedBranchIds[0];
            await Promise.all(
              assignedBranchIds.map((bid) =>
                tx.areaManagerBranch.create({
                  data: {
                    userId: id,
                    branchId: bid,
                    isPrimary: bid === effectivePrimary,
                  },
                })
              )
            );
          }
        }

        // Handle RBAC role update if rbacRoleId is provided
        let assignedRbacRole: { id: string; name: string; slug: string; color: string | null } | null = null;
        if (rbacRoleId) {
          const rbacRole = await tx.role.findUnique({ where: { id: rbacRoleId, isActive: true } });
          if (rbacRole) {
            assignedRbacRole = { id: rbacRole.id, name: rbacRole.name, slug: rbacRole.slug, color: rbacRole.color };
            // Deactivate all existing RBAC role assignments for this user
            await tx.userRoleAssignment.updateMany({
              where: { userId: id, isActive: true },
              data: { isActive: false },
            });
            // Assign the new RBAC role
            const existing = await tx.userRoleAssignment.findFirst({
              where: { userId: id, roleId: rbacRole.id, branchId: null },
            });
            if (!existing) {
              await tx.userRoleAssignment.create({
                data: {
                  userId: id,
                  roleId: rbacRole.id,
                  branchId: null,
                  isActive: true,
                  assignedBy: id,
                },
              });
            } else {
              await tx.userRoleAssignment.update({
                where: { id: existing.id },
                data: { isActive: true },
              });
            }
          }
        } else {
          // No rbacRoleId — fetch the current active RBAC role for display
          const currentRole = await tx.userRoleAssignment.findFirst({
            where: { userId: id, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: {
              role: { select: { id: true, name: true, slug: true, color: true } },
            },
          });
          assignedRbacRole = currentRole?.role ?? null;
        }

        return { ...updatedUser, rbacRole: assignedRbacRole };
      });

      // Role (base or RBAC) may have just changed — drop any cached permission
      // set so the user's next request re-resolves against the new role/assignment
      // instead of serving stale (possibly wider) access until the cache expires.
      await invalidateUserPermissions(id);
      await bumpMasterDataVersion('employees');

      return successResponse(user, 'User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      return errorResponse('Failed to update user', 500);
    }
  })(request);
}

/**
 * DELETE /api/users/[id]
 * Delete user (Admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async () => {
    try {
      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      // Soft delete by setting isActive to false instead of hard delete
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
      await bumpMasterDataVersion('employees');

      return successResponse(null, 'User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      return errorResponse('Failed to delete user', 500);
    }
  })(request);
}
