"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Search,
  MoreVertical,
  KeyRound,
  RefreshCw,
  Trash2,
  GitBranch,
  Smartphone,
  ScanFace,
  MapPinned,
} from 'lucide-react';
import { useUserManagement, UserWithBranch } from '@/app/hooks/use-user-management';
import { UserRole } from '@/app/types';
import { ResetPasswordModal } from '@/app/components/users/ResetPasswordModal';
import { TrainedFaceModal } from '@/app/components/users/TrainedFaceModal';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { AmBranchManagerModal } from '@/app/components/users/AmBranchManagerModal';
import { UserBranchAssignmentModal } from '@/components/employees/UserBranchAssignmentModal';
import { OrgScopeModal } from '@/components/employees/OrgScopeModal';
import { MobileDeviceModal } from '@/app/components/users/MobileDeviceModal';
import { usePermission } from '@/app/hooks/usePermission';
import { getRoleDisplayName } from '@/app/lib/role-display';
import { apiClient } from '@/app/lib/api-client';

interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  branchId: string | null;
  isActive: boolean;
  assignedBranchIds?: string[]; // For Area Manager
}

interface ActiveBranch {
  id: string;
  name: string;
  code: string;
  address?: string;
}


const getCurrentUser = (): CurrentUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      return JSON.parse(userStr) as CurrentUser;
    }
  } catch (error) {
    console.error('Error parsing user from localStorage:', error);
  }
  return null;
};

const getActiveBranch = (): ActiveBranch | null => {
  if (typeof window === 'undefined') return null;
  try {
    const branchStr = localStorage.getItem('activeBranch');
    if (branchStr) {
      return JSON.parse(branchStr) as ActiveBranch;
    }
  } catch (error) {
    console.error('Error parsing activeBranch from localStorage:', error);
  }
  return null;
};

