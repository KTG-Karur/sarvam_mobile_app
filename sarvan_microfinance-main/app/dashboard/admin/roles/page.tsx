'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Shield, Users, Edit, Trash2, Copy, ToggleLeft, ToggleRight, ChevronRight, Lock, AlertCircle } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RoleFormModal } from '@/app/components/roles/RoleFormModal';
import { toast } from '@/app/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';

// ─── Protected Role Slugs (mirrors backend PROTECTED_ROLE_SLUGS) ─────────────
// These roles cannot be deleted or deactivated — they are critical to the system.
const PROTECTED_ROLE_SLUGS = new Set([
  'admin',
  'area-manager',
  'branch-manager',
  'fdo',
  'quality-checkers',             // renamed from background-verification-team
  'background-verification-team', // legacy slug — kept for backward compat
  'background-verification',      // legacy alias
]);

const isProtectedRole = (role: Role) =>
  role.isSystem || PROTECTED_ROLE_SLUGS.has(role.slug);

// A non-system role whose legacyRole is 'FDO' has the "FDO Responsibilities"
// toggle on — its users act as a Field Development Officer.
const hasFdoResponsibilities = (role: Role) =>
  !role.isSystem && role.legacyRole === 'FDO';

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
  // Base role code this role acts as for every legacy role gate. Editable via
  // the "Acts As" selector in RoleFormModal (blank/auto = its own role).
  legacyRole?: string | null;
  // Page-level permissions configured via the Admin → Manage Permissions UI.
  // Format: { "/dashboard/client/kyc-update": { view: boolean, add: boolean, ... }, ... }
  // null = not configured (fallback to legacy allowedRoles)
  pagePermissions: Record<string, Record<string, boolean> | boolean> | null;
  parentRole: { id: string; name: string } | null;
  childRoles: { id: string; name: string }[];
  _count: { userRoles: number; permissions: number };
}

// Count how many pages have view: true in pagePermissions
function countVisiblePages(perms: Role['pagePermissions']): number {
  if (!perms) return 0;
  return Object.values(perms).filter((v) => {
    if (typeof v === 'object' && v !== null) return (v as Record<string, boolean>).view === true;
    return v === true;
  }).length;
}

