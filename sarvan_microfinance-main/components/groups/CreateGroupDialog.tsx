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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Loader2, FolderTree, MapPin, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { motion, AnimatePresence } from 'framer-motion';

// Validation schema — the Group Name/Number are auto-generated server-side
// as "<Center Name> - N"; the caller only picks the target center.
const createGroupSchema = z.object({
    centerId: z.string().min(1, 'Please select a center'),
});

type CreateGroupFormData = z.infer<typeof createGroupSchema>;

interface Center {
    id: string;
    name: string;
    code: string;
}

interface CreateGroupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function CreateGroupDialog({ open, onOpenChange, onSuccess }: CreateGroupDialogProps) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [centers, setCenters] = useState<Center[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    const {
        handleSubmit,
        formState: { errors },
        reset,
        setValue,
        watch,
    } = useForm<CreateGroupFormData>({
        resolver: zodResolver(createGroupSchema),
        defaultValues: {
            centerId: '',
        },
    });

    const selectedCenterId = watch('centerId');

    // Fetch centers when dialog opens
    useEffect(() => {
        if (open) {
            fetchCenters();
            setShowSuccess(false);
        }
    }, [open]);

    const fetchCenters = async () => {
        setIsLoadingCenters(true);
        try {
            const activeBranch = branchStorage.getActiveBranch();
            if (!activeBranch?.id) {
                toast({
                    title: 'Error',
                    description: 'No branch found. Please select a branch first.',
                    variant: 'destructive',
                });
                return;
            }

            // Fetch centers from API
            const result = await apiClient.get<any[]>(`/centers?branchId=${activeBranch.id}`);

            if (result.success && result.data) {
                // Filter only approved centers
                const approvedCenters = result.data
                    .filter((center: any) => center.status === 'APPROVED')
                    .map((center: any) => ({
                        id: center.id,
                        name: center.name,
                        code: center.code,
                    }));
                setCenters(approvedCenters);
            } else {
                setCenters([]);
                toast({
                    title: 'Warning',
                    description: 'No approved centers found. Please create and approve a center first.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
        } finally {
            setIsLoadingCenters(false);
        }
    };

    const onSubmit = async (data: CreateGroupFormData) => {
        setIsSubmitting(true);
        try {
            const result = await apiClient.post('/groups', {
                centerId: data.centerId,
            });

            if (result.success) {
                setShowSuccess(true);

                // Wait for animation then close
                setTimeout(() => {
                    toast({
                        title: 'Success',
                        description: 'Group created successfully!',
                    });
                    reset();
                    onOpenChange(false);
                    onSuccess?.();
                    setShowSuccess(false);
                }, 1500);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to create group. Please try again.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error creating group:', error);
            toast({
                title: 'Error',
                description: 'Failed to create group. Please try again.',
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

    const selectedCenter = centers.find((c) => c.id === selectedCenterId);

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
                                Group Created!
                            </motion.h3>
                            <motion.p
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                                className="text-sm text-sidebar-accent dark:text-slate-400"
                            >
                                Your new group has been created successfully.
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
                                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary flex items-center justify-center">
                                        <FolderTree className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <DialogTitle className="text-2xl font-bold text-foreground dark:text-white">
                                            Create New Group
                                        </DialogTitle>
                                        <DialogDescription className="text-sm text-sidebar-accent dark:text-slate-400">
                                            Pick a center — the group number and name are generated automatically
                                        </DialogDescription>
                                    </div>
                                </div>
                            </DialogHeader>

                            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-6">
                                {/* Center Selection */}
                                <div className="space-y-2">
                                    <Label htmlFor="centerId" className="text-sm font-semibold text-sidebar-accent dark:text-slate-300 flex items-center gap-2">
                                        <MapPin className="h-4 w-4 text-green-600" />
                                        Select Center
                                        <span className="text-red-500">*</span>
                                    </Label>
                                    <Select
                                        value={selectedCenterId}
                                        onValueChange={(value) => setValue('centerId', value, { shouldValidate: true })}
                                        disabled={isLoadingCenters || isSubmitting}
                                    >
                                        <SelectTrigger
                                            className={`h-12 bg-white dark:bg-sidebar-accent border-2 transition-all ${errors.centerId
                                                    ? 'border-red-300 focus:border-red-500'
                                                    : 'border-primary/20 dark:border-sidebar-accent focus:border-primary'
                                                }`}
                                        >
                                            <SelectValue placeholder={isLoadingCenters ? 'Loading centers...' : 'Choose a center'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {centers.length === 0 ? (
                                                <div className="p-4 text-center text-sm text-sidebar-accent">
                                                    {isLoadingCenters ? 'Loading...' : 'No approved centers available'}
                                                </div>
                                            ) : (
                                                centers.map((center) => (
                                                    <SelectItem key={center.id} value={center.id}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium">{center.name}</span>
                                                            <span className="text-xs text-slate-500 font-mono">({center.code})</span>
                                                        </div>
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                    {errors.centerId && (
                                        <motion.p
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="text-sm text-red-600 flex items-center gap-1"
                                        >
                                            {errors.centerId.message}
                                        </motion.p>
                                    )}
                                    {selectedCenter && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
                                        >
                                            <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
                                                Selected Center
                                            </p>
                                            <p className="text-sm text-green-900 dark:text-green-300">
                                                {selectedCenter.name} <span className="font-mono text-xs">({selectedCenter.code})</span>
                                            </p>
                                        </motion.div>
                                    )}
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
                                                About Groups
                                            </p>
                                            <p className="text-xs text-sidebar-accent dark:text-primary">
                                                Groups are sub-centers that help organize members within a center. The group number and name are generated automatically as &quot;{selectedCenter?.name ?? 'Center Name'} - N&quot;, continuing this center&apos;s own sequence.
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
                                    disabled={isSubmitting || centers.length === 0}
                                    className="min-w-[140px] bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg hover:shadow-xl transition-all duration-200"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        <>
                                            <FolderTree className="h-4 w-4 mr-2" />
                                            Create Group
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
