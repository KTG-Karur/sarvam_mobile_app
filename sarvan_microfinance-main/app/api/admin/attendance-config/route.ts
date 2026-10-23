import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';
import { getFaceSettings, saveFaceSettings } from '@/app/lib/face-settings';
import { prisma } from '@/app/lib/prisma';

const faceSettingsSchema = z.object({
  faceAttendanceEnabled: z.boolean().optional(),
  faceTrainingEnabled: z.boolean().optional(),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(_request: NextRequest) {
  return withAuth(async (_req, _user) => {
    try {
      return successResponse(await getFaceSettings(), 'Attendance configuration retrieved successfully.');
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Failed to retrieve attendance config', 500);
    }
  })(_request);
}

export async function PUT(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'CAO', 'HRM', 'COO', 'ZH', 'BM', 'AM', 'AREA_MANAGER'];
      const userRole = (user.role || '').toUpperCase();

      // JWTPayload doesn't carry the RBAC role name — resolve the active custom role from the DB.
      const activeUserRole = await prisma.userRoleAssignment.findFirst({
        where: { userId: user.userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { role: { select: { name: true } } },
      });
      const rbacRole = (activeUserRole?.role?.name || '').toUpperCase();

      const isAllowed =
        userRole === 'ADMIN' ||
        userRole === 'SUPER_ADMIN' ||
        allowedRoles.includes(userRole) ||
        allowedRoles.includes(rbacRole);

      if (!isAllowed) {
        return errorResponse('Admin access required to update attendance configuration.', 403);
      }

      const body = faceSettingsSchema.parse(await req.json());
      const updated = await saveFaceSettings(body, user.userId);
      return successResponse(updated, 'Attendance configuration updated successfully.');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error instanceof Error ? error.message : 'Failed to update attendance config', 500);
    }
  })(request);
}
