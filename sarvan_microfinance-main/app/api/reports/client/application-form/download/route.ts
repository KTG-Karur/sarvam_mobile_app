import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { withAuth, errorResponse } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { assertFdoOwnsCenter } from '@/app/lib/filters/fdo-center-scope';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import {
  applicationFormClientSelect,
  mapClientToApplicationFormRecord,
  resolveApplicationFormKycUrlsForPdf,
} from '@/app/lib/reports/application-form-data';
import { buildApplicationFormHTML } from '@/app/lib/reports/application-form-template';
import { getActiveLogoBuffer } from '@/app/lib/brand-server';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';
import { getPoppinsFontFaceCss } from '@/app/lib/reports/pdf-fonts-server';

/**
 * Embeds the bundled Noto Sans Tamil font as base64 @font-face rules so the
 * PDF renders correct Tamil glyphs on headless Chromium even when the host
 * OS (production) has no Tamil font installed — deploy hosts render tofu
 * boxes otherwise, while a developer's own Windows machine happens to have
 * a Tamil-capable font (Latha) and never shows the bug.
 */
function buildTamilFontFaceCSS(): string {
  const fontsDir = path.join(process.cwd(), 'public', 'fonts');
  const regular = fs.readFileSync(path.join(fontsDir, 'NotoSansTamil-Regular.ttf')).toString('base64');
  const bold = fs.readFileSync(path.join(fontsDir, 'NotoSansTamil-Bold.ttf')).toString('base64');
  return `
    @font-face {
      font-family: 'Noto Sans Tamil';
      font-weight: 400;
      src: url('data:font/truetype;base64,${regular}') format('truetype');
    }
    @font-face {
      font-family: 'Noto Sans Tamil';
      font-weight: 700;
      src: url('data:font/truetype;base64,${bold}') format('truetype');
    }
  `;
}

/** Resolves the active trust logo as a small compressed data URI, or undefined if unavailable — never throws. */
async function resolveLogoDataUri(): Promise<string | undefined> {
  try {
    const logo = await getActiveLogoBuffer();
    if (!logo) return undefined;
    const compressed = await compressImageBufferForPdf(logo.buffer);
    return compressed?.dataUrl;
  } catch {
    return undefined;
  }
}

/**
 * Direct PDF download for one or more client application forms — renders
 * the same Tamil application-form template used by the on-screen preview
 * through headless Chromium so the downloaded file matches the preview
 * exactly.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        let browser;
        try {
            const { searchParams } = new URL(req.url);
            const idsStr = searchParams.get('ids');

            if (!idsStr) {
                return errorResponse('Client IDs are required', 400);
            }

            const ids = idsStr.split(',');

            const clients = await prisma.client.findMany({
                where: { id: { in: ids } },
                select: applicationFormClientSelect,
            });

            if (!clients || clients.length === 0) {
                return errorResponse('No clients found for these IDs', 404);
            }

            // Enforce role-based center access — no client's data may be returned
            // unless its center is within the requesting user's allowed scope.
            if (user.role === 'AREA_MANAGER') {
                const assignedBranchIds = new Set(await getAreaManagerBranchIds(user.userId));
                const unauthorized = clients.some(
                    (client) => !client.center || !assignedBranchIds.has(client.center.branchId)
                );
                if (unauthorized) {
                    return errorResponse('Access denied to one or more requested clients', 403);
                }
            } else if (user.role !== 'ADMIN') {
                let userBranchId: string | null | undefined = user.branchId;
                if (user.role === 'BRANCH_MANAGER') {
                    const userRecord = await prisma.user.findUnique({
                        where: { id: user.userId },
                        select: { branchId: true },
                    });
                    userBranchId = userRecord?.branchId;
                }

                // HO-aware: an HO-based non-ADMIN role (e.g. a dynamic-RBAC "Zonal
                // Head"/"Division Manager") is unrestricted here too, rather than
                // being pinned to the empty HO branch.
                const permittedBranchIds = await getPermittedBranchIds({ ...user, branchId: userBranchId ?? undefined });

                const unauthorized = clients.some((client) => {
                    if (!client.center) return true;
                    if (user.role === 'FDO') {
                        return !assertFdoOwnsCenter(user, client.center);
                    }
                    if (permittedBranchIds === null) return false;
                    return !permittedBranchIds.includes(client.center.branchId);
                });

                if (unauthorized) {
                    return errorResponse('Access denied to one or more requested clients', 403);
                }
            }

            // PDF-specific resolver: fetches each KYC document server-side and embeds
            // a downscaled/recompressed JPEG data: URI instead of a signed storage
            // URL — the storage bucket has no CORS policy, so an in-page canvas
            // recompression step (as a signed-URL <img> loads) isn't possible, and
            // uploaded source photos are often several MB each at full camera
            // resolution. See resolveApplicationFormKycUrlsForPdf's own doc comment.
            const records = await resolveApplicationFormKycUrlsForPdf(
                clients.map(mapClientToApplicationFormRecord)
            );
            const html = buildApplicationFormHTML(records, {
                assetBaseUrl: new URL(req.url).origin,
                fontFaceCSS: buildTamilFontFaceCSS() + getPoppinsFontFaceCss(),
                logoDataUri: await resolveLogoDataUri(),
            });

            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
            await page.evaluate(async () => {
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

            const pdfBuffer = await page.pdf({
                printBackground: true,
                preferCSSPageSize: true,
            });

            await browser.close();
            browser = undefined;

            const safeName =
                records.length === 1
                    ? `Application_${records[0].clientName.replace(/[^a-zA-Z0-9_\-]/g, '_')}`
                    : `Applications_Batch_${Date.now()}`;

            return new NextResponse(Buffer.from(pdfBuffer), {
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
                    'Cache-Control': 'no-store',
                },
            });

        } catch (error) {
            if (browser) {
                await browser.close().catch(() => {});
            }
            console.error('[PDF Download API] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to generate PDF';
            return errorResponse(message, 500);
        }
    })(request);
}
