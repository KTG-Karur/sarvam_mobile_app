import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const BodySchema = z.object({
    isDefaultMember: z.boolean(),
    reason: z.string().optional(),
}).refine(
    (data) => !data.isDefaultMember || !!data.reason?.trim(),
    { message: 'A reason is required when marking a client as a Default Member', path: ['reason'] }
);

/**
 * GET /api/clients/[clientId]/default-member
 * PATCH /api/clients/[clientId]/default-member
 *
 * Admin/Sub Admin-only toggle. When isDefaultMember is true, LoanService
 * blocks new loan applications for this client (see
 * app/lib/services/loan.service.ts createLoanApplication) — it does not
 * affect any loan already in progress.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withAuth(async (_req, user) => {
        try {
            const isAdmin = user.role === 'ADMIN' || await isSubAdminUser(user.userId);
            if (!isAdmin) return errorResponse('Insufficient permissions', 403);

            const { clientId } = await params;
            // findFirst, not findUnique — clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide) — deterministic oldest-created
            // tiebreak, matching every other clientId lookup in the app.
            const client = await prisma.client.findFirst({
                where: { OR: [{ id: clientId }, { clientId }] },
                orderBy: { createdAt: 'asc' },
                select: {
                    isDefaultMember: true,
                    defaultMemberReason: true,
                    defaultMemberSetAt: true,
                    defaultMemberSetBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
            });

            if (!client) return errorResponse('Client not found', 404);
            return successResponse(client, 'Default member status fetched');
        } catch (error) {
            console.error('Error fetching default member status:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch status', 500);
        }
    })(request);
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const isAdmin = user.role === 'ADMIN' || await isSubAdminUser(user.userId);
            if (!isAdmin) return errorResponse('Insufficient permissions', 403);

            const { clientId } = await params;
            const body = await req.json();
            const parsed = BodySchema.safeParse(body);
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid request data', 400);
            }
            const { isDefaultMember, reason } = parsed.data;

            const existing = await prisma.client.findFirst({
                where: { OR: [{ id: clientId }, { clientId }] },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
            });
            if (!existing) return errorResponse('Client not found', 404);

            const updated = await prisma.client.update({
                where: { id: existing.id },
                data: {
                    isDefaultMember,
                    defaultMemberReason: isDefaultMember ? (reason?.trim() || null) : null,
                    defaultMemberSetById: user.userId,
                    defaultMemberSetAt: new Date(),
                },
                select: {
                    isDefaultMember: true,
                    defaultMemberReason: true,
                    defaultMemberSetAt: true,
                    defaultMemberSetBy: { select: { firstName: true, lastName: true, employeeId: true } },
                },
            });

            return successResponse(updated, isDefaultMember ? 'Client marked as Default Member' : 'Default Member flag cleared');
        } catch (error) {
            console.error('Error updating default member status:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update status', 500);
        }
    })(request);
}
