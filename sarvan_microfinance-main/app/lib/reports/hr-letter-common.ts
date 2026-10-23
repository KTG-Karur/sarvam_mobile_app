import sharp from 'sharp';
import type { jsPDF } from 'jspdf';
import type { PdfHeaderDrawer } from '@/app/lib/reports/payslip-pdf';
import { getDocBrandPrimaryRgb } from '@/app/lib/reports/pdf-brand-color';
import { loadServerLogoForPdf } from '@/app/lib/reports/pdf-report-header-server';
import { getActiveBrandInfo, getActiveSignatoryBuffer } from '@/app/lib/brand-server';
import { hexToRgb } from '@/app/lib/color-scale';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';

interface LoadedSignatureImage {
    dataUrl: string;
    naturalWidth: number;
    naturalHeight: number;
}

// Deliberately NOT cached across calls (unlike loadServerLogoForPdf) — an
// admin-uploaded signature (see ConfirmationList.tsx's upload UI) must take
// effect on the very next letter generated, not require a server restart.
// Letter generation is a low-frequency, admin-driven action, so refetching
// per call costs nothing worth caching for.
async function loadSignatureImageForPdf(): Promise<LoadedSignatureImage | null> {
    try {
        const signatory = await getActiveSignatoryBuffer();
        if (!signatory) return null;
        const metadata = await sharp(signatory.buffer).metadata();
        const compressed = await compressImageBufferForPdf(signatory.buffer);
        if (!compressed || !metadata.width || !metadata.height) return null;
        return { dataUrl: compressed.dataUrl, naturalWidth: metadata.width, naturalHeight: metadata.height };
    } catch {
        return null;
    }
}

/**
 * Shared chrome for HR lifecycle letters (Confirmation, Promotion, Relieving) —
 * BESPOKE single-record documents with corporate letterhead, dual-tone Sarvam green
 * and yellow accents, two-column employee information card, refined typography,
 * balanced signature block, and subtle professional footer. Print-ready on A4.
 */
export interface HrLetterRecipient {
    employeeName: string;
    employeeCode: string;
    designation: string;
    department: string;
    branchName: string;
}

export interface HrLetterData {
    title: string;
    refNo: string;
    issueDate: string;
    recipient: HrLetterRecipient;
    bodyParagraphs: string[];
    /** Extra label/value rows shown in the info grid below the salutation (e.g. "Effective Date"). */
    extraFields?: [string, string][];
    signatureLabel: string;
}

