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
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { generateNextEmployeeId } from '@/app/lib/hr/generate-employee-id';
import { FIELD_PATTERNS, FIELD_ERROR_MESSAGES } from '@/app/lib/hr/onboarding-form-fields';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

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
 * User creation schema
 */
const createUserSchema = z.object({
  mobileNumber: z.string().refine(
    (val) => FIELD_PATTERNS.MOBILE.test(val.trim()),
    { message: FIELD_ERROR_MESSAGES.MOBILE }
  ),
  email: z.string().nullable().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.EMAIL.test(val.trim()),
    { message: FIELD_ERROR_MESSAGES.EMAIL }
  ),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  employeeId: z.string().min(1, 'Employee ID is required').optional(),
  /**
   * Role code stored in user.role (DB + JWT). Optional when rbacRoleId is provided —
   * the server derives it from rbacRoleId.legacyRole (DB lookup).
   * Only required as a fallback when no rbacRoleId is given (legacy path).
   * Can be a system value (ADMIN, FDO, …) OR a custom code (BVT, HRE, PUNE, …).
   */
  role: z.string().optional(),
  branchId: z.string().optional().nullable(),
  /** For AREA_MANAGER: one or more branch IDs (max 4). Replaces branchId. */
  assignedBranchIds: z.array(z.string().min(1)).max(4).optional(),
  /** For AREA_MANAGER: which of assignedBranchIds is primary (default login branch). */
  primaryBranchId: z.string().optional(),
  /** RBAC role ID — when provided, legacyRole is derived from the DB record. */
  rbacRoleId: z.string().optional(),
  // Extended profile
  fatherName: z.string().optional(),
  motherName: z.string().optional(),
  address: z.string().optional(),
  education: z.string().optional(),
  aadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.AADHAAR),
  aadhaarDocUrl: z.string().optional(),
  panNumber: optionalPan,
  panDocUrl: z.string().optional(),
  profilePhotoUrl: z.string().optional(),
  esiNumber: optionalPattern(FIELD_PATTERNS.ESI, FIELD_ERROR_MESSAGES.ESI),
  pfNumber: optionalPattern(FIELD_PATTERNS.UAN, FIELD_ERROR_MESSAGES.UAN),
  esiPfDocUrl: z.string().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  locationPhotoUrl: z.string().optional(),
  dateOfJoining: z.string().optional().nullable(),
}).refine(
  (data) => data.rbacRoleId || data.role,
  { message: 'Either rbacRoleId or role must be provided', path: ['role'] }
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags:
 *       - Users
 *     summary: List Users
 *     description: |
 *       Fetch users based on role permissions:
 *       - **ADMIN**: Can fetch all users with optional filters
 *       - **AREA_MANAGER**: Can fetch all users with optional filters
 *       - **BRANCH_MANAGER**: Can fetch all users from their assigned branch
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER]
 *         description: Filter by user role (Admin only)
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Filter by branch ID (Admin only)
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status (default true)
 *     responses:
 *       200:
 *         description: Users fetched successfully
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
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions
 *   post:
 *     tags:
 *       - Users
 *     summary: Create User
 *     description: Create a new user. **Admin, Area Manager, and Branch Manager.**
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john.doe@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: SecurePass123
 *               firstName:
 *                 type: string
 *                 example: John
 *               lastName:
 *                 type: string
 *                 example: Doe
 *               role:
 *                 type: string
 *                 enum: [ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER]
 *                 example: FDO
 *               branchId:
 *                 type: string
 *                 nullable: true
 *                 description: Branch to assign user to
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Insufficient permissions (Admin, Area Manager, or Branch Manager required)
 *       409:
 *         description: User with email already exists
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/users
 * Create a new user (Admin, Area Manager, and Branch Manager)
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req) => {
    try {
      const body = await req.json();

      // Validate request body
      const validationResult = createUserSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

    const {
      mobileNumber, email, password, firstName, lastName, role, branchId,
      assignedBranchIds, primaryBranchId, rbacRoleId,
      fatherName, motherName, address, education,
      aadhaarNumber, aadhaarDocUrl, panNumber, panDocUrl,
      profilePhotoUrl, esiNumber, pfNumber, esiPfDocUrl,
      latitude, longitude, locationPhotoUrl, dateOfJoining,
      employeeId: customEmployeeId,
    } = validationResult.data;

    // ── Resolve effective UserRole ────────────────────────────────────────────
    // Resolution order (highest priority first):
    //  1. System slug map — authoritative for built-in roles; guards against
    //     stale legacyRole="FDO" DB default on roles that were seeded without
    //     an explicit legacyRole value.
    //  2. legacyRole from DB — set by computeRoleCode() when a custom role is
    //     created via /api/admin/roles (e.g. "Quality Checkers" → "QC").
    //  3. Explicit `role` field (legacy fallback for callers that still send it).
    //
    // computeRoleCode logic (mirrored here for docs):
    //   single-word name  → full word UPPERCASED  (e.g. "Admin" → "ADMIN")
    //   multi-word name   → first letter each word (e.g. "Branch Manager" → "BM")

    const SYSTEM_SLUG_TO_ROLE: Record<string, string> = {
      'admin':             'ADMIN',
      'area-manager':      'AREA_MANAGER',
      'branch-manager':    'BRANCH_MANAGER',
      'fdo':               'FDO',
      'division-manager':  'DIVISION_MANAGER',
      'quality-checkers':  'QC',
    };

    let effectiveRole: string | null = role ?? null;
    if (rbacRoleId) {
      const rbacRoleRecord = await prisma.role.findUnique({
        where: { id: rbacRoleId, isActive: true },
        select: { legacyRole: true, slug: true, name: true },
      });
      if (rbacRoleRecord) {
        // Priority 1: known system slug (never wrong, even on stale DB)
        // Priority 2: legacyRole computed during role creation for custom roles
        effectiveRole =
          SYSTEM_SLUG_TO_ROLE[rbacRoleRecord.slug] ??
          rbacRoleRecord.legacyRole;
      }
    }

    // Guard: at this point effectiveRole must be resolved.
    if (!effectiveRole) {
      return errorResponse(
        'Could not determine user role. Provide a valid rbacRoleId or an explicit role.',
        400
      );
    }

    // For Area Managers, the junction table is the source of truth for branch assignment.
    // branchId on the User row must remain null for AM roles.
    if (effectiveRole === 'AREA_MANAGER' && branchId) {
      return errorResponse(
        'Use assignedBranchIds (not branchId) when creating an Area Manager',
        400
      );
    }

    // Validate at least one branch for operational roles that require a branch
    if (effectiveRole === 'BRANCH_MANAGER' || effectiveRole === 'FDO') {
      if (!branchId) {
        return errorResponse('Branch is required for Branch Manager and FDO roles', 400);
      }
    }

    // Check if user with mobile number already exists (unique constraint)
    const existingUser = await prisma.user.findUnique({
      where: { mobileNumber },
    });

    if (existingUser) {
      return errorResponse('User with this mobile number already exists', 409);
    }

    // Validate single branchId (for BM/FDO)
    if (branchId) {
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

    // Validate assigned branches for AM (must exist and be active)
    if (effectiveRole === 'AREA_MANAGER' && assignedBranchIds && assignedBranchIds.length > 0) {
      if (assignedBranchIds.length > 4) {
        return errorResponse('Area Manager can be assigned to a maximum of 4 branches', 422);
      }
      for (const bid of assignedBranchIds) {
        const branch = await prisma.branch.findUnique({ where: { id: bid } });
        if (!branch) return errorResponse(`Branch not found: ${bid}`, 404);
        if (!branch.isActive) return errorResponse(`Branch "${branch.name}" is not active`, 400);
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Resolve employeeId: use custom if provided, else auto-generate
    let generatedEmployeeId: string;
    if (customEmployeeId) {
      // Check uniqueness of custom employee ID
      const empIdExists = await prisma.user.findUnique({ where: { employeeId: customEmployeeId } });
      if (empIdExists) {
        return errorResponse(`Employee ID "${customEmployeeId}" is already in use`, 409);
      }
      generatedEmployeeId = customEmployeeId;
    } else {
      generatedEmployeeId = await generateNextEmployeeId(prisma);
    }

    // Create user + AM branch assignments in a transaction
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          mobileNumber,
          email: email || null,
          password: hashedPassword,
          firstName,
          lastName: lastName || '',
          role: effectiveRole,
          branchId: effectiveRole === 'AREA_MANAGER' ? null : (branchId || null),
          employeeId: generatedEmployeeId,
          fatherName: fatherName || null,
          motherName: motherName || null,
          address: address || null,
          education: education || null,
          aadhaarNumber: aadhaarNumber || null,
          aadhaarDocUrl: aadhaarDocUrl || null,
          panNumber: panNumber || null,
          panDocUrl: panDocUrl || null,
          profilePhotoUrl: profilePhotoUrl || null,
          esiNumber: esiNumber || null,
          pfNumber: pfNumber || null,
          esiPfDocUrl: esiPfDocUrl || null,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          locationPhotoUrl: locationPhotoUrl || null,
          dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null,
        },
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
          dateOfJoining: true,
          branch: {
            select: { id: true, name: true, code: true },
          },
        },
      });
      // Note: rbacRole will be added after the RBAC assignment below

      // Create AM junction rows if branch assignments provided
      if (effectiveRole === 'AREA_MANAGER' && assignedBranchIds && assignedBranchIds.length > 0) {
        const effectivePrimary = primaryBranchId ?? assignedBranchIds[0];
        await Promise.all(
          assignedBranchIds.map((bid) =>
            tx.areaManagerBranch.create({
              data: {
                userId: newUser.id,
                branchId: bid,
                isPrimary: bid === effectivePrimary,
              },
            })
          )
        );
      }

      // Assign RBAC role via UserRoleAssignment if rbacRoleId provided
      let assignedRbacRole: { id: string; name: string; slug: string; color: string | null } | null = null;
      if (rbacRoleId) {
        const rbacRole = await tx.role.findUnique({ where: { id: rbacRoleId, isActive: true } });
        if (rbacRole) {
          assignedRbacRole = { id: rbacRole.id, name: rbacRole.name, slug: rbacRole.slug, color: rbacRole.color };
          // Use findFirst + create/update to avoid composite-key null issues
          const existingAssignment = await tx.userRoleAssignment.findFirst({
            where: { userId: newUser.id, roleId: rbacRole.id, branchId: null },
          });
          if (!existingAssignment) {
            await tx.userRoleAssignment.create({
              data: {
                userId:     newUser.id,
                roleId:     rbacRole.id,
                branchId:   null,
                isActive:   true,
                assignedBy: newUser.id, // self-assigned at creation time
              },
            });
          } else {
            await tx.userRoleAssignment.update({
              where: { id: existingAssignment.id },
              data:  { isActive: true },
            });
          }
        }
      }

      return { ...newUser, rbacRole: assignedRbacRole };
    });

      await bumpMasterDataVersion('employees');
      return successResponse(user, 'User created successfully', 201);
    } catch (error) {
      console.error('Error creating user:', error);
      return errorResponse(
        'Failed to create user',
        500
      );
    }
  })(request);
}

