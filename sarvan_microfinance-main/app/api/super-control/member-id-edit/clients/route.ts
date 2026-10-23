import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/super-control/member-id-edit/clients?q=&branchId=&page=&pageSize=
 * Search clients by member ID (e.g. 33-44-1-3), name or phone for the Member ID Edit tool.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
            const q = (searchParams.get('q') || '').trim();
            const branchId = (searchParams.get('branchId') || '').trim();

            const where: Prisma.ClientWhereInput = {
                ...(branchId ? { center: { branchId } } : {}),
                ...(q
                    ? {
                          OR: [
                              { clientId: { contains: q, mode: 'insensitive' } },
                              { firstName: { contains: q, mode: 'insensitive' } },
                              { lastName: { contains: q, mode: 'insensitive' } },
                              { phone: { contains: q } },
                              ...memberIdSearchConditions(q),
                          ],
                      }
                    : {}),
            };

            const [totalCount, clients] = await Promise.all([
                prisma.client.count({ where }),
                prisma.client.findMany({
                    where,
                    orderBy: [{ updatedAt: 'desc' }],
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        clientId: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        isActive: true,
                        center: { select: { name: true, code: true, branch: { select: { name: true, code: true } } } },
                        _count: { select: { loanApplications: true } },
                    },
                }),
            ]);

            return successResponse({
                clients: clients.map((c) => ({
                    id: c.id,
                    clientId: c.clientId,
                    name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.clientId,
                    phone: c.phone ?? '',
                    isActive: c.isActive,
                    centerName: c.center?.name ?? '',
                    centerCode: c.center?.code ?? '',
                    branchName: c.center?.branch?.name ?? '',
                    branchCode: c.center?.branch?.code ?? '',
                    loanCount: c._count.loanApplications,
                })),
                totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                page,
                pageSize,
            });
        } catch (error) {
            console.error('[super-control member-id-edit/clients] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch clients', 500);
        }
    })(request);
}
