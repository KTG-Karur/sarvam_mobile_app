import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, corsHeaders } from '@/app/lib/api-utils';
import { downloadObject } from '@/app/lib/storage/gcs-client';

/**
 * Bundled default shown until an admin uploads a white-label override.
 * `payment-qr` deliberately has NO fallback here — it's a real payment
 * destination (UPI/bank account), so a theme with no QR of its own must show
 * nothing rather than silently reuse another organization's QR code.
 */
const LOCAL_FALLBACK: Record<string, string> = {
  'logo-wordmark': 'Sarvam_01.png',
  'logo-icon': 'Sarvam_icon.png',
  'tamil-logo': 'tamil_sarvam.png',
  'page-loader': 'Sarvam_icon.png',
  'authorised-signatory': 'authorised_signatory.png',
};

function readLocalFallback(kind: string): { buffer: Buffer; contentType: string } | null {
  const fileName = LOCAL_FALLBACK[kind];
  if (!fileName) return null;
  try {
    const buffer = fs.readFileSync(path.join(process.cwd(), 'public', fileName));
    return { buffer, contentType: 'image/png' };
  } catch {
    return null;
  }
}

/**
 * GET /api/branding/asset/logo-wordmark
 * GET /api/branding/asset/logo-icon
 * GET /api/branding/asset/favicon
 * GET /api/branding/asset/tamil-logo
 * GET /api/branding/asset/payment-qr
 * GET /api/branding/asset/page-loader
 * GET /api/branding/asset/login-slide/{id}
 *
 * Intentionally unauthenticated — these are white-label branding images
 * (logo, favicon, login carousel photos, print/PDF assets) that must render
 * on the unauthenticated login page, in the browser tab, and in server-side
 * PDF/print generation, so they cannot sit behind the private-bucket
 * signed-URL flow used for client documents (see gcs-client.ts).
 *
 * `logo-wordmark`/`logo-icon`/`tamil-logo` fall back to the bundled default
 * Sarvam assets when no admin override has been uploaded yet, so out-of-the-
 * box branding keeps working unchanged. `favicon`/`payment-qr`/`login-slide`
 * have no sensible shared default and simply 404 (callers handle that — see
 * app/layout.tsx, generate-passbook/route.ts, and the login page). `payment-
 * qr` in particular must never fall back to another theme's QR — it's a real
 * payment destination, not just cosmetic branding.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string[] }> }
) {
  const { type } = await params;
  const [kind, id] = type;

  let key: string | null | undefined;

  switch (kind) {
    case 'logo-wordmark':
    case 'logo-icon':
    case 'favicon':
    case 'tamil-logo':
    case 'payment-qr':
    case 'page-loader':
    case 'authorised-signatory': {
      // Public callers (login page, browser favicon, PDF headers) always resolve
      // the currently active preset. The admin editor may pass ?presetId= to
      // preview a not-yet-active preset's own assets while editing it.
      const presetId = request.nextUrl.searchParams.get('presetId');
      const preset = await prisma.themePreset.findFirst({
        where: presetId ? { id: presetId } : { isActive: true },
        select: {
          logoWordmarkKey: true,
          logoIconKey: true,
          faviconKey: true,
          tamilLogoKey: true,
          paymentQrKey: true,
          pageLoaderKey: true,
          authorisedSignatoryKey: true,
        },
      });
      key =
        kind === 'logo-wordmark' ? preset?.logoWordmarkKey :
        kind === 'logo-icon' ? preset?.logoIconKey :
        kind === 'favicon' ? preset?.faviconKey :
        kind === 'tamil-logo' ? preset?.tamilLogoKey :
        kind === 'page-loader' ? preset?.pageLoaderKey :
        kind === 'authorised-signatory' ? preset?.authorisedSignatoryKey :
        preset?.paymentQrKey;
      break;
    }
    case 'login-slide': {
      if (!id) return new NextResponse(null, { status: 404 });
      const slide = await prisma.loginSlide.findUnique({ where: { id }, select: { imageKey: true } });
      key = slide?.imageKey;
      break;
    }
    default:
      return new NextResponse(null, { status: 404 });
  }

  const object = key ? await downloadObject(key) : null;
  const resolved = object ?? readLocalFallback(kind);
  if (!resolved) return new NextResponse(null, { status: 404 });

  // Callers that know the BrandConfig/LoginSlide timestamp cache-bust via `?v=`,
  // so that URL is safe to cache indefinitely. Callers without easy access to the
  // timestamp (most print/print-preview components) hit the plain URL, which gets
  // a short cache so a re-uploaded logo/photo still propagates without a hard refresh.
  const isVersioned = request.nextUrl.searchParams.has('v');

  return new NextResponse(new Uint8Array(resolved.buffer), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': resolved.contentType,
      'Cache-Control': isVersioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300, must-revalidate',
    },
  });
}

export async function OPTIONS() {
  return handleCorsPreflight();
}
