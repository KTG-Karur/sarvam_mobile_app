import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { buildFdoCenterScope } from '@/app/lib/filters/fdo-center-scope';
import { generateNextCenterCode } from '@/app/lib/services/center-code.service';
import { findConflictingCenterSchedule } from '@/app/lib/services/center-schedule.service';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { cachedMasterData, stableParamsKey, bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

/**
 * Create center schema
 */
const createCenterSchema = z.object({
    name: z.string().min(1, 'Center name is required').max(200, 'Center name is too long'),
    code: z.string().regex(/^\d+$/, 'Center ID must be numeric only').optional(),
    address: z.string().optional().nullable(),
    localArea: z.string().optional().nullable(),
    branchId: z.string().min(1, 'Branch ID is required'),
    fdoId: z.string().optional(),
    formationDate: z.string().optional(),
    meetingDay: z.string().optional(),
    meetingTime: z.string().optional(),
    meetingPlace: z.string().optional().nullable(),
    latitude: z.number({ required_error: 'Latitude is required' }),
    longitude: z.number({ required_error: 'Longitude is required' }),
    status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
    centerLeaderId: z.string().optional().nullable(),
    kmFromBranch: z.number().optional().nullable(),
    contactPerson: z.string().optional().nullable(),
    contactNumber: z.string().optional().nullable(),
});

/**
 * @swagger
 * /api/centers:
 *   get:
 *     tags:
 *       - Centers
 *     summary: List Centers
 *     description: |
 *       Fetch centers with role-based filtering:
 *       - **BRANCH_MANAGER**: Only sees centers from their branch
 *       - **ADMIN**: Can fetch all centers, optional branch filter
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Filter by branch ID (Admin only)
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *         description: Include inactive centers
 *     responses:
 *       200:
 *         description: Centers fetched successfully
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
 *                     $ref: '#/components/schemas/Center'
 *   post:
 *     tags:
 *       - Centers
 *     summary: Create Center
 *     description: Create a new center. **Branch Manager only.** Center is created with PENDING_APPROVAL status.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - code
 *               - branchId
 *               - fdoId
 *             properties:
 *               name:
 *                 type: string
 *                 example: Center A
 *               code:
 *                 type: string
 *                 example: CA001
 *               address:
 *                 type: string
 *                 nullable: true
 *               branchId:
 *                 type: string
 *               fdoId:
 *                 type: string
 *                 description: FDO to assign to the center
 *               formationDate:
 *                 type: string
 *                 format: date
 *               meetingDay:
 *                 type: string
 *                 example: Monday
 *               meetingTime:
 *                 type: string
 *                 example: "10:00 AM"
 *               meetingPlace:
 *                 type: string
 *                 nullable: true
 *               latitude:
 *                 type: number
 *                 nullable: true
 *               longitude:
 *                 type: number
 *                 nullable: true
 *     responses:
 *       201:
 *         description: Center created successfully
 *       400:
 *         description: Invalid data or FDO not in same branch
 *       403:
 *         description: Branch Manager access required
 *       409:
 *         description: Center code already exists
 */

/**
 * GET /api/centers
 * Fetch centers
 * - Branch Managers can only fetch centers from their branch
 * - Admins can fetch all centers
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        const { searchParams } = new URL(req.url);
        const minimal = searchParams.get('minimal') === 'true';
        // Pagination is strictly opt-in: only callers that explicitly pass `page` get the
        // paginated `{centers, totalCount, ...}` envelope. Every other existing caller of
        // this shared endpoint (there are many — dropdowns, report filters, etc.) keeps
        // getting the original bare-array response, completely unchanged.
        const paginate = searchParams.has('page');
        const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
        const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '10', 10)));

        try {
            const branchId = searchParams.get('branchId');
            const includeInactive = searchParams.get('includeInactive') === 'true';

            // Build where clause
            const where: any = {};

            // Branch Managers can only see centers from their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    // Return empty array instead of error if user has no branch
                    return successResponse(
                        minimal ? [] : paginate ? { centers: [], totalCount: 0, totalPages: 0, page, pageSize } : [],
                        'No centers found'
                    );
                }

                where.branchId = userRecord.branchId;
            } else if (user.role === 'FDO') {
                // FDOs can only see centers directly assigned to them via Center.fdoId
                Object.assign(where, buildFdoCenterScope(user));
            } else {
                // ADMIN and AREA_MANAGER or other roles — resolve against the caller's
                // permitted branch(es) so an AREA_MANAGER can't pass an arbitrary
                // branchId to see centers outside their assigned branches.
                const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
                if (scopedBranchIds) {
                    where.branchId = scopedBranchIds.length === 1 ? scopedBranchIds[0] : { in: scopedBranchIds };
                }
            }

            if (!includeInactive) {
                where.isActive = true;
            }

            // Lightweight, unpaginated fetch used only to populate the center-picker
            // dropdown — always reflects every center in scope, independent of the
            // main table's search/status/centerId filters and pagination.
            //
            // Cached keyed on the fully-resolved `where` (post role-scoping), not on
            // role/userId — two callers only ever share a cache entry when their
            // effective filter is byte-identical, so a BRANCH_MANAGER can't ever be
            // served another branch's centers, and a BM/FDO reassignment can't serve
            // a stale scope either (the resolved `where` itself changes).
            if (minimal) {
                const minimalCenters = await cachedMasterData(
                    'centers:minimal',
                    stableParamsKey(where as Record<string, unknown>),
                    () => prisma.center.findMany({
                        where,
                        select: { id: true, name: true, code: true },
                        orderBy: { name: 'asc' },
                    })
                );
                return successResponse(minimalCenters, 'Centers fetched successfully');
            }

            // Optional status filter — allows operational modules to request only APPROVED centers
            const statusFilter = searchParams.get('status');
            if (statusFilter) {
                where.status = statusFilter;
            }

            if (paginate) {
                // Optional exact-id filter — powers the "jump to one specific center" picker
                const centerId = searchParams.get('centerId');
                if (centerId) {
                    where.id = centerId;
                }

                const search = searchParams.get('search')?.trim();
                if (search) {
                    where.OR = [
                        { name: { contains: search, mode: 'insensitive' } },
                        { code: { contains: search, mode: 'insensitive' } },
                        { address: { contains: search, mode: 'insensitive' } },
                        { fdo: { firstName: { contains: search, mode: 'insensitive' } } },
                        { fdo: { lastName: { contains: search, mode: 'insensitive' } } },
                        { createdBy: { firstName: { contains: search, mode: 'insensitive' } } },
                        { createdBy: { lastName: { contains: search, mode: 'insensitive' } } },
                    ];
                }
            }

            const select = {
                id: true,
                name: true,
                code: true,
                address: true,
                localArea: true,
                branchId: true,
                status: true,
                fdoId: true,
                rejectionReason: true,
                approvedById: true,
                approvedAt: true,
                formationDate: true,
                nextMeetingDate: true,
                meetingDay: true,
                meetingTime: true,
                meetingPlace: true,
                latitude: true,
                longitude: true,
                kmFromBranch: true,
                contactPerson: true,
                contactNumber: true,
                centerLeaderId: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        clients: { where: { isActive: true } },
                    },
                },
                createdBy: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                fdo: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                    },
                },
                centerLeader: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        clientId: true,
                    },
                },
                approvedBy: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            } as const;

            const mapWithFdo = (rows: Array<{ fdo: { firstName: string; lastName: string } | null; createdBy: { firstName: string; lastName: string } | null; _count: { clients: number } }>) =>
                rows.map((center) => ({
                    ...center,
                    fdoName: center.fdo
                        ? `${center.fdo.firstName} ${center.fdo.lastName}`
                        : center.createdBy
                            ? `${center.createdBy.firstName} ${center.createdBy.lastName}`
                            : null,
                    clientCount: center._count.clients,
                }));

            if (!paginate) {
                // Legacy behavior — every existing non-CenterList caller gets this,
                // completely unchanged: full unpaginated array, original ordering.
                const centers = await prisma.center.findMany({
                    where,
                    select,
                    orderBy: { createdAt: 'desc' },
                });
                return successResponse(mapWithFdo(centers as any), 'Centers fetched successfully');
            }

            const [totalCount, centers] = await Promise.all([
                prisma.center.count({ where }),
                prisma.center.findMany({
                    where,
                    select,
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'asc' },
                    ],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
            ]);

            return successResponse(
                { centers: mapWithFdo(centers as any), totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                'Centers fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching centers:', error);
            // Return empty result on error instead of failing
            return successResponse(
                minimal ? [] : paginate ? { centers: [], totalCount: 0, totalPages: 0, page, pageSize } : [],
                'No centers found'
            );
        }
    })(request);
}

/**
 * POST /api/centers
 * Create a new center (FDO or Admin only). FDO is auto-assigned from the logged-in user.
 */
export async function POST(request: NextRequest) {
    return withRole(['FDO', 'ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            console.log('Received center creation request:', { body, userId: user.userId, role: user.role });

            // Validate request body
            const validationResult = createCenterSchema.safeParse(body);
            if (!validationResult.success) {
                console.error('Validation failed:', validationResult.error.errors);
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const data = validationResult.data;
            console.log('Validation passed, data:', data);

            // Auto-derive fdoId: FDO creates for themselves; Admin may supply one or leave null
            const fdoId = user.role === 'FDO' ? user.userId : (data.fdoId ?? null);

            let branchId: string;

            if (user.role === 'ADMIN') {
                // CenterForm's branch selector is page-local (it no longer switches the
                // session's active branch), so honor the branch it sends in the body;
                // ADMIN may create in any branch. Fall back to the session branch.
                const resolvedAdminBranchId = data.branchId || user.branchId;
                if (!resolvedAdminBranchId) {
                    return errorResponse('No active branch selected. Please select a branch first.', 403);
                }
                branchId = resolvedAdminBranchId;
            } else {
                // FDO: always resolve live from the DB — their JWT branchId can be stale
                // across the 72hr access-token lifetime if reassigned to a different branch.
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    return errorResponse('User is not assigned to a branch', 403);
                }

                branchId = userRecord.branchId;
            }

            // Verify branch exists
            const branch = await prisma.branch.findUnique({
                where: { id: branchId },
                select: { id: true, code: true }
            });

            if (!branch) {
                return errorResponse('Branch not found', 404);
            }

            // Auto-generate center code if not provided or if empty string.
            // Scoped per-branch ("{branchCode}-C{seq}") so every branch independently
            // numbers its own centers starting from 1 — matches the bulk-upload scheme.
            const providedCode = (data.code ?? '').trim();
            let finalCode: string = providedCode || await generateNextCenterCode(branchId);

            // Validate fdoId only when Admin explicitly provides one (FDO auto-sets themselves)
            if (fdoId && user.role !== 'FDO') {
                const fdo = await prisma.user.findUnique({
                    where: { id: fdoId },
                    select: { id: true, role: true, branchId: true },
                });

                if (!fdo) {
                    return errorResponse('FDO not found', 404);
                }

                if (fdo.role !== 'FDO') {
                    return errorResponse('Selected user is not an FDO', 400);
                }

                if (fdo.branchId !== branchId) {
                    return errorResponse('FDO does not belong to the same branch', 400);
                }
            }

            // Block assigning this FDO to a second center at the same meeting day + time
            if (fdoId && data.meetingDay && data.meetingTime) {
                const scheduleConflict = await findConflictingCenterSchedule({
                    fdoId,
                    meetingDay: data.meetingDay,
                    meetingTime: data.meetingTime,
                });

                if (scheduleConflict) {
                    return errorResponse(
                        'This FDO already has a meeting time assigned for this meeting day. Please choose another meeting time or meeting day.',
                        409
                    );
                }
            }

            // Verify uniqueness of finalCode within this branch (codes may repeat across branches)
            const existingCenter = await prisma.center.findFirst({
                where: { branchId, code: finalCode },
            });

            if (existingCenter) {
                return errorResponse('A center with this ID already exists in this branch. Please use a different ID.', 409);
            }

            // Create center using Prisma relation syntax
            const centerData: Prisma.CenterCreateInput = {
                name: data.name.trim(),
                code: finalCode,
                address: data.address?.trim() || null,
                localArea: data.localArea?.trim() || null,
                branch: { connect: { id: branchId } },
                createdBy: { connect: { id: user.userId } },
                fdo: fdoId ? { connect: { id: fdoId } } : undefined,
                formationDate: data.formationDate ? new Date(data.formationDate) : null,
                meetingDay: data.meetingDay?.trim() || null,
                meetingTime: data.meetingTime?.trim() || null,
                meetingPlace: data.meetingPlace?.trim() || null,
                latitude: data.latitude || null,
                longitude: data.longitude || null,
                kmFromBranch: data.kmFromBranch ?? null,
                contactPerson: data.contactPerson?.trim() || null,
                contactNumber: data.contactNumber?.trim() || null,
                status: 'PENDING_APPROVAL', // Always set to pending approval
                isActive: true,
                centerLeader: data.centerLeaderId ? { connect: { id: data.centerLeaderId } } : undefined,
            };

            console.log('Creating center with data:', centerData);

            const center = await prisma.center.create({
                data: centerData,
                select: {
                    id: true,
                    name: true,
                    code: true,
                    address: true,
                    branchId: true,
                    status: true,
                    fdoId: true,
                    formationDate: true,
                    nextMeetingDate: true,
                    meetingDay: true,
                    meetingTime: true,
                    meetingPlace: true,
                    latitude: true,
                    longitude: true,
                    localArea: true,
                    kmFromBranch: true,
                    contactPerson: true,
                    contactNumber: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                    createdBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    fdo: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                },
            });

            // Live Employee Tracking: soft-capture pointer at the moment this
            // center was created, reusing the same GPS just stored above —
            // never blocks center creation itself.
            if (center.latitude != null && center.longitude != null) {
                prisma.employeeTrackingEvent.create({
                    data: {
                        employeeId: user.userId,
                        eventType: 'CENTER_CREATED',
                        latitude: center.latitude,
                        longitude: center.longitude,
                        centerId: center.id,
                        branchId: center.branchId,
                        label: `Created center "${center.name}"`,
                    },
                }).catch((err: unknown) => console.error('[Center Create] Failed to record tracking event:', err));
            }

            await bumpMasterDataVersion('centers:minimal');
            return successResponse(center, 'Center created successfully', 201);
        } catch (error) {
            console.error('Error creating center - Full error:', error);
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');

            // Handle Prisma errors
            if (error instanceof Error) {
                const errorMessage = error.message;
                console.error('Error message:', errorMessage);
                console.error('Error name:', error.name);

                // Check for Prisma error codes
                if ('code' in error) {
                    console.error('Prisma error code:', (error as any).code);
                    if ((error as any).code === 'P2002') {
                        // Unique constraint — tell user to retry (code collision on concurrent creation)
                        return errorResponse('A center with the auto-generated code already exists. Please try again.', 409);
                    }
                    if ((error as any).code === 'P2003') {
                        return errorResponse('Invalid Branch ID or FDO ID provided.', 400);
                    }
                }

                // Unique constraint violation (non-Prisma path)
                if (errorMessage.includes('Unique constraint') || errorMessage.includes('Unique') || errorMessage.includes('duplicate')) {
                    return errorResponse('A center with this code already exists. Please try again.', 409);
                }

                // Foreign key constraint violation
                if (errorMessage.includes('Foreign key constraint') || errorMessage.includes('Foreign key') || errorMessage.includes('relation')) {
                    return errorResponse('Invalid branch or user reference. Please verify the branch and FDO exist.', 400);
                }

                // Invalid field error
                if (errorMessage.includes('Unknown argument') || errorMessage.includes('Unknown field') || errorMessage.includes('Invalid value') || errorMessage.includes('Unknown arg')) {
                    console.error('Prisma schema mismatch:', errorMessage);
                    return errorResponse(`Database schema error: ${errorMessage}. Please contact administrator.`, 500);
                }

                // Return the actual error message for debugging
                // This will help identify the exact issue
                return errorResponse(`Failed to create center: ${errorMessage}`, 500);
            }

            return errorResponse('Failed to create center: Unknown error occurred', 500);
        }
    })(request);
}

