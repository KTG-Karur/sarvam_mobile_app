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

export interface SalaryLineItem {
  name: string;
  type: "EARNINGS" | "DEDUCTIONS";
  amount: number;
}

export interface PayslipData {
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  branchName: string;
  branchCode: string;
  month: number;
  year: number;
  paymentType: string;
  status: string;
  paidOn: string;
  components: SalaryLineItem[];
  totalEarnings: number;
  totalDeductions: number;
  netPayable: number;
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const fmtRaw = (v: number) => formatReportAmount(v);

/**
 * Draws the Payslip — BESPOKE, hand-drawn document, not a flat-table
 * report: trust header, then a manually-drawn two-column employee-info
 * grid, a section title bar, a single autoTable for the paired
 * Earnings/Deductions columns, a manually-drawn Net Pay banner,
 * signature lines, and a footer disclaimer — extracted verbatim from the
 * Direct Download PDF logic in components/reports/PayslipClient.tsx's
 * handleExportPDF, so the exact same rendering (including every color,
 * font size, and spacing value) can be reused by the Request Report
 * queue's PDF builder (via an injected Node-safe `drawHeader`) without
 * duplicating the layout. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by
 * this extraction. One payslip per employee/month/year — no batching.
 */
export async function drawPayslipReport(
  doc: jsPDF,
  data: PayslipData,
  companyNameFull: string,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const pageW = doc.internal.pageSize.getWidth();

  // ── Standard trust header ─────────────────────────────────────
  const headerY = await drawHeader(doc, "Salary Payslip", {
    subtitle: `${MONTH_NAMES[data.month]} ${data.year}  |  ${data.status}`,
    fontFamily: reportFont,
  });

  // ── Employee Info Grid ──────────────────────────────────────────
  const infoGridHeight = 30;
  doc.setFillColor(248, 250, 252);
  doc.rect(0, headerY, pageW, infoGridHeight, "F");
  doc.setDrawColor(226, 232, 240);
  doc.rect(0, headerY, pageW, infoGridHeight, "S");
  doc.line(pageW / 2, headerY, pageW / 2, headerY + infoGridHeight);

  const paidDate = data.paidOn
    ? toDisplayDate(new Date(data.paidOn))
    : "N/A";

  const leftInfo: [string, string][] = [
    ["Employee Name", data.employeeName],
    ["Employee Code", data.employeeCode],
    ["Designation", data.designation],
    ["Department", data.department],
  ];
  const rightInfo: [string, string][] = [
    ["Branch", `${data.branchName} (${data.branchCode})`],
    ["Pay Period", `${MONTH_NAMES[data.month]} ${data.year}`],
    ["Payment Mode", data.paymentType],
    ["Paid On", paidDate],
  ];

  leftInfo.forEach(([lbl, val], i) => {
    const y = headerY + 7 + i * 6;
    doc.setFontSize(7.5);
    doc.setFont(reportFont, "bold");
    doc.setTextColor(100, 116, 139);
    doc.text(lbl, 8, y);
    doc.setFont(reportFont, "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(String(val), 46, y);
  });
  rightInfo.forEach(([lbl, val], i) => {
    const y = headerY + 7 + i * 6;
    doc.setFontSize(7.5);
    doc.setFont(reportFont, "bold");
    doc.setTextColor(100, 116, 139);
    doc.text(lbl, pageW / 2 + 4, y);
    doc.setFont(reportFont, "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(String(val), pageW / 2 + 36, y);
  });

  // ── Section title bar ───────────────────────────────────────────
  const sectionBarY = headerY + infoGridHeight;
  doc.setFillColor(30, 41, 59);
  doc.rect(0, sectionBarY, pageW, 7, "F");
  doc.setFontSize(7.5);
  doc.setFont(reportFont, "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("EARNINGS & DEDUCTIONS", 8, sectionBarY + 5);

  // ── Earnings / Deductions table ─────────────────────────────────
  const earnings = data.components.filter((c) => c.type === "EARNINGS");
  const deductions = data.components.filter((c) => c.type === "DEDUCTIONS");
  const maxRows = Math.max(earnings.length, deductions.length, 1);

  const tableBody: (string | number)[][] = Array.from({ length: maxRows }, (_, i) => [
    earnings[i]?.name ?? "",
    earnings[i] ? `Rs. ${fmtRaw(earnings[i].amount)}` : "",
    deductions[i]?.name ?? "",
    deductions[i] ? `Rs. ${fmtRaw(deductions[i].amount)}` : "",
  ]);

  tableBody.push(["Total Earnings", `Rs. ${fmtRaw(data.totalEarnings)}`, "Total Deductions", `Rs. ${fmtRaw(data.totalDeductions)}`]);

  autoTable(doc, {
    startY: sectionBarY + 7,
    head: [
      [
        { content: "Earnings", styles: { textColor: [5, 150, 105], halign: "left" } },
        { content: "Amount (Rs.)", styles: { textColor: [5, 150, 105], halign: "right" } },
        { content: "Deductions", styles: { textColor: [220, 38, 38], halign: "left" } },
        { content: "Amount (Rs.)", styles: { textColor: [220, 38, 38], halign: "right" } },
      ],
    ],
    body: tableBody,
    theme: "grid",
    headStyles: { font: reportFont, fillColor: [241, 245, 249], textColor: [30, 41, 59], fontSize: 8, fontStyle: "bold", lineColor: [226, 232, 240], lineWidth: 0.3 },
    bodyStyles: { font: reportFont, fontSize: 8, textColor: [51, 65, 85], lineColor: [241, 245, 249], lineWidth: 0.2 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: (pageW - 20) * 0.34 },
      1: { cellWidth: (pageW - 20) * 0.16, halign: "right", fontStyle: "bold", textColor: [5, 150, 105] },
      2: { cellWidth: (pageW - 20) * 0.34 },
      3: { cellWidth: (pageW - 20) * 0.16, halign: "right", fontStyle: "bold", textColor: [220, 38, 38] },
    },
    willDrawCell: (hookData) => {
      if (hookData.row.index === tableBody.length - 1 && hookData.section === "body") {
        hookData.cell.styles.fillColor = [226, 232, 240];
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.fontSize = 8.5;
        hookData.cell.styles.textColor = [15, 23, 42];
      }
    },
    margin: { left: 10, right: 10 },
  });

  // ── Net Pay bar ─────────────────────────────────────────────────
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  doc.setFillColor(30, 58, 138);
  doc.rect(0, finalY, pageW, 14, "F");

  doc.setFontSize(9);
  doc.setFont(reportFont, "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("NET SALARY PAYABLE", 12, finalY + 6);

  doc.setFontSize(7.5);
  doc.setFont(reportFont, "normal");
  doc.setTextColor(191, 219, 254);
  doc.text("Total Earnings - Total Deductions", 12, finalY + 11);

  doc.setFontSize(13);
  doc.setFont(reportFont, "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(`Rs. ${fmtRaw(data.netPayable)}`, pageW - 12, finalY + 9, { align: "right" });

  // ── Signatures ──────────────────────────────────────────────────
  const sigY = finalY + 24;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.4);

  const sigPositions = [30, pageW / 2, pageW - 30];
  const sigLabels = ["Employee Signature", "Prepared By", "Authorized Signatory"];
  sigPositions.forEach((cx, i) => {
    doc.line(cx - 22, sigY, cx + 22, sigY);
    doc.setFontSize(7);
    doc.setFont(reportFont, "bold");
    doc.setTextColor(100, 116, 139);
    doc.text(sigLabels[i], cx, sigY + 4, { align: "center" });
  });

  // ── Footer disclaimer ───────────────────────────────────────────
  doc.setFontSize(6.5);
  doc.setFont(reportFont, "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Computer-generated payslip — no physical signature required  | " + companyNameFull.toUpperCase() + " – Confidential",
    pageW / 2,
    sigY + 11,
    { align: "center" }
  );
}
