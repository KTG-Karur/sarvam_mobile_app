'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Building2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { UserWithBranch } from '@/app/hooks/use-user-management';

interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string | null;
}

interface AssignBranchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserWithBranch | null;
  onSuccess: () => void;
  onAssignBranch: (userId: string, branchId: string | null) => Promise<unknown>;
}

export function AssignBranchModal({
  open,
  onOpenChange,
  user,
  onSuccess,
  onAssignBranch,
}: AssignBranchModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('none');

  useEffect(() => {
    if (open) {
      fetchBranches();
      setSelectedBranchId(user?.branchId || 'none');
    }
  }, [open, user]);

  const fetchBranches = async () => {
    setIsLoadingBranches(true);
    try {
      const result = await apiClient.get<Branch[]>('/branches');
      if (result.success && result.data) {
        setBranches(result.data);
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const handleSubmit = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const branchId = selectedBranchId === 'none' ? null : selectedBranchId;
      await onAssignBranch(user.id, branchId);
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error assigning branch:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 dark:bg-brand-green-darker/30">
              <Building2 className="h-5 w-5 text-primary dark:text-primary" />
            </div>
            <div>
              <DialogTitle>Assign Branch</DialogTitle>
              <DialogDescription>
                Assign {user?.firstName} {user?.lastName} to a branch
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Branch</label>
            <Select
              value={selectedBranchId}
              onValueChange={setSelectedBranchId}
              disabled={isLoadingBranches || isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingBranches ? 'Loading...' : 'Select branch'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Branch</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || isLoadingBranches}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Assigning...
              </>
            ) : (
              'Assign Branch'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
