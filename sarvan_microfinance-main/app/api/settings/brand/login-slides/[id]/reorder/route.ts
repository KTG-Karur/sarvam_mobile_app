import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

/**
 * POST /api/settings/brand/login-slides/[id]/reorder
 * Swaps this slide's sortOrder with its immediate neighbor in the given
 * direction. Expects JSON body: `{ direction: 'up' | 'down' }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json().catch(() => null);
      const direction = body?.direction;
      if (direction !== 'up' && direction !== 'down') {
        return errorResponse('direction must be "up" or "down"', 400);
      }

      const current = await prisma.loginSlide.findUnique({ where: { id } });
      if (!current) return errorResponse('Login slide not found', 404);

      const neighbor = await prisma.loginSlide.findFirst({
        where: {
          themePresetId: current.themePresetId,
          sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
        },
        orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      });

      if (!neighbor) {
        return errorResponse(`Slide is already at the ${direction === 'up' ? 'top' : 'bottom'}`, 400);
      }

      await prisma.$transaction([
        prisma.loginSlide.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } }),
        prisma.loginSlide.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } }),
      ]);

      return successResponse(null, 'Slide reordered');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to reorder slide', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
