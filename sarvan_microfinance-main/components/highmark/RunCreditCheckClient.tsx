'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { ShieldCheck, Loader2, BadgeCheck, History, Maximize2, Download } from 'lucide-react';
import type { HighmarkReportSummary } from './types';
import { HighmarkFullReportDialog } from './HighmarkFullReportDialog';
import { buildHighmarkReportPdf } from '@/app/lib/reports/highmark-report-pdf';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { toDisplayDateTime } from '@/app/lib/date-format';

export function RunCreditCheckClient() {
  const { toast } = useToast();
  const user = tokenStorage.getUser();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<HighmarkReportSummary | null>(null);
  const [reused, setReused] = useState(false);
  const [history, setHistory] = useState<HighmarkReportSummary[]>([]);

  useEffect(() => {
    if (!/^\d{12}$/.test(aadhaar)) { setHistory([]); return; }
    apiClient.get<HighmarkReportSummary[]>(`/highmark/history?aadhaar=${aadhaar}`).then((res) => {
      if (res.success && res.data) setHistory(res.data);
    });
  }, [aadhaar]);

  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(history);

  if (user?.role !== 'BRANCH_MANAGER' && user?.role !== 'FDO') {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        This page is only accessible to Branch Managers and FDOs.
      </div>
    );
  }

  const isValid = firstName.trim().length > 0 && /^\d{12}$/.test(aadhaar) && /^\d{10}$/.test(phone) && consent;

  async function handleCheck() {
    setIsChecking(true);
    setResult(null);
    try {
      const res = await apiClient.post<HighmarkReportSummary>('/highmark/check', {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        aadhaar,
        phone,
        consentObtained: consent,
      });
      if (res.success && res.data) {
        setResult(res.data);
        setReused(!!res.message?.startsWith('Reused'));
        setHistory((h) => [res.data as HighmarkReportSummary, ...h.filter((x) => x.id !== res.data!.id)]);
        toast({ title: 'Highmark report ready', description: res.message });
      } else {
        toast({ title: 'Could not run Highmark check', description: res.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Could not run Highmark check', description: error.message, variant: 'destructive' });
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Highmark Check"
        description="Pull a Highmark (CRIF) credit report before enrollment — reuses a recent report for the same Aadhaar when one exists."
      />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="As per Aadhaar" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aadhaar">Aadhaar number</Label>
              <Input
                id="aadhaar"
                value={aadhaar}
                onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="12 digits"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10 digits"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 pt-2">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <Label htmlFor="consent" className="text-sm font-normal leading-snug">
              The client has given explicit consent for a Highmark check to be run on their behalf.
            </Label>
          </div>

          <Button onClick={handleCheck} disabled={!isValid || isChecking} className="w-full sm:w-auto">
            {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Run Highmark Check
          </Button>
        </CardContent>
      </Card>

      {!result && history.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
              <div className="text-sm font-medium">Previous Highmark checks for this Aadhaar</div>
              <TableSearchInput
                value={tableSearchQuery}
                onChange={setTableSearchQuery}
                placeholder="Search history..."
              />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pulled at</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchedRows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{toDisplayDateTime(new Date(h.pulledAt))}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{h.creditScore ?? '—'}</TableCell>
                      <TableCell><Badge variant={h.status === 'Completed' ? 'default' : 'destructive'}>{h.status}</Badge></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => { setResult(h); setReused(true); }}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {result && <CreditReportResult report={result} reused={reused} />}
    </div>
  );
}

export function CreditReportResult({ report, reused }: { report: HighmarkReportSummary; reused?: boolean }) {
  const [isFullViewOpen, setIsFullViewOpen] = useState(false);
  const { hasAnyRole } = usePermission();
  // BM/FDO can view the report but must not be able to download it as a PDF.
  const canDownload = !hasAnyRole(['branch-manager', 'fdo']);
  const json = report.reportJson as any;
  const errorMessage: string | undefined = report.status !== 'Completed' ? json?.error : undefined;
  const primary = json?.['ACCOUNTS-SUMMARY']?.['PRIMARY-ACCOUNTS-SUMMARY'];
  const derived = json?.['ACCOUNTS-SUMMARY']?.['DERIVED-ATTRIBUTES'];
  const loans: any[] = json?.RESPONSES?.RESPONSE?.map((r: any) => r['LOAN-DETAILS']).filter(Boolean) ?? [];
  const inquiries: any[] = json?.['INQUIRY-HISTORY']?.HISTORY
    ? Array.isArray(json['INQUIRY-HISTORY'].HISTORY) ? json['INQUIRY-HISTORY'].HISTORY : [json['INQUIRY-HISTORY'].HISTORY]
    : [];

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-3xl font-bold tabular-nums">{report.creditScore ?? '—'}</div>
          <Badge variant={reused ? 'secondary' : 'default'}>
            {reused ? <History className="h-3 w-3" /> : <BadgeCheck className="h-3 w-3" />}
            {reused ? 'Reused recent report — no charge' : `Charged ₹${Number(report.creditsCharged).toFixed(2)}`}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            Pulled {toDisplayDateTime(new Date(report.pulledAt))} · {report.providerReference}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsFullViewOpen(true)}>
              <Maximize2 className="mr-2 h-4 w-4" />
              Full View
            </Button>
            {canDownload && (
              <Button variant="outline" size="sm" onClick={() => buildHighmarkReportPdf(report)}>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            )}
          </div>
        </div>

        <HighmarkFullReportDialog isOpen={isFullViewOpen} onOpenChange={setIsFullViewOpen} report={report} />

        {errorMessage && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {primary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="Total accounts" value={primary['PRIMARY-NUMBER-OF-ACCOUNTS']} />
            <Stat label="Active accounts" value={primary['PRIMARY-ACTIVE-NUMBER-OF-ACCOUNTS']} />
            <Stat label="Overdue accounts" value={primary['PRIMARY-OVERDUE-NUMBER-OF-ACCOUNTS']} />
            <Stat label="Inquiries (6mo)" value={derived?.['INQURIES-IN-LAST-SIX-MONTHS']} />
          </div>
        )}

        {loans.length > 0 && (
          <div className="overflow-x-auto">
            <div className="text-sm font-medium mb-2">Loan accounts</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lender</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Disbursed</TableHead>
                  <TableHead className="text-right">Current bal.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map((loan, i) => (
                  <TableRow key={i}>
                    <TableCell>{loan['CREDIT-GUARANTOR']}</TableCell>
                    <TableCell>{loan['ACCT-TYPE']}</TableCell>
                    <TableCell>
                      <Badge variant={loan['ACCOUNT-STATUS'] === 'Active' ? 'default' : 'outline'}>{loan['ACCOUNT-STATUS']}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">₹{loan['DISBURSED-AMT']}</TableCell>
                    <TableCell className="text-right tabular-nums">₹{loan['CURRENT-BAL']}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {inquiries.length > 0 && (
          <div className="overflow-x-auto">
            <div className="text-sm font-medium mb-2">Recent inquiries</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lender</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inquiries.map((inq, i) => (
                  <TableRow key={i}>
                    <TableCell>{inq['MEMBER-NAME']}</TableCell>
                    <TableCell>{inq['PURPOSE']}</TableCell>
                    <TableCell className="text-right tabular-nums">₹{inq['AMOUNT']}</TableCell>
                    <TableCell className="text-right tabular-nums">{inq['INQUIRY-DATE']}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value ?? '—'}</div>
    </div>
  );
}
