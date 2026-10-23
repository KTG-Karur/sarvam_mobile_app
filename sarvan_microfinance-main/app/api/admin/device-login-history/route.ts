import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const url = new URL(req.url);
      const userId = url.searchParams.get('userId');
      const search = url.searchParams.get('search');
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const skip = (page - 1) * limit;

      const where: any = {};

      if (userId) {
        where.userId = userId;
      }

      if (search) {
        where.OR = [
          { employeeId: { contains: search, mode: 'insensitive' } },
          { deviceId: { contains: search, mode: 'insensitive' } },
          { deviceName: { contains: search, mode: 'insensitive' } },
          { adminApprovalStatus: { contains: search, mode: 'insensitive' } },
          {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        ];
      }

      const [totalCount, history] = await Promise.all([
        prisma.deviceLoginHistory.count({ where }),
        prisma.deviceLoginHistory.findMany({
          where,
          orderBy: { loginAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: {
              select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                role: true,
                branch: { select: { name: true, code: true } },
              },
            },
          },
        }),
      ]);

      return successResponse(
        {
          history,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        },
        'Device login history fetched successfully'
      );
    } catch (error) {
      console.error('Error fetching device login history:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to fetch device login history',
        500
      );
    }
  })(request);
}
