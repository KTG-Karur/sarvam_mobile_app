import { NextRequest } from 'next/server';
import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { deleteBrandAsset, deleteLoginSlideImage } from '@/app/lib/storage/branding-storage';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color');

const themePresetSchema = z.object({
  name:             z.string().min(1).max(80),
  primaryColor:    hexColor,
  primaryDark:     hexColor,
  primaryDarker:   hexColor,
  primaryLight:    hexColor,
  primaryTint:     hexColor,
  secondaryColor:  hexColor,
  sidebarBg:       hexColor,
  sidebarText:     hexColor,
  sidebarFontSize: z.number().min(1).max(100),
  sidebarBrandFontSize: z.number().min(1).max(100),
  sidebarFullNameFontSize: z.number().min(1).max(100),
  navBg:           hexColor,
  pageBg:          hexColor,
  foregroundColor: hexColor,
  fontSizeBase:    z.number().min(1).max(100),
  companyNameShort: z.string().min(1).max(60),
  companyNameFull:  z.string().min(1).max(120),
  loginAnimationKey: z.string().nullable().optional(),
  // G-Pay / PhonePe number on the passbook; blank clears it (line omitted on the PDF)
  paymentUpiNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+\-\s,/]*$/, 'G-Pay / PhonePe number can only contain digits, spaces, +, - , or /')
    .nullable()
    .optional()
    .transform((v) => v || null),
});

/**
 * GET /api/settings/brand/presets/[id]
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(async () => {
    try {
      const preset = await prisma.themePreset.findUnique({ where: { id } });
      if (!preset) return errorResponse('Theme preset not found', 404);
      return successResponse(preset, 'Theme preset retrieved');
    } catch (error) {
      console.error('Error fetching theme preset:', error);
      return errorResponse('Failed to fetch theme preset', 500);
    }
  })(request);
}

/**
 * PUT /api/settings/brand/presets/[id]
 * Updates a preset's own config. Never touches `isActive` — activation is a
 * separate explicit action (see /presets/[id]/activate).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const existing = await prisma.themePreset.findUnique({ where: { id } });
      if (!existing) return errorResponse('Theme preset not found', 404);

      const body = await req.json();
      const validated = themePresetSchema.parse(body);

      const result = await prisma.themePreset.update({ where: { id }, data: validated });

      revalidateTag('brand-config', {});

      return successResponse(result, 'Theme preset saved');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse((error as Error).message || 'Failed to save theme preset', 500);
    }
  })(request);
}

/**
 * DELETE /api/settings/brand/presets/[id]
 * Refuses to delete the active preset or the last remaining preset. Cleans up
 * the preset's own logo/favicon and all of its login slides' GCS objects
 * (DB rows cascade automatically via the ThemePreset -> LoginSlide relation).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withRole(['ADMIN'], async () => {
    try {
      const target = await prisma.themePreset.findUnique({
        where: { id },
        include: { loginSlides: { select: { imageKey: true } } },
      });
      if (!target) return errorResponse('Theme preset not found', 404);
      if (target.isActive) return errorResponse('Cannot delete the active theme — activate a different theme first', 400);

      const count = await prisma.themePreset.count();
      if (count <= 1) return errorResponse('Cannot delete the last remaining theme preset', 400);

      await prisma.themePreset.delete({ where: { id } });

      const assetKeys = [target.logoWordmarkKey, target.logoIconKey, target.faviconKey].filter(
        (k): k is string => !!k
      );
      await Promise.all([
        ...assetKeys.map((key) => deleteBrandAsset(key).catch(() => {})),
        ...target.loginSlides.map((s) => deleteLoginSlideImage(s.imageKey).catch(() => {})),
      ]);

      return successResponse(null, 'Theme preset deleted');
    } catch (error: unknown) {
      return errorResponse((error as Error).message || 'Failed to delete theme preset', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
