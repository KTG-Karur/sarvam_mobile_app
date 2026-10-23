'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Search, ChevronDown, RefreshCw, Wallet, Save, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage, type StoredUser } from '@/app/lib/token-storage';
import { useToast } from '@/hooks/use-toast';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawOpeningBalanceReport } from '@/app/lib/reports/opening-balance-pdf';
import { reportHeaderRows, autoSizeColumns, normalizeWorkbookNumbers } from '@/app/lib/reports/excel-report-header';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { DateInput } from '@/components/ui/date-input';

type BalanceType = 'CREDIT' | 'DEBIT';

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface OpeningBalanceApiRow {
    ledgerId: string;
    ledgerCode: string;
    ledgerName: string;
    balanceType: BalanceType;
    amount: number;
}

interface LedgerRow extends Omit<OpeningBalanceApiRow, 'amount'> {
    // Free-typed string so the input can go through an empty/partial state (e.g. "1.")
    // without snapping back to "0" on every keystroke; parsed with amountOf() when needed.
    amount: string;
}

interface SelfAccountApiRow {
    selfAccountId: string;
    name: string;
    type: 'CASH' | 'BANK' | null;
    balanceType: BalanceType;
    amount: number;
}

interface SelfAccountRow extends Omit<SelfAccountApiRow, 'amount'> {
    amount: string;
}

const amountOf = (value: string): number => {
    const parsed = parseFloat(value);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
};

// Asia/Kolkata "today" as YYYY-MM-DD — never new Date().toISOString(), which is UTC
// and defaults to yesterday's date before 05:30 IST.
const todayYmd = () =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());

// dateString is always a plain YYYY-MM-DD calendar date (no time/timezone component) —
// parse it directly rather than through `new Date()`, which would reinterpret it in the
// browser's local timezone.
const formatDateForDisplay = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (!match) return dateString;
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
};

