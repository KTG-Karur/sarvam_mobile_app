'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageLoader } from '@/components/ui/page-loader';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    Loader2, RefreshCw, Search, ChevronRight, X,
    RotateCcw, FileText, UserPlus, CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { StorageImage } from '@/components/storage/StorageMedia';
import { ApprovalClientDetail } from './ApprovalClientDetail';
import { DocStageApprovals } from './DocStageApprovals';
import { StageRemarksPanel, type StageRemarkEntry } from './StageRemarksPanel';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';
import { getKycDocumentTypeLabel } from '@/app/lib/kyc-document-types';
import { toDisplayDateTime } from '@/app/lib/date-format';

type QueueItem = {
    id: string;
    loanNumber: string;
    amount: number;
    frequency: string | null;
    renewalApprovalStatus: string;
    createdAt: string;
    clientId: string;
    clientDisplayId: string;
    clientName: string;
    mobileNumber: string | null;
    centerName: string | null;
    productName: string | null;
    kycDocCount: number;
    fdoName: string | null;
    fdoEmployeeId: string | null;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
    SUBMITTED: { label: 'Submitted', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    PENDING_BM_REVIEW: { label: 'Pending BM', cls: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300' },
    BM_RETAKE_REQUIRED: { label: 'BM Retake', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' },
    PENDING_AM_REVIEW: { label: 'Pending AM', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
    AM_RETAKE_REQUIRED: { label: 'AM Retake', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' },
    PENDING_QC_VERIFICATION: { label: 'QC Pending', cls: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300' },
    QC_VERIFICATION_RETAKE_REQUIRED: { label: 'QC Retake', cls: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300' },
    PENDING_FINAL_REVIEW: { label: 'Pending Final', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300' },
    FINAL_RETAKE_REQUIRED: { label: 'Final Retake', cls: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300' },
    ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [
        [`PENDING_LEVEL_${n}`, { label: `Pending Level ${n}`, cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300' }],
        [`LEVEL_${n}_RETAKE_REQUIRED`, { label: `Level ${n} Retake`, cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300' }],
    ])),
    APPROVED: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
    REJECTED: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
};

function statusChip(status: string) {
    const c = STATUS_LABEL[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700' };
    return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', c.cls)}>{c.label}</span>;
}

const fmtCurrency = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

const DOC_DECISION_CLS: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    VERIFIED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    RETAKE_REQUIRED: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
};

// Which action verbs apply — from the configured stage the renewal is waiting on
// (any role, any order; UI hint only — the API re-checks that the user holds it).
function actionsForWorkflow(w: RenewalWorkflow | undefined): { approve: string; retake: string; reject: string; approveLabel: string } | null {
    if (!w) return null;
    if (w.isFinalReview)
        return { approve: 'FINAL_APPROVE', retake: 'FINAL_RETAKE', reject: 'FINAL_REJECT', approveLabel: 'Give final approval' };
    if (w.currentStage)
        return {
            approve: 'LEVEL_APPROVE', retake: 'LEVEL_RETAKE', reject: 'LEVEL_REJECT',
            approveLabel: `Approve & forward to ${w.nextStageName ?? 'Admin'}`,
        };
    return null;
}

type DocReviewer = { firstName: string; lastName: string; employeeId: string | null } | null;
type RenewalKycDoc = {
    id: string; documentType: string; fileUrl: string | null; fileName: string | null;
    coApplicantId: string | null; bmDecision: string; amDecision: string; qcDecision: string; retakeReason: string | null;
    bmReviewedAt?: string | null; amReviewedAt?: string | null; qcReviewedAt?: string | null;
    bmReviewer?: DocReviewer; amReviewer?: DocReviewer; qcReviewer?: DocReviewer;
    /** The current stage's decision on this image (null when not at a stage). */
    currentStageDecision: string | null;
    /** Every configured stage's decision, in workflow order. */
    stageDecisions: Array<{ levelOrder: number; roleSlug: string; stageName: string; decision: string; remark: string | null; reviewedAt: string | null; reviewer: DocReviewer }>;
};

type RenewalWorkflow = {
    stages: Array<{ levelOrder: number; roleSlug: string; stageName: string }>;
    currentStage: { levelOrder: number; roleSlug: string; stageName: string } | null;
    nextStageName: string | null;
    firstStageName: string | null;
    isFinalReview: boolean;
};

/** Every configured stage (in workflow order) that has approved this renewal image, with who and when. */
function DocApprovals({ doc }: { doc: RenewalKycDoc }) {
    return (
        <DocStageApprovals
            showOthers={false}
            className="border-t"
            stages={doc.stageDecisions.map((st) => ({ key: st.stageName, decision: st.decision, at: st.reviewedAt, by: st.reviewer }))}
        />
    );
}
type RenewalHistoryRow = {
    id: string; action: string; remarks: string | null; createdAt: string;
    previousState: string | null; newState: string | null;
    performedBy: { firstName: string; lastName: string; employeeId: string | null; role: string } | null;
};

// ─── Renewal stage cycle (replaces the member's own enrollment-cycle bar when
// embedded in a renewal review — see ApprovalClientDetail's renewalCycleTrail /
// renewalStageDetails doc comments) ─────────────────────────────────────────
type RenewalCycleStep = {
    key: 'FDO' | 'BM' | 'AM' | 'QC' | 'FINAL';
    label: string;
    person: string | null;
    employeeId: string | null;
    date: string | null;
    done: boolean;
};

const RENEWAL_STAGE_FROM_STATUS: Record<string, RenewalCycleStep['key']> = {
    SUBMITTED: 'BM', PENDING_BM_REVIEW: 'BM', PENDING_LEVEL_1: 'BM', BM_RETAKE_REQUIRED: 'BM', LEVEL_1_RETAKE_REQUIRED: 'BM',
    PENDING_AM_REVIEW: 'AM', PENDING_LEVEL_2: 'AM', AM_RETAKE_REQUIRED: 'AM', LEVEL_2_RETAKE_REQUIRED: 'AM',
    PENDING_QC_VERIFICATION: 'QC', PENDING_LEVEL_3: 'QC', QC_VERIFICATION_RETAKE_REQUIRED: 'QC', LEVEL_3_RETAKE_REQUIRED: 'QC',
    PENDING_FINAL_REVIEW: 'FINAL', FINAL_RETAKE_REQUIRED: 'FINAL',
};

const personFromReviewer = (u: RenewalHistoryRow['performedBy']) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);

function parseJsonState(s: string | null): Record<string, unknown> {
    if (!s) return {};
    try { return JSON.parse(s); } catch { return {}; }
}

// A history row is a per-document review (from renewal-kyc-documents/[id]/review)
// when its state JSON carries a documentId — those never appear on the stage-cycle
// bar itself (only stage-transition actions do), but they ARE what "click a stage"
// shows: exactly the image approvals that stage acted on.
// Built-in stage roles → their trail node. Custom-role stages have no node of their own.
const STAGE_KEY_FROM_ROLE: Record<string, RenewalCycleStep['key']> = {
    'branch-manager': 'BM', 'area-manager': 'AM', 'quality-checkers': 'QC', 'background-verification-team': 'QC',
};

function stageKeyFromState(state: Record<string, unknown>): RenewalCycleStep['key'] | null {
    const roleSlug = (state.stage as { roleSlug?: string } | undefined)?.roleSlug;
    return roleSlug ? STAGE_KEY_FROM_ROLE[roleSlug] ?? null : null;
}

function renewalDocEventStage(h: RenewalHistoryRow): RenewalCycleStep['key'] | null {
    const state = parseJsonState(h.newState) as { documentId?: string; bmDecision?: string; amDecision?: string; qcDecision?: string; stage?: unknown };
    if (!state.documentId) return null;
    if (state.stage) return stageKeyFromState(state);
    if (state.bmDecision) return 'BM';
    if (state.amDecision) return 'AM';
    if (state.qcDecision) return 'QC';
    return null;
}

// Builds the top stage-cycle bar purely from this renewal's own history (FDO
// submit -> BM -> AM -> QC -> Admin, plus any recheck loops) — never the member's
// original, unrelated enrollment cycle.
function buildRenewalCycleTrail(history: RenewalHistoryRow[]): RenewalCycleStep[] {
    const hist = [...history].reverse(); // stored DESC — chronological for the trail
    const steps: RenewalCycleStep[] = [];
    for (const h of hist) {
        if (renewalDocEventStage(h)) continue; // per-image events aren't stage nodes
        let key: RenewalCycleStep['key'] | null = null;
        let sub: 'Approved' | 'Verified' | 'Submitted' | 'Resubmitted' | 'Recheck' | 'Rejected' | null = null;
        if (h.action === 'FDO_SUBMITTED_RENEWAL') { key = 'FDO'; sub = 'Submitted'; }
        else if (h.action === 'FDO_RESUBMITTED_RENEWAL') { key = 'FDO'; sub = 'Resubmitted'; }
        else if (h.action === 'BM_COMPLETED_REVIEW') { key = 'BM'; sub = 'Approved'; }
        else if (h.action === 'AM_APPROVED_LOAN') { key = 'AM'; sub = 'Approved'; }
        else if (h.action === 'QC_VERIFIED_LOAN') { key = 'QC'; sub = 'Verified'; }
        else if (h.action === 'FINAL_APPROVED_LOAN') { key = 'FINAL'; sub = 'Approved'; }
        else if (h.action === 'RENEWAL_RETAKE_REQUESTED' || h.action === 'RENEWAL_REJECTED') {
            const fromStatus = parseJsonState(h.previousState).renewalApprovalStatus as string | undefined;
            key = stageKeyFromState(parseJsonState(h.newState))
                ?? (fromStatus ? RENEWAL_STAGE_FROM_STATUS[fromStatus] ?? null : null);
            sub = h.action === 'RENEWAL_REJECTED' ? 'Rejected' : 'Recheck';
        }
        if (!key || !sub) continue;
        const stageLabel = key === 'FINAL' ? 'Admin' : key;
        const label = ['Approved', 'Verified', 'Submitted', 'Resubmitted'].includes(sub) ? stageLabel : `${stageLabel} (${sub})`;
        const prev = steps[steps.length - 1];
        if (prev && prev.label === label) continue; // collapse consecutive duplicates
        steps.push({ key, label, person: personFromReviewer(h.performedBy), employeeId: h.performedBy?.employeeId ?? null, date: h.createdAt, done: true });
    }
    return steps;
}

const RENEWAL_ACTION_LABEL: Record<string, string> = {
    FDO_SUBMITTED_RENEWAL: 'Submitted',
    FDO_RESUBMITTED_RENEWAL: 'Resubmitted',
    BM_COMPLETED_REVIEW: 'Approved & Forwarded',
    AM_APPROVED_LOAN: 'Approved & Forwarded',
    QC_VERIFIED_LOAN: 'Verified & Forwarded',
    FINAL_APPROVED_LOAN: 'Final Approved',
    RENEWAL_RETAKE_REQUESTED: 'Retake Requested',
    RENEWAL_REJECTED: 'Rejected',
    RENEWAL_DOC_VERIFIED: 'Document Verified',
    RENEWAL_DOC_RETAKE_REQUIRED: 'Document Retake Requested',
};

const RENEWAL_ACTION_STAGE: Record<string, RenewalCycleStep['key']> = {
    FDO_SUBMITTED_RENEWAL: 'FDO', FDO_RESUBMITTED_RENEWAL: 'FDO',
    BM_COMPLETED_REVIEW: 'BM', AM_APPROVED_LOAN: 'AM', QC_VERIFIED_LOAN: 'QC', FINAL_APPROVED_LOAN: 'FINAL',
};

// The doc-review route stores "<DOCUMENT_TYPE> <decision>" as the remark when the
// reviewer typed none — that's not a remark anyone wrote, so it's left out.
const AUTO_DOC_REMARK = /^[A-Z][A-Z0-9_]* [a-z][a-z ]*$/;

// Every remark written on this renewal by any stage (stage decisions + per-image
// reviews), oldest first — so later stages and Admin see what earlier stages wrote.
function buildRenewalRemarkEntries(history: RenewalHistoryRow[], docTypeById: Map<string, string>): StageRemarkEntry[] {
    return [...history]
        .reverse()
        .filter((h) => h.remarks?.trim() && !(renewalDocEventStage(h) && AUTO_DOC_REMARK.test(h.remarks.trim())))
        .map((h) => {
            const newState = parseJsonState(h.newState) as { documentId?: string; stage?: { stageName?: string } };
            const fromStatus = parseJsonState(h.previousState).renewalApprovalStatus as string | undefined;
            const key = renewalDocEventStage(h)
                ?? RENEWAL_ACTION_STAGE[h.action]
                ?? stageKeyFromState(newState)
                ?? (fromStatus ? RENEWAL_STAGE_FROM_STATUS[fromStatus] ?? null : null);
            const docType = newState.documentId ? docTypeById.get(newState.documentId) : undefined;
            return {
                id: h.id,
                // Custom-role stages carry their configured name; built-ins map to BM/AM/QC/Admin
                stage: newState.stage?.stageName ?? (key === 'FINAL' ? 'Admin' : key ?? h.performedBy?.role?.replace(/_/g, ' ') ?? 'Other'),
                action: RENEWAL_ACTION_LABEL[h.action] ?? h.action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()),
                documentLabel: docType ? getKycDocumentTypeLabel(docType) : newState.documentId ? 'Document' : null,
                person: personFromReviewer(h.performedBy),
                employeeId: h.performedBy?.employeeId ?? null,
                date: toDisplayDateTime(new Date(h.createdAt)),
                remark: h.remarks!.trim(),
            };
        });
}

// "Click a stage" detail — the image-level approvals that stage acted on, not the
// member's enrollment-time KYC review (see ApprovalClientDetail's
// renewalStageDetails doc comment).
function buildRenewalStageDetail(history: RenewalHistoryRow[], stageKey: string): React.ReactNode {
    const events = [...history].reverse().filter((h) => renewalDocEventStage(h) === stageKey);
    if (events.length === 0) {
        return <p className="text-xs text-muted-foreground">No image approvals recorded for this stage yet.</p>;
    }
    return (
        <table className="w-full border-collapse text-xs">
            <tbody>
                {events.map((h) => (
                    <tr key={h.id}>
                        <td className="border border-border px-2 py-1.5 bg-muted text-muted-foreground align-top w-2/5">
                            {toDisplayDateTime(new Date(h.createdAt))}
                        </td>
                        <td className="border border-border px-2 py-1.5">
                            <div className={cn('font-semibold', h.action === 'RENEWAL_DOC_VERIFIED' ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400')}>
                                {h.remarks || h.action.replace(/_/g, ' ')}
                            </div>
                            {h.performedBy && (
                                <div className="text-muted-foreground">
                                    {personFromReviewer(h.performedBy)}
                                    {h.performedBy.employeeId && <span className="ml-1 font-mono">({h.performedBy.employeeId})</span>}
                                </div>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
type RenewalDetail = {
    loan: {
        id: string; loanNumber: string; renewalApprovalStatus: string;
        amount: number | string; interestRate: number | string; tenureMonths: number; frequency: string | null;
        loanProductId: string | null; branchId: string;
        renewalProposedData: { address?: Record<string, string | null> } | null;
        loanProduct: { productName: string } | null;
        loanPurpose: { name: string; loanPurposeType: { name: string } | null } | null;
        client: Record<string, string | number | null> & { firstName: string; lastName: string; clientId: string };
        renewalKycDocuments: RenewalKycDoc[];
        renewalHistory: RenewalHistoryRow[];
    };
    coApplicant: {
        id: string; name: string; relationWithClient: string; mobileNumber: string | null; status: string;
    } | null;
    coApplicantMode: 'existing' | 'new' | null;
    workflow: RenewalWorkflow;
};

export function RenewalLoanDetail({ loanId, onBack, onDone, readOnly }: { loanId: string; onBack: () => void; onDone: () => void; readOnly?: boolean }) {
    const { toast } = useToast();
    const currentUser = tokenStorage.getUser();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<RenewalDetail | null>(null);
    const [remarks, setRemarks] = useState('');
    const [submitting, setSubmitting] = useState<string | null>(null);

    // Change Loan Product dialog — swaps the renewal loan's product (and its
    // derived amount/interest/tenure/frequency) while it's still working
    // through the renewal approval chain, before FINAL_APPROVE releases it
    // into Loan Indexation.
    const [productDialogOpen, setProductDialogOpen] = useState(false);
    const [productOptions, setProductOptions] = useState<Array<{ id: string; productName: string; loanAmount: number; frequency: string }>>([]);
    const [productOptionsLoading, setProductOptionsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState('');
    const [savingProduct, setSavingProduct] = useState(false);

    // Per-document review (house/co-applicant images) — every one of these must be
    // individually VERIFIED before the stage-forward action below will succeed; the
    // API enforces this too (assertDocsReviewed in renewal-action/route.ts), this is
    // just what disables the button early with a clear reason instead of a failed request.
    const [docActionLoading, setDocActionLoading] = useState<string | null>(null);
    const [docRemarks, setDocRemarks] = useState<Record<string, string>>({});
    const reviewDoc = async (docId: string, decision: 'VERIFIED' | 'RETAKE_REQUIRED') => {
        if (decision === 'RETAKE_REQUIRED' && !(docRemarks[docId] || '').trim()) {
            toast({ title: 'Remarks required', description: 'Add a remark before requesting a retake.', variant: 'destructive' });
            return;
        }
        setDocActionLoading(docId);
        const res = await apiClient.post(`/approval/loans/${loanId}/renewal-kyc-documents/${docId}/review`, {
            decision, remarks: docRemarks[docId]?.trim() || undefined,
        });
        setDocActionLoading(null);
        if (res.success) {
            await fetchDetail();
        } else {
            toast({ title: 'Error', description: res.error || 'Failed to review document', variant: 'destructive' });
        }
    };

    const fetchDetail = async () => {
        const res = await apiClient.get<RenewalDetail>(`/loans/renewal-application?loanId=${loanId}`);
        if (res.success && res.data) setData(res.data);
        else toast({ title: 'Error', description: res.error || 'Failed to load renewal application', variant: 'destructive' });
        return res;
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await fetchDetail();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loanId]);

    const canChangeProduct = !readOnly && !!data && data.loan.renewalApprovalStatus !== 'APPROVED' && data.loan.renewalApprovalStatus !== 'REJECTED';

    const openProductDialog = async () => {
        if (!data) return;
        setSelectedProductId(data.loan.loanProductId || '');
        setProductDialogOpen(true);
        if (productOptions.length === 0) {
            setProductOptionsLoading(true);
            try {
                const res = await apiClient.get<typeof productOptions>(`/products?branchId=${data.loan.branchId}`);
                if (res.success && res.data) setProductOptions(res.data);
            } finally {
                setProductOptionsLoading(false);
            }
        }
    };

    const handleSaveProduct = async () => {
        if (!data || !selectedProductId || selectedProductId === data.loan.loanProductId) {
            setProductDialogOpen(false);
            return;
        }
        setSavingProduct(true);
        try {
            const res = await apiClient.patch(`/approval/loans/${loanId}/renewal-product`, { loanProductId: selectedProductId });
            if (res.success) {
                toast({ title: 'Loan product updated' });
                setProductDialogOpen(false);
                await fetchDetail();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to update loan product', variant: 'destructive' });
            }
        } finally {
            setSavingProduct(false);
        }
    };

    const runAction = async (action: string) => {
        if ((action.includes('RETAKE') || action.includes('REJECT')) && !remarks.trim()) {
            toast({ title: 'Remarks required', description: 'Add a remark before retake / reject.', variant: 'destructive' });
            return;
        }
        setSubmitting(action);
        const res = await apiClient.post(`/approval/loans/${loanId}/renewal-action`, { action, remarks: remarks.trim() || undefined });
        setSubmitting(null);
        if (res.success) {
            toast({ title: 'Done', description: `Action completed.` });
            onDone();
        } else {
            toast({ title: 'Error', description: res.error || 'Action failed', variant: 'destructive' });
        }
    };

    if (loading) return <Card><CardContent className="py-12"><PageLoader label="Loading application…" fullScreen={false} /></CardContent></Card>;
    if (!data) return null;

    const loan = data.loan;
    const proposedAddr: Record<string, string | null> = loan.renewalProposedData?.address ?? {};
    const client = loan.client;
    const acts = actionsForWorkflow(data.workflow);
    const houseDocs = (loan.renewalKycDocuments ?? []).filter((d) => !d.coApplicantId);
    const coDocs = (loan.renewalKycDocuments ?? []).filter((d) => d.coApplicantId);
    const renewalDocs = [...houseDocs, ...coDocs];
    const currentStageName = data.workflow?.currentStage?.stageName ?? null;
    const pendingDocs = renewalDocs.filter((d) => d.currentStageDecision === 'PENDING');
    const retakeDocs = renewalDocs.filter((d) => d.currentStageDecision === 'RETAKE_REQUIRED');
    // Mirrors the server-side assertDocsReviewed gate — every document must be
    // individually VERIFIED at this stage before the stage can be forwarded.
    const docsBlockForward = pendingDocs.length > 0 || retakeDocs.length > 0;

    // One renewal image's stage status + Approve/Retake controls. House images get this
    // rendered directly under their image in the KYC grid above (renderRenewalDocReview),
    // exactly like a member approval's per-document review; co-applicant images, which
    // aren't in that grid, get it under their own card in the section below.
    const renderDocReview = (d: RenewalKycDoc) => {
        const canReviewDoc = !readOnly && d.currentStageDecision === 'PENDING';
        return (
            <>
                <div className="px-2 py-1 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                        <p className="truncate font-medium">{getKycDocumentTypeLabel(d.documentType)}</p>
                        {/* Approved stages are shown below as "Approved by …" rows instead of a bare chip. */}
                        {d.currentStageDecision && d.currentStageDecision !== 'VERIFIED' && (
                            <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold', DOC_DECISION_CLS[d.currentStageDecision] ?? 'bg-slate-100 text-slate-700')}>
                                {currentStageName ? `${currentStageName}: ` : ''}{d.currentStageDecision.replace(/_/g, ' ')}
                            </span>
                        )}
                    </div>
                    {d.retakeReason && <p className="truncate text-orange-600">⟳ {d.retakeReason}</p>}
                </div>
                <DocApprovals doc={d} />
                {canReviewDoc && (
                    <div className="space-y-1.5 border-t bg-muted/30 p-1.5">
                        <Textarea
                            placeholder="Remark (required for retake)…"
                            value={docRemarks[d.id] || ''}
                            onChange={(e) => setDocRemarks((prev) => ({ ...prev, [d.id]: e.target.value }))}
                            className="min-h-[44px] text-[11px]"
                        />
                        <div className="flex gap-1.5">
                            <Button
                                size="sm"
                                onClick={() => reviewDoc(d.id, 'VERIFIED')}
                                disabled={!!docActionLoading}
                                className="h-7 flex-1 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                            >
                                {docActionLoading === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => reviewDoc(d.id, 'RETAKE_REQUIRED')}
                                disabled={!!docActionLoading}
                                className="h-7 flex-1 gap-1 border-orange-300 px-2 text-[11px] text-orange-700 hover:bg-orange-50"
                            >
                                <RotateCcw className="h-3 w-3" /> Retake
                            </Button>
                        </div>
                    </div>
                )}
            </>
        );
    };
    const renewalCycleTrail = buildRenewalCycleTrail(loan.renewalHistory ?? []);
    const renewalStageDetails = {
        FDO: buildRenewalStageDetail(loan.renewalHistory ?? [], 'FDO'),
        BM: buildRenewalStageDetail(loan.renewalHistory ?? [], 'BM'),
        AM: buildRenewalStageDetail(loan.renewalHistory ?? [], 'AM'),
        QC: buildRenewalStageDetail(loan.renewalHistory ?? [], 'QC'),
        FINAL: buildRenewalStageDetail(loan.renewalHistory ?? [], 'FINAL'),
    } as const;

    return (
        <div className="space-y-4">
            {/* No separate "Back to list" button here — ApprovalClientDetail renders its
                own Back button (wired to this same onBack) right above the member name,
                so there's exactly one way back, not two stacked on top of each other. */}
            {/* Everything about this renewal — the member's reference profile/KYC AND
                the renewal's own Co-Applicant / "Uploaded for This Renewal" review /
                stage-action bar — renders as ONE panel, not a profile card followed by
                a second, separately-bordered "renewal" card: the
                latter is passed in as renewalExtraContent and folded into this same
                card as one more section (see that prop's doc comment). approvalStatus
                is APPROVED here, so the profile's own stage action buttons stay hidden
                on their own. hideKycAndChecklist suppresses each KYC card's stale
                BM/AM/QC "Pending" chips (that's the member's enrollment-time review,
                not this renewal), the Approval Checklist, and the Edit Client button —
                a renewal never edits the member's master data, only its own loan
                product (renewalLoanOverride's own Change control). This renewal's own
                re-uploads are NOT mixed into the KYC grid either way (loanId scoping)
                — they're reviewed/approved in the "Uploaded for This Renewal" section
                below, which carries its own per-document BM/AM/QC status and gates the
                stage-action bar until every one of them is approved. */}
            <ApprovalClientDetail
                clientId={client.clientId}
                onBack={onBack}
                onActionComplete={() => fetchDetail()}
                userRole={currentUser?.role ?? ''}
                rbacRoleSlug={currentUser?.rbacRoleSlug}
                isSubAdmin={currentUser?.isSubAdmin}
                readOnly={readOnly}
                hideKycAndChecklist
                renewalProposedAddress={proposedAddr}
                renewalDocOverrides={houseDocs.map((d) => ({
                    id: d.id, documentType: d.documentType, fileUrl: d.fileUrl ?? '', fileName: d.fileName ?? null,
                    bmDecision: d.bmDecision, amDecision: d.amDecision, qcDecision: d.qcDecision, retakeReason: d.retakeReason,
                    stageDecisions: d.stageDecisions,
                }))}
                renewalCycleTrail={renewalCycleTrail}
                renderRenewalDocReview={(docId) => {
                    const d = houseDocs.find((h) => h.id === docId);
                    return d ? renderDocReview(d) : null;
                }}
                renewalStageDetails={renewalStageDetails}
                renewalLoanOverride={{
                    productName: loan.loanProduct?.productName ?? null,
                    amount: Number(loan.amount),
                    interestRate: Number(loan.interestRate),
                    tenureMonths: loan.tenureMonths,
                    frequency: loan.frequency,
                    purposeName: loan.loanPurpose
                        ? `${loan.loanPurpose.loanPurposeType?.name ? `${loan.loanPurpose.loanPurposeType.name} · ` : ''}${loan.loanPurpose.name}`
                        : null,
                    canChangeProduct: canChangeProduct,
                    onChangeProduct: openProductDialog,
                }}
                renewalExtraContent={
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">This Renewal — Loan {loan.loanNumber}</h3>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="border-teal-400 text-teal-700 dark:text-teal-300">Renewal Loan</Badge>
                                {statusChip(loan.renewalApprovalStatus)}
                            </div>
                        </div>

                        {/* Co-applicant */}
                        <section>
                            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><UserPlus className="h-4 w-4" /> Co-Applicant ({data.coApplicantMode === 'new' ? 'New — needs review' : 'Existing'})</h3>
                            {data.coApplicant ? (
                                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                    <div><span className="text-muted-foreground">Name</span><p className="font-medium">{data.coApplicant.name}</p></div>
                                    <div><span className="text-muted-foreground">Relation</span><p className="font-medium">{data.coApplicant.relationWithClient}</p></div>
                                    <div><span className="text-muted-foreground">Mobile</span><p className="font-medium">{data.coApplicant.mobileNumber || '—'}</p></div>
                                    <div><span className="text-muted-foreground">Status</span><p className="font-medium">{data.coApplicant.status}</p></div>
                                </div>
                            ) : <p className="text-sm text-muted-foreground">No co-applicant on this application.</p>}
                        </section>

                        {/* This is the ONLY thing being approved on this screen: what was
                            actually captured/re-uploaded for THIS renewal (house images,
                            location QR, and — if a brand new co-applicant was added —
                            their docs). The member's full original KYC (Aadhaar, Voter ID,
                            PAN, etc.) is reference-only, shown once in the profile above —
                            it was already approved at enrollment and isn't part of this
                            decision, so it isn't repeated here. Each card's badge is this
                            stage's own decision on that document (bmDecision / amDecision /
                            qcDecision — whichever the current renewalApprovalStatus is
                            waiting on), so any blocker here is scoped to these house/
                            co-applicant images only, never the member's unrelated
                            enrollment KYC. */}
                        <section>
                            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4" /> Uploaded for This Renewal — Under Review <span className="font-normal text-muted-foreground">(approve each image above, tagged &quot;New · This Renewal&quot;)</span></h3>
                            {docsBlockForward && (
                                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                                    <span>
                                        {retakeDocs.length > 0 && <>Retake requested: {retakeDocs.map((d) => getKycDocumentTypeLabel(d.documentType)).join(', ')}. </>}
                                        {pendingDocs.length > 0 && <>Awaiting your approval — this can&apos;t move to the next stage until every renewal image is approved: {pendingDocs.map((d) => getKycDocumentTypeLabel(d.documentType)).join(', ')}.</>}
                                    </span>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                                {coDocs.map((d) => (
                                    <div key={d.id} className="overflow-hidden rounded-lg border">
                                        <div className="flex aspect-square items-center justify-center bg-slate-100 dark:bg-slate-800">
                                            <StorageImage src={d.fileUrl ?? ''} alt={d.documentType} className="h-full w-full object-cover" />
                                        </div>
                                        {renderDocReview(d)}
                                    </div>
                                ))}
                                {renewalDocs.length === 0 && <p className="text-sm text-muted-foreground">Nothing re-uploaded for this renewal.</p>}
                            </div>
                        </section>

                        {/* No separate raw "Approval Trail" list here — the same history
                            (including which images were approved and when) is already
                            available per stage via the Stage Cycle Bar above: click FDO/
                            BM/AM/QC/Admin to see exactly what that stage did. Remarks are
                            the exception: every stage's remarks are listed together so a
                            later stage / Admin reads them all without clicking each stage. */}
                        <StageRemarksPanel
                            className="rounded-lg border border-border overflow-hidden"
                            entries={buildRenewalRemarkEntries(
                                loan.renewalHistory ?? [],
                                new Map([...renewalDocs, ...houseDocs, ...coDocs].map((d) => [d.id, d.documentType])),
                            )}
                        />

                        {/* Action bar — hidden in read-only tracker view (the Loan Tracker's
                            "Renewal Loans" tab is for monitoring stage progress, not for
                            taking approval actions; those still happen from the Approval
                            Workbench's own Renewal Loan Approval tab). */}
                        {acts && !readOnly && (
                            <section className="space-y-3 border-t pt-4">
                                {docsBlockForward && (
                                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-foreground">
                                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                                        <span>Approve every image in &quot;Uploaded for This Renewal&quot; above before you can forward this loan to the next stage.</span>
                                    </div>
                                )}
                                <Textarea
                                    placeholder="Remarks (required for retake / reject)…"
                                    value={remarks}
                                    onChange={(e) => setRemarks(e.target.value)}
                                    className="min-h-[64px]"
                                />
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        onClick={() => runAction(acts.approve)}
                                        disabled={!!submitting || docsBlockForward}
                                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                    >
                                        {submitting === acts.approve ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                        {acts.approveLabel}
                                    </Button>
                                    {loan.renewalApprovalStatus !== 'FINAL_RETAKE_REQUIRED' && (
                                        <Button onClick={() => runAction(acts.retake)} disabled={!!submitting} variant="outline" className="gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50">
                                            {submitting === acts.retake ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                            Request Retake
                                        </Button>
                                    )}
                                    <Button onClick={() => runAction(acts.reject)} disabled={!!submitting} variant="outline" className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50">
                                        {submitting === acts.reject ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                        Reject
                                    </Button>
                                </div>
                            </section>
                        )}
                    </>
                }
            />

            {/* Change Loan Product dialog */}
            <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Change Loan Product</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Current: <span className="font-medium text-foreground">{loan.loanProduct?.productName ?? '—'}</span> · ₹{fmtCurrency(Number(loan.amount))}
                        </p>
                        {productOptionsLoading ? (
                            <PageLoader label="Loading products…" fullScreen={false} />
                        ) : (
                            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a loan product" />
                                </SelectTrigger>
                                <SelectContent>
                                    {productOptions.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.productName} — ₹{fmtCurrency(Number(p.loanAmount))} ({p.frequency})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Changing the product also updates the amount, interest rate, tenure and frequency to match it.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setProductDialogOpen(false)} disabled={savingProduct}>Cancel</Button>
                            <Button onClick={handleSaveProduct} disabled={savingProduct || !selectedProductId}>
                                {savingProduct ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function RenewalLoanApprovalQueue() {
    const { toast } = useToast();
    const currentUser = tokenStorage.getUser();
    const userRole = currentUser?.role;

    const [items, setItems] = useState<QueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [detailId, setDetailId] = useState<string | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(search), 500);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await apiClient.get<{ items: QueueItem[] }>(`/approval/loans/renewal-queue?search=${encodeURIComponent(debounced)}`);
            if (cancelled) return;
            if (res.success && res.data) setItems(res.data.items ?? []);
            else toast({ title: 'Error', description: res.error || 'Failed to load renewal queue', variant: 'destructive' });
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [debounced, refresh, toast]);

    if (detailId) {
        return (
            <RenewalLoanDetail
                loanId={detailId}
                onBack={() => setDetailId(null)}
                onDone={() => { setDetailId(null); setRefresh((n) => n + 1); }}
            />
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Renewal Loan Approval</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Renewal loan applications submitted from the Member Enrollment page — review before Loan Indexation.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-2 px-3 py-1 text-xs font-medium">
                        {userRole === 'BRANCH_MANAGER' ? '🔍 BM Review' : userRole === 'AREA_MANAGER' ? '✅ AM Review' : '🏦 Review'}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => { setLoading(true); setRefresh((n) => n + 1); }} disabled={loading} className="h-9 gap-1.5 border-2">
                        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
                    </Button>
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    placeholder="Search by member, ID or loan number…"
                    className="h-11 rounded-xl border-2 pl-10 pr-10"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {loading && items.length === 0 ? (
                <Card className="border-2"><CardContent className="py-12"><PageLoader label="Loading…" fullScreen={false} /></CardContent></Card>
            ) : items.length === 0 ? (
                <Card className="border-2 border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <RotateCcw className="mb-3 h-8 w-8 text-slate-400" />
                        <h3 className="text-base font-semibold">No renewal loans pending</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Nothing awaiting your review at this stage.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2.5">
                    {items.map((it, idx) => (
                        <div key={it.id} className="group rounded-xl border-2 border-primary/20 bg-white shadow-sm transition-all hover:border-primary/50 hover:shadow-md dark:bg-brand-green-darker/40">
                            <div className="flex w-full items-center gap-3 px-4 py-3.5">
                                <span className="w-6 flex-shrink-0 text-center text-xs text-slate-400">{idx + 1}</span>
                                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 text-base font-bold text-white">
                                    {it.clientName.charAt(0).toUpperCase()}
                                </div>
                                <button onClick={() => setDetailId(it.id)} className="min-w-0 flex-1 text-left">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{it.clientName}</span>
                                        <Badge variant="outline" className="border-teal-400 text-[10px] text-teal-700 dark:text-teal-300">Renewal Loan</Badge>
                                        {statusChip(it.renewalApprovalStatus)}
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                        <span className="font-mono">{it.clientDisplayId}</span>
                                        <span>🧾 {it.loanNumber}</span>
                                        <span>₹{fmtCurrency(it.amount)}</span>
                                        {it.productName && <span>{it.productName}</span>}
                                        {it.centerName && <span>🏠 {it.centerName}</span>}
                                        <span>📄 {it.kycDocCount} docs</span>
                                        {it.fdoName && <span><span className="font-semibold">FDO:</span> {it.fdoName}</span>}
                                    </div>
                                </button>

                                {/* Highmark */}
                                <HighmarkHistoryButton
                                    clientId={it.clientId}
                                    clientName={it.clientName}
                                    centerName={it.centerName}
                                    variant="outline"
                                    className="flex-shrink-0 h-auto py-1.5"
                                />

                                <button
                                    onClick={() => setDetailId(it.id)}
                                    className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-primary/20 bg-green-50 px-3 py-1.5 text-xs font-medium text-sidebar-accent dark:border-sidebar-accent dark:bg-sidebar-accent/20 dark:text-slate-300"
                                >
                                    Review <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
