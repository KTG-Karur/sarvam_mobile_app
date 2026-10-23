'use client';

import { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Undo2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export interface DisbursementBatchLoan {
    loanId: string;
    loanNumber: string;
    clientCode: string;
    clientName: string;
    groupName: string | null;
    amount: number;
    funderName: string | null;
}

export interface DisbursementBatchDetail {
    indexId: string;
    indexNo: string;
    indexDate: string;
    branchName: string;
    branchCode: string;
    centerName: string;
    centerCode: string;
    fdoName: string | null;
    fdoEmployeeId: string | null;
    disbursedAt: string | null;
    loans: DisbursementBatchLoan[];
    totalAmount: number;
    fees: { admissionFee: number; processingFee: number; insuranceFee: number };
    activeVouchers: { voucherNo: string; type: string; amount: number; description: string | null }[];
    eligible: boolean;
    ineligibleReason: string | null;
}

interface DisbursementRevertDetailModalProps {
    indexId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRevertClick: (detail: DisbursementBatchDetail) => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-medium">{value ?? '-'}</div>
        </div>
    );
}

export function DisbursementRevertDetailModal({ indexId, open, onOpenChange, onRevertClick }: DisbursementRevertDetailModalProps) {
    const { toast } = useToast();
    const [detail, setDetail] = useState<DisbursementBatchDetail | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open || !indexId) {
            setDetail(null);
            return;
        }
        const load = async () => {
            setIsLoading(true);
            try {
                const result = await apiClient.get<DisbursementBatchDetail>(`/disbursements/revert/${indexId}`);
                if (result.success && result.data) {
                    setDetail(result.data);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to load batch detail', variant: 'destructive' });
                    onOpenChange(false);
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load batch detail', variant: 'destructive' });
                onOpenChange(false);
            } finally {
                setIsLoading(false);
            }
        };
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, indexId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Disbursement Batch Details</DialogTitle>
                    <DialogDescription>
                        Everything created by final disbursement for this Loan Index — verify before reverting the whole batch.
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <PageLoader label="Loading..." fullScreen={false} />
                ) : detail ? (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <Field label="Loan Index ID" value={detail.indexNo} />
                            <Field label="Branch" value={`${detail.branchCode} - ${detail.branchName}`} />
                            <Field label="Center" value={`${detail.centerCode} - ${detail.centerName}`} />
                            <Field label="FDO" value={detail.fdoName ? `${detail.fdoName}${detail.fdoEmployeeId ? ` (${detail.fdoEmployeeId})` : ''}` : '-'} />
                            <Field label="Disbursement Date" value={detail.disbursedAt ? format(new Date(detail.disbursedAt), 'dd/MM/yyyy hh:mm a') : '-'} />
                            <Field label="Total Amount" value={`₹${detail.totalAmount.toFixed(2)} (${detail.loans.length} loan${detail.loans.length === 1 ? '' : 's'})`} />
                        </div>

                        <Separator />

                        <div>
                            <div className="text-sm font-semibold mb-2">Loans in this Batch</div>
                            <div className="overflow-x-auto rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Loan No.</TableHead>
                                            <TableHead>Client</TableHead>
                                            <TableHead>Group</TableHead>
                                            <TableHead>Funder</TableHead>
                                            <TableHead className="text-right">Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {detail.loans.map((l) => (
                                            <TableRow key={l.loanId}>
                                                <TableCell className="font-medium">{l.loanNumber}</TableCell>
                                                <TableCell>{l.clientName} ({l.clientCode})</TableCell>
                                                <TableCell>{l.groupName ?? '-'}</TableCell>
                                                <TableCell className="text-xs">{l.funderName ?? 'Own Fund'}</TableCell>
                                                <TableCell className="text-right">₹{l.amount.toFixed(2)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>

                        <Separator />

                        <div>
                            <div className="text-sm font-semibold mb-2">Fees (aggregated for the batch)</div>
                            <div className="grid grid-cols-3 gap-4">
                                <Field label="Admission Fee" value={`₹${detail.fees.admissionFee.toFixed(2)}`} />
                                <Field label="Processing Fee" value={`₹${detail.fees.processingFee.toFixed(2)}`} />
                                <Field label="Insurance Fee" value={`₹${detail.fees.insuranceFee.toFixed(2)}`} />
                            </div>
                            {detail.fees.insuranceFee > 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Insurance is a fee line only — no separate GL posting is created for it at disbursement.
                                </p>
                            )}
                        </div>

                        {detail.activeVouchers.length > 0 && (
                            <>
                                <Separator />
                                <div>
                                    <div className="text-sm font-semibold mb-2">Active GL Vouchers</div>
                                    <div className="space-y-1">
                                        {detail.activeVouchers.map((v) => (
                                            <div key={v.voucherNo} className="text-xs flex justify-between border rounded px-2 py-1.5">
                                                <span className="font-mono">{v.voucherNo}</span>
                                                <span className="text-muted-foreground truncate mx-2">{v.description}</span>
                                                <span className="font-medium">₹{v.amount.toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Reverting this batch will deactivate all of these vouchers — every loan in the
                                        index is reverted together, so nothing remains to re-post.
                                    </p>
                                </div>
                            </>
                        )}

                        <Separator />

                        <div className="flex items-center justify-between">
                            {detail.eligible ? (
                                <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">Eligible for revert</Badge>
                            ) : (
                                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                    Not eligible: {detail.ineligibleReason}
                                </Badge>
                            )}
                        </div>
                    </div>
                ) : null}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                    {detail && (
                        <Button
                            variant="destructive"
                            disabled={!detail.eligible}
                            onClick={() => onRevertClick(detail)}
                        >
                            <Undo2 className="h-4 w-4 mr-1" /> Revert Batch
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
