'use client'; 
import { useCallback, useEffect, useMemo, useState } from 'react'; 
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'; 
import { Button } from '@/components/ui/button'; 
import { Input } from '@/components/ui/input'; 
import { Label } from '@/components/ui/label'; 
import { Textarea } from '@/components/ui/textarea'; 
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from '@/components/ui/table'; 
import { Banknote, Coins, Save, RefreshCw, CheckCircle2, CalendarDays, Info, Loader2, Building2, ImageIcon, Wallet, ArrowLeftRight, Scale, NotebookPen, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { amountsMatchForDenomination } from '@/app/lib/denomination-money';
import { DENOMINATION_UI_ROWS, type DenomUiKey } from '@/components/utilities/denomination-ui-rows';
import { apiClient } from '@/app/lib/api-client';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, }).format(amount);

type Variant = 'page' | 'embedded'; 

export type DenominationVerificationPayload = {
  collectionTotal: number;
  denominationTotal: number;
  difference: number;
  amountsMatch: boolean;
  /** Saved row matches collection and matches current inputs (safe to close EOD). */
  readyForEodClose: boolean;
  /** Current on-screen note counts and remarks — for submitting without a separate save step. */
  counts: Record<DenomUiKey, number>;
  remarks: string;
};

type Props = {
  dateYmd: string;
  variant?: Variant;
  showDateSelector?: boolean;
  onVerificationChange?: (payload: DenominationVerificationPayload) => void;
  /**
   * Read-only history mode: always honours `dateYmd` (no admin/today lock), shows the
   * persisted DenominationEntry exactly as saved (no live FDO-collection override), and
   * hides every editing affordance (Save/Reset/remarks input). Used by the EOD Process
   * page to display "what was completed" for an already-closed business date.
   */
  readOnlyView?: boolean;
  /**
   * Explicit branch override — used by the EOD Process page's Admin/Area-Manager
   * branch picker so this panel reads/writes the selected branch instead of the
   * caller's own active branch. Ignored server-side for roles not allowed to
   * view another branch (see resolveEodViewBranchId).
   */
  branchId?: string | null;
};

type StatTone = 'default' | 'success' | 'warning' | 'danger';

const STAT_ICON_TONES: Record<StatTone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  warning: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  danger: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
};

const STAT_VALUE_TONES: Record<StatTone, string> = {
  default: 'text-foreground',
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-700 dark:text-rose-300',
};

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTone;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-800">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', STAT_ICON_TONES[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <div className={cn('mt-1 text-lg font-bold tabular-nums leading-tight', STAT_VALUE_TONES[tone])}>{value}</div>
        {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function SummaryLine({ dotClass, label, count, amount }: { dotClass: string; label: string; count: string; amount: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className={cn('h-2 w-2 rounded-full', dotClass)} />
        {label}
      </span>
      <span className="w-12 text-right tabular-nums text-foreground">{count}</span>
      <span className="w-28 text-right font-medium tabular-nums text-foreground">{amount}</span>
    </div>
  );
}

const emptyCounts = (): Record<DenomUiKey, number> => ({
  d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0,
});

export function DenominationEntryPanel({
  dateYmd,
  variant = 'page',
  showDateSelector = true,
  onVerificationChange,
  readOnlyView = false,
  branchId = null,
}: Props) {
  const { toast } = useToast();
  const embedded = variant === 'embedded';

  // State for user and admin status
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isLoadingUser, setIsLoadingUser] = useState<boolean>(true);
  
  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };
  
  // When embedded inside the EOD flow, the date is always the server-controlled
  // EOD working date (dateYmd prop). The admin/non-admin override only applies
  // on the standalone denomination page (variant === 'page').
  const [selectedDate, setSelectedDate] = useState<string>(() => dateYmd);
  
  const [counts, setCounts] = useState<Record<DenomUiKey, number>>(emptyCounts);
  const [remarks, setRemarks] = useState('');
  const [isLoading, setIsLoading] = useState(false); 
  const [isSaving, setIsSaving] = useState(false); 
  const [existingEntry, setExistingEntry] = useState<Record<string, unknown> | null>(null); 
  const [lastSaved, setLastSaved] = useState<string | null>(null); 
  const [expectedAmount, setExpectedAmount] = useState(0);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [todayCollection, setTodayCollection] = useState(0);
  const [todayDisbursement, setTodayDisbursement] = useState(0);
  const [financialCashIn, setFinancialCashIn] = useState(0);
  const [financialCashOut, setFinancialCashOut] = useState(0);
  const [pendingEodAllocation, setPendingEodAllocation] = useState(0);
  const [amountMatches, setAmountMatches] = useState<boolean | null>(null);
  const [centerBreakdown, setCenterBreakdown] = useState<Array<{
    centerName: string; centerCode: string; totalAmount: number; photoKey: string;
  }>>([]);

  // Load user from localStorage to determine admin status
  useEffect(() => {
    const loadUser = () => {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          // Check if user role is ADMIN (case-insensitive check)
          setIsAdmin(user?.role?.toUpperCase() === 'ADMIN');
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('Failed to parse user from localStorage:', error);
        setIsAdmin(false);
      } finally {
        setIsLoadingUser(false);
      }
    };
    
    loadUser();
  }, []);

  // Resolve the active date after user role is known.
  // Rules:
  //   - embedded (EOD step 2): ALWAYS use dateYmd — date is server-controlled.
  //     The EOD process dictates which working date to close; user role is irrelevant.
  //   - page + non-admin: lock to today's wall-clock date (existing behaviour).
  //   - page + admin: use dateYmd (admin can pick any date).
  // This also re-runs whenever dateYmd changes (e.g. after advancing to next catch-up day).
  useEffect(() => {
    if (!isLoadingUser) {
      if (variant === 'embedded' || readOnlyView) {
        // EOD embedded mode, or read-only history mode: honour the caller-supplied date.
        setSelectedDate(dateYmd);
      } else if (!isAdmin) {
        // Standalone page, non-admin: locked to today.
        setSelectedDate(getTodayDate());
      } else {
        // Standalone page, admin: use the provided dateYmd.
        setSelectedDate(dateYmd);
      }
    }
  }, [isAdmin, isLoadingUser, dateYmd, variant, readOnlyView]);

  const totalAmount = useMemo(
    () => DENOMINATION_UI_ROWS.reduce((sum, d) => sum + counts[d.key] * d.value, 0),
    [counts]
  );

