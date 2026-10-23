# Skill: Form Validation Pattern

## What It Does
Standard pattern for forms in this project — local state + inline validation + apiClient submit + toast feedback. No React Hook Form needed for simple forms; use it only for complex multi-field forms.

## When To Use
Building any form in a component: create/edit dialogs, filter forms, configuration pages.

## Simple Form Pattern (most common)

```typescript
'use client';
import { useState, FormEvent } from 'react';
import { z } from 'zod';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

// 1. Define schema (same as API route schema — keeps them in sync)
const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount: z.number().positive('Amount must be positive'),
});

type FormData = z.infer<typeof formSchema>;

export function MyForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<FormData>>({
    name: '',
    amount: undefined,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const validate = (): boolean => {
    const result = formSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: typeof errors = {};
      result.error.errors.forEach(e => {
        if (e.path[0]) fieldErrors[e.path[0] as keyof FormData] = e.message;
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      const result = await apiClient.post('/api/endpoint', formData);
      if (result.success) {
        toast({ title: 'Success', description: 'Record saved successfully.' });
        onSuccess();
      } else {
        toast({ title: 'Error', description: result.error || 'Failed', variant: 'destructive' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Name <span className="text-red-500">*</span></Label>
        <Input
          id="name"
          value={formData.name ?? ''}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
          className={errors.name ? 'border-red-300' : ''}
        />
        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          type="number"
          value={formData.amount ?? ''}
          onChange={(e) => setFormData(prev => ({ ...prev, amount: Number(e.target.value) }))}
        />
        {errors.amount && <p className="text-xs text-red-500">{errors.amount}</p>}
      </div>

      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save
      </Button>
    </form>
  );
}
```

## Edit Form (pre-filled)
```typescript
// Pass existing data to pre-fill
export function EditForm({ item, onSuccess }: { item: FormData; onSuccess: () => void }) {
  const [formData, setFormData] = useState<Partial<FormData>>(item); // pre-fill from prop
  // ... rest same as above, but call apiClient.patch instead of post
}
```

## Select Field Pattern
```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

<Select
  value={formData.karatType ?? ''}
  onValueChange={(v) => setFormData(prev => ({ ...prev, karatType: v }))}
>
  <SelectTrigger className="h-9">
    <SelectValue placeholder="Select karat..." />
  </SelectTrigger>
  <SelectContent>
    {['24K', '22K', '20K', '18K', '16K'].map(k => (
      <SelectItem key={k} value={k}>{k}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

## Dialog Form Pattern (form inside a Dialog)
```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function ParentComponent() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add New</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Record</DialogTitle></DialogHeader>
          <MyForm onSuccess={() => { setOpen(false); refetch(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
```

## Confirmation Before Submit
```typescript
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

const [confirmOpen, setConfirmOpen] = useState(false);

// Replace direct submit with confirm gate
<Button onClick={() => setConfirmOpen(true)}>Disburse</Button>
<ConfirmationDialog
  open={confirmOpen}
  onOpenChange={setConfirmOpen}
  onConfirm={handleSubmit}
  title="Confirm Action"
  description="This action cannot be undone."
  confirmText="Confirm"
  type="info"
  isLoading={isLoading}
/>
```

## Rules
- Always show inline error messages under each field (not just a top-level alert)
- Always disable submit button while `isLoading`
- Always use `toast` for success/failure feedback — not `alert()`
- Date inputs: use `type="date"` and validate the string format (`YYYY-MM-DD`)
- Currency inputs: use `type="number"` with `step="0.01"` and `min="0"`
- Weight/gram inputs: use `type="number"` with `step="0.001"` for precision
