import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

/**
 * OPTIONS /api/masters/gl
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/masters/gl
 * Fetch all GL accounts
 */
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const { searchParams } = new URL(request.url);
            const type = searchParams.get('type');

            const glAccounts = await prisma.gLAccount.findMany({
                where: {
                    isActive: true,
                    ...(type ? { glType: type as any } : {}),
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return successResponse(glAccounts, 'GL accounts fetched successfully');
        } catch (error) {
            console.error('Error fetching GL accounts:', error);
            /**
             * As per user requirement, we return a safe empty set with a clear message 
             * instead of a breaking error response. This ensures the UI stays functional
             * even if the database is being synced or the registry is empty.
             */
            return successResponse([], 'GL Registry is currently empty or initializing. Please ensure database is synced.');
        }
    })(request);
}

/**
 * POST /api/masters/gl
 * Create a new GL account
 */
export async function POST(request: NextRequest) {
    return withAuth(async () => {
        try {
            const body = await request.json();

            if (!body.glName || !body.glType) {
                return errorResponse('GL Name and GL Type are required', 400);
            }

            // Generate glId if not provided
            let glId = body.glId;
            if (!glId) {
                const count = await prisma.gLAccount.count();
                glId = `GL-${(count + 1001).toString()}`;
            }

            const glAccount = await prisma.gLAccount.create({
                data: {
                    glId,
                    glName: body.glName,
                    glType: body.glType,
                    description: body.description || null,
                },
            });

            return successResponse(glAccount, 'GL account created successfully', 201);
        } catch (error) {
            console.error('Error creating GL account:', error);
            return errorResponse('Failed to create GL account', 500);
        }
    })(request);
}

/**
 * PUT /api/masters/gl
 * Update a GL account
 */
export async function PUT(request: NextRequest) {
    return withAuth(async () => {
        try {
            const body = await request.json();

            if (!body.glId) {
                return errorResponse('GL ID is required', 400);
            }

            const glAccount = await prisma.gLAccount.update({
                where: { glId: body.glId },
                data: {
                    glName: body.glName,
                    glType: body.glType,
                    description: body.description,
                },
            });

            return successResponse(glAccount, 'GL account updated successfully');
        } catch (error) {
            console.error('Error updating GL account:', error);
            return errorResponse('Failed to update GL account', 500);
        }
    })(request);
}

/**
 * DELETE /api/masters/gl
 * Soft delete a GL account
 */
export async function DELETE(request: NextRequest) {
    return withAuth(async () => {
        try {
            const { searchParams } = new URL(request.url);
            const glId = searchParams.get('glId');

            if (!glId) {
                return errorResponse('GL ID is required', 400);
            }

            await prisma.gLAccount.update({
                where: { glId },
                data: { isActive: false },
            });

            return successResponse(null, 'GL account deleted successfully');
        } catch (error) {
            console.error('Error deleting GL account:', error);
            return errorResponse('Failed to delete GL account', 500);
        }
    })(request);
}
