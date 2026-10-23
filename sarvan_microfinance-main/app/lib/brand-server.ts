import fs from 'fs';
import path from 'path';
import { prisma } from '@/app/lib/prisma';
import { downloadObject } from '@/app/lib/storage/gcs-client';

const DEFAULT_COMPANY_NAME_SHORT = 'KTGT';
const DEFAULT_COMPANY_NAME_FULL = 'Knock The Globe Technologies';
const LOCAL_LOGO_FALLBACK = 'Sarvam_01.png';
const LOCAL_SIGNATORY_FALLBACK = 'authorised_signatory.png';

/**
 * Server-side (Node/Prisma) equivalent of `useBrandNames()` — for code that
 * runs outside the React tree (generateMetadata, background report workers,
 * report-query builders). Always reads the active ThemePreset live, same
 * reasoning as `getActiveTheme()` in app/layout.tsx.
 */
export async function getActiveBrandNames(): Promise<{ companyNameShort: string; companyNameFull: string }> {
  try {
    const theme = await prisma.themePreset.findFirst({
      where: { isActive: true },
      select: { companyNameShort: true, companyNameFull: true },
    });
    return {
      companyNameShort: theme?.companyNameShort || DEFAULT_COMPANY_NAME_SHORT,
      companyNameFull: theme?.companyNameFull || DEFAULT_COMPANY_NAME_FULL,
    };
  } catch {
    return { companyNameShort: DEFAULT_COMPANY_NAME_SHORT, companyNameFull: DEFAULT_COMPANY_NAME_FULL };
  }
}

const DEFAULT_PRIMARY_COLOR = '#037f35';
const DEFAULT_PRIMARY_DARK = '#025c27';
const DEFAULT_PRIMARY_TINT = '#e6f5ec';

/**
 * Server-side (Node/Prisma) equivalent of the color half of `useBrandNames()` —
 * for report export builders (jsPDF headers, docx-core.ts) that run outside the
 * React tree and draw brand color directly (jsPDF setTextColor/docx shading)
 * rather than through the CSS `--primary` custom property.
 */
export async function getActiveBrandColors(): Promise<{ primaryColor: string; primaryDark: string; primaryTint: string }> {
  try {
    const theme = await prisma.themePreset.findFirst({
      where: { isActive: true },
      select: { primaryColor: true, primaryDark: true, primaryTint: true },
    });
    return {
      primaryColor: theme?.primaryColor || DEFAULT_PRIMARY_COLOR,
      primaryDark: theme?.primaryDark || DEFAULT_PRIMARY_DARK,
      primaryTint: theme?.primaryTint || DEFAULT_PRIMARY_TINT,
    };
  } catch {
    return { primaryColor: DEFAULT_PRIMARY_COLOR, primaryDark: DEFAULT_PRIMARY_DARK, primaryTint: DEFAULT_PRIMARY_TINT };
  }
}

/**
 * Combined names + colors in a single `themePreset.findFirst` — for callers that need both
 * (report PDF/Word header builders) so they don't issue two separate live queries per call
 * the way `getActiveBrandNames()` + `getActiveBrandColors()` would if awaited sequentially.
 */
export async function getActiveBrandInfo(): Promise<{
  companyNameShort: string;
  companyNameFull: string;
  primaryColor: string;
  primaryDark: string;
  primaryTint: string;
}> {
  try {
    const theme = await prisma.themePreset.findFirst({
      where: { isActive: true },
      select: { companyNameShort: true, companyNameFull: true, primaryColor: true, primaryDark: true, primaryTint: true },
    });
    return {
      companyNameShort: theme?.companyNameShort || DEFAULT_COMPANY_NAME_SHORT,
      companyNameFull: theme?.companyNameFull || DEFAULT_COMPANY_NAME_FULL,
      primaryColor: theme?.primaryColor || DEFAULT_PRIMARY_COLOR,
      primaryDark: theme?.primaryDark || DEFAULT_PRIMARY_DARK,
      primaryTint: theme?.primaryTint || DEFAULT_PRIMARY_TINT,
    };
  } catch {
    return {
      companyNameShort: DEFAULT_COMPANY_NAME_SHORT,
      companyNameFull: DEFAULT_COMPANY_NAME_FULL,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      primaryDark: DEFAULT_PRIMARY_DARK,
      primaryTint: DEFAULT_PRIMARY_TINT,
    };
  }
}

/**
 * Server-side (Node/Prisma/GCS) resolution of the active logo-wordmark image —
 * same source of truth as `GET /api/branding/asset/logo-wordmark`, for code
 * that needs the raw bytes directly (e.g. embedding into a Puppeteer-rendered
 * PDF) rather than an <img src> URL.
 */
export async function getActiveLogoBuffer(): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const preset = await prisma.themePreset.findFirst({
      where: { isActive: true },
      select: { logoWordmarkKey: true },
    });
    if (preset?.logoWordmarkKey) {
      const object = await downloadObject(preset.logoWordmarkKey);
      if (object) return object;
    }
    const buffer = fs.readFileSync(path.join(process.cwd(), 'public', LOCAL_LOGO_FALLBACK));
    return { buffer, contentType: 'image/png' };
  } catch {
    return null;
  }
}

/**
 * Server-side (Node/Prisma/GCS) resolution of the active authorised-
 * signatory image — same source of truth as `GET /api/branding/asset/
 * authorised-signatory`, for HR letter builders (hr-letter-common.ts) that
 * need the raw bytes directly rather than an <img src> URL.
 */
export async function getActiveSignatoryBuffer(): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const preset = await prisma.themePreset.findFirst({
      where: { isActive: true },
      select: { authorisedSignatoryKey: true },
    });
    if (preset?.authorisedSignatoryKey) {
      const object = await downloadObject(preset.authorisedSignatoryKey);
      if (object) return object;
    }
    const buffer = fs.readFileSync(path.join(process.cwd(), 'public', LOCAL_SIGNATORY_FALLBACK));
    return { buffer, contentType: 'image/png' };
  } catch {
    return null;
  }
}
