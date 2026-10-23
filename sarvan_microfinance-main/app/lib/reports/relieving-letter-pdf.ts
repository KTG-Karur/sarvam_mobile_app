import { jsPDF } from 'jspdf';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { drawPdfReportHeaderServer } from '@/app/lib/reports/pdf-report-header-server';
import { ensureReportFontServer } from '@/app/lib/reports/pdf-fonts-server';
import { drawHrLetter, type HrLetterRecipient } from '@/app/lib/reports/hr-letter-common';

export interface RelievingLetterData {
    recipient: HrLetterRecipient;
    refNo: string;
    issueDate: string;
    dateOfJoining: string;
    lastWorkingDate: string;
    exitTypeLabel: string;
}

/**
 * Relieving Letter — generated at Exit & Clearance's Final HR Approval step,
 * alongside the NDC. Distinct template from Confirmation/Promotion letters.
 */
export async function buildRelievingLetterPdf(data: RelievingLetterData): Promise<Buffer> {
    const { companyNameFull } = await getActiveBrandNames();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const reportFont = ensureReportFontServer(doc);

    await drawHrLetter(
        doc,
        {
            title: 'Relieving Letter',
            refNo: data.refNo,
            issueDate: data.issueDate,
            recipient: data.recipient,
            extraFields: [
                ['Date of Joining', data.dateOfJoining],
                ['Last Working Date', data.lastWorkingDate],
            ],
            bodyParagraphs: [
                `This is to certify that ${data.recipient.employeeName} was employed with ${companyNameFull} from ${data.dateOfJoining} to ${data.lastWorkingDate} as ${data.recipient.designation}.`,
                `Their exit from the organization (${data.exitTypeLabel}) has been processed and all applicable clearance formalities have been completed. We wish them success in their future endeavors.`,
            ],
            signatureLabel: 'Authorized Signatory, HR',
        },
        companyNameFull,
        reportFont,
        drawPdfReportHeaderServer
    );

    return Buffer.from(doc.output('arraybuffer'));
}
