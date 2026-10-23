'use client';

import { useState, useEffect, useCallback } from 'react';
import { SelfAccountsForm, SelfAccountsFormData } from './SelfAccountsForm';
import { SelfAccountsTable, SelfAccountsRow } from './SelfAccountsTable';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, Layers } from 'lucide-react';

export function SelfAccountsPage() {
    const [rows, setRows] = useState<SelfAccountsRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState<SelfAccountsFormData & { id?: string } | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        id: string | null;
        name: string;
    }>({
        open: false,
        id: null,
        name: '',
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    // Fetch Accounts
    const fetchAccounts = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<SelfAccountsRow[]>('/accounts/self');
            if (result.success && result.data) {
                setRows(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to fetch self accounts',
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
        fetchAccounts();
    }, [fetchAccounts]);

    const handleSave = async (data: SelfAccountsFormData) => {
        try {
            if (selectedAccount?.id) {
                // UPDATE
                const result = await apiClient.put(`/accounts/self/${selectedAccount.id}`, data);

                if (result.success) {
                    toast({ title: 'Success', description: 'Account updated successfully.' });
                    fetchAccounts();
                    setSelectedAccount(null);
                } else {
                    toast({ title: 'Update Failed', description: result.error, variant: 'destructive' });
                }
            } else {
                // CREATE
                const result = await apiClient.post('/accounts/self', data);

                if (result.success) {
                    toast({ title: 'Success', description: 'Account created successfully.' });
                    fetchAccounts();
                    // Form inside handles reset, but if we want to force reset or scroll we can do it here.
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
        const account = rows.find((row) => row.id === id);
        if (account) {
            setSelectedAccount({ ...account, type: account.type ?? '' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleDeleteClick = (id: string) => {
        const account = rows.find((row) => row.id === id);
        if (account) {
            setDeleteConfirmation({
                open: true,
                id,
                name: account.name,
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.id) return;

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/accounts/self/${deleteConfirmation.id}`);

            if (result.success) {
                toast({
                    title: 'Deleted',
                    description: `Account "${deleteConfirmation.name}" deleted.`,
                });
                fetchAccounts();
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete account',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast({ title: 'Error', description: 'Failed to delete account', variant: 'destructive' });
        } finally {
            setIsDeleting(false);
            setDeleteConfirmation({ open: false, id: null, name: '' });
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
                                Self Accounts
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                Manage your self accounts
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
                                    {selectedAccount ? 'Edit Account Details' : 'New Account Details'}
                                </CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <SelfAccountsForm
                                initialData={selectedAccount || undefined}
                                onSave={handleSave}
                            />
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
                            <SelfAccountsTable
                                rows={rows}
                                onEdit={handleEdit}
                                onDelete={handleDeleteClick}
                                onCreateNew={() => {
                                    setSelectedAccount(null);
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
                title="Delete Account"
                description={`Are you sure you want to delete "${deleteConfirmation.name}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
