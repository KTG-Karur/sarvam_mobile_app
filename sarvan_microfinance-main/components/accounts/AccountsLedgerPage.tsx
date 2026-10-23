'use client';

import { useState, useEffect, useCallback } from 'react';
import { AccountsLedgerForm, AccountsLedgerFormData } from './AccountsLedgerForm';
import { AccountsLedgerTable, AccountsLedgerRow } from './AccountsLedgerTable';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, Layers } from 'lucide-react';

export function AccountsLedgerPage() {
    const [ledgerRows, setLedgerRows] = useState<AccountsLedgerRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedLedger, setSelectedLedger] = useState<AccountsLedgerFormData & { id?: string } | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        id: string | null;
        ledgerName: string;
    }>({
        open: false,
        id: null,
        ledgerName: '',
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const [accountGroups, setAccountGroups] = useState<Array<{ id: string; name: string; parentGroupId: string; parentGroupName: string }>>([]);
    const { toast } = useToast();

    // Fetch Account Groups
    const fetchAccountGroups = useCallback(async () => {
        try {
            const result = await apiClient.get<any[]>('/accounts/groups');
            if (result.success && result.data) {
                // Ledgers are only ever grouped under a non-primary (child) group —
                // the primary/root groups (Assets, Liabilities, Income, Expenses)
                // exist purely to organize sub-groups and aren't selectable here.
                const groups = result.data
                    .filter((g) => !g.isPrimary && g.parentGroup)
                    .map((g) => ({
                        id: g.groupId,
                        name: g.groupName,
                        parentGroupId: g.parentGroup.groupId,
                        parentGroupName: g.parentGroup.groupName,
                    }));
                setAccountGroups(groups);
            }
        } catch (error) {
            console.error('Fetch groups error:', error);
        }
    }, []);

    // Fetch Ledgers
    const fetchLedgers = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<any[]>('/accounts/ledgers');
            if (result.success && result.data) {
                const rows: AccountsLedgerRow[] = result.data.map((l) => ({
                    id: l.id,
                    ledgerId: l.ledgerId,
                    ledgerName: l.ledgerName,
                    groupId: l.groupId,
                    parentGroup: l.parentGroupName || 'N/A',
                    primaryGroup: l.primaryGroupName || 'N/A',
                    allowTo: l.allowAccessTo as ('H.O' | 'B.O')[],
                    hasTransactions: l.hasTransactions || false,
                }));
                setLedgerRows(rows);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch account ledgers',
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
        fetchAccountGroups();
        fetchLedgers();
    }, [fetchAccountGroups, fetchLedgers]);

    // Calculate next Ledger ID
    const getNextLedgerId = () => {
        if (ledgerRows.length === 0) return 1;

        const numericIds = ledgerRows
            .map(r => parseInt(r.ledgerId, 10))
            .filter(n => !isNaN(n));

        return numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
    };

    const nextLedgerId = getNextLedgerId();

    const handleSave = async (data: AccountsLedgerFormData & { id?: string }) => {
        try {
            if (selectedLedger?.id) {
                // UPDATE
                const result = await apiClient.put(`/accounts/ledgers/${selectedLedger.id}`, {
                    ledgerName: data.ledgerName,
                    groupedUnder: data.groupedUnder,
                    allowAccessTo: data.allowAccessTo
                });

                if (result.success) {
                    toast({ title: 'Success', description: 'Ledger updated successfully.' });
                    fetchLedgers();
                    setSelectedLedger(null);
                } else {
                    toast({ title: 'Update Failed', description: result.error, variant: 'destructive' });
                }
            } else {
                // CREATE
                const result = await apiClient.post('/accounts/ledgers', {
                    ledgerName: data.ledgerName,
                    groupedUnder: data.groupedUnder,
                    allowAccessTo: data.allowAccessTo
                });

                if (result.success) {
                    toast({ title: 'Success', description: 'Ledger created successfully.' });
                    fetchLedgers();
                } else {
                    toast({ title: 'Creation Failed', description: result.error, variant: 'destructive' });
                }
            }

        } catch (error) {
            console.error('Save error:', error);
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        }
    };

    const handleEdit = (id: string) => {
        const ledger = ledgerRows.find((row) => row.id === id);
        if (ledger) {
            setSelectedLedger({
                id: ledger.id,
                ledgerId: ledger.ledgerId,
                ledgerName: ledger.ledgerName,
                groupedUnder: ledger.groupId,
                allowAccessTo: ledger.allowTo,
                hasTransactions: ledger.hasTransactions,
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleDeleteClick = (id: string) => {
        const ledger = ledgerRows.find((row) => row.id === id);
        if (ledger) {
            setDeleteConfirmation({
                open: true,
                id,
                ledgerName: ledger.ledgerName,
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.id) return;

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/accounts/ledgers/${deleteConfirmation.id}`);

            if (result.success) {
                toast({
                    title: 'Deleted',
                    description: `Ledger "${deleteConfirmation.ledgerName}" deleted.`,
                });
                fetchLedgers();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete ledger',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast({ title: 'Error', description: 'Failed to delete ledger', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
            setDeleteConfirmation({ open: false, id: null, ledgerName: '' });
        }
    };

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px] space-y-6">
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Page Header */}
                    <div className="flex items-center gap-3 mb-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg">
                            <BookOpen className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground dark:text-white">
                                Accounts Ledger
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                Manage your account ledgers and classifications
                            </p>
                        </div>
                    </div>

                    {/* Form Card */}
                    <Card className="border-primary/20 bg-white shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
                        <CardHeader className="border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-sidebar-accent/50">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-tint text-primary dark:bg-brand-green-darker/30 dark:text-primary">
                                    <Layers className="h-4 w-4" />
                                </div>
                                <CardTitle className="text-base font-semibold text-foreground dark:text-white">
                                    {selectedLedger ? 'Edit Ledger Details' : 'New Ledger Details'}
                                </CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {isLoading && accountGroups.length === 0 ? (
                                <div className="space-y-4">
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-10 w-full" />
                                    <Skeleton className="h-10 w-full" />
                                </div>
                            ) : (
                                <AccountsLedgerForm
                                    initialData={selectedLedger || undefined}
                                    accountGroups={accountGroups}
                                    nextLedgerId={nextLedgerId}
                                    onSave={handleSave}
                                />
                            )}
                        </CardContent>
                    </Card>

                    {/* Table Section */}
                    <div className="w-full">
                        {isLoading ? (
                            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                                <CardContent className="p-6">
                                    <div className="space-y-4">
                                        <div className="flex justify-between">
                                            <Skeleton className="h-10 w-48" />
                                            <Skeleton className="h-10 w-32" />
                                        </div>
                                        <div className="space-y-2">
                                            <Skeleton className="h-12 w-full" />
                                            <Skeleton className="h-12 w-full" />
                                            <Skeleton className="h-12 w-full" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <AccountsLedgerTable
                                rows={ledgerRows}
                                onEdit={handleEdit}
                                onDelete={handleDeleteClick}
                                onCreateNew={() => {
                                    setSelectedLedger(null);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) =>
                    setDeleteConfirmation((prev) => ({ ...prev, open }))
                }
                onConfirm={handleDeleteConfirm}
                title="Delete Accounts Ledger"
                description={`Are you sure you want to delete "${deleteConfirmation.ledgerName}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
