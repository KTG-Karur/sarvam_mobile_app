import { NextRequest, NextResponse } from 'next/server';
import { clientEnrollmentService } from '@/app/lib/services/client-enrollment.service';
import { tokenStorage } from '@/app/lib/token-storage';

/**
 * GET /api/clients/enrollment/[id]
 * Get a specific client enrollment by ID
 * 
 * @access FDO, BM, AREA_MANAGER
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    try {
        // Get user from token/session
        const user = tokenStorage.getUser();

        if (!user) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Check if user has access
        const allowedRoles = ['FDO', 'BRANCH_MANAGER', 'AREA_MANAGER'];
        if (!allowedRoles.includes(user.role)) {
            return NextResponse.json(
                { success: false, error: 'Access denied' },
                { status: 403 }
            );
        }

        const result = await clientEnrollmentService.getEnrollmentById(id);

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            data: result.data,
        });
    } catch (error) {
        console.error('Error fetching client enrollment:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            },
            { status: 500 }
        );
    }
}
