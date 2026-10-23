'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Star,
  Loader2,
  AlertCircle,
  X,
  ShieldAlert,
  MapPinned,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';

interface Branch {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

interface Assignment {
  id: string;
  userId: string;
  branchId: string;
  isPrimary: boolean;
  createdAt: string;
  branch: Branch;
}

type OrgNode = { id: string; name: string; code: string };
type OrgCoverageResponse = {
  regions: (OrgNode & { divisions: (OrgNode & { areas: OrgNode[] })[] })[];
  scopes: { level: string; id?: string }[];
};

interface UserBranchAssignmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userRole: string;
  /** Called after a branch is added, removed, or set primary — lets the parent list refresh. */
  onChanged?: () => void;
}

export function UserBranchAssignmentModal({
  open,
  onOpenChange,
  userId,
  userName,
  userRole,
  onChanged,
}: UserBranchAssignmentModalProps) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [selectedBranchToAdd, setSelectedBranchToAdd] = useState('');
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; branchName: string } | null>(null);
  // Region / Division / Area coverage set in "Assign Region / Area" (read-only here).
  const [orgCoverage, setOrgCoverage] = useState<string[]>([]);

  const assignedIds = new Set(assignments.map((a) => a.branchId));
  const availableBranches = allBranches.filter((b) => b.isActive && !assignedIds.has(b.id));

  const fetchAssignments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<Assignment[]>(`/user-branch-assignments?userId=${userId}`);
      if (res.success && res.data) {
        setAssignments(res.data);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to load assignments', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [userId, toast]);

  const fetchOrgCoverage = useCallback(async () => {
    try {
      const res = await apiClient.get<OrgCoverageResponse>(`/users/${userId}/org-scope`);
      if (!res.success || !res.data) return;
      const labels = new Map<string, string>();
      for (const r of res.data.regions) {
        labels.set(`REGION:${r.id}`, `Region: ${r.name}`);
        for (const d of r.divisions) {
          labels.set(`DIVISION:${d.id}`, `Division: ${d.name}`);
          for (const a of d.areas) labels.set(`AREA:${a.id}`, `Area: ${a.name}`);
        }
      }
      setOrgCoverage(
        res.data.scopes
          .filter((sc) => sc.level === 'REGION' || sc.level === 'DIVISION' || sc.level === 'AREA')
          .map((sc) => labels.get(`${sc.level}:${sc.id}`) ?? sc.level)
      );
    } catch { /* silent */ }
  }, [userId]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await apiClient.get<Branch[]>('/branches');
      if (res.success && res.data) setAllBranches(res.data.filter((b) => b.isActive));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (open && userId) {
      fetchAssignments();
      fetchBranches();
      fetchOrgCoverage();
    }
  }, [open, userId, fetchAssignments, fetchBranches, fetchOrgCoverage]);

  useEffect(() => {
    if (!open) {
      setSelectedBranchToAdd('');
      setRemoveConfirm(null);
    }
  }, [open]);

  const handleAddBranch = async () => {
    if (!selectedBranchToAdd) return;
    setIsSaving('add');
    try {
      const isFirst = assignments.length === 0;
      const res = await apiClient.post('/user-branch-assignments', {
        userId,
        branchIds: [selectedBranchToAdd],
        ...(isFirst ? { primaryBranchId: selectedBranchToAdd } : {}),
      });
      if (res.success) {
        toast({ title: 'Branch Assigned', description: 'Branch added successfully.' });
        setSelectedBranchToAdd('');
        await fetchAssignments();
        onChanged?.();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to assign branch', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  const handleSetPrimary = async (assignment: Assignment) => {
    setIsSaving(`primary-${assignment.id}`);
    try {
      const res = await apiClient.patch(`/user-branch-assignments?id=${assignment.id}`, { isPrimary: true });
      if (res.success) {
        toast({ title: 'Primary Updated', description: 'Default branch updated.' });
        await fetchAssignments();
        onChanged?.();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to update', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  const confirmRemove = async () => {
    if (!removeConfirm) return;
    const { id, branchName } = removeConfirm;
    setRemoveConfirm(null);
    setIsSaving(`remove-${id}`);
    try {
      const res = await apiClient.delete(`/user-branch-assignments?id=${id}`);
      if (res.success) {
        toast({ title: 'Branch Removed', description: `${branchName} removed.` });
        await fetchAssignments();
        onChanged?.();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to remove', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  return (
    <>
      {/* Remove confirmation dialog */}
      <Dialog open={!!removeConfirm} onOpenChange={(o) => !o && setRemoveConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" />
              Remove Branch Assignment?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm mt-1">
                <p className="text-sidebar-accent dark:text-slate-300">
                  Remove{' '}
                  <span className="font-semibold text-sidebar-accent dark:text-slate-100">
                    {removeConfirm?.branchName}
                  </span>{' '}
                  from{' '}
                  <span className="font-semibold text-sidebar-accent dark:text-slate-100">{userName}</span>?
                </p>
                <p className="text-xs text-slate-500">Historical data is not affected. Access is revoked immediately.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveConfirm(null)} disabled={!!isSaving}>
              Cancel
            </Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={confirmRemove} disabled={!!isSaving}>
              {isSaving?.startsWith('remove') ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Removing...</>
              ) : 'Remove Branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary" />
              Branch Assignments
            </DialogTitle>
            <DialogDescription>
              Managing branches for{' '}
              <span className="font-semibold text-sidebar-accent dark:text-slate-200">{userName}</span>
              {' '}({userRole})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Counter */}
            <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-2.5 dark:bg-sidebar-accent">
              <span className="text-sm text-sidebar-accent dark:text-slate-400">Assigned Branches</span>
              <Badge variant="secondary" className="font-bold">{assignments.length}</Badge>
            </div>

            {/* Assignments list */}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary/20 py-8 text-center dark:border-sidebar-accent">
                <AlertCircle className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">No branches assigned yet</p>
                <p className="text-xs text-slate-400">Add a branch below to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {assignments.map((assignment) => {
                  const isRemoving = isSaving === `remove-${assignment.id}`;
                  const isSettingPrimary = isSaving === `primary-${assignment.id}`;

                  return (
                    <div
                      key={assignment.id}
                      className="flex items-center gap-3 rounded-xl border border-primary/20 bg-white px-4 py-3 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950/30">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-100 truncate">
                          {assignment.branch.name}
                        </p>
                        <p className="text-xs font-mono text-slate-500">{assignment.branch.code}</p>
                      </div>

                      {assignment.isPrimary ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 shrink-0 text-xs">
                          <Star className="mr-1 h-3 w-3 fill-current" />
                          Primary
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetPrimary(assignment)}
                          disabled={!!isSaving}
                          className="h-7 px-2 text-xs text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 shrink-0"
                        >
                          {isSettingPrimary
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><Star className="mr-1 h-3 w-3" />Set Primary</>}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                        onClick={() => setRemoveConfirm({ id: assignment.id, branchName: assignment.branch.name })}
                        disabled={!!isSaving}
                      >
                        {isRemoving
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <X className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Region / Division / Area coverage (managed in Assign Region / Area) */}
            {orgCoverage.length > 0 && (
              <div className="rounded-lg border border-primary/20 px-4 py-3 dark:border-sidebar-accent">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                  <MapPinned className="h-4 w-4 text-primary" />
                  Also covers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {orgCoverage.map((label) => (
                    <Badge key={label} variant="outline" className="font-normal">{label}</Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Change these from Assign Region / Area.</p>
              </div>
            )}

            {/* Add branch */}
            <div className="border-t pt-4">
              <p className="mb-2 text-sm font-semibold text-sidebar-accent dark:text-slate-300">Add Branch</p>
              <div className="flex gap-2">
                <Select
                  value={selectedBranchToAdd}
                  onValueChange={setSelectedBranchToAdd}
                  disabled={!!isSaving || availableBranches.length === 0}
                >
                  <SelectTrigger className="flex-1 h-9 text-sm">
                    <SelectValue
                      placeholder={
                        availableBranches.length === 0
                          ? 'All branches already assigned'
                          : '— Select branch to add —'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableBranches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="font-medium">{b.name}</span>{' '}
                        <span className="font-mono text-xs text-slate-500">({b.code})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  size="sm"
                  className="h-9 px-4 bg-primary hover:bg-primary text-white"
                  onClick={handleAddBranch}
                  disabled={!selectedBranchToAdd || !!isSaving}
                >
                  {isSaving === 'add'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Plus className="mr-1.5 h-3.5 w-3.5" />Add</>}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
