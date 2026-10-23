import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

export async function OPTIONS() { return handleCorsPreflight(); }

/**
 * GET /api/clients/location-approval
 * Returns clients grouped by location approval status for the BM's branch.
 * Query params:
 *   - status: 'PENDING_APPROVAL' | 'RELOCATION_REQUESTED' | 'APPROVED' | 'REJECTED' | 'all'
 *   - page, pageSize
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const statusFilter = searchParams.get('status') || 'all';
            const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
            const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20'));

            // Resolve BM's branch
            let branchId: string | null = null;
            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = u?.branchId ?? null;
                if (!branchId) return errorResponse('Your account has no branch assigned', 400);
            } else if (user.role === 'ADMIN') {
                branchId = searchParams.get('branchId');
            } else if (user.role === 'FDO') {
                const u = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = u?.branchId ?? null;
            } else {
                return errorResponse('Insufficient permissions', 403);
            }

            // Build where clause
            const where: any = {
                isActive: true,
                // only clients with latitude set (GPS captured during enrollment)
                latitude: { not: null },
            };

            if (branchId) {
                // Include center-assigned clients AND unassigned clients whose requested
                // center (Loan Details tab selection) is in this branch.
                where.OR = [
                    { center: { branchId } },
                    { centerId: null, requestedCenter: { branchId } },
                ];
            }

            if (statusFilter !== 'all') {
                where.locationApprovalStatus = statusFilter;
            }

            const [totalItems, clients] = await Promise.all([
                prisma.client.count({ where }),
                prisma.client.findMany({
                    where,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        permanentAddress: true,
                        latitude: true,
                        longitude: true,
                        locationApprovalStatus: true,
                        locationApprovedAt: true,
                        locationApprovalRemarks: true,
                        relocationRequestedAt: true,
                        relocationRemarks: true,
                        createdAt: true,
                        center: { select: { id: true, name: true, code: true } },
                        locationApprovedBy: { select: { id: true, firstName: true, lastName: true } },
                        relocationRequestedBy: { select: { id: true, firstName: true, lastName: true } },
                        kycDocuments: {
                            where: { documentType: { in: ['house_image_1', 'house_image_2', 'house_image_3', 'location_qr'] } },
                            select: { id: true, documentType: true, fileUrl: true },
                        },
                    },
                    orderBy: [
                        // Prioritise: RELOCATION_REQUESTED first, then PENDING_APPROVAL, then REJECTED, then APPROVED
                        { locationApprovalStatus: 'asc' },
                        { createdAt: 'desc' },
                        { id: 'asc' },
                    ],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
            ]);

            return successResponse({
                clients,
                pagination: {
                    currentPage: page,
                    pageSize,
                    totalItems,
                    totalPages: Math.ceil(totalItems / pageSize),
                },
            }, `Found ${totalItems} client(s)`);
        } catch (error) {
            console.error('Error fetching location approval list:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch', 500);
        }
    })(request);
}
