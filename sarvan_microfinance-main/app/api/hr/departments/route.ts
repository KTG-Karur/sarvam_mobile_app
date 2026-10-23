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

const departmentSchema = z.object({
    name: z.string().trim().min(1, 'Department name is required'),
    code: z.string().trim().min(1, 'Department code is required'),
    isActive: z.boolean().optional(),
});

// GET /api/hr/departments
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const { searchParams } = new URL(request.url);
            const includeInactive = searchParams.get('includeInactive') === 'true';

            const departments = await prisma.department.findMany({
                where: includeInactive ? {} : { isActive: true },
                orderBy: { name: 'asc' },
            });

            return successResponse(departments, 'Departments fetched successfully');
        } catch (error: any) {
            console.error('Error fetching departments:', error);
            return errorResponse(error.message || 'Failed to fetch departments', 500);
        }
    })(request);
}

// POST /api/hr/departments
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const data = departmentSchema.parse(body);

            const existing = await prisma.department.findFirst({
                where: {
                    isActive: true,
                    OR: [
                        { name: { equals: data.name, mode: 'insensitive' } },
                        { code: { equals: data.code, mode: 'insensitive' } },
                    ],
                },
            });
            if (existing) {
                return errorResponse('An active department with this name or code already exists', 409);
            }

            const department = await prisma.department.create({ data });
            return successResponse(department, 'Department created successfully', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error creating department:', error);
            return errorResponse(error.message || 'Failed to create department', 500);
        }
    })(request);
}

// PUT /api/hr/departments?id=
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Department ID is required', 400);

            const body = await req.json();
            const data = departmentSchema.parse(body);

            const duplicate = await prisma.department.findFirst({
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
                // A false->true transition gets a specific "cannot be
                // reactivated" message rather than the generic duplicate
                // message — deactivating (isActive: false) never matches
                // this branch, so that direction is unaffected.
                if (data.isActive === true) {
                    const current = await prisma.department.findUnique({ where: { id }, select: { isActive: true } });
                    if (current && !current.isActive) {
                        return errorResponse(`${data.name} cannot be reactivated — an active record already uses this name/code`, 409);
                    }
                }
                return errorResponse('An active department with this name or code already exists', 409);
            }

            const department = await prisma.department.update({ where: { id }, data });
            return successResponse(department, 'Department updated successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating department:', error);
            return errorResponse(error.message || 'Failed to update department', 500);
        }
    })(request);
}

// DELETE /api/hr/departments?id=[&permanent=true]
// Default: soft-deactivate (isActive: false) — always safe regardless of how
// many employees currently reference it; existing employees keep their
// historical departmentId untouched, they just stop seeing it offered for
// NEW assignments.
// ?permanent=true: actually removes the row. Only allowed when zero
// employees reference it (User.departmentId is a real FK — deleting while
// referenced would violate it), since there is no reassignment UI to fall
// back on here.
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Department ID is required', 400);

            const permanent = searchParams.get('permanent') === 'true';
            if (permanent) {
                const inUse = await prisma.user.count({ where: { departmentId: id } });
                if (inUse > 0) {
                    return errorResponse(
                        `Cannot permanently delete: ${inUse} employee(s) still reference this department. Reassign them to a different department first.`,
                        409
                    );
                }
                // Transfers and onboarding requests hold real FKs to a department too —
                // without this the delete would die on a raw constraint error.
                const [transfers, onboarding] = await Promise.all([
                    prisma.employeeTransfer.count({ where: { OR: [{ fromDepartmentId: id }, { toDepartmentId: id }] } }),
                    prisma.employeeOnboardingRequest.count({ where: { departmentId: id } }),
                ]);
                if (transfers + onboarding > 0) {
                    return errorResponse(
                        `Cannot permanently delete: it is still referenced by ${transfers} transfer record(s) and ${onboarding} onboarding request(s). Deactivate it instead.`,
                        409
                    );
                }
                await prisma.department.delete({ where: { id } });
                return successResponse(null, 'Department permanently deleted');
            }

            await prisma.department.update({ where: { id }, data: { isActive: false } });
            return successResponse(null, 'Department deactivated successfully');
        } catch (error: any) {
            console.error('Error deleting department:', error);
            return errorResponse(error.message || 'Failed to delete department', 500);
        }
    })(request);
}
