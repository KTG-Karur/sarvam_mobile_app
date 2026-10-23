'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Search, Undo2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { RevertReasonDialog } from '@/components/revert/RevertReasonDialog';
import type { RevertLocationValue } from '@/components/revert/RevertLocationPicker';
import { RevertLocationCell, type RevertLocationDto } from '@/components/revert/RevertLocationCell';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';

type SearchType = 'memberId' | 'phone' | 'aadhaar';

interface ClosedLoanRow {
    loanId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    memberPhone: string | null;
    closureReason: string;
    closedDate: string | null;
    remarks: string | null;
    eligible: boolean;
    eodLocked: boolean;
    allocationLocked: boolean;
}

interface RevertedClosedLoanRow {
    loanId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    memberPhone: string | null;
    closureReason: string;
    closedDate: string | null;
    remarks: string | null;
    revertedAt: string | null;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
}

export function LoanClosureRevertClient() {
    const { toast } = useToast();
    const [searchType, setSearchType] = useState<SearchType>('memberId');
    const [searchValue, setSearchValue] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [rows, setRows] = useState<ClosedLoanRow[]>([]);
    const [revertedRows, setRevertedRows] = useState<RevertedClosedLoanRow[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState<ClosedLoanRow | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isReverting, setIsReverting] = useState(false);

    // Separate filter: Active closures (default) vs. the reverted history view.
    const [showReverted, setShowReverted] = useState(false);

    const handleSearch = async () => {
        if (!searchValue.trim()) {
            toast({ title: 'Validation Error', description: 'Please enter a search value', variant: 'destructive' });
            return;
        }
        try {
            setIsSearching(true);
            setHasSearched(true);
            if (showReverted) {
                const response = await apiClient.get<RevertedClosedLoanRow[]>(
                    `/collections/loan-writeoff-closure/revert?searchType=${searchType}&searchValue=${encodeURIComponent(searchValue.trim())}&status=reverted`
                );
                setRevertedRows(response.success && Array.isArray(response.data) ? response.data : []);
            } else {
                const response = await apiClient.get<ClosedLoanRow[]>(
                    `/collections/loan-writeoff-closure/revert?searchType=${searchType}&searchValue=${encodeURIComponent(searchValue.trim())}`
                );
                setRows(response.success && Array.isArray(response.data) ? response.data : []);
            }
        } catch (error) {
            console.error('Error searching closed loans:', error);
            setRows([]);
            setRevertedRows([]);
            toast({ title: 'Error', description: 'Failed to search closed loans', variant: 'destructive' });
        } finally {
            setIsSearching(false);
        }
    };

    const handleRevert = async (reason: string, location: RevertLocationValue | null) => {
        if (!selectedLoan || !location) return;
        try {
            setIsReverting(true);
            const response = await apiClient.post('/collections/loan-writeoff-closure/revert', {
                loanId: selectedLoan.loanId,
                reason,
                latitude: location.latitude,
                longitude: location.longitude,
            });
            if (response.success) {
                toast({ title: 'Success', description: 'Loan closure reverted successfully' });
                setRows((prev) => prev.filter((r) => r.loanId !== selectedLoan.loanId));
                setDialogOpen(false);
                setSelectedLoan(null);
            } else {
                toast({ title: 'Error', description: response.message || 'Failed to revert loan closure', variant: 'destructive' });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to revert loan closure';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Loan Closure Revert
                </h1>
                <p className="text-muted-foreground">
                    Undo a write-off / death closure recorded in error
                </p>
            </div>

            <Alert variant="destructive" className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> This reopens the loan and recomputes schedule statuses from the
                    original paid amounts. Blocked if any transaction has been recorded on the loan since closure,
                    if EOD has already been processed past the closure date, or if the closure&apos;s collection has
                    already been allocated for EOD settlement (revert the Allocation first, then try again).
                </AlertDescription>
            </Alert>

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader>
                    <CardTitle>Search Closed Loans</CardTitle>
                    <CardDescription>Search by Member ID, phone number, or Aadhaar/ID number</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <Select value={searchType} onValueChange={(v) => setSearchType(v as SearchType)}>
                            <SelectTrigger className="h-11 sm:w-48">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="memberId">Member ID</SelectItem>
                                <SelectItem value="phone">Phone Number</SelectItem>
                                <SelectItem value="aadhaar">Aadhaar / ID Number</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            value={searchValue}
                            onChange={(e) => setSearchValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder="Enter search value..."
                            className="h-11 flex-1"
                        />
                        <Button onClick={handleSearch} disabled={isSearching} className="h-11">
                            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            <span className="ml-2">Search</span>
                        </Button>
                    </div>

                    <div className="flex items-center gap-3 border-t pt-4">
                        <Switch
                            checked={showReverted}
                            onCheckedChange={(checked) => {
                                setShowReverted(checked);
                                setHasSearched(false);
                                setRows([]);
                                setRevertedRows([]);
                            }}
                        />
                        <div>
                            <Label className="text-sm font-semibold">Show Reverted Closures</Label>
                            <p className="text-xs text-muted-foreground">
                                {showReverted
                                    ? 'Viewing reverted closures — showing who reverted each one and when. Search again to load.'
                                    : 'Off shows currently-closed loans. Turn on and search to view the reverted history instead.'}
                            </p>
                        </div>
                    </div>

                    {hasSearched && !isSearching && (
                        showReverted ? (
                            revertedRows.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    No reverted closures found matching this search.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Loan No.</TableHead>
                                                <TableHead>Member</TableHead>
                                                <TableHead>Reason</TableHead>
                                                <TableHead>Closed Date</TableHead>
                                                <TableHead>Reverted By</TableHead>
                                                <TableHead>Reverted On</TableHead>
                                                <TableHead>Revert Reason</TableHead>
                                                <TableHead>Revert Location</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {revertedRows.map((row) => (
                                                <TableRow key={row.loanId}>
                                                    <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                    <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                    <TableCell>{row.closureReason}</TableCell>
                                                    <TableCell>{row.closedDate ? format(new Date(row.closedDate), 'dd/MM/yyyy') : '-'}</TableCell>
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
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )
                        ) : rows.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                No closed loans found matching this search.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Loan No.</TableHead>
                                            <TableHead>Member</TableHead>
                                            <TableHead>Reason</TableHead>
                                            <TableHead>Closed Date</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.map((row) => (
                                            <TableRow key={row.loanId}>
                                                <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                <TableCell>{row.closureReason}</TableCell>
                                                <TableCell>{row.closedDate ? format(new Date(row.closedDate), 'dd/MM/yyyy') : '-'}</TableCell>
                                                <TableCell>
                                                    {row.eligible ? (
                                                        <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400">Eligible</Badge>
                                                    ) : row.eodLocked && row.allocationLocked ? (
                                                        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                                            EOD Allocation &amp; EOD already processed
                                                        </Badge>
                                                    ) : row.allocationLocked ? (
                                                        <Badge
                                                            variant="outline"
                                                            className="border-amber-500 text-amber-700 dark:text-amber-400"
                                                            title="Revert the Allocation first (Allocation Revert), then try again."
                                                        >
                                                            EOD Allocation already processed
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                                            EOD already processed
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        disabled={!row.eligible}
                                                        onClick={() => { setSelectedLoan(row); setDialogOpen(true); }}
                                                    >
                                                        <Undo2 className="h-4 w-4 mr-1" /> Revert
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )
                    )}
                </CardContent>
            </Card>

            <RevertReasonDialog
                open={dialogOpen}
                onOpenChange={(open) => { setDialogOpen(open); if (!open) setSelectedLoan(null); }}
                title="Revert Loan Closure"
                description={selectedLoan ? `Reopen ${selectedLoan.memberName}'s loan (${selectedLoan.loanNumber})? This undoes the ${selectedLoan.closureReason} closure.` : ''}
                isSubmitting={isReverting}
                onConfirm={handleRevert}
            />
        </div>
    );
}
