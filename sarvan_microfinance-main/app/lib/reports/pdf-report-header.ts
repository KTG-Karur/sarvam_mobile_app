import type { jsPDF } from 'jspdf';
import { getBrandNamesGlobal } from '@/app/lib/brand-context';
import { compressDataUrlForPdf } from '@/app/lib/pdf/compress-image-for-pdf';
import { hexToRgb } from '@/app/lib/color-scale';
import { setDocBrandPrimaryRgb, setDocBrandTintRgb } from '@/app/lib/reports/pdf-brand-color';

const LOGO_SRC = '/api/branding/asset/logo-wordmark';

let cachedLogo: HTMLImageElement | null | undefined;
// Keyed by BrandNames.logoVersion (BrandConfig.updatedAt as epoch ms) so a
// freshly-uploaded logo busts the cache in an already-open tab, matching the
// `?v=` convention used by the sidebar/login logo <img> tags.
let cachedLogoVersion: number | undefined;
// Compressed JPEG data URL for the currently cached logo — embedding the raw
// source PNG at full pixel resolution (e.g. 2134x738) via doc.addImage() bloats
// the PDF to several MB since jsPDF doesn't downsample to the display size.
let cachedCompressedLogo: string | null | undefined;

function loadLogo(): Promise<HTMLImageElement | null> {
  const logoVersion = getBrandNamesGlobal().logoVersion;
  if (cachedLogo !== undefined && cachedLogoVersion === logoVersion) return Promise.resolve(cachedLogo);
  return new Promise((resolve) => {
    const img = new Image();
    img.src = logoVersion ? `${LOGO_SRC}?v=${logoVersion}` : LOGO_SRC;
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      cachedLogo = img;
      cachedLogoVersion = logoVersion;
      cachedCompressedLogo = undefined;
      resolve(img);
    };
    img.onerror = () => {
      cachedLogo = null;
      cachedLogoVersion = logoVersion;
      cachedCompressedLogo = undefined;
      resolve(null);
    };
  });
}

/** Returns a small re-encoded JPEG data URL for the given (already-loaded) logo image, falling back to the raw image on compression failure. */
async function getCompressedLogo(logo: HTMLImageElement): Promise<{ src: string | HTMLImageElement; format: 'JPEG' | 'PNG' }> {
  if (cachedCompressedLogo !== undefined) {
    return cachedCompressedLogo ? { src: cachedCompressedLogo, format: 'JPEG' } : { src: logo, format: 'PNG' };
  }
  try {
    const compressed = await compressDataUrlForPdf(logo.src, 700, 0.6);
    cachedCompressedLogo = compressed;
    return { src: compressed, format: 'JPEG' };
  } catch {
    cachedCompressedLogo = null;
    return { src: logo, format: 'PNG' };
  }
}

/**
 * Draws the standard trust header (logo + SARVAM CHARITABLE TRUST + report title)
 * at the top of a jsPDF document and returns the Y coordinate to continue drawing from
 * (e.g. pass as `startY` to the first autoTable call).
 */
export async function drawPdfReportHeader(
  doc: jsPDF,
  reportTitle: string,
  opts?: { subtitle?: string; fontFamily?: string }
): Promise<number> {
  // Caller passes 'times' (from ensureReportFont) — jsPDF's built-in Times New Roman.
  const font = opts?.fontFamily ?? 'times';
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  // Narrow formats (e.g. 80mm thermal receipts) don't have room for the logo
  // beside the centered title text without overlapping it — stack them instead
  // and scale everything down.
  const compact = pageWidth < 100;
  const margin = compact ? 5 : 15;

  const logo = await loadLogo();
  const brand = getBrandNamesGlobal();
  const companyNameCaps = brand.companyNameFull.toUpperCase();
  const primaryDarkRgb = hexToRgb(brand.primaryDark);
  const primaryRgb = hexToRgb(brand.primaryColor);
  setDocBrandPrimaryRgb(doc, primaryRgb);
  setDocBrandTintRgb(doc, hexToRgb(brand.primaryTint));
  let y = compact ? 6 : 17;

  if (logo) {
    // The source PNG is a wide icon+wordmark lockup, not a square — draw it at its
    // real aspect ratio so it never gets stretched/squashed into a square box.
    const naturalWidth = logo.naturalWidth || logo.width;
    const naturalHeight = logo.naturalHeight || logo.height;
    const targetHeight = compact ? 8 : 12;
    const targetWidth = naturalHeight > 0
      ? Math.min(targetHeight * (naturalWidth / naturalHeight), compact ? pageWidth - margin * 2 : 38)
      : targetHeight;

    const { src: logoSrc, format: logoFormat } = await getCompressedLogo(logo);

    if (compact) {
      doc.addImage(logoSrc, logoFormat, centerX - targetWidth / 2, y, targetWidth, targetHeight);
      y += targetHeight + 3;
    } else {
      doc.addImage(logoSrc, logoFormat, 15, 10, targetWidth, targetHeight);
    }
  }

  // Non-compact sizes are pinned to the 11pt report font size (compact — narrow formats like
  // 80mm thermal receipts — keeps its existing smaller sizes, just switched to `font`, since
  // that layout has no room to spare for 11pt).
  doc.setFont(font, 'bold');
  doc.setFontSize(compact ? 9 : 11);
  doc.setTextColor(...primaryDarkRgb);
  doc.text(companyNameCaps, centerX, y, { align: 'center' });
  y += compact ? 5 : 7;

  doc.setFont(font, 'bold');
  doc.setFontSize(compact ? 7 : 11);
  doc.setTextColor(...primaryRgb);
  doc.text(reportTitle, centerX, y, { align: 'center' });
  y += compact ? 4 : 6;

  if (opts?.subtitle) {
    doc.setFont(font, 'normal');
    doc.setFontSize(compact ? 5 : 11);
    doc.setTextColor(80, 80, 80);
    const subtitleLines = compact
      ? doc.splitTextToSize(opts.subtitle, pageWidth - margin * 2)
      : [opts.subtitle];
    doc.text(subtitleLines, centerX, y, { align: 'center' });
    y += (compact ? 3 : 4) * subtitleLines.length;
  }

  doc.setDrawColor(...primaryRgb);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);

  doc.setTextColor(0, 0, 0);

  return y + (compact ? 3 : 5);
}
