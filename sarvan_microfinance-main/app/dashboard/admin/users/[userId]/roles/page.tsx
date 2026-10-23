'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, Loader2, UserCog, Shield, Calendar,
  Building2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { toast } from '@/app/hooks/use-toast';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// ─── Types ───────────────────────────────────
interface UserRole {
  id: string;
  isActive: boolean;
  expiresAt: string | null;
  branchId: string | null;
  assignedBy: string | null;
  createdAt: string;
  role: { id: string; name: string; slug: string; color: string | null; priority: number; isActive: boolean };
  branch: { id: string; name: string; code: string } | null;
}

interface Role {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  isActive: boolean;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

// ─── Page ───────────────────────────────────
export default function UserRolesPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;

  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [userBranches, setUserBranches] = useState<Branch[]>([]);
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);

  // Assign form state
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('global');
  const [expiresAt, setExpiresAt] = useState('');
  const [assigning, setAssigning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, userRolesRes, userRes] = await Promise.all([
        fetch('/api/admin/roles'),
        fetch(`/api/admin/users/${userId}/roles`),
        fetch(`/api/admin/users/${userId}`),
      ]);

      const [rolesData, userRolesData, userData] = await Promise.all([
        rolesRes.json(),
        userRolesRes.json(),
        userRes.json(),
      ]);

      if (rolesData.success) setAllRoles(rolesData.roles.filter((r: Role) => r.isActive));
      if (userRolesData.success) setUserRoles(userRolesData.userRoles);
      if (userData.success) {
        setUserName(`${userData.user.firstName} ${userData.user.lastName}`);
        setUserBranches(
          userData.user.userBranchAccess?.map((ba: { branch: Branch }) => ba.branch) ?? []
        );
      }
    } catch {
      toast({ title: 'Failed to load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAssign = async () => {
    if (!selectedRoleId) {
      toast({ title: 'Please select a role', variant: 'destructive' });
      return;
    }

    setAssigning(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: selectedRoleId,
          branchId: selectedBranchId === 'global' ? null : selectedBranchId,
          expiresAt: expiresAt || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast({ title: 'Role assigned successfully' });
        setSelectedRoleId('');
        setSelectedBranchId('global');
        setExpiresAt('');
        loadData();
      } else {
        toast({ title: data.error ?? 'Failed to assign role', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async (userRole: UserRole) => {
    if (!confirm(`Remove role "${userRole.role.name}" from this user?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: userRole.role.id,
          branchId: userRole.branchId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast({ title: 'Role removed' });
        loadData();
      } else {
        toast({ title: data.error ?? 'Failed to remove', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    }
  };

  if (loading) {
    return <PageLoader fullScreen={false} />;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog className="h-6 w-6 text-primary" />
            Manage Roles — {userName}
          </h1>
          <p className="text-sm text-gray-500">
            Assign or remove roles for this user. Changes take effect immediately.
          </p>
        </div>
      </div>

      {/* Current Roles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current Roles ({userRoles.filter((ur) => ur.isActive).length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {userRoles.filter((ur) => ur.isActive).length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No roles assigned yet</p>
            </div>
          ) : (
            userRoles
              .filter((ur) => ur.isActive)
              .sort((a, b) => b.role.priority - a.role.priority)
              .map((ur) => (
                <div
                  key={ur.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-gray-50/50 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    {ur.role.color && (
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: ur.role.color }}
                      />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{ur.role.name}</span>
                        <Badge variant="outline" className="text-xs">
                          Priority: {ur.role.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        {ur.branch ? (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {ur.branch.name} ({ur.branch.code})
                          </span>
                        ) : (
                          <span className="text-primary font-medium">All Branches</span>
                        )}
                        {ur.expiresAt && (
                          <span className="flex items-center gap-1 text-amber-600">
                            <Calendar className="h-3 w-3" />
                            Expires: {toDisplayDate(new Date(ur.expiresAt))}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => handleRemove(ur)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
          )}
        </CardContent>
      </Card>

      {/* Assign New Role */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assign New Role</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Role Selection */}
          <div className="space-y-1.5">
            <Label>Role <span className="text-red-500">*</span></Label>
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a role..." />
              </SelectTrigger>
              <SelectContent>
                {allRoles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    <div className="flex items-center gap-2">
                      {r.color && (
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                      )}
                      {r.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Branch Scope */}
          <div className="space-y-1.5">
            <Label>Branch Scope</Label>
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">
                  <span className="font-medium text-primary">All Branches (Global)</span>
                </SelectItem>
                {userBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              "All Branches" — role applies everywhere. Branch-specific — role only active on that branch.
            </p>
          </div>

          {/* Optional Expiry */}
          <div className="space-y-1.5">
            <Label>Expiry Date (optional)</Label>
            <DateInput
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
            <p className="text-xs text-gray-400">
              Leave empty for permanent assignment. Set a date for temporary roles.
            </p>
          </div>

          <Button onClick={handleAssign} disabled={assigning || !selectedRoleId} className="w-full gap-2">
            {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Assign Role
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
