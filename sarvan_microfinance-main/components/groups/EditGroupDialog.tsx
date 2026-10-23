'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Edit, Sparkles, CheckCircle2, FolderTree } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { motion, AnimatePresence } from 'framer-motion';

// Validation schema
const editGroupSchema = z.object({
    name: z.string().min(1, 'Group name is required').max(200, 'Group name is too long'),
});

type EditGroupFormData = z.infer<typeof editGroupSchema>;

interface Group {
    id: string;
    name: string;
    centerId: string;
    centerName: string;
    centerCode: string;
}

interface EditGroupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    group: Group | null;
    onSuccess?: () => void;
}

export function EditGroupDialog({ open, onOpenChange, group, onSuccess }: EditGroupDialogProps) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
        reset,
        setValue,
    } = useForm<EditGroupFormData>({
        resolver: zodResolver(editGroupSchema),
        defaultValues: {
            name: '',
        },
    });

    // Update form when group changes
    useEffect(() => {
        if (group && open) {
            setValue('name', group.name);
            setShowSuccess(false);
        }
    }, [group, open, setValue]);

    const onSubmit = async (data: EditGroupFormData) => {
        if (!group) return;

        setIsSubmitting(true);
        try {
            const result = await apiClient.put(`/groups/${group.id}`, {
                name: data.name.trim(),
            });

            if (result.success) {
                setShowSuccess(true);

                // Wait for animation then close
                setTimeout(() => {
                    toast({
                        title: 'Success',
                        description: 'Group updated successfully!',
                    });
                    reset();
                    onOpenChange(false);
                    onSuccess?.();
                    setShowSuccess(false);
                }, 1500);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to update group. Please try again.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error updating group:', error);
            toast({
                title: 'Error',
                description: 'Failed to update group. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        if (!isSubmitting) {
            reset();
            onOpenChange(false);
        }
    };

    if (!group) return null;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[550px] overflow-hidden">
                <AnimatePresence mode="wait">
                    {showSuccess ? (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="flex flex-col items-center justify-center py-12"
                        >
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                                className="h-20 w-20 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center mb-4"
                            >
                                <CheckCircle2 className="h-10 w-10 text-white" />
                            </motion.div>
                            <motion.h3
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="text-2xl font-bold text-foreground dark:text-white mb-2"
                            >
                                Group Updated!
                            </motion.h3>
                            <motion.p
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                                className="text-sm text-sidebar-accent dark:text-slate-400"
                            >
                                The group name has been updated successfully.
                            </motion.p>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="form"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <DialogHeader>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center">
                                        <Edit className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <DialogTitle className="text-2xl font-bold text-foreground dark:text-white">
                                            Edit Group
                                        </DialogTitle>
                                        <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400">
                                            Update the group name
                                        </DialogDescription>
                                    </div>
                                </div>
                            </DialogHeader>

                            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-6">
                                {/* Center Info (Read-only) */}
                                <div className="p-4 bg-green-50 dark:bg-brand-green-darker/20 rounded-lg border border-primary/20 dark:border-sidebar-accent">
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                        Center
                                    </p>
                                    <p className="text-sm font-medium text-foreground dark:text-slate-100">
                                        {group.centerName} <span className="font-mono text-xs text-slate-500">({group.centerCode})</span>
                                    </p>
                                </div>

                                {/* Group Name */}
                                <div className="space-y-2">
                                    <Label htmlFor="name" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                        <Sparkles className="h-4 w-4 text-purple-600" />
                                        Group Name
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        id="name"
                                        {...register('name')}
                                        placeholder="e.g., Lakshmi Self Help Group"
                                        disabled={isSubmitting}
                                        className={`h-12 bg-white dark:bg-sidebar-accent border-2 transition-all ${errors.name
                                                ? 'border-red-300 focus:border-red-500'
                                                : 'border-primary/20 dark:border-sidebar-accent focus:border-purple-500'
                                            }`}
                                    />
                                    {errors.name && (
                                        <motion.p
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="text-sm text-red-600 flex items-center gap-1"
                                        >
                                            {errors.name.message}
                                        </motion.p>
                                    )}
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Update the group name (max 200 characters)
                                    </p>
                                </div>

                                {/* Info Box */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-4 bg-green-50 dark:bg-brand-green-darker/20 border border-primary/30 dark:border-sidebar-accent rounded-lg"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="h-8 w-8 rounded-full bg-brand-green-tint dark:bg-sidebar-accent flex items-center justify-center flex-shrink-0">
                                            <FolderTree className="h-4 w-4 text-primary dark:text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-foreground dark:text-green-300 mb-1">
                                                Note
                                            </p>
                                            <p className="text-xs text-sidebar-accent dark:text-primary">
                                                You can only update the group name. The center assignment cannot be changed.
                                            </p>
                                        </div>
                                    </div>
                                </motion.div>
                            </form>

                            <DialogFooter className="gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleClose}
                                    disabled={isSubmitting}
                                    className="min-w-[100px]"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    onClick={handleSubmit(onSubmit)}
                                    disabled={isSubmitting}
                                    className="min-w-[140px] bg-gradient-to-r from-primary to-purple-600 hover:from-primary hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-200"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Updating...
                                        </>
                                    ) : (
                                        <>
                                            <Edit className="h-4 w-4 mr-2" />
                                            Update Group
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </motion.div>
                    )}
                </AnimatePresence>
            </DialogContent>
        </Dialog>
    );
}
