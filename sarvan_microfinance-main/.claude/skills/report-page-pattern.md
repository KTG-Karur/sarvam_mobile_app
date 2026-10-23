# Skill: Report Page Pattern

## What It Does
Standard structure for a report page: date range filter, data fetch, table display, and CSV/PDF export. Used across 60+ report pages in this project.

## When To Use
Creating or extending any report page under `components/reports/`, `components/mis-reports/`, or `components/admin-reports/`.

## Full Template

```typescript
'use client';
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, FileText } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

type Row = {
  date: string;
  clientName: string;
  loanNumber: string;
  amount: number;
  status: string;
};

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(n);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function getDefaultDates() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    from: firstOfMonth.toISOString().split('T')[0],
    to: today.toISOString().split('T')[0],
  };
}

export function MyReportPage() {
  const { toast } = useToast();
  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [data, setData] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchReport = async () => {
    if (!fromDate || !toDate) {
      toast({ title: 'Error', description: 'Select both dates', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    const result = await apiClient.get<Row[]>(`/api/reports/my-report?from=${fromDate}&to=${toDate}`);
    if (result.success && result.data) {
      setData(result.data);
      setHasFetched(true);
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to load', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const exportCSV = () => {
    const headers = ['Date', 'Client', 'Loan No', 'Amount', 'Status'];
    const rows = data.map(r => [r.date, r.clientName, r.loanNumber, r.amount, r.status]);
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-report-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('My Report', 14, 15);
    doc.setFontSize(9);
    doc.text(`Period: ${fromDate} to ${toDate}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [['#', 'Date', 'Client', 'Loan No', 'Amount', 'Status']],
      body: data.map((r, i) => [i + 1, r.date, r.clientName, r.loanNumber, formatCurrency(r.amount), r.status]),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
    });
    doc.save(`my-report-${fromDate}.pdf`);
  };

  // Summary totals
  const totalAmount = data.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Report</h1>
          <p className="text-sm text-muted-foreground">View and export report data</p>
        </div>
        {hasFetched && data.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF}>
              <FileText className="mr-1.5 h-3.5 w-3.5" /> PDF
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-40" />
            </div>
            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isLoading ? 'Loading...' : 'Generate Report'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {hasFetched && (
        <div className="flex gap-4">
          <div className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-900/20 text-center">
            <p className="text-xs text-muted-foreground">Records</p>
            <p className="text-2xl font-bold">{data.length}</p>
          </div>
          <div className="p-4 rounded-lg border bg-emerald-50 dark:bg-emerald-900/20 text-center">
            <p className="text-xs text-muted-foreground">Total Amount</p>
            <p className="text-2xl font-bold">₹{formatCurrency(totalAmount)}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {hasFetched && (
        <Card>
          <CardHeader><CardTitle className="text-base">Results ({data.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.length === 0 ? (
              <p className="text-center text-muted-foreground py-10">No data for selected period</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-800/50">
                      <TableHead>#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Loan No</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>{formatDate(row.date)}</TableCell>
                        <TableCell>{row.clientName}</TableCell>
                        <TableCell className="font-mono text-xs">{row.loanNumber}</TableCell>
                        <TableCell className="text-right font-medium">₹{formatCurrency(row.amount)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

## Rules
- Always default date range to current month
- Show record count + total amount as summary cards above the table
- Show export buttons only after data is fetched (`hasFetched && data.length > 0`)
- Use `overflow-x-auto` on the table container for mobile
- PDF: always dynamic import; always landscape for wide tables
- CSV: include BOM (`﻿`) for correct Indian character encoding in Excel
- Use `<ExportDropdown>` from `components/reports/ExportDropdown.tsx` instead of hand-rolling export buttons — see "Async export queue" below for when to also wire `reportSlug`

## Async export queue (Request Report)

Newer reports route their Excel/PDF/CSV export through an async background queue instead of generating the file in the browser — the user gets a queued request they can track/download from `/dashboard/reports/request-report`, rather than blocking the tab on a large export. This is now the preferred pattern for **new** reports; existing reports keep their client-side export path until explicitly migrated.

**Fit test — a report belongs in `REPORT_REGISTRY` only if all three hold:**
1. Its export is a single flat table (`{ headers, rows }`) — not a multi-sheet Excel workbook.
2. It's filtered by date range, a single date, or no date at all, plus branch scope (`branchId`/`branchIds`) — not a per-record drill-down (a specific loan's schedule, a specific loan-index batch).
3. Any extra selector (center, report-type variant, id-type) can be expressed as `filters: Record<string, string>` on the request.

If a report fails any of these — multi-sheet output, single-record snapshot dump (e.g. Company Profile), or a required non-date/branch identifier — leave it on the plain client-side export path in this skill's main template; forcing it into the registry produces a worse export than what already exists.

**Wiring a report that fits:**
1. If the report's data-fetch logic lives inline in its API route, extract it into a shared function under `app/lib/reports/queries/*.ts` (or reuse an existing exported function from `app/lib/actions/reports.ts` if one exists) — the API route and the registry adapter must call the *same* function so they can never diverge on what counts as matching data.
2. Add a `fetch` adapter + entry to `app/lib/reports/report-registry.ts`'s `REPORT_REGISTRY`, giving it a `slug`, `dateMode` (`'RANGE' | 'SINGLE' | 'NONE'`), and a `navHref` pointing at the report's live page (used by the permission seeder to default `canExport` from that page's current `allowedRoles`).
3. In the component, add `usePermission()` → `canExportReport(slug)`, and pass `reportSlug`, `canExport`, and `exportParams={{ fromDate, toDate, branchIds, filters }}` to `<ExportDropdown>`. `onExportWord` stays wired to the existing client-side Word handler regardless — the queue only covers Excel/PDF/CSV.
4. Re-run `npx tsx prisma/seed-report-permissions.ts` so the new slug gets default `ReportPermission` rows for every role (idempotent — never overwrites hand-tuned permissions).

Server Actions in `app/lib/actions/reports.ts` that call `getServerActionUser()` (cookie-based auth) need an optional `preResolvedBranchIds?: string[] | null` parameter so the background worker — which has no HTTP/cookie context — can bypass that lookup: `if (preResolvedBranchIds !== undefined) { branchIds = preResolvedBranchIds } else { /* existing cookie-based resolution */ }`. Omitting the param preserves the original client-component behavior exactly.
