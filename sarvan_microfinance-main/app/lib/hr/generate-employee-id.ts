// ============================================================
// EMPLOYEE ID GENERATION — shared sequential "EMP-###" generator
// app/lib/hr/generate-employee-id.ts
//
// Extracted from app/api/users/route.ts and
// app/api/users/backfill-employee-ids/route.ts, which both independently
// computed the same "highest existing EMP-### suffix + 1" sequence. Kept in
// one place so a third caller (HR Onboarding's final-approval provisioning
// route) can reuse it exactly, without re-deriving the format.
// ============================================================

import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export function formatEmployeeId(sequence: number): string {
    return `EMP-${String(sequence).padStart(3, '0')}`;
}

/** Highest existing EMP-### numeric suffix + 1 (1 if none exist yet). */
export async function getNextEmployeeIdSequence(db: PrismaOrTx): Promise<number> {
    const lastUser = await db.user.findFirst({
        where: { employeeId: { not: null } },
        orderBy: { employeeId: 'desc' },
        select: { employeeId: true },
    });

    let nextSeq = 1;
    if (lastUser?.employeeId) {
        const match = lastUser.employeeId.match(/(\d+)$/);
        if (match) nextSeq = parseInt(match[1], 10) + 1;
    }
    return nextSeq;
}

/** Next sequential Employee ID (e.g. "EMP-014") for a single new user. */
export async function generateNextEmployeeId(db: PrismaOrTx): Promise<string> {
    return formatEmployeeId(await getNextEmployeeIdSequence(db));
}
