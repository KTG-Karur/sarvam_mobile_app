import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { comparePassword, hashPassword } from '@/app/lib/auth';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  return withAuth(async (req, currentUser) => {
    try {
      const body = await req.json();
      const result = changePasswordSchema.safeParse(body);
      if (!result.success) {
        return errorResponse(result.error.errors[0]?.message || 'Invalid request data', 400);
      }

      const { currentPassword, newPassword } = result.data;

      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
        select: { id: true, password: true, hasChangedPassword: true },
      });

      if (!user) return errorResponse('User not found', 404);

      if (user.hasChangedPassword) {
        return errorResponse('Password has already been changed. Please contact your administrator for further changes.', 403);
      }

      const isValid = await comparePassword(currentPassword, user.password);
      if (!isValid) return errorResponse('Current password is incorrect', 401);

      const hashed = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashed, hasChangedPassword: true },
      });

      return successResponse(null, 'Password changed successfully');
    } catch (error) {
      console.error('Error changing password:', error);
      return errorResponse('Failed to change password', 500);
    }
  })(request);
}
