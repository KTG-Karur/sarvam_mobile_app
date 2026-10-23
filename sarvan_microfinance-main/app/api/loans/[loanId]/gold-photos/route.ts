import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { uploadGoldLoanPhoto } from '@/app/lib/storage/gold-loan-photo-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

/**
 * GET /api/loans/[loanId]/gold-photos
 * Returns previously uploaded gold-pledge photos for a loan — used by
 * FinalDisbursementClient to restore state after a partially-filled session
 * and to compute the "at least one photo" gate client-side.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async () => {
        try {
            const { loanId } = await params;
            const photos = await prisma.goldLoanDetailPhoto.findMany({
                where: { loanId },
                select: { id: true, photoUrl: true, createdAt: true },
                orderBy: { createdAt: 'asc' },
            });
            return successResponse({ photos, count: photos.length });
        } catch (error: any) {
            console.error('Error fetching gold loan photos:', error);
            return errorResponse(error.message || 'Failed to fetch photos', 500);
        }
    })(request);
}

/**
 * POST /api/loans/[loanId]/gold-photos
 * Uploads a photo of the pledged gold item. Multiple photos per loan are
 * allowed. Unlike the household-visit photo, no GPS/location gate applies —
 * this is a pledge-evidence photo, not a location-verification photo.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
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

            const upload = await uploadGoldLoanPhoto({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                loanId,
            });

            const photo = await prisma.goldLoanDetailPhoto.create({
                data: {
                    loanId,
                    photoUrl: upload.photoUrl,
                    photoKey: upload.photoKey,
                    uploadedById: user.userId,
                },
            });

            return successResponse({ id: photo.id, photoUrl: photo.photoUrl }, 'Photo uploaded successfully');
        } catch (error: any) {
            console.error('Error uploading gold loan photo:', error);
            return errorResponse(error.message || 'Failed to upload photo', 500);
        }
    })(request);
}
