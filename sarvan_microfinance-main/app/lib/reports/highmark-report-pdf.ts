import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { HighmarkReportSummary } from '@/components/highmark/types';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import {
  type CrifReportJson,
  type CrifLoanDetails,
  type LoanTypeGroup,
  getAccountSummary,
  getActiveAccountsByLoanTypeSplit,
  getVariations,
  getIdEntries,
  getLoans,
  getLoanSections,
  getInquiries,
  formatInr,
} from '@/components/highmark/parse-report';
import { toDisplayDateTime } from '@/app/lib/date-format';

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

const MARGIN = 12;
const HEAD_FILL: [number, number, number] = [1, 51, 24]; // app brand deep green

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - MARGIN) {
    doc.addPage();
    return MARGIN + 5;
  }
  return y;
}

function sectionTitle(doc: jsPDF, title: string, y: number, font: string): number {
  y = ensureSpace(doc, y, 12);
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...HEAD_FILL);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, 7, 'F');
  doc.setFontSize(10);
  doc.setFont(font, 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(title, MARGIN + 3, y + 5);
  doc.setTextColor(0, 0, 0);
  return y + 11;
}

type LoanCardStatus = 'active' | 'arrear' | 'closed';

const STATUS_COLORS: Record<LoanCardStatus, { fill: [number, number, number]; text: [number, number, number]; label: string }> = {
  active: { fill: [224, 246, 234], text: [16, 122, 66], label: 'ACTIVE' },
  arrear: { fill: [252, 205, 205], text: [178, 24, 24], label: 'ARREAR / OVERDUE' },
  closed: { fill: [237, 237, 240], text: [90, 90, 100], label: 'CLOSED' },
};

/** Highlighted bar for each account entry heading (e.g. "1. JLG Group — NORTHERN ARC CAPITAL LIMITED"),
 *  colored green (active) / red (arrear-overdue) / grey (closed) — mirrors the highlighted section titles above it. */
function accountHeader(
  doc: jsPDF,
  index: number,
  loan: { 'ACCT-TYPE'?: string; 'CREDIT-GUARANTOR'?: string; 'ACCOUNT-STATUS'?: string },
  status: LoanCardStatus,
  y: number,
  pageWidth: number,
  font: string
): number {
  y = ensureSpace(doc, y, 16);
  const { fill, text, label } = STATUS_COLORS[status];
  doc.setFillColor(...fill);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, 7, 'F');
  doc.setFont(font, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...text);
  doc.text(`${index}. ${loan['ACCT-TYPE'] || ''} — ${loan['CREDIT-GUARANTOR'] || ''}`, MARGIN + 2, y + 5);
  doc.text(status === 'arrear' ? label : (loan['ACCOUNT-STATUS'] || '').toUpperCase(), pageWidth - MARGIN - 2, y + 5, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  doc.setFont(font, 'normal');
  return y + 10;
}

const SUBHEADING_FILL: [number, number, number] = [252, 230, 179]; // amber-100, distinct from the green section bands
const SUBHEADING_BORDER: [number, number, number] = [217, 119, 6]; // amber-600
const SUBHEADING_TEXT: [number, number, number] = [120, 53, 15]; // amber-900

/** Highlighted sub-heading for an ACCT-TYPE group (e.g. "JLG Individual") within Account Information. */
function loanTypeSubheading(doc: jsPDF, type: string, y: number, font: string): number {
  y = ensureSpace(doc, y, 9);
  doc.setFont(font, 'bold');
  doc.setFontSize(9);
  const width = doc.getTextWidth(type) + 6;
  doc.setFillColor(...SUBHEADING_FILL);
  doc.rect(MARGIN, y - 4.5, width, 6.5, 'F');
  doc.setDrawColor(...SUBHEADING_BORDER);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y - 4.5, MARGIN, y + 2);
  doc.setTextColor(...SUBHEADING_TEXT);
  doc.text(type, MARGIN + 3, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(font, 'normal');
  return y + 6;
}

