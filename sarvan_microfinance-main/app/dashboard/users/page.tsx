'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Search,
  MoreVertical,
  Eye,
  KeyRound,
  Building2,
  UserX,
  UserCheck,
  RefreshCw,
  Filter,
  X,
  ScanFace,
} from 'lucide-react';
import { useUserManagement, UserWithBranch } from '@/app/hooks/use-user-management';
import { UserRole } from '@/app/types';
import { ResetPasswordModal } from '@/app/components/users/ResetPasswordModal';
import { AssignBranchModal } from '@/app/components/users/AssignBranchModal';
import { SuspendUserModal } from '@/app/components/users/SuspendUserModal';
import { UserDetailsModal } from '@/app/components/users/UserDetailsModal';
import { TrainedFaceModal } from '@/app/components/users/TrainedFaceModal';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { getRoleDisplayName } from '@/app/lib/role-display';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

type Branch = { id: string; name: string; code: string };

export default function UserManagementPage() {
  const router = useRouter();
  const {
    users,
    isLoading,
    selectedUser,
    setSelectedUser,
    fetchUsers,
    resetPassword,
    assignBranch,
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
        assignBranch: false,
        suspend: false,
        details: false,
        delete: false,
        trainedFace: false,
      });
    },
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<{
    role?: UserRole;
    isActive?: boolean;
    branchId?: string;
  }>({});

  // Branch filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH) and AREA_MANAGER get a
  // picker; AREA_MANAGER's branch list is scoped to their assigned branches.
  const storedUser = tokenStorage.getUser();
  const isAreaManager = storedUser?.role === 'AREA_MANAGER';
  const canFilterByBranch = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager;
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (!canFilterByBranch) return;
    apiClient.get<Branch[]>('/branches').then((result) => {
      if (!result.success || !result.data) return;
      let list = result.data;
      if (isAreaManager) {
        const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
        if (assignedBranchIds.length > 0) {
          list = list.filter((b) => assignedBranchIds.includes(b.id));
        }
      }
      setBranches(list);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFilterByBranch, isAreaManager]);
  const [modals, setModals] = useState({
    resetPassword: false,
    assignBranch: false,
    suspend: false,
    details: false,
    delete: false,
    trainedFace: false,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const buildFetchParams = (p: number = page) => ({
    ...filters,
    search: debouncedSearch || undefined,
    searchField: 'email' as const,
    page: p,
    pageSize: 10,
  });

  // Refetch page 1 whenever role/status filters or the debounced search change.
  useEffect(() => {
    fetchUsers(buildFetchParams(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, debouncedSearch]);

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

  const clearFilters = () => {
    setFilters({});
    setSearchQuery('');
  };

  const hasActiveFilters = Object.keys(filters).length > 0 || searchQuery !== '';

  return (
    <div className="space-y-4 sm:space-y-6 pt-3 sm:pt-4 md:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
            User Management
          </h1>
          <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
            Manage users, roles, and permissions
          </p>
        </div>
        <Button onClick={() => router.push('/dashboard/users/create')} size="sm" className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
          Create User
        </Button>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters & Search
            </CardTitle>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-1 md:grid-cols-3 ${canFilterByBranch ? 'lg:grid-cols-4' : ''} gap-4`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

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
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="BRANCH_MANAGER">Branch Manager</SelectItem>
                <SelectItem value="AREA_MANAGER">Area Manager</SelectItem>
                <SelectItem value="FDO">Field Development Officer</SelectItem>
              </SelectContent>
            </Select>

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
                  isActive:
                    value === 'all' ? undefined : value === 'active',
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

            {canFilterByBranch && (
              <Select
                value={filters.branchId || 'all'}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    branchId: value === 'all' ? undefined : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
                No users found. {hasActiveFilters ? 'Try adjusting your filters.' : 'Create your first user to get started.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.email}</TableCell>
                      <TableCell>
                        {user.firstName} {user.lastName}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-sidebar-accent border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300"
                        >
                          {/* Prefer RBAC role name so custom roles show correctly */}
                          {user.rbacRole?.name ?? getRoleDisplayName(user)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.branch ? (
                          <span className="text-sm">
                            {user.branch.name} ({user.branch.code})
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">No Branch</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.isActive ? 'default' : 'secondary'}
                          className={
                            user.isActive
                              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300'
                              : 'bg-green-50 text-slate-500 border-primary/20'
                          }
                        >
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-sidebar-accent dark:text-slate-400">
                        {toDisplayDate(new Date(user.createdAt))}
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
                            <DropdownMenuItem
                              onClick={() => openModal('details', user)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => router.push(`/dashboard/users/edit/${user.id}`)}
                            >
                              <MoreVertical className="mr-2 h-4 w-4" />
                              Edit User
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
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
                            <DropdownMenuItem
                              onClick={() => openModal('assignBranch', user)}
                            >
                              <Building2 className="mr-2 h-4 w-4" />
                              Assign Branch
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => openModal('suspend', user)}
                            >
                              {user.isActive ? (
                                <>
                                  <UserX className="mr-2 h-4 w-4" />
                                  Suspend User
                                </>
                              ) : (
                                <>
                                  <UserCheck className="mr-2 h-4 w-4" />
                                  Activate User
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => openModal('delete', user)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <UserX className="mr-2 h-4 w-4" />
                              Delete User
                            </DropdownMenuItem>
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

      {/* Modals */}
      <ResetPasswordModal
        open={modals.resetPassword}
        onOpenChange={(open) => closeModal(open ? 'resetPassword' : 'resetPassword')}
        user={selectedUser}
        onSuccess={() => {}}
        onResetPassword={resetPassword}
      />

      <AssignBranchModal
        open={modals.assignBranch}
        onOpenChange={(open) => closeModal(open ? 'assignBranch' : 'assignBranch')}
        user={selectedUser}
        onSuccess={() => {}}
        onAssignBranch={assignBranch}
      />

      <SuspendUserModal
        open={modals.suspend}
        onOpenChange={(open) => closeModal(open ? 'suspend' : 'suspend')}
        user={selectedUser}
        onSuccess={() => {}}
        onSuspendUser={suspendUser}
      />

      <UserDetailsModal
        open={modals.details}
        onOpenChange={(open) => closeModal(open ? 'details' : 'details')}
        user={selectedUser}
        onEdit={() => {
          closeModal('details');
          if (selectedUser) {
            router.push(`/dashboard/users/edit/${selectedUser.id}`);
          }
        }}
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
  );
}
