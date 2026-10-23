import { jsPDF } from 'jspdf';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { drawPdfReportHeaderServer } from '@/app/lib/reports/pdf-report-header-server';
import { ensureReportFontServer } from '@/app/lib/reports/pdf-fonts-server';
import { drawHrLetter, type HrLetterRecipient } from '@/app/lib/reports/hr-letter-common';

export interface TransferLetterData {
    recipient: HrLetterRecipient;
    refNo: string;
    issueDate: string;
    transferType: string;
    effectiveDate: string;
    fromLocation: string;
    toLocation: string;
    reason?: string | null;
}

/**
 * Transfer Letter — generated on Transfer approval. Distinct template
 * consistent with Confirmation and Promotion letters per corporate letterhead standard.
 */
export async function buildTransferLetterPdf(data: TransferLetterData): Promise<Buffer> {
    const { companyNameFull } = await getActiveBrandNames();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const reportFont = ensureReportFontServer(doc);

    await drawHrLetter(
        doc,
        {
            title: 'Transfer Order',
            refNo: data.refNo,
            issueDate: data.issueDate,
            recipient: data.recipient,
            extraFields: [
                ['Transfer Type', data.transferType],
                ['Current Posting', data.fromLocation],
                ['New Posting', data.toLocation],
                ['Effective Date', data.effectiveDate],
            ],
            bodyParagraphs: [
                `This is to formally communicate that management has approved your transfer from ${data.fromLocation} to ${data.toLocation} with effect from ${data.effectiveDate}.`,
                'You are requested to report to the Manager at your new location on the effective date. Please ensure that all pending duties, client records, and company assets in your current assignment are properly handed over before relieving.',
                'All other terms and conditions of your employment contract remain unchanged. We appreciate your dedication and wish you success in your new role.',
            ],
            signatureLabel: 'Authorized Signatory, HR',
        },
        companyNameFull,
        reportFont,
        drawPdfReportHeaderServer
    );

    return Buffer.from(doc.output('arraybuffer'));
}

