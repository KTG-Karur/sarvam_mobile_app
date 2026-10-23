import { prisma } from '@/app/lib/prisma';
import { extractLegacyNumberPrefix } from '@/app/lib/services/group-assignment.service';

/**
 * Center code to use for a newly-created center, preferring the legacy source
 * system's own number when the center's name carries one as a leading "N-"
 * prefix (e.g. "2-MUNTHIRI THOTTAM(PARAMANKURICHI)" -> "2"), so a bulk uploan
 * import's numbering agrees with the legacy system instead of an unrelated
 * internal auto-increment. Falls back to `generateNextCenterCode` when there's
 * no usable prefix, or it's already taken by another center in this branch.
 */
export async function resolveCenterCode(branchId: string, centerName: string): Promise<string> {
    const legacyNumber = extractLegacyNumberPrefix(centerName);
    if (legacyNumber !== null) {
        const candidate = legacyNumber.toString();
        const exists = await prisma.center.findFirst({ where: { branchId, code: candidate } });
        if (!exists) return candidate;
    }
    return generateNextCenterCode(branchId);
}

/**
 * Generates the next center code for a branch: a plain per-branch sequence
 * number ("1", "2", "3", ...). Center.code is unique per-branch (@@unique on
 * [branchId, code]), not globally — so every branch independently numbers
 * its own centers starting from 1, and two branches can each have a "1".
 */
export async function generateNextCenterCode(branchId: string): Promise<string> {
    const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true },
    });
    if (!branch) throw new Error('Branch not found');

    const centerCount = await prisma.center.count({ where: { branchId } });

    let candidate = centerCount + 1;
    let finalCode = '';
    let unique = false;
    while (!unique) {
        finalCode = candidate.toString();
        const exists = await prisma.center.findFirst({ where: { branchId, code: finalCode } });
        if (!exists) {
            unique = true;
        } else {
            candidate++;
        }
    }
    return finalCode;
}
