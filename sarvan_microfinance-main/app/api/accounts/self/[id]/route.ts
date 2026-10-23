import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';

const updateSelfAccountSchema = z.object({
    name: z.string().min(1, "Account Name is required"),
    description: z.string().optional(),
    type: z.enum(['CASH', 'BANK'], {
        errorMap: () => ({ message: 'Type is required and must be CASH or BANK' }),
    }),
});

/**
 * PUT /api/accounts/self/[id]
 * Update a self account
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    return withAuth(async (req) => {
        try {
            const body = await req.json();

            const validation = updateSelfAccountSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { name, description, type } = validation.data;

            // Check if name already exists for another account
            const existing = await prisma.selfAccount.findFirst({
                where: {
                    name: { equals: name, mode: 'insensitive' },
                    isActive: true,
                    NOT: {
                        id: id,
                    },
                },
            });

            if (existing) {
                return errorResponse(`Account with name "${name}" already exists`, 409);
            }

            const updatedAccount = await prisma.selfAccount.update({
                where: { id },
                data: {
                    name,
                    description,
                    type,
                },
            });

            return successResponse(updatedAccount, 'Self account updated successfully');
        } catch (error: any) {
            console.error('Error updating self account:', error);
            if (error.code === 'P2025') {
                return errorResponse('Self account not found', 404);
            }
            return errorResponse('Failed to update self account', 500);
        }
    })(request);
}

/**
 * DELETE /api/accounts/self/[id]
 * Delete (soft delete) a self account
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    return withAuth(async (req) => {
        try {
            // Soft delete by setting isActive to false
            const deletedAccount = await prisma.selfAccount.update({
                where: { id },
                data: { isActive: false },
            });

            return successResponse(deletedAccount, 'Self account deleted successfully');
        } catch (error: any) {
            console.error('Error deleting self account:', error);
            if (error.code === 'P2025') {
                return errorResponse('Self account not found', 404);
            }
            return errorResponse('Failed to delete self account', 500);
        }
    })(request);
}