// ─── Page ───────────────────────────────────
export default function RolesPage() {
  const router = useRouter();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<Role | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloning, setCloning] = useState(false);
  // ── Read role from tokenStorage (populated by login form) ──
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const user = tokenStorage.getUser();
    setUserRole(user?.role ?? null);
  }, []);

  // userRole === null means still loading from localStorage; treat as non-admin only once loaded
  const isNonAdmin = userRole !== null && userRole !== 'ADMIN';

  // ── Admin-only guard — redirect ──
  useEffect(() => {
    if (isNonAdmin) {
      router.replace('/dashboard?error=insufficient_permissions');
    }
  }, [isNonAdmin, router]);

  // ── Fetch roles (must be defined before useEffect that calls it) ──
  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/roles');
      const data = await res.json();
      if (data.success) setRoles(data.roles);
    } catch {
      toast({ title: 'Error', description: 'Failed to load roles', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch when the user is confirmed admin (userRole loaded and is ADMIN)
  useEffect(() => {
    if (userRole === 'ADMIN') {
      fetchRoles();
    }
  }, [userRole, fetchRoles]);

  // ── Early return after all hooks ──
  if (isNonAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-gray-500">
        <Lock className="h-12 w-12 text-red-300" />
        <p className="text-lg font-medium">Access Restricted</p>
        <p className="text-sm">Only Administrators can manage roles.</p>
      </div>
    );
  }

  const filteredRoles = roles.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.slug.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleActive = async (role: Role) => {
    // Protected roles cannot be deactivated
    if (isProtectedRole(role) && role.isActive) {
      toast({
        title: 'Protected role cannot be deactivated',
        description: `"${role.name}" is a system-protected role. It can only be renamed or recolored.`,
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !role.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        setRoles((prev) => prev.map((r) => r.id === role.id ? { ...r, isActive: !r.isActive } : r));
        toast({ title: `Role ${!role.isActive ? 'activated' : 'deactivated'}` });
      } else {
        toast({ title: data.error || 'Failed to update role', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    }
  };

  const handleDelete = async (role: Role) => {
    if (isProtectedRole(role)) {
      toast({
        title: 'Protected role cannot be deleted',
        description: `"${role.name}" is a system-protected role and cannot be removed.`,
        variant: 'destructive',
      });
      return;
    }
    if (role._count.userRoles > 0) {
      toast({
        title: 'Cannot delete',
        description: `${role._count.userRoles} user(s) assigned. Remove them first.`,
        variant: 'destructive',
      });
      return;
    }
    setDeleteTarget(role);
  };

  const confirmDelete = async () => {
    const role = deleteTarget;
    if (!role) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setRoles((prev) => prev.filter((r) => r.id !== role.id));
        toast({ title: 'Role deleted' });
      } else {
        toast({ title: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleClone = (role: Role) => {
    setCloneName('');
    setCloneTarget(role);
  };

  const confirmClone = async () => {
    const role = cloneTarget;
    const newName = cloneName;
    if (!role || !newName.trim()) return;
    setCloning(true);

    const newSlug = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    try {
      const res = await fetch(`/api/admin/roles/${role.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), slug: newSlug }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: `Role cloned with ${data.clonedPermissions} permissions` });
        fetchRoles();
        setCloneTarget(null);
      } else {
        toast({ title: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' });
    } finally {
      setCloning(false);
    }
  };

  const openCreate = () => { setEditingRole(null); setShowForm(true); };
  const openEdit = (role: Role) => { setEditingRole(role); setShowForm(true); };

  const handleFormSuccess = () => {
    setShowForm(false);
    fetchRoles();
  };

  return (
    <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Role Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage dynamic roles. Assign permissions and users to each role.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create Role
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Roles</p>
                <p className="text-2xl font-bold">{roles.length}</p>
              </div>
              <Shield className="h-8 w-8 text-green-100 fill-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Active Roles</p>
                <p className="text-2xl font-bold text-green-600">
                  {roles.filter((r) => r.isActive).length}
                </p>
              </div>
              <ToggleRight className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Custom Roles</p>
                <p className="text-2xl font-bold text-purple-600">
                  {roles.filter((r) => !r.isSystem).length}
                </p>
              </div>
              <Users className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roles Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>All Roles</CardTitle>
            <Input
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <PageLoader fullScreen={false} />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-400">
                      No roles found. Click &ldquo;Create Role&rdquo; to add one.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRoles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {role.color && (
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: role.color }}
                            />
                          )}
                          <div>
                            <p className="font-medium">{role.name}</p>
                            {role.description && (
                              <p className="text-xs text-gray-400 truncate max-w-[200px]">
                                {role.description}
                              </p>
                            )}
                            {role.parentRole && (
                              <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                                <ChevronRight className="h-3 w-3" />
                                <span>{role.parentRole.name}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5">
                          {role.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{role.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const pageCount = countVisiblePages(role.pagePermissions);

                          // ── Page permissions configured AND has visible pages ──
                          if (role.pagePermissions !== null && pageCount > 0) {
                            return (
                              <Badge
                                variant="secondary"
                                className="gap-1 bg-green-50 text-sidebar-accent border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300"
                              >
                                {pageCount} pages
                              </Badge>
                            );
                          }

                          // ── Page permissions configured but 0 pages have view:true ──
                          if (role.pagePermissions !== null && pageCount === 0) {
                            return (
                              <button
                                onClick={() => window.location.href = `/dashboard/admin/roles/${role.id}/permissions`}
                                className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                                title="Page permissions are configured but no pages have view access enabled"
                              >
                                <AlertCircle className="h-3 w-3" />
                                0 Pages — Assign
                              </button>
                            );
                          }

                          // ── Legacy module-level permissions (RolePermission records) ──
                          if (role._count.permissions > 0) {
                            return (
                              <Badge variant="secondary" className="gap-1">
                                {role._count.permissions} modules
                              </Badge>
                            );
                          }

                          // ── Nothing configured at all — prompt admin to assign pages ──
                          return (
                            <button
                              onClick={() => window.location.href = `/dashboard/admin/roles/${role.id}/permissions`}
                              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                              title="No pages assigned yet. Click to configure page permissions for this role."
                            >
                              <AlertCircle className="h-3 w-3" />
                              Assign Pages
                            </button>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <Users className="h-3.5 w-3.5" />
                          {role._count.userRoles}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            className={
                              role.isActive
                                ? 'bg-green-100 text-green-700 border-green-200'
                                : 'bg-gray-100 text-gray-500 border-gray-200'
                            }
                          >
                            {role.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          {role.isSystem && (
                            <Badge className="bg-green-50 text-primary border-primary/30 text-xs">
                              System
                            </Badge>
                          )}
                          {!role.isSystem && PROTECTED_ROLE_SLUGS.has(role.slug) && (
                            <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs gap-1">
                              <Lock className="h-3 w-3" />
                              Protected
                            </Badge>
                          )}
                          {role.isSubAdmin && (
                            <Badge className="bg-red-50 text-red-700 border-red-200 text-xs">
                              Sub Admin
                            </Badge>
                          )}
                          {hasFdoResponsibilities(role) && (
                            <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">
                              FDO Responsibilities
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(role)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => window.location.href = `/dashboard/admin/roles/${role.id}/permissions`}
                            >
                              <Shield className="h-4 w-4 mr-2" />
                              Manage Permissions
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleClone(role)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Clone Role
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {/* Deactivate — hidden for protected roles (can't deactivate them) */}
                            {!isProtectedRole(role) && (
                              <DropdownMenuItem onClick={() => handleToggleActive(role)}>
                                {role.isActive ? (
                                  <><ToggleLeft className="h-4 w-4 mr-2" />Deactivate</>
                                ) : (
                                  <><ToggleRight className="h-4 w-4 mr-2" />Activate</>
                                )}
                              </DropdownMenuItem>
                            )}
                            {/* Delete — hidden for protected & system roles; disabled while employees are assigned */}
                            {!isProtectedRole(role) && (
                              <DropdownMenuItem
                                onClick={() => handleDelete(role)}
                                disabled={role._count.userRoles > 0}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {role._count.userRoles > 0
                                  ? `Delete (${role._count.userRoles} employee${role._count.userRoles === 1 ? '' : 's'} assigned)`
                                  : 'Delete'}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        title="Delete role?"
        description={`Delete role "${deleteTarget?.name ?? ''}"? This cannot be undone.`}
        confirmText="Delete"
        type="delete"
        isLoading={deleting}
      />

      <Dialog open={!!cloneTarget} onOpenChange={(open) => { if (!open && !cloning) setCloneTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clone role</DialogTitle>
            <DialogDescription>
              Enter a name for the copy of &quot;{cloneTarget?.name}&quot;.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmClone(); }}
            placeholder="New role name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneTarget(null)} disabled={cloning}>Cancel</Button>
            <Button onClick={confirmClone} disabled={cloning || !cloneName.trim()}>
              {cloning ? 'Cloning...' : 'Clone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Modal */}
      {showForm && (
        <RoleFormModal
          role={editingRole}
          allRoles={roles}
          onSuccess={handleFormSuccess}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
