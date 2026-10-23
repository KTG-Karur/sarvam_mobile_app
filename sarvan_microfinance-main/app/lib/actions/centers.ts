'use server';

import { prisma } from '@/app/lib/prisma';

export type CenterOption = {
    id: string;
    name: string;
    branchId: string;
};

import { getServerActionUser } from '@/app/lib/permissions/server-action-auth';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function getCentersForDropdown(userId?: string): Promise<CenterOption[]> {
    const currentUser = await getServerActionUser();

    const whereClause: any = { isActive: true };

    if (currentUser?.role === 'FDO') {
        // FDO can only access centers directly assigned to them via Center.fdoId
        whereClause.fdoId = currentUser.userId;
    } else if (currentUser) {
        // BRANCH_MANAGER: own branch only. AREA_MANAGER: all assigned branches.
        // ADMIN: unrestricted unless scoped to an active branch.
        const branchIds = await getPermittedBranchIds(currentUser);
        if (branchIds) whereClause.branchId = { in: branchIds };
    }

    const centers = await prisma.center.findMany({
        where: whereClause,
        select: {
            id: true,
            name: true,
            code: true,
            branchId: true,
        },
        orderBy: {
            name: 'asc'
        }
    });

    return centers.map(c => ({
        id: c.id,
        name: `${c.code} - ${c.name}`,
        branchId: c.branchId,
    }));
}
