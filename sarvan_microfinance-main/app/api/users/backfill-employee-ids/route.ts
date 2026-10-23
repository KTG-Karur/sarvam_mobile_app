import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getNextEmployeeIdSequence, formatEmployeeId } from '@/app/lib/hr/generate-employee-id';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/users/backfill-employee-ids
 * One-time utility to assign sequential employeeId values to all users
 * that currently have null employeeId. Admin-only endpoint.
 *
 * Safe to run multiple times — only fills in users with null employeeId.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            // Find the current highest employeeId to continue the sequence
            const nextSeq = await getNextEmployeeIdSequence(prisma);

            // Fetch all users without an employeeId, ordered by creation date
            const usersWithoutId = await prisma.user.findMany({
                where: { employeeId: null },
                orderBy: { createdAt: 'asc' },
                select: { id: true, firstName: true, lastName: true },
            });

            if (usersWithoutId.length === 0) {
                return successResponse(
                    { updated: 0 },
                    'All users already have employeeId assigned.'
                );
            }

            // Batch update inside a transaction
            const updates = usersWithoutId.map((user, index) => {
                const empId = formatEmployeeId(nextSeq + index);
                return prisma.user.update({
                    where: { id: user.id },
                    data: { employeeId: empId },
                    select: { id: true, employeeId: true, firstName: true, lastName: true },
                });
            });

            const results = await prisma.$transaction(updates);

            return successResponse(
                {
                    updated: results.length,
                    assignments: results.map((r) => ({
                        id: r.id,
                        employeeId: r.employeeId,
                        name: `${r.firstName} ${r.lastName}`,
                    })),
                },
                `Successfully assigned employeeId to ${results.length} users.`
            );
        } catch (error) {
            console.error('[Backfill Employee IDs] Error:', error);
            return errorResponse(
                error instanceof Error
                    ? error.message
                    : 'Failed to backfill employee IDs',
                500
            );
        }
    })(request);
}
