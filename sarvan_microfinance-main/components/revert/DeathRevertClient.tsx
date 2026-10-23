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

interface DeathMarkingRow {
    loanId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    memberPhone: string | null;
    deceasedPersonType: string;
    deceasedPersonName: string;
    deathDate: string;
    deathReason: string;
}

interface RevertedDeathMarkingRow {
    loanId: string;
    loanNumber: string;
    clientCode: string;
    memberName: string;
    memberPhone: string | null;
    deceasedPersonType: string;
    deceasedPersonName: string;
    deathDate: string;
    deathReason: string;
    revertedAt: string | null;
    revertedByName: string | null;
    revertedByEmployeeId: string | null;
    revertReason: string | null;
    revertLocation: RevertLocationDto;
}

export function DeathRevertClient() {
    const { toast } = useToast();
    const [searchType, setSearchType] = useState<SearchType>('memberId');
    const [searchValue, setSearchValue] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [rows, setRows] = useState<DeathMarkingRow[]>([]);
    const [revertedRows, setRevertedRows] = useState<RevertedDeathMarkingRow[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState<DeathMarkingRow | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isReverting, setIsReverting] = useState(false);

    // Separate filter: Active death markings (default) vs. the reverted history view.
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
                const response = await apiClient.get<RevertedDeathMarkingRow[]>(
                    `/loans/death-marking/search?searchType=${searchType}&searchValue=${encodeURIComponent(searchValue.trim())}&status=reverted`
                );
                setRevertedRows(response.success && Array.isArray(response.data) ? response.data : []);
            } else {
                const response = await apiClient.get<DeathMarkingRow[]>(
                    `/loans/death-marking/search?searchType=${searchType}&searchValue=${encodeURIComponent(searchValue.trim())}`
                );
                setRows(response.success && Array.isArray(response.data) ? response.data : []);
            }
        } catch (error) {
            console.error('Error searching death markings:', error);
            setRows([]);
            setRevertedRows([]);
            toast({ title: 'Error', description: 'Failed to search death markings', variant: 'destructive' });
        } finally {
            setIsSearching(false);
        }
    };

    const handleRevert = async (reason: string, location: RevertLocationValue | null) => {
        if (!location) return;
        if (!selectedLoan) return;
        try {
            setIsReverting(true);
            const response = await apiClient.post(`/loans/${selectedLoan.loanId}/death-marking/revert`, { reason, latitude: location.latitude, longitude: location.longitude });
            if (response.success) {
                toast({ title: 'Success', description: 'Death marking reverted successfully' });
                setRows((prev) => prev.filter((r) => r.loanId !== selectedLoan.loanId));
                setDialogOpen(false);
                setSelectedLoan(null);
            } else {
                toast({ title: 'Error', description: response.message || 'Failed to revert death marking', variant: 'destructive' });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to revert death marking';
            toast({ title: 'Error', description: message, variant: 'destructive' });
        } finally {
            setIsReverting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-slate-50">
                    Death Revert
                </h1>
                <p className="text-muted-foreground">
                    Undo a death marking that was recorded in error
                </p>
            </div>

            <Alert variant="destructive" className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                    <strong>Warning:</strong> This restores demand/collection for the loan as if it was never marked.
                    It does not affect a separate loan closure (write-off/death closure) if one was also recorded —
                    revert that separately if needed.
                </AlertDescription>
            </Alert>

            <Card className="border-2 shadow-xl overflow-hidden">
                <CardHeader>
                    <CardTitle>Search Death Markings</CardTitle>
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
                            <Label className="text-sm font-semibold">Show Reverted Death Markings</Label>
                            <p className="text-xs text-muted-foreground">
                                {showReverted
                                    ? 'Viewing reverted death markings — showing who reverted each one and when. Search again to load.'
                                    : 'Off shows currently-active death markings. Turn on and search to view the reverted history instead.'}
                            </p>
                        </div>
                    </div>

                    {hasSearched && !isSearching && (
                        showReverted ? (
                            revertedRows.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    No reverted death markings found matching this search.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Loan No.</TableHead>
                                                <TableHead>Member</TableHead>
                                                <TableHead>Deceased</TableHead>
                                                <TableHead>Relation</TableHead>
                                                <TableHead>Death Date</TableHead>
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
                                                    <TableCell>{row.deceasedPersonName}</TableCell>
                                                    <TableCell>{row.deceasedPersonType}</TableCell>
                                                    <TableCell>{format(new Date(row.deathDate), 'dd/MM/yyyy')}</TableCell>
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
                                No death markings found matching this search.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Loan No.</TableHead>
                                            <TableHead>Member</TableHead>
                                            <TableHead>Deceased</TableHead>
                                            <TableHead>Relation</TableHead>
                                            <TableHead>Death Date</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.map((row) => (
                                            <TableRow key={row.loanId}>
                                                <TableCell className="font-medium">{row.loanNumber}</TableCell>
                                                <TableCell>{row.memberName} ({row.clientCode})</TableCell>
                                                <TableCell>{row.deceasedPersonName}</TableCell>
                                                <TableCell>{row.deceasedPersonType}</TableCell>
                                                <TableCell>{format(new Date(row.deathDate), 'dd/MM/yyyy')}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
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
                title="Revert Death Marking"
                description={selectedLoan ? `Revert the death marking for ${selectedLoan.memberName} (Loan ${selectedLoan.loanNumber})?` : ''}
                isSubmitting={isReverting}
                onConfirm={handleRevert}
            />
        </div>
    );
}
