import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";
import { toDisplayDate } from '@/app/lib/date-format';

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface CompanyProfileData {
  identification: {
    reportDate: string;
  };
  functionalData: {
    openingPortfolio: number;
    loanDisbursementSinceApril: number;
    portfolioOutstanding: number;
    demand: number;
    collection: number;
    recoveryRate: number;
    advance: number;
    preclosure: number;
    openingArrear: number;
    currentArrear: number;
    closingArrear: number;
  };
  operationalData: {
    noOfCenters: number;
    noOfGroups: number;
    noOfFdo: number;
    openingClients: number;
    openingMembers?: number;
    openingClientsWithLoan?: number;
    newClients: number;
    newMembers?: number;
    newClientsWithLoan?: number;
    dropouts: number;
    dropoutMembers?: number;
    dropoutClientsWithLoan?: number;
    closingClients: number;
    closingMembers?: number;
    closingClientsWithLoan?: number;
    waitingBorrowers: number;
    activeClients: number;
  };
}

function formatDate(dateString: string): string {
  return toDisplayDate(dateString);
}

const formatCurrency = (amount: number): string => formatReportAmount(amount);

/**
 * Draws the Company Profile report — trust header, then two sequential
 * body-only autoTable sections of the same 4-column key-value shape
 * ("Functional Data" then "Operational Data"), each preceded by a manual
 * doc.text() section title — extracted verbatim from the Direct Download PDF
 * logic in components/reports/CompanyProfileClient.tsx's handlePdfExport, so
 * the exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawCompanyProfileReport(
  doc: jsPDF,
  data: CompanyProfileData,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Company Profile", {
    subtitle: `As on ${formatDate(data.identification.reportDate)}`,
    fontFamily: reportFont,
  });

  const { functionalData, operationalData } = data;

  // Functional Data Table
  doc.setFontSize(12);
  doc.setTextColor(37, 99, 235);
  doc.text("Functional Data", 15, headerY);

  autoTable(doc, {
    startY: headerY + 4,
    body: [
      [
        "Opening Portfolio 1st April",
        formatCurrency(functionalData.openingPortfolio),
        "Loan Disbursement Since April",
        formatCurrency(functionalData.loanDisbursementSinceApril),
      ],
      [
        "Portfolio Outstanding",
        formatCurrency(functionalData.portfolioOutstanding),
        "Demand",
        formatCurrency(functionalData.demand),
      ],
      [
        "Collection",
        formatCurrency(functionalData.collection),
        "Recovery Rate %",
        `${functionalData.recoveryRate}%`,
      ],
      [
        "Advance",
        formatCurrency(functionalData.advance),
        "Preclosure",
        formatCurrency(functionalData.preclosure),
      ],
      [
        "Opening Arrear 1st April",
        formatCurrency(functionalData.openingArrear),
        "Current Period Arrear",
        formatCurrency(functionalData.currentArrear),
      ],
      [
        "Closing Arrear",
        formatCurrency(functionalData.closingArrear),
        "",
        "",
      ],
    ],
    theme: "grid",
    styles: { font: reportFont, fontSize: 9, cellPadding: 3 },
    headStyles: { font: reportFont },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [248, 250, 252], cellWidth: 55 },
      1: { cellWidth: 35, halign: "right" },
      2: { fontStyle: "bold", fillColor: [248, 250, 252], cellWidth: 55 },
      3: { cellWidth: 35, halign: "right" },
    },
  });

  // Operational Data Table
  doc.setFontSize(12);
  doc.setTextColor(37, 99, 235);
  doc.text("Operational Data", 15, (doc as any).lastAutoTable.finalY + 12);

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 16,
    body: [
      [
        "No. Of Centers",
        operationalData.noOfCenters.toString(),
        "No. Of Groups",
        operationalData.noOfGroups.toString(),
      ],
      [
        "No. Of FDO",
        operationalData.noOfFdo.toString(),
        "Opening (Total)",
        operationalData.openingClients.toString(),
      ],
      [
        "Opening Members",
        (operationalData.openingMembers ?? '').toString(),
        "Opening Clients",
        (operationalData.openingClientsWithLoan ?? '').toString(),
      ],
      [
        "New (Total)",
        operationalData.newClients.toString(),
        "New Members",
        (operationalData.newMembers ?? '').toString(),
      ],
      [
        "New Clients",
        (operationalData.newClientsWithLoan ?? '').toString(),
        "Dropouts",
        operationalData.dropouts.toString(),
      ],
      [
        "Closing (Total)",
        operationalData.closingClients.toString(),
        "Closing Members",
        (operationalData.closingMembers ?? '').toString(),
      ],
      [
        "Closing Clients",
        (operationalData.closingClientsWithLoan ?? '').toString(),
        "Waiting Borrowers",
        operationalData.waitingBorrowers.toString(),
      ],
      ["Active Clients", operationalData.activeClients.toString(), "", ""],
    ],
    theme: "grid",
    styles: { font: reportFont, fontSize: 9, cellPadding: 3 },
    headStyles: { font: reportFont },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [248, 250, 252], cellWidth: 55 },
      1: { cellWidth: 35, halign: "right" },
      2: { fontStyle: "bold", fillColor: [248, 250, 252], cellWidth: 55 },
      3: { cellWidth: 35, halign: "right" },
    },
  });
}
