import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { uploadBrandAsset, deleteBrandAsset } from '@/app/lib/storage/branding-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

// The active ThemePreset is the app-wide singleton brand config (same table
// the logo/favicon/etc. live on) — HR letters always resolve "the" signature
// off it, so this route never needs a presetId the way the generic
// /api/settings/brand/assets route does for the multi-preset editor.
async function getOrCreateActivePreset() {
    const existing = await prisma.themePreset.findFirst({ where: { isActive: true } });
    if (existing) return existing;
    return prisma.themePreset.create({ data: { name: 'Default', isActive: true } });
}

// POST /api/hr/signature — upload/replace the authorised-signatory image
// embedded in Confirmation/Promotion/Relieving letters. Multipart: `image`.
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const formData = await req.formData();
            const image = formData.get('image') as File | null;

            if (!image) return errorResponse('Image is required', 400);
            if (!image.type.startsWith('image/')) return errorResponse('Only image files are accepted', 400);
            if (image.size > MAX_IMAGE_BYTES) return errorResponse('Image must be under 5MB', 400);

            const preset = await getOrCreateActivePreset();
            const oldKey = preset.authorisedSignatoryKey;

            const buffer = Buffer.from(await image.arrayBuffer());
            const uploaded = await uploadBrandAsset({
                type: 'authorised-signatory',
                fileBuffer: buffer,
                contentType: image.type,
                fileName: image.name,
            });

            await prisma.themePreset.update({
                where: { id: preset.id },
                data: { authorisedSignatoryKey: uploaded.fileKey },
            });

            if (oldKey) await deleteBrandAsset(oldKey);

            return successResponse(null, 'Signature uploaded successfully');
        } catch (error: any) {
            console.error('Error uploading signature:', error);
            return errorResponse(error.message || 'Failed to upload signature', 500);
        }
    })(request);
}

// DELETE /api/hr/signature — revert to the bundled default signature image.
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const preset = await prisma.themePreset.findFirst({ where: { isActive: true } });
            if (!preset?.authorisedSignatoryKey) {
                return successResponse(null, 'Already using the default signature');
            }

            const oldKey = preset.authorisedSignatoryKey;
            await prisma.themePreset.update({
                where: { id: preset.id },
                data: { authorisedSignatoryKey: null },
            });
            await deleteBrandAsset(oldKey);

            return successResponse(null, 'Signature reset to default');
        } catch (error: any) {
            console.error('Error resetting signature:', error);
            return errorResponse(error.message || 'Failed to reset signature', 500);
        }
    })(request);
}
