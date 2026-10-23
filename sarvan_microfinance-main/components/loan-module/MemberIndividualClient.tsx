'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    CheckCircle2, Circle, UserRoundCog, ChevronRight, Users, MessageSquareText,
    ClipboardList, ClipboardCheck, Hourglass,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';
import { MemberIndividualDetailPage } from '@/components/loan-module/MemberIndividualDetailPage';
import { GrtSessionsClient } from '@/components/loan-module/GrtSessionsClient';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';

type Branch = { id: string; name: string; code: string };
type Center = { id: string; name: string; code: string };

type RosterRow = {
    loanId: string;
    loanNumber: string;
    amount: number;
    frequency: string;
    clientDisplayId: string;
    clientName: string;
    productName: string | null;
    cashFlowComplete: boolean;
    loanAppraisalComplete: boolean;
    houseHoldVisitComplete: boolean;
    grtComplete: boolean;
    isComplete: boolean;
};

function initials(name: string) {
    return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

function TabDot({ done }: { done: boolean }) {
    return (
        <div className="flex items-center justify-center">
            {done
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <Circle className="h-4 w-4 text-slate-300" />}
        </div>
    );
}

function StatTile({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: number | string; accent: string }) {
    return (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-green-950/60 p-4">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accent)}>
                <Icon className="h-5 w-5" />
            </div>
            <div>
                <p className="text-xl font-bold text-foreground dark:text-slate-100 leading-none">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
        </div>
    );
}

export function MemberIndividualClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [roster, setRoster] = useState<RosterRow[]>([]);
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [isLoadingRoster, setIsLoadingRoster] = useState(false);
    const [openLoanId, setOpenLoanId] = useState<string | null>(null);

    useEffect(() => {
        const activeBranch = branchStorage.getActiveBranch();
        const storedUser = tokenStorage.getUser();
        const isAdmin = storedUser?.role === 'ADMIN' || storedUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH';
        const isAreaManager = storedUser?.role === 'AREA_MANAGER';
        const userBranchId = storedUser?.branchId || '';

        apiClient.get<Branch[]>('/branches').then((result) => {
            if (result.success && result.data) {
                if (isAdmin) {
                    setBranches(result.data);
                    setSelectedBranchId(activeBranch?.id || userBranchId || result.data[0]?.id || '');
                } else if (isAreaManager) {
                    const assignedBranchIds = (storedUser as any)?.assignedBranchIds ?? [];
                    const list = assignedBranchIds.length > 0
                        ? result.data.filter((b) => assignedBranchIds.includes(b.id))
                        : result.data;
                    setBranches(list);
                    const preferredId = activeBranch?.id ?? userBranchId;
                    const match = list.find((b) => b.id === preferredId) ?? list[0];
                    setSelectedBranchId(match?.id || '');
                } else if (userBranchId) {
                    setBranches(result.data.filter((b) => b.id === userBranchId));
                    setSelectedBranchId(userBranchId);
                } else {
                    setBranches(result.data);
                    setSelectedBranchId(activeBranch?.id || result.data[0]?.id || '');
                }
            }
        });
    }, []);

    useEffect(() => {
        if (!selectedBranchId) { setCenters([]); return; }
        setIsLoadingCenters(true);
        apiClient.get<Center[]>(`/centers?branchId=${selectedBranchId}&includeInactive=false&status=APPROVED`)
            .then((result) => { if (result.success && result.data) setCenters(result.data); })
            .finally(() => setIsLoadingCenters(false));
        setSelectedCenterId('');
        setRoster([]);
    }, [selectedBranchId]);

    const fetchRoster = () => {
        if (!selectedCenterId) return;
        setIsLoadingRoster(true);
        apiClient.get<RosterRow[]>(`/member-individual?centerId=${selectedCenterId}`)
            .then((result) => {
                if (result.success && result.data) setRoster(result.data);
                else {
                    setRoster([]);
                    toast({ title: 'Error', description: result.error || 'Failed to load roster.', variant: 'destructive' });
                }
            })
            .finally(() => setIsLoadingRoster(false));
    };

    useEffect(() => {
        if (selectedCenterId) fetchRoster();
        else setRoster([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCenterId]);

    const stats = useMemo(() => {
        const total = roster.length;
        const complete = roster.filter((r) => r.isComplete).length;
        const pending = total - complete;
        const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
        return { total, complete, pending, pct };
    }, [roster]);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(roster);

    if (openLoanId) {
        return (
            <MemberIndividualDetailPage
                loanId={openLoanId}
                onClose={() => { setOpenLoanId(null); fetchRoster(); }}
            />
        );
    }

    return (
        <div className="space-y-6">
            {/* Hero header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-green-darker via-sidebar-accent to-primary px-6 py-8 shadow-xl">
                <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/5 blur-2xl" />
                <div className="absolute -bottom-8 left-1/3 h-32 w-32 rounded-full bg-white/5 blur-xl" />
                <div className="relative flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur-sm">
                        <UserRoundCog className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                            Member Individual
                        </h1>
                        <p className="mt-0.5 text-sm text-green-200">
                            Cash Flow, Loan Appraisal, House Hold Assessment and GRT — collected per client before disbursement
                        </p>
                    </div>
                </div>
            </div>

            <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <Users className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Center Roster</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 p-4 bg-green-50 dark:bg-brand-green-darker/50 rounded-xl border border-slate-100 dark:border-sidebar-accent">
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Branch</Label>
                            <Select value={selectedBranchId} onValueChange={setSelectedBranchId} disabled={branches.length <= 1}>
                                <SelectTrigger className="h-12 w-full bg-white dark:bg-green-950 border-primary/20 dark:border-sidebar-accent">
                                    <SelectValue placeholder="-- Select Branch --" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>
                                            <span className="font-semibold text-primary dark:text-primary w-16 inline-block">{b.code}</span>
                                            <span className="text-sidebar-accent dark:text-slate-300 ml-2">{b.name}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Center</Label>
                            <Select value={selectedCenterId} onValueChange={setSelectedCenterId} disabled={centers.length === 0}>
                                <SelectTrigger className="h-12 w-full bg-white dark:bg-green-950 border-primary/20 dark:border-sidebar-accent">
                                    <SelectValue placeholder={isLoadingCenters ? 'Loading...' : '-- Select Center --'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {centers.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            <span className="font-semibold text-primary dark:text-primary w-16 inline-block">{c.code}</span>
                                            <span className="text-sidebar-accent dark:text-slate-300 ml-2">{c.name}</span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                            <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Search</Label>
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search members..."
                            />
                        </div>
                    </div>

                    {selectedCenterId && (
                        <>
                            {roster.length > 0 && (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <StatTile icon={Users} label="Total Members" value={stats.total} accent="bg-brand-green-tint text-primary dark:bg-brand-green-darker/40 dark:text-primary" />
                                    <StatTile icon={ClipboardCheck} label="Fully Complete" value={stats.complete} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
                                    <StatTile icon={Hourglass} label="Pending" value={stats.pending} accent="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
                                    <StatTile icon={ClipboardList} label="% Complete" value={`${stats.pct}%`} accent="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
                                </div>
                            )}

                            <Tabs defaultValue="members">
                                <TabsList className="grid grid-cols-2 w-full max-w-md h-auto">
                                    <TabsTrigger value="members" className="flex items-center py-2"><Users className="h-4 w-4 mr-1.5" />Members</TabsTrigger>
                                    <TabsTrigger value="grt-sessions" className="flex items-center py-2"><MessageSquareText className="h-4 w-4 mr-1.5" />GRT Sessions</TabsTrigger>
                                </TabsList>

                                <TabsContent value="members" className="pt-4">
                                    {isLoadingRoster ? (
                                        <PageLoader label="Loading roster..." fullScreen={false} />
                                    ) : searchedRows.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 border rounded-lg border-dashed">
                                            <Users className="h-10 w-10 mb-3 text-slate-300" />
                                            <p className="text-sm text-muted-foreground">No indexed, pending-disbursement clients in this center.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto rounded-lg border">
                                            <Table>
                                                <TableHeader className="bg-brand-green-darker dark:bg-sidebar-accent text-white">
                                                    <TableRow className="hover:bg-brand-green-darker dark:hover:bg-sidebar-accent border-none">
                                                        <TableHead className="text-white">Client</TableHead>
                                                        <TableHead className="text-white">Loan</TableHead>
                                                        <TableHead className="text-white text-right">Amount</TableHead>
                                                        <TableHead className="text-white text-center">Cash Flow</TableHead>
                                                        <TableHead className="text-white text-center">Loan Appraisal</TableHead>
                                                        <TableHead className="text-white text-center">House Hold Assessment</TableHead>
                                                        <TableHead className="text-white text-center">GRT</TableHead>
                                                        <TableHead className="text-white text-center">Status</TableHead>
                                                        <TableHead className="text-white text-center">Open</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {searchedRows.map((row) => (
                                                        <TableRow key={row.loanId} className="even:bg-green-50 dark:even:bg-brand-green-darker/50">
                                                            <TableCell>
                                                                <div className="flex items-center gap-2.5">
                                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green-tint dark:bg-brand-green-darker/40 text-[11px] font-bold text-primary dark:text-primary">
                                                                        {initials(row.clientName)}
                                                                    </div>
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <span className="font-bold text-foreground dark:text-slate-100">{row.clientDisplayId}</span>
                                                                        <span className="text-xs text-slate-500">{row.clientName}</span>
                                                                    </div>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col gap-0.5">
                                                                    <span className="font-mono text-xs">{row.loanNumber}</span>
                                                                    <span className="text-xs text-slate-500">{row.productName ?? '—'}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right font-bold text-primary dark:text-primary">
                                                                ₹{new Intl.NumberFormat('en-IN').format(row.amount)}
                                                            </TableCell>
                                                            <TableCell className="text-center"><TabDot done={row.cashFlowComplete} /></TableCell>
                                                            <TableCell className="text-center"><TabDot done={row.loanAppraisalComplete} /></TableCell>
                                                            <TableCell className="text-center"><TabDot done={row.houseHoldVisitComplete} /></TableCell>
                                                            <TableCell className="text-center"><TabDot done={row.grtComplete} /></TableCell>
                                                            <TableCell className="text-center">
                                                                {row.isComplete
                                                                    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Complete</Badge>
                                                                    : <Badge variant="outline" className="text-amber-700 border-amber-300">Pending</Badge>}
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                <Button
                                                                    type="button" size="sm" variant="outline"
                                                                    className="h-8 px-2 border-primary text-primary hover:bg-green-50"
                                                                    onClick={() => setOpenLoanId(row.loanId)}
                                                                >
                                                                    Open <ChevronRight className="h-3.5 w-3.5 ml-1" />
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </TabsContent>

                                <TabsContent value="grt-sessions" className="pt-4">
                                    <GrtSessionsClient
                                        centerId={selectedCenterId}
                                        centerName={centers.find((c) => c.id === selectedCenterId)?.name ?? ''}
                                    />
                                </TabsContent>
                            </Tabs>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
