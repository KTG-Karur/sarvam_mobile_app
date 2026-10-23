import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { uploadLoginSlideImage } from '@/app/lib/storage/branding-storage';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * GET /api/settings/brand/login-slides?themePresetId=<id>
 */
export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const themePresetId = req.nextUrl.searchParams.get('themePresetId');
      if (!themePresetId) return errorResponse('themePresetId is required', 400);

      const slides = await prisma.loginSlide.findMany({
        where: { themePresetId },
        orderBy: { sortOrder: 'asc' },
      });
      return successResponse(slides, 'Login slides retrieved');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to fetch login slides', 500);
    }
  })(request);
}

/**
 * POST /api/settings/brand/login-slides
 * Create a login carousel slide for a specific theme preset. Expects multipart
 * FormData: `themePresetId`, `image` (file), `title`, `description`, `sortOrder`.
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const formData = await req.formData();
      const themePresetId = formData.get('themePresetId') as string | null;
      const image = formData.get('image') as File | null;
      const title = formData.get('title') as string | null;
      const description = formData.get('description') as string | null;
      const sortOrder = Number(formData.get('sortOrder') ?? 0);

      if (!themePresetId) return errorResponse('themePresetId is required', 400);
      if (!image) return errorResponse('Slide image is required', 400);
      if (!image.type.startsWith('image/')) return errorResponse('Only image files are accepted', 400);
      if (image.size > MAX_IMAGE_BYTES) return errorResponse('Image must be under 5MB', 400);
      if (!title) return errorResponse('Title is required', 400);
      if (!description) return errorResponse('Description is required', 400);
      if (!Number.isFinite(sortOrder)) return errorResponse('Invalid sort order', 400);
      if (sortOrder < 0) return errorResponse('Sort order cannot be negative', 400);

      const preset = await prisma.themePreset.findUnique({ where: { id: themePresetId }, select: { id: true } });
      if (!preset) return errorResponse('Theme preset not found', 404);

      const duplicate = await prisma.loginSlide.findFirst({ where: { themePresetId, sortOrder }, select: { id: true } });
      if (duplicate) return errorResponse(`Sort order ${sortOrder} is already used by another slide`, 409);

      const buffer = Buffer.from(await image.arrayBuffer());
      const uploaded = await uploadLoginSlideImage({
        fileBuffer: buffer,
        contentType: image.type,
        fileName: image.name,
      });

      const slide = await prisma.loginSlide.create({
        data: {
          themePresetId,
          imageKey: uploaded.fileKey,
          title,
          description,
          sortOrder,
        },
      });

      return successResponse(slide, 'Login slide created');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to create login slide', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
