import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { ACTIVE_BRANCH_COOKIE_NAME } from '@/app/lib/branch-session';

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User Logout
 *     description: Logout the user by invalidating the refresh token. Clears authentication cookies.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token to invalidate (optional if using cookies)
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Logged out successfully
 *       500:
 *         description: Internal server error
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const refreshToken = body.refreshToken || request.cookies.get('refreshToken')?.value;

    // Delete refresh token from database
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    }

    const response = successResponse({ message: 'Logged out successfully' });

    // Clear cookies
    response.cookies.delete('accessToken');
    response.cookies.delete('refreshToken');
    response.cookies.delete(ACTIVE_BRANCH_COOKIE_NAME);

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

