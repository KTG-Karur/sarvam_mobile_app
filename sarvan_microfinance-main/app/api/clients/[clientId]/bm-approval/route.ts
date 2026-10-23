import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/clients/[clientId]/bm-approval
 * Branch Manager approves or rejects client enrollment
 * 
 * @access BRANCH_MANAGER only
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
        try {
            const { clientId } = await params;
            const body = await req.json();
            const { decision, rejectionReason } = body;

            // Validate decision
            if (!['approve', 'reject'].includes(decision)) {
                return errorResponse('Invalid decision. Must be "approve" or "reject"', 400);
            }

            // Get client
            const client = await prisma.client.findUnique({
                where: { id: clientId },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    verificationStatus: true,
                    centerId: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { branchId: true } },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Verify BM is from the same branch
            const userRecord = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { branchId: true },
            });

            if (!userRecord || !userRecord.branchId) {
                return errorResponse('User is not assigned to a branch', 403);
            }

            if ((client.center?.branchId ?? client.enrolledBy?.branchId) !== userRecord.branchId) {
                return errorResponse('Client does not belong to your branch', 403);
            }

            // Check if already verified
            if (client.verificationStatus === 'VERIFIED') {
                return errorResponse('Client is already verified', 400);
            }

            // Update client verification status
            const updatedClient = await prisma.client.update({
                where: { id: clientId },
                data: {
                    verificationStatus: decision === 'approve' ? 'VERIFIED' : 'REJECTED',
                    verifiedById: user.userId,
                    verifiedAt: new Date(),
                    rejectionReason: decision === 'reject' ? rejectionReason : null,
                },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    verificationStatus: true,
                    verifiedAt: true,
                },
            });

            return successResponse(
                updatedClient,
                `Client ${decision === 'approve' ? 'approved' : 'rejected'} successfully`
            );
        } catch (error) {
            console.error('Error updating client approval:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to update client approval',
                500
            );
        }
    })(request);
}