/** Highlighted band for the top-level loan section heading ("JLG Individual & Micro Finance Accounts" / "Other Loan Accounts"). */
function loanSectionHeading(doc: jsPDF, title: string, y: number, pageWidth: number, font: string): number {
  y = ensureSpace(doc, y, 9);
  doc.setFillColor(...HEAD_FILL);
  doc.rect(MARGIN, y - 5, pageWidth - MARGIN * 2, 7, 'F');
  doc.setFont(font, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(title, MARGIN + 2, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont(font, 'normal');
  return y + 7;
}

export async function buildHighmarkReportPdf(report: HighmarkReportSummary): Promise<void> {
  const json = report.reportJson as CrifReportJson;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const reportFont = await ensureReportFont(doc);

  // ── Title ─────────────────────────────────────────────
  let y = await drawPdfReportHeader(doc, 'Highmark Credit Report', {
    subtitle: `For ${report.firstName} ${report.lastName || ''}`.trim(),
    fontFamily: reportFont,
  });

  doc.setFontSize(9);
  doc.text(`CHM Ref #: ${report.providerReference || '-'}`, MARGIN, y);
  doc.text(`Date of Request: ${json.HEADER?.['DATE-OF-REQUEST'] || '-'}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 5;
  doc.text('Prepared For: Sarvam', MARGIN, y);
  doc.text(`Date of Issue: ${json.HEADER?.['DATE-OF-ISSUE'] || '-'}`, pageWidth - MARGIN, y, { align: 'right' });
  y += 8;

  // ── Account Summary ───────────────────────────────────
  y = sectionTitle(doc, 'Account Summary', y, reportFont);
  const summary = getAccountSummary(json);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Type', 'No. of A/c', 'Active', 'Overdue', 'Current Balance', 'Amt Disbd/High Credit']],
    body: [
      [summary.label, String(summary.accounts), String(summary.active), String(summary.overdue), formatInr(summary.currentBalance), formatInr(summary.disbursedOrHighCredit)],
      ['Total', String(summary.accounts), String(summary.active), String(summary.overdue), formatInr(summary.currentBalance), formatInr(summary.disbursedOrHighCredit)],
    ],
    theme: 'grid',
    styles: { font: reportFont, fontSize: 8 },
    headStyles: { font: reportFont, fillColor: [230, 245, 236], textColor: 0, fontStyle: 'bold' },
  });
  y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 4;

  const derived = json['ACCOUNTS-SUMMARY']?.['DERIVED-ATTRIBUTES'] || {};
  doc.setFontSize(8);
  doc.text(
    `Inquiries (6mo): ${derived['INQURIES-IN-LAST-SIX-MONTHS'] ?? '-'}    New Accounts (6mo): ${derived['NEW-ACCOUNTS-IN-LAST-SIX-MONTHS'] ?? '-'}    New Delinquent (6mo): ${derived['NEW-DELINQ-ACCOUNT-IN-LAST-SIX-MONTHS'] ?? '-'}`,
    MARGIN,
    y
  );
  y += 6;

  const drawActiveLoanTypeTable = (
    title: string,
    rows: ReturnType<typeof getActiveAccountsByLoanTypeSplit>['microfinance']['rows'],
    total: ReturnType<typeof getActiveAccountsByLoanTypeSplit>['microfinance']['total']
  ) => {
    if (rows.length === 0) return;
    y = ensureSpace(doc, y, 12);
    doc.setFont(reportFont, 'bold');
    doc.text(title, MARGIN, y);
    doc.setFont(reportFont, 'normal');
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Account Type', 'No. of A/c', 'Overdue', 'Current Balance', 'Amt Disbd/High Credit', 'InstlAmt', 'Overdue Amt', 'Arrear Amount']],
      body: [
        ...rows.map((r) => [r.type, String(r.accounts), String(r.overdue), formatInr(r.currentBalance), formatInr(r.disbursedOrHighCredit), formatInr(r.instlAmt), formatInr(r.overdueAmt), formatInr(r.overdueAmt)]),
        ['Total', String(total.accounts), String(total.overdue), formatInr(total.currentBalance), formatInr(total.disbursedOrHighCredit), formatInr(total.instlAmt), formatInr(total.overdueAmt), formatInr(total.overdueAmt)],
      ],
      theme: 'grid',
      styles: { font: reportFont, fontSize: 7 },
      headStyles: { font: reportFont, fillColor: [230, 245, 236], textColor: 0, fontStyle: 'bold' },
    });
    y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 6;
  };

  const { microfinance: activeMicrofinance, others: activeOthers } = getActiveAccountsByLoanTypeSplit(json);
  drawActiveLoanTypeTable('Active Accounts by Loan Type — JLG Individual & Micro Finance', activeMicrofinance.rows, activeMicrofinance.total);
  drawActiveLoanTypeTable('Active Accounts by Loan Type — Others', activeOthers.rows, activeOthers.total);

  // ── Inquiry Input Information ─────────────────────────
  y = sectionTitle(doc, 'Inquiry Input Information', y, reportFont);
  const dobVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['DATE-OF-BIRTH-VARIATIONS']);
  const phoneVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['PHONE-NUMBER-VARIATIONS']);
  const addressVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['ADDRESS-VARIATIONS']);
  const idEntries = getIdEntries(json);
  doc.setFontSize(8.5);
  const infoLines: Array<[string, string]> = [
    ['Name', `${report.firstName} ${report.lastName || ''}`.trim()],
    ['DOB', dobVariations[0]?.VALUE || '-'],
    ['Phone Numbers', phoneVariations.map((v) => v.VALUE).join(', ') || report.phone],
    ['ID(s)', idEntries.map((e) => `${e.value} [${e.label}]`).join(', ') || '-'],
    ['Current Address', addressVariations[0]?.VALUE || '-'],
    ['Other Address', addressVariations[1]?.VALUE || '-'],
  ];
  for (const [label, value] of infoLines) {
    y = ensureSpace(doc, y, 6);
    doc.setFont(reportFont, 'bold');
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont(reportFont, 'normal');
    const wrapped = doc.splitTextToSize(value, pageWidth - MARGIN * 2 - 35);
    doc.text(wrapped, MARGIN + 35, y);
    y += 4.5 * (Array.isArray(wrapped) ? wrapped.length : 1) + 1;
  }
  y += 3;

  // ── CRIF HM Score(s) ───────────────────────────────────
  const score = json.SCORES?.SCORE;
  if (score) {
    y = sectionTitle(doc, 'CRIF HM Score(S)', y, reportFont);
    doc.setFontSize(20);
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(...HEAD_FILL);
    doc.text(String(score['SCORE-VALUE'] ?? '-'), MARGIN, y + 5);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8.5);
    doc.setFont(reportFont, 'normal');
    doc.text(`${score['SCORE-TYPE'] || ''}  (Range 300-900)`, MARGIN + 22, y + 1);
    doc.text(`Factors: ${score['SCORE-FACTORS'] || '-'}`, MARGIN + 22, y + 6);
    y += 14;
  }

  // ── Personal Information - Variations ─────────────────
  const nameVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['NAME-VARIATIONS']);
  if (nameVariations.length > 0 || addressVariations.length > 0) {
    y = sectionTitle(doc, 'Personal Information - Variations', y, reportFont);
    const variationTable = (title: string, rows: Array<{ VALUE: string; 'REPORTED-DATE': string }>) => {
      if (rows.length === 0) return;
      y = ensureSpace(doc, y, 10);
      doc.setFont(reportFont, 'bold');
      doc.setFontSize(8.5);
      doc.text(title, MARGIN, y);
      y += 2;
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [['Value', 'Reported On']],
        body: rows.map((r) => [r.VALUE, r['REPORTED-DATE']]),
        theme: 'striped',
        styles: { font: reportFont, fontSize: 7.5 },
        headStyles: { font: reportFont, fillColor: [230, 245, 236], textColor: 0, fontStyle: 'bold' },
      });
      y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 4;
    };
    variationTable('Name Variations', nameVariations);
    variationTable('Address Variations', addressVariations);
    variationTable('DOB Variations', dobVariations);
    variationTable('Phone Variations', phoneVariations);
  }

  // ── Account Information — JLG/Micro Finance first, then all other loan types ──
  const loans = getLoans(json);
  const loanSections = getLoanSections(json);
  if (loans.length > 0) {
    y = sectionTitle(doc, `Account Information (${loans.length})`, y, reportFont);
    let index = 0;
    const drawLoanCard = (loan: CrifLoanDetails, status: LoanCardStatus) => {
      index += 1;
      y = accountHeader(doc, index, loan, status, y, pageWidth, reportFont);
      autoTable(doc, {
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        theme: 'plain',
        styles: { font: reportFont, fontSize: 7.5, cellPadding: 1 },
        body: [
          ['Account #', loan['ACCT-NUMBER'] || '-', 'Ownership', loan['OWNERSHIP-IND'] || '-'],
          ['Credit Limit', loan['CREDIT-LIMIT'] || '-', 'InstlAmt/Freq', loan['INSTALLMENT-AMT'] || '-'],
          ['Disbursed Date', loan['DISBURSED-DT'] || '-', 'Last Payment Date', loan['LAST-PAYMENT-DATE'] || '-'],
          ['Closed Date', loan['CLOSED-DATE'] || '-', 'Tenure', loan['REPAYMENT-TENURE'] || '-'],
          ['Disbd Amt/High Credit', loan['DISBURSED-AMT'] || '-', 'Current Balance', loan['CURRENT-BAL'] || '-'],
          ['Overdue Amt', loan['OVERDUE-AMT'] || '-', 'DPD', loan.DPD || '-'],
          ['Total Writeoff Amt', loan['WRITE-OFF-AMT'] || '-', 'Interest Rate', loan['INTEREST-RATE'] || '-'],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 }, 2: { fontStyle: 'bold', cellWidth: 42 } },
      });
      y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 5;
    };
    const drawGroups = (groups: LoanTypeGroup[]) => {
      for (const group of groups) {
        if (group.active.length === 0 && group.arrear.length === 0 && group.closed.length === 0) continue;
        y = loanTypeSubheading(doc, group.type, y, reportFont);
        group.active.forEach((loan) => drawLoanCard(loan, 'active'));
        group.arrear.forEach((loan) => drawLoanCard(loan, 'arrear'));
        group.closed.forEach((loan) => drawLoanCard(loan, 'closed'));
      }
    };
    if (loanSections.microfinance.length > 0) {
      y = loanSectionHeading(doc, 'JLG Individual & Micro Finance Accounts', y, pageWidth, reportFont);
      y += 2;
      drawGroups(loanSections.microfinance);
    }
    if (loanSections.others.length > 0) {
      y = loanSectionHeading(doc, 'Other Loan Accounts', y, pageWidth, reportFont);
      y += 2;
      drawGroups(loanSections.others);
    }
  }

  // ── Inquiries ──────────────────────────────────────────
  const inquiries = getInquiries(json);
  if (inquiries.length > 0) {
    y = sectionTitle(doc, 'Inquiries (reported for past 24 months)', y, reportFont);
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Credit Grantor', 'Date', 'Purpose', 'Amount', 'Remark']],
      body: inquiries.map((inq) => [inq['MEMBER-NAME'] || '-', inq['INQUIRY-DATE'] || '-', inq.PURPOSE || '-', inq.AMOUNT || '-', inq.REMARK || '-']),
      theme: 'grid',
      styles: { font: reportFont, fontSize: 7.5 },
      headStyles: { font: reportFont, fillColor: [230, 245, 236], textColor: 0, fontStyle: 'bold' },
    });
    y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 6;
  }

  // ── Footer note ────────────────────────────────────────
  y = ensureSpace(doc, y, 12);
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(
    doc.splitTextToSize(
      `Charged Rs.${Number(report.creditsCharged).toFixed(2)} on ${toDisplayDateTime(new Date(report.pulledAt))}. Company Confidential Data — generated from the CRIF (SurepassCrif) bureau response.`,
      pageWidth - MARGIN * 2
    ),
    MARGIN,
    y
  );

  const safeName = `${report.firstName}_${report.lastName || ''}`.trim().replace(/[^\w.-]+/g, '_');
  const dateStr = new Date(report.pulledAt).toISOString().slice(0, 10);
  doc.save(`Highmark_Report_${safeName}_${dateStr}.pdf`);
}
