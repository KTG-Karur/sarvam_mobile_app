import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/policies/published — employee-facing, published policies only.
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const policies = await prisma.policyDocument.findMany({
                where: { isPublished: true },
                select: {
                    id: true, title: true, category: true, fileUrl: true, fileName: true,
                    mimeType: true, publishedAt: true,
                },
                orderBy: { publishedAt: 'desc' },
            });
            return successResponse(policies, 'Published policies fetched successfully');
        } catch (error: any) {
            console.error('Error fetching published policies:', error);
            return errorResponse(error.message || 'Failed to fetch published policies', 500);
        }
    })(request);
}
