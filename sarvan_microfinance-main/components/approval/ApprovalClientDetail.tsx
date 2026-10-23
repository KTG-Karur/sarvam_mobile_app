'use client';

import { useState, useEffect, useCallback, Fragment, createContext, useContext, useMemo, useRef } from 'react';
import { StorageImage, StorageLink, StorageIframe } from '@/components/storage/StorageMedia';
import { DocStageApprovals } from './DocStageApprovals';
import { StageRemarksPanel, type StageRemarkEntry } from './StageRemarksPanel';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
    Loader2, ArrowLeft, CheckCircle2, AlertTriangle,
    FileText, RotateCcw, Trash2, Send, CheckCheck, Ban,
    ExternalLink, ChevronRight, MapPin, Pencil,
} from 'lucide-react';
import { KYCDetailsFlatForm } from '@/components/client/KYCDetailsFlatForm';
import { useBrandNames } from '@/app/lib/brand-context';
import { CENTER_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import { useDrivingDistance } from '@/hooks/useDrivingDistance';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { usePermission } from '@/app/hooks/usePermission';
import { SUPPORTED_KYC_DOCUMENT_TYPES } from '@/app/lib/kyc-document-types';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// Canonical label lookup (e.g. 'co_applicant_other_id' -> 'Co-Applicant Aadhaar - Front').
// Falls back to a generic "Title Case" of the raw documentType for anything not in the list.
const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(
    SUPPORTED_KYC_DOCUMENT_TYPES.map(t => [t.value, t.label])
);
function docTypeLabel(documentType: string): string {
    return DOC_TYPE_LABEL[documentType]
        ?? documentType.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

// ─── Types ───────────────────────────────────────────────────────────────────
type ChecklistItem = { key: string; label: string; passed: boolean; severity: 'blocker' | 'warning' };

type ReviewerRef = { firstName: string; lastName: string; employeeId: string | null };

type KYCDoc = {
    id: string; documentType: string; documentNumber: string | null;
    fileUrl: string; fileName: string; fileSize: number | null; mimeType: string | null;
    status: string;
    bmDecision: string; bmRemark: string | null; bmReviewedAt: string | null;
    bmReviewer: ReviewerRef | null;
    amDecision: string; amRemark: string | null; amReviewedAt: string | null;
    amReviewer: ReviewerRef | null;
    qcDecision: string; qcRemark: string | null; qcReviewedAt: string | null;
    qcReviewer: ReviewerRef | null;
    revisionNo: number; retakeReason: string | null;
    uploadedBy: ReviewerRef | null;
    createdAt: string;
    /** Dynamic workflow only: this document's decision for every configured stage, in order. */
    stageDecisions?: StageDecisionRow[];
};

type StageDecisionRow = {
    levelOrder: number; roleSlug: string; stageName: string;
    decision: string; remark: string | null; reviewedAt: string | null; reviewer: ReviewerRef | null;
};

/** A configured dynamic-workflow stage, with the statuses that mean "waiting on it". */
type WorkflowStageInfo = {
    levelOrder: number; roleSlug: string; stageName: string;
    pendingStatus: string; retakeStatus: string;
};

type HistoryItem = {
    id: string; action: string; remarks: string | null; kycDocumentId: string | null;
    previousState: string | null;   // JSON snapshot e.g. {"approvalStatus":"PENDING_QC_VERIFICATION"}
    createdAt: string;
    performedBy: { firstName: string; lastName: string; role: string; employeeId: string | null } | null;
};

type DynamicLevel = {
    isActive: boolean; canAct: boolean; stageName: string;
    levelOrder: number; nextStageName: string | null;
    /** Role slug of this user's stage — its per-document decisions are keyed by it. */
    roleSlug: string;
    /** Stage the client is currently waiting on (may belong to someone else). */
    currentStageName: string | null;
};

interface Props {
    clientId: string;
    onBack: () => void;
    onActionComplete: () => void;
    userRole: string;
    rbacRoleSlug?: string | null;
    /** True when the active RBAC role is flagged Role.isSubAdmin — grants final approval only. */
    isSubAdmin?: boolean;
    /** View-only mode — hides every action panel, per-document review button, and the Edit/Back
     *  controls, regardless of the viewer's role or the client's approval status. Used when this
     *  component is embedded outside the Approval Workbench (e.g. Search & Locate). */
    readOnly?: boolean;
    /** Shows and validates THIS location in the Member Location section instead of the
     *  client's stored (still-approved, unaffected-by-this-request) latitude/longitude.
     *  Used when embedding this component for a Renewal Loan review, where the FDO has
     *  captured a fresh location for the renewal that hasn't been applied to the client
     *  record yet — the reviewer should see and distance-check THAT location, not the old
     *  one still on file. */
    overrideLocation?: { latitude: number; longitude: number } | null;
    /** Renewal-review mode. Used when embedding this component for a Renewal Loan review:
     *  - Every KYC document card still shows its image, but its BM/AM/QC "Pending" chips,
     *    remarks, and review buttons are suppressed — that decision belongs to the member's
     *    original enrollment review, not this renewal, and is often stale/never individually
     *    re-verified, so surfacing it here would read as this renewal being blocked on
     *    something it has nothing to do with.
     *  - The Approval Checklist is hidden — its blockers are about the member's enrollment
     *    record as a whole, not this renewal (the renewal's own blockers, scoped to what was
     *    actually re-uploaded for it, are shown separately on the renewal review screen).
     *  - The Edit Client button is hidden — a renewal only ever edits its own loan product
     *    (via renewalLoanOverride below), never the member's master data. */
    hideKycAndChecklist?: boolean;
    /** Replaces the Loan Details section's Product/Amount/Interest/Tenure/Frequency/Purpose
     *  with the renewal LOAN's own current values (and its own product-change control)
     *  instead of the client's stale `requestedLoanProduct*` fields — those only ever held
     *  the client's very first loan request and read as empty once that request has long
     *  since become a real (and now renewing) Loan. Used when embedding this component for
     *  a Renewal Loan review, so the one Loan Details block shown is correct and editable
     *  without a second, duplicate "Loan Details" card elsewhere on the page. */
    renewalLoanOverride?: {
        productName: string | null;
        amount: number;
        interestRate: number;
        tenureMonths: number;
        frequency: string | null;
        purposeName: string | null;
        canChangeProduct?: boolean;
        onChangeProduct?: () => void;
    } | null;
    /** Annotates the Address & Contact section's fields with what this renewal is
     *  proposing to change, inline, instead of a second "Current vs. Proposed" table
     *  elsewhere on the page repeating the current values shown here. Keys match
     *  Client field names (permanentAddress, pincode, postOffice, district, state,
     *  country); a key is only rendered as a change when its value differs from the
     *  client's current one. Latitude/longitude are handled by overrideLocation's
     *  "Proposed for this renewal" badge instead, not here. */
    renewalProposedAddress?: Record<string, string | null> | null;
    /** Extra content rendered as one more section inside THIS component's own card,
     *  right after KYC Documents — used to fold the Renewal Loan review's own
     *  Co-Applicant / "Uploaded for This Renewal" / Approval Trail / stage-action bar
     *  into the same visual panel as the member profile above it, instead of a second,
     *  separately-bordered card stacked below that reads as an unrelated block. */
    renewalExtraContent?: React.ReactNode;
    /** A Renewal Loan's own member-level re-uploads (house images, location QR, gas bill,
     *  NOC — the loan-scoped KYC rows with no coApplicantId). Each one REPLACES the member's
     *  enrollment-time image of the same documentType in the KYC grid (or is added if the
     *  member never had one), tagged "New · This Renewal", so the reviewer sees only the
     *  current image in place instead of the stale one on top and the new one further down. */
    renewalDocOverrides?: Array<{
        id: string; documentType: string; fileUrl: string; fileName: string | null;
        /** The renewal doc's own per-stage decisions, so the preview's Review Status
         *  reflects this renewal's review instead of a blanket "Pending". */
        bmDecision?: string; amDecision?: string; qcDecision?: string; retakeReason?: string | null;
        /** Every configured stage's decision (any role, workflow order) — drives the
         *  preview's Review Status rows so custom stages (e.g. 4th Approval) show too. */
        stageDecisions?: StageDecisionRow[];
    }>;
    /** Replaces the Stage Cycle Bar's trail with THIS renewal's own FDO->BM->AM->QC->
     *  Admin history instead of buildCycleTrail(c)'s trail off the member's original
     *  (and, for a renewal, unrelated) enrollment cycle — a renewal reviewer clicking
     *  the bar shouldn't land on a years-old enrollment approval when what they're
     *  actually reviewing is this renewal. Same shape as the internal CycleStep. */
    renewalCycleTrail?: Array<{
        key: 'FDO' | 'BM' | 'AM' | 'QC' | 'FINAL';
        label: string;
        person: string | null;
        employeeId: string | null;
        date: string | null;
        done: boolean;
    }>;
    /** Paired with renewalCycleTrail: what the "click a stage" popup shows for each
     *  stage key, in place of getStageInfo(key)'s enrollment-approval lookup — the
     *  renewal's own image-approval detail for that stage (e.g. which house images
     *  BM verified and when), which is what a renewal reviewer actually wants to see. */
    renewalStageDetails?: Partial<Record<'FDO' | 'BM' | 'AM' | 'QC' | 'FINAL', React.ReactNode>>;
    /** The renewal's own per-image status + Approve/Retake controls for one of the
     *  renewalDocOverrides images, rendered directly under that image in the KYC grid —
     *  same layout as a member approval's per-document review, instead of a separate
     *  row of controls further down the page. */
    renderRenewalDocReview?: (docId: string) => React.ReactNode;
}

// ─── Stage cycle ─────────────────────────────────────────────────────────────
const STAGE_CYCLE = [
    { key: 'FDO',   label: 'FDO' },
    { key: 'BM',    label: 'BM' },
    { key: 'AM',    label: 'AM' },
    { key: 'QC',    label: 'QC' },
    { key: 'FINAL', label: 'Final Admin' },
];

/** Returns the index of the stage that is currently active (0-based). 5 = all done. -1 = rejected. */
function getActiveStageIndex(status: string): number {
    if (!status || status === 'SUBMITTED' || status === 'PENDING_BM_REVIEW' || status === 'BM_RETAKE_REQUIRED') return 1;
    if (status === 'PENDING_AM_REVIEW' || status === 'AM_RETAKE_REQUIRED') return 2;
    if (status.startsWith('PENDING_LEVEL_') || status.includes('LEVEL_RETAKE')) return 2;
    if (status === 'PENDING_QC_VERIFICATION' || status === 'QC_VERIFICATION_RETAKE_REQUIRED') return 3;
    if (status === 'PENDING_FINAL_REVIEW' || status === 'FINAL_RETAKE_REQUIRED') return 4;
    if (status === 'APPROVED') return 5;
    if (status === 'REJECTED') return -1;
    return 1;
}

// ─── Cycle trail (actual sequence of stage hops, incl. recheck loops) ─────────
// Renders e.g.  FDO -> BM -> AM (Recheck) -> FDO -> BM -> AM -> QC -> Admin
// instead of one fixed slot per stage, so a recheck loop is visible as a
// repeated stage node rather than overwriting the original BM/AM/QC visit.
// Built directly off the audit log (c.approvalHistory) — per-document
// VERIFIED/DELETED actions are excluded; only stage-transition actions count.
type CycleStep = {
    /** 'FDO' | 'BM' | 'AM' | 'QC' | 'FINAL', or `stage:<roleSlug>` for a dynamic workflow stage. */
    key: string;
    label: string;          // e.g. "BM" or "AM (Recheck)"
    person: string | null;
    employeeId: string | null;
    date: string | null;
    done: boolean;
};

const CYCLE_ACTION_META: Record<string, { key: CycleStep['key']; sub: string }> = {
    BM_COMPLETED_REVIEW:   { key: 'BM',    sub: 'Approved'    },
    BM_RETAKE_DOCUMENT:    { key: 'BM',    sub: 'Recheck'     },
    BM_REJECTED_CLIENT:    { key: 'BM',    sub: 'Rejected'    },
    AM_APPROVED_CLIENT:    { key: 'AM',    sub: 'Approved'    },
    AM_RETAKE_DOCUMENT:    { key: 'AM',    sub: 'Recheck'     },
    AM_REJECTED_CLIENT:    { key: 'AM',    sub: 'Rejected'    },
    QC_VERIFIED_CLIENT:    { key: 'QC',    sub: 'Verified'    },
    QC_RETAKE_CLIENT:      { key: 'QC',    sub: 'Recheck'     },
    // Per-document QC retake — logs QC_RETAKE_DOCUMENT when QC flags a specific
    // image for retake via the document-level review route.  Previously missing
    // from this map, so the "QC (Recheck)" step was invisible in the trail.
    QC_RETAKE_DOCUMENT:    { key: 'QC',    sub: 'Recheck'     },
    QC_REJECTED_CLIENT:    { key: 'QC',    sub: 'Rejected'    },
    FINAL_APPROVED_CLIENT: { key: 'FINAL', sub: 'Approved'    },
    FINAL_RETAKE_CLIENT:   { key: 'FINAL', sub: 'Recheck'     },
    FINAL_REJECTED_CLIENT: { key: 'FINAL', sub: 'Rejected'    },
    FDO_RESUBMITTED:       { key: 'FDO',   sub: 'Resubmitted' },
};

// LEVEL_APPROVED / LEVEL_RETAKE_REQUESTED / LEVEL_REJECTED (dynamic workflow)
// don't carry a fixed stage in their action name — infer it from previousState.
const LEVEL_FROM_STATUS: Record<string, CycleStep['key']> = {
    SUBMITTED: 'BM', PENDING_BM_REVIEW: 'BM',
    PENDING_AM_REVIEW: 'AM',
    PENDING_QC_VERIFICATION: 'QC',
    PENDING_FINAL_REVIEW: 'FINAL',
    PENDING_LEVEL_1: 'BM', PENDING_LEVEL_2: 'AM', PENDING_LEVEL_3: 'QC', PENDING_LEVEL_4: 'FINAL',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- clientData itself is untyped (useState<any>) throughout this file
function buildCycleTrail(c: any): CycleStep[] {
    const personFrom = (obj: { firstName: string; lastName: string } | null | undefined) =>
        obj ? `${obj.firstName} ${obj.lastName}`.trim() : null;
    const empIdFrom = (obj: { employeeId?: string | null } | null | undefined) =>
        obj?.employeeId ?? null;

    // approvalHistory is fetched DESC (newest first) — reverse for chronological order.
    const hist: HistoryItem[] = Array.isArray(c.approvalHistory)
        ? [...(c.approvalHistory as HistoryItem[])].reverse()
        : [];

    const raw: CycleStep[] = [
        { key: 'FDO', label: 'FDO', person: personFrom(c.enrolledBy), employeeId: empIdFrom(c.enrolledBy), date: c.createdAt ?? null, done: true },
    ];

    for (const h of hist) {
        if (h.action === 'SUBMITTED') continue;
        let meta = CYCLE_ACTION_META[h.action];
        if (!meta && (h.action === 'LEVEL_APPROVED' || h.action === 'LEVEL_RETAKE_REQUESTED' || h.action === 'LEVEL_REJECTED')) {
            let fromStatus: string | undefined;
            try { fromStatus = JSON.parse(h.previousState ?? '{}').approvalStatus; } catch { /* ignore */ }
            const key = fromStatus ? LEVEL_FROM_STATUS[fromStatus] : undefined;
            if (key) {
                meta = { key, sub: h.action === 'LEVEL_APPROVED' ? 'Approved' : h.action === 'LEVEL_REJECTED' ? 'Rejected' : 'Recheck' };
            }
        }
        if (!meta) continue;
        const stageLabel = meta.key === 'FINAL' ? 'Admin' : meta.key;
        // 'Approved', 'Verified', and 'Resubmitted' are all "normal pass-through"
        // actions — render them as just the stage name (e.g. "FDO" not
        // "FDO (Resubmitted)").  This makes the trail read naturally after a
        // retake: ... QC (Recheck) → FDO → BM → AM → QC → Admin, where the
        // second "FDO" node clearly shows the client returned to FDO before the
        // second review cycle.
        const plainSubs = ['Approved', 'Verified', 'Resubmitted'];
        raw.push({
            key: meta.key,
            label: plainSubs.includes(meta.sub) ? stageLabel : `${stageLabel} (${meta.sub})`,
            person: personFrom(h.performedBy),
            employeeId: empIdFrom(h.performedBy),
            date: h.createdAt,
            done: true,
        });
    }

    // Collapse consecutive duplicate nodes (e.g. multiple documents flagged
    // RETAKE_REQUIRED in the same review pass) into a single recheck event.
    const collapsed: CycleStep[] = [];
    for (const step of raw) {
        const prev = collapsed[collapsed.length - 1];
        if (prev && prev.label === step.label) continue;
        collapsed.push(step);
    }

    // Trailing "pending" node — what the client is currently waiting on.
    const status: string = c.approvalStatus || 'SUBMITTED';
    const PENDING_STAGE: Record<string, CycleStep['key']> = {
        SUBMITTED: 'BM', PENDING_BM_REVIEW: 'BM', BM_RETAKE_REQUIRED: 'FDO',
        PENDING_AM_REVIEW: 'AM', AM_RETAKE_REQUIRED: 'FDO',
        PENDING_QC_VERIFICATION: 'QC', QC_VERIFICATION_RETAKE_REQUIRED: 'FDO',
        PENDING_FINAL_REVIEW: 'FINAL', FINAL_RETAKE_REQUIRED: 'FDO',
        PENDING_LEVEL_1: 'BM', LEVEL_1_RETAKE_REQUIRED: 'FDO',
        PENDING_LEVEL_2: 'AM', LEVEL_2_RETAKE_REQUIRED: 'FDO',
        PENDING_LEVEL_3: 'QC', LEVEL_3_RETAKE_REQUIRED: 'FDO',
        PENDING_LEVEL_4: 'FINAL', LEVEL_4_RETAKE_REQUIRED: 'FDO',
    };
    if (status !== 'APPROVED' && status !== 'REJECTED') {
        const pendingKey = PENDING_STAGE[status];
        const last = collapsed[collapsed.length - 1];
        const pendingLabel = pendingKey === 'FINAL' ? 'Admin' : pendingKey;
        if (pendingKey && (!last || last.label !== pendingLabel)) {
            collapsed.push({ key: pendingKey, label: pendingLabel, person: null, employeeId: null, date: null, done: false });
        }
    }

    return collapsed;
}

// ─── Dynamic workflow trail ──────────────────────────────────────────────────
// With a ClientWorkflowConfig active the stages (and their order/roles) come from
// config, so the trail is built from stage NAMES instead of fixed BM/AM/QC slots.

/** The configured stage a client at `status` waits on (SUBMITTED = first stage). */
function stageForStatus(status: string, stages: WorkflowStageInfo[]): WorkflowStageInfo | null {
    if (status === 'SUBMITTED') return stages[0] ?? null;
    return stages.find(s => s.pendingStatus === status || s.retakeStatus === status) ?? null;
}

const BUILTIN_PREFIX_SLUG: Record<string, string> = { BM: 'branch-manager', AM: 'area-manager', QC: 'quality-checkers' };

/** Which configured stage a history entry belongs to (newer entries record it explicitly). */
function historyStage(h: HistoryItem, stages: WorkflowStageInfo[]): WorkflowStageInfo | null {
    let parsed: { approvalStatus?: string; stage?: { roleSlug: string; stageName: string; levelOrder: number } } = {};
    try { parsed = JSON.parse(h.previousState ?? '{}'); } catch { /* ignore */ }
    if (parsed.stage?.roleSlug) {
        return stages.find(s => s.roleSlug === parsed.stage!.roleSlug)
            ?? { ...parsed.stage, pendingStatus: '', retakeStatus: '' };
    }
    const builtinSlug = BUILTIN_PREFIX_SLUG[h.action.split('_')[0]];
    if (builtinSlug) {
        const st = stages.find(s => s.roleSlug === builtinSlug || (builtinSlug === 'quality-checkers' && s.roleSlug === 'background-verification-team'));
        if (st) return st;
    }
    return parsed.approvalStatus ? stageForStatus(parsed.approvalStatus, stages) : null;
}

const BUILTIN_DECISION_FIELD: Record<string, 'bmDecision' | 'amDecision' | 'qcDecision'> = {
    'branch-manager': 'bmDecision',
    'area-manager': 'amDecision',
    'quality-checkers': 'qcDecision',
    'background-verification-team': 'qcDecision',
};

/** A document's decision for the stage held by `roleSlug` (built-in columns or custom-role rows). */
function docStageDecision(doc: KYCDoc, roleSlug: string): string {
    const fromServer = doc.stageDecisions?.find(sd => sd.roleSlug === roleSlug)?.decision;
    if (fromServer) return fromServer;
    const field = BUILTIN_DECISION_FIELD[roleSlug];
    return (field ? doc[field] : null) ?? 'PENDING';
}

// Text the API writes into history.remarks when nobody typed one (document review /
// bulk verify / FDO re-upload / admin-edit restart) — not a remark, so the
// all-stages remarks panel leaves it out.
const AUTO_HISTORY_REMARK = /^(Document (verified|retake required|deleted|rejected)( in bulk.*)?$|Bulk auto-verified |Re-uploaded |Admin\/Sub Admin edit on an approved client)/i;

const DYNAMIC_ACTION_SUB: Record<string, string> = {
    LEVEL_APPROVED: 'Approved',
    LEVEL_RETAKE_REQUESTED: 'Recheck',
    LEVEL_REJECTED: 'Rejected',
    LEVEL_RETAKE_DOCUMENT: 'Recheck',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- clientData itself is untyped (useState<any>) throughout this file
function buildDynamicCycleTrail(c: any, stages: WorkflowStageInfo[]): CycleStep[] {
    const personFrom = (obj: { firstName: string; lastName: string } | null | undefined) =>
        obj ? `${obj.firstName} ${obj.lastName}`.trim() : null;
    const hist: HistoryItem[] = Array.isArray(c.approvalHistory)
        ? [...(c.approvalHistory as HistoryItem[])].reverse()
        : [];

    const raw: CycleStep[] = [
        { key: 'FDO', label: 'FDO', person: personFrom(c.enrolledBy), employeeId: c.enrolledBy?.employeeId ?? null, date: c.createdAt ?? null, done: true },
    ];
    const plainSubs = ['Approved', 'Verified', 'Resubmitted'];

    for (const h of hist) {
        let key: string;
        let name: string;
        let sub: string;
        if (h.action === 'FDO_RESUBMITTED') {
            key = 'FDO'; name = 'FDO'; sub = 'Resubmitted';
        } else if (h.action.startsWith('FINAL_')) {
            const meta = CYCLE_ACTION_META[h.action];
            if (!meta) continue;
            key = 'FINAL'; name = 'Admin'; sub = meta.sub;
        } else {
            const stageSub = DYNAMIC_ACTION_SUB[h.action] ?? CYCLE_ACTION_META[h.action]?.sub;
            if (!stageSub) continue;
            const st = historyStage(h, stages);
            if (st) {
                key = `stage:${st.roleSlug}`; name = st.stageName;
            } else {
                const meta = CYCLE_ACTION_META[h.action];
                if (!meta) continue;
                key = meta.key; name = meta.key;
            }
            sub = stageSub;
        }
        raw.push({
            key,
            label: plainSubs.includes(sub) ? name : `${name} (${sub})`,
            person: personFrom(h.performedBy),
            employeeId: h.performedBy?.employeeId ?? null,
            date: h.createdAt,
            done: true,
        });
    }

    const collapsed: CycleStep[] = [];
    for (const step of raw) {
        const prev = collapsed[collapsed.length - 1];
        if (prev && prev.label === step.label) continue;
        collapsed.push(step);
    }

    // Trailing "pending" node — who the client is waiting on now.
    const status: string = c.approvalStatus || 'SUBMITTED';
    if (status !== 'APPROVED' && status !== 'REJECTED') {
        let pending: { key: string; label: string } | null = null;
        if (status === 'FINAL_RETAKE_REQUIRED' || stages.some(s => s.retakeStatus === status)) {
            pending = { key: 'FDO', label: 'FDO' };
        } else if (status === 'PENDING_FINAL_REVIEW') {
            pending = { key: 'FINAL', label: 'Admin' };
        } else {
            const st = stageForStatus(status, stages);
            if (st) pending = { key: `stage:${st.roleSlug}`, label: st.stageName };
        }
        const last = collapsed[collapsed.length - 1];
        if (pending && (!last || last.label !== pending.label)) {
            collapsed.push({ ...pending, person: null, employeeId: null, date: null, done: false });
        }
    }
    return collapsed;
}

// ─── Doc decision display ─────────────────────────────────────────────────────
const DOC_DEC: Record<string, { label: string }> = {
    PENDING:         { label: 'Pending' },
    VERIFIED:        { label: 'Verified ✓' },
    RETAKE_REQUIRED: { label: 'Retake Required' },
    DELETED:         { label: 'Deleted' },
    REJECTED:        { label: 'Rejected ✗' },
};

// ─── Checklist context ────────────────────────────────────────────────────────
// TR cells consume this to decide whether to render a red * (failing blocker only).
const ChecklistContext = createContext<(fieldLabel: string) => boolean>(() => false);

/**
 * Returns a function `isFailing(fieldLabel)` that returns true when the given
 * form-field label matches a *failing blocker* in the checklist.
 *
 * Matching is done after normalising both sides:
 *   – strip possessives ('s → remove)
 *   – lowercase
 *   – remove common filler words ("is", "are", "provided", "assigned", …)
 *   – collapse whitespace
 * Then we test containment in both directions so short labels (e.g. "Mobile")
 * match longer checker phrases ("Mobile Number is provided").
 */
function buildFailedBlockerMatcher(checklist: ChecklistItem[]) {
    const FILLERS = /\b(is|are|has|have|been|a|an|the|provided|assigned|uploaded|complete|completeted|at|least|one|no|all|details|pending|retake|reviewed|by|bm|am|kyc|document|documents)\b/g;
    const norm = (s: string) =>
        s.replace(/'s/gi, '')          // "Father's" → "Father"
         .replace(/['''`]/g, '')        // remaining apostrophes
         .toLowerCase()
         .replace(FILLERS, ' ')
         .replace(/\s+/g, ' ')
         .trim();

    const failedNorms = checklist
        .filter(i => !i.passed && i.severity === 'blocker')
        .map(i => norm(i.label));

    return (fieldLabel: string): boolean => {
        const nf = norm(fieldLabel);
        if (nf.length < 3) return false;
        return failedNorms.some(fn => fn.includes(nf) || nf.includes(fn));
    };
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ApprovalClientDetail({ clientId, onBack, onActionComplete, userRole, rbacRoleSlug, isSubAdmin, readOnly, overrideLocation, hideKycAndChecklist, renewalLoanOverride, renewalProposedAddress, renewalExtraContent, renewalDocOverrides, renewalCycleTrail, renewalStageDetails, renderRenewalDocReview }: Props) {
    const { companyNameFull } = useBrandNames();
    const { canPage } = usePermission();
    const canApproveClients = canPage('/dashboard/approval/workbench', 'approve');
    const { toast } = useToast();

    const [clientData, setClientData]     = useState<any>(null);
    const [checklist, setChecklist]       = useState<ChecklistItem[]>([]);
    const [groups, setGroups]             = useState<any[]>([]);
    const [dynamicLevel, setDynamicLevel] = useState<DynamicLevel | null>(null);
    // Distinguishes "no dynamic workflow configured" (Admin keeps legacy BM/AM
    // override access) from "a dynamic workflow is active but Admin isn't one
    // of its stages" (dynamicLevel is null in both cases) — see isBM/isAM below.
    const [dynamicWorkflowActive, setDynamicWorkflowActive] = useState(false);
    // Configured dynamic-workflow stages (empty when no workflow is configured).
    const [workflowStages, setWorkflowStages] = useState<WorkflowStageInfo[]>([]);
    const [isLoading, setIsLoading]       = useState(true);
    const [actionLoading, setActionLoading]     = useState(false);
    const [docActionLoading, setDocActionLoading] = useState<string | null>(null);
    const [docRemarks, setDocRemarks]     = useState<Record<string, string>>({});
    const [stageRemarks, setStageRemarks] = useState('');
    const [previewDoc, setPreviewDoc]     = useState<KYCDoc | null>(null);
    const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    // Edit Loan Details dialog — lets a reviewer change the requested loan
    // product (which also re-derives amount/frequency) and/or purpose before
    // the client's first loan is auto-created at FINAL_APPROVE (see
    // first-loan.service.ts).
    const [loanDetailsDialogOpen, setLoanDetailsDialogOpen] = useState(false);
    const [productOptions, setProductOptions] = useState<Array<{ id: string; productName: string; loanAmount: number; frequency: string; loanProductTypeId: string }>>([]);
    const [purposeOptions, setPurposeOptions] = useState<Array<{ id: string; name: string; loanPurposeType?: { name: string } | null }>>([]);
    const [loanDetailsOptionsLoading, setLoanDetailsOptionsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState('');
    const [selectedPurposeId, setSelectedPurposeId] = useState('');
    const [savingLoanDetails, setSavingLoanDetails] = useState(false);
    const [stageHistory, setStageHistory] = useState<HistoryItem[]>([]);
    const [stageHistoryLoading, setStageHistoryLoading] = useState(false);
    // Admin-controlled kill-switch: whether BM can edit an already-APPROVED
    // client from this "Edit Client" dialog — mirrors the server-side gate in
    // PUT /api/clients/[clientId] (isBmEditApproved). Defaults to true (BM's
    // existing unrestricted behavior) until fetched.
    const [allowBmEditApproved, setAllowBmEditApproved] = useState(true);
    useEffect(() => {
        if (userRole !== 'BRANCH_MANAGER') return;
        apiClient.get<{ enabled: boolean }>('/settings/bm-approved-client-edit')
            .then((res) => { if (res.success && res.data) setAllowBmEditApproved(res.data.enabled); })
            .catch(() => { /* keep default (true) */ });
    }, [userRole]);

    // Tracks scroll position to restore after a silent (doc-review) refresh
    const savedScrollY    = useRef<number | null>(null);
    // Signals that the next clientData change should trigger a scroll restore
    const pendingScrollRestore = useRef(false);

    // ── Fetch ──
    // silent=true → skip the loading spinner so the page stays mounted and
    // the browser doesn't lose the scroll position.
    const fetchDetail = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const res = await apiClient.get<any>(`/approval/clients/${clientId}`);
            if (res.success && res.data) {
                setClientData(res.data.client);
                setChecklist(res.data.checklist || []);
                setGroups(res.data.groups || []);
                setDynamicLevel(res.data.dynamicLevel ?? null);
                setDynamicWorkflowActive(!!res.data.dynamicWorkflowActive);
                setWorkflowStages(res.data.workflowStages ?? []);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load client', variant: 'destructive' });
            }
        } catch { toast({ title: 'Error', description: 'Failed to load client detail', variant: 'destructive' }); }
        finally { if (!silent) setIsLoading(false); }
    }, [clientId, toast]);

    // After a silent refresh, restore the scroll position once React has
    // finished painting the updated content.
    useEffect(() => {
        if (pendingScrollRestore.current && savedScrollY.current !== null) {
            pendingScrollRestore.current = false;
            const y = savedScrollY.current;
            savedScrollY.current = null;
            requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }));
        }
    }, [clientData]);

    // Fetch full history every time a stage is clicked — no caching so it's
    // always fresh after an approval action happens on this page.
    const fetchStageHistory = useCallback(async () => {
        setStageHistoryLoading(true);
        try {
            const res = await apiClient.get<any>(`/approval/clients/${clientId}/history`);
            if (res.success && res.data) setStageHistory(res.data.history || []);
        } catch { /* silent */ }
        finally { setStageHistoryLoading(false); }
    }, [clientId]);

    useEffect(() => { fetchDetail(); }, [fetchDetail]);

    const handleStageClick = (key: string) => {
        setSelectedStageKey(key);
        fetchStageHistory();
    };

    // ── Document review ──
    const handleDocReview = async (docId: string, decision: string) => {
        const remark = docRemarks[docId] || '';
        if (decision !== 'VERIFIED' && !remark.trim()) {
            toast({ title: 'Remark Required', description: 'Please provide a remark for retake/delete/reject.', variant: 'destructive' });
            return;
        }
        setDocActionLoading(docId);
        try {
            const res = await apiClient.post<any>(`/approval/clients/${clientId}/documents/${docId}/review`, { decision, remark: remark || undefined });
            if (res.success) {
                toast({ title: 'Success', description: res.message || `Document ${decision.toLowerCase()}` });
                setDocRemarks(prev => ({ ...prev, [docId]: '' }));
                // Save scroll position; silent refresh keeps the page mounted so
                // scroll is restored in the useEffect above instead of jumping to top.
                savedScrollY.current = window.scrollY;
                pendingScrollRestore.current = true;
                fetchDetail(true);
            } else {
                toast({ title: 'Error', description: res.error || 'Document review failed', variant: 'destructive' });
            }
        } catch { toast({ title: 'Error', description: 'Failed to submit review', variant: 'destructive' }); }
        finally { setDocActionLoading(null); }
    };

    // ── Stage action ──
    const handleStageAction = async (action: string) => {
        if ((action.includes('RETAKE') || action.includes('REJECT')) && !stageRemarks.trim()) {
            toast({ title: 'Remarks Required', description: 'Please provide remarks for retake or reject.', variant: 'destructive' });
            return;
        }
        setActionLoading(true);
        try {
            const res = await apiClient.post<any>(`/approval/clients/${clientId}/action`, { action, remarks: stageRemarks || undefined });
            if (res.success) {
                toast({ title: 'Success', description: res.message || `Action ${action} completed` });
                // Approval succeeded but the member's first loan wasn't auto-created — say so
                // now rather than letting the member silently go missing from Loan Indexation.
                const firstLoan = (res.data as { firstLoan?: { created: boolean; reason?: string } | null } | undefined)?.firstLoan;
                if (firstLoan && !firstLoan.created && firstLoan.reason !== 'Client already has a loan record') {
                    toast({
                        title: 'Loan not created',
                        description: `Member approved, but the first loan could not be created: ${firstLoan.reason ?? 'unknown reason'}. Open Loan Indexation for the center to retry.`,
                        variant: 'destructive',
                    });
                }
                setStageRemarks('');
                onActionComplete();
            } else {
                toast({ title: 'Error', description: res.error || 'Action failed', variant: 'destructive' });
            }
        } catch { toast({ title: 'Error', description: 'Failed to execute action', variant: 'destructive' }); }
        finally { setActionLoading(false); }
    };

    // Build the failing-blocker matcher once per checklist change.
    // Must be above any early return so hook order stays constant.
    const isFailingBlocker = useMemo(() => buildFailedBlockerMatcher(checklist), [checklist]);

    // Location shown/validated in the Member Location section — the renewal's
    // freshly-captured proposed location when embedded for a Renewal Loan
    // review (see overrideLocation's doc comment), otherwise the client's own
    // stored location.
    const displayLatitude = overrideLocation?.latitude ?? clientData?.latitude ?? null;
    const displayLongitude = overrideLocation?.longitude ?? clientData?.longitude ?? null;

    // Road (driving) distance from that location to the client's assigned
    // center — must also be above the early return below.
    const centerDrivingDistance = useDrivingDistance(
        displayLatitude, displayLongitude,
        clientData?.center?.latitude ?? null, clientData?.center?.longitude ?? null,
    );

    // ── Loading ──
    if (isLoading || !clientData) {
        return (
            <ChecklistContext.Provider value={isFailingBlocker}>
                <PageLoader label="Loading client details…" />
            </ChecklistContext.Provider>
        );
    }

    const c = clientData;
    const approvalStatus: string = c.approvalStatus || 'SUBMITTED';
    // Admin's BM/AM override is a legacy fallback for when no dynamic workflow
    // is configured. Once a ClientWorkflowConfig is active, BM/AM stages are
    // explicitly assigned to other roles — Admin taking them via this override
    // would silently forward to the next stage instead of finalizing, which
    // looks like a broken "approve" to an Admin who expects it to be final.
    // Mirrors the server-side guard in the action route.
    // With a dynamic workflow active, the legacy BM/AM/QC panels (fixed BM → AM → QC
    // order) are off for everyone — the stage's LEVEL_ panel (canLevelAction) drives it.
    const isBM  = !dynamicWorkflowActive && (userRole === 'BRANCH_MANAGER' || userRole === 'ADMIN');
    const isAM  = !dynamicWorkflowActive && (userRole === 'AREA_MANAGER'   || userRole === 'ADMIN');
    const isQCTeam = userRole === 'QC' || rbacRoleSlug === 'quality-checkers';
    const canBMAction    = !readOnly && canApproveClients && isBM && ['SUBMITTED', 'PENDING_BM_REVIEW'].includes(approvalStatus);
    const canAMAction    = !readOnly && canApproveClients && isAM && approvalStatus === 'PENDING_AM_REVIEW';
    // QC can ACT only when the client is pending their review.
    // QC_VERIFICATION_RETAKE_REQUIRED means FDO must re-upload first —
    // client disappears from QC's queue and returns as PENDING_QC_VERIFICATION
    // after FDO resubmits. No action buttons shown in retake-waiting state.
    const canQCAction    = !readOnly && canApproveClients && isQCTeam && !dynamicWorkflowActive && approvalStatus === 'PENDING_QC_VERIFICATION';
    const canFinalAction = !readOnly && canApproveClients && (userRole === 'ADMIN' || !!isSubAdmin) && approvalStatus === 'PENDING_FINAL_REVIEW';
    const canLevelAction = !readOnly && canApproveClients && !!(dynamicLevel?.canAct);
    const canAct = canBMAction || canAMAction || canQCAction || canFinalAction || canLevelAction;
    // Edit access mirrors the PATCH /api/clients/[clientId] gate: BM is
    // unrestricted while the client isn't yet APPROVED (branch-scoped
    // server-side); once APPROVED, BM's edit access is further gated by the
    // Admin-controlled kill-switch (BmApprovedClientEditConfig). Admin/SubAdmin
    // always; AM/QC only while the client is currently at their own review stage.
    const canEditClient = !readOnly && !hideKycAndChecklist && (
        userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH' || !!isSubAdmin
        || (userRole === 'BRANCH_MANAGER' && (approvalStatus !== 'APPROVED' || allowBmEditApproved))
        || canAMAction || canQCAction || canLevelAction
    );
    // Loan details (product / purpose) can be edited from any reviewer stage
    // (same access as canEditClient), but only while the client hasn't reached
    // a final state — once APPROVED, the real Loan is (or is about to be)
    // created off the requested product by first-loan.service.ts, and a
    // REJECTED client has no approval left to act on.
    const canEditLoanDetails = canEditClient && approvalStatus !== 'APPROVED' && approvalStatus !== 'REJECTED' && !!c.requestedLoanProductId;

    const openLoanDetailsDialog = async () => {
        setSelectedProductId(c.requestedLoanProductId || '');
        setSelectedPurposeId(c.requestedLoanPurposeId || '');
        setLoanDetailsDialogOpen(true);
        if (productOptions.length === 0 || purposeOptions.length === 0) {
            setLoanDetailsOptionsLoading(true);
            try {
                const branchId = c.center?.branchId;
                const [productsRes, purposesRes] = await Promise.all([
                    apiClient.get<typeof productOptions>(`/products${branchId ? `?branchId=${branchId}` : ''}`),
                    apiClient.get<typeof purposeOptions>('/loan-purposes?includeType=true&includeInactive=false'),
                ]);
                if (productsRes.success && productsRes.data) setProductOptions(productsRes.data);
                if (purposesRes.success && purposesRes.data) setPurposeOptions(purposesRes.data);
            } finally {
                setLoanDetailsOptionsLoading(false);
            }
        }
    };

    const handleSaveLoanDetails = async () => {
        const productChanged = selectedProductId && selectedProductId !== c.requestedLoanProductId;
        const purposeChanged = selectedPurposeId && selectedPurposeId !== c.requestedLoanPurposeId;
        // Legacy/edited rows can have requestedLoanProductId set but requestedAmount
        // still null — re-applying the *same* product re-derives the amount (and
        // frequency) server-side, which otherwise leaves the member out of Loan
        // Indexation because first-loan.service.ts needs a requested amount.
        const needsAmountBackfill = !!selectedProductId && c.requestedAmount == null;
        if (!productChanged && !purposeChanged && !needsAmountBackfill) {
            setLoanDetailsDialogOpen(false);
            return;
        }
        setSavingLoanDetails(true);
        try {
            const res = await apiClient.patch(`/approval/clients/${c.clientId}/loan-details`, {
                ...((productChanged || needsAmountBackfill) ? { loanProductId: selectedProductId } : {}),
                ...(purposeChanged ? { loanPurposeId: selectedPurposeId } : {}),
            });
            if (res.success) {
                toast({ title: 'Loan details updated' });
                setLoanDetailsDialogOpen(false);
                fetchDetail(true);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to update loan details', variant: 'destructive' });
            }
        } finally {
            setSavingLoanDetails(false);
        }
    };

    const blockers = checklist.filter(i => !i.passed && i.severity === 'blocker');

    // Address & Contact field renderer — appends an inline "Proposed" annotation when
    // renewalProposedAddress carries a different value for this field, instead of a
    // separate comparison table elsewhere on the page (see that prop's doc comment).
    // Returns the plain current value (or null) when there's no proposed change, so
    // TR's own empty()/blocker-star logic keeps working exactly as it does outside a
    // renewal review.
    const addrCell = (key: string, current: string | number | null | undefined) => {
        const proposed = renewalProposedAddress?.[key];
        const currentStr = current == null ? '' : String(current);
        const changed = proposed != null && proposed !== '' && proposed !== currentStr;
        if (!changed) return current ?? null;
        return (
            <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>{current || '—'}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Proposed: {proposed}
                </span>
            </span>
        );
    };

    const activeStageIdx = getActiveStageIndex(approvalStatus);
    const cycleTrail = renewalCycleTrail
        ?? (dynamicWorkflowActive && workflowStages.length > 0 ? buildDynamicCycleTrail(c, workflowStages) : buildCycleTrail(c));
    // Dynamic workflow: the stage the client is waiting on right now (null at final/approved/rejected).
    const currentWorkflowStage = dynamicWorkflowActive ? stageForStatus(approvalStatus, workflowStages) : null;

    // All KYC docs — location_qr shown in Client Documents section. In a renewal review,
    // the renewal's own re-uploads replace the same-type enrollment image (see
    // renewalDocOverrides' doc comment); their ids are tracked to badge them "New".
    const renewalOverrideIds = new Set((renewalDocOverrides ?? []).map((o) => o.id));
    const allDocs: KYCDoc[] = (() => {
        const base: KYCDoc[] = c.kycDocuments || [];
        if (!renewalDocOverrides || renewalDocOverrides.length === 0) return base;
        const overrideTypes = new Set(renewalDocOverrides.map((o) => o.documentType));
        const asDoc = (o: NonNullable<typeof renewalDocOverrides>[number]): KYCDoc => ({
            id: o.id, documentType: o.documentType, documentNumber: null,
            fileUrl: o.fileUrl, fileName: o.fileName ?? '', fileSize: null, mimeType: null,
            status: 'PENDING_VERIFICATION',
            bmDecision: o.bmDecision ?? 'PENDING', bmRemark: null, bmReviewedAt: null, bmReviewer: null,
            amDecision: o.amDecision ?? 'PENDING', amRemark: null, amReviewedAt: null, amReviewer: null,
            qcDecision: o.qcDecision ?? 'PENDING', qcRemark: null, qcReviewedAt: null, qcReviewer: null,
            revisionNo: 1, retakeReason: o.retakeReason ?? null, uploadedBy: null, createdAt: '',
            stageDecisions: o.stageDecisions,
        });
        return [...base.filter((d) => !overrideTypes.has(d.documentType)), ...renewalDocOverrides.map(asDoc)];
    })();

    // Count documents that have not been individually reviewed yet for the active stage.
    // Plain computation, not useMemo — this whole section runs only after the loading
    // early-return above, so a hook here would be called conditionally (violates Rules of
    // Hooks) depending on whether that early return fired on a given render.
    let unreviewedDocsCount = 0;
    // Dynamic workflow: decisions are keyed by the acting stage's ROLE (any role).
    const levelRoleSlug = canLevelAction ? dynamicLevel?.roleSlug ?? null : null;
    if (levelRoleSlug) unreviewedDocsCount = allDocs.filter(d => docStageDecision(d, levelRoleSlug) === 'PENDING').length;
    else if (canBMAction) unreviewedDocsCount = allDocs.filter(d => d.bmDecision === 'PENDING').length;
    else if (canAMAction) unreviewedDocsCount = allDocs.filter(d => d.amDecision === 'PENDING').length;
    else if (canQCAction) unreviewedDocsCount = allDocs.filter(d => (d.qcDecision ?? 'PENDING') === 'PENDING').length;
    // ── Action label map for history items ──
    // Keys here are the auditAction values written to ClientApprovalHistory by the API.
    const ACTION_LABEL: Record<string, string> = {
        // BM stage actions (stored by action route as auditAction)
        BM_COMPLETED_REVIEW:  'Approved & Forwarded to AM',
        BM_RETAKE_DOCUMENT:   'Retake Requested',
        BM_REJECTED_CLIENT:   'Rejected',
        BM_DELETED_DOCUMENT:  'Document Deleted',
        BM_VERIFIED_DOCUMENT: 'Document Verified',
        BM_REJECTED_DOCUMENT: 'Document Rejected',
        // AM stage actions
        AM_APPROVED_CLIENT:   'Approved & Forwarded to QC',
        AM_RETAKE_DOCUMENT:   'Retake Requested',
        AM_REJECTED_CLIENT:   'Rejected',
        AM_DELETED_DOCUMENT:  'Document Deleted',
        AM_VERIFIED_DOCUMENT: 'Document Verified',
        AM_REJECTED_DOCUMENT: 'Document Rejected',
        // QC stage actions
        QC_VERIFIED_CLIENT:   'Verified & Forwarded to Admin',
        QC_REJECTED_CLIENT:   'Rejected',
        QC_RETAKE_CLIENT:     'Corrections Requested',
        QC_VERIFIED_DOCUMENT: 'Document Verified',
        QC_RETAKE_DOCUMENT:   'Retake Requested',
        QC_REJECTED_DOCUMENT: 'Document Rejected',
        // Final stage actions
        FINAL_APPROVED_CLIENT: 'Final Approved',
        FINAL_RETAKE_CLIENT:   'Retake Requested',
        FINAL_REJECTED_CLIENT: 'Rejected',
        // Dynamic level actions
        LEVEL_APPROVED:          'Approved & Forwarded',
        LEVEL_RETAKE_REQUESTED:  'Retake Requested',
        LEVEL_REJECTED:          'Rejected',
        LEVEL_RETAKE_DOCUMENT:   'Retake Requested',
        LEVEL_VERIFIED_DOCUMENT: 'Document Verified',
        LEVEL_DELETED_DOCUMENT:  'Document Deleted',
        LEVEL_REJECTED_DOCUMENT: 'Document Rejected',
        // FDO actions
        FDO_RESUBMITTED: 'Resubmitted by FDO',
        ENROLLED:        'Enrolled',
    };

    /** Stage a history entry belongs to, for the all-stages remarks panel. */
    const remarkStageLabel = (h: HistoryItem): string => {
        if (h.action.startsWith('FINAL_')) return 'Admin';
        if (h.action.startsWith('FDO_')) return 'FDO';
        if (workflowStages.length > 0) {
            const st = historyStage(h, workflowStages);
            if (st) return st.stageName;
        }
        const prefix = h.action.split('_')[0];
        if (prefix === 'BM' || prefix === 'AM' || prefix === 'QC') return prefix;
        if (h.action.startsWith('LEVEL_')) {
            let fromStatus: string | undefined;
            try { fromStatus = JSON.parse(h.previousState ?? '{}').approvalStatus; } catch { /* ignore */ }
            const key = fromStatus ? LEVEL_FROM_STATUS[fromStatus] : undefined;
            if (key) return key === 'FINAL' ? 'Admin' : key;
        }
        return h.performedBy?.role?.replace(/_/g, ' ') ?? 'Other';
    };

    // Every remark any stage has written (stage decisions + per-document reviews),
    // oldest first — shown to every stage and Admin, not just inside one stage's popup.
    const stageRemarkEntries: StageRemarkEntry[] = (() => {
        const embedded: HistoryItem[] = Array.isArray(c.approvalHistory) ? (c.approvalHistory as HistoryItem[]) : [];
        const seen = new Set<string>();
        const merged: HistoryItem[] = [];
        for (const h of [...stageHistory, ...embedded]) {
            if (h?.id && !seen.has(h.id)) { seen.add(h.id); merged.push(h); }
        }
        return merged
            .filter(h => h.remarks?.trim() && !AUTO_HISTORY_REMARK.test(h.remarks.trim()))
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map(h => {
                const doc = h.kycDocumentId ? allDocs.find(d => d.id === h.kycDocumentId) : undefined;
                return {
                    id: h.id,
                    stage: remarkStageLabel(h),
                    action: ACTION_LABEL[h.action] ?? h.action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()),
                    documentLabel: doc ? docTypeLabel(doc.documentType) : h.kycDocumentId ? 'Document' : null,
                    person: h.performedBy ? `${h.performedBy.firstName} ${h.performedBy.lastName}`.trim() : null,
                    employeeId: h.performedBy?.employeeId ?? null,
                    date: toDisplayDateTime(new Date(h.createdAt)),
                    remark: h.remarks!.trim(),
                };
            });
    })();

    /**
     * Build info for the stage popup.
     *
     * PRIMARY source: direct FK-joined fields on the Client record
     *   c.bmReviewedBy / c.bmReviewedAt / c.bmRemarks
     *   c.amReviewedBy / c.amReviewedAt / c.amRemarks
     *   c.qcVerifiedBy / c.qcVerifiedAt / c.qcRemarks
     *   c.finalReviewedBy / c.finalReviewedAt / c.finalRemarks
     *
     * These are set by the action route and returned by the client-detail API.
     * They work the same way as FDO's c.enrolledBy / c.createdAt.
     *
     * SECONDARY source: stageHistory (fetched fresh on every popup click)
     *   Adds the "Action Taken" label when a matching history entry exists.
     *
     * Action label FALLBACK: infer from approvalStatus when history is still loading.
     */
    const getStageInfo = (key: string): {
        person: string | null;
        employeeId: string | null;
        role: string | null;
        date: string | null;
        action: string | null;
        remarks: string | null;
    } => {
        // Merge: stageHistory (separate fresh fetch) + c.approvalHistory (embedded in
        // initial page load, available instantly even if separate fetch is slow/fails).
        // Both sources are DESC ordered (newest first) — deduplicate by id.
        const embeddedHistory: HistoryItem[] = Array.isArray(c.approvalHistory)
            ? (c.approvalHistory as HistoryItem[])
            : [];
        const seen = new Set<string>();
        const allHistory: HistoryItem[] = [];
        for (const h of [...stageHistory, ...embeddedHistory]) {
            if (h?.id && !seen.has(h.id)) { seen.add(h.id); allHistory.push(h); }
        }
        // .find() on DESC list returns most-recent matching entry
        const firstOf = (...actions: string[]) =>
            allHistory.find(h => actions.includes(h.action)) ?? null;

        // For dynamic-workflow clients, stage actions are stored as LEVEL_APPROVED.
        // Distinguish stages by previousState (most reliable) or by performer role.
        const levelApprovedByRole = (role: string) =>
            allHistory.find(h => h.action === 'LEVEL_APPROVED' && h.performedBy?.role === role) ?? null;

        // Find LEVEL_APPROVED where the client was previously in the given approvalStatus.
        // e.g. previousStatus='PENDING_QC_VERIFICATION' → that LEVEL_APPROVED is the QC approval.
        const levelApprovedFromStatus = (previousStatus: string) =>
            allHistory.find(h => {
                if (h.action !== 'LEVEL_APPROVED') return false;
                if (!h.previousState) return false;
                try {
                    return JSON.parse(h.previousState).approvalStatus === previousStatus;
                } catch { return false; }
            }) ?? null;

        const personFrom = (obj: { firstName: string; lastName: string } | null | undefined) =>
            obj ? `${obj.firstName} ${obj.lastName}`.trim() : null;

        // Infer action label from current approvalStatus when history hasn't loaded yet
        const inferBMAction = (): string | null => {
            const s = approvalStatus;
            if (['PENDING_AM_REVIEW','PENDING_QC_VERIFICATION','PENDING_FINAL_REVIEW','APPROVED'].includes(s))
                return 'Approved & Forwarded to AM';
            if (s === 'BM_RETAKE_REQUIRED') return 'Retake Requested';
            if (s === 'REJECTED' && c.bmReviewedAt && !c.amReviewedAt) return 'Rejected';
            return null;
        };
        const inferAMAction = (): string | null => {
            const s = approvalStatus;
            if (['PENDING_QC_VERIFICATION','PENDING_FINAL_REVIEW','APPROVED'].includes(s))
                return 'Approved & Forwarded to QC';
            if (s === 'AM_RETAKE_REQUIRED') return 'Retake Requested';
            if (s === 'REJECTED' && c.amReviewedAt && !c.qcVerifiedAt) return 'Rejected';
            return null;
        };
        const inferQCAction = (): string | null => {
            const s = approvalStatus;
            if (['PENDING_FINAL_REVIEW','APPROVED'].includes(s)) return 'Verified & Forwarded to Admin';
            if (s === 'QC_VERIFICATION_RETAKE_REQUIRED') return 'Corrections Requested';
            if (s === 'REJECTED' && c.qcVerifiedAt) return 'Rejected';
            // FDO already resubmitted after QC retake — status cycled back to BM/AM/SUBMITTED
            // but qcVerifiedAt is still set from the retake action.
            if (c.qcVerifiedAt) return 'Corrections Requested';
            return null;
        };
        const inferFinalAction = (): string | null => {
            if (approvalStatus === 'APPROVED') return 'Final Approved';
            if (approvalStatus === 'FINAL_RETAKE_REQUIRED') return 'Retake Requested';
            if (approvalStatus === 'REJECTED' && c.finalReviewedAt) return 'Rejected';
            return null;
        };

        if (key.startsWith('stage:')) {
            // Dynamic workflow stage (any role) — latest stage-level action recorded for it.
            const roleSlug = key.slice('stage:'.length);
            const stage = workflowStages.find(s => s.roleSlug === roleSlug);
            const nextStage = stage ? workflowStages.find(s => s.levelOrder === stage.levelOrder + 1) : undefined;
            const stageActions = ['LEVEL_APPROVED', 'LEVEL_RETAKE_REQUESTED', 'LEVEL_REJECTED', 'LEVEL_RETAKE_DOCUMENT',
                'BM_COMPLETED_REVIEW', 'BM_RETAKE_DOCUMENT', 'BM_REJECTED_CLIENT', 'AM_APPROVED_CLIENT', 'AM_RETAKE_DOCUMENT',
                'AM_REJECTED_CLIENT', 'QC_VERIFIED_CLIENT', 'QC_RETAKE_CLIENT', 'QC_RETAKE_DOCUMENT', 'QC_REJECTED_CLIENT'];
            const item = allHistory.find(h => stageActions.includes(h.action) && historyStage(h, workflowStages)?.roleSlug === roleSlug) ?? null;
            const action = !item ? null
                : item.action === 'LEVEL_APPROVED'
                    ? `Approved & Forwarded to ${nextStage?.stageName ?? 'Final Approval'}`
                    : (ACTION_LABEL[item.action] ?? item.action);
            return {
                person: personFrom(item?.performedBy),
                employeeId: item?.performedBy?.employeeId ?? null,
                role: item?.performedBy?.role ?? stage?.stageName ?? null,
                date: item?.createdAt ? toDisplayDateTime(new Date(item.createdAt)) : null,
                action,
                remarks: item?.remarks ?? null,
            };
        }

        switch (key) {
            case 'FDO':
                return {
                    person:     personFrom(c.enrolledBy),
                    employeeId: (c.enrolledBy?.employeeId as string | null) ?? null,
                    role:       (c.enrolledBy?.role as string | undefined) ?? 'FDO',
                    date:       c.createdAt ? toDisplayDateTime(new Date(c.createdAt)) : null,
                    action:     'Enrolled',
                    remarks:    null,
                };

            case 'BM': {
                // Legacy: BM_COMPLETED_REVIEW / BM_RETAKE_DOCUMENT / BM_REJECTED_CLIENT
                // Dynamic: LEVEL_APPROVED where previousState = SUBMITTED or PENDING_BM_REVIEW
                const item = firstOf('BM_COMPLETED_REVIEW', 'BM_RETAKE_DOCUMENT', 'BM_REJECTED_CLIENT')
                          ?? levelApprovedFromStatus('SUBMITTED')
                          ?? levelApprovedFromStatus('PENDING_BM_REVIEW')
                          ?? levelApprovedByRole('BRANCH_MANAGER');
                const person = personFrom(c.bmReviewedBy) ?? personFrom(item?.performedBy);
                const date   = c.bmReviewedAt
                    ? toDisplayDateTime(new Date(c.bmReviewedAt))
                    : item?.createdAt ? toDisplayDateTime(new Date(item.createdAt)) : null;
                const actionLabel = item
                    ? (item.action === 'LEVEL_APPROVED' ? 'Approved & Forwarded to AM' : (ACTION_LABEL[item.action] ?? item.action))
                    : inferBMAction();
                return {
                    person,
                    employeeId: (c.bmReviewedBy?.employeeId as string | null) ?? null,
                    role:    (c.bmReviewedBy?.role as string | undefined) ?? item?.performedBy?.role ?? 'BRANCH_MANAGER',
                    date,
                    action:  actionLabel,
                    remarks: (c.bmRemarks as string | null) ?? item?.remarks ?? null,
                };
            }

            case 'AM': {
                // Legacy: AM_APPROVED_CLIENT / AM_RETAKE_DOCUMENT / AM_REJECTED_CLIENT
                // Dynamic: LEVEL_APPROVED where previousState = PENDING_AM_REVIEW
                const item = firstOf('AM_APPROVED_CLIENT', 'AM_RETAKE_DOCUMENT', 'AM_REJECTED_CLIENT')
                          ?? levelApprovedFromStatus('PENDING_AM_REVIEW')
                          ?? levelApprovedByRole('AREA_MANAGER');
                const person = personFrom(c.amReviewedBy) ?? personFrom(item?.performedBy);
                const date   = c.amReviewedAt
                    ? toDisplayDateTime(new Date(c.amReviewedAt))
                    : item?.createdAt ? toDisplayDateTime(new Date(item.createdAt)) : null;
                const actionLabel = item
                    ? (item.action === 'LEVEL_APPROVED' ? 'Approved & Forwarded to QC' : (ACTION_LABEL[item.action] ?? item.action))
                    : inferAMAction();
                return {
                    person,
                    employeeId: (c.amReviewedBy?.employeeId as string | null) ?? null,
                    role:    (c.amReviewedBy?.role as string | undefined) ?? item?.performedBy?.role ?? 'AREA_MANAGER',
                    date,
                    action:  actionLabel,
                    remarks: (c.amRemarks as string | null) ?? item?.remarks ?? null,
                };
            }

            case 'QC': {
                // Legacy workflow: QC_VERIFIED_CLIENT / QC_REJECTED_CLIENT / QC_RETAKE_CLIENT
                //   Per-document QC retake logs QC_RETAKE_DOCUMENT (not QC_RETAKE_CLIENT).
                // Dynamic workflow: LEVEL_APPROVED where previousState = PENDING_QC_VERIFICATION
                const item = firstOf('QC_VERIFIED_CLIENT', 'QC_REJECTED_CLIENT', 'QC_RETAKE_CLIENT', 'QC_RETAKE_DOCUMENT')
                          ?? levelApprovedFromStatus('PENDING_QC_VERIFICATION');
                const person = personFrom(c.qcVerifiedBy) ?? personFrom(item?.performedBy);
                const date   = c.qcVerifiedAt
                    ? toDisplayDateTime(new Date(c.qcVerifiedAt))
                    : item?.createdAt ? toDisplayDateTime(new Date(item.createdAt)) : null;
                const actionLabel = item
                    ? (item.action === 'LEVEL_APPROVED' ? 'Verified & Forwarded to Admin' : (ACTION_LABEL[item.action] ?? item.action))
                    : inferQCAction();
                return {
                    person,
                    employeeId: (c.qcVerifiedBy?.employeeId as string | null) ?? null,
                    role:    (c.qcVerifiedBy?.role as string | undefined) ?? item?.performedBy?.role ?? null,
                    date,
                    action:  actionLabel,
                    remarks: (c.qcRemarks as string | null) ?? item?.remarks ?? null,
                };
            }

            case 'FINAL': {
                const item = firstOf('FINAL_APPROVED_CLIENT', 'FINAL_RETAKE_CLIENT', 'FINAL_REJECTED_CLIENT');
                const person = personFrom(c.finalReviewedBy) ?? personFrom(item?.performedBy);
                const date   = c.finalReviewedAt
                    ? toDisplayDateTime(new Date(c.finalReviewedAt))
                    : item?.createdAt ? toDisplayDateTime(new Date(item.createdAt)) : null;
                return {
                    person,
                    employeeId: (c.finalReviewedBy?.employeeId as string | null) ?? null,
                    role:    (c.finalReviewedBy?.role as string | undefined) ?? item?.performedBy?.role ?? 'ADMIN',
                    date,
                    action:  item ? (ACTION_LABEL[item.action] ?? item.action) : inferFinalAction(),
                    remarks: (c.finalRemarks as string | null) ?? item?.remarks ?? null,
                };
            }

            default:
                return { person: null, employeeId: null, role: null, date: null, action: null, remarks: null };
        }
    };

    // Doc card shared props. In a renewal review (hideKycAndChecklist) these are reference
    // images only — force every action flag off and hide the decision rows, regardless of
    // the viewer's own role/stage, since this grid isn't the renewal's own approval surface.
    const docCardProps = {
        canBMAction: canBMAction && !hideKycAndChecklist,
        canAMAction: canAMAction && !hideKycAndChecklist,
        canQCAction: canQCAction && !hideKycAndChecklist,
        canLevelAction: canLevelAction && !hideKycAndChecklist,
        levelRoleSlug: hideKycAndChecklist ? null : levelRoleSlug,
        dynamicWorkflowActive,
        hideDecisionStatus: !!hideKycAndChecklist,
        docRemarks, setDocRemarks, docActionLoading, handleDocReview, setPreviewDoc,
    };

    // Document pair renderer
    const renderDocPair = (left: KYCDoc | null, right: KYCDoc | null, key: string) => {
        if (!left && !right) return null;
        return (
            <div key={key} className="grid grid-cols-1 sm:grid-cols-2 border-b border-border last:border-b-0">
                <div className={cn('sm:border-r sm:border-border', !right && 'sm:col-span-2')}>
                    {left ? <DocImageCard doc={left} {...docCardProps} isRenewalNew={renewalOverrideIds.has(left.id)} renewalReview={renewalOverrideIds.has(left.id) ? renderRenewalDocReview?.(left.id) : undefined} /> : <div className="h-60" />}
                </div>
                {right && <DocImageCard doc={right} {...docCardProps} isRenewalNew={renewalOverrideIds.has(right.id)} renewalReview={renewalOverrideIds.has(right.id) ? renderRenewalDocReview?.(right.id) : undefined} />}
            </div>
        );
    };

    const find = (type: string) => allDocs.find(d => d.documentType === type) ?? null;
    // co_applicant_other_id is actually the co-applicant's Aadhaar (front) — see
    // app/lib/kyc-document-types.ts. Every type paired here must also be listed in
    // shownTypes below, otherwise it silently falls into "Other Documents" and the
    // same document appears to be listed twice under two different labels.
    const docPairs: Array<[KYCDoc | null, KYCDoc | null]> = [
        [find('client_photo'),        find('co_applicant_photo')],
        [find('aadhaar_front'),       find('aadhaar_back')],
        [find('co_applicant_other_id'), find('co_applicant_aadhaar_back')],
        [find('voter_id'),            find('co_applicant_voter_id')],
        [find('voter_id_back'),       find('co_applicant_voter_id_back')],
        [find('smart_card_front') ?? find('smart_card'), find('smart_card_back')],
        [find('house_image_1'),       find('location_qr')],
        [find('house_image_2'),       find('house_image_3')],
        [find('gas_bill'),            find('noc_image_1')],
        [find('noc_image_2'),         find('noc_image_3')],
    ];
    const shownTypes = new Set([
        'client_photo', 'co_applicant_photo',
        'aadhaar_front', 'aadhaar_back',
        'co_applicant_other_id', 'co_applicant_aadhaar_back',
        'voter_id', 'co_applicant_voter_id',
        'voter_id_back', 'co_applicant_voter_id_back',
        'smart_card_front', 'smart_card', 'smart_card_back',
        'house_image_1', 'house_image_2', 'house_image_3', 'location_qr',
        'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3',
    ]);
    const remainingDocs = allDocs.filter(d => !shownTypes.has(d.documentType));
    const hasDocPairs = docPairs.some(([a, b]) => a || b);

    return (
        <ChecklistContext.Provider value={isFailingBlocker}>
        <div className={cn('bg-muted/40 p-4 sm:p-6 print:bg-white print:p-0', !readOnly && 'min-h-screen')}>
            {/* Back button */}
            <div className="mb-4 flex items-center gap-3 print:hidden">
                {!readOnly && (
                    <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted">
                        <ArrowLeft className="h-4 w-4" /> Back
                    </button>
                )}
                <span className="text-sm text-muted-foreground">{c.firstName} {c.lastName} — <span className="font-medium text-foreground">{c.clientId}</span></span>
                {canEditClient && (
                    <button
                        onClick={() => setEditDialogOpen(true)}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10"
                    >
                        <Pencil className="h-4 w-4" /> Edit Client
                    </button>
                )}
            </div>

            {/* Edit Client dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="max-h-[90vh] w-[95vw] max-w-5xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Client — {c.firstName} {c.lastName} ({c.clientId})</DialogTitle>
                    </DialogHeader>
                    <KYCDetailsFlatForm
                        selectedClient={c.clientId}
                        clientData={c}
                        onSuccess={() => {
                            setEditDialogOpen(false);
                            fetchDetail(true);
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Edit Loan Details dialog */}
            <Dialog open={loanDetailsDialogOpen} onOpenChange={setLoanDetailsDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Edit Loan Details</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        {loanDetailsOptionsLoading ? (
                            <PageLoader label="Loading options…" fullScreen={false} />
                        ) : (
                            <>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-muted-foreground">Loan Product</label>
                                    <p className="text-xs text-muted-foreground">
                                        Current: <span className="font-medium text-foreground">{c.requestedLoanProduct?.productName || '—'}</span>
                                        {c.requestedAmount != null && <> · ₹{Number(c.requestedAmount).toLocaleString('en-IN')}</>}
                                    </p>
                                    <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a loan product" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {productOptions.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.productName} — ₹{Number(p.loanAmount).toLocaleString('en-IN')} ({p.frequency})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-[11px] text-muted-foreground">
                                        Changing the product also updates the requested amount and repayment frequency to match it.
                                    </p>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-muted-foreground">Loan Purpose</label>
                                    <p className="text-xs text-muted-foreground">
                                        Current: <span className="font-medium text-foreground">{c.requestedLoanPurpose?.name || '—'}</span>
                                    </p>
                                    <Select value={selectedPurposeId} onValueChange={setSelectedPurposeId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a loan purpose" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {purposeOptions.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.loanPurposeType?.name ? `${p.loanPurposeType.name} · ` : ''}{p.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setLoanDetailsDialogOpen(false)} disabled={savingLoanDetails}>Cancel</Button>
                            <Button onClick={handleSaveLoanDetails} disabled={savingLoanDetails || loanDetailsOptionsLoading}>
                                {savingLoanDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ════════════════ APPROVAL FORM ════════════════ */}
            <div className="mx-auto overflow-hidden rounded-2xl border border-border bg-card shadow-sm print:rounded-none print:border-0 print:shadow-none" style={{ maxWidth: '900px' }}>

                {/* ── Form Title ── */}
                <div className="bg-gradient-to-r from-primary to-sidebar-accent px-4 py-5 text-center text-primary-foreground">
                    <div className="text-lg font-bold uppercase tracking-widest">{companyNameFull}</div>
                    <div className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground/80">
                        {renewalCycleTrail ? 'Renewal Loan — Approval Review' : 'Client Enrollment — Approval Review Form'}
                    </div>
                </div>
                <div className="h-1 bg-secondary" />{/* accent strip — #feb902 */}

                {/* ── Stage Cycle Bar ── */}
                <div className="border-b border-border bg-muted/40 px-4 py-4">
                    <p className="mb-3 text-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Approval Workflow — Click a stage to view details</p>
                    <div className="flex items-center justify-center flex-wrap gap-y-3">
                        {cycleTrail.map((step, idx) => (
                            <Fragment key={`${step.key}-${idx}`}>
                                <button
                                    onClick={() => handleStageClick(step.key)}
                                    title={`Click to view ${step.key} approval info`}
                                    className={cn(
                                        'flex flex-col items-center justify-center rounded-xl border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide min-w-[80px] transition-colors',
                                        step.done ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-secondary bg-secondary/15 text-secondary-foreground',
                                    )}
                                >
                                    <span>{step.label}</span>
                                    <span className="text-[8px] font-normal normal-case mt-0.5 leading-none opacity-90">
                                        {step.person ?? (step.done ? '' : '○ Pending')}
                                    </span>
                                    {step.employeeId && (
                                        <span className="font-mono text-[7px] font-normal normal-case mt-0.5 leading-none opacity-80 bg-white/20 px-1 rounded">
                                            {step.employeeId}
                                        </span>
                                    )}
                                    {step.date && (
                                        <span className="text-[8px] font-normal normal-case mt-0.5 leading-none opacity-75">
                                            {toDisplayDate(new Date(step.date))}
                                        </span>
                                    )}
                                </button>
                                {idx < cycleTrail.length - 1 && (
                                    <ChevronRight className={cn('h-4 w-4 shrink-0', step.done ? 'text-primary' : 'text-muted-foreground/40')} />
                                )}
                            </Fragment>
                        ))}
                    </div>
                    {approvalStatus === 'REJECTED' && (
                        <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-widest text-destructive">★ REJECTED</p>
                    )}
                    {approvalStatus === 'APPROVED' && (
                        <p className="mt-2 text-center text-[11px] font-bold uppercase tracking-widest text-primary">★ APPROVED</p>
                    )}
                </div>

                {/* ── Header Info Row ── */}
                <table className="w-full border-collapse">
                    <tbody>
                        <TR label1="Application No." value1={c.clientId} label2="Application Date" value2={c.createdAt ? toDisplayDate(new Date(c.createdAt)) : '—'} />
                        <tr>
                            <td className="border border-border bg-muted px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground w-[22%]">Branch</td>
                            <td className="border border-border px-3 py-1.5 text-xs w-[28%] text-foreground">
                                {c.center?.branch
                                    ? `${c.center.branch.code ? `${c.center.branch.code} - ` : ''}${c.center.branch.name}`
                                    : '—'}
                            </td>
                            <td className="border border-border bg-muted px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground w-[22%]">Status</td>
                            <td className="border border-border px-3 py-1.5 text-xs font-bold">
                                <StatusPill status={approvalStatus} />
                            </td>
                        </tr>
                        <TR label1="Center" value1={c.center ? `${c.center.name}${c.center.code ? ` (${c.center.code})` : ''}` : '—'} label2="Group" value2={groups.length > 0 ? groups.map((g: any) => g.name).join(', ') : '—'} />
                    </tbody>
                </table>

                {/* ── Personal Details ── */}
                <SectionTable title="Personal Details">
                    <TR label1="First Name"    value1={c.firstName}   label2="Last Name"      value2={c.lastName} />
                    <TR label1="Gender"        value1={c.gender}      label2="Date of Birth"  value2={c.dateOfBirth ? toDisplayDate(new Date(c.dateOfBirth)) : null} />
                    <TR label1="Age"           value1={c.age}         label2="Marital Status" value2={c.maritalStatus} />
                    <TR label1="Father's Name" value1={c.fatherName}  label2="Mother's Name"  value2={c.motherName} />
                    <TR label1="Spouse Name"   value1={c.spouseName}  label2="No. of Children" value2={c.noOfChildren} />
                    <TR label1="Religion"      value1={c.religion}    label2="Caste"          value2={c.caste} />
                    <TR label1="Qualification" value1={c.qualification} label2="Economic Activity Type" value2={c.economicActivityType?.name} />
                    <TR label1="Economic Activity" value1={c.economicActivity?.name} label2="Spouse Economic Activity" value2={c.spouseEconomicActivity?.name} />
                </SectionTable>

                {/* ── Loan Details ── */}
                <SectionTable title="Loan Details">
                    {renewalLoanOverride ? (
                        <>
                            <TR
                                label1="Product"
                                value1={
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span>{renewalLoanOverride.productName || '—'}</span>
                                        {renewalLoanOverride.canChangeProduct && (
                                            <button
                                                type="button"
                                                onClick={renewalLoanOverride.onChangeProduct}
                                                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 print:hidden"
                                            >
                                                <Pencil className="h-3 w-3" /> Change
                                            </button>
                                        )}
                                    </div>
                                }
                                label2="Amount"
                                value2={`₹${renewalLoanOverride.amount.toLocaleString('en-IN')}`}
                            />
                            <TR label1="Interest" value1={`${renewalLoanOverride.interestRate}%`} label2="Tenure" value2={`${renewalLoanOverride.tenureMonths} mo`} />
                            <TR label1="Frequency" value1={renewalLoanOverride.frequency} label2="Purpose" value2={renewalLoanOverride.purposeName} />
                        </>
                    ) : (
                        <>
                            <TR
                                label1="Product Type"
                                value1={c.requestedLoanProductType?.name}
                                label2="Product"
                                value2={
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span>{c.requestedLoanProduct?.productName || '—'}</span>
                                        {canEditLoanDetails && (
                                            <button
                                                type="button"
                                                onClick={openLoanDetailsDialog}
                                                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 print:hidden"
                                            >
                                                <Pencil className="h-3 w-3" /> Edit
                                            </button>
                                        )}
                                    </div>
                                }
                            />
                            <TR
                                label1="Amount"
                                value1={c.requestedAmount != null ? `₹${Number(c.requestedAmount).toLocaleString('en-IN')}` : null}
                                label2="Frequency"
                                value2={c.requestedLoanFrequency}
                            />
                            <TR
                                label1="Purpose Type"
                                value1={c.requestedLoanPurposeType?.name}
                                label2="Purpose"
                                value2={
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span>{c.requestedLoanPurpose?.name || '—'}</span>
                                        {canEditLoanDetails && (
                                            <button
                                                type="button"
                                                onClick={openLoanDetailsDialog}
                                                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 print:hidden"
                                            >
                                                <Pencil className="h-3 w-3" /> Edit
                                            </button>
                                        )}
                                    </div>
                                }
                            />
                        </>
                    )}
                </SectionTable>

                {/* ── Address & Contact ── */}
                <SectionTable title="Address & Contact">
                    <tr>
                        <td className="border border-border px-3 py-1.5 text-[10px] font-bold uppercase bg-muted text-muted-foreground w-[22%]">Address</td>
                        <td className="border border-border px-3 py-1.5 text-xs text-foreground" colSpan={3}>{addrCell('permanentAddress', c.permanentAddress)}</td>
                    </tr>
                    <TR label1="Post Office" value1={addrCell('postOffice', c.postOffice)} label2="District" value2={addrCell('district', c.district)} />
                    <TR label1="State"       value1={addrCell('state', c.state)}      label2="Pincode"  value2={addrCell('pincode', c.pincode)} />
                    <TR label1="Phone"       value1={c.phone}      label2="Mobile"   value2={c.mobileNumber} />
                    <TR label1="Email"       value1={c.email}      label2="Country"  value2={addrCell('country', c.country)} />
                </SectionTable>

                {/* ── Co-Applicant (conditional) — doubles as Nominee, same person ── */}
                {c.coApplicant && (
                    <SectionTable title="Co-Applicant / Nominee Details">
                        <TR label1="Name"         value1={c.coApplicant.name}               label2="Relation"           value2={c.coApplicant.relationWithClient} />
                        <TR label1="Gender"        value1={c.coApplicant.gender}             label2="Age"                value2={c.coApplicant.age} />
                        <TR label1="Date of Birth" value1={c.coApplicant.dateOfBirth ? toDisplayDate(new Date(c.coApplicant.dateOfBirth)) : null} label2="Mobile" value2={c.coApplicant.mobileNumber} />
                        <TR label1="PAN"           value1={c.coApplicant.pancardNo}          label2="Voter ID"           value2={c.coApplicant.voterIdNo} />
                        <TR label1="Economic Activity Type" value1={c.coApplicant.economicActivityType?.name} label2="Economic Activity" value2={c.coApplicant.economicActivity?.name} />
                    </SectionTable>
                )}

                {/* ── Banking ── */}
                <SectionTable title="Banking Details">
                    <TR label1="Bank Name"   value1={c.bankName}   label2="Branch"      value2={c.bankBranch} />
                    <TR label1="IFSC Code"   value1={c.ifscCode}   label2="Account No." value2={c.bankAcNo} />
                    <TR label1="PAN Card No." value1={c.pancardNo} label2="Voter ID No." value2={c.votersIdNo} />
                </SectionTable>

                {/* ════ LOCATION ════ */}
                <div className="border-t border-border">
                    <div className="border-b border-border border-l-4 border-l-primary bg-muted px-3 py-2 flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">Member Location</span>
                        {overrideLocation && (
                            <span className="ml-auto inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                                Proposed for this renewal
                            </span>
                        )}
                        {!overrideLocation && c.locationApprovalStatus && (
                            <span className={cn(
                                'ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                c.locationApprovalStatus === 'APPROVED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                                c.locationApprovalStatus === 'REJECTED' ? 'border-red-200 bg-red-50 text-red-700' :
                                c.locationApprovalStatus === 'RELOCATION_REQUESTED' ? 'border-blue-200 bg-blue-50 text-blue-700' :
                                'border-amber-200 bg-amber-50 text-amber-700'
                            )}>
                                {c.locationApprovalStatus.replace(/_/g, ' ')}
                            </span>
                        )}
                    </div>
                    <table className="w-full border-collapse">
                        <tbody>
                            <TR label1="Latitude"  value1={displayLatitude  != null ? String(displayLatitude.toFixed(6))  : '—'}
                                label2="Longitude" value2={displayLongitude != null ? String(displayLongitude.toFixed(6)) : '—'} />
                            {displayLatitude != null && displayLongitude != null && c.center?.latitude != null && c.center?.longitude != null && (() => {
                                if (centerDrivingDistance.isLoading) {
                                    return (
                                        <tr>
                                            <td className="border border-border bg-muted px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground w-[22%]">Distance from Center</td>
                                            <td className="border border-border px-3 py-1.5 text-xs text-muted-foreground" colSpan={3}>
                                                Calculating road distance…
                                            </td>
                                        </tr>
                                    );
                                }
                                if (centerDrivingDistance.distanceMeters == null) return null;
                                const centerDistanceM = centerDrivingDistance.distanceMeters;
                                const withinCenterRange = centerDistanceM <= CENTER_MATCH_RADIUS_METERS;
                                const distLabel = centerDistanceM < 1000 ? `${Math.round(centerDistanceM)} m` : `${(centerDistanceM / 1000).toFixed(2)} km`;
                                const limitLabel = CENTER_MATCH_RADIUS_METERS < 1000 ? `${CENTER_MATCH_RADIUS_METERS} m` : `${(CENTER_MATCH_RADIUS_METERS / 1000).toFixed(2)} km`;
                                return (
                                    <tr>
                                        <td className="border border-border bg-muted px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground w-[22%]">Distance from Center</td>
                                        <td className={cn('border border-border px-3 py-1.5 text-xs font-semibold', withinCenterRange ? 'text-emerald-700' : 'text-red-700')} colSpan={3}>
                                            {distLabel} {withinCenterRange ? `— within ${limitLabel} ✓` : `— exceeds ${limitLabel} limit ✗`}
                                        </td>
                                    </tr>
                                );
                            })()}
                            {c.locationApprovalRemarks && (
                                <tr>
                                    <td className="border border-border bg-muted px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground w-[22%]">Approval Remarks</td>
                                    <td className="border border-border px-3 py-1.5 text-xs" colSpan={3}>{c.locationApprovalRemarks}</td>
                                </tr>
                            )}
                            {c.locationApprovalStatus === 'RELOCATION_REQUESTED' && c.pendingLatitude != null && (
                                <>
                                    <TR label1="Pending Lat" value1={String(c.pendingLatitude.toFixed(6))}
                                        label2="Pending Lng"  value2={c.pendingLongitude != null ? String(c.pendingLongitude.toFixed(6)) : '—'} />
                                    {c.relocationRemarks && (
                                        <tr>
                                            <td className="border border-border bg-muted px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground w-[22%]">Relocation Reason</td>
                                            <td className="border border-border px-3 py-1.5 text-xs" colSpan={3}>{c.relocationRemarks}</td>
                                        </tr>
                                    )}
                                </>
                            )}
                        </tbody>
                    </table>

                </div>

                {/* ════ KYC DOCUMENTS ════ — every enrollment doc type shows here (also in a
                    renewal review); hideKycAndChecklist only suppresses the per-document
                    BM/AM/QC decision chrome on each card (see docCardProps below), not the
                    images themselves. */}
                <div className="border-t border-border">
                    {/* Section heading */}
                    <div className="border-b border-border border-l-4 border-l-secondary bg-muted px-3 py-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                            KYC Documents ({allDocs.length})
                        </span>
                    </div>

                    {allDocs.length === 0 ? (
                        <p className="text-center py-8 text-sm text-muted-foreground">No KYC documents uploaded.</p>
                    ) : (
                        <>
                            {/* Member + co-applicant docs, paired side by side */}
                            {hasDocPairs && (
                                <>
                                    <div className="border-b border-border bg-muted/50 px-3 py-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Member &amp; Co-Applicant Documents</span>
                                    </div>
                                    {docPairs.map(([a, b], i) => renderDocPair(a, b, `p-${i}`))}
                                </>
                            )}

                            {/* Other docs */}
                            {remainingDocs.length > 0 && (
                                <>
                                    <div className="border-b border-t border-border bg-muted/50 px-3 py-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Other Documents</span>
                                    </div>
                                    {Array.from({ length: Math.ceil(remainingDocs.length / 2) }, (_, i) =>
                                        renderDocPair(remainingDocs[i * 2] ?? null, remainingDocs[i * 2 + 1] ?? null, `o-${i}`)
                                    )}
                                </>
                            )}
                        </>
                    )}
                </div>

                {/* ════ RENEWAL-SPECIFIC CONTENT ════ (Co-Applicant / "Uploaded for This
                    Renewal" / Approval Trail / stage-action bar) — folded in here, as one
                    more section of this same card, instead of a second bordered card
                    stacked below it (see renewalExtraContent's doc comment). */}
                {renewalExtraContent && (
                    <div className="border-t border-border p-4 sm:p-6 space-y-5 print:hidden">
                        {renewalExtraContent}
                    </div>
                )}

                {/* Stage-pending notice for Admin — tells them who needs to act next
                    instead of silently showing no buttons (previously Admin could
                    jump straight in via the legacy BM/AM override and unknowingly
                    only complete that one stage instead of finalizing). */}
                {!canAct && !readOnly && !hideKycAndChecklist && dynamicWorkflowActive && currentWorkflowStage && (
                    <div className="border-t border-border p-4 print:hidden">
                        <div className="flex items-start gap-2 rounded-lg border border-secondary/40 bg-secondary/10 px-3 py-2 text-xs text-foreground">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-secondary-foreground" />
                            <span>
                                {approvalStatus === currentWorkflowStage.retakeStatus
                                    ? `Retake requested by ${currentWorkflowStage.stageName} — waiting for the FDO to re-upload and resubmit. The member then restarts from ${workflowStages[0]?.stageName ?? 'the first stage'}.`
                                    : `${currentWorkflowStage.stageName} Pending — this member is waiting for ${currentWorkflowStage.stageName} (level ${currentWorkflowStage.levelOrder} of ${workflowStages.length}) before it can move on.`}
                            </span>
                        </div>
                    </div>
                )}

                {/* ════ REMARKS FROM ALL STAGES ════ — the member's enrollment-approval
                    remarks; a renewal review shows its own renewal remarks instead. */}
                {!hideKycAndChecklist && <StageRemarksPanel entries={stageRemarkEntries} />}

                {/* ════ BLOCKERS & CHECKLIST — shown before action panel ════ (also
                    reference-only in a renewal review — suppressed alongside the KYC grid) */}
                {!hideKycAndChecklist && checklist.length > 0 && (
                    <div className="border-t border-border">
                        {/* Section header */}
                        <div className="border-b border-border border-l-4 border-l-secondary bg-muted px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">Approval Checklist</span>
                            <div className="flex items-center gap-3 text-[10px]">
                                <span className="flex items-center gap-1 font-bold text-primary">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {checklist.filter(i => i.passed).length} Passed
                                </span>
                                <span className="flex items-center gap-1 font-bold text-destructive">
                                    <span className="font-black">✗</span>
                                    {blockers.length} Blocker{blockers.length !== 1 ? 's' : ''}
                                </span>
                                {checklist.filter(i => !i.passed && i.severity === 'warning').length > 0 && (
                                    <span className="flex items-center gap-1 font-bold text-secondary-foreground">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        {checklist.filter(i => !i.passed && i.severity === 'warning').length} Warning{checklist.filter(i => !i.passed && i.severity === 'warning').length !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Checklist table */}
                        <table className="w-full border-collapse">
                            <thead>
                                <tr>
                                    <th className="border border-border px-2 py-1.5 text-[10px] font-bold uppercase bg-muted/60 text-muted-foreground text-left w-8">#</th>
                                    <th className="border border-border px-2 py-1.5 text-[10px] font-bold uppercase bg-muted/60 text-muted-foreground text-left">Checklist Item</th>
                                    <th className="border border-border px-2 py-1.5 text-[10px] font-bold uppercase bg-muted/60 text-muted-foreground text-center w-24">Severity</th>
                                    <th className="border border-border px-2 py-1.5 text-[10px] font-bold uppercase bg-muted/60 text-muted-foreground text-center w-24">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Failed blockers first, then warnings, then passed */}
                                {[
                                    ...checklist.filter(i => !i.passed && i.severity === 'blocker'),
                                    ...checklist.filter(i => !i.passed && i.severity === 'warning'),
                                    ...checklist.filter(i => i.passed),
                                ].map((item, idx) => (
                                    <tr key={item.key} className={cn(
                                        !item.passed && item.severity === 'blocker' ? 'bg-destructive/5' :
                                        !item.passed && item.severity === 'warning' ? 'bg-secondary/10' :
                                        'bg-card'
                                    )}>
                                        <td className="border border-border px-2 py-1.5 text-[10px] text-center text-muted-foreground">
                                            {idx + 1}
                                        </td>
                                        <td className="border border-border px-2 py-1.5 text-xs flex items-center gap-2">
                                            {!item.passed && item.severity === 'blocker' && (
                                                <span className="text-destructive font-black text-sm leading-none shrink-0">*</span>
                                            )}
                                            {!item.passed && item.severity === 'warning' && (
                                                <span className="text-secondary-foreground font-bold text-sm leading-none shrink-0">⚠</span>
                                            )}
                                            {item.passed && (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                                            )}
                                            <span className={cn(!item.passed && item.severity === 'blocker' && 'font-medium text-foreground')}>{item.label}</span>
                                        </td>
                                        <td className="border border-border px-2 py-1.5 text-center">
                                            <span className={cn(
                                                'text-[10px] font-bold uppercase tracking-wide',
                                                item.severity === 'blocker' ? 'text-foreground' : 'text-muted-foreground'
                                            )}>
                                                {item.severity}
                                            </span>
                                        </td>
                                        <td className="border border-border px-2 py-1.5 text-center">
                                            {item.passed ? (
                                                <span className="text-[10px] font-bold uppercase tracking-wide text-primary">✓ OK</span>
                                            ) : (
                                                <span className={cn(
                                                    'text-[10px] font-bold uppercase tracking-wide',
                                                    item.severity === 'blocker' ? 'text-destructive' : 'text-secondary-foreground'
                                                )}>
                                                    {item.severity === 'blocker' ? '✗ Fail' : '⚠ Warn'}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* ════ ACTION PANEL — after checklist ════ */}
                {canAct && (
                    <div className="border-t border-border bg-muted/30 p-5 print:hidden">
                        {/* Panel title */}
                        <div className="mb-3 inline-flex rounded-lg border border-secondary/50 bg-secondary/10 px-3 py-1.5 shadow-sm">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-primary">
                                {canLevelAction ? `${dynamicLevel!.stageName} Decision`
                                    : canBMAction    ? 'Branch Manager (BM) Decision'
                                    : canAMAction    ? 'Area Manager (AM) Decision'
                                    : canQCAction    ? 'Background Verification (QC) Decision'
                                    : 'Final Admin Approval Decision'}
                            </span>
                        </div>

                        {/* Blockers warning — brief inline notice only */}
                        {blockers.length > 0 && !canQCAction && (
                            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                                <p className="text-xs font-medium text-foreground">
                                    {blockers.length} blocker(s) unresolved — review the checklist above before approving.
                                </p>
                            </div>
                        )}

                        {/* Remarks */}
                        <Textarea
                            placeholder="Remarks — required for Retake / Reject actions…"
                            value={stageRemarks}
                            onChange={e => setStageRemarks(e.target.value)}
                            className="h-20 resize-none text-sm border border-input rounded-lg mb-4 bg-card focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                            disabled={actionLoading}
                        />

                        {/* Waiting-for-FDO notice — shown when QC (or any reviewer) has requested
                            a retake and the client is awaiting FDO's re-upload. No action
                            buttons are available at this stage; the client re-enters the
                            queue as PENDING_QC_VERIFICATION once FDO resubmits. */}
                        {isQCTeam && approvalStatus === 'QC_VERIFICATION_RETAKE_REQUIRED' && (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 mb-4">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                <div className="text-sm text-amber-800 dark:text-amber-300">
                                    <p className="font-semibold">Corrections Requested — Awaiting FDO Re-upload</p>
                                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                                        The client has been sent back to the FDO for document re-upload.
                                        {dynamicWorkflowActive
                                            ? <>After FDO resubmits, every stage reviews the member again starting from <strong>{workflowStages[0]?.stageName ?? 'the first stage'}</strong>.</>
                                            : <>After FDO resubmits, the client will go through <strong>BM → AM → QC</strong> review
                                        again before returning to your queue as <strong>Pending QC</strong>.</>}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Unreviewed Documents Notice */}
                        {unreviewedDocsCount > 0 && canAct && (
                            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-4 py-3 mb-4 text-xs text-amber-900 dark:text-amber-200">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="font-bold">Individual Document Verification Required ({unreviewedDocsCount} Pending)</p>
                                    <p className="mt-0.5">
                                        All KYC documents must be explicitly inspected and verified individually above before approving the member application.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-3">
                            {/* BM */}
                            {canBMAction && !canLevelAction && (<>
                                <ActionBtn primary loading={actionLoading} disabled={blockers.length > 0 || unreviewedDocsCount > 0} onClick={() => handleStageAction('BM_SUBMIT_TO_AM')}>
                                    <Send className="h-4 w-4" /> Approve &amp; Forward to AM
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('BM_RETAKE')}>
                                    <RotateCcw className="h-4 w-4" /> Request Retake
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('BM_REJECT')}>
                                    <Ban className="h-4 w-4" /> Reject
                                </ActionBtn>
                            </>)}

                            {/* AM/FM */}
                            {canAMAction && !canLevelAction && (<>
                                <ActionBtn primary loading={actionLoading} disabled={blockers.length > 0 || unreviewedDocsCount > 0} onClick={() => handleStageAction('AM_APPROVE')}>
                                    <Send className="h-4 w-4" /> Approve &amp; Forward to QC
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('AM_RETAKE')}>
                                    <RotateCcw className="h-4 w-4" /> Request Retake
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('AM_REJECT')}>
                                    <Ban className="h-4 w-4" /> Reject
                                </ActionBtn>
                            </>)}

                            {/* QC */}
                            {canQCAction && !canLevelAction && (<>
                                <ActionBtn primary loading={actionLoading} disabled={unreviewedDocsCount > 0} onClick={() => handleStageAction('QC_VERIFY_APPROVE')}>
                                    <CheckCheck className="h-4 w-4" /> Verify &amp; Forward to Admin
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('QC_VERIFY_RETAKE')}>
                                    <RotateCcw className="h-4 w-4" /> Request Corrections
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('QC_VERIFY_REJECT')}>
                                    <Ban className="h-4 w-4" /> Reject
                                </ActionBtn>
                            </>)}

                            {/* Final Admin */}
                            {canFinalAction && (<>
                                <ActionBtn primary loading={actionLoading} disabled={blockers.length > 0} onClick={() => handleStageAction('FINAL_APPROVE')}>
                                    <CheckCheck className="h-4 w-4" /> Final Approve
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('FINAL_RETAKE')}>
                                    <RotateCcw className="h-4 w-4" /> Request Retake
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('FINAL_REJECT')}>
                                    <Ban className="h-4 w-4" /> Reject
                                </ActionBtn>
                            </>)}

                            {/* Dynamic Level */}
                            {canLevelAction && (<>
                                <ActionBtn primary loading={actionLoading} disabled={blockers.length > 0 || unreviewedDocsCount > 0} onClick={() => handleStageAction('LEVEL_APPROVE')}>
                                    <Send className="h-4 w-4" />
                                    {dynamicLevel!.nextStageName ? `Forward to ${dynamicLevel!.nextStageName}` : 'Forward to Final Approval'}
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('LEVEL_RETAKE')}>
                                    <RotateCcw className="h-4 w-4" /> Request Retake
                                </ActionBtn>
                                <ActionBtn loading={actionLoading} onClick={() => handleStageAction('LEVEL_REJECT')}>
                                    <Ban className="h-4 w-4" /> Reject
                                </ActionBtn>
                            </>)}
                        </div>
                    </div>
                )}
            </div>
            {/* End A4 form */}

            {/* ── Stage Info Popup ── */}
            <Dialog open={!!selectedStageKey} onOpenChange={v => { if (!v) setSelectedStageKey(null); }}>
                <DialogContent className="max-w-sm rounded-2xl border border-border p-0 gap-0 overflow-hidden">
                    <DialogHeader className="border-b border-border bg-muted/50 px-4 py-3">
                        <DialogTitle className="text-sm font-bold uppercase tracking-wide text-foreground">
                            {selectedStageKey?.startsWith('stage:')
                                ? workflowStages.find(s => `stage:${s.roleSlug}` === selectedStageKey)?.stageName
                                : STAGE_CYCLE.find(s => s.key === selectedStageKey)?.label} — {renewalStageDetails ? 'Image Approvals' : 'Approval Details'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="p-4">
                        {(() => {
                            if (!selectedStageKey) return null;
                            // Renewal review: show what THIS stage did to the re-uploaded
                            // house/co-applicant images, not the member's (unrelated)
                            // enrollment-time approval detail.
                            if (renewalStageDetails) {
                                return renewalStageDetails[selectedStageKey as 'FDO' | 'BM' | 'AM' | 'QC' | 'FINAL']
                                    ?? <p className="text-xs text-muted-foreground">No image approvals recorded for this stage yet.</p>;
                            }
                            const info = getStageInfo(selectedStageKey);
                            // hasData is true when ANY of person / date / action is available.
                            // action is ALWAYS inferable from approvalStatus for completed stages,
                            // so this guarantees the popup shows something after approval even
                            // if the reviewer FK fields are unexpectedly null.
                            const hasData = !!(info.person || info.date || info.action);

                            return (
                                <div className="space-y-3">
                                    {/* Subtle loading indicator — does NOT block showing data */}
                                    {stageHistoryLoading && (
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            Refreshing history…
                                        </div>
                                    )}

                                    <table className="w-full border-collapse text-xs">
                                        <tbody>
                                            {hasData ? (
                                                <>
                                                    {/* Action taken */}
                                                    {info.action && (
                                                        <tr>
                                                            <td className="border border-border px-2 py-1.5 font-bold bg-muted text-muted-foreground w-2/5 align-top">
                                                                Action Taken
                                                            </td>
                                                            <td className="border border-border px-2 py-1.5 font-semibold text-primary">
                                                                {info.action}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {/* Performed By + role */}
                                                    <tr>
                                                        <td className="border border-border px-2 py-1.5 font-bold bg-muted text-muted-foreground w-2/5 align-top">
                                                            Performed By
                                                        </td>
                                                        <td className="border border-border px-2 py-1.5">
                                                            {info.person || '—'}
                                                            {info.employeeId && (
                                                                <span className="ml-1.5 font-mono text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded text-foreground">
                                                                    {info.employeeId}
                                                                </span>
                                                            )}
                                                            {info.role && (
                                                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    ({info.role.replace(/_/g, ' ')})
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {/* Date & Time */}
                                                    <tr>
                                                        <td className="border border-border px-2 py-1.5 font-bold bg-muted text-muted-foreground align-top">
                                                            Date &amp; Time
                                                        </td>
                                                        <td className="border border-border px-2 py-1.5">
                                                            {info.date || '—'}
                                                        </td>
                                                    </tr>
                                                    {/* Remarks (conditional) */}
                                                    {info.remarks && (
                                                        <tr>
                                                            <td className="border border-border px-2 py-1.5 font-bold bg-muted text-muted-foreground align-top">
                                                                Remarks
                                                            </td>
                                                            <td className="border border-border px-2 py-1.5">
                                                                {info.remarks}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            ) : stageHistoryLoading ? (
                                                /* Still fetching — show skeleton rows */
                                                <>
                                                    {['Action Taken', 'Performed By', 'Date & Time'].map(lbl => (
                                                        <tr key={lbl}>
                                                            <td className="border border-border px-2 py-1.5 font-bold bg-muted text-muted-foreground w-2/5">{lbl}</td>
                                                            <td className="border border-border px-2 py-1.5">
                                                                <span className="inline-block h-3 w-32 animate-pulse rounded bg-muted" />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </>
                                            ) : (() => {
                                                // Determine if this stage is in the future or simply not recorded
                                                let isPending: boolean;
                                                if (dynamicWorkflowActive && workflowStages.length > 0) {
                                                    // Dynamic: compare configured levels (FDO = 0, Final = after all stages).
                                                    const orderOf = (k: string) => k === 'FDO' ? 0
                                                        : k === 'FINAL' ? workflowStages.length + 1
                                                        : workflowStages.find(s => `stage:${s.roleSlug}` === k)?.levelOrder ?? -1;
                                                    const currentOrder = approvalStatus === 'APPROVED' ? workflowStages.length + 2
                                                        : approvalStatus === 'PENDING_FINAL_REVIEW' || approvalStatus === 'FINAL_RETAKE_REQUIRED' ? workflowStages.length + 1
                                                        : currentWorkflowStage?.levelOrder ?? 0;
                                                    isPending = orderOf(selectedStageKey ?? '') > currentOrder;
                                                } else {
                                                    const stageOrder: Record<string, number> = { FDO: 0, BM: 1, AM: 2, QC: 3, FINAL: 4 };
                                                    const thisOrder  = stageOrder[selectedStageKey ?? ''] ?? -1;
                                                    isPending  = thisOrder > activeStageIdx;
                                                }
                                                return (
                                                    <tr>
                                                        <td colSpan={2} className="border border-border px-2 py-4 text-center text-muted-foreground text-xs">
                                                            {isPending
                                                                ? '○ This stage has not been reached yet.'
                                                                : 'No approval recorded for this stage yet.'}
                                                        </td>
                                                    </tr>
                                                );
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })()}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Document Preview Modal */}
            <DocumentPreviewModal
                doc={previewDoc}
                client={c}
                open={Boolean(previewDoc)}
                onClose={() => setPreviewDoc(null)}
            />
        </div>
        </ChecklistContext.Provider>
    );
}

// ─── Helper: table row ────────────────────────────────────────────────────────
// Shows a red * after the label ONLY when the field:
//   (a) matches a failing blocker in the checklist, AND
//   (b) has no data.
// If data exists the * is automatically removed (checklist item passes → matcher returns false).

function TR({ label1, value1, label2, value2 }: { label1: string; value1: any; label2: string; value2: any }) {
    const isFailing = useContext(ChecklistContext);
    const empty = (v: any) => v === null || v === undefined || v === '';
    const showStar1 = isFailing(label1) && empty(value1);
    const showStar2 = isFailing(label2) && empty(value2);
    return (
        <tr>
            <td className="border border-border px-3 py-1.5 text-[10px] font-bold uppercase bg-muted text-muted-foreground w-[22%] leading-snug">
                {label1}
                {showStar1 && <span className="text-destructive font-black ml-0.5 not-italic normal-case">*</span>}
            </td>
            <td className="border border-border px-3 py-1.5 text-xs w-[28%] text-foreground">{empty(value1) ? '—' : value1}</td>
            <td className="border border-border px-3 py-1.5 text-[10px] font-bold uppercase bg-muted text-muted-foreground w-[22%] leading-snug">
                {label2}
                {showStar2 && <span className="text-destructive font-black ml-0.5 not-italic normal-case">*</span>}
            </td>
            <td className="border border-border px-3 py-1.5 text-xs w-[28%] text-foreground">{empty(value2) ? '—' : value2}</td>
        </tr>
    );
}

// ─── Helper: section table wrapper ───────────────────────────────────────────
function SectionTable({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <table className="w-full border-collapse">
            <thead>
                <tr>
                    <th colSpan={4} className="border border-border border-l-4 border-l-secondary px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-muted text-primary text-left">
                        {title}
                    </th>
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    );
}

// ─── Helper: status pill (approval status header badge) ──────────────────────
function StatusPill({ status }: { status: string }) {
    const tone =
        status === 'APPROVED' ? 'bg-primary/10 text-primary border-primary/30' :
        status === 'REJECTED' ? 'bg-destructive/10 text-destructive border-destructive/30' :
        status.includes('RETAKE') ? 'bg-secondary/15 text-secondary-foreground border-secondary/40' :
        'bg-muted text-muted-foreground border-border';
    return (
        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', tone)}>
            {status.replace(/_/g, ' ')}
        </span>
    );
}

// ─── Helper: action button ────────────────────────────────────────────────────
function ActionBtn({ primary, loading, disabled, onClick, children }: {
    primary?: boolean; loading?: boolean; disabled?: boolean;
    onClick: () => void; children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            disabled={loading || disabled}
            className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold uppercase tracking-wide disabled:opacity-40 transition-colors shadow-sm',
                primary ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90' : 'border-input bg-card text-foreground hover:bg-muted',
            )}
        >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
        </button>
    );
}

// ─── KYC Document Image Card ──────────────────────────────────────────────────
type DocImageCardProps = {
    doc: KYCDoc;
    canBMAction: boolean; canAMAction: boolean; canQCAction: boolean; canLevelAction: boolean;
    /** Dynamic workflow: the acting stage's role slug — its decision slot on each document. */
    levelRoleSlug?: string | null;
    /** Dynamic workflow active — show every configured stage's decision instead of BM/AM/QC. */
    dynamicWorkflowActive?: boolean;
    /** Renewal-review reference mode — show the image and its caption only, no BM/AM/QC
     *  decision rows, remarks, or review actions (see hideKycAndChecklist's doc comment). */
    hideDecisionStatus?: boolean;
    /** This image is a Renewal Loan's own re-upload shown in place of the enrollment one. */
    isRenewalNew?: boolean;
    /** This renewal's own status + review controls for the image, shown right under it. */
    renewalReview?: React.ReactNode;
    docRemarks: Record<string, string>;
    setDocRemarks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    docActionLoading: string | null;
    handleDocReview: (docId: string, decision: string) => Promise<void>;
    setPreviewDoc: (doc: KYCDoc | null) => void;
};

function DocImageCard({ doc, canBMAction, canAMAction, canQCAction, canLevelAction, levelRoleSlug, dynamicWorkflowActive, hideDecisionStatus, isRenewalNew, renewalReview, docRemarks, setDocRemarks, docActionLoading, handleDocReview, setPreviewDoc }: DocImageCardProps) {
    const isProcessing = docActionLoading === doc.id;
    const isDocImage   = doc.mimeType ? doc.mimeType.startsWith('image/') : /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.fileUrl || '');

    const docLabel    = docTypeLabel(doc.documentType);
    const qcRawStatus = doc.qcDecision ?? 'PENDING'; // raw string for PENDING comparison

    // Each reviewer can act only on their own pending slot.
    // Once a stage has already decided (not PENDING), hide that stage's actions.
    // Dynamic workflow: stage order comes from config, so only this stage's own slot matters.
    // Remarks from custom-role dynamic stages (built-in BM/AM/QC remarks render below as before).
    const customStageRemarks = (dynamicWorkflowActive ? doc.stageDecisions ?? [] : [])
        .filter(sd => !BUILTIN_DECISION_FIELD[sd.roleSlug] && sd.remark);

    const canReview = levelRoleSlug
        ? canLevelAction && docStageDecision(doc, levelRoleSlug) === 'PENDING'
        : (canBMAction && doc.bmDecision === 'PENDING') ||
                      (canAMAction && doc.amDecision === 'PENDING' && (canLevelAction || doc.bmDecision !== 'PENDING')) ||
                      (canQCAction && doc.amDecision !== 'PENDING' && qcRawStatus === 'PENDING'); // QC: AM done AND QC not yet decided

    return (
        <div className="p-3">
            {/* Caption */}
            <div className="rounded-t-lg border border-b-0 border-border bg-muted px-2 py-1.5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-wide text-foreground">{docLabel}</span>
                {doc.documentNumber && <span className="text-[10px] text-muted-foreground ml-1">#{doc.documentNumber}</span>}
                {doc.revisionNo > 1 && <span className="text-[10px] text-muted-foreground ml-1">(Rev {doc.revisionNo})</span>}
                {isRenewalNew && (
                    <span className="ml-1.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                        New · This Renewal
                    </span>
                )}
            </div>

            {/* Image frame */}
            <div className={cn('border border-border overflow-hidden bg-muted/30', hideDecisionStatus && !renewalReview && 'rounded-b-lg')} style={{ height: 220 }}>
                {isDocImage && doc.fileUrl ? (
                    <button type="button" onClick={() => setPreviewDoc(doc)} className="w-full h-full cursor-zoom-in block">
                        <div className="relative w-full h-full">
                            <StorageImage src={doc.fileUrl} alt={docLabel} fill className="object-contain p-1" />
                        </div>
                    </button>
                ) : doc.fileUrl ? (
                    <div className="flex flex-col items-center justify-center gap-2 h-full">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <StorageLink href={doc.fileUrl} className="text-xs underline flex items-center gap-1 text-primary">
                            <ExternalLink className="h-3 w-3" /> View File
                        </StorageLink>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">No image uploaded</div>
                )}
            </div>

            {renewalReview && (
                <div className="rounded-b-lg border border-border border-t-0 bg-card">{renewalReview}</div>
            )}

            {/* Per-stage approval status — "Approved by BM/AM/QC" rows (green tick, reviewer,
                date-time) plus chips for stages still pending. Skipped in a renewal review:
                these reflect the member's enrollment-time review, not anything this screen
                is deciding (see hideDecisionStatus's doc comment). */}
            {!hideDecisionStatus && (
                <div className="border border-border border-t-0">
                    <DocStageApprovals
                        stages={dynamicWorkflowActive && doc.stageDecisions && doc.stageDecisions.length > 0
                            ? doc.stageDecisions.map(sd => ({ key: sd.stageName, decision: sd.decision, at: sd.reviewedAt, by: sd.reviewer }))
                            : [
                                { key: 'BM', decision: doc.bmDecision, at: doc.bmReviewedAt, by: doc.bmReviewer },
                                { key: 'AM', decision: doc.amDecision, at: doc.amReviewedAt, by: doc.amReviewer },
                                { key: 'QC', decision: doc.qcDecision ?? 'PENDING', at: doc.qcReviewedAt, by: doc.qcReviewer },
                            ]}
                    />
                </div>
            )}

            {/* Remarks / retake reason */}
            {!hideDecisionStatus && (doc.bmRemark || doc.amRemark || doc.qcRemark || doc.retakeReason || customStageRemarks.length > 0) && (
                <div className="border border-border border-t-0 bg-secondary/5 px-2 py-1.5 text-[10px] text-foreground space-y-0.5">
                    {doc.retakeReason && <div className="flex items-start gap-1 text-secondary-foreground"><AlertTriangle className="h-3 w-3 shrink-0 mt-px" />{doc.retakeReason}</div>}
                    {doc.bmRemark && <div><span className="font-bold">BM:</span> {doc.bmRemark}</div>}
                    {doc.amRemark && <div><span className="font-bold">AM:</span> {doc.amRemark}</div>}
                    {doc.qcRemark && <div><span className="font-bold">QC:</span> {doc.qcRemark}</div>}
                    {customStageRemarks.map(sd => (
                        <div key={sd.roleSlug}><span className="font-bold">{sd.stageName}:</span> {sd.remark}</div>
                    ))}
                </div>
            )}

            {/* Review actions */}
            {canReview && (
                <div className="rounded-b-lg border border-border border-t-0 bg-card p-2 space-y-2">
                    <Textarea
                        placeholder="Remark (required for retake / delete / reject)…"
                        value={docRemarks[doc.id] || ''}
                        onChange={e => setDocRemarks(prev => ({ ...prev, [doc.id]: e.target.value }))}
                        className="h-12 resize-none text-xs border border-input rounded-md focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0"
                        disabled={isProcessing}
                    />
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { dec: 'VERIFIED',        icon: CheckCircle2, label: 'Verify' },
                            { dec: 'RETAKE_REQUIRED', icon: RotateCcw,    label: 'Retake' },
                            { dec: 'DELETED',         icon: Trash2,       label: 'Delete' },
                        ].map(({ dec, icon: Icon, label }) => (
                            <button
                                key={dec}
                                onClick={() => handleDocReview(doc.id, dec)}
                                disabled={isProcessing}
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase disabled:opacity-40 transition-colors',
                                    dec === 'VERIFIED'
                                        ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                                        : dec === 'RETAKE_REQUIRED'
                                        ? 'border-secondary/50 bg-secondary/10 text-secondary-foreground hover:bg-secondary/20'
                                        : 'border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10',
                                )}
                            >
                                {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Document Preview Modal (unchanged logic, monochrome styling) ─────────────
function getDocContextFields(doc: KYCDoc, c: any): Array<{ label: string; value: any }> {
    const dt = doc.documentType;
    if (dt === 'client_photo' || dt === 'selfie') return [
        { label: 'Member ID', value: c.clientId }, { label: 'Name', value: `${c.firstName} ${c.lastName}` },
        { label: 'Phone', value: c.mobileNumber }, { label: 'Date of Birth', value: c.dateOfBirth ? toDisplayDate(new Date(c.dateOfBirth)) : null },
        { label: 'Gender', value: c.gender }, { label: 'Age', value: c.age }, { label: 'Address', value: c.permanentAddress },
    ];
    if (dt === 'aadhaar_front' || dt === 'aadhaar_back' || dt === 'other_id') return [
        { label: 'Member ID', value: c.clientId }, { label: 'Name', value: `${c.firstName} ${c.lastName}` },
        { label: 'Aadhaar / Doc No', value: doc.documentNumber || c.otherIdNo }, { label: 'Phone', value: c.mobileNumber },
        { label: 'DOB', value: c.dateOfBirth ? toDisplayDate(new Date(c.dateOfBirth)) : null }, { label: 'Gender', value: c.gender },
        { label: 'Father Name', value: c.fatherName }, { label: 'Address', value: c.permanentAddress }, { label: 'District', value: c.district },
    ];
    if (dt === 'pan_card') return [
        { label: 'Member ID', value: c.clientId }, { label: 'Name', value: `${c.firstName} ${c.lastName}` },
        { label: 'PAN Number', value: doc.documentNumber || c.pancardNo }, { label: 'Phone', value: c.mobileNumber },
        { label: 'DOB', value: c.dateOfBirth ? toDisplayDate(new Date(c.dateOfBirth)) : null }, { label: 'Gender', value: c.gender },
    ];
    if (dt === 'bank_passbook') return [
        { label: 'Member ID', value: c.clientId }, { label: 'Account Holder', value: `${c.firstName} ${c.lastName}` },
        { label: 'Account No', value: c.bankAcNo }, { label: 'Bank Name', value: c.bankName },
        { label: 'Branch', value: c.bankBranch }, { label: 'IFSC Code', value: c.ifscCode }, { label: 'Phone', value: c.mobileNumber },
    ];
    if (dt === 'smart_card' || dt === 'smart_card_front' || dt === 'smart_card_back') return [
        { label: 'Member ID', value: c.clientId }, { label: 'Name', value: `${c.firstName} ${c.lastName}` },
        { label: 'Smart Card No', value: doc.documentNumber || c.smartCardNo }, { label: 'Phone', value: c.mobileNumber },
        { label: 'Father Name', value: c.fatherName }, { label: 'Address', value: c.permanentAddress }, { label: 'District', value: c.district },
    ];
    if (dt === 'voter_id') return [
        { label: 'Member ID', value: c.clientId }, { label: 'Name', value: `${c.firstName} ${c.lastName}` },
        { label: 'Voter ID No', value: doc.documentNumber || c.votersIdNo }, { label: 'Phone', value: c.mobileNumber },
        { label: 'DOB', value: c.dateOfBirth ? toDisplayDate(new Date(c.dateOfBirth)) : null }, { label: 'Gender', value: c.gender }, { label: 'Address', value: c.permanentAddress },
    ];
    if (dt.startsWith('co_applicant_')) {
        const ca = c.coApplicant;
        if (!ca) return [{ label: 'Co-Applicant', value: 'No co-applicant data' }];
        const base = [
            { label: 'Name', value: ca.name }, { label: 'Relation', value: ca.relationWithClient },
            { label: 'Gender', value: ca.gender }, { label: 'Age', value: ca.age },
            { label: 'DOB', value: ca.dateOfBirth ? toDisplayDate(new Date(ca.dateOfBirth)) : null }, { label: 'Mobile', value: ca.mobileNumber },
        ];
        // Show only the ID number matching this document — co_applicant_other_id is the co-applicant's Aadhaar (front).
        if (dt === 'co_applicant_other_id' || dt.startsWith('co_applicant_aadhaar') || dt.startsWith('co_applicant_other_id_'))
            return [...base, { label: 'Aadhaar No', value: doc.documentNumber || ca.otherIdNo }];
        if (dt.startsWith('co_applicant_voter_id'))
            return [...base, { label: 'Voter ID No', value: doc.documentNumber || ca.voterIdNo }];
        if (dt === 'co_applicant_pan_card')
            return [...base, { label: 'PAN Number', value: doc.documentNumber || ca.pancardNo }];
        return base;
    }
    return [
        { label: 'Member ID', value: c.clientId }, { label: 'Name', value: `${c.firstName} ${c.lastName}` },
        { label: 'Phone', value: c.mobileNumber }, { label: 'Doc No', value: doc.documentNumber },
    ];
}

function DocumentPreviewModal({ doc, client, open, onClose }: { doc: KYCDoc | null; client: any; open: boolean; onClose: () => void; }) {
    if (!doc) return null;
    const isImage  = doc.mimeType ? doc.mimeType.startsWith('image/') : /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.fileUrl);
    const isPdf    = doc.mimeType === 'application/pdf' || /\.pdf$/i.test(doc.fileUrl);
    const fields   = getDocContextFields(doc, client);
    const bmDec    = DOC_DEC[doc.bmDecision]               || DOC_DEC.PENDING;
    const amDec    = DOC_DEC[doc.amDecision]               || DOC_DEC.PENDING;
    const qcDec    = DOC_DEC[doc.qcDecision ?? 'PENDING']  || DOC_DEC.PENDING;
    const docLabel = docTypeLabel(doc.documentType);
    const mapsHref = client?.latitude != null && client?.longitude != null
        ? `https://www.google.com/maps?q=${client.latitude},${client.longitude}`
        : null;

    // Helper: "Name · DD/MM/YYYY, HH:MM:SS"
    const reviewerCell = (
        reviewer: { firstName: string; lastName: string } | null,
        reviewedAt: string | null,
        decLabel: string,
        remark: string | null,
    ) => {
        const name = reviewer ? `${reviewer.firstName} ${reviewer.lastName}` : null;
        const date = reviewedAt ? toDisplayDateTime(new Date(reviewedAt)) : null;
        return (
            <td className="border border-border px-2 py-1.5">
                <span className="font-semibold text-foreground">{decLabel}</span>
                {name && <span className="text-muted-foreground"> · {name}</span>}
                {date && <span className="text-muted-foreground/70"> · {date}</span>}
                {remark && <div className="mt-0.5 text-muted-foreground italic">&ldquo;{remark}&rdquo;</div>}
            </td>
        );
    };

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border p-0 gap-0">
                <DialogHeader className="border-b border-border bg-muted/50 px-4 py-3">
                    <DialogTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground">
                        <FileText className="h-4 w-4 text-primary" /> {docLabel}
                        {doc.revisionNo > 1 && <span className="text-xs font-normal text-muted-foreground">(Rev {doc.revisionNo})</span>}
                    </DialogTitle>
                </DialogHeader>
                <div className="p-4 space-y-4">
                    {/* Image */}
                    <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
                        {isImage ? (
                            <div className="relative w-full h-[360px]">
                                <StorageImage src={doc.fileUrl} alt={docLabel} fill className="object-contain p-2" />
                            </div>
                        ) : isPdf ? (
                            <StorageIframe src={doc.fileUrl} title={docLabel} className="w-full h-[420px] border-0" />
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
                                <FileText className="h-12 w-12" />
                                <p className="text-sm">{doc.fileName}</p>
                                <StorageLink href={doc.fileUrl} className="flex items-center gap-1 text-xs underline text-primary">
                                    <ExternalLink className="h-3.5 w-3.5" /> Open file
                                </StorageLink>
                            </div>
                        )}
                    </div>
                    {(isImage || isPdf) && (
                        <StorageLink href={doc.fileUrl} className="flex items-center justify-end gap-1 text-xs underline text-primary">
                            <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                        </StorageLink>
                    )}

                    {/* Location QR — redirect to the client's recorded GPS location */}
                    {doc.documentType === 'location_qr' && (
                        mapsHref ? (
                            <a
                                href={mapsHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
                            >
                                <MapPin className="h-3.5 w-3.5" /> Open Client Location on Map
                            </a>
                        ) : (
                            <p className="text-xs text-muted-foreground text-center">No GPS location recorded for this client.</p>
                        )
                    )}

                    {/* Context fields */}
                    {fields.some(f => f.value != null) && (
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr><th colSpan={2} className="border border-border px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest bg-muted text-primary">Document Context</th></tr>
                            </thead>
                            <tbody>
                                {fields.filter(f => f.value != null).map(field => (
                                    <tr key={field.label}>
                                        <td className="border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground w-1/3">{field.label}</td>
                                        <td className="border border-border px-2 py-1.5 break-words text-foreground">
                                            {String(field.value)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {/* Review status */}
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr>
                                <th colSpan={2} className="border border-border px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest bg-muted text-primary">
                                    Review Status
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {doc.stageDecisions && doc.stageDecisions.length > 0 ? (
                                /* Dynamic workflow — one row per configured stage (any role), in level order */
                                doc.stageDecisions.map((sd, i) => (
                                    <tr key={sd.roleSlug}>
                                        <td className={cn('border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground align-top', i === 0 && 'w-1/3')}>
                                            {sd.stageName}
                                        </td>
                                        {reviewerCell(sd.reviewer, sd.reviewedAt, (DOC_DEC[sd.decision] ?? DOC_DEC.PENDING).label, sd.remark)}
                                    </tr>
                                ))
                            ) : (<>
                            {/* BM */}
                            <tr>
                                <td className="border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground w-1/3 align-top">BM Decision</td>
                                {reviewerCell(doc.bmReviewer, doc.bmReviewedAt, bmDec.label, doc.bmRemark)}
                            </tr>
                            {/* AM */}
                            <tr>
                                <td className="border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground align-top">AM Decision</td>
                                {reviewerCell(doc.amReviewer, doc.amReviewedAt, amDec.label, doc.amRemark)}
                            </tr>
                            {/* QC */}
                            <tr>
                                <td className="border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground align-top">QC Decision</td>
                                {reviewerCell(doc.qcReviewer ?? null, doc.qcReviewedAt ?? null, qcDec.label, doc.qcRemark ?? null)}
                            </tr>
                            </>)}
                            {/* Retake reason */}
                            {doc.retakeReason && (
                                <tr>
                                    <td className="border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground">Retake Reason</td>
                                    <td className="border border-border px-2 py-1.5 italic text-secondary-foreground">{doc.retakeReason}</td>
                                </tr>
                            )}
                            {/* Uploaded by */}
                            {doc.uploadedBy && (
                                <tr>
                                    <td className="border border-border px-2 py-1.5 font-bold bg-muted/50 text-muted-foreground">Uploaded By</td>
                                    <td className="border border-border px-2 py-1.5 text-foreground">
                                        {doc.uploadedBy.firstName} {doc.uploadedBy.lastName}
                                        <span className="text-muted-foreground"> · {toDisplayDateTime(new Date(doc.createdAt))}</span>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </DialogContent>
        </Dialog>
    );
}
