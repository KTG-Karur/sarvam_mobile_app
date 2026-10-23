'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, FileText, Loader2, Save, TriangleAlert, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { TableSearchInput } from '@/components/ui/table-search';
import { LoanCardScheduleTable } from '@/components/masters/uploan/LoanCardScheduleTable';
import { RepaymentEventTable } from '@/components/masters/uploan/RepaymentEventTable';
import {
    parseLoanCardReportCsv,
    parseRepaymentReportCsv,
    sniffReportType,
    type ParsedLoanCardReport,
    type ParsedRepaymentReport,
} from '@/app/lib/services/uploan-loan-history.service';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// ── Types ────────────────────────────────────────────────────────────────────
interface LoanListRow {
    loanId: string;
    loanNumber: string;
    amount: number;
    disbursedAt: string | null;
    disbursementStatus: 'DISBURSED' | 'CLOSED';
    closedDate: string | null;
    clientId: string;
    clientName: string;
    branchName: string;
    branchCode: string;
    centerName: string;
    productName: string;
    scheduleCount: number;
    transactionCount: number;
    isBulkMemberImport: boolean;
    hasStoredSource: boolean;
    hasRealActivity: boolean;
}

interface GoldMeta {
    karatType: string;
    gramCount: number;
    goldTakenValue: number;
    cashGiven: number;
}

interface LoanMeta {
    loanId: string;
    loanNumber: string;
    disbursementStatus: 'DISBURSED' | 'CLOSED';
    closedDate: string | null;
    branchId: string;
    centerId: string;
    clientId: string;
    clientName: string;
    clientCode: string;
    productName: string;
    loanProductId: string;
    loanProductTypeId: string;
    loanPurposeId: string;
    loanPurposeTypeId: string;
    frequency: string;
    disbursementDate: string;
    scheduleStartDate: string;
    funderId: string;
    savingsPaid: number;
    gold: GoldMeta | null;
}

interface DetailResponse {
    source: 'STORED' | 'RECONSTRUCTED';
    hasRealActivity: boolean;
    meta: LoanMeta;
    loanCard: ParsedLoanCardReport;
    repayment: ParsedRepaymentReport;
}

interface NamedRow {
    id: string;
    name: string;
}
interface ProductRow {
    id: string;
    productName: string;
    loanProductTypeId: string;
}
interface FunderRow {
    id: string;
    funderName: string;
}

const FREQUENCIES = ['daily', 'weekly', 'forthnight', 'monthly', 'quarterly'];
const KARATS = ['24K', '22K', '20K', '18K', '16K'];
const PAGE_SIZE = 20;

