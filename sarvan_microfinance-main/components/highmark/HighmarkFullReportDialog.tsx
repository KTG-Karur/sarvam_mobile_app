'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, ShieldCheck } from 'lucide-react';
import { useBrandNames } from '@/app/lib/brand-context';
import {
  type CrifReportJson,
  type CrifLoanDetails,
  type LoanTypeGroup,
  type LoanRowStatus,
  getAccountSummary,
  getActiveAccountsByLoanTypeSplit,
  getVariations,
  getIdEntries,
  getLoans,
  getLoanSections,
  getInquiries,
  parsePaymentHistory,
  formatInr,
} from './parse-report';
import type { HighmarkReportSummary } from './types';
import { buildHighmarkReportPdf } from '@/app/lib/reports/highmark-report-pdf';
import { RecheckCreditButton } from './RecheckCreditButton';
import { usePermission } from '@/app/hooks/usePermission';
import { PageLoader } from '@/components/ui/page-loader';

function SectionBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-t-md bg-brand-green-darker px-4 py-2 text-sm font-semibold text-white dark:bg-sidebar-accent">
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-primary/20 dark:border-sidebar-accent">
      <SectionBand>{title}</SectionBand>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-0.5 text-sm min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium break-all min-w-0">{value || '—'}</span>
    </div>
  );
}

