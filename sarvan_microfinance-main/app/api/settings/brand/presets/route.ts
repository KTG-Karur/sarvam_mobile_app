import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { withAuth, withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';

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
 * GET /api/settings/brand/presets
 * List every saved theme preset.
 */
export async function GET(request: NextRequest) {
  return withAuth(async () => {
    try {
      // Secondary `id` tiebreaker: presets seeded in the same batch (e.g. the initial
      // 4 defaults) can share an identical `createdAt` — Postgres gives every row in a
      // single multi-row INSERT the same statement-level `now()`. Without a tiebreaker,
      // ties have no defined order and can flip between requests, making cards appear
      // to swap positions on every reload.
      const presets = await prisma.themePreset.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return successResponse(presets, 'Theme presets retrieved');
    } catch (error) {
      console.error('Error fetching theme presets:', error);
      return errorResponse('Failed to fetch theme presets', 500);
    }
  })(request);
}

/**
 * POST /api/settings/brand/presets
 * Create a new theme preset. Always created inactive — activating a preset
 * is a separate explicit action (see /presets/[id]/activate).
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();
      const validated = themePresetSchema.parse(body);

      const preset = await prisma.themePreset.create({
        data: { ...validated, isActive: false },
      });

      return successResponse(preset, 'Theme preset created');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse((error as Error).message || 'Failed to create theme preset', 500);
    }
  })(request);
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