export default function UserManagementPage() {
  // ── RBAC permission checks ──────────────────────────────────────────────
  const { canPage } = usePermission();
  const canDeleteEmployee = canPage('/dashboard/employees/management', 'delete');

  const {
    users,
    isLoading,
    selectedUser,
    setSelectedUser,
    fetchUsers,
    resetPassword,
    suspendUser,
    deleteUser,
    totalCount,
    totalPages,
    page,
  } = useUserManagement({
    onSuccess: () => {
      fetchUsers(buildFetchParams());
      setModals({
        resetPassword: false,
        delete: false,
        trainedFace: false,
      });
    },
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  // Fallback while /admin/roles is loading (or if the fetch fails) — mirrors
  // the previously-hardcoded list so the dropdown is never empty.
  const [roleOptions, setRoleOptions] = useState<Array<{ legacyRole: string; name: string }>>([
    { legacyRole: 'ADMIN', name: 'Admin' },
    { legacyRole: 'BRANCH_MANAGER', name: 'Branch Manager' },
    { legacyRole: 'AREA_MANAGER', name: 'Area Manager' },
    { legacyRole: 'FDO', name: 'Field Development Officer' },
  ]);
  const [filters, setFilters] = useState<{
    role?: UserRole;
    branchId?: string;
    isActive?: boolean;
  }>({});
  const [modals, setModals] = useState({
    resetPassword: false,
    delete: false,
    trainedFace: false,
  });
  const [amBranchModal, setAmBranchModal] = useState<{ open: boolean; userId: string; userName: string } | null>(null);
  const [branchAssignModal, setBranchAssignModal] = useState<{ open: boolean; userId: string; userName: string; userRole: string } | null>(null);
  const [orgScopeModal, setOrgScopeModal] = useState<{ open: boolean; userId: string; userName: string; userRole: string } | null>(null);
  const [mobileDeviceModal, setMobileDeviceModal] = useState<{ open: boolean; userId: string; userName: string; employeeId: string } | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  const currentUser = useMemo(() => getCurrentUser(), []);
  const activeBranch = useMemo(() => getActiveBranch(), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const buildFetchParams = (p: number = page) => ({
    ...filters,
    search: debouncedSearch || undefined,
    searchField: 'mobile' as const,
    page: p,
    pageSize: 10,
  });

  // Fetch branches for filter dropdown
  useEffect(() => {
    const fetchBranches = async () => {
      setIsLoadingBranches(true);
      try {
        const result = await apiClient.get<Array<{ id: string; name: string; code: string }>>('/branches');
        if (result.success && result.data) {
          setBranches(result.data);
        }
      } catch (error) {
        console.error('Error fetching branches:', error);
      } finally {
        setIsLoadingBranches(false);
      }
    };
    fetchBranches();
  }, []);

  // Populate the role filter from the real DB-managed role list (Role table) —
  // the base UserRole enum only covers the 4 system roles, so an admin who has
  // created custom roles (e.g. "Quality Checkers") couldn't filter by them.
  useEffect(() => {
    if (currentUser?.role !== 'ADMIN') return;
    const fetchRoles = async () => {
      try {
        const result = await apiClient.get<{ roles: Array<{ legacyRole: string; name: string; isActive: boolean }> }>('/admin/roles');
        const roles = (result as unknown as { roles?: Array<{ legacyRole: string; name: string; isActive: boolean }> }).roles;
        if (result.success && Array.isArray(roles)) {
          const seen = new Set<string>();
          const opts: Array<{ legacyRole: string; name: string }> = [];
          for (const r of roles) {
            if (!r.isActive || seen.has(r.legacyRole)) continue;
            seen.add(r.legacyRole);
            opts.push({ legacyRole: r.legacyRole, name: r.name });
          }
          if (opts.length > 0) setRoleOptions(opts);
        }
      } catch (error) {
        console.error('Error fetching roles:', error);
      }
    };
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role]);

  // Refetch page 1 whenever role/branch/status filters or the debounced search change.
  useEffect(() => {
    fetchUsers(buildFetchParams(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, debouncedSearch, fetchUsers]);

  const handlePageChange = (p: number) => {
    fetchUsers(buildFetchParams(p));
  };

  const openModal = (modalName: keyof typeof modals, user: UserWithBranch) => {
    setSelectedUser(user);
    setModals((prev) => ({ ...prev, [modalName]: true }));
  };

  const closeModal = (modalName: keyof typeof modals) => {
    setModals((prev) => ({ ...prev, [modalName]: false }));
    setSelectedUser(null);
  };

  const handleDelete = async () => {
    if (selectedUser) {
      await deleteUser(selectedUser.id);
    }
  };

  const handleToggleActive = async (user: UserWithBranch) => {
    setTogglingUserId(user.id);
    try {
      await suspendUser(user.id, !user.isActive);
      await fetchUsers(buildFetchParams());
    } finally {
      setTogglingUserId(null);
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
              User Management
            </h1>
            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
              Manage passwords, branches, devices, and delete users
            </p>
            {currentUser?.role === 'AREA_MANAGER' && currentUser.assignedBranchIds && (
              <p className="text-xs text-primary dark:text-primary mt-1">
                Managing users from {currentUser.assignedBranchIds.length} assigned branch(es)
              </p>
            )}
            {currentUser?.role === 'BRANCH_MANAGER' && activeBranch && (
              <p className="text-xs text-primary dark:text-primary mt-1">
                Managing Branch Managers and FDOs from branch: {activeBranch.name} ({activeBranch.code})
              </p>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Search & Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name or mobile..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Branch Filter */}
              <Select
                value={filters.branchId || 'all'}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    branchId: value === 'all' ? undefined : value,
                  }))
                }
                disabled={isLoadingBranches}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingBranches ? 'Loading branches...' : 'Filter by branch'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {currentUser?.role === 'ADMIN' && (
                <Select
                  value={filters.role || 'all'}
                  onValueChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      role: value === 'all' ? undefined : (value as UserRole),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {roleOptions.map((r) => (
                      <SelectItem key={r.legacyRole} value={r.legacyRole}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {currentUser?.role !== 'ADMIN' && (
                <Select
                  value={filters.role || 'all'}
                  onValueChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      role: value === 'all' ? undefined : (value as UserRole),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {currentUser?.role === 'AREA_MANAGER' && (
                      <SelectItem value="BRANCH_MANAGER">Branch Manager</SelectItem>
                    )}
                    <SelectItem value="FDO">Field Development Officer</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <Select
                value={
                  filters.isActive === undefined
                    ? 'all'
                    : filters.isActive
                      ? 'active'
                      : 'inactive'
                }
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    isActive: value === 'all' ? undefined : value === 'active',
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* User Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Users ({totalCount})</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchUsers(buildFetchParams())}
                disabled={isLoading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <PageLoader fullScreen={false} />
            ) : users.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sidebar-accent dark:text-slate-400">
                  No users found. Try adjusting your filters.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Emp ID</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-mono text-xs text-sidebar-accent dark:text-primary">
                          {user.employeeId || '—'}
                        </TableCell>
                        <TableCell className="font-medium">{user.mobileNumber || '—'}</TableCell>
                        <TableCell>
                          {user.firstName} {user.lastName}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-brand-green-darker/30"
                            style={user.rbacRole?.color ? {
                              backgroundColor: `${user.rbacRole.color}18`,
                              borderColor: `${user.rbacRole.color}55`,
                              color: user.rbacRole.color,
                            } : undefined}
                          >
                            {/* Prefer RBAC role name so custom roles show correctly */}
                            {user.rbacRole?.name ?? getRoleDisplayName(user)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {user.role === 'AREA_MANAGER' && currentUser?.role === 'ADMIN' ? (
                            <button
                              onClick={() =>
                                setAmBranchModal({
                                  open: true,
                                  userId: user.id,
                                  userName: `${user.firstName} ${user.lastName}`,
                                })
                              }
                              className="flex items-center gap-1.5 text-sm text-primary hover:text-sidebar-accent hover:underline dark:text-primary"
                            >
                              <GitBranch className="h-3.5 w-3.5" />
                              Manage Branches
                            </button>
                          ) : user.branch ? (
                            <span className="text-sm">
                              {user.branch.name} ({user.branch.code})
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">No Branch</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={user.isActive}
                            onCheckedChange={() => handleToggleActive(user)}
                            disabled={togglingUserId === user.id}
                            className="data-[state=checked]:bg-green-500"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {user.role === 'AREA_MANAGER' && currentUser?.role === 'ADMIN' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setAmBranchModal({
                                      open: true,
                                      userId: user.id,
                                      userName: `${user.firstName} ${user.lastName}`,
                                    })
                                  }
                                >
                                  <GitBranch className="mr-2 h-4 w-4" />
                                  AM Branches
                                </DropdownMenuItem>
                              )}
                              {currentUser?.role === 'ADMIN' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setBranchAssignModal({
                                      open: true,
                                      userId: user.id,
                                      userName: `${user.firstName} ${user.lastName}`,
                                      userRole: user.rbacRole?.name ?? user.role,
                                    })
                                  }
                                >
                                  <GitBranch className="mr-2 h-4 w-4" />
                                  Manage Branches
                                </DropdownMenuItem>
                              )}
                              {/* Head Office / Region / Division / Area / Branch coverage — Quality Checkers */}
                              {currentUser?.role === 'ADMIN' && (user.role === 'QC' || user.rbacRole?.slug === 'quality-checkers') && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setOrgScopeModal({
                                      open: true,
                                      userId: user.id,
                                      userName: `${user.firstName} ${user.lastName}`,
                                      userRole: user.rbacRole?.name ?? user.role,
                                    })
                                  }
                                >
                                  <MapPinned className="mr-2 h-4 w-4" />
                                  Assign Region / Area
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => openModal('resetPassword', user)}
                              >
                                <KeyRound className="mr-2 h-4 w-4" />
                                Reset Password
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openModal('trainedFace', user)}
                              >
                                <ScanFace className="mr-2 h-4 w-4" />
                                Trained Face
                              </DropdownMenuItem>
                              {currentUser?.role === 'ADMIN' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setMobileDeviceModal({
                                      open: true,
                                      userId: user.id,
                                      userName: `${user.firstName} ${user.lastName}`,
                                      employeeId: user.employeeId ?? '',
                                    })
                                  }
                                >
                                  <Smartphone className="mr-2 h-4 w-4" />
                                  Mobile Device
                                </DropdownMenuItem>
                              )}
                              {/* Delete — visible only if admin:delete permission granted */}
                              {(canDeleteEmployee || currentUser?.role === 'ADMIN') && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => openModal('delete', user)}
                                    className="text-red-600 focus:text-red-600"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete User
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-1 py-4 mt-2">
                <p className="text-sm text-sidebar-accent dark:text-slate-400">
                  Page {page} of {totalPages} · {totalCount} record{totalCount !== 1 ? 's' : ''}
                </p>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(1, page - 1))} disabled={page === 1 || isLoading}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages || isLoading}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AM Branch Manager Modal */}
        {amBranchModal && (
          <AmBranchManagerModal
            open={amBranchModal.open}
            onOpenChange={(open) => {
              if (!open) setAmBranchModal(null);
            }}
            userId={amBranchModal.userId}
            userName={amBranchModal.userName}
          />
        )}

        {/* Multi-Branch Assignment Modal (all roles) */}
        {branchAssignModal && (
          <UserBranchAssignmentModal
            open={branchAssignModal.open}
            onOpenChange={(open) => {
              if (!open) setBranchAssignModal(null);
            }}
            userId={branchAssignModal.userId}
            userName={branchAssignModal.userName}
            userRole={branchAssignModal.userRole}
            onChanged={() => fetchUsers(buildFetchParams())}
          />
        )}

        {/* Head Office / Region / Division / Area / Branch coverage (Quality Checkers) */}
        {orgScopeModal && (
          <OrgScopeModal
            open={orgScopeModal.open}
            onOpenChange={(open) => {
              if (!open) setOrgScopeModal(null);
            }}
            userId={orgScopeModal.userId}
            userName={orgScopeModal.userName}
            userRole={orgScopeModal.userRole}
            onChanged={() => fetchUsers(buildFetchParams())}
          />
        )}

        {/* Mobile Device Modal */}
        {mobileDeviceModal && (
          <MobileDeviceModal
            open={mobileDeviceModal.open}
            onOpenChange={(open) => {
              if (!open) setMobileDeviceModal(null);
            }}
            userId={mobileDeviceModal.userId}
            userName={mobileDeviceModal.userName}
            employeeId={mobileDeviceModal.employeeId}
          />
        )}

        {/* Modals */}
        <ResetPasswordModal
          open={modals.resetPassword}
          onOpenChange={(open) => closeModal(open ? 'resetPassword' : 'resetPassword')}
          user={selectedUser}
          onSuccess={() => {}}
          onResetPassword={resetPassword}
        />

        <TrainedFaceModal
          open={modals.trainedFace}
          onOpenChange={(open) => closeModal(open ? 'trainedFace' : 'trainedFace')}
          user={selectedUser}
        />

        <ConfirmationDialog
          open={modals.delete}
          onOpenChange={(open) => closeModal(open ? 'delete' : 'delete')}
          onConfirm={handleDelete}
          title="Delete User"
          description={`Are you sure you want to delete ${selectedUser?.firstName} ${selectedUser?.lastName}? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          type="delete"
          isLoading={isLoading}
        />
      </div>
    </ProtectedRoute>
  );
}
