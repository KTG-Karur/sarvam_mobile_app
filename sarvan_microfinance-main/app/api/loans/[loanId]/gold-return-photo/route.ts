import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { uploadGoldReturnPhoto } from '@/app/lib/storage/gold-return-photo-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

/**
 * POST /api/loans/[loanId]/gold-return-photo
 * Uploads the mandatory evidence photo taken when a BM initiates a gold
 * return. Returns the storage key/url; the caller includes it in the
 * POST /api/gold-transactions body that creates the GIVE transaction —
 * no DB row is written here.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req) => {
        try {
            const { loanId } = await params;

            const loan = await prisma.loan.findUnique({ where: { id: loanId }, select: { id: true } });
            if (!loan) return errorResponse('Loan not found', 404);

            const formData = await req.formData();
            const file = formData.get('photo') as File | null;

            if (!file) return errorResponse('No photo provided', 400);
            if (!ALLOWED_TYPES.includes(file.type)) return errorResponse('Only JPEG, PNG or WebP images are allowed', 400);
            if (file.size > MAX_SIZE) return errorResponse('Photo size must be under 8 MB', 400);

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const upload = await uploadGoldReturnPhoto({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                loanId,
            });

            return successResponse(
                { photoUrl: upload.photoUrl, photoKey: upload.photoKey },
                'Photo uploaded successfully'
            );
        } catch (error: any) {
            console.error('Error uploading gold return photo:', error);
            return errorResponse(error.message || 'Failed to upload photo', 500);
        }
    })(request);
}
