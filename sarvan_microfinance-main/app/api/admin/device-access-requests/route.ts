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
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search');
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const skip = (page - 1) * limit;

      const where: any = {};

      if (status && status !== 'ALL') {
        where.status = status;
      }

      if (search) {
        where.OR = [
          { employeeId: { contains: search, mode: 'insensitive' } },
          { deviceId: { contains: search, mode: 'insensitive' } },
          { deviceName: { contains: search, mode: 'insensitive' } },
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

      const [totalCount, requests] = await Promise.all([
        prisma.deviceAccessRequest.count({ where }),
        prisma.deviceAccessRequest.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
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
                mobileDeviceId: true,
                branch: { select: { id: true, name: true, code: true } },
              },
            },
            reviewedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      ]);

      return successResponse(
        {
          requests,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        },
        'Device access requests fetched successfully'
      );
    } catch (error) {
      console.error('Error fetching device access requests:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to fetch device access requests',
        500
      );
    }
  })(request);
}
