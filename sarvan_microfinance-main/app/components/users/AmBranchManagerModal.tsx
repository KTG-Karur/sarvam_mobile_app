'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Star,
  Loader2,
  AlertCircle,
  X,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
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
import { AreaManagerBranchAssignment } from '@/app/types';

const AM_MAX_BRANCHES = 4;

interface Branch {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

interface AreaManager {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface AmBranchManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
}

/**
 * Modal for managing branch assignments for an existing Area Manager.
 * Features:
 * - View all current assignments with primary indicator (★)
 * - Add new branches (up to 4) — includes ALL branches including HO
 * - Set primary branch (default login branch)
 * - Remove a branch assignment
 * - Transfer a branch to another Area Manager
 */
export function AmBranchManagerModal({
  open,
  onOpenChange,
  userId,
  userName,
}: AmBranchManagerModalProps) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<AreaManagerBranchAssignment[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [allAreaManagers, setAllAreaManagers] = useState<AreaManager[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [selectedBranchToAdd, setSelectedBranchToAdd] = useState<string>('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('');

  // Transfer state per assignment
  const [transferState, setTransferState] = useState<Record<string, string>>({});
  const [expandedTransfer, setExpandedTransfer] = useState<string | null>(null);

  // Confirmation dialog for remove
  const [removeConfirm, setRemoveConfirm] = useState<{
    assignmentId: string;
    branchName: string;
  } | null>(null);

  // Confirmation state for transfer (per assignment)
  const [transferConfirm, setTransferConfirm] = useState<string | null>(null); // assignmentId

  // Get current user role from localStorage
  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setCurrentUserRole(user.role);
      } catch (error) {
        console.error('Failed to parse user from localStorage:', error);
      }
    }
  }, []);

  const assignedIds = new Set(assignments.map((a) => a.branch.id));
  const isAtMax = assignments.length >= AM_MAX_BRANCHES;
  const isAdmin = currentUserRole === 'ADMIN';

  // Branches available to add (not yet assigned to this AM, all active)
  const availableBranches = allBranches.filter(
    (b) => b.isActive && !assignedIds.has(b.id)
  );

  // Other AMs (for transfer — exclude self)
  const otherAMs = allAreaManagers.filter((am) => am.id !== userId);

  const fetchAssignments = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await apiClient.get<AreaManagerBranchAssignment[]>(
        `/area-manager-branches?userId=${userId}`
      );
      if (result.success && result.data) {
        setAssignments(result.data);
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to load assignments', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [userId, toast]);

  const fetchBranches = useCallback(async () => {
    try {
      const result = await apiClient.get<Branch[]>('/branches');
      if (result.success && result.data) {
        // Show ALL branches — including HO (Admin decides what to assign)
        setAllBranches(result.data.filter((b) => b.isActive));
      }
    } catch {
      // silent
    }
  }, []);

  const fetchAreaManagers = useCallback(async () => {
    try {
      const result = await apiClient.get<{ users: AreaManager[] }>('/users?role=AREA_MANAGER&pageSize=50');
      if (result.success && result.data) {
        setAllAreaManagers(result.data.users);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (open && userId) {
      fetchAssignments();
      fetchBranches();
      fetchAreaManagers();
    }
  }, [open, userId, fetchAssignments, fetchBranches, fetchAreaManagers]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSelectedBranchToAdd('');
      setExpandedTransfer(null);
      setTransferState({});
      setRemoveConfirm(null);
      setTransferConfirm(null);
    }
  }, [open]);

  const handleAddBranch = async () => {
    if (!selectedBranchToAdd || isAtMax) return;

    setIsSaving('add');
    try {
      const isFirstAssignment = assignments.length === 0;
      const result = await apiClient.post('/area-manager-branches', {
        userId,
        branchIds: [selectedBranchToAdd],
        ...(isFirstAssignment ? { primaryBranchId: selectedBranchToAdd } : {}),
      });

      if (result.success) {
        toast({ title: 'Branch Assigned', description: 'Branch added successfully.' });
        setSelectedBranchToAdd('');
        await fetchAssignments();
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to assign branch', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  const handleSetPrimary = async (branchId: string, assignmentId: string) => {
    setIsSaving(`primary-${assignmentId}`);
    try {
      const result = await apiClient.post('/area-manager-branches', {
        userId,
        branchIds: [branchId],
        primaryBranchId: branchId,
      });

      if (result.success) {
        toast({ title: 'Primary Branch Updated', description: 'Default login branch changed.' });
        await fetchAssignments();
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to update primary', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  const handleRemove = async (assignmentId: string, branchName: string) => {
    // Show confirmation dialog instead of removing immediately
    setRemoveConfirm({ assignmentId, branchName });
  };

  const confirmRemove = async () => {
    if (!removeConfirm) return;
    const { assignmentId, branchName } = removeConfirm;
    setRemoveConfirm(null);
    setIsSaving(`remove-${assignmentId}`);
    try {
      const result = await apiClient.delete(`/area-manager-branches?id=${assignmentId}`);
      if (result.success) {
        toast({ title: 'Branch Removed', description: `${branchName} removed from this AM.` });
        setExpandedTransfer(null);
        await fetchAssignments();
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to remove branch', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  /**
   * Transfer: removes branch from this AM, then assigns it to the target AM.
   * Uses a two-step atomic approach via sequential API calls wrapped in try/catch.
   */
  const handleTransfer = async (assignment: AreaManagerBranchAssignment) => {
    const targetAmId = transferState[assignment.id];
    if (!targetAmId) return;

    // Show inline confirmation first
    if (transferConfirm !== assignment.id) {
      setTransferConfirm(assignment.id);
      return;
    }

    // Confirmed — proceed
    setTransferConfirm(null);
    const targetAm = otherAMs.find((am) => am.id === targetAmId);
    const branchName = assignment.branch.name;

    setIsSaving(`transfer-${assignment.id}`);
    try {
      // Step 1: Remove from current AM
      const removeResult = await apiClient.delete(`/area-manager-branches?id=${assignment.id}`);
      if (!removeResult.success) {
        toast({ title: 'Transfer Failed', description: removeResult.error || 'Could not remove branch from current AM', variant: 'destructive' });
        return;
      }

      // Step 2: Assign to target AM
      const assignResult = await apiClient.post('/area-manager-branches', {
        userId: targetAmId,
        branchIds: [assignment.branch.id],
      });

      if (assignResult.success) {
        toast({
          title: 'Branch Transferred',
          description: `${branchName} transferred to ${targetAm?.firstName} ${targetAm?.lastName}.`,
        });
        setExpandedTransfer(null);
        setTransferState((prev) => { const s = { ...prev }; delete s[assignment.id]; return s; });
        await fetchAssignments();
      } else {
        // Step 2 failed — inform user (branch already removed from this AM)
        toast({
          title: 'Partial Transfer',
          description: `${branchName} was removed from this AM but could not be assigned to the target: ${assignResult.error}. Please manually assign it.`,
          variant: 'destructive',
        });
        await fetchAssignments();
      }
    } catch {
      toast({ title: 'Error', description: 'Network error during transfer', variant: 'destructive' });
    } finally {
      setIsSaving(null);
    }
  };

  return (
    <>
      {/* Remove confirmation — uses project's own Dialog + rich JSX content */}
      <Dialog open={!!removeConfirm} onOpenChange={(o: boolean) => !o && setRemoveConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" />
              Remove Branch Assignment?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm mt-1">
                <p className="text-sidebar-accent dark:text-slate-300">
                  You are about to remove{' '}
                  <span className="font-semibold text-sidebar-accent dark:text-slate-100">
                    {removeConfirm?.branchName}
                  </span>{' '}
                  from{' '}
                  <span className="font-semibold text-sidebar-accent dark:text-slate-100">
                    {userName}
                  </span>.
                </p>

                {/* Historical data safety notice */}
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 dark:bg-amber-900/20 dark:border-amber-700">
                  <p className="font-semibold text-amber-800 dark:text-amber-300 text-xs mb-1">
                    📋 Historical data is NOT affected
                  </p>
                  <p className="text-amber-700 dark:text-amber-400 text-xs leading-relaxed">
                    Past approvals, disbursements, and all prior records remain unchanged.
                    Removing this assignment only revokes the AM&apos;s ability to switch
                    into{' '}
                    <strong>{removeConfirm?.branchName}</strong> going forward.
                  </p>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Access is revoked immediately. Any active session in this branch is
                  invalidated on the AM&apos;s next request.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setRemoveConfirm(null)}
              disabled={!!isSaving}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={confirmRemove}
              disabled={!!isSaving}
            >
              {isSaving?.startsWith('remove') ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Removing...</>
              ) : (
                'Remove Branch'
              )}
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
            <span className="font-semibold text-sidebar-accent dark:text-slate-200">{userName}</span>.
            Maximum {AM_MAX_BRANCHES} branches per Area Manager.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Usage counter */}
          <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-2.5 dark:bg-sidebar-accent">
            <span className="text-sm text-sidebar-accent dark:text-slate-400">Assigned Branches</span>
            <Badge variant={isAtMax ? 'destructive' : 'secondary'} className="font-bold">
              {assignments.length} / {AM_MAX_BRANCHES}
            </Badge>
          </div>

          {/* Current assignments */}
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
                const isTransferring = isSaving === `transfer-${assignment.id}`;
                const isTransferOpen = expandedTransfer === assignment.id;
                const selectedTargetAM = transferState[assignment.id] ?? '';

                return (
                  <div
                    key={assignment.id}
                    className="rounded-xl border border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker overflow-hidden"
                  >
                    {/* Main row */}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950/30">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-100 truncate">
                          {assignment.branch.name}
                        </p>
                        <p className="text-xs font-mono text-slate-500">{assignment.branch.code}</p>
                      </div>

                      {/* Primary toggle */}
                      {assignment.isPrimary ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 shrink-0 text-xs">
                          <Star className="mr-1 h-3 w-3 fill-current" />
                          Primary
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetPrimary(assignment.branch.id, assignment.id)}
                          disabled={!!isSaving}
                          className="h-7 px-2 text-xs text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 shrink-0"
                          title="Set as default login branch"
                        >
                          {isSettingPrimary ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <><Star className="mr-1 h-3 w-3" />Primary</>
                          )}
                        </Button>
                      )}

                      {/* Transfer toggle - Only show for ADMIN */}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedTransfer(isTransferOpen ? null : assignment.id)
                          }
                          disabled={!!isSaving || otherAMs.length === 0}
                          className="h-7 px-2 text-xs text-slate-400 hover:text-primary hover:bg-green-50 dark:hover:bg-brand-green-darker/20 shrink-0"
                          title={otherAMs.length === 0 ? 'No other Area Managers available' : 'Transfer to another Area Manager'}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                          {isTransferOpen ? (
                            <ChevronUp className="ml-1 h-3 w-3" />
                          ) : (
                            <ChevronDown className="ml-1 h-3 w-3" />
                          )}
                        </Button>
                      )}

                      {/* Remove - Only show for ADMIN */}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                          onClick={() => handleRemove(assignment.id, assignment.branch.name)}
                          disabled={!!isSaving}
                          title="Remove this branch assignment"
                        >
                          {isRemoving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Transfer sub-panel - Only show for ADMIN */}
                    {isAdmin && isTransferOpen && (
                      <div className="border-t border-slate-100 bg-green-50 px-4 py-3 dark:border-sidebar-accent dark:bg-sidebar-accent/50">
                        <p className="mb-2 text-xs font-semibold text-sidebar-accent dark:text-slate-400">
                          Transfer{' '}
                          <span className="text-primary">{assignment.branch.name}</span> to:
                        </p>
                        <div className="flex gap-2">
                          <Select
                            value={selectedTargetAM}
                            onValueChange={(val) =>
                              setTransferState((prev) => ({ ...prev, [assignment.id]: val }))
                            }
                            disabled={!!isSaving}
                          >
                            <SelectTrigger className="flex-1 h-8 text-xs">
                              <SelectValue placeholder="— Select Area Manager —" />
                            </SelectTrigger>
                            <SelectContent>
                              {otherAMs.map((am) => (
                                <SelectItem key={am.id} value={am.id}>
                                  {am.firstName} {am.lastName}
                                  <span className="ml-1 text-slate-400 text-xs">({am.email})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-8 px-3 text-xs bg-primary hover:bg-primary text-white"
                            onClick={() => handleTransfer(assignment)}
                            disabled={!selectedTargetAM || !!isSaving}
                          >
                            {isTransferring ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <ArrowRightLeft className="mr-1 h-3 w-3" />
                                {transferConfirm === assignment.id ? 'Confirm Transfer' : 'Transfer'}
                              </>
                            )}
                          </Button>
                        </div>
                        {/* Inline confirmation warning shown after first click */}
                        {transferConfirm === assignment.id && selectedTargetAM && (
                          <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 dark:bg-red-900/20 dark:border-red-700">
                            <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-0.5">
                              ⚠ Are you sure?
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-300">
                              This will <strong>remove</strong> {assignment.branch.name} from{' '}
                              <strong>{userName}</strong> and assign it to{' '}
                              <strong>
                                {otherAMs.find((a) => a.id === selectedTargetAM)?.firstName}{' '}
                                {otherAMs.find((a) => a.id === selectedTargetAM)?.lastName}
                              </strong>.
                              Historical records are not affected.
                              Click <strong>Confirm Transfer</strong> again to proceed.
                            </p>
                            <button
                              type="button"
                              onClick={() => setTransferConfirm(null)}
                              className="mt-1.5 text-xs text-slate-500 hover:text-sidebar-accent underline"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {!transferConfirm && (
                          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                            ⚠ Removes branch from <strong>{userName}</strong> and assigns to selected AM.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add branch section - Only show for ADMIN */}
          {isAdmin && (
            <div className="border-t pt-4">
              {!isAtMax ? (
                <>
                  <p className="mb-2 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                    Add Branch
                  </p>
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
                      {isSaving === 'add' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Maximum {AM_MAX_BRANCHES} branches reached. Remove or transfer one to add another.
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
      </Dialog>
    </>
  );
}