/**
 * GET /api/users
 * Fetch users
 * - Admin can fetch all users
 * - Branch Managers can only fetch FDOs from their branch
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);
      const role = searchParams.get('role');
      const branchId = searchParams.get('branchId');
      const isActive = searchParams.get('isActive');
      const search = searchParams.get('search')?.trim() || undefined;
      const searchField = searchParams.get('searchField');
      const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '10', 10)));

      const where: {
        role?: string | { in: string[] };
        branchId?: string | null | { in: string[] };
        isActive?: boolean;
        id?: string;
        OR?: Record<string, unknown>[];
      } = {};

      // Branch Managers can fetch all users from their branch
      if (user.role === 'BRANCH_MANAGER') {
        const userRecord = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });

        if (!userRecord || !userRecord.branchId) {
          return successResponse({ users: [], totalCount: 0, totalPages: 0, page, pageSize }, 'No users found');
        }

        // Branch Managers can see all users from their branch
        where.branchId = userRecord.branchId;

        // Allow role filter if provided, but only for their branch. With no
        // explicit filter, default to BM/FDO only — mirrors the restriction
        // the UI has always applied (a branch shouldn't surface e.g. stray
        // ADMIN rows that happen to carry this branchId).
        if (role) {
          where.role = role;
        } else {
          where.role = { in: ['BRANCH_MANAGER', 'FDO'] };
        }
      } else if (user.role === 'ADMIN' || user.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || user.role === 'AREA_MANAGER') {
        // Admins (incl. non-HO-branch admins) can fetch all users with filters
        if (role) {
          where.role = role;
        }

        if (user.role === 'AREA_MANAGER') {
          // Area Managers are scoped to their assigned branches — this was
          // previously enforced only client-side; enforcing it here keeps
          // pagination correct while preserving identical visible results.
          const permittedBranchIds = await getPermittedBranchIds(user);
          const assignedBranchIds = permittedBranchIds ?? [];
          if (assignedBranchIds.length === 0) {
            return successResponse({ users: [], totalCount: 0, totalPages: 0, page, pageSize }, 'Users fetched successfully');
          }
          if (branchId && assignedBranchIds.includes(branchId)) {
            where.branchId = branchId;
          } else if (branchId) {
            // Requested branch outside the AM's assigned set — no possible matches.
            return successResponse({ users: [], totalCount: 0, totalPages: 0, page, pageSize }, 'Users fetched successfully');
          } else {
            where.branchId = { in: assignedBranchIds };
          }
        } else if (branchId) {
          where.branchId = branchId;
        }
      } else if (user.role === 'FDO') {
        // FDO can only fetch their own record
        where.id = user.userId;
      } else if (user.role === 'QC' || user.role === 'DIVISION_MANAGER') {
        // QC and Division Manager can list users filtered by a specific branch
        // (needed for Audit Tool officer/supervisor dropdowns).
        if (branchId) {
          where.branchId = branchId;
        } else {
          // No branch filter provided — return empty list rather than all users
          return successResponse({ users: [], totalCount: 0, totalPages: 0, page, pageSize }, 'Users fetched successfully');
        }
      } else if (user.branchId && (await isHeadOfficeBranch(user.branchId))) {
        // Any other Head-Office-based role (e.g. a dynamic-RBAC "Zonal
        // Head"/"Division Manager" custom role) gets the same listing as
        // ADMIN. The frontend already gates which admin pages such a role
        // can reach via RBAC page permissions, and the reset-password POST
        // route (app/api/users/[id]/reset-password) already allows any
        // non-FDO/non-BRANCH_MANAGER role to reset any user's password —
        // restricting this read-only picker list would only break that UI
        // without adding real protection.
        if (role) {
          where.role = role;
        }
        if (branchId) {
          where.branchId = branchId;
        }
      } else {
        // Other roles don't have permission to fetch users
        return errorResponse('Insufficient permissions', 403);
      }

      if (isActive !== null) {
        where.isActive = isActive === 'true';
      } else {
        // Default to active users only
        where.isActive = true;
      }

      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          // Always searchable regardless of searchField — callers pass a fixed
          // searchField (e.g. 'mobile') for their own default column, but a
          // search box with no field selector (employees/management) still
          // needs employeeId lookups (e.g. "ST049") to work.
          { employeeId: { contains: search, mode: 'insensitive' } },
          ...(searchField === 'mobile' ? [{ mobileNumber: { contains: search } }] : []),
          ...(searchField === 'email' ? [{ email: { contains: search, mode: 'insensitive' } }] : []),
        ];
      }

      const [totalCount, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
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
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            // Include active RBAC role assignments so the UI can display
            // custom role names (e.g. "Gold Loan Officer") instead of the
            // legacy enum fallback (e.g. "FDO").
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
          orderBy: [
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // Flatten: expose the first active RBAC role as `rbacRole`
      const mapped = users.map(({ userRoles, ...u }) => ({
        ...u,
        rbacRole: userRoles[0]?.role ?? null,
      }));

      return successResponse(
        { users: mapped, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
        'Users fetched successfully'
      );
    } catch (error) {
      console.error('Error fetching users:', error);
      return errorResponse(
        'Failed to fetch users',
        500
      );
    }
  })(request);
}
