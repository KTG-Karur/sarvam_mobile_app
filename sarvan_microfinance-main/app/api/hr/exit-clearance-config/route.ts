import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { ExitClearanceDepartment, EmployeeExitType } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth, withRole } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const DEPARTMENTS = ['BM_FIELD', 'AM_DIVISION', 'AUDIT', 'ACCOUNTS', 'IT', 'ADMIN', 'FINAL_HR'] as const;
const EXIT_TYPES = [
    'VOLUNTARY_RESIGNATION', 'ABSCONDING', 'ASK_TO_GO', 'APPOINTMENT_CANCELLATION',
    'TERMINATION', 'DECEASED', 'RETIREMENT',
] as const;

const configSchema = z.object({
    department: z.enum(DEPARTMENTS),
    itemName: z.string().trim().min(1, 'Item name is required'),
    exitTypes: z.array(z.enum(EXIT_TYPES)).optional().default([]),
    sortOrder: z.number().int().optional().default(0),
    isActive: z.boolean().optional(),
});

// GET /api/hr/exit-clearance-config
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const referencesForId = searchParams.get('referencesForId');
            if (referencesForId) {
                // Lists which employees' exit records use this item (names, codes,
                // branches) — an admin-page lookup, not something any signed-in user
                // should be able to enumerate across branches.
                if (user.role !== 'ADMIN') return errorResponse('Only an administrator can view clearance item references', 403);
                const referencingRecords = await prisma.employeeExitClearanceItem.findMany({
                    where: { configItemId: referencesForId },
                    include: {
                        exitRequest: {
                            include: {
                                employee: {
                                    include: {
                                        branch: true,
                                    },
                                },
                            },
                        },
                    },
                });

                const references = referencingRecords.map((r) => {
                    const emp = r.exitRequest?.employee;
                    const empName = emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Unknown';
                    const empCode = emp?.employeeId || 'No ID';
                    const branchName = emp?.branch?.name || 'Unknown Branch';
                    return {
                        id: r.id,
                        exitRequestId: r.exitRequestId,
                        employeeId: emp?.id || '',
                        employeeCode: empCode,
                        employeeName: empName,
                        branchName,
                        clearanceStatus: r.status,
                        exitType: r.exitRequest?.exitType,
                        exitStatus: r.exitRequest?.status,
                    };
                });

                return successResponse(references, 'Clearance references fetched successfully');
            }

            const includeInactive = searchParams.get('includeInactive') === 'true';
            const items = await prisma.exitClearanceItemConfig.findMany({
                where: includeInactive ? {} : { isActive: true },
                orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }],
            });
            return successResponse(items, 'Exit clearance config fetched successfully');
        } catch (error: unknown) {
            console.error('Error fetching exit clearance config:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch exit clearance config';
            return errorResponse(message, 500);
        }
    })(request);
}

// POST /api/hr/exit-clearance-config
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const data = configSchema.parse(body);

            const existing = await prisma.exitClearanceItemConfig.findFirst({
                where: {
                    department: data.department as ExitClearanceDepartment,
                    itemName: { equals: data.itemName, mode: 'insensitive' },
                    isActive: true,
                },
            });
            if (existing) {
                return errorResponse('An active clearance item with this name already exists for the selected department', 409);
            }

            const item = await prisma.exitClearanceItemConfig.create({
                data: {
                    ...data,
                    department: data.department as ExitClearanceDepartment,
                    exitTypes: data.exitTypes as EmployeeExitType[],
                },
            });
            return successResponse(item, 'Exit clearance item created successfully', 201);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error creating exit clearance item:', error);
            const message = error instanceof Error ? error.message : 'Failed to create exit clearance item';
            return errorResponse(message, 500);
        }
    })(request);
}

// PUT /api/hr/exit-clearance-config?id=
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Item ID is required', 400);

            const body = await req.json();
            const data = configSchema.parse(body);

            const duplicate = await prisma.exitClearanceItemConfig.findFirst({
                where: {
                    id: { not: id },
                    department: data.department as ExitClearanceDepartment,
                    itemName: { equals: data.itemName, mode: 'insensitive' },
                    isActive: true,
                },
            });
            if (duplicate) {
                if (data.isActive === true) {
                    const current = await prisma.exitClearanceItemConfig.findUnique({
                        where: { id },
                        select: { isActive: true },
                    });
                    if (current && !current.isActive) {
                        return errorResponse(`${data.itemName} cannot be reactivated — an active record already uses this name`, 409);
                    }
                }
                return errorResponse('An active clearance item with this name already exists for the selected department', 409);
            }

            const item = await prisma.exitClearanceItemConfig.update({
                where: { id },
                data: {
                    ...data,
                    department: data.department as ExitClearanceDepartment,
                    exitTypes: data.exitTypes as EmployeeExitType[],
                },
            });
            return successResponse(item, 'Exit clearance item updated successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating exit clearance item:', error);
            const message = error instanceof Error ? error.message : 'Failed to update exit clearance item';
            return errorResponse(message, 500);
        }
    })(request);
}

// DELETE /api/hr/exit-clearance-config?id=[&permanent=true]
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Item ID is required', 400);

            const permanent = searchParams.get('permanent') === 'true';
            if (permanent) {
                const referencingRecords = await prisma.employeeExitClearanceItem.findMany({
                    where: { configItemId: id },
                    include: {
                        exitRequest: {
                            include: {
                                employee: {
                                    include: {
                                        branch: true,
                                    },
                                },
                            },
                        },
                    },
                });

                if (referencingRecords.length > 0) {
                    const references = referencingRecords.map((r) => {
                        const emp = r.exitRequest?.employee;
                        const empName = emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Unknown';
                        const empCode = emp?.employeeId || 'No ID';
                        const branchName = emp?.branch?.name || 'Unknown Branch';
                        return {
                            id: r.id,
                            exitRequestId: r.exitRequestId,
                            employeeId: emp?.id || '',
                            employeeCode: empCode,
                            employeeName: empName,
                            branchName,
                            clearanceStatus: r.status,
                            exitType: r.exitRequest?.exitType,
                            exitStatus: r.exitRequest?.status,
                        };
                    });

                    const empSummary = references
                        .map((ref) => `${ref.employeeName} (${ref.employeeCode})`)
                        .join(', ');

                    return errorResponse(
                        `Cannot permanently delete: ${referencingRecords.length} clearance record(s) still reference this item for employee(s): ${empSummary}.`,
                        409,
                        { references }
                    );
                }
                await prisma.exitClearanceItemConfig.delete({ where: { id } });
                return successResponse(null, 'Exit clearance item permanently deleted');
            }

            await prisma.exitClearanceItemConfig.update({ where: { id }, data: { isActive: false } });
            return successResponse(null, 'Exit clearance item deactivated successfully');
        } catch (error: unknown) {
            console.error('Error deactivating exit clearance item:', error);
            const message = error instanceof Error ? error.message : 'Failed to deactivate exit clearance item';
            return errorResponse(message, 500);
        }
    })(request);
}
