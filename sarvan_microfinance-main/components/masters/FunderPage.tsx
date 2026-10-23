'use client';

import { useState, useEffect, useCallback } from 'react';
import { FunderForm, FunderFormData } from './FunderForm';
import { FunderTable, FunderRow } from './FunderTable';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Wallet } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

export function FunderPage() {
    const { canPage } = usePermission();
    const canCreate = canPage('/dashboard/masters/funder', 'add');
    const canDelete = canPage('/dashboard/masters/funder', 'delete');
    const [funders, setFunders] = useState<FunderRow[]>([]);
    const [glAccounts, setGlAccounts] = useState<{ id: string, name: string, type: string }[]>([]);
    const [selectedFunder, setSelectedFunder] = useState<FunderFormData | null>(null);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        funderId: string | null;
        funderName: string;
    }>({
        open: false,
        funderId: null,
        funderName: '',
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedFunders } = useTableSearch(funders);

    const fetchDropdownData = useCallback(async () => {
        try {
            const response = await apiClient.get<any[]>('/masters/gl');
            if (response.success && response.data) {
                setGlAccounts(response.data.map((gl: any) => ({
                    id: gl.glId,
                    name: gl.glName,
                    type: gl.glType
                })));
            }
        } catch (error) {
            console.error('Error fetching GL accounts:', error);
        }
    }, []);

    const fetchFunders = useCallback(async (quiet = false) => {
        if (!quiet) setIsRefreshing(true);
        try {
            const response = await apiClient.get<any[]>('/masters/funder');
            if (response.success && response.data) {
                setFunders(response.data);
            } else {
                toast({
                    title: 'Sync Failed',
                    description: response.error || 'Failed to fetch funders from registry.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching funders:', error);
            toast({
                title: 'Network Error',
                description: 'Unable to connect to the master registry.',
                variant: 'destructive',
            });
        } finally {
            setIsInitialLoading(false);
            setIsRefreshing(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchDropdownData();
        fetchFunders();
    }, [fetchDropdownData, fetchFunders]);

    const handleSave = async (data: FunderFormData) => {
        try {
            const isUpdate = !!data.funderId;
            const response = isUpdate
                ? await apiClient.put('/masters/funder', data)
                : await apiClient.post('/masters/funder', data);

            if (response.success) {
                toast({
                    title: isUpdate ? 'Revision Committed' : 'Record Created',
                    description: `Funder details for "${data.funderName}" have been secured.`,
                });
                setSelectedFunder(null);
                fetchFunders(true);
            } else {
                toast({
                    title: 'Submission Blocked',
                    description: response.error || 'The system was unable to process the funder record.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Critical Failure',
                description: 'A system error occurred during the save operation.',
                variant: 'destructive',
            });
        }
    };

    const handleDeleteInitiate = async (funderId: string) => {
        const funder = funders.find(f => f.funderId === funderId);
        if (funder) {
            setDeleteConfirmation({
                open: true,
                funderId,
                funderName: funder.funderName
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.funderId) return;

        setIsDeleting(true);
        try {
            const response = await apiClient.delete(`/masters/funder?funderId=${deleteConfirmation.funderId}`);
            if (response.success) {
                toast({
                    title: 'Record Terminated',
                    description: `"${deleteConfirmation.funderName}" has been successfully removed from the registry.`,
                });
                setSelectedFunder(null);
                setDeleteConfirmation({ open: false, funderId: null, funderName: '' });
                fetchFunders(true);
            } else {
                toast({
                    title: 'Deletion Failed',
                    description: response.error || 'The record could not be removed.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'System Error',
                description: 'Failed to process deletion request.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSelectFunder = (funderId: string) => {
        const funder = funders.find(f => f.funderId === funderId) as any;
        if (funder) {
            setSelectedFunder({
                funderId: funder.funderId,
                funderName: funder.funderName,
                principleGL: funder.principalGLId,
                interestGL: funder.interestGLId,
                interestPercent: String(funder.interestPercent),
                tdsPercent: String(funder.tdsPercent),
            });
            // Smooth scroll to form
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    if (isInitialLoading) {
        return <PageLoader fullScreen={false} label="Initializing Master Data" />;
    }

    return (
        <div className="relative min-h-screen px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">

                {/* Premium Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <Wallet className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Funder Master
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                Manage funding sources, GL mappings, and taxation parameters.
                            </p>
                        </div>
                    </div>
                    <div className="p-2.5 bg-white dark:bg-brand-green-darker rounded-xl shadow-sm border border-primary/20 dark:border-sidebar-accent cursor-pointer hover:bg-green-50 transition-colors" onClick={() => fetchFunders()}>
                        <RefreshCw className={cn("w-5 h-5 text-sidebar-accent dark:text-slate-400", isRefreshing && "animate-spin text-primary")} />
                    </div>
                </div>

                {canCreate && (
                    <FunderForm
                        initialData={selectedFunder || undefined}
                        onSave={handleSave}
                        onDelete={canDelete ? handleDeleteInitiate : undefined}
                        glAccounts={glAccounts}
                    />
                )}

                <div className="mt-8 flex justify-end">
                    <TableSearchInput
                        value={tableSearchQuery}
                        onChange={setTableSearchQuery}
                        placeholder="Search funders..."
                    />
                </div>

                <FunderTable
                    rows={searchedFunders}
                    selectedFunderId={selectedFunder?.funderId}
                    onSelect={handleSelectFunder}
                />
            </div>

            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) =>
                    setDeleteConfirmation((prev) => ({ ...prev, open }))
                }
                onConfirm={handleDeleteConfirm}
                title="Irreversible Action"
                description={`You are about to permanently archive the funder record for "${deleteConfirmation.funderName}". Are you absolutely certain?`}
                confirmText="Execute Deletion"
                cancelText="Abort"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
