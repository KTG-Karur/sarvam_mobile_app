'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { CenterForm } from '@/components/centers/CenterForm';
import { CenterList } from '@/components/centers/CenterList';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { usePermission } from '@/app/hooks/usePermission';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

interface Center {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    fdoId?: string;
    formationDate?: string;
    meetingDay?: string;
    meetingTime?: string;
    meetingPlace?: string;
    latitude?: string;
    longitude?: string;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
}

export default function CreateCenterPage() {
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [editingCenter, setEditingCenter] = useState<Center | null>(null);
    const refreshListRef = useRef<(() => void) | null>(null);

    // ── Page-level permission checks ────────────────────────────────────────
    const { canPage } = usePermission();
    const canCreate = canPage('/dashboard/centers/create-center', 'add');
    const canEdit   = canPage('/dashboard/centers/create-center', 'edit');

    const handleCenterCreated = () => {
        setIsFormVisible(false);
        if (refreshListRef.current) {
            refreshListRef.current();
        }
    };

    const handleEditCenter = (center: Center) => {
        if (!canEdit) return;
        setEditingCenter(center);
        setIsFormVisible(true);
    };

    const handleCancel = () => {
        setIsFormVisible(false);
        setEditingCenter(null);
    };

    const handleCenterUpdated = () => {
        setIsFormVisible(false);
        setEditingCenter(null);
        if (refreshListRef.current) {
            refreshListRef.current();
        }
    };

    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                {/* Header */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
                    <div>
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Center Management
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            {canCreate
                                ? 'Create, view, edit, and manage centers. Each center must have a unique code.'
                                : 'Review and manage centers. Contact your administrator to request create access.'}
                        </p>
                    </div>
                    {canCreate && !isFormVisible && (
                        <Button onClick={() => setIsFormVisible(true)} size="sm" className="w-full sm:w-auto">
                            <Plus className="mr-2 h-4 w-4" />
                            Create New Center
                        </Button>
                    )}
                </div>

                {/* Create/Edit Form Dialog */}
                {(canCreate || canEdit) && (
                    <Dialog
                        open={isFormVisible}
                        onOpenChange={(open) => {
                            if (open) {
                                setIsFormVisible(true);
                            } else {
                                handleCancel();
                            }
                        }}
                    >
                        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 border-0 shadow-2xl rounded-2xl bg-green-50 dark:bg-green-950">
                            <DialogHeader className="p-6 pb-4 border-b bg-white dark:bg-brand-green-darker sticky top-0 z-10">
                                <DialogTitle className="text-xl flex items-center justify-between">
                                    {editingCenter ? 'Edit Center' : 'Create New Center'}
                                </DialogTitle>
                                <DialogDescription>
                                    {editingCenter
                                        ? 'Update center information and settings below.'
                                        : 'Fill in the details to create a new center.'}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="p-6">
                                <CenterForm
                                    key={editingCenter?.id ?? 'new'}
                                    initialData={editingCenter || undefined}
                                    onSuccess={editingCenter ? handleCenterUpdated : handleCenterCreated}
                                    onCancel={handleCancel}
                                    variant="compact"
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                )}

                {/* Center List — pass permission flags so it shows/hides action buttons */}
                <CenterList
                    refreshRef={refreshListRef}
                    onEdit={canEdit ? handleEditCenter : undefined}
                />
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
