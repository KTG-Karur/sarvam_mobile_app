import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { withRole } from '@/app/lib/api-utils';

export async function GET(req: NextRequest) {
    return withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
        async () => {
            const officers = await prisma.user.findMany({
                where: {
                    isActive: true,
                    role: 'FDO',
                    collectedTransactions: { some: {} },
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                },
                orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            });

            return NextResponse.json({
                success: true,
                data: officers.map((u) => ({
                    id: u.id,
                    name: `${u.firstName} ${u.lastName}`,
                    role: u.role,
                })),
            });
        }
    )(req);
}
