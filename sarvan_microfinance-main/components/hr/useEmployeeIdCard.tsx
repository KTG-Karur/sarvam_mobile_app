'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pencil } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { EmployeeIdCardModal, type IdCardData } from '@/components/hr/EmployeeIdCardModal';
import { fetchEmployeeIdCardData, type IdCardIssueView } from '@/components/hr/employee-id-card-loader';

interface BlockedState {
    userId: string;
    issues: IdCardIssueView[];
}

/**
 * Opens a provisioned employee's live ID card — or, when the server says the
 * employee isn't eligible (inactive/exited or a printed field missing), a
 * dialog listing what to fix instead. Render `dialogs` once in the page.
 *
 * `onEmployeeMaster`: hide the "Fix in Employee Master" link when already there.
 */
export function useEmployeeIdCard({
    onEmployeeMaster = false,
    onIssued,
}: {
    onEmployeeMaster?: boolean;
    /** After a print / PDF download has been recorded — e.g. to refresh a list's reprint badges. */
    onIssued?: (userId: string) => void;
} = {}) {
    const router = useRouter();
    const { toast } = useToast();
    const [data, setData] = useState<IdCardData | null>(null);
    const [openUserId, setOpenUserId] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [loadingFor, setLoadingFor] = useState<string | null>(null);
    const [blocked, setBlocked] = useState<BlockedState | null>(null);
    // Ignore a slow response for a card the user has since moved away from.
    const latestRequestRef = useRef<string | null>(null);

    /** `key` identifies the clicked row for `loadingFor` (defaults to userId). */
    const openForEmployee = useCallback(
        async (userId: string, key: string = userId) => {
            latestRequestRef.current = key;
            setLoadingFor(key);
            try {
                const result = await fetchEmployeeIdCardData(userId);
                if (latestRequestRef.current !== key) return;
                if (result.status === 'ok') {
                    setData(result.data);
                    setOpenUserId(userId);
                    setOpen(true);
                } else if (result.status === 'not-eligible') {
                    setBlocked({ userId, issues: result.issues });
                } else {
                    toast({ title: 'Could not load ID card', description: result.error, variant: 'destructive' });
                }
            } finally {
                setLoadingFor((current) => (current === key ? null : current));
            }
        },
        [toast]
    );

    // Fire-and-forget: a failed bookkeeping call must never get in the way of the
    // print/PDF the user just made, so it only warns.
    const recordIssued = useCallback(async () => {
        if (!openUserId) return;
        const res = await apiClient.post(`/hr/employees/${openUserId}/id-card/issue`, {});
        if (res.success) onIssued?.(openUserId);
        else toast({ title: 'Card printed, but not recorded', description: res.error || 'Reprint tracking was not updated.' });
    }, [openUserId, onIssued, toast]);

    const dialogs = (
        <>
            <EmployeeIdCardModal
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) {
                        setData(null);
                        setOpenUserId(null);
                    }
                }}
                data={data}
                onIssued={() => void recordIssued()}
            />
            <Dialog open={!!blocked} onOpenChange={(next) => !next && setBlocked(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-yellow-600" />
                            ID card cannot be issued
                        </DialogTitle>
                        <DialogDescription>
                            A card is issued only to current employees whose card details are complete. Resolve the
                            following first:
                        </DialogDescription>
                    </DialogHeader>
                    <ul className="space-y-1.5 text-sm">
                        {blocked?.issues.map((issue) => (
                            <li key={issue.code} className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950/30 dark:text-red-300">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                                {issue.message}
                            </li>
                        ))}
                    </ul>
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button type="button" variant="outline" onClick={() => setBlocked(null)}>
                            Close
                        </Button>
                        {!onEmployeeMaster && blocked && (
                            <Button
                                type="button"
                                onClick={() => {
                                    const userId = blocked.userId;
                                    setBlocked(null);
                                    router.push(`/dashboard/hr/employees/${userId}`);
                                }}
                                className="bg-primary text-white"
                            >
                                <Pencil className="mr-2 h-4 w-4" /> Fix in Employee Master
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );

    return { openForEmployee, loadingFor, dialogs };
}
