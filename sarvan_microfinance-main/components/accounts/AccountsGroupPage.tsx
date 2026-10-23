'use client';

import { useState, useEffect, useCallback } from 'react';
import { AccountsGroupForm, AccountsGroupFormData } from './AccountsGroupForm';
import { AccountsGroupTable, AccountsGroupRow } from './AccountsGroupTable';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

// Orders groups depth-first by parentGroupId (which references groupId) so that
// every sub-group is listed directly beneath its real parent, with its nesting depth.
function buildHierarchicalGroups(rows: AccountsGroupRow[]): Array<AccountsGroupRow & { depth: number }> {
    const byParent = new Map<string | null, AccountsGroupRow[]>();
    rows.forEach((row) => {
        const key = row.parentGroupId;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key)!.push(row);
    });

    const ordered: Array<AccountsGroupRow & { depth: number }> = [];
    const visit = (parentId: string | null, depth: number) => {
        (byParent.get(parentId) || []).forEach((row) => {
            ordered.push({ ...row, depth });
            visit(row.groupId, depth + 1);
        });
    };
    visit(null, 0);
    return ordered;
}

export function AccountsGroupPage() {
    const [groupRows, setGroupRows] = useState<AccountsGroupRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedGroup, setSelectedGroup] = useState<AccountsGroupFormData & { id?: string } | null>(null);
    const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        id: string | null; // CUID
        groupName: string;
    }>({
        open: false,
        id: null,
        groupName: '',
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    // Fetch Groups
    const fetchGroups = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<any[]>('/accounts/groups');
            if (result.success && result.data) {
                // Transform API response to UI model
                const rows: AccountsGroupRow[] = result.data.map((g) => ({
                    id: g.id, // CUID
                    groupId: g.groupId, // Custom ID
                    groupName: g.groupName,
                    parentGroupId: g.parentGroupId,
                    parentGroupName: g.parentGroup?.groupName || null,
                    allowSubGroups: g.allowSubGroups,
                    isPrimary: g.isPrimary,
                    isSystemGroup: g.isSystemGroup,
                    subGroupsCount: g.subGroupsCount || 0,
                    ledgersCount: g.ledgersCount || 0
                }));
                setGroupRows(rows);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch account groups',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Fetch error:', error);
            toast({
                title: 'Error',
                description: 'Failed to load data',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    // Calculate next Group ID (Custom numeric ID)
    // Finding the max numeric groupId to suggest the next one
    const getNextGroupId = () => {
        if (groupRows.length === 0) return 1;

        const numericIds = groupRows
            .map(r => parseInt(r.groupId, 10))
            .filter(n => !isNaN(n));

        return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
    };

    const nextGroupId = getNextGroupId();

    // Get parent groups for dropdown (groups that allow sub-groups), ordered so
    // each sub-group is listed directly beneath its real parent (depth-first).
    const allParentGroups = buildHierarchicalGroups(groupRows)
        .filter((row) => row.allowSubGroups)
        .map((row) => ({
            id: row.groupId, // Use Custom ID for logic referencing
            name: row.groupName,
            isPrimary: row.isPrimary,
            parentGroupName: row.parentGroupName,
            depth: row.depth,
        }));

    const handleSave = async (data: AccountsGroupFormData & { id?: string }) => {
        try {
            if (data.id) {
                // UPDATE
                const result = await apiClient.put(`/accounts/groups/${data.id}`, {
                    groupName: data.groupName,
                    parentGroupId: data.parentGroupId,
                    allowSubGroups: data.allowSubGroups
                });

                if (result.success) {
                    toast({ title: 'Success', description: 'Group updated successfully.' });
                    fetchGroups();
                } else {
                    toast({ title: 'Update Failed', description: result.error, variant: 'destructive' });
                }
            } else {
                // CREATE
                const result = await apiClient.post('/accounts/groups', {
                    groupId: data.groupId,
                    groupName: data.groupName,
                    parentGroupId: data.parentGroupId,
                    allowSubGroups: data.allowSubGroups
                });

                if (result.success) {
                    toast({ title: 'Success', description: 'Group created successfully.' });
                    fetchGroups();
                } else {
                    toast({ title: 'Creation Failed', description: result.error, variant: 'destructive' });
                }
            }

            // Close dialog
            setIsFormDialogOpen(false);
            setSelectedGroup(null);

        } catch (error) {
            console.error('Save error:', error);
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        }
    };

    const handleDeleteClick = (id: string) => { // id is CUID here
        const group = groupRows.find((row) => row.id === id);
        if (group) {
            setDeleteConfirmation({
                open: true,
                id: id,
                groupName: group.groupName,
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.id) return;

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/accounts/groups/${deleteConfirmation.id}`);

            if (result.success) {
                toast({
                    title: 'Deleted',
                    description: `Group "${deleteConfirmation.groupName}" deleted.`,
                });
                fetchGroups();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete group',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast({ title: 'Error', description: 'Failed to delete group', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
            setDeleteConfirmation({ open: false, id: null, groupName: '' });
        }
    };

    const handleCreateNew = () => {
        setSelectedGroup(null);
        setIsFormDialogOpen(true);
    };

    const handleEdit = (id: string) => { // id is CUID
        const group = groupRows.find((row) => row.id === id);
        if (group) {
            setSelectedGroup({
                id: group.id, // Store CUID for update
                groupId: group.groupId,
                groupName: group.groupName,
                parentGroupId: group.parentGroupId,
                allowSubGroups: group.allowSubGroups,
            });
            setIsFormDialogOpen(true);
        }
    };

    const handleDialogClose = (open: boolean) => {
        setIsFormDialogOpen(open);
        if (!open) {
            setSelectedGroup(null);
        }
    };

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px]">
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Table Section */}
                    <div className="w-full">
                        {isLoading ? (
                            <div className="space-y-4">
                                <div className="flex justify-between">
                                    <Skeleton className="h-10 w-48" />
                                    <Skeleton className="h-10 w-32" />
                                </div>
                                <div className="rounded-md border border-primary/20 bg-white p-4">
                                    <div className="space-y-2">
                                        <Skeleton className="h-12 w-full" />
                                        <Skeleton className="h-12 w-full" />
                                        <Skeleton className="h-12 w-full" />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <AccountsGroupTable
                                rows={groupRows}
                                onEdit={handleEdit}
                                onDelete={handleDeleteClick}
                                onCreateNew={handleCreateNew}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Create/Edit Form Dialog */}
            <Dialog open={isFormDialogOpen} onOpenChange={handleDialogClose}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold text-foreground dark:text-white">
                            {selectedGroup ? 'Edit Account Group' : 'Create New Account Group'}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400">
                            {selectedGroup
                                ? 'Update the account group details below.'
                                : 'Fill in the details to create a new account group.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-4">
                        <AccountsGroupForm
                            initialData={selectedGroup || undefined}
                            parentGroups={allParentGroups}
                            nextGroupId={nextGroupId}
                            onSave={handleSave}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) =>
                    setDeleteConfirmation((prev) => ({ ...prev, open }))
                }
                onConfirm={handleDeleteConfirm}
                title="Delete Account Group"
                description={`Are you sure you want to delete "${deleteConfirmation.groupName}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
