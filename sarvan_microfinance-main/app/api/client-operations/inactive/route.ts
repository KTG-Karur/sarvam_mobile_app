import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight, jsonResponse } from '@/app/lib/api-utils';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Validation schema for client inactivation
 */
const clientInactiveSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    centerId: z.string().min(1, 'Center ID is required'),
    lastLoanClosedDate: z.string().optional(),
    inactiveDate: z.string().min(1, 'Inactive date is required'),
    inactiveReason: z.string().min(1, 'Inactive reason is required'),
});

/**
 * POST /api/client-operations/inactive
 * Mark a client as inactive
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();

            // Validate request body
            const validationResult = clientInactiveSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const data = validationResult.data;

            // Database id vs clientId mapping (frontend sends db id for clientId)
            // Wait, the frontend sends:
            // clientId: values.clientName (which is the database ID because it's selected from clients dropdown)
            // Let's check the client exists
            const existingClient = await prisma.client.findUnique({
                where: { id: data.clientId },
                select: {
                    id: true,
                    centerId: true,
                    isActive: true,
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

            if (!existingClient.isActive) {
                return errorResponse('Client is already inactive', 400);
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
                return errorResponse('FDOs cannot mark clients as inactive', 403);
            }

            // Check if there are active loans
            const activeLoans = await prisma.loan.findFirst({
                where: {
                    clientId: existingClient.id,
                    isActive: true,
                    disbursementStatus: {
                        in: ['PENDING_LEVEL1', 'APPROVED_LEVEL1', 'PENDING_LEVEL2', 'DISBURSED']
                    },
                    closedDate: null
                }
            });

            if (activeLoans) {
                // Business-rule failure: return non-crashing API shape while keeping explicit failure state.
                return jsonResponse({
                    success: false,
                    error: 'Client has active loans and cannot be marked as inactive',
                }, 200);
            }

            // Update client to inactive
            const updatedClient = await prisma.client.update({
                where: { id: existingClient.id },
                data: {
                    isActive: false,
                    inactiveDate: new Date(data.inactiveDate),
                    dropoutReason: data.inactiveReason,
                },
            });

            return successResponse(updatedClient, 'Client marked as inactive successfully');
        } catch (error) {
            console.error('Error marking client as inactive:', error);
            
            if (error instanceof Error) {
                return errorResponse(error.message, 500);
            }
            
            return errorResponse('Failed to mark client as inactive', 500);
        }
    })(request);
}
