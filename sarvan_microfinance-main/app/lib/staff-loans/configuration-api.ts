import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse, withAuth } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { resolveMasterCapabilities, type MasterCapabilities, SCHEME_PAGE, WORKFLOW_PAGE } from './configuration';
import { StaffLoanConfigurationError } from './configuration-service';

export function configurationError(error: unknown) {
    if (error instanceof StaffLoanConfigurationError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message || 'Invalid configuration', 400);
    if (error instanceof SyntaxError) return errorResponse('Invalid JSON request', 400);
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'P2002') return errorResponse('A scheme code or workflow configuration conflicts with an existing record. Reload and check your entries.', 409);
    if (code === 'P2034') return errorResponse('Another user saved changes at the same time. Reload and try again.', 409);
    if (code === 'P2025') return errorResponse('Configuration not found. Reload before saving.', 404);
    if (code === 'P2003') return errorResponse('A selected record is no longer available. Reload before saving.', 409);
    if (code === 'P2021' || code === 'P2022') return errorResponse('Staff loan configuration is not available yet. Contact your administrator to complete setup.', 503);
    return errorResponse('Unable to process staff loan configuration. Please try again.', 500);
}

// Global Masters configuration uses global, active, unexpired assignments only.
// This guard is local to the new feature; existing auth behavior is unchanged.
export function withStaffLoanMaster(
    page: typeof SCHEME_PAGE | typeof WORKFLOW_PAGE,
    action: keyof MasterCapabilities,
    handler: (request: NextRequest, actorId: string, capabilities: MasterCapabilities) => Promise<NextResponse>,
) {
    return withAuth(async (request, session) => {
        try {
            const user = await prisma.user.findUnique({ where: { id: session.userId }, select: {
                id: true, role: true, isActive: true,
                userRoles: { where: {
                    isActive: true, branchId: null,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                    role: { isActive: true },
                }, select: { role: { select: { slug: true, pagePermissions: true } } } },
            } });
            if (!user?.isActive) return errorResponse('Authentication required', 401);
            const capabilities = resolveMasterCapabilities(
                user.role === 'ADMIN' || user.userRoles.some(r => r.role.slug === 'admin'),
                user.userRoles.map(r => r.role.pagePermissions), page,
            );
            if (!capabilities[action]) return errorResponse('Insufficient permissions for this staff loan configuration action', 403);
            return await handler(request, user.id, capabilities);
        } catch (error) { return configurationError(error); }
    });
}
