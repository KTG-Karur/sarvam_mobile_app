import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { uploadOnboardingDocument } from '@/app/lib/storage/onboarding-document-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Same branch-scoping convention as app/api/hr/onboarding/[id]/route.ts —
// duplicated per-file rather than shared, matching this module's established
// pattern for small, route-family-local helpers.
function isBranchScopePermitted(ctx: { isHeadOffice: boolean; branchAccess: { branchId: string }[] }, branchId: string | null): boolean {
    if (ctx.isHeadOffice) return true;
    if (!branchId) return true; // not yet assigned to a branch (e.g. a DRAFT link request)
    return ctx.branchAccess.some((ba) => ba.branchId === branchId);
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB — matches /api/hr/employee-documents' cap
const VALID_CATEGORIES = [
    'JOINING_KIT',
    'PRE_APPLICATION_ASSESSMENT',
    'KYC',
    'EDUCATION_CERTIFICATE',
    'APPOINTMENT_LETTER',
    'BANK_PASSBOOK',
    'BGV_REPORT',
    'RELIEVING_LETTER_PAYSLIP',
    'RESUME',
    'ORIGINAL_CERTIFICATE_ACK',
];

// GET /api/hr/onboarding/[id]/documents — list documents attached to this
// onboarding request (HR-uploaded and joinee-uploaded alike).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({ where: { id }, select: { branchId: true } });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (!isBranchScopePermitted(ctx, onboardingRequest.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }

        const documents = await prisma.onboardingDocument.findMany({
            where: { onboardingRequestId: id },
            include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { uploadedAt: 'desc' },
        });

        return successResponse(documents, 'Documents fetched successfully');
    } catch (error: any) {
        console.error('Error fetching onboarding documents:', error);
        return errorResponse(error.message || 'Failed to fetch documents', 500);
    }
}

// POST /api/hr/onboarding/[id]/documents — HR attaches a document to a
// request before the employee account exists (multipart: file, category,
// subtype?, remarks?).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({ where: { id }, select: { branchId: true, status: true } });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (!isBranchScopePermitted(ctx, onboardingRequest.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }
        if (onboardingRequest.status === 'APPROVED') {
            return errorResponse('This request has already been provisioned — documents can no longer be changed', 409);
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const category = formData.get('category') as string | null;
        const subtype = (formData.get('subtype') as string | null) || null;
        const remarks = (formData.get('remarks') as string | null) || null;

        if (!file) return errorResponse('No file provided', 400);
        if (!category || !VALID_CATEGORIES.includes(category)) {
            return errorResponse(`category must be one of: ${VALID_CATEGORIES.join(', ')}`, 400);
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
            return errorResponse('Only JPEG, PNG, WebP or PDF files are allowed', 400);
        }
        if (file.size > MAX_SIZE) {
            return errorResponse('File size must be under 10 MB', 400);
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const result = await uploadOnboardingDocument({
            fileBuffer: buffer,
            contentType: file.type,
            fileName: file.name,
            onboardingRequestId: id,
            category,
            subtype,
        });

        const document = await prisma.onboardingDocument.create({
            data: {
                onboardingRequestId: id,
                category: category as any,
                subtype,
                fileUrl: result.fileUrl,
                fileName: result.fileName,
                fileSize: result.fileSize,
                mimeType: result.mimeType,
                uploaderType: 'HR',
                uploadedById: ctx.userId,
                remarks,
            },
            include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
        });

        return successResponse(document, 'Document uploaded successfully', 201);
    } catch (error: any) {
        console.error('Error uploading onboarding document:', error);
        return errorResponse(error.message || 'Failed to upload document', 500);
    }
}
