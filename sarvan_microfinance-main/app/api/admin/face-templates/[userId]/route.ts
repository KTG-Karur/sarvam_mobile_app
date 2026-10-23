import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    errorResponse,
    successResponse,
    withRole,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getSignedReadUrl, deleteObject } from '@/app/lib/storage/gcs-client';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

async function assertInScope(user: Parameters<typeof getPermittedBranchIds>[0], branchId: string | null) {
    const permittedBranchIds = await getPermittedBranchIds(user);
    if (permittedBranchIds === null) return true; // unrestricted (HO admin)
    return branchId ? permittedBranchIds.includes(branchId) : false;
}

// GET /api/admin/face-templates/[userId] — detail view: signed photo URL +
// recent verification attempts, for the "Trained Faces" admin detail panel.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { userId } = await params;

            const employee = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    branchId: true,
                    branch: { select: { name: true, code: true } },
                    faceTemplate: true,
                },
            });

            if (!employee) return errorResponse('Employee not found', 404);
            if (!(await assertInScope(user, employee.branchId))) {
                return errorResponse('You do not have access to this employee', 403);
            }

            const photoUrl = employee.faceTemplate?.photoKey
                ? await getSignedReadUrl(employee.faceTemplate.photoKey)
                : null;

            const logs = await prisma.faceVerificationLog.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 20,
            });

            return successResponse({
                id: employee.id,
                employeeId: employee.employeeId,
                firstName: employee.firstName,
                lastName: employee.lastName,
                role: employee.role,
                branchName: employee.branch?.name ?? null,
                trained: !!employee.faceTemplate,
                qualityScore: employee.faceTemplate?.qualityScore ?? null,
                livenessVerified: employee.faceTemplate?.livenessVerified ?? null,
                capturedAt: employee.faceTemplate?.capturedAt ?? null,
                photoUrl,
                recentLogs: logs,
            });
        } catch (error: unknown) {
            console.error('[Admin Face Template Detail] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to fetch face template';
            return errorResponse(message, 500);
        }
    })(request);
}

// DELETE /api/admin/face-templates/[userId] — revoke an employee's trained
// face & clear today's punch attendance so they are forced to re-enroll before next punch attempt.
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { userId } = await params;

            const employee = await prisma.user.findUnique({
                where: { id: userId },
                select: { branchId: true, faceTemplate: { select: { photoKey: true } } },
            });
            if (!employee) return errorResponse('Employee not found', 404);
            if (!(await assertInScope(user, employee.branchId))) {
                return errorResponse('You do not have access to this employee', 403);
            }

            const now = new Date();
            const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(now, 'Asia/Kolkata');

            await Promise.all([
                prisma.faceTemplate.deleteMany({ where: { userId } }),
                prisma.attendance.deleteMany({ where: { userId } }),
                prisma.faceVerificationLog.deleteMany({ where: { userId } }),
            ]);

            if (employee.faceTemplate?.photoKey) {
                await deleteObject(employee.faceTemplate.photoKey).catch(() => null);
            }

            return successResponse(null, 'Face enrollment revoked and today attendance record cleared. Employee must re-register.');
        } catch (error: unknown) {
            console.error('[Admin Face Template Delete] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to revoke face template';
            return errorResponse(message, 500);
        }
    })(request);
}