export function HighmarkFullReportDialog({
  isOpen,
  onOpenChange,
  report,
  isLoading,
  clientId,
  clientName,
  centerName,
  onRechecked,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  report: HighmarkReportSummary | null;
  isLoading?: boolean;
  /** Needed to run the "Recheck" action from this view's header — omit for a report not tied to a client (e.g. the standalone Run Credit Check screen). */
  clientId?: string;
  clientName?: string;
  centerName?: string | null;
  onRechecked?: (report: HighmarkReportSummary) => void;
}) {
  const headerName = report ? `${report.firstName} ${report.lastName || ''}`.trim() : clientName || '';
  const { hasAnyRole } = usePermission();
  // BM/FDO can view the full report on screen but must not be able to download it as a PDF.
  const canDownload = !hasAnyRole(['branch-manager', 'fdo']);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[94vh] max-h-[94vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 break-words">
              <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
              Highmark Credit Report{headerName ? ` — ${headerName}` : ''}{centerName ? ` · ${centerName}` : ''}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {clientId && (
                <RecheckCreditButton clientId={clientId} clientName={headerName} onRechecked={onRechecked} />
              )}
              {report && canDownload && (
                <Button size="sm" onClick={() => buildHighmarkReportPdf(report)}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <PageLoader fullScreen={false} />
        ) : !report ? (
          <div className="py-24 text-center text-sm text-muted-foreground">
            No Highmark check has been run for this client yet. Click &quot;Recheck&quot; above to pull one.
          </div>
        ) : (
          <ReportBody report={report} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportBody({ report }: { report: HighmarkReportSummary }) {
  const { companyNameShort } = useBrandNames();
  const json = report.reportJson as CrifReportJson;

  const summary = getAccountSummary(json);
  const { microfinance: activeMicrofinance, others: activeOthers } = getActiveAccountsByLoanTypeSplit(json);
  const derived = json['ACCOUNTS-SUMMARY']?.['DERIVED-ATTRIBUTES'] || {};
  const nameVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['NAME-VARIATIONS']);
  const addressVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['ADDRESS-VARIATIONS']);
  const dobVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['DATE-OF-BIRTH-VARIATIONS']);
  const phoneVariations = getVariations(json['PERSONAL-INFO-VARIATION']?.['PHONE-NUMBER-VARIATIONS']);
  const idEntries = getIdEntries(json);
  const loans = getLoans(json);
  const loanSections = getLoanSections(json);
  const loanIndex = new Map<CrifLoanDetails, number>();
  let loanCounter = 0;
  for (const group of [...loanSections.microfinance, ...loanSections.others]) {
    for (const loan of [...group.active, ...group.arrear, ...group.closed]) {
      loanIndex.set(loan, ++loanCounter);
    }
  }
  const inquiries = getInquiries(json);
  const score = json.SCORES?.SCORE;
  const scoreFactors = (score?.['SCORE-FACTORS'] || '').split('|').filter(Boolean);

  return (
    <>
        <div className="space-y-4 min-w-0">
          {/* Report meta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-md border border-primary/20 p-4 text-sm dark:border-sidebar-accent">
            <Field label="CHM Ref #" value={report.providerReference} />
            <Field label="Prepared For" value={companyNameShort} />
            <Field label="Date of Request" value={json.HEADER?.['DATE-OF-REQUEST']} />
            <Field label="Date of Issue" value={json.HEADER?.['DATE-OF-ISSUE']} />
          </div>

          {/* Account Summary */}
          <Section title="Account Summary">
            <p className="mb-2 text-xs text-muted-foreground">Current Balance &amp; Disbursed Amount is considered ONLY for ACTIVE accounts.</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Number of Account(s)</TableHead>
                    <TableHead className="text-right">Active Account(s)</TableHead>
                    <TableHead className="text-right">Overdue Account(s)</TableHead>
                    <TableHead className="text-right">Current Balance</TableHead>
                    <TableHead className="text-right">Amt Disbd/High Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">{summary.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.accounts}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.active}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.overdue}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInr(summary.currentBalance)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInr(summary.disbursedOrHighCredit)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.accounts}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.active}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.overdue}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInr(summary.currentBalance)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInr(summary.disbursedOrHighCredit)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex flex-wrap gap-6 text-xs">
              <span>Inquiries in last 6 Months: <b>{derived['INQURIES-IN-LAST-SIX-MONTHS'] ?? '—'}</b></span>
              <span>New Account(s) in last 6 Months: <b>{derived['NEW-ACCOUNTS-IN-LAST-SIX-MONTHS'] ?? '—'}</b></span>
              <span>New Delinquent Account(s) in last 6 Months: <b>{derived['NEW-DELINQ-ACCOUNT-IN-LAST-SIX-MONTHS'] ?? '—'}</b></span>
            </div>

            {activeMicrofinance.rows.length > 0 && (
              <ActiveLoanTypeTable
                title="Active Accounts by Loan Type — JLG Individual & Micro Finance"
                rows={activeMicrofinance.rows}
                total={activeMicrofinance.total}
              />
            )}
            {activeOthers.rows.length > 0 && (
              <ActiveLoanTypeTable
                title="Active Accounts by Loan Type — Others"
                rows={activeOthers.rows}
                total={activeOthers.total}
              />
            )}
          </Section>

          {/* Inquiry Input Information */}
          <Section title="Inquiry Input Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <div>
                <Field label="Name" value={`${report.firstName} ${report.lastName || ''}`} />
                <Field label="Phone Numbers" value={phoneVariations.map((v) => v.VALUE).join(', ') || report.phone} />
                <Field label="ID(s)" value={idEntries.map((e) => `${e.value} [${e.label}]`).join(', ')} />
                <Field label="Email ID(s)" value={undefined} />
              </div>
              <div>
                <Field label="DOB" value={dobVariations[0]?.VALUE} />
                <Field label="Current Address" value={addressVariations[0]?.VALUE} />
                <Field label="Other Address" value={addressVariations[1]?.VALUE} />
              </div>
            </div>
          </Section>

          {/* CRIF HM Score(S) */}
          {score && (
            <Section title="CRIF HM Score(S)">
              <div className="flex flex-wrap items-center gap-6 rounded-md bg-green-50 p-4 dark:bg-brand-green-darker/30">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{score['SCORE-TYPE']}</div>
                  <div className="text-4xl font-bold tabular-nums text-primary">{score['SCORE-VALUE']}</div>
                  <div className="text-xs text-muted-foreground">Score Range: 300-900</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {scoreFactors.map((f) => (
                    <Badge key={f} variant="secondary">{f}</Badge>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* Personal Information - Variations */}
          {(nameVariations.length > 0 || addressVariations.length > 0) && (
            <Section title="Personal Information - Variations">
              <p className="mb-3 text-xs text-muted-foreground">Applicant&apos;s personal information variations as contributed by various financial institutions.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <VariationTable title="Name Variations" rows={nameVariations} />
                <VariationTable title="DOB Variations" rows={dobVariations} />
                <VariationTable title="Phone Variations" rows={phoneVariations} />
                <VariationTable title="Address Variations" rows={addressVariations} />
              </div>
            </Section>
          )}

          {/* Account Information — JLG/Micro Finance shown first, then all other loan types */}
          {loans.length > 0 && (
            <Section title={`Account Information (${loans.length})`}>
              <div className="space-y-6">
                {loanSections.microfinance.length > 0 && (
                  <div>
                    <div className="mb-3 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-white shadow-sm">
                      JLG Individual &amp; Micro Finance Accounts
                    </div>
                    <div className="space-y-5">
                      {loanSections.microfinance.map((group) => (
                        <LoanTypeGroupBlock key={group.type} group={group} loanIndex={loanIndex} />
                      ))}
                    </div>
                  </div>
                )}
                {loanSections.others.length > 0 && (
                  <div>
                    <div className="mb-3 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-white shadow-sm">
                      Other Loan Accounts
                    </div>
                    <div className="space-y-5">
                      {loanSections.others.map((group) => (
                        <LoanTypeGroupBlock key={group.type} group={group} loanIndex={loanIndex} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Inquiries */}
          {inquiries.length > 0 && (
            <Section title="Inquiries (reported for past 24 months)">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Credit Grantor</TableHead>
                      <TableHead>Date of Inquiry</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Remark</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inquiries.map((inq, i) => (
                      <TableRow key={i}>
                        <TableCell>{inq['MEMBER-NAME']}</TableCell>
                        <TableCell className="tabular-nums">{inq['INQUIRY-DATE']}</TableCell>
                        <TableCell>{inq.PURPOSE}</TableCell>
                        <TableCell className="text-right tabular-nums">{inq.AMOUNT}</TableCell>
                        <TableCell>{inq.REMARK || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>
          )}
        </div>
    </>
  );
}

function VariationTable({ title, rows }: { title: string; rows: Array<{ VALUE: string; 'REPORTED-DATE': string }> }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{title}</div>
      <div className="max-h-48 overflow-y-auto rounded border border-primary/10 dark:border-sidebar-accent/40">
        <Table>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm">{r.VALUE}</TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">{r['REPORTED-DATE']}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const LOAN_STATUS_STYLE: Record<LoanRowStatus, { border: string; bg: string; badge: 'default' | 'destructive' | 'outline'; label: string }> = {
  active: { border: 'border-emerald-300 dark:border-emerald-800', bg: 'bg-emerald-50 dark:bg-emerald-950/20', badge: 'default', label: 'ACTIVE' },
  arrear: { border: 'border-red-500 dark:border-red-600', bg: 'bg-red-100 dark:bg-red-950/40', badge: 'destructive', label: 'ARREAR / OVERDUE' },
  closed: { border: 'border-slate-200 dark:border-slate-700', bg: 'bg-slate-50 dark:bg-slate-900/30', badge: 'outline', label: 'CLOSED' },
};

function ActiveLoanTypeTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<{ type: string; accounts: number; overdue: number; currentBalance: number; disbursedOrHighCredit: number; instlAmt: number; overdueAmt: number }>;
  total: { accounts: number; overdue: number; currentBalance: number; disbursedOrHighCredit: number; instlAmt: number; overdueAmt: number };
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-sm font-medium">{title}</div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Type</TableHead>
              <TableHead className="text-right">No. of Account(s)</TableHead>
              <TableHead className="text-right">Overdue Account(s)</TableHead>
              <TableHead className="text-right">Current Balance</TableHead>
              <TableHead className="text-right">Amt Disbd/High Credit</TableHead>
              <TableHead className="text-right">InstlAmt</TableHead>
              <TableHead className="text-right">Overdue Amt</TableHead>
              <TableHead className="text-right">Arrear Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.type}>
                <TableCell>{r.type}</TableCell>
                <TableCell className="text-right tabular-nums">{r.accounts}</TableCell>
                <TableCell className="text-right tabular-nums">{r.overdue}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInr(r.currentBalance)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInr(r.disbursedOrHighCredit)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInr(r.instlAmt)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInr(r.overdueAmt)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInr(r.overdueAmt)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{total.accounts}</TableCell>
              <TableCell className="text-right tabular-nums">{total.overdue}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(total.currentBalance)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(total.disbursedOrHighCredit)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(total.instlAmt)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(total.overdueAmt)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInr(total.overdueAmt)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Renders one ACCT-TYPE sub-heading (e.g. "JLG Individual") with its loans ordered Active, then Arrear (overdue), then Closed. */
function LoanTypeGroupBlock({ group, loanIndex }: { group: LoanTypeGroup; loanIndex: Map<CrifLoanDetails, number> }) {
  const ordered: Array<{ loan: CrifLoanDetails; status: LoanRowStatus }> = [
    ...group.active.map((loan) => ({ loan, status: 'active' as const })),
    ...group.arrear.map((loan) => ({ loan, status: 'arrear' as const })),
    ...group.closed.map((loan) => ({ loan, status: 'closed' as const })),
  ];
  if (ordered.length === 0) return null;

  return (
    <div>
      <div className="mb-2 inline-block rounded border-l-4 border-amber-500 bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-900 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-300">
        {group.type}
      </div>
      <div className="space-y-4">
        {ordered.map(({ loan, status }) => (
          <LoanCard key={loanIndex.get(loan)} index={loanIndex.get(loan) ?? 0} loan={loan} status={status} />
        ))}
      </div>
    </div>
  );
}

function LoanCard({ index, loan, status }: { index: number; loan: CrifLoanDetails; status: LoanRowStatus }) {
  const accountStatus = loan['ACCOUNT-STATUS'] || 'Unknown';
  const style = LOAN_STATUS_STYLE[status];
  const history = parsePaymentHistory(loan['COMBINED-PAYMENT-HISTORY']).slice(0, 12);

  return (
    <div className={`overflow-hidden rounded-md border ${style.border}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 ${style.bg}`}>
        <div className="flex items-center gap-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{index}</span>
          <span className="font-semibold">{loan['ACCT-TYPE']}</span>
          <span className="text-sm text-muted-foreground">{loan['CREDIT-GUARANTOR']}</span>
        </div>
        <Badge variant={style.badge}>{status === 'arrear' ? style.label : accountStatus.toUpperCase()}</Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 p-4 text-sm">
        <Field label="Account #" value={loan['ACCT-NUMBER']} />
        <Field label="Ownership" value={loan['OWNERSHIP-IND']} />
        <Field label="Credit Limit" value={formatInr(Number(loan['CREDIT-LIMIT']?.replace(/,/g, '')) || 0)} />
        <Field label="InstlAmt/Freq" value={loan['INSTALLMENT-AMT']} />
        <Field label="Disbursed Date" value={loan['DISBURSED-DT']} />
        <Field label="Last Payment Date" value={loan['LAST-PAYMENT-DATE']} />
        <Field label="Closed Date" value={loan['CLOSED-DATE']} />
        <Field label="Tenure" value={loan['REPAYMENT-TENURE']} />
        <Field label="Disbd Amt/High Credit" value={loan['DISBURSED-AMT']} />
        <Field label="Current Balance" value={loan['CURRENT-BAL']} />
        <Field label="Overdue Amt" value={loan['OVERDUE-AMT']} />
        <Field label="DPD" value={loan.DPD} />
        <Field label="Interest Rate" value={loan['INTEREST-RATE']} />
        <Field label="Total Writeoff Amt" value={loan['WRITE-OFF-AMT']} />
        <Field label="Settlement Amt" value={loan['SETTLEMENT-AMT']} />
        <Field label="Last Paid Amt" value={loan['LAST-PAID-AMOUNT']} />
      </div>
      {history.length > 0 && (
        <div className="border-t border-inherit px-4 py-3">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Payment History / Asset Classification (most recent first)</div>
          <div className="overflow-x-auto">
            <div className="flex gap-1">
              {history.map((h, i) => (
                <div key={i} className="flex min-w-14 flex-col items-center rounded border border-border/60 px-1.5 py-1 text-center text-[10px]">
                  <span className="text-muted-foreground">{h.month} {h.year}</span>
                  <span className="font-mono">{h.amount}/{h.classification}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
