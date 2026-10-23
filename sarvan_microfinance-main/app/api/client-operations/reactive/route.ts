// app/api/client-operations/reactive/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Validation schema for client reactivation
 */
const clientReactiveSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    centerId: z.string().min(1, 'Center ID is required'),
});

/**
 * POST /api/client-operations/reactive
 * Reactivate an inactive client
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();

            // Validate request body
            const validationResult = clientReactiveSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const data = validationResult.data;

            // Check if the client exists
            const existingClient = await prisma.client.findUnique({
                where: { id: data.clientId },
                select: {
                    id: true,
                    centerId: true,
                    isActive: true,
                    inactiveDate: true,
                    dropoutReason: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                },
            });

            if (!existingClient) {
                return errorResponse('Client not found', 404);
            }

            const lockResponse = await assertBranchNotLocked(existingClient.center?.branchId ?? '');
            if (lockResponse) {
                return lockResponse;
            }

            // Check if client is already active
            if (existingClient.isActive) {
                return errorResponse('Client is already active', 400);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || existingClient.center?.branchId !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            } else if (user.role === 'FDO') {
                return errorResponse('FDOs cannot reactivate clients', 403);
            }

            // Verify the client belongs to the selected center
            if (existingClient.centerId !== data.centerId) {
                return errorResponse('Client does not belong to the selected center', 400);
            }

            // Reactivate the client
            const reactivatedClient = await prisma.client.update({
                where: { id: existingClient.id },
                data: {
                    isActive: true,
                    inactiveDate: null,
                    dropoutReason: null,
                },
            });

            return successResponse(reactivatedClient, 'Client reactivated successfully');
        } catch (error) {
            console.error('Error reactivating client:', error);
            
            if (error instanceof Error) {
                return errorResponse(error.message, 500);
            }
            
            return errorResponse('Failed to reactivate client', 500);
        }
    })(request);
}