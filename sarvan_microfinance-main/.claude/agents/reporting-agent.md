# Reporting Agent

## Role
Owns all reports, MIS, analytics, and data export functionality. Both the server-side data aggregation and the client-side display/export components.

## Responsibilities
- Server actions for report data aggregation
- Report page components (filter UI + table display)
- CSV and PDF export
- GL accounting reports (daybook, trial balance, GL ledger)
- Collection reports (CCR, DCR, DCB)
- Portfolio reports (PAR, OS branchwise/centerwise/clientwise, agewise arrears)
- Gold loan reports
- Demand sheet generation
- MIS reports

## Files Owned
```
app/lib/actions/reports.ts              # All 20+ report query functions (3800+ lines)
app/lib/actions/demand.ts               # Demand sheet data
app/lib/actions/branch-demand.ts        # Branch-level demand aggregation
app/lib/actions/future-demand.ts        # Projected demand
app/lib/reports/                        # Report utility functions (dcb, denomination, loan-collection)
app/api/reports/**                      # Report API endpoints (~60 routes)
app/api/mis-reports/**                  # MIS-specific endpoints
app/api/admin-reports/**                # Admin accounting reports
components/reports/**                   # 40+ report display components
components/mis-reports/**               # MIS report components
app/dashboard/reports/**               # Report page wrappers
app/dashboard/mis-reports/**           # MIS page wrappers
app/dashboard/admin-reports/**         # Admin report page wrappers
```

## Key Report Functions (in `app/lib/actions/reports.ts`)

| Function | Purpose |
|---|---|
| `getCCRData(centerId, from, till)` | Center Cash Receipt — per-client collection ledger |
| `getDCRData(dateStr)` | Daily Cash Receipt — center-wise day total |
| `getDCBData(from, till)` | Daily Center Balance — running balance per center |
| `getAgewiseArrearData(from, till)` | Portfolio arrear analysis by days overdue |
| `getMISAgewiseArrearData(reportType, from, till)` | MIS arrear (BRANCHWISE/CENTERWISE/FDOWISE/CLIENTWISE) |
| `getClientwiseDCBData(centerId, from, till)` | Per-client DCB |
| `getOSBranchwiseData(reportDate)` | Outstanding by branch |
| `getOSClientwiseData(from, till)` | Outstanding by client |
| `getDaybookData(from, till)` | Full GL transaction ledger |
| `getIndividualLedgerData(from, till)` | Per-ledger GL balance roll-up |
| `getLoanDisbursementData(from, till)` | Disbursement tracking |
| `getPortfolioAtRiskData(from, till)` | PAR report |
| `getPreclosureReportData(from, till)` | Early closure tracking |
| `getAllBranchDCBData(from, till)` | Multi-branch daily balance |
| `getLoanOSDetailsData(reportDate)` | Detailed outstanding positions |
| `getGoldTakenReport(from, to, branchId?)` | Gold pledge log |
| `getGoldReturnedReport(from, to, branchId?)` | Gold redemption log |

## Patterns

### Report page component structure
```typescript
'use client';
import { useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SomeReportPage() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    const result = await apiClient.get<Row[]>(`/api/reports/some?from=${fromDate}&to=${toDate}`);
    if (result.success && result.data) setData(result.data);
    setIsLoading(false);
  };

  const exportCSV = () => {
    const headers = ['Date', 'Amount'];
    const rows = data.map(r => [r.date, r.amount]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'report.csv'; a.click();
  };

  return (/* filter + table UI */);
}
```

### PDF export (dynamic import — avoid SSR issues)
```typescript
const exportPDF = async () => {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape' });
  autoTable(doc, {
    head: [['Date', 'Branch', 'Amount']],
    body: data.map(r => [r.date, r.branch, formatCurrency(r.amount)]),
    styles: { fontSize: 8 },
  });
  doc.save(`report-${new Date().toISOString().split('T')[0]}.pdf`);
};
```

### Currency / date helpers (always use these)
```typescript
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(n);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
```

### Filtering report queries to branch scope
```typescript
// Always filter by branchId when user is not ADMIN/HO
const branchFilter = user.isHeadOffice ? {} : { branchId: user.branchId };
const loans = await prisma.loan.findMany({ where: { ...branchFilter, disbursementStatus: 'DISBURSED' } });
```

## Common Tasks
- Add new report → create function in `reports.ts`, add API route in `app/api/reports/`, create component in `components/reports/`
- Add export to existing report → add CSV button with blob download; PDF with dynamic jsPDF import
- Filter by date range → pass `fromDate` / `toDate` as ISO strings, use `gte`/`lte` in Prisma `where`
- Branch-scope a report → check `user.isHeadOffice` to decide whether to filter by `branchId`
