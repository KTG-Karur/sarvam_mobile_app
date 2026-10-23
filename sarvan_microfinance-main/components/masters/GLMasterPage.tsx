'use client';

import { useState, useEffect, useCallback } from 'react';
import { GLMasterForm, GLMasterFormData } from './GLMasterForm';
import { GLMasterTable, GLMasterRow } from './GLMasterTable';
import { GLMasterPreviewDialog, GLMasterDetails } from './GLMasterPreviewDialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermission } from '@/app/hooks/usePermission';

export function GLMasterPage() {
    const { canPage } = usePermission();
    const canCreate = canPage('/dashboard/masters/gl', 'add');
    const canEdit   = canPage('/dashboard/masters/gl', 'edit');
    const canDelete = canPage('/dashboard/masters/gl', 'delete');
    const [glRows, setGlRows] = useState<GLMasterRow[]>([]);
    const [editingRow, setEditingRow] = useState<GLMasterRow | null>(null);
    const [previewGL, setPreviewGL] = useState<GLMasterDetails | null>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [deleteConfirmation, setDeleteConfirmation] = useState<{
        open: boolean;
        glId: string | null;
        glName: string;
    }>({
        open: false,
        glId: null,
        glName: '',
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const { toast } = useToast();

    const fetchGLAccounts = useCallback(async () => {
        try {
            const response = await fetch('/api/masters/gl');
            const data = await response.json();
            if (data.success) {
                setGlRows(data.data);
            } else {
                toast({
                    title: 'Error',
                    description: data.message || 'Failed to fetch GL accounts',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching GL accounts:', error);
            toast({
                title: 'Error',
                description: 'Failed to connect to the server',
                variant: 'destructive',
            });
        } finally {
            setIsInitialLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchGLAccounts();
    }, [fetchGLAccounts]);

    const handleSave = async (data: GLMasterFormData) => {
        try {
            const isUpdate = !!data.glId && glRows.some(row => row.glId === data.glId);
            const method = isUpdate ? 'PUT' : 'POST';

            const response = await fetch('/api/masters/gl', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            const result = await response.json();

            if (result.success) {
                fetchGLAccounts();
                setEditingRow(null);
                toast({
                    title: isUpdate ? 'GL Account Updated' : 'GL Account Created',
                    description: `Account "${data.glName}" has been saved successfully.`,
                });
            } else {
                toast({
                    title: 'Save Failed',
                    description: result.message || 'Could not save GL account',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error saving GL account:', error);
            toast({
                title: 'Error',
                description: 'Failed to save GL account due to a network error',
                variant: 'destructive',
            });
        }
    };

    const handleDeleteClick = (glId: string) => {
        const gl = glRows.find((row) => row.glId === glId);
        if (gl) {
            setDeleteConfirmation({
                open: true,
                glId,
                glName: gl.glName,
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirmation.glId) return;

        setIsDeleting(true);
        try {
            const response = await fetch(`/api/masters/gl?glId=${deleteConfirmation.glId}`, {
                method: 'DELETE',
            });

            const result = await response.json();

            if (result.success) {
                setGlRows(glRows.filter((row) => row.glId !== deleteConfirmation.glId));
                toast({
                    title: 'GL Account Deleted',
                    description: `Account "${deleteConfirmation.glName}" has been removed.`,
                    variant: 'destructive',
                });
            } else {
                toast({
                    title: 'Delete Failed',
                    description: result.message || 'Could not delete GL account',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting GL account:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete GL account due to a network error',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
            setDeleteConfirmation({ open: false, glId: null, glName: '' });
        }
    };

    const handleEdit = (row: GLMasterRow) => {
        setEditingRow(row);
        // Scroll to top to see the form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handlePreview = (glId: string) => {
        const gl = glRows.find((row) => row.glId === glId);
        if (gl) {
            setPreviewGL({
                glId: gl.glId,
                glName: gl.glName,
                glType: gl.glType,
                description: gl.description,
            });
            setIsPreviewOpen(true);
        }
    };

    if (isInitialLoading) {
        return <PageLoader label="Loading GL Master..." />;
    }

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-6 py-10">
                <div className="mx-auto max-w-7xl">
                    {/* Background Decorative Elements */}
                    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                        <div className="absolute left-[10%] top-[10%] h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
                        <div className="absolute right-[10%] bottom-[10%] h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
                    </div>

                    {/* Form Section — visible only if role has masters:create or masters:edit */}
                    {(canCreate || (canEdit && editingRow)) && (
                        <div className="flex justify-center mb-12">
                            <GLMasterForm
                                initialData={editingRow ? {
                                    glId: editingRow.glId,
                                    glName: editingRow.glName,
                                    glType: editingRow.glType,
                                    description: editingRow.description
                                } : undefined}
                                onSave={handleSave}
                            />
                        </div>
                    )}

                    {/* Table Section — onDelete/onEdit only passed based on permissions */}
                    <GLMasterTable
                        rows={glRows}
                        onPreview={handlePreview}
                        onDelete={canDelete ? handleDeleteClick : undefined}
                        onEdit={canEdit ? handleEdit : undefined}
                    />
                </div>
            </div>

            {/* Preview Dialog */}
            <GLMasterPreviewDialog
                open={isPreviewOpen}
                onOpenChange={setIsPreviewOpen}
                gl={previewGL}
                onEdit={(glId) => {
                    const gl = glRows.find(r => r.glId === glId);
                    if (gl) handleEdit(gl);
                }}
            />

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteConfirmation.open}
                onOpenChange={(open) =>
                    setDeleteConfirmation((prev) => ({ ...prev, open }))
                }
                onConfirm={handleDeleteConfirm}
                title="Delete GL Account"
                description={`Warning: Deleting "${deleteConfirmation.glName}" may affect linked financial products. Are you sure you want to proceed?`}
                confirmText="Permanently Delete"
                cancelText="Keep Account"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}