export async function drawHrLetter(
    doc: jsPDF,
    data: HrLetterData,
    companyNameFull: string,
    reportFont: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _drawHeader?: PdfHeaderDrawer
): Promise<void> {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentW = pageW - margin * 2;

    const [logo, brandInfo, signature] = await Promise.all([
        loadServerLogoForPdf(),
        getActiveBrandInfo().catch(() => null),
        loadSignatureImageForPdf(),
    ]);

    const brandGreen: [number, number, number] = brandInfo?.primaryColor
        ? hexToRgb(brandInfo.primaryColor)
        : getDocBrandPrimaryRgb(doc);
    const brandDarkGreen: [number, number, number] = brandInfo?.primaryDark
        ? hexToRgb(brandInfo.primaryDark)
        : [2, 92, 39];

    // ── 1. Header & Corporate Letterhead ─────────────────────────────────
    let y = 14;

    if (logo) {
        const targetHeight = 13;
        const targetWidth = logo.naturalHeight > 0
            ? Math.min(targetHeight * (logo.naturalWidth / logo.naturalHeight), 48)
            : targetHeight * 2.89;
        doc.addImage(logo.dataUrl, logo.format, margin, y, targetWidth, targetHeight);
    } else {
        doc.setFont(reportFont, 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...brandDarkGreen);
        doc.text(companyNameFull, margin, y + 8);
    }

    // Right-aligned corporate department details
    doc.setFont(reportFont, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...brandDarkGreen);
    doc.text(companyNameFull.toUpperCase(), pageW - margin, y + 4, { align: 'right' });

    doc.setFont(reportFont, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Human Resources & Operations Department', pageW - margin, y + 8.5, { align: 'right' });
    doc.text('Corporate Office • Official Employment Communication', pageW - margin, y + 12, { align: 'right' });

    y = 31;

    // Single-color brand-green header rule.
    doc.setDrawColor(...brandGreen);
    doc.setLineWidth(0.8);
    doc.line(margin, y, pageW - margin, y);

    // ── 2. Document Title — tinted banner rather than plain text, so the
    // title reads as a deliberate design element instead of a bare heading. ──
    const titleBannerY = 35.5;
    const titleBannerH = 10;
    doc.setFillColor(...(brandInfo?.primaryTint ? hexToRgb(brandInfo.primaryTint) : ([230, 245, 236] as [number, number, number])));
    doc.roundedRect(margin, titleBannerY, contentW, titleBannerH, 1.8, 1.8, 'F');

    doc.setFont(reportFont, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...brandDarkGreen);
    doc.text(data.title.toUpperCase(), pageW / 2, titleBannerY + titleBannerH / 2 + 1.2, { align: 'center' });

    // ── 3. Ref No / Date Line ────────────────────────────────────────────
    y = titleBannerY + titleBannerH + 8;
    doc.setFontSize(8.5);

    // Ref No (left)
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Ref No:', margin, y);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(data.refNo, margin + 14, y);

    // Date (right)
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Date:', pageW - margin - 24, y);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(data.issueDate, pageW - margin, y, { align: 'right' });

    // ── 4. Employee Information Card (2-Column Balanced Grid) ────────────
    y += 8;

    doc.setFontSize(7);
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(...brandGreen);
    doc.text('EMPLOYEE INFORMATION', margin + 1, y);
    y += 3;

    const rawInfo: [string, string][] = [
        ['Employee Name', data.recipient.employeeName],
        ['Employee ID', data.recipient.employeeCode],
        ['Designation', data.recipient.designation],
        ['Department', data.recipient.department],
        ['Branch / Location', data.recipient.branchName],
        ...(data.extraFields ?? []),
    ];

    const half = Math.ceil(rawInfo.length / 2);
    const leftFields = rawInfo.slice(0, half);
    const rightFields = rawInfo.slice(half);

    const rowCount = Math.max(leftFields.length, rightFields.length);
    const rowHeight = 7.2;
    const cardHeight = 6 + rowCount * rowHeight;

    // Card background & subtle border — rounded corners for a softer, more
    // modern card treatment than a plain rectangle.
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentW, cardHeight, 1.6, 1.6, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(margin, y, contentW, cardHeight, 1.6, 1.6, 'S');

    // Columns positioning
    const col1X = margin + 8;
    const col2X = margin + 92;

    leftFields.forEach(([label, value], i) => {
        const rowY = y + 6.8 + i * rowHeight;
        doc.setFontSize(7.5);
        doc.setFont(reportFont, 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(label.toUpperCase(), col1X, rowY);

        doc.setFontSize(8.5);
        doc.setFont(reportFont, 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(String(value), col1X + 32, rowY);
    });

    rightFields.forEach(([label, value], i) => {
        const rowY = y + 6.8 + i * rowHeight;
        doc.setFontSize(7.5);
        doc.setFont(reportFont, 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(label.toUpperCase(), col2X, rowY);

        doc.setFontSize(8.5);
        doc.setFont(reportFont, 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(String(value), col2X + 36, rowY);
    });

    y += cardHeight + 9;

    // ── 5. Salutation & Subject ──────────────────────────────────────────
    doc.setFontSize(10);
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`Dear ${data.recipient.employeeName},`, margin, y);

    y += 6.5;
    const subjectText = `Subject: ${data.title} – ${data.recipient.employeeName} (${data.recipient.employeeCode})`;
    doc.setFontSize(9.5);
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(...brandDarkGreen);
    doc.text(subjectText, margin, y);

    const subjectW = Math.min(doc.getTextWidth(subjectText), contentW);
    doc.setDrawColor(...brandDarkGreen);
    doc.setLineWidth(0.2);
    doc.line(margin, y + 1.2, margin + subjectW, y + 1.2);

    y += 8.5;

    // ── 6. Body Paragraphs ───────────────────────────────────────────────
    doc.setFontSize(9.5);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(30, 41, 59);

    for (const paragraph of data.bodyParagraphs) {
        const lines = doc.splitTextToSize(paragraph, contentW);
        doc.text(lines, margin, y);
        y += lines.length * 6 + 5;
    }

    // ── 7. Closing & Signature Block ─────────────────────────────────────
    // Anchored to a minimum vertical position (roughly 60% down an A4 page)
    // rather than sitting immediately under a short letter's body text —
    // otherwise a brief, standard-wording letter like this one leaves most
    // of the page looking unfinished, empty white space below a tiny block
    // of text. Longer letters that already reach this point naturally are
    // unaffected (Math.max never pulls the block upward).
    y = Math.max(y + 5, pageH * 0.6);
    doc.setFontSize(9.5);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('Yours sincerely,', margin, y);

    y += 5.5;
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`For ${companyNameFull}`, margin, y);

    // Signature space (20mm) — the scanned authorised-signatory image sits
    // inside this gap, just above the rule, rather than leaving it blank for
    // a physical pen signature.
    if (signature) {
        const sigMaxWidth = 42;
        const sigMaxHeight = 14;
        const aspect = signature.naturalWidth / signature.naturalHeight;
        let sigW = sigMaxWidth;
        let sigH = sigW / aspect;
        if (sigH > sigMaxHeight) {
            sigH = sigMaxHeight;
            sigW = sigH * aspect;
        }
        doc.addImage(signature.dataUrl, 'JPEG', margin, y + (20 - sigH) - 2, sigW, sigH);
    }
    y += 20;

    // Signature rule
    doc.setDrawColor(...brandGreen);
    doc.setLineWidth(0.4);
    doc.line(margin, y, margin + 55, y);

    y += 4.5;
    doc.setFontSize(8.5);
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(data.signatureLabel, margin, y);

    y += 4;
    doc.setFontSize(7.5);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Human Resources & Operations', margin, y);

    // ── 8. Professional Corporate Footer ─────────────────────────────────
    const footerY = pageH - 12;

    // Subtle separator line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, footerY - 4, pageW - margin, footerY - 4);

    doc.setFontSize(6.5);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(148, 163, 184);

    doc.text('Confidential • Page 1 of 1', pageW - margin, footerY, { align: 'right' });
}

