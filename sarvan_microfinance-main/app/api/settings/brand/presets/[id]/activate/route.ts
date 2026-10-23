import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

/**
 * POST /api/settings/brand/presets/[id]/activate
 * Makes this theme preset the active one for the entire app. Mirrors the
 * AreaManagerBranch.isPrimary pattern: clear isActive on every row, then set
 * it on the target, inside one transaction — no partial state possible.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withRole(['ADMIN'], async () => {
    try {
      const target = await prisma.themePreset.findUnique({ where: { id } });
      if (!target) return errorResponse('Theme preset not found', 404);

      await prisma.$transaction([
        prisma.themePreset.updateMany({ where: { isActive: true }, data: { isActive: false } }),
        prisma.themePreset.update({ where: { id }, data: { isActive: true } }),
      ]);

      revalidateTag('brand-config', {});

      return successResponse(null, `"${target.name}" is now the active theme`);
    } catch (error: unknown) {
      return errorResponse((error as Error).message || 'Failed to activate theme', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
