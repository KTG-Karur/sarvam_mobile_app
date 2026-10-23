'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, Undo2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { RevertReasonDialog } from '@/components/revert/RevertReasonDialog';
import type { RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
import { DisbursementRevertDetailModal } from '@/components/revert/DisbursementRevertDetailModal';
import { format } from 'date-fns';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface DisbursedIndexRow {
    indexId: string;
    indexNo: string | null;
    branchName: string;
    centerName: string;
    centerCode: string;
    fdoName: string | null;
    fdoEmployeeId: string | null;
    loanCount: number;
    totalAmount: number;
    funderNames: string[];
    disbursedAt: string;
    eligible?: boolean;
    ineligibleReason?: string | null;
    revertedAt?: string | null;
    revertedByName?: string | null;
    revertedByEmployeeId?: string | null;
    revertReason?: string | null;
    revertLocation?: RevertLocationDto;
}

const getTodayYmd = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function DisbursementRevertClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    const [date, setDate] = useState(getTodayYmd());
    const [mode, setMode] = useState<'live' | 'reverted'>('live');

    const [rows, setRows] = useState<DisbursedIndexRow[]>([]);
    const [isLoadingRows, setIsLoadingRows] = useState(false);

    const [detailIndexId, setDetailIndexId] = useState<string | null>(null);
    const [selectedBatch, setSelectedBatch] = useState<DisbursedIndexRow | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isReverting, setIsReverting] = useState(false);

    useEffect(() => {
        const loadBranches = async () => {
            setIsLoadingBranches(true);
            try {
                const result = await apiClient.get<Branch[]>('/disbursements/revert/branches');
                if (result.success && result.data) {
                    setBranches(result.data);
                } else {
                    toast({ title: 'Error', description: result.error || 'Failed to load branches', variant: 'destructive' });
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load branches', variant: 'destructive' });
            } finally {
                setIsLoadingBranches(false);
            }
        };
        loadBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchRows = useCallback(async () => {
        if (!branchId || !date) return;
        setIsLoadingRows(true);
        try {
            const params = new URLSearchParams({ branchId, date, mode });
            const result = await apiClient.get<DisbursedIndexRow[]>(`/disbursements/revert?${params.toString()}`);
            setRows(result.success && Array.isArray(result.data) ? result.data : []);
            if (!result.success) {
                toast({ title: 'Error', description: result.error || 'Failed to load disbursed batches', variant: 'destructive' });
            }
        } catch {
            setRows([]);
            toast({ title: 'Error', description: 'Failed to load disbursed batches', variant: 'destructive' });
        } finally {
            setIsLoadingRows(false);
        }
    }, [branchId, date, mode, toast]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(rows);

    const handleRevert = async (reason: string, location: RevertLocationValue | null) => {
        if (!selectedBatch || !location) return;
        try {
            setIsReverting(true);
            const response = await apiClient.post('/disbursements/revert', {
                indexId: selectedBatch.indexId,
                reason,
                latitude: location.latitude,
                longitude: location.longitude,
            });
            if (response.success) {
                toast({ title: 'Success', description: 'Disbursement batch reverted successfully' });
                setRows((prev) => prev.filter((r) => r.indexId !== selectedBatch.indexId));
                setDialogOpen(false);
                setSelectedBatch(null);
                setDetailIndexId(null);
            } else {
                toast({ title: 'Error', description: response.message || response.error || 'Failed to revert disbursement batch', variant: 'destructive' });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to revert disbursement batch';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    const openRevertDialog = (row: DisbursedIndexRow, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setSelectedBatch(row);
        setDialogOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Disbursement Revert
                </h1>
                <p className="text-muted-foreground">
                    Undo an already-disbursed Loan Index batch back to pending disbursement, including its GL postings
                </p>
            </div>

            <Alert variant="destructive" className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> Disbursement is posted per Loan Index, so revert operates on the whole
                    batch at once — every loan in the index is reverted together. If any loan in the batch has
                    payments or other downstream activity, the entire batch is blocked from revert. Only possible
                    until EOD has been processed past the disbursement date. This deletes the generated schedules
                    and re-posts the affected GL vouchers.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Select Date &amp; Branch</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <Label className="mb-1.5 block">Working Date</Label>
                            <DateInput value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
                        </div>
                        <div>
                            <Label className="mb-1.5 block">Branch</Label>
                            <Select value={branchId} onValueChange={setBranchId} disabled={isLoadingBranches}>
                                <SelectTrigger className="h-11"><SelectValue placeholder="Select Branch" /></SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-end">
                            <Button onClick={fetchRows} disabled={isLoadingRows || !branchId} className="h-11 w-full sm:w-auto">
                                {isLoadingRows ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Search
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search disbursement batches..."
                            className="ml-auto"
                        />
                    </div>

                    <Tabs value={mode} onValueChange={(v) => setMode(v as 'live' | 'reverted')}>
                        <TabsList>
                            <TabsTrigger value="live">Disbursed Batches</TabsTrigger>
                            <TabsTrigger value="reverted">Reverted Batches</TabsTrigger>
                        </TabsList>

                        <TabsContent value={mode}>
                            {isLoadingRows ? (
                                <PageLoader label="Loading..." fullScreen={false} />
                            ) : searchedRows.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    {mode === 'reverted'
                                        ? 'No reverted disbursement batches found for this branch/date.'
                                        : 'No disbursed batches found for this branch/date.'}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>S.No</TableHead>
                                                <TableHead>Loan Index ID</TableHead>
                                                <TableHead>Branch</TableHead>
                                                <TableHead>Center</TableHead>
                                                <TableHead>FDO</TableHead>
                                                <TableHead className="text-right">Loans</TableHead>
                                                <TableHead className="text-right">Total Amount</TableHead>
                                                <TableHead>Funder(s)</TableHead>
                                                <TableHead>Disbursement Date</TableHead>
                                                {mode === 'reverted' ? (
                                                    <>
                                                        <TableHead>Reverted By</TableHead>
                                                        <TableHead>Reverted On</TableHead>
                                                        <TableHead>Revert Reason</TableHead>
                                                        <TableHead>Revert Location</TableHead>
                                                    </>
                                                ) : (
                                                    <>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead className="text-right">Action</TableHead>
                                                    </>
                                                )}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {searchedRows.map((row, idx) => (
                                                <TableRow
                                                    key={row.indexId}
                                                    className="cursor-pointer hover:bg-muted/50"
                                                    onClick={() => setDetailIndexId(row.indexId)}
                                                >
                                                    <TableCell>{idx + 1}</TableCell>
                                                    <TableCell className="font-mono text-xs font-medium">{row.indexNo ?? '-'}</TableCell>
                                                    <TableCell>{row.branchName}</TableCell>
                                                    <TableCell>{row.centerCode} - {row.centerName}</TableCell>
                                                    <TableCell className="text-xs">
                                                        {row.fdoName ?? '-'}
                                                        {row.fdoEmployeeId && <span className="block text-muted-foreground">({row.fdoEmployeeId})</span>}
                                                    </TableCell>
                                                    <TableCell className="text-right">{row.loanCount}</TableCell>
                                                    <TableCell className="text-right">₹{row.totalAmount.toFixed(2)}</TableCell>
                                                    <TableCell className="text-xs">{row.funderNames.join(', ')}</TableCell>
                                                    <TableCell>{row.disbursedAt ? format(new Date(row.disbursedAt), 'dd/MM/yyyy hh:mm a') : '-'}</TableCell>
                                                    {mode === 'reverted' ? (
                                                        <>
                                                            <TableCell className="text-xs">
                                                                {row.revertedByName ?? '-'}
                                                                {row.revertedByEmployeeId && (
                                                                    <span className="block text-muted-foreground">({row.revertedByEmployeeId})</span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                {row.revertedAt ? format(new Date(row.revertedAt), 'dd/MM/yyyy hh:mm a') : '-'}
                                                            </TableCell>
                                                            <TableCell className="text-xs max-w-[220px] whitespace-pre-wrap break-words">
                                                                {row.revertReason ?? '-'}
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                <RevertLocationCell location={row.revertLocation} />
                                                            </TableCell>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <TableCell>
                                                                {row.eligible ? (
                                                                    <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">Eligible</Badge>
                                                                ) : (
                                                                    <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" title={row.ineligibleReason ?? undefined}>
                                                                        {row.ineligibleReason}
                                                                    </Badge>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <Button
                                                                    size="sm"
                                                                    variant="destructive"
                                                                    disabled={!row.eligible}
                                                                    onClick={(e) => openRevertDialog(row, e)}
                                                                >
                                                                    <Undo2 className="h-4 w-4 mr-1" /> Revert
                                                                </Button>
                                                            </TableCell>
                                                        </>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <DisbursementRevertDetailModal
                indexId={detailIndexId}
                open={!!detailIndexId}
                onOpenChange={(open) => { if (!open) setDetailIndexId(null); }}
                onRevertClick={(detail) => {
                    setSelectedBatch({
                        indexId: detail.indexId,
                        indexNo: detail.indexNo,
                        branchName: detail.branchName,
                        centerName: detail.centerName,
                        centerCode: detail.centerCode,
                        fdoName: detail.fdoName,
                        fdoEmployeeId: detail.fdoEmployeeId,
                        loanCount: detail.loans.length,
                        totalAmount: detail.totalAmount,
                        funderNames: Array.from(new Set(detail.loans.map((l) => l.funderName ?? 'Own Fund'))),
                        disbursedAt: detail.disbursedAt ?? '',
                    });
                    setDialogOpen(true);
                }}
            />

            <RevertReasonDialog
                open={dialogOpen}
                onOpenChange={(open) => { setDialogOpen(open); if (!open) setSelectedBatch(null); }}
                title="Revert Disbursement Batch"
                description={selectedBatch ? `This will reverse the complete disbursement for Loan Index ${selectedBatch.indexNo} (${selectedBatch.loanCount} loan${selectedBatch.loanCount === 1 ? '' : 's'}, ₹${selectedBatch.totalAmount.toFixed(2)}) and remove all records created by it — including the loan schedules and accounting transactions. Are you sure you want to continue?` : ''}
                isSubmitting={isReverting}
                onConfirm={handleRevert}
            />
        </div>
    );
}
