# UI Agent

## Role
Owns all React components, dashboard pages, UI patterns, and client-side state. Responsible for consistent design, accessibility, responsive layouts, and permission-aware rendering.

## Responsibilities
- React component architecture (feature components + shadcn primitives)
- Dashboard page wrappers
- Client-side data fetching patterns
- Form handling and validation
- Permission-aware rendering
- Responsive layout (mobile sidebar drawer, overflow fixes)
- Toast notifications
- Excel import/PDF export UI

## Files Owned
```
app/dashboard/**/*.tsx          # Thin page wrappers (import + render component only)
components/[domain]/**/*.tsx    # All feature components
components/ui/**                # shadcn primitives (button, card, table, dialog, etc.)
components/layout/              # Header, sidebar, user menu
components/sidebar/             # Navigation items
app/hooks/usePermission.ts      # UI permission gating
app/hooks/use-toast.ts          # Toast state
app/globals.css                 # Tailwind theme tokens (OKLch colors)
lib/utils.ts                    # cn() helper
```

## Patterns

### Dashboard page (thin wrapper — no logic here)
```typescript
// app/dashboard/[domain]/[feature]/page.tsx
import { FeatureComponent } from '@/components/[domain]/FeatureComponent';
import { DashboardFooter } from '@/components/layout/DashboardFooter';

export default function FeaturePageRoute() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <FeatureComponent />
      <DashboardFooter />
    </div>
  );
}
```

### Feature component data fetch
```typescript
'use client';
import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

export function FeatureComponent() {
  const { toast } = useToast();
  const [data, setData] = useState<DataType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const result = await apiClient.get<DataType[]>('/api/endpoint');
    if (result.success && result.data) setData(result.data);
    else toast({ title: 'Error', description: result.error, variant: 'destructive' });
    setIsLoading(false);
  };
  // ...
}
```

### Card + Table layout (most common)
```typescript
<Card className="border border-slate-200 shadow-sm dark:border-slate-800">
  <CardHeader className="flex flex-row items-center justify-between">
    <CardTitle>Section Title</CardTitle>
    <Button className="bg-blue-600 hover:bg-blue-700">
      <Plus className="mr-2 h-4 w-4" /> Add New
    </Button>
  </CardHeader>
  <CardContent className="p-0">
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50 dark:bg-slate-800/50">
          <TableHead>Column</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>{item.name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </CardContent>
</Card>
```

### Multiple sibling rows in map (key on Fragment, NOT on bare `<>`)
```typescript
// CORRECT
{items.map((item) => (
  <React.Fragment key={item.id}>
    <TableRow>...</TableRow>
    {expanded && <TableRow key={`${item.id}-detail`}>...</TableRow>}
  </React.Fragment>
))}

// WRONG — React warning: key prop missing
{items.map((item) => (
  <>
    <TableRow key={item.id}>...</TableRow>
  </>
))}
```

### Permission gating
```typescript
const { can, canPage } = usePermission();

// Hide entire section
{can('loan', 'approve') && <ApproveButton />}

// Disable input
<Input disabled={!can('client', 'edit')} />

// Page-level action (configured in admin panel)
{canPage('/dashboard/disbursement', 'add') && <DisburseButton />}
```

### Toast (always useToast, never alert/confirm)
```typescript
const { toast } = useToast();
toast({ title: 'Success', description: 'Record saved.' });
toast({ title: 'Error', description: error.message, variant: 'destructive' });
```

### Currency formatting
```typescript
const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(n);
// e.g. formatCurrency(125000) → "1,25,000.00"
```

### Date formatting
```typescript
const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
// e.g. "02 Jun 2026"
```

### cn() for conditional classes
```typescript
import { cn } from '@/lib/utils';
<div className={cn("base-class", isActive && "active-class", isError && "error-class")} />
```

### Excel import (shared pattern)
```typescript
import * as XLSX from 'xlsx';
const buffer = await file.arrayBuffer();
const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false });
```

### PDF export (dynamic import to avoid SSR issues)
```typescript
const { jsPDF } = await import('jspdf');
const autoTable = (await import('jspdf-autotable')).default;
const doc = new jsPDF();
autoTable(doc, { head: [headers], body: rows });
doc.save(`report-${new Date().toISOString().split('T')[0]}.pdf`);
```

## Shadcn Components Available
`button card input label select switch table badge dialog dropdown-menu sheet tabs radio-group checkbox toast toaster tooltip skeleton avatar confirmation-dialog password-input`

## Common Tasks
- Add new page → create thin wrapper in `app/dashboard/[domain]/`, create component in `components/[domain]/`
- Add form field → use `Input` / `Select` from `components/ui/`, hook to local state
- Add table column → add `TableHead` + `TableCell`, no external state needed
- Mobile layout → use `md:` breakpoint; sidebar is already drawer-based on mobile
- Add confirmation → use `ConfirmationDialog` from `components/ui/confirmation-dialog`
- Report page → use `Card` layout, add date filter inputs, CSV/PDF export buttons
