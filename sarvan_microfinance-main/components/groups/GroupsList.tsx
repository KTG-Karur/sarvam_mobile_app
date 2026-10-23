'use client';
import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';
import { Trash2, Loader2, RefreshCw, Eye, Search, Users, FolderTree, UserPlus, Calendar, MapPin, Sparkles, Crown, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { motion } from 'framer-motion';
import { CreateGroupDialog } from '@/components/groups/CreateGroupDialog';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

interface Group {
  id: string;
  name: string;
  code?: string | null;
  centerId: string;
  centerName: string;
  centerCode: string;
  memberCount: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
  centerLeaderId?: string | null;
  centerLeader?: {
    id: string;
    firstName: string;
    lastName: string;
    clientId: string;
  };
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

interface GroupMember {
  id: string;
  clientId: string;
  clientDbId: string;
  clientName: string;
  phone?: string | null;
  joinedDate: string;
}

interface Center {
  id: string;
  name: string;
  code: string;
}

// This is the only place a new Group can be created — see "Add Group" above.
// Name/number are auto-generated ("<Center Name> - N"); manual edit stays
// out of scope (only delete + center-leader assignment are supported here).
interface GroupsListProps {
  refreshRef?: React.MutableRefObject<(() => void) | null>;
}

const statusColors: Record<Group['status'], string> = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',
  INACTIVE: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-300 dark:border-gray-700',
};

export function GroupsList({ refreshRef }: GroupsListProps) {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [centers, setCenters] = useState<Center[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewGroup, setPreviewGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [centerFilter, setCenterFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Roles that can see groups across more than one branch — only these get a branch filter
  const currentUserRole = tokenStorage.getUser()?.role;
  const isMultiBranchRole = currentUserRole === 'ADMIN'
    || currentUserRole === 'ADMIN_NON_HO_BRANCH_SWITCH'
    || currentUserRole === 'AREA_MANAGER'
    || currentUserRole === 'DIVISION_MANAGER';

  // Fetch branches for the filter dropdown (multi-branch roles only) —
  // AREA_MANAGER's list is scoped to their assigned branches.
  useEffect(() => {
    if (!isMultiBranchRole) return;
    const fetchBranches = async () => {
      setIsLoadingBranches(true);
      try {
        const result = await apiClient.get<Array<{ id: string; name: string; code: string }>>('/branches');
        if (result.success && result.data) {
          let list = result.data;
          if (currentUserRole === 'AREA_MANAGER') {
            const storedUser = tokenStorage.getUser();
            const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
            if (assignedBranchIds.length > 0) {
              list = list.filter((b) => assignedBranchIds.includes(b.id));
            }
          }
          setBranches(list);
        }
      } catch (error) {
        console.error('Error fetching branches:', error);
      } finally {
        setIsLoadingBranches(false);
      }
    };
    fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserRole]);

  // Reset the center filter whenever the branch filter changes, since the
  // previously selected center may no longer be in the fetched list.
  useEffect(() => {
    setCenterFilter('all');
  }, [branchFilter]);

  const fetchGroups = async () => {
    setIsLoading(true);
    try {
      let branchId: string | undefined;
      if (isMultiBranchRole) {
        // Multi-branch roles: use the picked filter, or leave unset to let the
        // API return groups across every branch the caller is scoped to.
        branchId = branchFilter !== 'all' ? branchFilter : undefined;
      } else {
        const activeBranch = branchStorage.getActiveBranch();
        if (!activeBranch?.id) {
          toast({
            title: 'Error',
            description: 'No branch found. Please select a branch first.',
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }
        branchId = activeBranch.id;
      }

      // Fetch groups from API
      const query = new URLSearchParams({ includeInactive: 'true' });
      if (branchId) query.set('branchId', branchId);
      const result = await apiClient.get<Group[]>(`/groups?${query.toString()}`);
      
      if (result.success && result.data) {
        setGroups(result.data);
        
        // Extract unique centers from groups
        const uniqueCenters = Array.from(
          new Map(
            result.data.map(group => [
              group.centerId,
              { id: group.centerId, name: group.centerName, code: group.centerCode },
            ])
          ).values()
        );
        setCenters(uniqueCenters);
      } else {
        toast({
          title: 'Info',
          description: 'No groups found. Create your first group to get started.',
        });
        setGroups([]);
        setCenters([]);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      toast({
        title: 'Error',
        description: 'Failed to load groups. Please try again.',
        variant: 'destructive',
      });
      setGroups([]);
      setCenters([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGroupMembers = async (groupId: string) => {
    setIsLoadingMembers(true);
    try {
      // Fetch group members from API
      const result = await apiClient.get<GroupMember[]>(`/groups/${groupId}/members`);
      if (result.success && result.data) {
        setGroupMembers(result.data);
      } else {
        setGroupMembers([]);
      }
    } catch (error) {
      console.error('Error fetching group members:', error);
      setGroupMembers([]);
    } finally {
      setIsLoadingMembers(false);
    }
  };

  const handleAssignLeader = async (clientId: string, centerId: string) => {
    try {
      const result = await apiClient.patch(`/centers/${centerId}`, {
        centerLeaderId: clientId,
      });

      if (result.success) {
        toast({
          title: 'Success',
          description: 'Center Leader assigned successfully',
        });
        
        // Update local state for the preview group if it's the same center
        if (previewGroup && previewGroup.centerId === centerId) {
          setPreviewGroup({
            ...previewGroup,
            centerLeaderId: clientId,
          });
        }
        
        // Refresh groups list
        fetchGroups();
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to assign Center Leader',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error assigning center leader:', error);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  useEffect(() => {
    if (refreshRef) {
      refreshRef.current = fetchGroups;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRef, branchFilter]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      const result = await apiClient.delete(`/groups/${deleteId}`);
      if (result.success) {
        toast({
          title: 'Success',
          description: 'Group deleted successfully',
        });
        fetchGroups();
        setDeleteId(null);
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to delete group',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete group',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePreview = async (group: Group) => {
    setPreviewGroup(group);
    await fetchGroupMembers(group.id);
  };

  const filteredGroups = groups.filter((group) => {
    const matchesSearch = 
      group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (group.code ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.centerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.centerCode.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCenter = centerFilter === 'all' || group.centerId === centerFilter;
    const matchesStatus = statusFilter === 'all' || group.status === statusFilter;
    
    return matchesSearch && matchesCenter && matchesStatus;
  });

  // Calculate stats
  const totalGroups = groups.length;
  const activeGroups = groups.filter((g) => g.status === 'ACTIVE').length;
  const totalMembers = groups.reduce((sum, g) => sum + (g.memberCount || 0), 0);

  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="border-none shadow-xl bg-gradient-to-br from-primary to-primary text-white overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
            <CardContent className="p-6 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium mb-1">Total Groups</p>
                  <p className="text-4xl font-bold">{totalGroups}</p>
                </div>
                <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                  <FolderTree className="h-8 w-8" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <Card className="border-none shadow-xl bg-gradient-to-br from-green-500 to-green-600 text-white overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
            <CardContent className="p-6 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-medium mb-1">Active Groups</p>
                  <p className="text-4xl font-bold">{activeGroups}</p>
                </div>
                <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                  <Sparkles className="h-8 w-8" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <Card className="border-none shadow-xl bg-gradient-to-br from-purple-500 to-purple-600 text-white overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
            <CardContent className="p-6 relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-purple-100 text-sm font-medium mb-1">Total Members</p>
                  <p className="text-4xl font-bold">{totalMembers}</p>
                </div>
                <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                  <Users className="h-8 w-8" />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Main Content Card */}
      <Card className="border-none shadow-xl bg-white/80 backdrop-blur-md dark:bg-green-950/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-purple-500/5 to-pink-500/5 pointer-events-none" />
        <CardContent className="p-0 relative z-10">
          {/* Header with Filters */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-6 border-b border-primary/20 dark:border-sidebar-accent">
            <div>
              <h3 className="text-2xl font-bold text-foreground dark:text-white flex items-center gap-2">
                <FolderTree className="h-6 w-6 text-primary" />
                Groups Management
              </h3>
              <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                Create groups here — auto-numbered and named per center
              </p>
            </div>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              className="bg-primary hover:bg-sidebar-accent text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Group
            </Button>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-green-50/50 dark:bg-brand-green-darker/20 border-b border-primary/20 dark:border-sidebar-accent">
            <div className="flex flex-wrap items-center gap-3 w-full">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search groups, centers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 bg-white dark:bg-sidebar-accent border-primary/20 dark:border-sidebar-accent"
                />
              </div>

              {/* Branch Filter — only for roles with access to more than one branch.
                  Gated on `mounted`: isMultiBranchRole reads tokenStorage (localStorage),
                  which is unavailable during SSR — rendering this conditionally on it
                  directly would make the server always omit the filter while the
                  client's first paint already sees the real role, causing a hydration
                  mismatch. */}
              {mounted && isMultiBranchRole && (
                <Select
                  value={branchFilter}
                  onValueChange={setBranchFilter}
                  disabled={isLoadingBranches}
                >
                  <SelectTrigger className="h-10 w-[180px] bg-white dark:bg-sidebar-accent border-primary/20 dark:border-sidebar-accent">
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
              )}

              {/* Center Filter */}
              <Select value={centerFilter} onValueChange={setCenterFilter}>
                <SelectTrigger className="h-10 w-[180px] bg-white dark:bg-sidebar-accent border-primary/20 dark:border-sidebar-accent">
                  <SelectValue placeholder="Filter by center" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Centers</SelectItem>
                  {centers.map((center) => (
                    <SelectItem key={center.id} value={center.id}>
                      {center.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-[150px] bg-white dark:bg-sidebar-accent border-primary/20 dark:border-sidebar-accent">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>

              {/* Refresh Button */}
              <Button
                variant="outline"
                size="icon"
                onClick={fetchGroups}
                disabled={isLoading}
                className="h-10 w-10"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gradient-to-r from-primary to-primary hover:from-primary hover:to-primary border-none">
                  <TableHead className="text-white font-semibold h-12 pl-6">Group Name</TableHead>
                  <TableHead className="text-white font-semibold h-12">Center</TableHead>
                  <TableHead className="text-white font-semibold h-12">Members</TableHead>
                  <TableHead className="text-white font-semibold h-12">Status</TableHead>
                  <TableHead className="text-white font-semibold h-12">Created</TableHead>
                  <TableHead className="text-white font-semibold h-12 text-right pr-6">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <PageLoader label="Loading groups..." fullScreen={false} />
                    </TableCell>
                  </TableRow>
                ) : filteredGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <div className="flex flex-col items-center justify-center">
                        <div className="h-20 w-20 rounded-full bg-green-50 dark:bg-brand-green-darker/20 flex items-center justify-center mb-4">
                          <FolderTree className="h-10 w-10 text-primary" />
                        </div>
                        <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300 mb-1">
                          {searchQuery || branchFilter !== 'all' || centerFilter !== 'all' || statusFilter !== 'all'
                            ? 'No groups found'
                            : 'No groups yet'}
                        </p>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mb-4">
                          {searchQuery || branchFilter !== 'all' || centerFilter !== 'all' || statusFilter !== 'all'
                            ? 'Try adjusting your filters'
                            : 'Click "Add Group" above to create the first group for a center'}
                        </p>
                        {!(searchQuery || branchFilter !== 'all' || centerFilter !== 'all' || statusFilter !== 'all') && (
                          <Button
                            onClick={() => setCreateDialogOpen(true)}
                            className="bg-primary hover:bg-sidebar-accent text-white"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Group
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGroups.map((group, index) => (
                    <TableRow
                      key={group.id}
                      className={` border-b border-gray-100 dark:border-gray-800 transition-all duration-200 hover:bg-green-50/50 dark:hover:bg-brand-green-darker/10 hover:shadow-sm ${
                        index % 2 === 0 ? 'bg-white/50' : 'bg-gray-50/30'
                      }`}
                    >
                      <TableCell className="text-gray-900 dark:text-gray-100 font-semibold pl-6">
                        {group.code ? (
                          <span className="font-mono">{group.code}-{group.name}</span>
                        ) : group.name}
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-400">
                        <div>
                          <div className="font-medium text-gray-700 dark:text-gray-300">
                            {group.centerName}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {group.centerCode}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                            <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          </div>
                          <span className="font-semibold text-gray-700 dark:text-gray-300">
                            {group.memberCount || 0}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[group.status]}>
                          {group.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                        {toDisplayDate(new Date(group.createdAt))}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePreview(group)}
                            className="h-8 w-8 text-primary hover:text-sidebar-accent hover:bg-green-50 transition-colors"
                            aria-label="View group details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(group.id)}
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                            aria-label="Delete group"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create Group Dialog */}
      <CreateGroupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={fetchGroups}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this group? This action cannot be undone. All members
              will be unassigned from this group.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewGroup} onOpenChange={() => setPreviewGroup(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground dark:text-white flex items-center gap-2">
              <FolderTree className="h-6 w-6 text-primary" />
              Group Details
            </DialogTitle>
            <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
              View comprehensive group information and member details
            </DialogDescription>
          </DialogHeader>

          {previewGroup && (
            <div className="space-y-6 py-4">
              {/* Basic Information */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Basic Information
                </h4>
                <div className="grid grid-cols-1 gap-4">
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
                    <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">
                      Status
                    </p>
                    <Badge variant="outline" className={statusColors[previewGroup.status]}>
                      {previewGroup.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Group ID
                    </p>
                    <p className="text-sm font-mono text-foreground dark:text-slate-100">
                      {previewGroup.code ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Group Name
                    </p>
                    <p className="text-lg font-semibold text-foreground dark:text-slate-100">
                      {previewGroup.name}
                    </p>
                  </div>
                </div>
              </div>

              {/* Center Information */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-green-600" />
                  Center Information
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Center Name
                    </p>
                    <p className="text-sm font-medium text-foreground dark:text-slate-100">
                      {previewGroup.centerName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Center Code
                    </p>
                    <p className="text-sm font-mono text-foreground dark:text-slate-100">
                      {previewGroup.centerCode}
                    </p>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-orange-600" />
                  Metadata
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                      Created On
                    </p>
                    <p className="text-sm text-foreground dark:text-slate-100">
                      {toDisplayDate(new Date(previewGroup.createdAt))}
                    </p>
                    <p className="text-xs text-sidebar-accent dark:text-slate-400">
                      {new Date(previewGroup.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  {previewGroup.createdBy && (
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                        Created By
                      </p>
                      <p className="text-sm text-foreground dark:text-slate-100">
                        {previewGroup.createdBy.firstName} {previewGroup.createdBy.lastName}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Members List */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 border-b pb-2 flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-600" />
                  Group Members ({previewGroup.memberCount || 0})
                </h4>
                {isLoadingMembers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-sidebar-accent">Loading members...</span>
                  </div>
                ) : groupMembers.length === 0 ? (
                  <div className="text-center py-8 bg-green-50 dark:bg-brand-green-darker/20 rounded-lg border border-dashed border-primary/30 dark:border-sidebar-accent">
                    <UserPlus className="h-10 w-10 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-sidebar-accent dark:text-slate-400">
                      No members in this group yet
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupMembers.map((member, idx) => (
                      <div
                        key={member.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          idx === 0
                            ? 'bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 border-amber-200 dark:border-amber-800 shadow-sm'
                            : 'bg-green-50 dark:bg-brand-green-darker/20 border-primary/20 dark:border-sidebar-accent hover:bg-brand-green-tint dark:hover:bg-sidebar-accent/30'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-semibold ${
                              idx === 0
                                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 shadow-md'
                                : 'bg-gradient-to-br from-primary to-purple-500'
                            }`}
                          >
                            {idx === 0 ? <Crown className="h-5 w-5" /> : idx + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground dark:text-slate-100">
                                {member.clientName}
                              </p>
                              {previewGroup.centerLeaderId === member.clientDbId && (
                                <Badge className="bg-gradient-to-r from-amber-500 to-yellow-500 text-white border-0 text-xs flex items-center gap-1">
                                  <Crown className="h-3 w-3" />
                                  Center Leader
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-sidebar-accent dark:text-slate-400 font-mono">
                              ID: {member.clientId}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {member.phone && (
                            <p className="text-sm text-sidebar-accent dark:text-slate-300 font-mono">
                              {member.phone}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            Joined: {toDisplayDate(new Date(member.joinedDate))}
                          </p>
                        </div>
                        {previewGroup.centerLeaderId !== member.clientDbId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-4 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            onClick={() => handleAssignLeader(member.clientDbId, previewGroup.centerId)}
                          >
                            <Crown className="h-4 w-4 mr-2" />
                            Set as Leader
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewGroup(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}