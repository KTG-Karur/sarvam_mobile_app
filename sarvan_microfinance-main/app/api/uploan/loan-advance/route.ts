import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/uploan/loan-advance?branchId=&centerId=&q=&page=&pageSize=
 *
 * Lists the members of one branch (a Client belongs to a branch through its Center) with
 * their stored `Client.loanAdvance`, for the Loan Advance Edit master.
 * `branchId` is required; `q` matches client ID / first name / last name.
 *
 * @access ADMIN
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = (searchParams.get('branchId') || '').trim();
            const centerId = (searchParams.get('centerId') || '').trim();
            const q = (searchParams.get('q') || '').trim();
            const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
            const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));

            if (!branchId) return errorResponse('Branch is required', 400);

            const where: Prisma.ClientWhereInput = {
                center: { branchId },
                ...(centerId ? { centerId } : {}),
                ...(q
                    ? {
                          OR: [
                              { clientId: { contains: q, mode: 'insensitive' } },
                              { firstName: { contains: q, mode: 'insensitive' } },
                              { lastName: { contains: q, mode: 'insensitive' } },
                              ...memberIdSearchConditions(q),
                          ],
                      }
                    : {}),
            };

            const [totalCount, clients] = await Promise.all([
                prisma.client.count({ where }),
                prisma.client.findMany({
                    where,
                    orderBy: [{ center: { code: 'asc' } }, { clientId: 'asc' }],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        loanAdvance: true,
                        center: { select: { id: true, code: true, name: true } },
                    },
                }),
            ]);

            return successResponse({
                clients: clients.map((c) => ({
                    id: c.id,
                    clientId: c.clientId,
                    name: `${c.firstName} ${c.lastName}`.trim(),
                    centerId: c.center?.id ?? null,
                    centerCode: c.center?.code ?? '',
                    centerName: c.center?.name ?? '',
                    loanAdvance: Number(c.loanAdvance),
                })),
                totalCount,
                page,
                totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
            });
        } catch (error: any) {
            return errorResponse(error.message || 'Failed to load loan advances', 500);
        }
    })(request);
}

const updateSchema = z.object({
    branchId: z.string().min(1, 'Branch is required'),
    updates: z
        .array(
            z.object({
                id: z.string().min(1),
                loanAdvance: z
                    .number({ invalid_type_error: 'Loan advance must be a number' })
                    .min(0, 'Loan advance cannot be negative')
                    .max(9_999_999_999_999, 'Loan advance is too large')
                    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
                        message: 'Loan advance can have at most 2 decimal places',
                    }),
            })
        )
        .min(1, 'No changes to save')
        .max(500, 'Too many changes in one save'),
});

/**
 * PUT /api/uploan/loan-advance
 * Saves edited `Client.loanAdvance` values in one transaction. Every client must belong to
 * the given branch (multi-tenancy boundary) or nothing is written.
 *
 * @access ADMIN
 */
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { branchId, updates } = updateSchema.parse(await req.json());

            const ids = updates.map((u) => u.id);
            if (new Set(ids).size !== ids.length) return errorResponse('Duplicate clients in request', 400);

            const clients = await prisma.client.findMany({
                where: { id: { in: ids }, center: { branchId } },
                select: { id: true },
            });
            if (clients.length !== ids.length) {
                return errorResponse('Some clients do not belong to the selected branch', 400);
            }

            await prisma.$transaction(
                updates.map((u) =>
                    prisma.client.update({
                        where: { id: u.id },
                        data: { loanAdvance: Math.round(u.loanAdvance * 100) / 100 },
                    })
                )
            );

            return successResponse({ updated: updates.length }, `${updates.length} loan advance value(s) saved`);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            return errorResponse(error.message || 'Failed to save loan advances', 500);
        }
    })(request);
}
