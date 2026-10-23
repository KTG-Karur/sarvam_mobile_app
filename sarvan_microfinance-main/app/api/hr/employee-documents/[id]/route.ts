import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { deleteEmployeeHrDocument, uploadEmployeeHrDocument } from '@/app/lib/storage/employee-document-storage';
import { requireEmployeeAccess, requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

async function assertCanAccessOtherEmployee(
    request: NextRequest,
    targetEmployeeId: string
): Promise<NextResponse | null> {
    const ctx = await requireEmployeeAccess(request, targetEmployeeId);
    return isUserContext(ctx) ? null : ctx;
}

// DELETE /api/hr/employee-documents/[id] — used by the "Update Photo" replace
// flow (delete the old row for this category/subtype, then POST the new
// file) as well as plain removal. Same access rule as GET/POST on the
// parent route: a caller may always manage their own documents; touching
// someone else's requires hr-employee:view + branch scope.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// PUT /api/hr/employee-documents/[id] — update/replace an existing document in place.
// Updates fileUrl, fileName, fileSize, mimeType, and uploadedAt while preserving the existing
// row, its verifiedBy, verifiedAt, and status (or marking as re-verified if previously verified).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const doc = await prisma.employeeDocument.findUnique({ where: { id } });
            if (!doc) return errorResponse('Document not found', 404);

            if (doc.employeeId !== user.userId) {
                const denied = await assertCanAccessOtherEmployee(req, doc.employeeId);
                if (denied) return denied;
            }

            const formData = await req.formData();
            const file = formData.get('file') as File | null;
            if (!file) return errorResponse('No file provided', 400);

            if (!ALLOWED_TYPES.includes(file.type)) {
                return errorResponse('Only JPEG, PNG, WebP or PDF files are allowed', 400);
            }
            if (file.size > MAX_SIZE) {
                return errorResponse('File size must be under 10 MB', 400);
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const uploadResult = await uploadEmployeeHrDocument({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                employeeId: doc.employeeId,
                category: doc.category,
                subtype: doc.subtype,
            });

            // Delete old file from storage
            try {
                await deleteEmployeeHrDocument(doc.fileUrl);
            } catch (storageError) {
                console.error('Failed to delete old employee document file', doc.fileUrl, storageError);
            }

            // Update existing record in place
            // If already verified, keep verifiedBy as the existing verifier or the updating user
            const updated = await prisma.employeeDocument.update({
                where: { id },
                data: {
                    fileUrl: uploadResult.fileUrl,
                    fileName: uploadResult.fileName,
                    fileSize: uploadResult.fileSize,
                    mimeType: uploadResult.mimeType,
                    uploadedById: user.userId,
                    uploadedAt: new Date(),
                    // Keep verified status and verifier if already verified, or assign current user if verifying during update
                    verifiedById: doc.verifiedById ?? user.userId,
                    verifiedAt: doc.verifiedAt ?? new Date(),
                    status: 'VERIFIED',
                },
                include: {
                    uploadedBy: { select: { id: true, firstName: true, lastName: true } },
                    verifiedBy: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            return successResponse(updated, 'Document updated successfully');
        } catch (error: any) {
            console.error('Error updating employee document:', error);
            return errorResponse(error.message || 'Failed to update document', 500);
        }
    })(request);
}

// DELETE /api/hr/employee-documents/[id] — used by document deletion.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const doc = await prisma.employeeDocument.findUnique({ where: { id } });
            if (!doc) return errorResponse('Document not found', 404);

            if (doc.employeeId !== user.userId) {
                // Removing someone else's document is destructive, so it needs its
                // own grant (hr-employee:delete — Admin only unless a role is given
                // it in the Roles editor) on top of the employee's branch scope;
                // merely being able to view the employee is not enough.
                const ctx = await requirePermission(req, 'hr-employee', 'delete');
                if (!isUserContext(ctx)) return ctx;
                const owner = await prisma.user.findUnique({ where: { id: doc.employeeId }, select: { branchId: true } });
                if (!(await isEmployeeInCallerScope(ctx, owner?.branchId ?? null))) {
                    return errorResponse('You do not have access to this employee', 403);
                }
            }

            try {
                await deleteEmployeeHrDocument(doc.fileUrl);
            } catch (storageError) {
                console.error('Failed to delete employee document object', doc.id, storageError);
            }
            await prisma.employeeDocument.delete({ where: { id } });

            return successResponse(null, 'Document deleted successfully');
        } catch (error: any) {
            console.error('Error deleting employee document:', error);
            return errorResponse(error.message || 'Failed to delete document', 500);
        }
    })(request);
}

