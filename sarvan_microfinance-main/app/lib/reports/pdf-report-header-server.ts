import type { jsPDF } from 'jspdf';
import sharp from 'sharp';
import { getActiveBrandInfo, getActiveLogoBuffer } from '@/app/lib/brand-server';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';
import { hexToRgb } from '@/app/lib/color-scale';
import { setDocBrandPrimaryRgb, setDocBrandTintRgb } from '@/app/lib/reports/pdf-brand-color';

/**
 * Server-side (Node) counterpart to pdf-report-header.ts's drawPdfReportHeader —
 * same visual layout (logo + company name + report title + optional subtitle +
 * green divider line, same fonts/sizes/colors/positions), but sourced from
 * Node-safe loaders (getActiveLogoBuffer/getActiveBrandNames, already used by
 * the queue's generic Puppeteer PDF path) instead of the client-only
 * `new Image()` / getBrandNamesGlobal(), so the Request Report background
 * worker (no window/DOM, no same-origin fetch) can draw the identical header.
 *
 * pdf-report-header.ts itself is intentionally left untouched — this is a
 * separate, additive file so no other (browser) report's PDF is affected.
 */

export type LoadedServerLogo = {
  dataUrl: string;
  format: 'JPEG';
  naturalWidth: number;
  naturalHeight: number;
} | null;

let cachedLogo: LoadedServerLogo | undefined;

export async function loadServerLogoForPdf(): Promise<LoadedServerLogo> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const logo = await getActiveLogoBuffer();
    if (!logo) {
      cachedLogo = null;
      return null;
    }
    const metadata = await sharp(logo.buffer).metadata();
    const compressed = await compressImageBufferForPdf(logo.buffer);
    if (!compressed || !metadata.width || !metadata.height) {
      cachedLogo = null;
      return null;
    }
    cachedLogo = {
      dataUrl: compressed.dataUrl,
      format: 'JPEG',
      naturalWidth: metadata.width,
      naturalHeight: metadata.height,
    };
  } catch {
    cachedLogo = null;
  }
  return cachedLogo;
}

export async function drawPdfReportHeaderServer(
  doc: jsPDF,
  reportTitle: string,
  opts?: { subtitle?: string; fontFamily?: string }
): Promise<number> {
  const font = opts?.fontFamily ?? 'times';
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const compact = pageWidth < 100;
  const margin = compact ? 5 : 15;

  const [logo, { companyNameFull, primaryColor, primaryDark, primaryTint }] = await Promise.all([
    loadServerLogoForPdf(),
    getActiveBrandInfo(),
  ]);
  const companyNameCaps = companyNameFull.toUpperCase();
  const primaryDarkRgb = hexToRgb(primaryDark);
  const primaryRgb = hexToRgb(primaryColor);
  setDocBrandPrimaryRgb(doc, primaryRgb);
  setDocBrandTintRgb(doc, hexToRgb(primaryTint));
  let y = compact ? 6 : 17;

  if (logo) {
    const targetHeight = compact ? 8 : 12;
    const targetWidth = logo.naturalHeight > 0
      ? Math.min(targetHeight * (logo.naturalWidth / logo.naturalHeight), compact ? pageWidth - margin * 2 : 38)
      : targetHeight;

    if (compact) {
      doc.addImage(logo.dataUrl, logo.format, centerX - targetWidth / 2, y, targetWidth, targetHeight);
      y += targetHeight + 3;
    } else {
      doc.addImage(logo.dataUrl, logo.format, 15, 10, targetWidth, targetHeight);
    }
  }

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
