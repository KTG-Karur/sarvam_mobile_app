// ============================================================
// FIELD PERMISSION — Field-level access control component
// app/components/rbac/FieldPermission.tsx
//
// Usage:
//   <FieldPermission module="loan" field="aadhaarNumber">
//     {({ access }) => (
//       access === 'HIDDEN' ? null :
//       access === 'MASKED' ? <MaskedInput value={value} /> :
//       access === 'READONLY' ? <span>{value}</span> :
//       <Input value={value} onChange={...} />
//     )}
//   </FieldPermission>
// ============================================================

'use client';

import { usePermission } from '@/app/hooks/usePermission';

type FieldAccess = 'VISIBLE' | 'READONLY' | 'HIDDEN' | 'MASKED';

interface FieldPermissionProps {
  module: string;
  field: string;
  children: (props: { access: FieldAccess }) => React.ReactNode;
}

export function FieldPermission({ module, field, children }: FieldPermissionProps) {
  const { getFieldAccess } = usePermission();
  const access = getFieldAccess(module, field) as FieldAccess;

  if (access === 'HIDDEN') return null;

  return <>{children({ access })}</>;
}

// ─────────────────────────────────────────────
// MASKED VALUE — Shows partially hidden data
// e.g., AADHAAR: XXXX-XXXX-1234
// ─────────────────────────────────────────────
interface MaskedValueProps {
  value: string;
  visibleChars?: number; // Number of chars to show at end
  maskChar?: string;
}

export function MaskedValue({
  value,
  visibleChars = 4,
  maskChar = '●',
}: MaskedValueProps) {
  if (!value) return <span>—</span>;

  const visible = value.slice(-visibleChars);
  const masked = maskChar.repeat(Math.max(0, value.length - visibleChars));

  return (
    <span className="font-mono tracking-wider">
      {masked}{visible}
    </span>
  );
}
