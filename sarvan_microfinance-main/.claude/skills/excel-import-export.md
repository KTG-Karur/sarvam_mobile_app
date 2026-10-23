# Skill: Excel Import / Export Pattern

## What It Does
Standard patterns for Excel file upload (bulk import) and CSV/PDF export used throughout the project.

## When To Use
- Adding bulk upload to a master page (clients, centers, branches, loan products)
- Adding CSV or PDF download to a report or table

---

## Excel Import (Upload + Parse)

### API route (bulk upload endpoint)
```typescript
// app/api/[domain]/upload/route.ts
import * as XLSX from 'xlsx';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() { return handleCorsPreflight(); }

// Column name → field name mapping
const COLUMN_MAP: Record<string, string> = {
  'Name': 'name',
  'Mobile Number': 'mobileNumber',
  'Amount': 'amount',
};

export async function POST(request: NextRequest) {
  return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
    try {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      if (!file) return errorResponse('No file uploaded', 400);

      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false }) as Record<string, unknown>[];

      const results = { success: 0, skipped: 0, errors: [] as string[] };

      for (const row of rawRows) {
        // Map columns
        const mapped: Record<string, unknown> = {};
        for (const [col, field] of Object.entries(COLUMN_MAP)) {
          mapped[field] = row[col];
        }

        // Validate required fields
        if (!mapped.name) { results.skipped++; results.errors.push(`Row missing name`); continue; }

        try {
          await prisma.model.create({
            data: { ...mapped, branchId: user.branchId!, createdById: user.userId } as any,
          });
          results.success++;
        } catch {
          results.skipped++;
        }
      }

      return successResponse(results, `Imported ${results.success} records`);
    } catch (error: any) {
      return errorResponse(error.message || 'Upload failed', 500);
    }
  })(request);
}
```

### Frontend upload component
```typescript
import { useRef } from 'react';
import { apiClient } from '@/app/lib/api-client';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';

function UploadButton({ onComplete }: { onComplete: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const result = await apiClient.post('/api/domain/upload', formData);
    if (result.success) {
      toast({ title: 'Upload Complete', description: `${result.data.success} records imported` });
      onComplete();
    } else {
      toast({ title: 'Upload Failed', description: result.error, variant: 'destructive' });
    }
    e.target.value = ''; // reset input
  };

  return (
    <>
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <Upload className="mr-2 h-4 w-4" /> Upload Excel
      </Button>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleFileChange} />
    </>
  );
}
```

### Template download (generate empty Excel template)
```typescript
const downloadTemplate = () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Mobile Number', 'Amount'],  // headers only
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'upload-template.xlsx');
};
```

---

## CSV Export

```typescript
const exportCSV = (data: Row[], filename: string) => {
  const headers = ['Date', 'Client Name', 'Amount', 'Status'];
  const rows = data.map(r => [r.date, r.clientName, r.amount, r.status]);
  
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
```

---

## PDF Export (dynamic import — always async)

```typescript
const exportPDF = async (data: Row[], title: string) => {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ orientation: data.length > 5 ? 'landscape' : 'portrait' });

  // Title
  doc.setFontSize(14);
  doc.text(title, 14, 15);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [['#', 'Date', 'Client', 'Amount']],
    body: data.map((r, i) => [i + 1, r.date, r.clientName, formatCurrency(r.amount)]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [59, 130, 246], textColor: 255 }, // blue header
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
};
```

## Rules
- Excel upload: always use `FormData` (not JSON) — `apiClient` handles it automatically
- CSV: include BOM (`﻿`) so Excel opens it correctly with Indian characters
- PDF: always dynamic import (`await import('jspdf')`) — jsPDF is not SSR-safe
- Always reset file input (`e.target.value = ''`) after upload so the same file can be re-uploaded
- Column mapping: define `COLUMN_MAP` at top of route file for maintainability

## Report export: client-side vs async queue

The CSV/PDF export patterns above run entirely in the browser and are still the default for most report pages — use them as-is for a new report unless told otherwise.

For reports that fit the async **Request Report** queue (single flat table, date-range/single-date/none + branch scope, no required per-record identifier), export instead goes through `POST /api/report-requests` and a background worker builds the file server-side — see the "Async export queue" section in `.claude/skills/report-page-pattern.md` for the fit test and wiring steps. Don't duplicate that logic here; this file stays the reference for the plain client-side upload/export patterns.
