'use client';

import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { RevertLocationPicker, type RevertLocationValue } from '@/components/revert/RevertLocationPicker';

interface RevertReasonDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    isSubmitting: boolean;
    onConfirm: (reason: string, location: RevertLocationValue | null) => void | Promise<void>;
    /** Location is mandatory for every revert; only the Uploan import tool (not a revert page) opts out. */
    requireLocation?: boolean;
}

/**
 * Shared reason-required confirmation dialog for every Phase 2 Admin-only
 * revert action (Disbursement, Loan Closure, Death Marking, Savings pair) —
 * keeps the "reason logged server-side" convention consistent across all of them.
 */
export function RevertReasonDialog({
    open,
    onOpenChange,
    title,
    description,
    isSubmitting,
    onConfirm,
    requireLocation = true,
}: RevertReasonDialogProps) {
    const [reason, setReason] = useState('');
    const [location, setLocation] = useState<RevertLocationValue | null>(null);

    const handleConfirm = async () => {
        if (!reason.trim()) return;
        if (requireLocation && !location) return;
        await onConfirm(reason.trim(), location);
        setReason('');
        setLocation(null);
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) { onOpenChange(next); if (!next) { setReason(''); setLocation(null); } } }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                    <Label htmlFor="revert-reason">
                        Reason <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                        id="revert-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Explain why this is being reverted..."
                        rows={3}
                        disabled={isSubmitting}
                    />
                </div>
                {requireLocation && open && (
                    <RevertLocationPicker value={location} onChange={setLocation} disabled={isSubmitting} />
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSubmitting || !reason.trim() || (requireLocation && !location)}
                        className="bg-red-600 hover:bg-red-700 text-white"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Reverting...
                            </>
                        ) : (
                            'Revert'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
