import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { deletePolicyDocument } from '@/app/lib/storage/policy-document-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateSchema = z.object({
    title: z.string().min(1).optional(),
    category: z.string().optional().nullable(),
    isPublished: z.boolean().optional(),
});

// PATCH /api/hr/policies/[id] — edit metadata and/or publish/unpublish.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-policy', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.policyDocument.findUnique({ where: { id } });
        if (!existing) return errorResponse('Policy not found', 404);

        const body = await request.json();
        const data = updateSchema.parse(body);

        const updated = await prisma.policyDocument.update({
            where: { id },
            data: {
                ...data,
                ...(data.isPublished === true && !existing.isPublished ? { publishedAt: new Date() } : {}),
                ...(data.isPublished === false ? { publishedAt: null } : {}),
            },
        });

        return successResponse(updated, 'Policy updated successfully');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error updating policy:', error);
        return errorResponse(error.message || 'Failed to update policy', 500);
    }
}

// DELETE /api/hr/policies/[id]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-policy', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.policyDocument.findUnique({ where: { id } });
        if (!existing) return errorResponse('Policy not found', 404);

        await deletePolicyDocument(existing.fileUrl);
        await prisma.policyDocument.delete({ where: { id } });

        return successResponse(null, 'Policy deleted successfully');
    } catch (error: any) {
        console.error('Error deleting policy:', error);
        return errorResponse(error.message || 'Failed to delete policy', 500);
    }
}
