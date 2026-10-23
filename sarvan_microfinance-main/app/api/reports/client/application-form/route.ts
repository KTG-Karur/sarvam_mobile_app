import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { assertFdoOwnsCenter, checkCenterAccess } from '@/app/lib/filters/fdo-center-scope';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import {
  applicationFormClientSelect,
  mapClientToApplicationFormRecord,
  resolveApplicationFormKycUrls,
} from '@/app/lib/reports/application-form-data';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/application-form
 * Query params: centerId
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }

            // If user is not ADMIN, check branch/center permission
            if (user.role !== 'ADMIN') {
                const centerRecord = await prisma.center?.findUnique({
                    where: { id: centerId },
                    select: { branchId: true, fdoId: true }
                });

                if (!centerRecord) {
                    return errorResponse('Center not found', 404);
                }

                if (user.role === 'FDO') {
                    if (!assertFdoOwnsCenter(user, centerRecord)) {
                        return errorResponse('Access denied to this center', 403);
                    }
                } else if (user.role === 'AREA_MANAGER') {
                    const assigned = await isAmAssignedToBranch(user.userId, centerRecord.branchId);
                    if (!assigned) {
                        return errorResponse('Access denied to this center', 403);
                    }
                } else {
                    const accessError = await checkCenterAccess(user, centerRecord);
                    if (accessError) {
                        return errorResponse('Access denied to this center', 403);
                    }
                }
            }

            const clients = await prisma.client.findMany({
                where: {
                    centerId: centerId,
                    isActive: true
                },
                select: applicationFormClientSelect,
                orderBy: [
                    { firstName: 'asc' },
                    { lastName: 'asc' },
                ]
            });

            const formattedClients = await resolveApplicationFormKycUrls(
                clients.map(mapClientToApplicationFormRecord)
            );

            return successResponse(formattedClients, 'Application forms fetched successfully');

        } catch (error) {
            console.error('[Application Form API] Error:', error);
            return errorResponse('Failed to fetch application forms', 500);
        }
    })(request);
}
