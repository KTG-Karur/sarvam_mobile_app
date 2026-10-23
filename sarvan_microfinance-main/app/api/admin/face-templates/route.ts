import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    errorResponse,
    successResponse,
    withRole,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/admin/face-templates — list employees (branch-scoped) with their
// face enrollment status, for the "Trained Faces" admin page.
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const permittedBranchIds = await getPermittedBranchIds(user);

            const employees = await prisma.user.findMany({
                where: {
                    isActive: true,
                    ...(permittedBranchIds ? { branchId: { in: permittedBranchIds } } : {}),
                },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    branch: { select: { id: true, name: true, code: true } },
                    faceTemplate: {
                        select: {
                            id: true,
                            qualityScore: true,
                            livenessVerified: true,
                            photoKey: true,
                            capturedAt: true,
                            updatedAt: true,
                        },
                    },
                },
                orderBy: { firstName: 'asc' },
            });

            const result = employees.map((emp) => ({
                id: emp.id,
                employeeId: emp.employeeId || emp.id.substring(0, 8).toUpperCase(),
                firstName: emp.firstName,
                lastName: emp.lastName,
                role: emp.role,
                branchName: emp.branch?.name ?? null,
                branchCode: emp.branch?.code ?? null,
                trained: !!emp.faceTemplate,
                qualityScore: emp.faceTemplate?.qualityScore ?? null,
                livenessVerified: emp.faceTemplate?.livenessVerified ?? null,
                photoKey: emp.faceTemplate?.photoKey ?? null,
                capturedAt: emp.faceTemplate?.capturedAt ?? null,
            }));

            return successResponse(result, 'Face templates fetched successfully');
        } catch (error: unknown) {
            console.error('[Admin Face Templates GET] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch face templates';
            return errorResponse(message, 500);
        }
    })(request);
}
