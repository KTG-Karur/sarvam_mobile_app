'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, UserX, UserCheck } from 'lucide-react';
import { UserWithBranch } from '@/app/hooks/use-user-management';

interface SuspendUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserWithBranch | null;
  onSuccess: () => void;
  onSuspendUser: (userId: string, isActive: boolean) => Promise<unknown>;
}

export function SuspendUserModal({
  open,
  onOpenChange,
  user,
  onSuccess,
  onSuspendUser,
}: SuspendUserModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const isActive = user?.isActive ?? true;
  const action = isActive ? 'suspend' : 'activate';
  const actionLabel = isActive ? 'Suspend' : 'Activate';

  const handleSubmit = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      await onSuspendUser(user.id, !isActive);
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error(`Error ${action}ing user:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                isActive
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-green-100 dark:bg-green-900/30'
              }`}
            >
              {isActive ? (
                <UserX className="h-5 w-5 text-red-600 dark:text-red-400" />
              ) : (
                <UserCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
              )}
            </div>
            <div>
              <DialogTitle>{actionLabel} User</DialogTitle>
              <DialogDescription>
                {isActive
                  ? `Are you sure you want to suspend ${user?.firstName} ${user?.lastName}? They will not be able to access the system.`
                  : `Are you sure you want to activate ${user?.firstName} ${user?.lastName}? They will regain access to the system.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            variant={isActive ? 'destructive' : 'default'}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {actionLabel}ing...
              </>
            ) : (
              actionLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
