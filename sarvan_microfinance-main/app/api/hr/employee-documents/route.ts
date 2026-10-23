import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { uploadEmployeeHrDocument } from '@/app/lib/storage/employee-document-storage';
import { requireEmployeeAccess, isUserContext } from '@/app/lib/permissions/guards';
import { sortDocumentsInFormOrder, isSingleCopyDocument } from '@/app/lib/hr/document-order';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * A caller may always see/manage their own documents. Viewing or uploading
 * against a *different* employeeId requires the same `hr-employee:view`
 * grant + branch scope used elsewhere in the HR module — otherwise any
 * authenticated user could read/upload another employee's KYC/BGV/bank
 * documents just by editing `?employeeId=`.
 */
async function assertCanAccessOtherEmployee(
    request: NextRequest,
    targetEmployeeId: string
): Promise<NextResponse | null> {
    const ctx = await requireEmployeeAccess(request, targetEmployeeId);
    return isUserContext(ctx) ? null : ctx;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
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

// GET /api/hr/employee-documents?employeeId=
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId') || user.userId;

            if (employeeId !== user.userId) {
                const denied = await assertCanAccessOtherEmployee(req, employeeId);
                if (denied) return denied;
            }

            const documents = await prisma.employeeDocument.findMany({
                where: { employeeId },
                include: {
                    uploadedBy: { select: { id: true, firstName: true, lastName: true } },
                    verifiedBy: { select: { id: true, firstName: true, lastName: true } },
                },
                orderBy: { uploadedAt: 'desc' },
            });

            // Listed in the onboarding form's document order (newest first
            // within a type), so every page that shows them agrees.
            return successResponse(sortDocumentsInFormOrder(documents), 'Employee documents fetched successfully');
        } catch (error: any) {
            console.error('Error fetching employee documents:', error);
            return errorResponse(error.message || 'Failed to fetch employee documents', 500);
        }
    })(request);
}

// POST /api/hr/employee-documents (multipart: file, employeeId, category, subtype?, remarks?)
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const formData = await req.formData();
            const file = formData.get('file') as File | null;
            const employeeId = formData.get('employeeId') as string | null;
            const category = formData.get('category') as string | null;
            const subtype = (formData.get('subtype') as string | null) || null;
            const remarks = (formData.get('remarks') as string | null) || null;

            if (!file) return errorResponse('No file provided', 400);
            if (!employeeId) return errorResponse('employeeId is required', 400);
            if (!category || !VALID_CATEGORIES.includes(category)) {
                return errorResponse(`category must be one of: ${VALID_CATEGORIES.join(', ')}`, 400);
            }
            if (!ALLOWED_TYPES.includes(file.type)) {
                return errorResponse('Only JPEG, PNG, WebP or PDF files are allowed', 400);
            }
            if (file.size > MAX_SIZE) {
                return errorResponse('File size must be under 10 MB', 400);
            }

            const employee = await prisma.user.findUnique({ where: { id: employeeId }, select: { id: true } });
            if (!employee) return errorResponse('Employee not found', 404);

            if (employeeId !== user.userId) {
                const denied = await assertCanAccessOtherEmployee(req, employeeId);
                if (denied) return denied;
            }

            // One Aadhaar/PAN/DL/Voter ID/UAN/Photo per employee — a second
            // upload replaces the existing one via PUT /[id] (the row's
            // "Update Document" button) instead of piling up beside it.
            if (isSingleCopyDocument(category, subtype)) {
                const existing = await prisma.employeeDocument.findFirst({
                    where: { employeeId, category: category as any, subtype },
                    select: { id: true },
                });
                if (existing) {
                    return errorResponse(
                        `A ${subtype} document is already on file for this employee. Use the Update button on that row to replace it.`,
                        409
                    );
                }
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const result = await uploadEmployeeHrDocument({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                employeeId,
                category,
                subtype,
            });

            const document = await prisma.employeeDocument.create({
                data: {
                    employeeId,
                    category: category as any,
                    subtype,
                    fileUrl: result.fileUrl,
                    fileName: result.fileName,
                    fileSize: result.fileSize,
                    mimeType: result.mimeType,
                    uploadedById: user.userId,
                    verifiedById: user.userId,
                    verifiedAt: new Date(),
                    status: 'VERIFIED',
                    remarks,
                },
                include: {
                    uploadedBy: { select: { id: true, firstName: true, lastName: true } },
                    verifiedBy: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            return successResponse(document, 'Document uploaded successfully', 201);
        } catch (error: any) {
            console.error('Error uploading employee document:', error);
            return errorResponse(error.message || 'Failed to upload document', 500);
        }
    })(request);
}
