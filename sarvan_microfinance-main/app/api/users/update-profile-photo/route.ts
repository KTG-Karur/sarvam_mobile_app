import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';

const schema = z.object({
  profilePhotoUrl: z.string().url('Invalid photo URL').min(1, 'Photo URL is required'),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  return withAuth(async (req, currentUser) => {
    try {
      const body = await req.json();
      const result = schema.safeParse(body);
      if (!result.success) {
        return errorResponse(result.error.errors[0]?.message || 'Invalid request', 400);
      }

      const { profilePhotoUrl } = result.data;

      const user = await prisma.user.findUnique({
        where: { id: currentUser.userId },
        select: { id: true, hasChangedProfilePhoto: true },
      });

      if (!user) return errorResponse('User not found', 404);

      if (user.hasChangedProfilePhoto) {
        return errorResponse('Profile photo has already been set. Please contact your administrator for further changes.', 403);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { profilePhotoUrl, hasChangedProfilePhoto: true },
      });

      return successResponse({ profilePhotoUrl }, 'Profile photo updated successfully');
    } catch (error) {
      console.error('Error updating profile photo:', error);
      return errorResponse('Failed to update profile photo', 500);
    }
  })(request);
}
