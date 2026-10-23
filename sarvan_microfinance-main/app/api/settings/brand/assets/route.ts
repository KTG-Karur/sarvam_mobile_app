import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { uploadBrandAsset, deleteBrandAsset, type BrandAssetType } from '@/app/lib/storage/branding-storage';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const KEY_FIELD: Record<BrandAssetType, 'logoWordmarkKey' | 'logoIconKey' | 'faviconKey' | 'tamilLogoKey' | 'paymentQrKey' | 'pageLoaderKey' | 'authorisedSignatoryKey'> = {
  'logo-wordmark': 'logoWordmarkKey',
  'logo-icon': 'logoIconKey',
  favicon: 'faviconKey',
  'tamil-logo': 'tamilLogoKey',
  'payment-qr': 'paymentQrKey',
  'page-loader': 'pageLoaderKey',
  'authorised-signatory': 'authorisedSignatoryKey',
};

function isBrandAssetType(value: unknown): value is BrandAssetType {
  return (
    value === 'logo-wordmark' ||
    value === 'logo-icon' ||
    value === 'favicon' ||
    value === 'tamil-logo' ||
    value === 'payment-qr' ||
    value === 'page-loader' ||
    value === 'authorised-signatory'
  );
}

/**
 * POST /api/settings/brand/assets
 * Upload/replace a theme preset's logo wordmark, sidebar icon, favicon, Tamil
 * logo, or payment QR. Expects multipart FormData: `presetId`, `type`, `image`.
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const formData = await req.formData();
      const presetId = formData.get('presetId');
      const type = formData.get('type');
      const image = formData.get('image') as File | null;

      if (typeof presetId !== 'string' || !presetId) return errorResponse('presetId is required', 400);
      if (!isBrandAssetType(type)) return errorResponse('Invalid asset type', 400);
      if (!image) return errorResponse('Image is required', 400);
      if (!image.type.startsWith('image/')) return errorResponse('Only image files are accepted', 400);
      if (image.size > MAX_IMAGE_BYTES) return errorResponse('Image must be under 5MB', 400);

      const field = KEY_FIELD[type];
      const existing = await prisma.themePreset.findUnique({ where: { id: presetId } });
      if (!existing) return errorResponse('Theme preset not found', 404);
      const oldKey = existing[field];

      const buffer = Buffer.from(await image.arrayBuffer());
      const uploaded = await uploadBrandAsset({
        type,
        fileBuffer: buffer,
        contentType: image.type,
        fileName: image.name,
      });

      const result = await prisma.themePreset.update({
        where: { id: presetId },
        data: { [field]: uploaded.fileKey },
      });

      if (oldKey) await deleteBrandAsset(oldKey);

      revalidateTag('brand-config', {});

      return successResponse(result, 'Brand asset uploaded');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to upload brand asset', 500);
    }
  })(request);
}

/**
 * DELETE /api/settings/brand/assets?type=logo-wordmark&presetId=<id>
 * Clears an uploaded asset from a theme preset, reverting to the bundled default.
 */
export async function DELETE(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const type = req.nextUrl.searchParams.get('type');
      const presetId = req.nextUrl.searchParams.get('presetId');
      if (!isBrandAssetType(type)) return errorResponse('Invalid asset type', 400);
      if (!presetId) return errorResponse('presetId is required', 400);

      const field = KEY_FIELD[type];
      const existing = await prisma.themePreset.findUnique({ where: { id: presetId } });
      if (!existing) return errorResponse('Theme preset not found', 404);

      const oldKey = existing[field];
      const result = await prisma.themePreset.update({
        where: { id: presetId },
        data: { [field]: null },
      });
      if (oldKey) await deleteBrandAsset(oldKey);

      revalidateTag('brand-config', {});

      return successResponse(result, 'Brand asset reset to default');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to reset brand asset', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
