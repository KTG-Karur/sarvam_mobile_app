import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { compressDataUrlForPdf } from '@/app/lib/pdf/compress-image-for-pdf';

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

const MARGIN = 15;

export type GoldRecordPdfField = { label: string; value: string };
export type GoldRecordPdfPhoto = { key: string; dataUrl: string };
export type GoldRecordPdfPhotoGroup = { title: string; photos: GoldRecordPdfPhoto[] };

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + needed > pageHeight - MARGIN) {
        doc.addPage();
        return MARGIN + 5;
    }
    return y;
}

/** Single-record PDF: a label/value table (drawn via the shared trust header + autoTable
 *  pattern used by the list-level report exports) followed by one or more labeled photo
 *  groups (e.g. "Gold Photos" vs "Recipient Photo" on a gold-return record). */
export async function buildGoldRecordPdf(
    reportTitle: string,
    subtitle: string,
    fields: GoldRecordPdfField[],
    photoGroups: GoldRecordPdfPhotoGroup[],
    fileName: string
): Promise<void> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as DocWithAutoTable;
    const reportFont = await ensureReportFont(doc);

    const headerY = await drawPdfReportHeader(doc, reportTitle, { subtitle, fontFamily: reportFont });

    autoTable(doc, {
        startY: headerY,
        body: fields.map((f) => [f.label, f.value]),
        theme: 'grid',
        styles: { font: reportFont, fontSize: 9, cellPadding: 2.5, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 55, fillColor: [245, 245, 245] },
            1: { cellWidth: 'auto' },
        },
    });

    let y = (doc.lastAutoTable?.finalY ?? headerY) + 8;
    const pageWidth = doc.internal.pageSize.getWidth();

    for (const group of photoGroups) {
        y = ensureSpace(doc, y, 10);
        doc.setFont(reportFont, 'bold');
        doc.setFontSize(11);
        doc.text(group.title, MARGIN, y);
        y += 6;

        if (group.photos.length === 0) {
            // jsPDF's built-in Times supports 'italic' natively (unlike the previous
            // embedded Poppins TTFs, which only registered normal/bold).
            doc.setFont(reportFont, 'italic');
            doc.setFontSize(9);
            doc.setTextColor(120, 120, 120);
            doc.text('No photo attached.', MARGIN, y);
            doc.setTextColor(0, 0, 0);
            doc.setFont(reportFont, 'normal');
            y += 8;
            continue;
        }

        const imgSize = 70;
        const gap = 6;
        const perRow = Math.max(1, Math.floor((pageWidth - MARGIN * 2 + gap) / (imgSize + gap)));
        let col = 0;

        for (const photo of group.photos) {
            y = ensureSpace(doc, y, imgSize + gap);
            const x = MARGIN + col * (imgSize + gap);
            try {
                // Source photos are often several MB at full camera resolution —
                // downscale to the print size before embedding so the PDF stays
                // in the tens of KB per photo instead of megabytes.
                const compressed = await compressDataUrlForPdf(photo.dataUrl);
                doc.addImage(compressed, 'JPEG', x, y, imgSize, imgSize, undefined, 'FAST');
            } catch {
                // Skip a photo that fails to decode rather than aborting the whole PDF
            }
            col++;
            if (col >= perRow) {
                col = 0;
                y += imgSize + gap;
            }
        }
        if (col !== 0) y += imgSize + gap;
        y += 4;
    }

    doc.save(fileName);
}