const rid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Math.random().toString(36).slice(2)}`;

export function LoanHistoryEditClient() {
    const { toast } = useToast();

    // List state
    const [loans, setLoans] = useState<LoanListRow[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [query, setQuery] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    // Defaults to both DISBURSED and CLOSED — a migrated loan's history can need
    // correction whether or not it has since been closed (full repayment, foreclosure,
    // or imported directly as closed via Closed Member Upload).
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'DISBURSED' | 'CLOSED'>('ALL');
    const [branches, setBranches] = useState<NamedRow[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(false);

    // Detail / edit state
    const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [source, setSource] = useState<'STORED' | 'RECONSTRUCTED'>('STORED');
    const [detailHasRealActivity, setDetailHasRealActivity] = useState(false);
    const [meta, setMeta] = useState<LoanMeta | null>(null);
    const [loanCard, setLoanCard] = useState<ParsedLoanCardReport | null>(null);
    const [repayment, setRepayment] = useState<ParsedRepaymentReport | null>(null);
    // Set once the grids have been replaced by an uploaded CSV — the repayment events then
    // carry their own wallet movement, so the "Carried-over Loan Advance" lump is forced
    // to 0 on save (mirrors LoanUploanClient: reports attached ⇒ savingsPaid lump = 0).
    const [uploadedKinds, setUploadedKinds] = useState<{ loanCard: boolean; repayment: boolean }>({
        loanCard: false,
        repayment: false,
    });
    const [parsingUpload, setParsingUpload] = useState(false);
    // Opt-in for loans whose product type isn't "gold" but that still carry an
    // unreturned gold pledge from a previous cycle (bulk-migrated members). Gold
    // products force the section on regardless — see `showGold` below.
    const [hasGoldPledge, setHasGoldPledge] = useState(false);

    // Master data
    const [productTypes, setProductTypes] = useState<NamedRow[]>([]);
    const [products, setProducts] = useState<ProductRow[]>([]);
    const [purposeTypes, setPurposeTypes] = useState<NamedRow[]>([]);
    const [purposes, setPurposes] = useState<NamedRow[]>([]);
    const [funders, setFunders] = useState<FunderRow[]>([]);

    // Save flow (full rebuild — DISBURSED loans)
    const [reasonOpen, setReasonOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [realActivityOpen, setRealActivityOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Save flow (quick edit — CLOSED loans: gold pledge + unreturned advance only,
    // never touches schedule/transactions — see doQuickSave).
    const [quickReasonOpen, setQuickReasonOpen] = useState(false);
    const [quickReason, setQuickReason] = useState('');
    const [isQuickSaving, setIsQuickSaving] = useState(false);

    // ── List ─────────────────────────────────────────────────────────────────
    const loadList = useCallback(async () => {
        setIsLoadingList(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (query.trim()) params.set('q', query.trim());
            if (branchFilter) params.set('branchId', branchFilter);
            if (statusFilter !== 'ALL') params.set('status', statusFilter);
            const res = await apiClient.get<{ loans: LoanListRow[]; totalPages: number }>(
                `/uploan/loan-history/loans?${params.toString()}`
            );
            if (res.success && res.data) {
                setLoans(res.data.loans);
                setTotalPages(Math.max(1, res.data.totalPages));
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load loans', variant: 'destructive' });
            }
        } finally {
            setIsLoadingList(false);
        }
    }, [page, query, branchFilter, statusFilter, toast]);

    useEffect(() => {
        if (!selectedLoanId) loadList();
    }, [selectedLoanId, loadList]);

    useEffect(() => {
        apiClient.get<NamedRow[]>('/branches').then((r) => r.success && r.data && setBranches(r.data));
        apiClient.get<NamedRow[]>('/loan-product-types').then((r) => r.success && r.data && setProductTypes(r.data));
        apiClient.get<NamedRow[]>('/loan-purpose-types').then((r) => r.success && r.data && setPurposeTypes(r.data));
        apiClient.get<FunderRow[]>('/masters/funder').then((r) => r.success && r.data && setFunders(r.data));
    }, []);

    const fetchProducts = useCallback(async (branchId: string, productTypeId: string) => {
        if (!branchId) return;
        const res = await apiClient.get<ProductRow[]>(`/products?branchId=${branchId}&includeTemplates=false`);
        if (res.success && res.data) {
            setProducts(productTypeId ? res.data.filter((p) => p.loanProductTypeId === productTypeId) : res.data);
        }
    }, []);

    const fetchPurposes = useCallback(async (purposeTypeId: string) => {
        if (!purposeTypeId) return;
        const res = await apiClient.get<NamedRow[]>(`/loan-purposes?purposeTypeId=${purposeTypeId}`);
        if (res.success && res.data) setPurposes(res.data);
    }, []);

    // ── Open a loan for editing ──────────────────────────────────────────────
    const openLoan = async (loanId: string) => {
        setSelectedLoanId(loanId);
        setIsLoadingDetail(true);
        setError(null);
        setUploadedKinds({ loanCard: false, repayment: false });
        try {
            const res = await apiClient.get<DetailResponse>(`/uploan/loan-history/loans/${loanId}`);
            if (!res.success || !res.data) {
                toast({ title: 'Error', description: res.error || 'Failed to load loan', variant: 'destructive' });
                setSelectedLoanId(null);
                return;
            }
            const d = res.data;
            setSource(d.source);
            setDetailHasRealActivity(d.hasRealActivity);
            setMeta(d.meta);
            setHasGoldPledge(!!d.meta.gold);
            setLoanCard({
                ...d.loanCard,
                scheduleRows: d.loanCard.scheduleRows.map((r) => ({ ...r, rowId: r.rowId ?? rid() })),
            });
            setRepayment({
                ...d.repayment,
                events: d.repayment.events.map((e) => ({ ...e, rowId: e.rowId ?? rid() })),
            });
            await Promise.all([
                fetchProducts(d.meta.branchId, d.meta.loanProductTypeId),
                fetchPurposes(d.meta.loanPurposeTypeId),
            ]);
        } finally {
            setIsLoadingDetail(false);
        }
    };

    const closeLoan = () => {
        setSelectedLoanId(null);
        setMeta(null);
        setLoanCard(null);
        setRepayment(null);
        setError(null);
        setUploadedKinds({ loanCard: false, repayment: false });
        setHasGoldPledge(false);
    };

    // ── Replace grids from uploaded legacy CSV(s) ────────────────────────────
    const handleCsvUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setParsingUpload(true);
        setError(null);
        try {
            const added: string[] = [];
            const skipped: string[] = [];
            let nextKinds = { ...uploadedKinds };
            let parsedLoanCard: ParsedLoanCardReport | null = null;

            for (const f of Array.from(files)) {
                const text = await f.text();
                const kind = sniffReportType(text);
                if (kind === 'loanCard') {
                    const parsed = parseLoanCardReportCsv(text);
                    parsedLoanCard = parsed;
                    setLoanCard({
                        ...parsed,
                        scheduleRows: parsed.scheduleRows.map((r) => ({ ...r, rowId: rid() })),
                    });
                    nextKinds = { ...nextKinds, loanCard: true };
                    added.push(f.name);
                } else if (kind === 'repayment') {
                    const parsed = parseRepaymentReportCsv(text);
                    setRepayment({
                        ...parsed,
                        events: parsed.events.map((e) => ({ ...e, rowId: rid() })),
                    });
                    nextKinds = { ...nextKinds, repayment: true };
                    added.push(f.name);
                } else {
                    skipped.push(f.name);
                }
            }

            setUploadedKinds(nextKinds);

            // Reports carry their own wallet movement — drop the carried-over lump, and
            // pull disbursement / first-due dates off the Loan Card Report when present.
            setMeta((prev) => {
                if (!prev) return prev;
                const next = { ...prev, savingsPaid: 0 };
                if (parsedLoanCard?.disbursementDate) {
                    const d = new Date(parsedLoanCard.disbursementDate);
                    if (!isNaN(d.getTime())) next.disbursementDate = d.toISOString().slice(0, 10);
                }
                const firstDue = parsedLoanCard?.scheduleRows[0]?.dueDate;
                if (firstDue) {
                    const d = new Date(firstDue);
                    if (!isNaN(d.getTime())) next.scheduleStartDate = d.toISOString().slice(0, 10);
                }
                return next;
            });

            toast({
                title: added.length ? 'CSV(s) parsed — grids replaced' : 'Nothing recognized',
                description:
                    (added.length ? `${added.join(', ')}` : '') +
                    (skipped.length ? ` — not recognized: ${skipped.join(', ')}` : ''),
                variant: added.length ? undefined : 'destructive',
            });
        } catch {
            toast({ title: 'Error', description: 'Failed to parse one or more CSV files', variant: 'destructive' });
        } finally {
            setParsingUpload(false);
        }
    };

    const hasFreshUpload = uploadedKinds.loanCard || uploadedKinds.repayment;

    const setMetaField = <K extends keyof LoanMeta>(field: K, value: LoanMeta[K]) => {
        setMeta((prev) => (prev ? { ...prev, [field]: value } : prev));
    };

    const isGoldProduct = useMemo(
        () => productTypes.find((t) => t.id === meta?.loanProductTypeId)?.name?.toLowerCase().includes('gold') ?? false,
        [productTypes, meta?.loanProductTypeId]
    );

    // Show/persist the 4 gold-pledge fields whenever the product itself is gold,
    // OR the user has explicitly flagged this (non-gold) loan as carrying a
    // pledge — a member can hold unreturned gold from a prior gold-loan cycle
    // while their current migrated loan is an ordinary one.
    const showGold = isGoldProduct || hasGoldPledge;

    // A closed loan gets the lightweight quick-edit (Gold Pledge + Unreturned Advance
    // only, via PATCH) instead of the full meta/CSV/schedule/repayment editor + rebuild.
    const isClosed = meta?.disbursementStatus === 'CLOSED';

    // Shared by both the quick-edit (closed loans) and full-edit (disbursed loans) cards
    // — identical fields, identical behavior, just embedded in a different Card.
    const renderGoldSection = (m: LoanMeta) => (
        <div className="mt-4 border-t pt-4 first:mt-0 first:border-t-0 first:pt-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Gold Loan Details</div>
                {!isGoldProduct && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Checkbox
                            checked={hasGoldPledge}
                            onCheckedChange={(c) => {
                                const on = c === true;
                                setHasGoldPledge(on);
                                if (on && !m.gold) {
                                    setMetaField('gold', {
                                        karatType: '',
                                        gramCount: 0,
                                        goldTakenValue: 0,
                                        cashGiven: 0,
                                    });
                                }
                            }}
                        />
                        This loan carries a gold pledge (gold not yet returned)
                    </label>
                )}
            </div>
            {showGold ? (
              <>
                {!isGoldProduct && (
                    <p className="mb-3 text-[11px] text-muted-foreground">
                        Stored as a gold pledge (a <code>GoldLoanDetail</code> row + a TAKE{' '}
                        <code>GoldTransaction</code>) on this loan — its product and schedule are left
                        unchanged.
                    </p>
                )}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Karat *</Label>
                        <Select
                            value={m.gold?.karatType || ''}
                            onValueChange={(v) =>
                                setMetaField('gold', {
                                    karatType: v,
                                    gramCount: m.gold?.gramCount ?? 0,
                                    goldTakenValue: m.gold?.goldTakenValue ?? 0,
                                    cashGiven: m.gold?.cashGiven ?? 0,
                                })
                            }
                        >
                            <SelectTrigger className="text-xs">
                                <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                                {KARATS.map((k) => (
                                    <SelectItem key={k} value={k}>
                                        {k}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {(['gramCount', 'goldTakenValue', 'cashGiven'] as const).map((f) => (
                        <div key={f} className="space-y-1.5">
                            <Label className="text-xs font-semibold">
                                {f === 'gramCount' ? 'Gram *' : f === 'goldTakenValue' ? 'Gold Value (₹)' : 'Cash Given (₹)'}
                            </Label>
                            <Input
                                type="number"
                                className="text-xs"
                                value={m.gold?.[f] ?? ''}
                                onChange={(e) =>
                                    setMetaField('gold', {
                                        karatType: m.gold?.karatType ?? '22K',
                                        gramCount: m.gold?.gramCount ?? 0,
                                        goldTakenValue: m.gold?.goldTakenValue ?? 0,
                                        cashGiven: m.gold?.cashGiven ?? 0,
                                        [f]: Number(e.target.value) || 0,
                                    })
                                }
                            />
                        </div>
                    ))}
                </div>
              </>
            ) : (
                <p className="text-[11px] text-muted-foreground">
                    Tick the box above if this member still holds unreturned gold from a previous
                    gold-loan cycle — the four fields will appear.
                </p>
            )}
        </div>
    );

    // ── Grid row ops ─────────────────────────────────────────────────────────
    const addLoanCardRow = () => {
        if (!loanCard) return;
        const maxNo = loanCard.scheduleRows.reduce((m, r) => Math.max(m, r.installmentNo), 0);
        const lastDue = loanCard.scheduleRows[loanCard.scheduleRows.length - 1]?.dueDate ?? new Date().toISOString();
        setLoanCard({
            ...loanCard,
            scheduleRows: [
                ...loanCard.scheduleRows,
                {
                    rowId: rid(),
                    installmentNo: maxNo + 1,
                    dueDate: lastDue,
                    principalDue: 0,
                    interestDue: 0,
                    savingsDue: 0,
                    feesDue: 0,
                    totalDue: 0,
                    outstandingBalance: 0,
                    receivedDate: null,
                    receivedAmount: null,
                },
            ],
        });
    };

    const deleteLoanCardRow = (index: number) => {
        if (!loanCard) return;
        setLoanCard({ ...loanCard, scheduleRows: loanCard.scheduleRows.filter((_, i) => i !== index) });
    };

    const addRepaymentRow = () => {
        if (!repayment) return;
        const lastDate =
            repayment.events[repayment.events.length - 1]?.transactionDate ?? new Date().toISOString();
        setRepayment({
            ...repayment,
            events: [
                ...repayment.events,
                {
                    rowId: rid(),
                    dueNo: '',
                    dueDate: null,
                    dueAmount: 0,
                    transactionDate: lastDate,
                    transactionType: 'Demand Collection',
                    amount: 0,
                    principalAmount: 0,
                    interestAmount: 0,
                    loanBalance: 0,
                    walletAdvanceAmount: 0,
                    walletAdvanceDate: null,
                    walletPayAmount: 0,
                    walletPayDate: null,
                    walletBalance: 0,
                },
            ],
        });
    };

    const deleteRepaymentRow = (index: number) => {
        if (!repayment) return;
        setRepayment({ ...repayment, events: repayment.events.filter((_, i) => i !== index) });
    };

    // ── Save ─────────────────────────────────────────────────────────────────
    const validateBeforeSave = (): string | null => {
        if (!meta) return 'Nothing to save';
        if (!meta.loanProductId) return 'Loan Product is required';
        if (!meta.loanPurposeId) return 'Loan Purpose is required';
        if (!meta.frequency) return 'Frequency is required';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.disbursementDate)) return 'Disbursement Date is required';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.scheduleStartDate)) return 'First Due Date is required';
        const nums = (loanCard?.scheduleRows ?? []).map((r) => r.installmentNo);
        if (nums.length === 0) return 'Loan Card schedule cannot be empty — add at least one installment row';
        if (new Set(nums).size !== nums.length) return 'Loan Card has duplicate installment numbers — each row needs a unique #';
        if (showGold && (!meta.gold?.karatType || !meta.gold?.gramCount))
            return isGoldProduct
                ? 'Gold Karat and Gram are required for a gold product'
                : 'Gold Karat and Gram are required when "This loan carries a gold pledge" is ticked';
        return null;
    };

    const doSave = async (allowRealActivityWipe: boolean) => {
        if (!meta || !selectedLoanId) return;
        setIsSaving(true);
        setError(null);
        try {
            const payload = {
                reason: reason.trim(),
                allowRealActivityWipe,
                meta: {
                    loanProductId: meta.loanProductId,
                    loanPurposeId: meta.loanPurposeId,
                    frequency: meta.frequency,
                    disbursementDate: meta.disbursementDate,
                    scheduleStartDate: meta.scheduleStartDate,
                    funderId: meta.funderId || undefined,
                    // Uploaded reports carry per-event wallet movement — don't also apply a lump.
                    savingsPaid: hasFreshUpload ? 0 : Number(meta.savingsPaid) || 0,
                    gold:
                        showGold && meta.gold
                            ? {
                                  karatType: meta.gold.karatType,
                                  gramCount: Number(meta.gold.gramCount) || 0,
                                  goldTakenValue: Number(meta.gold.goldTakenValue) || 0,
                                  cashGiven: Number(meta.gold.cashGiven) || 0,
                              }
                            : null,
                },
                loanCardReport: loanCard,
                repaymentReport: repayment,
            };
            const res = await apiClient.put<{ loanNumber: string }>(
                `/uploan/loan-history/loans/${selectedLoanId}`,
                payload
            );
            if (!res.success) {
                if ((res.error || '').includes('REAL_ACTIVITY')) {
                    setReasonOpen(false);
                    setRealActivityOpen(true);
                    return;
                }
                setError(res.error || 'Failed to rebuild');
                toast({ title: 'Rebuild failed', description: res.error || 'Failed to rebuild', variant: 'destructive' });
                return;
            }
            toast({ title: 'Rebuilt', description: `Loan ${res.data?.loanNumber ?? ''} history rebuilt from the edited grids.` });
            setReasonOpen(false);
            setRealActivityOpen(false);
            setReason('');
            const id = selectedLoanId;
            closeLoan();
            await openLoan(id);
        } finally {
            setIsSaving(false);
        }
    };

    const startSave = () => {
        const v = validateBeforeSave();
        if (v) {
            setError(v);
            toast({ title: 'Check the form', description: v, variant: 'destructive' });
            return;
        }
        setError(null);
        setReason('');
        setReasonOpen(true);
    };

    // ── Quick save (closed loans) — gold pledge + unreturned advance only, via PATCH.
    // No loan product/purpose/frequency/dates/schedule requirement, unlike startSave/
    // doSave above — this never touches LoanSchedule/LoanTransaction at all. ──
    const validateQuickEdit = (): string | null => {
        if (!meta) return 'Nothing to save';
        if (showGold && (!meta.gold?.karatType || !meta.gold?.gramCount)) {
            return isGoldProduct
                ? 'Gold Karat and Gram are required for a gold product'
                : 'Gold Karat and Gram are required when "This loan carries a gold pledge" is ticked';
        }
        return null;
    };

    const startQuickSave = () => {
        const v = validateQuickEdit();
        if (v) {
            setError(v);
            toast({ title: 'Check the form', description: v, variant: 'destructive' });
            return;
        }
        setError(null);
        setQuickReason('');
        setQuickReasonOpen(true);
    };

    const doQuickSave = async () => {
        if (!meta || !selectedLoanId) return;
        setIsQuickSaving(true);
        setError(null);
        try {
            const payload = {
                reason: quickReason.trim(),
                gold:
                    showGold && meta.gold
                        ? {
                              karatType: meta.gold.karatType,
                              gramCount: Number(meta.gold.gramCount) || 0,
                              goldTakenValue: Number(meta.gold.goldTakenValue) || 0,
                              cashGiven: Number(meta.gold.cashGiven) || 0,
                          }
                        : null,
                savingsPaid: Number(meta.savingsPaid) || 0,
            };
            const res = await apiClient.patch<{ loanId: string }>(`/uploan/loan-history/loans/${selectedLoanId}`, payload);
            if (!res.success) {
                setError(res.error || 'Failed to update');
                toast({ title: 'Update failed', description: res.error || 'Failed to update', variant: 'destructive' });
                return;
            }
            toast({ title: 'Updated', description: "This loan's gold pledge / unreturned advance was updated." });
            setQuickReasonOpen(false);
            setQuickReason('');
            const id = selectedLoanId;
            closeLoan();
            await openLoan(id);
        } finally {
            setIsQuickSaving(false);
        }
    };

    // ── Render: list ─────────────────────────────────────────────────────────
    if (!selectedLoanId) {
        return (
            <div className="space-y-6">
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">Loan History Edit</h1>
                    <p className="text-muted-foreground">
                        Open a migrated / backup loan, edit its Loan Card schedule and Repayment history, then rebuild the
                        real <code>LoanSchedule</code> + <code>LoanTransaction</code> trail from your edits.
                    </p>
                </div>

                <Card>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
                        <div>
                            <CardTitle>Backup / migrated loans</CardTitle>
                            <CardDescription>
                                Loans that never went through live indexation — currently disbursed or since closed
                                (full repayment, foreclosure, or a direct closed-member import).
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={statusFilter}
                                onValueChange={(v) => { setPage(1); setStatusFilter(v as typeof statusFilter); }}
                            >
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="All statuses" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All statuses</SelectItem>
                                    <SelectItem value="DISBURSED">Disbursed only</SelectItem>
                                    <SelectItem value="CLOSED">Closed only</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={branchFilter || 'ALL'} onValueChange={(v) => { setPage(1); setBranchFilter(v === 'ALL' ? '' : v); }}>
                                <SelectTrigger className="w-[190px]">
                                    <SelectValue placeholder="All branches" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">All branches</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>
                                            {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <TableSearchInput
                                value={query}
                                onChange={(v) => { setPage(1); setQuery(v); }}
                                placeholder="Loan no. / client..."
                            />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Loan Number</TableHead>
                                        <TableHead>Client</TableHead>
                                        <TableHead>Branch / Center</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Sched.</TableHead>
                                        <TableHead className="text-right">Txns</TableHead>
                                        <TableHead>Source</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoadingList ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="py-10 text-center">
                                                <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                                            </TableCell>
                                        </TableRow>
                                    ) : loans.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                                                No backup / migrated loans found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        loans.map((l) => (
                                            <TableRow key={l.loanId}>
                                                <TableCell className="font-medium">{l.loanNumber}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span>{l.clientName}</span>
                                                        <span className="text-xs text-muted-foreground">{l.clientId}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {l.branchName}
                                                    {l.centerName ? ` / ${l.centerName}` : ''}
                                                </TableCell>
                                                <TableCell className="text-sm">{l.productName || '—'}</TableCell>
                                                <TableCell>
                                                    <Badge
                                                        className={
                                                            l.disbursementStatus === 'CLOSED'
                                                                ? 'bg-slate-200 text-slate-800'
                                                                : 'bg-blue-100 text-blue-800'
                                                        }
                                                    >
                                                        {l.disbursementStatus === 'CLOSED' ? 'Closed' : 'Disbursed'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">{l.scheduleCount}</TableCell>
                                                <TableCell className="text-right">{l.transactionCount}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        <Badge className={l.hasStoredSource ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                                                            {l.hasStoredSource ? 'Exact' : 'Approx.'}
                                                        </Badge>
                                                        {l.hasRealActivity && (
                                                            <Badge className="bg-red-100 text-red-800">Live activity</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button size="sm" variant="outline" onClick={() => openLoan(l.loanId)}>
                                                        Edit
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                Page {page} of {totalPages}
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page <= 1 || isLoadingList}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page >= totalPages || isLoadingList}
                                    onClick={() => setPage((p) => p + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // ── Render: edit ─────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={closeLoan} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to list
                </Button>
                {meta && (
                    <h1 className="text-2xl font-bold tracking-tight">
                        {meta.loanNumber} — {meta.clientName}
                    </h1>
                )}
                {meta?.disbursementStatus === 'CLOSED' && (
                    <Badge className="bg-slate-200 text-slate-800">Closed</Badge>
                )}
            </div>

            {isLoadingDetail || !meta || !loanCard || !repayment ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </CardContent>
                </Card>
            ) : (
                <>
                    {isClosed && (
                        <Alert>
                            <TriangleAlert className="h-4 w-4" />
                            <AlertDescription>
                                This loan is <strong>Closed</strong>
                                {meta.closedDate ? ` (${toDisplayDate(new Date(meta.closedDate))})` : ''}.
                                Only the Gold Pledge and Unreturned Loan Advance below can be corrected here — its loan
                                product, dates and repayment history are left exactly as they are, and the loan stays
                                closed.
                            </AlertDescription>
                        </Alert>
                    )}
                    {!isClosed && source === 'RECONSTRUCTED' && (
                        <Alert>
                            <TriangleAlert className="h-4 w-4" />
                            <AlertDescription>
                                This loan was imported before the exact source was stored. The grids below are an{' '}
                                <strong>approximate reconstruction</strong> from the current schedule + transactions — due
                                dates, cumulative balances and split-payment detail may not match the original. Saving
                                replaces them with a fresh, exact source.
                            </AlertDescription>
                        </Alert>
                    )}
                    {!isClosed && detailHasRealActivity && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                This loan has had real (non-import) collection activity since import. Rebuilding will{' '}
                                <strong>delete those transactions</strong>. You&apos;ll be asked to confirm on save.
                            </AlertDescription>
                        </Alert>
                    )}
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {isClosed && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Gold Pledge &amp; Unreturned Advance</CardTitle>
                                <CardDescription>
                                    This loan is closed — update only what&apos;s still outstanding. Loan product,
                                    purpose, dates and the repayment history stay exactly as they are.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="max-w-xs space-y-1.5">
                                    <Label className="text-xs font-semibold">Unreturned Loan Advance (₹)</Label>
                                    <Input
                                        type="number"
                                        className="text-xs"
                                        value={meta.savingsPaid}
                                        onChange={(e) => setMetaField('savingsPaid', Number(e.target.value) || 0)}
                                    />
                                </div>
                                {renderGoldSection(meta)}
                            </CardContent>
                        </Card>
                    )}

                    {!isClosed && (
                    <>
                    <Card>
                        <CardHeader>
                            <CardTitle>Loan meta</CardTitle>
                            <CardDescription>
                                The schedule is regenerated from the selected product&apos;s template + these dates on
                                save.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Product Type</Label>
                                    <Select
                                        value={meta.loanProductTypeId || ''}
                                        onValueChange={(v) => {
                                            setMetaField('loanProductTypeId', v);
                                            setMetaField('loanProductId', '');
                                            fetchProducts(meta.branchId, v);
                                        }}
                                    >
                                        <SelectTrigger className="text-xs">
                                            <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {productTypes.map((t) => (
                                                <SelectItem key={t.id} value={t.id}>
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Loan Product *</Label>
                                    <Select value={meta.loanProductId || ''} onValueChange={(v) => setMetaField('loanProductId', v)}>
                                        <SelectTrigger className="text-xs">
                                            <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {products.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.productName}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Purpose Type</Label>
                                    <Select
                                        value={meta.loanPurposeTypeId || ''}
                                        onValueChange={(v) => {
                                            setMetaField('loanPurposeTypeId', v);
                                            setMetaField('loanPurposeId', '');
                                            fetchPurposes(v);
                                        }}
                                    >
                                        <SelectTrigger className="text-xs">
                                            <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {purposeTypes.map((t) => (
                                                <SelectItem key={t.id} value={t.id}>
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Loan Purpose *</Label>
                                    <Select value={meta.loanPurposeId || ''} onValueChange={(v) => setMetaField('loanPurposeId', v)}>
                                        <SelectTrigger className="text-xs">
                                            <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {purposes.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Frequency *</Label>
                                    <Select value={meta.frequency || ''} onValueChange={(v) => setMetaField('frequency', v)}>
                                        <SelectTrigger className="text-xs">
                                            <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FREQUENCIES.map((f) => (
                                                <SelectItem key={f} value={f}>
                                                    {f}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Funder</Label>
                                    <Select
                                        value={meta.funderId || 'NONE'}
                                        onValueChange={(v) => setMetaField('funderId', v === 'NONE' ? '' : v)}
                                    >
                                        <SelectTrigger className="text-xs">
                                            <SelectValue placeholder="Select" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="NONE">— none —</SelectItem>
                                            {funders.map((f) => (
                                                <SelectItem key={f.id} value={f.id}>
                                                    {f.funderName}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Disbursement Date *</Label>
                                    <DateInput
                                        className="text-xs"
                                        value={meta.disbursementDate}
                                        onChange={(e) => setMetaField('disbursementDate', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">First Due Date *</Label>
                                    <DateInput
                                        className="text-xs"
                                        value={meta.scheduleStartDate}
                                        onChange={(e) => setMetaField('scheduleStartDate', e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-semibold">Carried-over Loan Advance (₹)</Label>
                                    <Input
                                        type="number"
                                        className="text-xs"
                                        value={hasFreshUpload ? 0 : meta.savingsPaid}
                                        disabled={hasFreshUpload}
                                        onChange={(e) => setMetaField('savingsPaid', Number(e.target.value) || 0)}
                                    />
                                    {hasFreshUpload && (
                                        <p className="text-[11px] text-muted-foreground">
                                            Forced to 0 — the uploaded Repayment Report&apos;s events carry wallet movement.
                                        </p>
                                    )}
                                </div>
                            </div>

                            {renderGoldSection(meta)}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Replace from legacy CSV (optional)</CardTitle>
                            <CardDescription>
                                Upload this member/loan&apos;s original <strong>Loan Card Report</strong> and/or{' '}
                                <strong>Repayment Report</strong> CSV — each replaces the matching grid below. File type is
                                detected from the contents, not the name. Review the grids, then Save &amp; Rebuild.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <input
                                type="file"
                                accept=".csv"
                                multiple
                                className="hidden"
                                id="lh-csv-upload"
                                onChange={(e) => {
                                    handleCsvUpload(e.target.files);
                                    e.target.value = '';
                                }}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    disabled={parsingUpload}
                                    onClick={() => document.getElementById('lh-csv-upload')?.click()}
                                >
                                    {parsingUpload ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                                    Upload CSV(s)
                                </Button>
                                {uploadedKinds.loanCard && (
                                    <Badge className="gap-1 bg-green-100 text-green-800">
                                        Loan Card replaced
                                        <button
                                            type="button"
                                            title="Reload original from server"
                                            onClick={() => selectedLoanId && openLoan(selectedLoanId)}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                )}
                                {uploadedKinds.repayment && (
                                    <Badge className="gap-1 bg-green-100 text-green-800">
                                        Repayment replaced
                                        <button
                                            type="button"
                                            title="Reload original from server"
                                            onClick={() => selectedLoanId && openLoan(selectedLoanId)}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Loan Card Schedule</CardTitle>
                            <CardDescription>Per-installment dues + received. Add / edit / delete rows.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <LoanCardScheduleTable
                                report={loanCard}
                                onChange={setLoanCard}
                                onAddRow={addLoanCardRow}
                                onDeleteRow={deleteLoanCardRow}
                            />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Repayment History</CardTitle>
                            <CardDescription>
                                Event ledger replayed on save. Type <code>Disbursement</code> replays as a disbursement;
                                anything else is a repayment, waterfall-allocated against the schedule. Per-event Wallet
                                columns (from an uploaded Repayment Report) post as loan-advance movement.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <RepaymentEventTable
                                report={repayment}
                                onChange={setRepayment}
                                onAddRow={addRepaymentRow}
                                onDeleteRow={deleteRepaymentRow}
                            />
                        </CardContent>
                    </Card>
                    </>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={closeLoan}>
                            Cancel
                        </Button>
                        {isClosed ? (
                            <Button onClick={startQuickSave} disabled={isQuickSaving} className="gap-2">
                                <Save className="h-4 w-4" />
                                Save
                            </Button>
                        ) : (
                            <Button onClick={startSave} disabled={isSaving} className="gap-2">
                                <Save className="h-4 w-4" />
                                Save &amp; Rebuild
                            </Button>
                        )}
                    </div>
                </>
            )}

            {/* Reason dialog */}
            <Dialog open={reasonOpen} onOpenChange={(o) => !isSaving && setReasonOpen(o)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rebuild loan history</DialogTitle>
                        <DialogDescription>
                            This deletes and recreates this loan&apos;s schedule + transaction trail from the edited
                            grids. A reason is recorded.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="rebuild-reason">
                            Reason <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="rebuild-reason"
                            rows={3}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why is this history being edited..."
                            disabled={isSaving}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReasonOpen(false)} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button onClick={() => doSave(false)} disabled={isSaving || reason.trim().length < 3} className="gap-2">
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                            Rebuild
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Real-activity confirm dialog */}
            <Dialog open={realActivityOpen} onOpenChange={(o) => !isSaving && setRealActivityOpen(o)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-red-700">Delete real transactions?</DialogTitle>
                        <DialogDescription>
                            This loan has collection activity recorded through the live app since import. Rebuilding will
                            permanently delete those transactions along with the migrated ones. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRealActivityOpen(false)} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => doSave(true)}
                            disabled={isSaving}
                            className="gap-2 bg-red-600 text-white hover:bg-red-700"
                        >
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                            Delete &amp; Rebuild
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Quick-edit reason dialog (closed loans — gold pledge / unreturned advance only) */}
            <Dialog open={quickReasonOpen} onOpenChange={(o) => !isQuickSaving && setQuickReasonOpen(o)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Update gold pledge / unreturned advance</DialogTitle>
                        <DialogDescription>
                            Updates only the Gold Pledge and Unreturned Loan Advance on this closed loan — nothing else
                            changes. A reason is recorded.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="quick-edit-reason">
                            Reason <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="quick-edit-reason"
                            rows={3}
                            value={quickReason}
                            onChange={(e) => setQuickReason(e.target.value)}
                            placeholder="Why is this being corrected..."
                            disabled={isQuickSaving}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setQuickReasonOpen(false)} disabled={isQuickSaving}>
                            Cancel
                        </Button>
                        <Button
                            onClick={doQuickSave}
                            disabled={isQuickSaving || quickReason.trim().length < 3}
                            className="gap-2"
                        >
                            {isQuickSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
