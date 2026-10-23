import { jsPDF } from 'jspdf';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { drawPdfReportHeaderServer } from '@/app/lib/reports/pdf-report-header-server';
import { ensureReportFontServer } from '@/app/lib/reports/pdf-fonts-server';
import { drawHrLetter, type HrLetterRecipient } from '@/app/lib/reports/hr-letter-common';

export interface ConfirmationLetterData {
    recipient: HrLetterRecipient;
    refNo: string;
    issueDate: string;
    confirmationDate: string;
}

/**
 * Confirmation Letter — generated on Confirmation approval. Distinct template
 * from the Promotion Letter (promotion-letter-pdf.ts) per spec §12's explicit
 * callout that the two must not be conflated.
 */
export async function buildConfirmationLetterPdf(data: ConfirmationLetterData): Promise<Buffer> {
    const { companyNameFull } = await getActiveBrandNames();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const reportFont = ensureReportFontServer(doc);

    await drawHrLetter(
        doc,
        {
            title: 'Confirmation Letter',
            refNo: data.refNo,
            issueDate: data.issueDate,
            recipient: data.recipient,
            extraFields: [['Confirmation Date', data.confirmationDate]],
            bodyParagraphs: [
                `We are pleased to inform you that, following a satisfactory review of your performance during the probation period, your employment with ${companyNameFull} has been confirmed with effect from ${data.confirmationDate}.`,
                'All other terms and conditions of your employment remain unchanged. We look forward to your continued contribution to the organization.',
            ],
            signatureLabel: 'Authorized Signatory',
        },
        companyNameFull,
        reportFont,
        drawPdfReportHeaderServer
    );

    return Buffer.from(doc.output('arraybuffer'));
}
