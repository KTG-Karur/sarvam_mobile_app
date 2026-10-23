import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { isBelongingReturnProofKeyFor } from '@/app/lib/storage/belonging-return-storage';
import { validateBelongingReturn } from '@/app/lib/hr/belonging-return-rules';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const photoSchema = z.object({
    fileKey: z.string().min(1),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().nonnegative(),
    mimeType: z.enum(['image/jpeg', 'image/png']),
});

const returnSchema = z.object({
    status: z.enum(['RETURNED', 'LOST', 'DAMAGED']),
    condition: z.string().max(50).optional().nullable(),
    remarks: z.string().max(1000).optional().nullable(),
    recoveryAmount: z.number().nonnegative().optional().nullable(),
    // Photos already uploaded via POST .../proof — required for RETURNED /
    // DAMAGED, not allowed for LOST (see belonging-return-rules.ts).
    photos: z.array(photoSchema).default([]),
});

// POST /api/hr/belongings/issued/[id]/return
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.employeeIssuedBelonging.findUnique({
            where: { id },
            include: { employee: { select: { branchId: true } } },
        });
        if (!existing) return errorResponse('Issued belonging record not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, existing.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (existing.status !== 'ISSUED') {
            return errorResponse('This item has already been returned/closed', 409);
        }

        const body = await request.json();
        const data = returnSchema.parse(body);

        const proofError = validateBelongingReturn({
            status: data.status,
            photoCount: data.photos.length,
            recoveryAmount: data.recoveryAmount,
        });
        if (proofError) return errorResponse(proofError, 400);

        // Every key must be a file uploaded for THIS belonging — never another
        // employee's (or another item's) stored file.
        for (const photo of data.photos) {
            if (!(await isBelongingReturnProofKeyFor(existing.employeeId, id, photo.fileKey))) {
                return errorResponse('Invalid photo reference', 400);
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            // Conditional on still being ISSUED so two simultaneous returns can't
            // both succeed (the read above ran outside this transaction).
            const result = await tx.employeeIssuedBelonging.updateMany({
                where: { id, status: 'ISSUED' },
                data: {
                    status: data.status,
                    remarks: data.remarks,
                    // Recovery applies only to damaged/lost items.
                    recoveryAmount: data.status === 'RETURNED' ? null : data.recoveryAmount ?? null,
                    condition: data.status === 'LOST' ? null : data.condition,
                    returnedDate: new Date(),
                    returnedToId: ctx.userId,
                },
            });
            if (result.count === 0) throw new ConflictError('This item has already been returned/closed');

            await tx.employeeBelongingReturnProof.createMany({
                data: data.photos.map((p) => ({
                    issuedBelongingId: id,
                    fileKey: p.fileKey,
                    fileName: p.fileName,
                    mimeType: p.mimeType,
                    fileSize: p.fileSize,
                    uploadedById: ctx.userId,
                })),
            });

            return tx.employeeIssuedBelonging.findUnique({
                where: { id },
                include: { returnProofs: { select: { id: true, fileKey: true, fileName: true, mimeType: true } } },
            });
        });

        return successResponse(updated, 'Item return recorded successfully');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        if (error instanceof ConflictError) return errorResponse(error.message, 409);
        console.error('Error recording belonging return:', error);
        return errorResponse(error instanceof Error ? error.message : 'Failed to record return', 500);
    }
}

class ConflictError extends Error {}