// Keep totalNotes as is (only physical notes count)
  const totalNotes = useMemo( 
    () => DENOMINATION_UI_ROWS.reduce((sum, d) => sum + counts[d.key], 0), 
    [counts] 
  ); 

  const liveMatchesCollection = amountsMatchForDenomination(totalAmount, expectedAmount);
  const difference = expectedAmount - totalAmount;
  // Display-only: how much of the expected cash the count covers (capped at 100).
  const matchPercent = liveMatchesCollection
    ? 100
    : expectedAmount > 0
      ? Math.min(100, Math.floor((totalAmount / expectedAmount) * 100))
      : 0;

  // The POST route rejects (400) a mismatched count and any day with collection
  // still awaiting "Allocate for EOD" — disable Save up front so the BM can't fire
  // a request that can only fail. `saveBlockedReason` doubles as the button tooltip.
  const saveBlockedReason = !liveMatchesCollection
    ? 'Denomination total does not match the expected cash balance — recount before saving.'
    : pendingEodAllocation > 0
      ? `${formatCurrency(pendingEodAllocation)} of collection is not yet allocated to EOD — allocate it first.`
      : null;
  const saveBlocked = saveBlockedReason !== null;

  const countsAlignWithPersistedEntry = useMemo(() => {
    if (!existingEntry) return false;
    return DENOMINATION_UI_ROWS.every(
      (r) => counts[r.key] === Number(existingEntry[r.key] ?? 0)
    );
  }, [existingEntry, counts]);

  // A mismatch now hard-blocks the save itself (POST /api/denomination-entry
  // rejects with 400, no bypass for any role — see app/api/denomination-entry/route.ts),
  // so "ready" must require the live count to match the expected total, not just
  // that it's saved.
  const readyForEodClose = liveMatchesCollection && (
    embedded ? true : Boolean(existingEntry) && countsAlignWithPersistedEntry
  );

  useEffect(() => {
    onVerificationChange?.({
      collectionTotal: expectedAmount,
      denominationTotal: totalAmount,
      difference,
      amountsMatch: liveMatchesCollection,
      readyForEodClose,
      counts,
      remarks,
    });
  }, [
    expectedAmount,
    totalAmount,
    difference,
    liveMatchesCollection,
    readyForEodClose,
    counts,
    remarks,
    onVerificationChange,
  ]);

  const fetchEntry = useCallback(
  async (date: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/denomination-entry?${params}`);
      const result = await res.json();
      if (result.success) {
        const payload = result.data;
        const entry = payload?.entry ?? null;
        setExpectedAmount(Number(payload?.expectedAmount || 0));
        setOpeningBalance(Number(payload?.openingBalance || 0));
        setTodayCollection(Number(payload?.todayCollection || 0));
        setTodayDisbursement(Number(payload?.todayDisbursement || 0));
        setFinancialCashIn(Number(payload?.financialCashIn || 0));
        setFinancialCashOut(Number(payload?.financialCashOut || 0));
        setPendingEodAllocation(Number(payload?.pendingEodAllocation || 0));
        setAmountMatches(typeof payload?.amountMatches === 'boolean' ? payload.amountMatches : null);
        if (entry) {
          setCounts({
            d500: Number(entry.d500) || 0,
            d200: Number(entry.d200) || 0,
            d100: Number(entry.d100) || 0,
            d50: Number(entry.d50) || 0,
            d20: Number(entry.d20) || 0,
            d10: Number(entry.d10) || 0,
            d5: Number(entry.d5) || 0,
            d2: Number(entry.d2) || 0,
            d1: Number(entry.d1) || 0,
          });
          setRemarks(typeof entry.remarks === 'string' ? entry.remarks : '');
          setExistingEntry(entry as Record<string, unknown>);
          setLastSaved(toDisplayDateTime(new Date(String(entry.updatedAt))));
        } else {
          setCounts(emptyCounts());
          setRemarks('');
          setExistingEntry(null);
          setLastSaved(null);
        }

        // Per-center collection denomination summary — reference only (see the
        // "Center-wise collection breakdown" card). Deliberately never used to
        // prefill the BM's cash-count inputs: FDOs frequently record the wrong
        // note breakdown at center meetings, so the BM must always enter their
        // own physical count from scratch rather than start from FDO-reported figures.
        try {
          const summaryQuery = branchId ? `?branchId=${branchId}` : '';
          const summaryResult = await apiClient.get<{
            workingDateYmd: string | null;
            counts: Record<DenomUiKey, number>;
            upi: number;
            centers: Array<{ centerName: string; centerCode: string; totalAmount: number; photoKey: string }>;
          }>(`/utilities/eod-process/collection-denomination-summary${summaryQuery}`);

          if (summaryResult.success && summaryResult.data?.workingDateYmd === date) {
            setCenterBreakdown(summaryResult.data.centers ?? []);
          } else {
            setCenterBreakdown([]);
          }
        } catch {
          setCenterBreakdown([]);
        }
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to fetch denomination data.' });
    } finally {
      setIsLoading(false);
    }
  },
  [toast, branchId]
);

  useEffect(() => {
    if (!isLoadingUser && selectedDate) {
      void fetchEntry(selectedDate);
    }
  }, [selectedDate, fetchEntry, isLoadingUser]);

  // Re-pulls only the "expected" side (opening balance, today's collection, approved
  // voucher net cash, disbursements) — e.g. after a cash voucher gets approved while
  // this page is already open. Deliberately leaves counts/upiAmount/remarks alone so
  // it never wipes out note counts the BM has already typed in but not yet saved.
  const refreshExpectedAmount = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (branchId) params.set('branchId', branchId);
      const res = await fetch(`/api/denomination-entry?${params}`);
      const result = await res.json();
      if (result.success) {
        const payload = result.data;
        setExpectedAmount(Number(payload?.expectedAmount || 0));
        setOpeningBalance(Number(payload?.openingBalance || 0));
        setTodayCollection(Number(payload?.todayCollection || 0));
        setTodayDisbursement(Number(payload?.todayDisbursement || 0));
        setFinancialCashIn(Number(payload?.financialCashIn || 0));
        setFinancialCashOut(Number(payload?.financialCashOut || 0));
        setPendingEodAllocation(Number(payload?.pendingEodAllocation || 0));
        setAmountMatches(typeof payload?.amountMatches === 'boolean' ? payload.amountMatches : null);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to refresh expected amount.' });
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate, branchId, toast]);

  const handleSave = async () => { 
    setIsSaving(true); 
    try { 
      const res = await fetch('/api/denomination-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, branchId, ...counts, remarks }),
      });
      const result = await res.json(); 
      if (res.status === 423) { 
        toast({ 
          variant: 'destructive', 
          title: 'Branch is locked', 
          description: (typeof result?.error === 'string' && result.error) || 'Denomination cannot be saved while the branch is outside its write window.', 
        }); 
        return; 
      } 
      if (result.success) { 
        const payload = result.data; 
        const entry = payload?.entry; 
        setExistingEntry(entry); 
        setExpectedAmount(Number(payload?.expectedAmount || 0));
        setOpeningBalance(Number(payload?.openingBalance || 0));
        setTodayCollection(Number(payload?.todayCollection || 0));
        setTodayDisbursement(Number(payload?.todayDisbursement || 0));
        setFinancialCashIn(Number(payload?.financialCashIn || 0));
        setFinancialCashOut(Number(payload?.financialCashOut || 0));
        setPendingEodAllocation(Number(payload?.pendingEodAllocation || 0));
        setAmountMatches(Boolean(payload?.amountMatches));
        setLastSaved(toDisplayDateTime(new Date())); 
        toast({ 
          title: 'Saved Successfully', 
          description: `Denomination entry for ${toDisplayDate(new Date(selectedDate))} saved.`, 
        }); 
      } else { 
        toast({ 
          variant: 'destructive', 
          title: 'Save Failed', 
          description: result.error || 'Could not save denomination entry.', 
        }); 
      } 
    } catch { 
      toast({ 
        variant: 'destructive', 
        title: 'Network Error', 
        description: 'Unable to connect to server.', 
      }); 
    } finally { 
      setIsSaving(false); 
    } 
  }; 

  const handleReset = () => {
    setCounts(emptyCounts());
    setRemarks('');
    toast({ title: 'Reset', description: 'All denomination counts have been cleared.' }); 
  }; 

  const updateCount = (key: DenomUiKey, value: string) => {
    const num = parseInt(value, 10) || 0;
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, num) }));
  };

  const handleViewCenterPhoto = async (photoKey: string) => {
    const result = await apiClient.get<{ url: string }>(`/storage/signed-url?key=${encodeURIComponent(photoKey)}`);
    if (result.success && result.data?.url) {
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load meeting photo.' });
    }
  };

  // Check if date selector should be shown (only for admin when showDateSelector is true)
  const shouldShowDateSelector = showDateSelector && isAdmin;
  // Embedded live EOD flow shows "Ready / Not yet"; read-only history shows the saved-entry state.
  const liveEodStatus = embedded && !readOnlyView;

  // Show loading state while checking user
  if (isLoadingUser) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm text-slate-500">Loading user information...</p>
        </div>
      </div>
    );
  }

  return ( 
    <div className={cn('space-y-6 relative rounded-lg', embedded && 'space-y-4')}> 
      {/* Loader Overlays */}
      {isLoading && !shouldShowDateSelector && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[2px] dark:bg-green-950/70 transition-all duration-300 rounded-lg">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl dark:bg-brand-green-darker mb-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary dark:text-primary" />
            </div>
            <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-200 animate-pulse">
                Fetching denomination data...
            </p>
        </div>
      )}
      {isSaving && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/70 backdrop-blur-[2px] dark:bg-green-950/70 transition-all duration-300 rounded-lg">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-xl dark:bg-brand-green-darker mb-4">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600 dark:text-emerald-500" />
            </div>
            <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-200 animate-pulse">
                Saving denomination entry...
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                Please wait while we update the records
            </p>
        </div>
      )}

      {!embedded && ( 
        <div className="mb-2 flex items-center gap-4"> 
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30"> 
            <Banknote className="h-7 w-7 text-white" /> 
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" /> 
          </div> 
          <div> 
            <h2 className="text-2xl font-bold tracking-tight text-foreground dark:text-white"> 
              Denomination Entry 
            </h2> 
            <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1"> 
              Record daily cash denomination count for your branch 
            </p>
            {!isAdmin && !readOnlyView && (
              <p className="text-xs text-primary dark:text-primary mt-1">
                Date is fixed to today for non-admin users
              </p>
            )}
            {readOnlyView && (
              <p className="text-xs text-primary dark:text-primary mt-1">
                {existingEntry ? 'Viewing the saved entry for this date (read-only)' : 'No denomination entry was recorded for this date'}
              </p>
            )}
          </div> 
        </div> 
      )} 

      {embedded && !readOnlyView && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              Enter the actual cash on hand — including opening balance and any cash
              receipts/payments. The count must exactly match the branch&apos;s expected
              cash balance shown below — a mismatch cannot be saved and will block EOD.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshExpectedAmount()}
            disabled={isLoading}
            className="h-8 shrink-0 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300"
            title="Pull in any newly-approved vouchers without resetting the counts you've entered"
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          icon={Coins}
          label="Denomination Total"
          value={formatCurrency(totalAmount)}
        />
        <StatTile
          icon={Wallet}
          label="Today's Collection"
          value={formatCurrency(todayCollection)}
        />
        <StatTile
          icon={ArrowLeftRight}
          label="Today's Transaction"
          value={
            <span className="block space-y-0.5 text-sm">
              <span className="block">In&nbsp;&nbsp;{formatCurrency(financialCashIn)}</span>
              <span className="block">Out&nbsp;{formatCurrency(financialCashOut)}</span>
            </span>
          }
          hint="Cash vouchers created today (excludes collection)"
        />
        <StatTile
          icon={Scale}
          label="Difference (expected − counted)"
          value={formatCurrency(difference)}
          tone={liveMatchesCollection ? 'success' : 'danger'}
          hint={liveMatchesCollection ? undefined : 'Denomination total does not match collection total.'}
        />
        <StatTile
          icon={(liveEodStatus ? readyForEodClose : existingEntry) ? CheckCircle2 : Info}
          label={liveEodStatus ? 'Status' : 'Saved entry'}
          value={liveEodStatus ? (readyForEodClose ? 'Ready' : 'Not yet') : (existingEntry ? 'Yes' : 'Not saved')}
          tone={(liveEodStatus ? readyForEodClose : existingEntry) ? 'success' : 'warning'}
          hint={!liveEodStatus && lastSaved ? `Last on ${lastSaved}` : undefined}
        />
      </div>

      {!embedded && ( 
        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-md overflow-hidden"> 
          <CardContent className="pt-4 pb-4"> 
            <div className="flex items-center justify-between gap-4 flex-wrap"> 
              <div className="flex items-center gap-3"> 
                <Coins className="h-8 w-8 text-primary" /> 
                <div> 
                  <p className="text-sm font-medium text-sidebar-accent dark:text-slate-200">Total notes / coins</p> 
                  <p className="text-2xl font-bold text-foreground dark:text-slate-50"> 
                    {totalNotes.toLocaleString('en-IN')} 
                  </p> 
                </div> 
              </div> 
            </div> 
          </CardContent> 
        </Card> 
      )} 

      {/* Opening balance + collection + vouchers + disbursement breakdown — every
          line that feeds into "Total expected" must be shown here, otherwise the
          total can jump for a reason the branch manager can't see (e.g. an
          approved cash voucher posted same-day). */}
      {(openingBalance > 0 || todayCollection > 0 || todayDisbursement > 0 || financialCashIn > 0 || financialCashOut > 0 || expectedAmount > 0) && (
        <Card className={cn(
          'rounded-xl border border-slate-200 bg-card dark:border-slate-800',
          embedded && 'shadow-sm'
        )}>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs font-semibold text-primary dark:text-primary mb-2">Expected breakdown</p>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 dark:text-slate-400">Opening balance</span>
                <span className="text-xs font-medium text-sidebar-accent dark:text-slate-200">{formatCurrency(openingBalance)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Today&apos;s collection <span className="text-[10px]">(allocated to GL)</span>
                </span>
                <span className="text-xs font-medium text-sidebar-accent dark:text-slate-200">{formatCurrency(todayCollection)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 dark:text-slate-400">Today&apos;s transaction — cash in</span>
                <span className="text-xs font-medium text-sidebar-accent dark:text-slate-200">{formatCurrency(financialCashIn)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-rose-500 dark:text-rose-400">Today&apos;s transaction — cash out</span>
                <span className="text-xs font-medium text-rose-600 dark:text-rose-400">{formatCurrency(financialCashOut)}</span>
              </div>
              {todayDisbursement > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-rose-500 dark:text-rose-400">Today&apos;s disbursement — cash out</span>
                  <span className="text-xs font-medium text-rose-600 dark:text-rose-400">{formatCurrency(todayDisbursement)}</span>
                </div>
              )}
              <div className="flex justify-between items-center border-t border-primary dark:border-primary pt-1 mt-1">
                <span className="text-xs font-semibold text-primary dark:text-primary">Total expected (closing balance)</span>
                <span className="text-xs font-bold text-foreground dark:text-primary">{formatCurrency(expectedAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {pendingEodAllocation > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
          {formatCurrency(pendingEodAllocation)} of collection is not yet allocated to EOD. Allocate it in
          Collections → Approval → Allocate for EOD before closing — until then it is excluded from
          today&apos;s collection and the expected cash balance, and EOD close is blocked.
        </div>
      )}

      {amountMatches === false && existingEntry && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
          The saved denomination entry does not match the expected cash balance for this branch and date. Update the count and save again — a mismatched entry cannot be re-saved.
        </div>
      )}

      {shouldShowDateSelector && ( 
        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden"> 
          <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" /> 
          <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker"> 
            <div className="flex items-center gap-3"> 
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30"> 
                <CalendarDays className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> 
              </div> 
              <div> 
                <CardTitle className="text-xl">Select Date</CardTitle> 
                <CardDescription>Choose the date for denomination entry</CardDescription> 
              </div> 
            </div> 
          </CardHeader> 
          <CardContent className="pt-6"> 
            <div className="flex flex-col sm:flex-row gap-4 items-end"> 
              <div className="space-y-2 flex-1 max-w-xs"> 
                <Label htmlFor="entryDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"> 
                  Entry Date <span className="text-red-500">*</span> 
                </Label> 
                <DateInput
                  id="entryDate" 
                  value={selectedDate} 
                  onChange={(e) => setSelectedDate(e.target.value)} 
                  className="h-11 border-primary/30 dark:border-sidebar-accent" 
                /> 
              </div> 
              {isLoading && ( 
                <div className="flex items-center gap-2 text-sm text-slate-500 pb-2"> 
                  <RefreshCw className="h-4 w-4 animate-spin" /> 
                  Loading... 
                </div> 
              )} 
            </div> 
          </CardContent> 
        </Card> 
      )} 

      {!shouldShowDateSelector && showDateSelector && !isAdmin && !isLoadingUser && (
        <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
          <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <CalendarDays className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-xl">Entry Date</CardTitle>
                <CardDescription>Today's date is fixed for denomination entry</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                  Date
                </Label>
                <div className="mt-2 px-3 py-2 bg-brand-green-tint dark:bg-sidebar-accent rounded-md border border-primary/20 dark:border-sidebar-accent">
                  {`${new Date(selectedDate).toLocaleDateString('en-IN', { weekday: 'long' })}, ${toDisplayDate(selectedDate)}`}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Center-wise collection denomination breakdown — audit reference for the notes below */}
      {centerBreakdown.length > 0 && (
        <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden dark:border-slate-800">
          <CardHeader className="py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/30">
                <Building2 className="h-4.5 w-4.5 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <CardTitle className="text-base">Center-wise collection breakdown</CardTitle>
                <CardDescription>Approved meeting denominations feeding into today&apos;s count</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {centerBreakdown.map((c, idx) => (
                <div
                  key={`${c.centerCode}-${idx}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm bg-sky-50/50 dark:bg-sky-950/20"
                >
                  <div>
                    <span className="font-medium">{c.centerName}</span>
                    <span className="text-muted-foreground ml-1.5 text-xs">({c.centerCode})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">₹{c.totalAmount.toLocaleString('en-IN')}</span>
                    {c.photoKey && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleViewCenterPhoto(c.photoKey)}
                      >
                        <ImageIcon className="h-3.5 w-3.5 mr-1" />
                        Photo
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cash count — denomination table + summary side panel */}
      <section className="rounded-xl border border-slate-200 bg-card shadow-sm dark:border-slate-800">
        <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
              <Banknote className="h-[18px] w-[18px]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Cash count</h3>
              <p className="text-xs text-muted-foreground">
                {readOnlyView
                  ? 'Saved denomination entry (count only)'
                  : 'Enter the count for each denomination'}
              </p>
            </div>
          </div>
          {!embedded && !readOnlyView && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleReset} className="h-8 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={isSaving || saveBlocked} title={saveBlockedReason ?? undefined} className="h-8 bg-primary hover:bg-sidebar-accent text-white disabled:opacity-50 disabled:cursor-not-allowed">
                {isSaving ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save entry
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 px-4 pb-4 sm:px-5 sm:pb-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50 dark:bg-slate-900/60 dark:hover:bg-slate-900/60">
                  <TableHead className="h-9 w-[160px] text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Denomination
                  </TableHead>
                  <TableHead className="h-9 w-[120px] text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Count
                  </TableHead>
                  <TableHead className="h-9 pr-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Amount (₹)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                {DENOMINATION_UI_ROWS.map((denom) => {
                  const amount = counts[denom.key] * denom.value;
                  return (
                    <TableRow key={denom.key}>
                      <TableCell className="py-1.5">
                        <span
                          className={cn(
                            'inline-flex h-5 min-w-[52px] items-center justify-center rounded-md bg-gradient-to-r px-2 text-[11px] font-bold text-white shadow-sm',
                            denom.color
                          )}
                        >
                          {denom.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5">
                        {readOnlyView ? (
                          <div className="text-center font-medium tabular-nums text-foreground">
                            {counts[denom.key].toLocaleString('en-IN')}
                          </div>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            value={counts[denom.key] || ''}
                            onChange={(e) => updateCount(denom.key, e.target.value)}
                            placeholder="0"
                            className="mx-auto h-8 w-24 text-center text-xs font-medium tabular-nums border-primary/30 dark:border-sidebar-accent/60"
                          />
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 pr-4 text-right">
                        <span
                          className={cn(
                            'font-medium tabular-nums',
                            amount > 0 ? 'text-foreground' : 'text-slate-400 dark:text-slate-500'
                          )}
                        >
                          {formatCurrency(amount)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 border-slate-200 bg-slate-50 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                  <TableCell className="py-2.5 text-xs font-bold text-primary">GRAND TOTAL</TableCell>
                  <TableCell className="py-2.5 text-center text-xs font-bold tabular-nums text-foreground">
                    {totalNotes.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="py-2.5 pr-4 text-right text-xs font-bold tabular-nums text-primary">
                    {formatCurrency(totalAmount)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Cash count summary</p>
                  {/* Denomination mix — one bar per note, height ∝ its share of the counted amount */}
                  <div className="mt-4 flex h-10 items-end gap-1" aria-hidden>
                    {DENOMINATION_UI_ROWS.map((denom) => {
                      const amount = counts[denom.key] * denom.value;
                      const pct = totalAmount > 0 ? amount / totalAmount : 0;
                      return (
                        <div
                          key={denom.key}
                          title={`${denom.label}: ${formatCurrency(amount)}`}
                          className={cn('w-2 rounded-sm', amount > 0 ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700')}
                          style={{ height: `${Math.max(15, Math.round(pct * 100))}%` }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div
                  className={cn(
                    'flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4',
                    liveMatchesCollection ? 'border-primary' : 'border-rose-400'
                  )}
                >
                  <span className={cn('text-base font-bold', liveMatchesCollection ? 'text-primary' : 'text-rose-600')}>
                    {matchPercent}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {liveMatchesCollection ? 'Matched' : 'Counted'}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-xs">
                <SummaryLine dotClass="bg-emerald-500" label="Counted" count={totalNotes.toLocaleString('en-IN')} amount={formatCurrency(totalAmount)} />
                <SummaryLine dotClass="bg-slate-400" label="Expected" count="" amount={formatCurrency(expectedAmount)} />
                <SummaryLine dotClass="bg-amber-500" label="Excess" count="" amount={formatCurrency(difference < 0 ? -difference : 0)} />
                <SummaryLine dotClass="bg-rose-500" label="Shortage" count="" amount={formatCurrency(difference > 0 ? difference : 0)} />
              </div>
            </div>

            {!readOnlyView ? (
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <Label htmlFor="remarks" className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                  <NotebookPen className="h-4 w-4 text-primary" />
                  Remarks (optional)
                </Label>
                <Textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add any notes about today's cash count..."
                  className="min-h-[72px] resize-none border-primary/30 text-xs dark:border-sidebar-accent"
                />
              </div>
            ) : remarks ? (
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                  <NotebookPen className="h-4 w-4 text-primary" />
                  Remarks
                </p>
                <p className="whitespace-pre-line text-xs text-muted-foreground">{remarks}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {!readOnlyView && (
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={handleReset} className="h-11 px-6 border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset all
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving || saveBlocked} title={saveBlockedReason ?? undefined} className="h-11 px-8 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSaving ? ( 
              <> 
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> 
                Saving... 
              </> 
            ) : ( 
              <> 
                <Save className="h-4 w-4 mr-2" /> 
                Save denomination entry 
              </> 
            )} 
          </Button> 
        </div> 
      )} 
    </div> 
  ); 
}