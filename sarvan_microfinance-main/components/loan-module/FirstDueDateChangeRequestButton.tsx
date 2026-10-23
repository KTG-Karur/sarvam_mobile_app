'use client';

import { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';

type Props = {
    indexId: string;
    indexNo: string;
    currentFirstDueDate: string | null;
    /** A PENDING request already exists for this index. */
    isPending: boolean;
    onRaised: () => void;
};

/** 2026-09-30 / ISO -> 30-09-2026 */
export function formatYmd(value: string | null | undefined): string {
    if (!value) return '—';
    const [y, m, d] = value.slice(0, 10).split('-');
    return `${d}-${m}-${y}`;
}

/** BM-side: raise a first-due-date change request (reason only) for an index in final disbursement. */
export function FirstDueDateChangeRequestButton({ indexId, indexNo, currentFirstDueDate, isPending, onRaised }: Props) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (isPending) {
        return (
            <Badge variant="secondary" className="w-full justify-center text-[11px] h-7">
                Date change requested
            </Badge>
        );
    }

    const submit = async () => {
        if (reason.trim().length < 5) return;
        setIsSubmitting(true);
        try {
            const result = await apiClient.post('/first-due-date-change-requests', { indexId, reason: reason.trim() });
            if (result.success) {
                toast({ title: 'Request sent', description: 'Sent to Admin for approval.' });
                setOpen(false);
                setReason('');
                onRaised();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to send request', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <Button
                size="sm"
                variant="outline"
                onClick={() => setOpen(true)}
                title="Ask Admin to change this index's first due date"
                className="h-7 text-[11px] w-full"
            >
                <CalendarClock className="h-3.5 w-3.5 mr-1" />
                Request date change
            </Button>

            <Dialog open={open} onOpenChange={(o) => { if (!isSubmitting) { setOpen(o); if (!o) setReason(''); } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Request First Due Date Change</DialogTitle>
                        <DialogDescription>
                            Index {indexNo} · current first due date {formatYmd(currentFirstDueDate)}. Admin will
                            choose the new date when approving; it applies to every loan in this index.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label>Reason</Label>
                        <Textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why does the first due date need to change?"
                            rows={4}
                            maxLength={500}
                        />
                        {reason.length > 0 && reason.trim().length < 5 && (
                            <p className="text-xs text-red-600">Reason must be at least 5 characters.</p>
                        )}
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
                        <Button onClick={submit} disabled={isSubmitting || reason.trim().length < 5}>
                            {isSubmitting ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Sending...</> : 'Send request'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
