import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { uploadLoginSlideImage, deleteLoginSlideImage } from '@/app/lib/storage/branding-storage';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * PUT /api/settings/brand/login-slides/[id]
 * Update a login carousel slide. Expects multipart FormData:
 * `title`, `description`, `sortOrder`, and an optional `image` file to replace the photo.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const existing = await prisma.loginSlide.findUnique({ where: { id } });
      if (!existing) return errorResponse('Login slide not found', 404);

      const formData = await req.formData();
      const image = formData.get('image') as File | null;
      const title = formData.get('title') as string | null;
      const description = formData.get('description') as string | null;
      const sortOrder = Number(formData.get('sortOrder') ?? existing.sortOrder);

      if (!title) return errorResponse('Title is required', 400);
      if (!description) return errorResponse('Description is required', 400);
      if (!Number.isFinite(sortOrder)) return errorResponse('Invalid sort order', 400);
      if (sortOrder < 0) return errorResponse('Sort order cannot be negative', 400);

      if (sortOrder !== existing.sortOrder) {
        const duplicate = await prisma.loginSlide.findFirst({
          where: { themePresetId: existing.themePresetId, sortOrder, id: { not: id } },
          select: { id: true },
        });
        if (duplicate) return errorResponse(`Sort order ${sortOrder} is already used by another slide`, 409);
      }

      let imageKey = existing.imageKey;
      if (image && image.size > 0) {
        if (!image.type.startsWith('image/')) return errorResponse('Only image files are accepted', 400);
        if (image.size > MAX_IMAGE_BYTES) return errorResponse('Image must be under 5MB', 400);

        const buffer = Buffer.from(await image.arrayBuffer());
        const uploaded = await uploadLoginSlideImage({
          fileBuffer: buffer,
          contentType: image.type,
          fileName: image.name,
        });
        await deleteLoginSlideImage(existing.imageKey);
        imageKey = uploaded.fileKey;
      }

      const slide = await prisma.loginSlide.update({
        where: { id },
        data: { title, description, sortOrder, imageKey },
      });

      return successResponse(slide, 'Login slide updated');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to update login slide', 500);
    }
  })(request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async () => {
    try {
      const existing = await prisma.loginSlide.findUnique({ where: { id } });
      if (!existing) return errorResponse('Login slide not found', 404);

      await prisma.loginSlide.delete({ where: { id } });
      await deleteLoginSlideImage(existing.imageKey);

      return successResponse(null, 'Login slide deleted');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to delete login slide', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
