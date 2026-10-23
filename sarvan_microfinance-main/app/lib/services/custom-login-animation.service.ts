import { prisma } from '@/app/lib/prisma';
import { validateAnimationManifest } from '@/components/auth/login-animations/validateManifest';
import type { AnimationManifest } from '@/components/auth/login-animations/types';

export interface CustomAnimationDetails {
  id: string;
  key: string;
  name: string;
  version: string;
  themePresetId: string;
  durationMs: number;
  reducedMotionDurationMs: number;
  canvas: {
    width: number;
    height: number;
    background?: string;
  };
  layerCount: number;
  manifest: AnimationManifest;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generates a clean, alphanumeric, kebab-cased key.
 * Appends random entropy if a key collision already exists in the database.
 */
export async function generateSafeUniqueKey(baseId: string): Promise<string> {
  const sanitized =
    baseId
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'animation';

  const existing = await prisma.customLoginAnimation.findUnique({
    where: { key: sanitized },
    select: { id: true },
  });

  if (!existing) {
    return sanitized;
  }

  const suffix = Math.random().toString(36).substring(2, 7);
  return `${sanitized}-${suffix}`;
}

/**
 * Retrieves the custom login animation belonging to a specific ThemePreset.
 * Returns null if the theme has no custom animation.
 */
export async function getCustomLoginAnimationByPresetId(
  themePresetId: string
): Promise<CustomAnimationDetails | null> {
  const record = await prisma.customLoginAnimation.findUnique({
    where: { themePresetId },
  });

  if (!record) return null;

  const manifest = record.manifestJson as unknown as AnimationManifest;

  return {
    id: record.id,
    key: record.key,
    name: record.name,
    version: record.version,
    themePresetId: record.themePresetId,
    durationMs: manifest?.durationMs ?? 0,
    reducedMotionDurationMs: manifest?.reducedMotionDurationMs ?? 0,
    canvas: manifest?.canvas ?? { width: 800, height: 600 },
    layerCount: manifest?.layers?.length ?? 0,
    manifest,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Creates or replaces the single custom login animation for a specific ThemePreset.
 * Validates manifest server-side and updates ThemePreset.loginAnimationKey.
 */
export async function saveCustomLoginAnimationForPreset(
  themePresetId: string,
  input: unknown
) {
  const preset = await prisma.themePreset.findUnique({
    where: { id: themePresetId },
    select: { id: true },
  });

  if (!preset) {
    return {
      success: false as const,
      error: `Theme preset '${themePresetId}' not found`,
    };
  }

  const validation = validateAnimationManifest(input);
  if (!validation.success || !validation.data) {
    return {
      success: false as const,
      error: validation.error || 'Invalid animation manifest',
      issues: validation.issues || [],
    };
  }

  const manifest = validation.data;
  const key = await generateSafeUniqueKey(manifest.id);

  const finalManifest: AnimationManifest = {
    ...manifest,
    id: key,
  };

  // Perform replace & preset pointer update in transaction
  const record = await prisma.$transaction(async (tx) => {
    // Upsert the single custom login animation for this preset
    const savedAnimation = await tx.customLoginAnimation.upsert({
      where: { themePresetId },
      create: {
        key,
        name: manifest.name,
        version: manifest.version,
        manifestJson: finalManifest as unknown as object,
        themePresetId,
      },
      update: {
        key,
        name: manifest.name,
        version: manifest.version,
        manifestJson: finalManifest as unknown as object,
      },
    });

    // Point theme preset's loginAnimationKey to the new animation key
    await tx.themePreset.update({
      where: { id: themePresetId },
      data: { loginAnimationKey: key },
    });

    return savedAnimation;
  });

  return {
    success: true as const,
    data: {
      id: record.id,
      key: record.key,
      name: record.name,
      version: record.version,
      themePresetId: record.themePresetId,
      manifest: finalManifest,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  };
}

/**
 * Deletes the single custom login animation for a specific ThemePreset.
 * Resets ThemePreset.loginAnimationKey to null.
 */
export async function deleteCustomLoginAnimationForPreset(
  themePresetId: string
): Promise<boolean> {
  const record = await prisma.customLoginAnimation.findUnique({
    where: { themePresetId },
    select: { id: true },
  });

  if (!record) return false;

  await prisma.$transaction(async (tx) => {
    await tx.customLoginAnimation.delete({
      where: { themePresetId },
    });

    await tx.themePreset.update({
      where: { id: themePresetId },
      data: { loginAnimationKey: null },
    });
  });

  return true;
}

/**
 * Retrieves a single stored animation manifest by its unique key.
 */
export async function getCustomLoginAnimationByKey(key: string) {
  const record = await prisma.customLoginAnimation.findUnique({
    where: { key },
  });

  if (!record) return null;

  return {
    id: record.id,
    key: record.key,
    name: record.name,
    version: record.version,
    themePresetId: record.themePresetId,
    manifest: record.manifestJson as unknown as AnimationManifest,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
