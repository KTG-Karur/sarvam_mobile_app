import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { uploadPolicyDocument } from '@/app/lib/storage/policy-document-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// GET /api/hr/policies — admin/HR view, includes unpublished drafts.
export async function GET(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-policy', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const policies = await prisma.policyDocument.findMany({
            include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { createdAt: 'desc' },
        });
        return successResponse(policies, 'Policies fetched successfully');
    } catch (error: any) {
        console.error('Error fetching policies:', error);
        return errorResponse(error.message || 'Failed to fetch policies', 500);
    }
}

// POST /api/hr/policies (multipart: file, title, category?)
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-policy', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const title = formData.get('title') as string | null;
        const category = (formData.get('category') as string | null) || null;

        if (!file) return errorResponse('No file provided', 400);
        if (!title?.trim()) return errorResponse('Title is required', 400);
        if (!ALLOWED_TYPES.includes(file.type)) {
            return errorResponse('Only PDF, JPEG or PNG files are allowed', 400);
        }
        if (file.size > MAX_SIZE) {
            return errorResponse('File size must be under 10 MB', 400);
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const result = await uploadPolicyDocument({
            fileBuffer: buffer,
            contentType: file.type,
            fileName: file.name,
            category,
        });

        const policy = await prisma.policyDocument.create({
            data: {
                title: title.trim(),
                category,
                fileUrl: result.fileUrl,
                fileName: result.fileName,
                fileSize: result.fileSize,
                mimeType: result.mimeType,
                uploadedById: ctx.userId,
            },
        });

        return successResponse(policy, 'Policy uploaded successfully', 201);
    } catch (error: any) {
        console.error('Error uploading policy:', error);
        return errorResponse(error.message || 'Failed to upload policy', 500);
    }
}
