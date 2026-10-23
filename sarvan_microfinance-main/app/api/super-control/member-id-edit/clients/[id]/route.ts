import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** Member IDs look like {branchCode}-{centerCode}-{group}-{sequence}, e.g. 33-44-1-3. */
const MEMBER_ID_RE = /^\d+-\d+-\d+-\d+$/;

const bodySchema = z.object({
    newClientId: z.string().trim().regex(MEMBER_ID_RE, 'Member ID must look like 33-44-1-3'),
    /** 'preview' = validate + warnings only; 'apply' = save. */
    mode: z.enum(['preview', 'apply']),
    reason: z.string().trim().optional(),
    acknowledgeWarnings: z.boolean().optional(),
});

/**
 * POST /api/super-control/member-id-edit/clients/[id]
 *
 * Changes Client.clientId (the human-readable Member ID). Every other table references the
 * client by its internal id, so only this one column (plus an audit row) changes — loans,
 * schedules, collections and GL are untouched. A new ID that is already used by another
 * client is ALLOWED (duplicates exist from legacy imports) but raises a warning to acknowledge; a prefix that does not match the client's current branch/center is a
 * warning that must be acknowledged.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { id } = await params;
            const body = bodySchema.parse(await req.json());

            const result = await prisma.$transaction(
                async (tx) => {
                    const client = await tx.client.findUnique({
                        where: { id },
                        select: {
                            id: true,
                            clientId: true,
                            center: { select: { code: true, branch: { select: { code: true } } } },
                        },
                    });
                    if (!client) throw new Error('Client not found');
                    if (client.clientId === body.newClientId) throw new Error('This is already the current Member ID');

                    const warnings: string[] = [];
                    // Duplicates are allowed (legacy imports already carry some) — but flagged, so the
                    // admin consciously confirms two clients will share this Member ID.
                    const clashes = await tx.client.findMany({
                        where: { clientId: { equals: body.newClientId, mode: 'insensitive' }, id: { not: id } },
                        select: { firstName: true, lastName: true },
                        take: 3,
                    });
                    if (clashes.length > 0) {
                        warnings.push(`Member ID ${body.newClientId} is already used by ${clashes.map((c) => `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()).join(', ')} — saving will create a duplicate`);
                    }
                    if (client.center?.branch?.code && client.center.code) {
                        const expected = `${client.center.branch.code}-${client.center.code}-`;
                        if (!body.newClientId.startsWith(expected)) {
                            warnings.push(`The client is in branch ${client.center.branch.code} / center ${client.center.code}, so the ID would normally start with ${expected}`);
                        }
                    }

                    if (body.mode === 'preview') return { oldClientId: client.clientId, newClientId: body.newClientId, warnings, applied: false };

                    const reason = body.reason ?? '';
                    if (reason.length < 5) throw new Error('Reason is required (min 5 characters)');
                    if (warnings.length > 0 && !body.acknowledgeWarnings) throw new Error('Review the warnings and confirm to continue');

                    await tx.client.update({ where: { id }, data: { clientId: body.newClientId } });
                    await tx.clientIdChangeLog.create({
                        data: { clientDbId: id, oldClientId: client.clientId, newClientId: body.newClientId, changedById: user.userId, reason },
                    });
                    return { oldClientId: client.clientId, newClientId: body.newClientId, warnings, applied: true };
                },
                { timeout: 30000 }
            );

            return successResponse(result, result.applied ? 'Member ID updated' : undefined);
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error instanceof Error ? error.message : 'Failed to update Member ID', 400);
        }
    })(request);
}
