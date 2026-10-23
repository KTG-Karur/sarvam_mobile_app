import fs from 'fs';
import path from 'path';
import type { jsPDF } from 'jspdf';

// Server-side counterpart to pdf-fonts.ts's ensureReportFont — reads the same
// public/fonts/Poppins-*.ttf files from disk (Puppeteer runs server-side, so
// it can't fetch() a same-origin URL the way the client-side jsPDF exports
// do) and returns a ready-to-inline base64 @font-face CSS block, so headless
// Chromium renders the same Poppins used by the app UI and the jsPDF exports
// instead of whatever generic sans-serif happens to be installed on the host.
let cache: string | null | undefined;

/** Returns Poppins @font-face CSS, or '' (safe to interpolate, never throws) if the TTFs are missing. */
export function getPoppinsFontFaceCss(): string {
  if (cache !== undefined) return cache ?? '';
  try {
    const fontsDir = path.join(process.cwd(), 'public', 'fonts');
    const regular = fs.readFileSync(path.join(fontsDir, 'Poppins-Regular.ttf')).toString('base64');
    const semibold = fs.readFileSync(path.join(fontsDir, 'Poppins-SemiBold.ttf')).toString('base64');
    cache = `
@font-face {
  font-family: 'Poppins';
  font-weight: 400;
  src: url('data:font/truetype;base64,${regular}') format('truetype');
}
@font-face {
  font-family: 'Poppins';
  font-weight: 600 700;
  src: url('data:font/truetype;base64,${semibold}') format('truetype');
}
`;
  } catch {
    cache = null;
  }
  return cache ?? '';
}

/**
 * Server-side (Node) counterpart to pdf-fonts.ts's ensureReportFont — returns the font
 * family for a queued PDF export to use, matching the direct client-side export. Report
 * PDFs now use jsPDF's built-in Times ('times'), which needs no TTF registration, so this
 * stays a same-signature function (rather than inlining the literal at every call site)
 * purely so the existing `ensureReportFontServer(doc)` call sites keep working unchanged.
 */
export function ensureReportFontServer(_doc: jsPDF): string {
  return 'times';
}
