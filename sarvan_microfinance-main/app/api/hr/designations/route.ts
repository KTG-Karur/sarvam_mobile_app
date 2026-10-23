import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const designationSchema = z.object({
    name: z.string().trim().min(1, 'Designation name is required'),
    code: z.string().trim().min(1, 'Designation code is required'),
    grade: z.number().int().optional().nullable(),
    defaultRoleSlug: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    // Payroll CTC split — Basic/HRA are derived from Month CTC Pay using these
    // percentages (Salary Master page). Must sum to exactly 100.
    basicPercent: z.number().min(0).max(100).optional(),
    hraPercent: z.number().min(0).max(100).optional(),
}).refine(
    (data) => {
        if (data.basicPercent === undefined && data.hraPercent === undefined) return true;
        const basic = data.basicPercent ?? 70;
        const hra = data.hraPercent ?? 30;
        return Math.abs(basic + hra - 100) < 0.01;
    },
    { message: 'Basic % and HRA % must sum to 100', path: ['hraPercent'] }
);

// GET /api/hr/designations
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const { searchParams } = new URL(request.url);
            const includeInactive = searchParams.get('includeInactive') === 'true';

            const designations = await prisma.designation.findMany({
                where: includeInactive ? {} : { isActive: true },
                orderBy: { name: 'asc' },
            });

            return successResponse(designations, 'Designations fetched successfully');
        } catch (error: any) {
            console.error('Error fetching designations:', error);
            return errorResponse(error.message || 'Failed to fetch designations', 500);
        }
    })(request);
}

// POST /api/hr/designations
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const data = designationSchema.parse(body);

            const existing = await prisma.designation.findFirst({
                where: {
                    isActive: true,
                    OR: [
                        { name: { equals: data.name, mode: 'insensitive' } },
                        { code: { equals: data.code, mode: 'insensitive' } },
                    ],
                },
            });
            if (existing) {
                return errorResponse('An active designation with this name or code already exists', 409);
            }

            const defaultRoleSlug = data.defaultRoleSlug?.trim() || null;
            if (defaultRoleSlug) {
                const role = await prisma.role.findFirst({
                    where: { slug: defaultRoleSlug, isActive: true },
                });
                if (!role) {
                    return errorResponse(`Role with slug "${defaultRoleSlug}" not found or inactive`, 400);
                }
            }

            const designation = await prisma.designation.create({
                data: {
                    ...data,
                    defaultRoleSlug,
                },
            });
            return successResponse(designation, 'Designation created successfully', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error creating designation:', error);
            return errorResponse(error.message || 'Failed to create designation', 500);
        }
    })(request);
}

// PUT /api/hr/designations?id=
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Designation ID is required', 400);

            const body = await req.json();
            const data = designationSchema.parse(body);

            const duplicate = await prisma.designation.findFirst({
                where: {
                    id: { not: id },
                    isActive: true,
                    OR: [
                        { name: { equals: data.name, mode: 'insensitive' } },
                        { code: { equals: data.code, mode: 'insensitive' } },
                    ],
                },
            });
            if (duplicate) {
                // See departments/route.ts PUT for why this is split on the
                // false->true transition specifically.
                if (data.isActive === true) {
                    const current = await prisma.designation.findUnique({ where: { id }, select: { isActive: true } });
                    if (current && !current.isActive) {
                        return errorResponse(`${data.name} cannot be reactivated — an active record already uses this name/code`, 409);
                    }
                }
                return errorResponse('An active designation with this name or code already exists', 409);
            }

            const defaultRoleSlug = data.defaultRoleSlug?.trim() || null;
            if (defaultRoleSlug) {
                const role = await prisma.role.findFirst({
                    where: { slug: defaultRoleSlug, isActive: true },
                });
                if (!role) {
                    return errorResponse(`Role with slug "${defaultRoleSlug}" not found or inactive`, 400);
                }
            }

            const designation = await prisma.designation.update({
                where: { id },
                data: {
                    ...data,
                    defaultRoleSlug,
                },
            });
            return successResponse(designation, 'Designation updated successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating designation:', error);
            return errorResponse(error.message || 'Failed to update designation', 500);
        }
    })(request);
}

// DELETE /api/hr/designations?id=[&permanent=true]
// Default: soft-deactivate (isActive: false) — always safe regardless of how
// many employees currently reference it; existing employees keep their
// historical designationId untouched, they just stop seeing it offered for
// NEW assignments.
// ?permanent=true: actually removes the row. Only allowed when zero
// employees reference it (User.designationId is a real FK — deleting while
// referenced would violate it), since there is no reassignment UI to fall
// back on here.
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Designation ID is required', 400);

            const permanent = searchParams.get('permanent') === 'true';
            if (permanent) {
                const inUse = await prisma.user.count({ where: { designationId: id } });
                if (inUse > 0) {
                    return errorResponse(
                        `Cannot permanently delete: ${inUse} employee(s) still reference this designation. Reassign them to a different designation first.`,
                        409
                    );
                }
                // Promotions and onboarding requests hold real FKs to a designation too —
                // without this the delete would die on a raw constraint error.
                const [promotions, onboarding] = await Promise.all([
                    prisma.employeePromotion.count({ where: { OR: [{ fromDesignationId: id }, { toDesignationId: id }] } }),
                    prisma.employeeOnboardingRequest.count({ where: { designationId: id } }),
                ]);
                if (promotions + onboarding > 0) {
                    return errorResponse(
                        `Cannot permanently delete: it is still referenced by ${promotions} promotion record(s) and ${onboarding} onboarding request(s). Deactivate it instead.`,
                        409
                    );
                }
                await prisma.designation.delete({ where: { id } });
                return successResponse(null, 'Designation permanently deleted');
            }

            await prisma.designation.update({ where: { id }, data: { isActive: false } });
            return successResponse(null, 'Designation deactivated successfully');
        } catch (error: any) {
            console.error('Error deleting designation:', error);
            return errorResponse(error.message || 'Failed to deactivate designation', 500);
        }
    })(request);
}
