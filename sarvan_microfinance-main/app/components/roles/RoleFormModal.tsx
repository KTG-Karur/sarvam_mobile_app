'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/app/hooks/use-toast';

// ─── Types ───────────────────────────────────
interface Role {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  priority: number;
  isActive: boolean;
  isSystem: boolean;
  isSubAdmin: boolean;
  /** Base role code stored on User.role / JWT for everyone assigned this role.
   *  When the "FDO Responsibilities" toggle is on it is 'FDO'; otherwise an
   *  auto-generated code from the role name. */
  legacyRole?: string | null;
  parentRole: { id: string; name: string } | null;
}

// Mirrors computeRoleCode() in app/lib/rbac-role-sync.ts — used to restore a
// role's own code when the "FDO Responsibilities" toggle is switched back off.
function computeRoleCodeClient(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('');
}

interface RoleFormModalProps {
  role: Role | null;          // null = create mode
  allRoles: Role[];           // for parent role dropdown
  onSuccess: () => void;
  onClose: () => void;
}

// ─── Predefined colors ───────────────────────
const ROLE_COLORS = [
  { label: 'Red',    value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Teal',   value: '#14b8a6' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Pink',   value: '#ec4899' },
  { label: 'Gray',   value: '#6b7280' },
];

// ─── Auto-slug generator ─────────────────────
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

// ─── Modal ───────────────────────────────────
export function RoleFormModal({ role, allRoles, onSuccess, onClose }: RoleFormModalProps) {
  const isEdit = !!role;

  const [form, setForm] = useState({
    name: role?.name ?? '',
    slug: role?.slug ?? '',
    description: role?.description ?? '',
    color: role?.color ?? '#3b82f6',
    priority: String(role?.priority ?? 100),
    parentRoleId: role?.parentRole?.id ?? 'none',
    isActive: role?.isActive ?? true,
    isSubAdmin: role?.isSubAdmin ?? false,
    actsAsFdo: role?.legacyRole === 'FDO' && !role?.isSystem,
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-generate slug from name (only in create mode and not manually edited)
  useEffect(() => {
    if (!isEdit && !slugManuallyEdited && form.name) {
      setForm((prev) => ({ ...prev, slug: toSlug(form.name) }));
    }
  }, [form.name, isEdit, slugManuallyEdited]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Role name is required';
    if (!form.slug.trim()) newErrors.slug = 'Slug is required';
    if (!/^[a-z0-9-]+$/.test(form.slug)) newErrors.slug = 'Slug: only lowercase letters, numbers, hyphens';
    if (!form.priority || isNaN(Number(form.priority))) newErrors.priority = 'Priority must be a number';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim() || null,
        color: form.color,
        priority: Number(form.priority),
        parentRoleId: form.parentRoleId === 'none' ? undefined : form.parentRoleId,
        isActive: form.isActive,
        isSubAdmin: form.isSubAdmin,
        // "FDO Responsibilities" toggle → writes Role.legacyRole, which becomes
        // User.role / the JWT role claim for everyone assigned this role, so they
        // clear every gate the built-in FDO clears. Switching it back off restores
        // the role's own auto-generated code. System roles never send this.
        ...(role?.isSystem
          ? {}
          : form.actsAsFdo
            ? { legacyRole: 'FDO' }
            : isEdit && role?.legacyRole === 'FDO'
              ? { legacyRole: computeRoleCodeClient(form.name) }
              : {}),
      };

      const url = isEdit ? `/api/admin/roles/${role!.id}` : '/api/admin/roles';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        toast({ title: data.error ?? 'Failed to save role', variant: 'destructive' });
        return;
      }

      toast({
        title: isEdit ? 'Role updated successfully' : `Role "${data.role.name}" created successfully`,
      });
      onSuccess();
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Parent role options (exclude self and system admin)
  const parentOptions = allRoles.filter(
    (r) => r.id !== role?.id && r.isActive
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-green-50">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {isEdit ? 'Edit Role' : 'Create New Role'}
              </h2>
              <p className="text-sm text-gray-400">
                {isEdit ? `Editing "${role!.name}"` : 'Add a custom role to your organization'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Role Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">
              Role Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              placeholder="e.g., Gold Loan Officer, Senior Branch Manager"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className={errors.name ? 'border-red-400' : ''}
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <Label htmlFor="slug">
              Slug (unique identifier) <span className="text-red-500">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="slug"
                placeholder="gold-loan-officer"
                value={form.slug}
                onChange={(e) => {
                  setSlugManuallyEdited(true);
                  setForm((p) => ({ ...p, slug: e.target.value.toLowerCase() }));
                }}
                className={`font-mono text-sm ${errors.slug ? 'border-red-400' : ''}`}
                disabled={isEdit} // Slug cannot change after creation
              />
            </div>
            {errors.slug && <p className="text-xs text-red-500">{errors.slug}</p>}
            {isEdit && (
              <p className="text-xs text-gray-400">Slug cannot be changed after creation</p>
            )}
            {!isEdit && !slugManuallyEdited && form.slug && (
              <p className="text-xs text-gray-400">
                Auto-generated. Click to edit manually.
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              rows={2}
              placeholder="What does this role do?"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* Color + Priority row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Color */}
            <div className="space-y-1.5">
              <Label>Badge Color</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {ROLE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onClick={() => setForm((p) => ({ ...p, color: c.value }))}
                    className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                      form.color === c.value ? 'border-gray-800 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className="w-4 h-4 rounded-full border"
                  style={{ backgroundColor: form.color }}
                />
                <code className="text-xs text-gray-500">{form.color}</code>
              </div>
            </div>

            {/* Priority */}
            <div className="space-y-1.5">
              <Label htmlFor="priority">
                Priority
                <span className="ml-1 text-xs text-gray-400">(higher = more privileged)</span>
              </Label>
              <Input
                id="priority"
                type="number"
                min="0"
                max="1000"
                placeholder="100"
                value={form.priority}
                onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                className={errors.priority ? 'border-red-400' : ''}
              />
              {errors.priority && <p className="text-xs text-red-500">{errors.priority}</p>}
              <p className="text-xs text-gray-400">
                Admin=1000 · Area Manager=300 · Branch Manager=200 · FDO=100
              </p>
            </div>
          </div>

          {/* Parent Role */}
          <div className="space-y-1.5">
            <Label>Parent Role (optional)</Label>
            <Select
              value={form.parentRoleId}
              onValueChange={(v) => setForm((p) => ({ ...p, parentRoleId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="No parent (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No parent (top-level role)</SelectItem>
                {parentOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              Sub-roles inherit the hierarchy but NOT permissions (permissions are set separately).
            </p>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-gray-400">Inactive roles cannot be assigned to users</p>
            </div>
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, isActive: !p.isActive }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                form.isActive ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.isActive ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Sub Admin Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-100">
            <div>
              <p className="text-sm font-medium">Sub Admin</p>
              <p className="text-xs text-gray-400">
                Users with this role get the same page and API access as Admin (reverts,
                approvals, vouchers, etc.), except Admin-only screens such as the UCRF export.
                Their data is still limited to the branches of their base role.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, isSubAdmin: !p.isSubAdmin }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                form.isSubAdmin ? 'bg-red-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.isSubAdmin ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* FDO Responsibilities Toggle */}
          {!role?.isSystem && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-100">
              <div>
                <p className="text-sm font-medium">FDO Responsibilities</p>
                <p className="text-xs text-gray-400">
                  Users with this role can do everything a Field Development Officer
                  does — client enrollment &amp; KYC upload, loan application creation,
                  and collections for their own centers. Page checkboxes and priority
                  still apply on top.
                  {isEdit && (
                    <span className="mt-1 block text-amber-600">
                      Toggling this re-syncs already-assigned users; their current
                      session picks it up on the next token refresh (up to 72h) or on
                      re-login.
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, actsAsFdo: !p.actsAsFdo }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                  form.actsAsFdo ? 'bg-green-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    form.actsAsFdo ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          )}

          {/* Preview Badge */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-50 border">
            <p className="text-xs text-gray-500">Preview:</p>
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-white text-xs font-medium"
              style={{ backgroundColor: form.color || '#3b82f6' }}
            >
              <Shield className="h-3 w-3" />
              {form.name || 'Role Name'}
            </span>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 gap-2" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Role'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
