import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/app/lib/prisma';
import { downloadObject } from '@/app/lib/storage/gcs-client';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';
import { getPoppinsFontFaceCss } from '@/app/lib/reports/pdf-fonts-server';
import {
    withAuth,
    handleCorsPreflight,
    errorResponse,
    successResponse,
} from '@/app/lib/api-utils';

// ─── Branding asset resolution (embedded, not fetched over HTTP) ──────────────
//
// Puppeteer used to load the logo/QR via <img src="{origin}/api/branding/asset/...">,
// which makes headless Chromium issue a real HTTP request back to this same server.
// On live that self-referencing request routinely fails (proxy/hairpin NAT can't
// route a container back to its own public URL), so the image silently errors out
// and the PDF shows a broken-image icon. Reading the bytes directly in-process and
// embedding them as a base64 data URI removes that network round-trip entirely.
const LOCAL_FALLBACK_ASSET: Record<string, string> = {
    'tamil-logo': 'tamil_sarvam.png',
};

async function resolveAssetDataUri(kind: 'tamil-logo' | 'payment-qr', key: string | null | undefined): Promise<string | null> {
    const object = key ? await downloadObject(key) : null;
    let buffer: Buffer;
    let contentType: string;
    if (object) {
        buffer = object.buffer;
        contentType = object.contentType;
    } else {
        const fallbackName = LOCAL_FALLBACK_ASSET[kind];
        if (!fallbackName) return null;
        try {
            buffer = fs.readFileSync(path.join(process.cwd(), 'public', fallbackName));
            contentType = 'image/png';
        } catch {
            return null;
        }
    }

    // Only the logo gets recompressed — it's the same "raw wordmark PNG" bloat
    // pattern as the branding logo bug elsewhere. The payment QR is left as-is:
    // it's a real payment destination, and lossy JPEG re-encoding risks
    // introducing artifacts that break scan reliability.
    if (kind === 'tamil-logo') {
        const compressed = await compressImageBufferForPdf(buffer);
        if (compressed) return compressed.dataUrl;
    }
    return `data:${contentType};base64,${buffer.toString('base64')}`;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const InstallmentSchema = z.object({
    no: z.number(),
    date: z.string(),
    principal: z.number(),
    interest: z.number(),
    balance: z.number(),
});

const MemberDetailsSchema = z.object({
    loanAmount: z.string(),
    // Ignored: the number comes from the active theme (Brand settings), see POST
    upiNumber: z.string().optional().default(''),
    accountNumber: z.string(),
    branchCode: z.string(),
    branchName: z.string(),
    memberName: z.string(),
    disbursementDate: z.string(),
    loanPurpose: z.string(),
    centerCode: z.string(),
    centerName: z.string(),
    centerMemberNo: z.string(),
    husbandName: z.string(),
    loanType: z.string(),
    firstInstallmentDate: z.string(),
    memberPhone: z.string(),
    clientPhotoUrl: z.string().nullable().optional(),
});

const PassbookSchema = z.object({
    memberDetails: MemberDetailsSchema,
    installments: z.array(InstallmentSchema).min(1).max(120),
});

type MemberDetails = z.infer<typeof MemberDetailsSchema>;
type Installment = z.infer<typeof InstallmentSchema>;

// ─── Embedded font CSS (loaded once from public/fonts/) ───────────────────────

function buildFontCSS(): string {
    const fontsDir = path.join(process.cwd(), 'public', 'fonts');
    const regular = fs.readFileSync(path.join(fontsDir, 'NotoSansTamil-Regular.ttf')).toString('base64');
    const bold    = fs.readFileSync(path.join(fontsDir, 'NotoSansTamil-Bold.ttf')).toString('base64');
    return `
${getPoppinsFontFaceCss()}
@font-face {
  font-family: 'NotoTamil';
  font-weight: 400;
  src: url('data:font/truetype;base64,${regular}') format('truetype');
}
@font-face {
  font-family: 'NotoTamil';
  font-weight: 700;
  src: url('data:font/truetype;base64,${bold}') format('truetype');
}
* { margin:0; padding:0; box-sizing:border-box; font-family:'Poppins','NotoTamil',sans-serif; }
body { margin:0; padding:0; background:white; }
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(val: string | number): string {
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmt(n: number): string {
    return Number(n).toLocaleString('en-IN');
}

// ─── PAGE 1 — Portrait 794×1123, content rotated 90° CCW ────────────────────

function buildPage1HTML(m: MemberDetails, fontCSS: string, logoDataUri: string | null, qrDataUri: string | null): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${fontCSS}

  .rotated-page {
    position: absolute;
    top: 0; left: 0;
    width: 794px;
    height: 1123px;
    overflow: hidden;
  }

  .inner {
    position: absolute;
    width: 973px;
    height: 644px;
    transform: rotate(-90deg);
    transform-origin: 0 0;
    top: 1048px;
    left: 75px;
    font-size: 13px;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    padding: 0;
    gap: 60px;
  }

  /* ── LEFT BOX ─────────────────────────── */
  .left-box {
    flex: 1;
    border: 1px solid #000;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
  }

  .oath-title-wrap { text-align: center; margin-bottom: 4px; }
  .oath-title {
    display: inline-block;
    border: 1px solid #000;
    padding: 2px 16px;
    font-size: 13px;
  }

  .oath-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; flex: 1; justify-content: space-evenly; }
  .oath-list li { font-size: 13px; line-height: 1.35; }

  .oath-divider { border-top: 1px solid #000; margin: 6px 0; }

  .contact-block { text-align: center; }
  .c-top-row { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 4px; }
  .c-qr-wrap { flex-shrink: 0; text-align: center; }
  .c-qr      { width: 100px; height: 100px; object-fit: contain; border: 1px solid #000; padding: 3px; background: #fff; }
  .c-qr-caption { font-size: 10.4px; line-height: 1.25; margin-top: 3px; max-width: 110px; }
  .c-info    { text-align: left; }
  .contact-block .c-label  { font-size: 13px; margin-bottom: 1px; }
  .contact-block .c-hq     { font-size: 15.6px; font-weight: bold; text-decoration: underline; margin-bottom: 0; }
  .contact-block .c-addr   { font-size: 13px; line-height: 1.2; }
  .contact-block .c-gpay   { font-size: 16.9px; font-weight: bold; margin: 4px 0; }
  .contact-block .c-rule   { font-size: 12.35px; text-align: left; margin-top: 1px; line-height: 1.2; }

  /* ── RIGHT BOX ────────────────────────── */
  .right-box {
    flex: 1;
    border: 1px solid #000;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .header-block { text-align: center; }
  .header-top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 6px;
    border-bottom: 1.5px solid #000;
    margin-bottom: 6px;
  }
  .header-logo { width: 88px; height: 88px; object-fit: contain; flex-shrink: 0; }

  .header-titles {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .header-block .sub2 {
    font-size: 20px;
    font-weight: bold;
    letter-spacing: 0.3px;
  }

  .header-photo-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
    min-width: 52px;
    border-left: 0px solid #000;
    padding-left: 12px;
  }
  .header-photo {
    width: 44px;
    height: 52px;
    border: 1px solid #000;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
  }
  .header-photo img { width: 100%; height: 100%; object-fit: cover; }
  .header-tag { font-size: 9.1px; font-weight: 600; white-space: nowrap; line-height: 1; }

  .loan-row { display: flex; border: 1px solid #000; margin-bottom: 5px; }
  .loan-row .cell { padding: 3px 6px; font-size: 13px; }
  .loan-row .cell:first-child { width: 52%; border-right: 1px solid #000; }

  .acc-row { font-size: 13px; margin-bottom: 5px; }

  .field-row { display: flex; align-items: flex-end; margin-bottom: 4px; font-size: 13px; }
  .field-label { width: 48%; flex-shrink: 0; font-size: 13px; }
  .field-value { flex: 1; border-bottom: 1px dashed #555; padding-bottom: 1px; font-size: 13px; min-height: 14px; }

  .sig-row { display: flex; justify-content: space-around; margin-top: 20px; }
  .sig-cell { text-align: center; font-size: 11.7px; }
  .sig-line { border-top: 1px solid #000; width: 100px; margin: 0 auto 3px; }
</style>
</head>
<body>
<div class="rotated-page">
  <div class="inner">

    <!-- LEFT BOX: Oath + Contact -->
    <div class="left-box">
      <div class="oath-title-wrap">
        <span class="oath-title">உறுப்பினர் உறுதிமொழி</span>
      </div>
      <ol class="oath-list">
        <li>1. சர்வம் <strong>எங்கள்</strong> நிறுவனம்</li>
        <li>2. வாரம் ஒருமுறை தவறாமல் மையக் கூட்டத்தில் கலந்து கொள்வோம்</li>
        <li>3. <strong>எங்களில்</strong> ஒருவர் கடனைக் கட்ட முடியவில்லையென்றால் உறுப்பினர்கள் நாங்கள் அனைவரும் ஒன்று சேர்ந்து அந்த கடனை அன்றேகட்டுவோம்.</li>
        <li>4. நாங்கள் வாங்கிய கடனை நாங்களே பயன்படுத்துவோம்</li>
        <li>5. நாங்கள் வாங்கிய கடனை குழுவில் உள்ளவர்களுக்கோ அல்லது வேறு யாருக்கும் கொடுத்தால் அதற்கு நிர்வாகம் பொறுப்பல்ல</li>
        <li>6. <strong>எனது</strong> தனிப்பட்ட வரவு செலவுகளையோ / வேறு குழுவின் பிரச்சனைகளையே இந்தக் குழுவில் சேர்க்கமாட்டோம்</li>
        <li>7. நேர்மையாகவும், நாணயமாகவும் பெண்களின் வளர்ச்சிக்கும் நாட்டின் வளர்ச்சிக்கும் ஒற்றுமையுடன் பாடுபடுவேன்</li>
      </ol>
      <div class="oath-divider"></div>
      <div class="contact-block">
        <div class="c-top-row">
          ${qrDataUri ? `<div class="c-qr-wrap">
            <img class="c-qr" src="${qrDataUri}" alt="Payment QR" />
            <div class="c-qr-caption">இந்த QR Code-ஐ ஸ்கேன் செய்து பணம் செலுத்தவும்.<br>நன்றி!</div>
          </div>` : ''}
          <div class="c-info">
            <div class="c-label">தொடர்புக்கு</div>
            <div class="c-hq">தலைமை அலுவலகம்</div>
            <div class="c-addr">ஓட்டன்சத்திரம் - 624 619</div>
            <div class="c-addr">போன் 04553 - 243227</div>
          </div>
        </div>
        ${m.upiNumber ? `<div class="c-gpay">G-Pay, Phone Pe Number - ${esc(m.upiNumber)}</div>` : ''}
        <div class="c-rule">1. நிறுவனத்தின் QR Code, G-Pay, Phone Pe க்கு மட்டுமே பணம் செலுத்தவேண்டும்.</div>
        <div class="c-rule">2. பணியாளர்களின் தனிநபர் G-Pay, Phone Pe மூலம் பணம் செலுத்தினால் அதற்கு நிறுவனம் பொறுப்பல்ல.</div>
      </div>
    </div>

    <!-- RIGHT BOX: Member Details -->
    <div class="right-box">
      <div class="header-block">
        <div class="header-top">
          ${logoDataUri ? `<img class="header-logo" src="${logoDataUri}" alt="Sarvam Logo" />` : ''}
          <div class="header-titles">
            <div class="sub2">கடன் பாஸ் புத்தகம்</div>
          </div>
          <div class="header-photo-wrap">
            <div class="header-photo">
              ${m.clientPhotoUrl ? `<img src="${esc(m.clientPhotoUrl)}" alt="Client Photo" />` : ''}
            </div>
            <div class="header-tag">உறுப்பினர்</div>
          </div>
        </div>
      </div>

      <div class="loan-row">
        <div class="cell">கடன் தொகை Rs. ${esc(m.loanAmount)}-/</div>
        ${m.upiNumber ? `<div class="cell">UPI Mobile Number: ${esc(m.upiNumber)}</div>` : ''}
      </div>

      <div class="acc-row">அ . எண்: ${esc(m.accountNumber)}</div>

      <div class="field-row">
        <div class="field-label">கிளை :</div>
        <div class="field-value">${esc(m.branchCode)} - ${esc(m.branchName)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">உறுப்பினர் பெயர் :</div>
        <div class="field-value">${esc(m.memberName)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">கணவர் பெயர் :</div>
        <div class="field-value">${esc(m.husbandName)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">கடன் வழங்கப்பட்ட தேதி :</div>
        <div class="field-value">${esc(m.disbursementDate)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">கடன் பெறும் நோக்கம் :</div>
        <div class="field-value">${esc(m.loanPurpose)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">மையப் பெயர் :</div>
        <div class="field-value">${esc(m.centerCode)} - ${esc(m.centerName)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">மையம் / உறுப்பினர் எண் :</div>
        <div class="field-value">${esc(m.centerMemberNo)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">கடன் முறை :</div>
        <div class="field-value">${esc(m.loanType)}</div>
      </div>
      <div class="field-row">
        <div class="field-label">முதல் தவணை தேதி :</div>
        <div class="field-value">${esc(m.firstInstallmentDate)}</div>
      </div>
      <div class="field-row">
        <div class="field-label" style="width:62%; white-space:nowrap;">உறுப்பினர் தொலைபேசி எண் :</div>
        <div class="field-value">${esc(m.memberPhone)}</div>
      </div>

      <div class="sig-row">
        <div class="sig-cell">
          <div class="sig-line"></div>
          உறுப்பினர் கையொப்பம்
        </div>
        <div class="sig-cell">
          <div class="sig-line" style="width:130px"></div>
          களவளர்ச்சி அலுவலக கையொப்பம்
        </div>
        <div class="sig-cell">
          <div class="sig-line"></div>
          கிளை மேலாளர் கையொப்பம்
        </div>
      </div>
    </div>

  </div>
</div>
</body>
</html>`;
}

// ─── PAGE 2 — Portrait 794×1123, content rotated 90° CCW ────────────────────

/** Rows per column on a single page-2 sheet — the fixed-size rotated layout
 * only has room for this many rows (plus its header and footer/signature
 * block) before they'd overflow the page's overflow:hidden bounds and get
 * silently clipped. Measured empirically against the actual embedded Tamil
 * font (NotoSansTamil), which renders noticeably taller than generic
 * sans-serif — the table's `width`-attribute column hints are only advisory
 * under the default `table-layout:auto`, so real Tamil glyph metrics (not
 * the CSS hints) determine actual row/header height. 30 rows left only ~4px
 * of margin before the signature footer hit
 * the hard page edge; 26 avoided clipping but the footer sat almost flush
 * against the last row (~9px gap) — technically not clipped, but no usable
 * blank space for an actual pen signature. 23 (paired with the larger footer
 * padding-top below) leaves a real ~40-55px blank band before the signature
 * line, confirmed by rendering the actual HTML/CSS/font through Puppeteer.
 * Raised to 33 (66 dues/sheet) by tightening row/header font-size and
 * line-height so the full rows + signature band still fit the 644px height.
 * Callers must chunk `installments` into groups of ROWS_PER_PAGE * 2 (one
 * page per group) rather than passing the full list, or trailing
 * installments beyond the first page's capacity vanish instead of flowing
 * onto another sheet. */
export const PASSBOOK_ROWS_PER_COLUMN = 33;
export const PASSBOOK_ROWS_PER_PAGE = PASSBOOK_ROWS_PER_COLUMN * 2;

function buildPage2HTML(firstHalf: Installment[], secondHalf: Installment[], fontCSS: string): string {
    const tableHeaders = () => `
      <thead>
        <tr>
          <th rowspan="2" style="border:1px solid #000;padding:4px 3px;font-size:10px;line-height:1.55;text-align:center;white-space:nowrap;width:36px">தவணை</th>
          <th rowspan="2" style="border:1px solid #000;padding:4px 4px;font-size:10px;line-height:1.55;text-align:center;width:78px">பணம் செலுத்திய<br>தேதி</th>
          <th colspan="2" style="border:1px solid #000;padding:4px 3px;font-size:10px;line-height:1.55;text-align:center">தொகை செலுத்தியது</th>
          <th rowspan="2" style="border:1px solid #000;padding:4px 3px;font-size:10px;line-height:1.55;text-align:center;width:62px">கடன் நிலுவை<br>தொகை<br>ரூபாய்</th>
          <th rowspan="2" style="border:1px solid #000;padding:4px 3px;font-size:10px;line-height:1.55;text-align:center">கையொப்பம்<br>FOO/<br>BM</th>
        </tr>
        <tr>
          <th style="border:1px solid #000;padding:4px 3px;font-size:10px;line-height:1.55;text-align:center;width:42px">அசல்</th>
          <th style="border:1px solid #000;padding:4px 3px;font-size:10px;line-height:1.55;text-align:center;width:42px">வட்டி</th>
        </tr>
      </thead>`;

    const tableRows = (rows: Installment[]) => rows.map(r => `
      <tr style="height:15px">
        <td style="border:1px solid #000;padding:0 2px;font-size:11px;line-height:1.3;text-align:center">${esc(r.no)}</td>
        <td style="border:1px solid #000;padding:0 3px;font-size:11px;line-height:1.3;text-align:left">${esc(r.date)}</td>
        <td style="border:1px solid #000;padding:0 2px;font-size:11px;line-height:1.3;text-align:center">${esc(r.principal)}</td>
        <td style="border:1px solid #000;padding:0 2px;font-size:11px;line-height:1.3;text-align:center">${esc(r.interest)}</td>
        <td style="border:1px solid #000;padding:0 4px;font-size:11px;line-height:1.3;text-align:right">${esc(fmt(r.balance))}</td>
        <td style="border:1px solid #000;padding:0 2px"></td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${fontCSS}

  .rotated-page {
    position: absolute;
    top: 0; left: 0;
    width: 794px;
    height: 1123px;
    overflow: hidden;
  }

  .inner {
    position: absolute;
    width: 973px;
    height: 644px;
    transform: rotate(-90deg);
    transform-origin: 0 0;
    top: 1048px;
    left: 75px;
    font-size: 11.7px;
    padding: 0;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 60px;
  }

  table { border-collapse: collapse; }
</style>
</head>
<body>
<div class="rotated-page">
  <div class="inner">

    <!-- LEFT TABLE: rows 1–30 + footer -->
    <div style="flex:1; display:flex; flex-direction:column;">
      <table style="width:100%">
        ${tableHeaders()}
        <tbody>${tableRows(firstHalf)}</tbody>
      </table>

      <div style="margin-top:auto; padding-top:24px;">
        <div style="display:flex; gap:50px">
        
           <div style="font-size:13px">
          கடன் தொகை முழுவதையும் செலுத்தி முடித்த நாள் :
        </div>
        </div>
      </div>
    </div>

    <!-- RIGHT SECTION: rows 31+ -->
    <div style="flex:1; display:flex; flex-direction:column">
      <table style="width:100%">
        ${tableHeaders()}
        <tbody>${tableRows(secondHalf)}</tbody>
      </table>

      <div style="margin-top:auto; padding-top:36px;">
        <div style="display:flex; gap:50px">
          <div style="font-size:11.7px; text-align:center">
            <div style="border-top:1px solid #000; width:130px; margin-bottom:3px"></div>
            க வ அலுவலர் கையொப்பம்
          </div>
           <div style="font-size:11.7px; text-align:center">
            <div style="border-top:1px solid #000; width:130px; margin-bottom:3px"></div>
            உறுப்பினர் கையொப்பம்
          </div>
        </div>

      </div>
    </div>

  </div>
</div>
</body>
</html>`;
}

// ─── Puppeteer render helper (matches reference implementation) ───────────────

async function renderPDF(
    browser: Awaited<ReturnType<typeof puppeteer.launch>>,
    html: string
): Promise<Buffer> {
    const pg = await browser.newPage();
    try {
        await pg.setViewport({ width: 794, height: 1123 });
        await pg.setContent(html, { waitUntil: 'load', timeout: 60000 });
        // On the live server the logo/QR <img> tags fetch over the real network
        // (through the load balancer/TLS) instead of localhost, so a flat 500ms
        // wait isn't reliably enough — wait for every image to actually finish
        // (or error) plus web fonts, same as the reference implementation in
        // app/api/reports/client/application-form/download/route.ts.
        await pg.evaluate(async () => {
            const images = Array.from(document.images);
            await Promise.all(
                images.map((img) =>
                    img.complete
                        ? Promise.resolve()
                        : new Promise((resolve) => {
                              img.addEventListener('load', resolve, { once: true });
                              img.addEventListener('error', resolve, { once: true });
                          })
                )
            );
            await document.fonts.ready;
        });
        const buf = await pg.pdf({
            width: '794px',
            height: '1123px',
            printBackground: true,
            margin: { top: '0', bottom: '0', left: '0', right: '0' },
        });
        return Buffer.from(buf);
    } finally {
        await pg.close();
    }
}

/** On-screen preview for the passbook dialog: the same page HTML (page 1 or a
 * page-2 sheet), but with the 90° print rotation undone so the 973×644
 * landscape content renders upright, inside a 24px white margin (so the table
 * borders do not sit on the image edge), screenshotted at 2x for a sharp image. */
async function renderPreviewPNG(
    browser: Awaited<ReturnType<typeof puppeteer.launch>>,
    html: string
): Promise<Buffer> {
    const unrotate = `<style>
  .rotated-page { width: 1021px !important; height: 692px !important; background: #fff; }
  .inner { transform: none !important; top: 24px !important; left: 24px !important; }
</style></head>`;
    const pg = await browser.newPage();
    try {
        await pg.setViewport({ width: 1021, height: 692, deviceScaleFactor: 2 });
        await pg.setContent(html.replace('</head>', unrotate), { waitUntil: 'load', timeout: 60000 });
        await pg.evaluate(async () => {
            const images = Array.from(document.images);
            await Promise.all(
                images.map((img) =>
                    img.complete
                        ? Promise.resolve()
                        : new Promise((resolve) => {
                              img.addEventListener('load', resolve, { once: true });
                              img.addEventListener('error', resolve, { once: true });
                          })
                )
            );
            await document.fonts.ready;
        });
        const buf = await pg.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1021, height: 692 } });
        return Buffer.from(buf);
    } finally {
        await pg.close();
    }
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        let browser;
        try {
            const body = await req.json();
            const { memberDetails, installments } = PassbookSchema.parse(body);

            const fontCSS = buildFontCSS();
            // Both resolve to the currently ACTIVE theme's own uploaded assets (see
            // /api/branding/asset/[...type]); the passbook is a Tamil-language document
            // so it uses the dedicated Tamil-logo slot, not the general wordmark logo.
            // Embedded as base64 data URIs (see resolveAssetDataUri above) instead of
            // HTTP URLs so headless Chromium never has to call back into this server.
            const activeTheme = await prisma.themePreset.findFirst({
                where: { isActive: true },
                select: { tamilLogoKey: true, paymentQrKey: true, paymentUpiNumber: true },
            });
            // Like the QR, the G-Pay / PhonePe number is a money destination owned by
            // the active theme — never trust the caller's value; blank omits the line.
            const m: MemberDetails = { ...memberDetails, upiNumber: activeTheme?.paymentUpiNumber?.trim() || '' };

            // The payment QR is a real money destination, not just branding — only
            // resolve one if the active theme actually has it uploaded, otherwise the
            // QR block is omitted entirely rather than risk showing another theme's QR.
            const [logoDataUri, qrDataUri] = await Promise.all([
                resolveAssetDataUri('tamil-logo', activeTheme?.tamilLogoKey),
                activeTheme?.paymentQrKey ? resolveAssetDataUri('payment-qr', activeTheme.paymentQrKey) : Promise.resolve(null),
            ]);

            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
            });

            // Chunk installments across as many page-2 sheets as needed — a single
            // sheet only holds PASSBOOK_ROWS_PER_PAGE rows before the fixed-size
            // rotated layout clips the overflow instead of flowing it onto a new
            // page (this previously dropped trailing installments silently).
            const page2Chunks: Installment[][] = [];
            for (let i = 0; i < installments.length; i += PASSBOOK_ROWS_PER_PAGE) {
                page2Chunks.push(installments.slice(i, i + PASSBOOK_ROWS_PER_PAGE));
            }
            if (page2Chunks.length === 0) page2Chunks.push([]);

            const page2HTMLs = page2Chunks.map((chunk) =>
                buildPage2HTML(
                    chunk.slice(0, PASSBOOK_ROWS_PER_COLUMN),
                    chunk.slice(PASSBOOK_ROWS_PER_COLUMN),
                    fontCSS
                )
            );

            // ?preview=pages → every sheet as an upright landscape PNG (data URI)
            // for the dialog's scrollable on-screen preview, instead of the PDF.
            if (req.nextUrl.searchParams.get('preview') === 'pages') {
                const pngs = await Promise.all(
                    [buildPage1HTML(m, fontCSS, logoDataUri, qrDataUri), ...page2HTMLs].map((html) =>
                        renderPreviewPNG(browser!, html)
                    )
                );
                await browser.close();
                browser = undefined;
                return successResponse({
                    pages: pngs.map((png) => `data:image/png;base64,${png.toString('base64')}`),
                });
            }

            const [pdf1, ...page2Buffers] = await Promise.all([
                renderPDF(browser, buildPage1HTML(m, fontCSS, logoDataUri, qrDataUri)),
                ...page2HTMLs.map((html) => renderPDF(browser!, html)),
            ]);

            await browser.close();
            browser = undefined;

            const doc1 = await PDFDocument.load(pdf1);
            const merged = await PDFDocument.create();
            const [p1] = await merged.copyPages(doc1, [0]);
            merged.addPage(p1);
            for (const pdf2 of page2Buffers) {
                const doc2 = await PDFDocument.load(pdf2);
                const [p2] = await merged.copyPages(doc2, [0]);
                merged.addPage(p2);
            }
            const finalBuffer = Buffer.from(await merged.save());

            const safeName = m.memberName.replace(/[^a-zA-Z0-9_\-]/g, '_');

            return new NextResponse(finalBuffer, {
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="passbook_${safeName}.pdf"`,
                    'Cache-Control': 'no-store',
                },
            });

        } catch (error: any) {
            if (browser) {
                await browser.close().catch(() => {});
            }
            if (error instanceof z.ZodError) {
                return errorResponse(error.errors[0].message, 400);
            }
            console.error('Passbook PDF generation error:', error);
            return errorResponse(error.message || 'Failed to generate passbook PDF', 500);
        }
    })(request);
}