export function OpeningBalanceClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const printRef = useRef<HTMLDivElement>(null);
    const branchDropdownRef = useRef<HTMLDivElement>(null);

    // Read via useEffect, not a useState initializer — tokenStorage.getUser() touches
    // localStorage, which is unavailable during SSR. Reading it synchronously in the
    // initializer would make the server-rendered HTML (no user) diverge from the
    // client's first render (real user), causing a hydration mismatch.
    const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
    const isAdmin = currentUser?.role === 'ADMIN';
    // Chart-of-accounts master data (Groups/Ledgers/Opening Balance) is Admin-only
    // throughout this app — matches navigation.config.ts's Accounts section.
    const canEdit = isAdmin;

    const [branches, setBranches] = useState<Branch[]>([]);
    const [isFetchingBranches, setIsFetchingBranches] = useState(true);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('');
    const [branchSearchQuery, setBranchSearchQuery] = useState('');
    const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);

    // Single opening date for the whole branch — every ledger shares it (see the API's
    // POST route, which syncs every row in a branch to this one date on save).
    const [wholeDate, setWholeDate] = useState<string>(todayYmd());
    // The date as loaded from the server — null when the branch has never been
    // configured. Used only to decide whether the user has actually changed it.
    const [baselineDate, setBaselineDate] = useState<string | null>(null);
    const [rows, setRows] = useState<LedgerRow[]>([]);
    const [baseline, setBaseline] = useState<Map<string, OpeningBalanceApiRow>>(new Map());
    const [selfRows, setSelfRows] = useState<SelfAccountRow[]>([]);
    const [selfBaseline, setSelfBaseline] = useState<Map<string, SelfAccountApiRow>>(new Map());
    const [isLoadingLedgers, setIsLoadingLedgers] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // Client-side filter for the ledger table only — never touches `rows` itself, so
    // edits, dirty-tracking, save, print and export all keep operating on the full set.
    const [ledgerSearchQuery, setLedgerSearchQuery] = useState('');

    const selectedBranch = branches.find((b) => b.id === selectedBranchId) || null;

    // Resolve the logged-in user client-side, then fetch the branch list scoped by
    // role: ADMIN sees all, AREA_MANAGER sees only assigned branches, everyone else
    // only sees (and is auto-set to) their own branch. Uses the freshly-read `user`
    // local variable rather than the `currentUser` state to avoid a same-commit
    // stale-closure read (the setCurrentUser update below isn't visible to this
    // effect until the next render).
    useEffect(() => {
        const user = tokenStorage.getUser();
        setCurrentUser(user);

        const fetchBranches = async () => {
            setIsFetchingBranches(true);
            try {
                if (user?.role === 'ADMIN') {
                    const res = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                    if (res.success && res.data) setBranches(res.data);
                } else if (user?.role === 'AREA_MANAGER') {
                    const res = await apiClient.get<{ branch: Branch }[]>(
                        `/area-manager-branches?userId=${user.id}`
                    );
                    if (res.success && res.data) setBranches(res.data.map((a) => a.branch));
                } else if (user?.branchId) {
                    const res = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                    if (res.success && res.data) {
                        const own = res.data.filter((b) => b.id === user.branchId);
                        setBranches(own);
                        if (own.length > 0) setSelectedBranchId(own[0].id);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch branches:', error);
                toast({ title: 'Error', description: 'Could not fetch branch list.', variant: 'destructive' });
            } finally {
                setIsFetchingBranches(false);
            }
        };
        fetchBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Close the searchable branch dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) {
                setIsBranchDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredBranches = branches.filter(
        (b) =>
            b.name.toLowerCase().includes(branchSearchQuery.toLowerCase()) ||
            b.code.toLowerCase().includes(branchSearchQuery.toLowerCase())
    );

    const loadBranch = async (branchId: string) => {
        setIsLoadingLedgers(true);
        try {
            const res = await apiClient.get<{
                openingDate: string | null;
                ledgers: OpeningBalanceApiRow[];
                selfAccounts?: SelfAccountApiRow[];
                totalAccounts: number;
            }>(`/accounts/opening-balance?branchId=${branchId}`);
            if (res.success && res.data) {
                const nextBaseline = new Map(res.data.ledgers.map((l) => [l.ledgerId, l]));
                setBaseline(nextBaseline);
                const selfList = res.data.selfAccounts ?? [];
                setSelfBaseline(new Map(selfList.map((s) => [s.selfAccountId, s])));
                setBaselineDate(res.data.openingDate);
                setWholeDate(res.data.openingDate ?? todayYmd());
                setRows(
                    res.data.ledgers.map((l) => ({
                        ...l,
                        amount: String(l.amount),
                    }))
                );
                setSelfRows(selfList.map((s) => ({ ...s, amount: String(s.amount) })));
            } else {
                throw new Error(res.message || res.error || 'Failed to load ledgers');
            }
        } catch (error: any) {
            console.error('Failed to load opening balances:', error);
            toast({ title: 'Error', description: error.message || 'Could not load ledgers for this branch.', variant: 'destructive' });
            setRows([]);
            setBaseline(new Map());
            setSelfRows([]);
            setSelfBaseline(new Map());
            setBaselineDate(null);
        } finally {
            setIsLoadingLedgers(false);
        }
    };

    const handleSelectBranch = (branchId: string) => {
        setSelectedBranchId(branchId);
        setIsBranchDropdownOpen(false);
        setBranchSearchQuery('');
        loadBranch(branchId);
    };

    const updateRow = (ledgerId: string, patch: Partial<LedgerRow>) => {
        setRows((prev) => prev.map((r) => (r.ledgerId === ledgerId ? { ...r, ...patch } : r)));
    };

    const updateSelfRow = (selfAccountId: string, patch: Partial<SelfAccountRow>) => {
        setSelfRows((prev) => prev.map((r) => (r.selfAccountId === selfAccountId ? { ...r, ...patch } : r)));
    };

    const isRowDirty = (row: LedgerRow): boolean => {
        const base = baseline.get(row.ledgerId);
        const baseAmount = base?.amount ?? 0;
        const baseType: BalanceType = base?.balanceType ?? 'CREDIT';

        if (amountOf(row.amount) !== baseAmount) return true;
        if (row.balanceType !== baseType) return true;
        return false;
    };

    const isSelfRowDirty = (row: SelfAccountRow): boolean => {
        const base = selfBaseline.get(row.selfAccountId);
        const baseAmount = base?.amount ?? 0;
        const baseType: BalanceType = base?.balanceType ?? 'DEBIT';
        if (amountOf(row.amount) !== baseAmount) return true;
        if (row.balanceType !== baseType) return true;
        return false;
    };

    const dirtyRows = rows.filter(isRowDirty);
    const dirtySelfRows = selfRows.filter(isSelfRowDirty);
    // The date itself only counts as a pending change once a branch has actually been
    // configured before — a brand-new branch's date is just "the date it'll be saved
    // with" once the admin edits an amount, not a change in its own right.
    const isDateDirty = baselineDate !== null && wholeDate !== baselineDate;
    const hasUnsavedChanges = dirtyRows.length > 0 || dirtySelfRows.length > 0 || isDateDirty;

    // Table-only view filter — matches on ledger name or account code.
    const normalizedLedgerQuery = ledgerSearchQuery.trim().toLowerCase();
    const visibleRows = normalizedLedgerQuery
        ? rows.filter(
              (r) =>
                  r.ledgerName.toLowerCase().includes(normalizedLedgerQuery) ||
                  (r.ledgerCode || '').toLowerCase().includes(normalizedLedgerQuery)
          )
        : rows;

    const handleSave = async () => {
        if (!selectedBranchId) return;
        if (!hasUnsavedChanges) {
            toast({ title: 'No changes', description: 'There are no opening balance changes to save.' });
            return;
        }

        setIsSaving(true);
        try {
            const entries = dirtyRows.map((r) => ({
                ledgerId: r.ledgerId,
                balanceType: r.balanceType,
                amount: amountOf(r.amount),
            }));
            const selfEntries = dirtySelfRows.map((r) => ({
                selfAccountId: r.selfAccountId,
                balanceType: r.balanceType,
                amount: amountOf(r.amount),
            }));
            const res = await apiClient.post('/accounts/opening-balance', {
                branchId: selectedBranchId,
                openingDate: wholeDate,
                entries,
                selfEntries,
            });
            if (!res.success) throw new Error(res.message || res.error || 'Failed to save opening balances');

            toast({ title: 'Saved', description: `${entries.length + selfEntries.length} opening balance(s) updated.` });
            await loadBranch(selectedBranchId);
        } catch (error: any) {
            console.error('Failed to save opening balances:', error);
            toast({ title: 'Error', description: error.message || 'Failed to save opening balances.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `OpeningBalance_${selectedBranch?.code || ''}`,
    });

    const buildExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['S.No', 'Account Name', 'Account Code', 'Opening Balance Type', 'Opening Balance Amount'];
        const selfDataRows = selfRows.map((r) => [
            r.name,
            'Self Account',
            r.balanceType === 'CREDIT' ? 'Credit' : 'Debit',
            Number(amountOf(r.amount).toFixed(2)),
        ]);
        const ledgerDataRows = rows.map((r) => [
            r.ledgerName,
            r.ledgerCode || '-',
            r.balanceType === 'CREDIT' ? 'Credit' : 'Debit',
            Number(amountOf(r.amount).toFixed(2)),
        ]);
        const dataRows = [...selfDataRows, ...ledgerDataRows].map((r, i) => [i + 1, ...r]);
        return { headers, rows: dataRows };
    };

    const exportTitle = `OPENING BALANCE DETAILS — ${selectedBranch ? `${selectedBranch.code} - ${selectedBranch.name}` : ''}${wholeDate ? ` (as of ${formatDateForDisplay(wholeDate)})` : ''}`;
    const exportFileNameBase = `OpeningBalance_${selectedBranch?.code || ''}_${todayYmd()}`;

    const hasExportData = rows.length > 0 || selfRows.length > 0;

    const handleExportExcel = () => {
        if (!hasExportData) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows: exportRows } = buildExportRows();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([...reportHeaderRows(exportTitle), headers, ...exportRows]);
        autoSizeColumns(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        normalizeWorkbookNumbers(wb);
        XLSX.writeFile(wb, `${exportFileNameBase}.xlsx`);
        toast({ title: 'Export Successful', description: 'The opening balance report has been downloaded.' });
    };

    const handleExportPDF = async () => {
        if (!hasExportData) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        const { headers, rows: exportRows } = buildExportRows();
        await drawOpeningBalanceReport(
            doc,
            { headers, rows: exportRows },
            { subtitle: selectedBranch ? `Branch: ${selectedBranch.code} - ${selectedBranch.name}` : '' },
            reportFont
        );
        doc.save(`${exportFileNameBase}.pdf`);
        toast({ title: 'Export Successful', description: 'The opening balance report has been downloaded.' });
    };

    const handleExportCSV = () => {
        if (!hasExportData) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows: exportRows } = buildExportRows();
        exportToCSV(exportFileNameBase, 'OPENING BALANCE DETAILS', headers, exportRows);
    };

    // Word-only presentation: same rows as Excel/CSV/PDF above. No totals row exists in this
    // report today (nothing to preserve/style distinctly) and 5 flat columns don't warrant
    // grouped headers — just professional header/zebra/alignment/width styling.
    const wordOptions: WordExportOptions = {
        columnAlignments: ['center', 'left', 'center', 'center', 'right'],
        columnWidthWeights: [4, 18, 10, 12, 12],
    };

    const handleExportWord = async () => {
        if (!hasExportData) {
            toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
            return;
        }
        const { headers, rows: exportRows } = buildExportRows();
        await exportToWord(exportFileNameBase, 'OPENING BALANCE DETAILS', headers, exportRows, wordOptions);
    };

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-[1600px] space-y-6">
                    {/* Page Header */}
                    <div className="flex items-center gap-3 mb-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg">
                            <Wallet className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground dark:text-white">
                                Opening Balance Details
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                View and update the opening balances of account ledgers, branch-wise
                            </p>
                        </div>
                    </div>

                    {/* Controls Card */}
                    <Card className="border-primary/20 bg-white shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
                        <CardHeader className="border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-sidebar-accent/50">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-tint text-primary dark:bg-brand-green-darker/30 dark:text-primary">
                                    <Filter className="h-4 w-4" />
                                </div>
                                <div>
                                    <CardTitle className="text-base font-semibold text-foreground dark:text-white">
                                        Branch &amp; Date
                                    </CardTitle>
                                    <CardDescription>Select a branch to load its ledger opening balances</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                                {/* Branch — searchable select */}
                                <div className="space-y-2 relative" ref={branchDropdownRef}>
                                    <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Branch <span className="text-red-500">*</span>
                                    </Label>
                                    <div
                                        className={cn(
                                            'h-11 border border-primary/30 dark:border-sidebar-accent rounded-md px-3 flex items-center justify-between cursor-pointer bg-white dark:bg-green-950',
                                            isFetchingBranches && 'opacity-60 cursor-not-allowed'
                                        )}
                                        onClick={() => !isFetchingBranches && setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                                    >
                                        <span className={selectedBranchId ? 'text-foreground dark:text-white truncate' : 'text-slate-500 dark:text-slate-400'}>
                                            {isFetchingBranches
                                                ? 'Fetching...'
                                                : selectedBranch
                                                ? `${selectedBranch.code} - ${selectedBranch.name}`
                                                : '-- SELECT BRANCH --'}
                                        </span>
                                        {isFetchingBranches ? (
                                            <RefreshCw className="h-4 w-4 opacity-50 animate-spin" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        )}
                                    </div>

                                    {isBranchDropdownOpen && (
                                        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-green-950 border border-primary/20 dark:border-sidebar-accent rounded-md shadow-lg overflow-hidden">
                                            <div className="p-2 border-b border-slate-100 dark:border-sidebar-accent flex items-center gap-2">
                                                <Search className="h-4 w-4 text-slate-400" />
                                                <Input
                                                    placeholder="Search branch..."
                                                    value={branchSearchQuery}
                                                    onChange={(e) => setBranchSearchQuery(e.target.value)}
                                                    className="h-8 border-none focus-visible:ring-0 px-0 shadow-none text-sm"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="max-h-60 overflow-auto p-1">
                                                {filteredBranches.map((b) => (
                                                    <div
                                                        key={b.id}
                                                        className={cn(
                                                            'px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-brand-green-tint dark:hover:bg-sidebar-accent truncate',
                                                            selectedBranchId === b.id && 'bg-green-50 dark:bg-brand-green-darker/50 text-primary dark:text-primary font-medium'
                                                        )}
                                                        onClick={() => handleSelectBranch(b.id)}
                                                    >
                                                        {b.code} - {b.name}
                                                    </div>
                                                ))}
                                                {filteredBranches.length === 0 && (
                                                    <div className="px-2 py-3 text-sm text-center text-slate-500">No branch found.</div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Total Accounts */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">Total Accounts #</Label>
                                    <div className="h-11 flex items-center px-3 rounded-md border border-primary/20 bg-green-50/50 dark:border-sidebar-accent dark:bg-brand-green-darker/30 font-semibold text-foreground dark:text-white">
                                        {rows.length}
                                    </div>
                                </div>

                                {/* Opening Balance Date — one date for the whole branch */}
                                <div className="space-y-2">
                                    <Label htmlFor="wholeDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Opening Balance Date
                                    </Label>
                                    <DateInput
                                        id="wholeDate"
                                        value={wholeDate}
                                        onChange={(e) => setWholeDate(e.target.value)}
                                        disabled={!canEdit}
                                        className="h-11 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>

                                {/* Export */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 invisible md:visible">Export</Label>
                                    <div className="flex items-center gap-2">
                                        <ExportDropdown
                                            onExportPDF={handleExportPDF}
                                            onExportExcel={handleExportExcel}
                                            onExportCSV={handleExportCSV}
                                            onExportWord={handleExportWord}
                                            canExport={canExportReport('opening-balance')}
                                            reportSlug={selectedBranchId && getReportExportMode('opening-balance') === 'REQUEST_QUEUE' ? 'opening-balance' : undefined}
                                            exportParams={{
                                                fromDate: null,
                                                toDate: null,
                                                branchIds: selectedBranchId ? [selectedBranchId] : 'ALL',
                                                filters: null,
                                            }}
                                        />
                                        <Button variant="outline" onClick={() => handlePrint()} disabled={rows.length === 0}>
                                            Print
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Self Accounts — Cash in Hand / Bank / bank sub-accounts. These feed
                        Day Book, Receipts & Payments, the self-account rows of GL One/All,
                        and the EOD cash position directly (by selfAccountId), so the
                        branch's cash/bank position must be entered HERE, as Debit. */}
                    {selectedBranchId && (
                    <Card className="border-primary/30 bg-white shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
                        <CardHeader className="border-b border-slate-100 bg-green-50/50 px-6 py-4 dark:border-sidebar-accent dark:bg-sidebar-accent/50">
                            <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-tint text-primary dark:bg-brand-green-darker/30 dark:text-primary">
                                    <Wallet className="h-4 w-4" />
                                </div>
                                <div>
                                    <CardTitle className="text-base font-semibold text-foreground dark:text-white">
                                        Self Accounts (Cash / Bank)
                                    </CardTitle>
                                    <CardDescription>
                                        Branch cash &amp; bank opening position. Used by Day Book, Receipts &amp; Payments and EOD — enter as <strong>Debit</strong>. Transactions dated before the Opening Balance Date above are ignored; balances start from these figures.
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Self Account</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Opening Balance Type</TableHead>
                                            <TableHead className="text-right">Opening Balance Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoadingLedgers ? (
                                            <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">Loading self accounts...</TableCell></TableRow>
                                        ) : selfRows.length === 0 ? (
                                            <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">No active self accounts. Create them in Accounts → Self Accounts.</TableCell></TableRow>
                                        ) : (
                                            selfRows.map((row) => (
                                                <TableRow key={row.selfAccountId} className={cn(isSelfRowDirty(row) && 'bg-green-50/60 dark:bg-brand-green-darker/40')}>
                                                    <TableCell className="font-medium">{row.name}</TableCell>
                                                    <TableCell>{row.type ?? '-'}</TableCell>
                                                    <TableCell>
                                                        <Select
                                                            value={row.balanceType}
                                                            onValueChange={(v) => updateSelfRow(row.selfAccountId, { balanceType: v as BalanceType })}
                                                            disabled={!canEdit}
                                                        >
                                                            <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="DEBIT">Debit</SelectItem>
                                                                <SelectItem value="CREDIT">Credit</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            step="0.01"
                                                            value={row.amount}
                                                            onChange={(e) => updateSelfRow(row.selfAccountId, { amount: e.target.value })}
                                                            onBlur={() => updateSelfRow(row.selfAccountId, { amount: String(amountOf(row.amount)) })}
                                                            disabled={!canEdit}
                                                            className="h-9 w-[140px] text-right ml-auto"
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                    )}

                    {/* Table */}
                    <Card className="border-primary/20 bg-white shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker">
                        <CardContent className="p-0">
                          {selectedBranchId && rows.length > 0 && (
                            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-sidebar-accent print:hidden">
                                <div className="relative w-full max-w-sm">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        placeholder="Search account name or code..."
                                        value={ledgerSearchQuery}
                                        onChange={(e) => setLedgerSearchQuery(e.target.value)}
                                        className="h-9 pl-9 border-primary/30 dark:border-sidebar-accent"
                                    />
                                </div>
                                {normalizedLedgerQuery && (
                                    <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                                        {visibleRows.length} of {rows.length}
                                    </span>
                                )}
                            </div>
                          )}
                          <div ref={printRef}>
                            <div className="hidden print:block p-6">
                                <ReportHeader title="OPENING BALANCE DETAILS" subtitle={selectedBranch ? `Branch: ${selectedBranch.code} - ${selectedBranch.name}` : ''} />
                            </div>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Account Name</TableHead>
                                            <TableHead>Account Code</TableHead>
                                            <TableHead>Opening Balance Type</TableHead>
                                            <TableHead className="text-right">Opening Balance Amount</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoadingLedgers ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-10 text-slate-500">
                                                    Loading ledgers...
                                                </TableCell>
                                            </TableRow>
                                        ) : !selectedBranchId ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-10 text-slate-500">
                                                    Select a branch to load its ledger opening balances.
                                                </TableCell>
                                            </TableRow>
                                        ) : rows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-10 text-slate-500">
                                                    No active ledgers found.
                                                </TableCell>
                                            </TableRow>
                                        ) : visibleRows.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-10 text-slate-500">
                                                    No ledgers match &ldquo;{ledgerSearchQuery.trim()}&rdquo;.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            visibleRows.map((row) => (
                                                <TableRow key={row.ledgerId} className={cn(isRowDirty(row) && 'bg-green-50/60 dark:bg-brand-green-darker/40')}>
                                                    <TableCell className="font-medium">{row.ledgerName}</TableCell>
                                                    <TableCell>{row.ledgerCode || '-'}</TableCell>
                                                    <TableCell>
                                                        <Select
                                                            value={row.balanceType}
                                                            onValueChange={(v) => updateRow(row.ledgerId, { balanceType: v as BalanceType })}
                                                            disabled={!canEdit}
                                                        >
                                                            <SelectTrigger className="h-9 w-[120px]">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="CREDIT">Credit</SelectItem>
                                                                <SelectItem value="DEBIT">Debit</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            step="0.01"
                                                            value={row.amount}
                                                            onChange={(e) => updateRow(row.ledgerId, { amount: e.target.value })}
                                                            onBlur={() => updateRow(row.ledgerId, { amount: String(amountOf(row.amount)) })}
                                                            disabled={!canEdit}
                                                            className="h-9 w-[140px] text-right ml-auto"
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                          </div>
                        </CardContent>
                    </Card>

                    {/* Save */}
                    {canEdit && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {hasUnsavedChanges
                                    ? [
                                          dirtyRows.length ? `${dirtyRows.length} ledger change(s)` : '',
                                          dirtySelfRows.length ? `${dirtySelfRows.length} self account change(s)` : '',
                                          isDateDirty ? 'date change' : '',
                                      ].filter(Boolean).join(' + ') + ' unsaved'
                                    : 'No unsaved changes'}
                            </p>
                            <Button
                                onClick={handleSave}
                                disabled={!selectedBranchId || isSaving || !hasUnsavedChanges}
                                className="bg-primary hover:bg-sidebar-accent text-white"
                            >
                                <Save className="h-4 w-4 mr-2" />
                                {isSaving ? 'Saving...' : 'Save'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
