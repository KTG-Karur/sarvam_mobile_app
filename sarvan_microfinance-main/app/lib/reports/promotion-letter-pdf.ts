import { jsPDF } from 'jspdf';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { drawPdfReportHeaderServer } from '@/app/lib/reports/pdf-report-header-server';
import { ensureReportFontServer } from '@/app/lib/reports/pdf-fonts-server';
import { drawHrLetter, type HrLetterRecipient } from '@/app/lib/reports/hr-letter-common';

export interface PromotionLetterData {
    /** Recipient's designation here is the PRE-promotion designation, shown in the info grid for context. */
    recipient: HrLetterRecipient;
    refNo: string;
    issueDate: string;
    toDesignationName: string;
    effectiveDate: string;
}

/**
 * Promotion Letter — generated on Promotion approval. Distinct template from
 * the Confirmation Letter (confirmation-letter-pdf.ts) per spec §12's explicit
 * callout that the two must not be conflated.
 */
export async function buildPromotionLetterPdf(data: PromotionLetterData): Promise<Buffer> {
    const { companyNameFull } = await getActiveBrandNames();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const reportFont = ensureReportFontServer(doc);

    await drawHrLetter(
        doc,
        {
            title: 'Promotion Letter',
            refNo: data.refNo,
            issueDate: data.issueDate,
            recipient: data.recipient,
            extraFields: [
                ['New Designation', data.toDesignationName],
                ['Effective Date', data.effectiveDate],
            ],
            bodyParagraphs: [
                `We are pleased to inform you that, in recognition of your performance and contribution, you have been promoted to the position of ${data.toDesignationName} with effect from ${data.effectiveDate}.`,
                'All other terms and conditions of your employment remain unchanged unless communicated separately. We congratulate you on this achievement and look forward to your continued contribution to the organization.',
            ],
            signatureLabel: 'Authorized Signatory',
        },
        companyNameFull,
        reportFont,
        drawPdfReportHeaderServer
    );

    return Buffer.from(doc.output('arraybuffer'));
}
