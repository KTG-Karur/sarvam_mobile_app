'use client';

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Edit, RefreshCw } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useUserManagement, UserWithBranch } from '@/app/hooks/use-user-management';
import { getRoleDisplayName } from '@/app/lib/role-display';
import { UserRole } from '@/app/types';

interface UserListProps {
  refreshRef?: React.RefObject<() => void>;
  onEditUser?: (user: UserWithBranch) => void;
  showActions?: boolean;
}

export const UserList = forwardRef<{ refresh: () => void }, UserListProps>(
  ({ refreshRef, onEditUser, showActions = true }, ref) => {
    const { users, isLoading, fetchUsers } = useUserManagement();
    const [searchQuery, setSearchQuery] = useState('');
    const [filters, setFilters] = useState<{
      role?: UserRole;
      isActive?: boolean;
    }>({});

    useEffect(() => {
      fetchUsers(filters);
    }, [filters]);

    const refresh = () => {
      fetchUsers(filters);
    };

    useImperativeHandle(refreshRef, () => refresh, []);

    const filteredUsers = users.filter((user) => {
      const matchesSearch =
        searchQuery === '' ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        `${user.firstName} ${user.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });

    return (
      <div className="space-y-4">
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
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
            <SelectTrigger className="w-full sm:w-[180px]">
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
                isActive: value === 'all' ? undefined : value === 'active',
              }))
            }
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Table */}
        {isLoading ? (
          <PageLoader fullScreen={false} />
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sidebar-accent dark:text-slate-400">
              No users found. {searchQuery || Object.keys(filters).length > 0 ? 'Try adjusting your filters.' : 'Create your first user to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  {showActions && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id} className="cursor-pointer hover:bg-green-50 dark:hover:bg-brand-green-darker">
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-sidebar-accent border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300"
                      >
                        {/* Prefer RBAC role name so "Background Verification Team" shows instead of "FDO" */}
                        {(user as { rbacRole?: { name: string } | null }).rbacRole?.name
                            ?? getRoleDisplayName(user)}
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
                    {showActions && onEditUser && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditUser(user)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }
);

UserList.displayName = 'UserList';
