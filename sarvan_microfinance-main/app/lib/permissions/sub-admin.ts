// ============================================================
// SUB ADMIN — shared lookup for the Role.isSubAdmin flag.
// A Sub Admin role grants the final client-approval actions
// (queue visibility + FINAL_APPROVE/RETAKE/REJECT), scoped to
// final approval only — see app/api/approval/**.
// ============================================================

import { prisma } from '@/app/lib/prisma';

export async function isSubAdminUser(userId: string): Promise<boolean> {
    return !!(await prisma.userRoleAssignment.findFirst({
        where: {
            userId,
            isActive: true,
            role: { isSubAdmin: true, isActive: true },
        },
    }));
}
