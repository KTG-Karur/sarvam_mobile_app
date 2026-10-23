import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const allGroups = await prisma.group.findMany({ select: { code: true } });

            const maxNum = allGroups.reduce((max, g) => {
                if (g.code && /^\d+$/.test(g.code)) {
                    const n = parseInt(g.code, 10);
                    return n > max ? n : max;
                }
                return max;
            }, 0);

            const nextId = (maxNum + 1).toString();
            return successResponse({ nextId }, 'Next group ID generated');
        } catch (error) {
            console.error('Error generating next group ID:', error);
            return errorResponse('Failed to generate next group ID', 500);
        }
    })(request);
}
