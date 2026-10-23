'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserWithBranch } from '@/app/hooks/use-user-management';
import { getRoleDisplayName } from '@/app/lib/role-display';
import { toDisplayDate } from '@/app/lib/date-format';

interface UserDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserWithBranch | null;
  onEdit?: () => void;
}

export function UserDetailsModal({
  open,
  onOpenChange,
  user,
  onEdit,
}: UserDetailsModalProps) {
  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
          <DialogDescription>
            View detailed information about this user
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                Email
              </p>
              <p className="text-sm text-sidebar-accent dark:text-slate-400">{user.email}</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                Full Name
              </p>
              <p className="text-sm text-sidebar-accent dark:text-slate-400">
                {user.firstName} {user.lastName}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                Role
              </p>
              <Badge
                variant="outline"
                className="bg-green-50 text-sidebar-accent border-primary/30 dark:bg-brand-green-darker/30 dark:text-green-300"
              >
                {/* Show RBAC role name (e.g. "Background Verification Team") if available */}
                {(user as { rbacRole?: { name: string } | null }).rbacRole?.name
                    ?? getRoleDisplayName(user)}
              </Badge>
            </div>

            <div>
              <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                Status
              </p>
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
            </div>

            <div>
              <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                Branch
              </p>
              <p className="text-sm text-sidebar-accent dark:text-slate-400">
                {user.branch
                  ? `${user.branch.name} (${user.branch.code})`
                  : 'No Branch Assigned'}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                Created At
              </p>
              <p className="text-sm text-sidebar-accent dark:text-slate-400">
                {toDisplayDate(new Date(user.createdAt))}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          {onEdit && (
            <Button variant="outline" onClick={onEdit}>
              Edit User
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
