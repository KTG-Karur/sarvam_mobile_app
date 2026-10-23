'use client';

import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { StorageImage, StorageLink } from '@/components/storage/StorageMedia';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  Clock,
  Building2,
  Activity,
  Calendar,
  Users,
  UserCheck,
  Banknote,
  RotateCcw,
  FileEdit,
  CircleDot,
  Trash2,
  FileText,
  ExternalLink,
  Repeat,
  XCircle,
  Undo2,
  FileSpreadsheet,
} from 'lucide-react';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { cn } from '@/lib/utils';
import { tokenStorage } from '@/app/lib/token-storage';
import { getCentersForDropdown, type CenterOption } from '@/app/lib/actions/centers';
import { FDORecheckPanel } from './FDORecheckPanel';
import { FDORenewalRecheckPanel } from './FDORenewalRecheckPanel';
import { RenewalLoanDetail } from '@/components/approval/RenewalLoanApprovalQueue';
import { ApprovedExportDialog } from './ApprovedExportDialog';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'pending' | 'new_loan' | 'yet_to_approve' | 'approved' | 'pre_disbursement' | 'disbursed' | 'recheck' | 'rejected' | 'renewal';
/** Tabs shown in the top bar — the other member lists are New Loan's chips. */
type TopTab = 'all' | 'pending' | 'new_loan' | 'renewal';
type ApprovalFilter = 'all' | 'bm' | 'am' | 'qc' | 'admin' | 'recheck' | 'pre_disbursement' | 'disbursed' | 'rejected';
/** Approval Queue filter — legacy chips, or one configured workflow stage (`stage:<roleSlug>`). */
type MemberApprovalFilter = ApprovalFilter | `stage:${string}`;

/** A configured dynamic approval-workflow stage (from /api/clients/tracker). */
interface TrackerStage {
  levelOrder: number;
  roleSlug: string;
  stageName: string;
  pendingStatus: string;
  retakeStatus: string;
}

/** Configured workflow stages (empty = legacy fixed BM → AM → QC → Admin). */
const WorkflowStagesContext = createContext<TrackerStage[]>([]);

interface RenewalTrackerItem {
  id: string;
  loanNumber: string;
  amount: number;
  frequency: string | null;
  renewalApprovalStatus: string;
  disbursementStatus: string;
  disbursedAt: string | null;
  createdAt: string;
  clientId: string;
  clientDisplayId: string;
  clientName: string;
  mobileNumber: string | null;
  centerName: string | null;
  branchName: string | null;
  productName: string | null;
  kycDocCount: number;
  fdoName: string | null;
  fdoEmployeeId: string | null;
  /** Latest rejection — present only when renewalApprovalStatus is REJECTED. */
  rejection?: { stageName: string; by: string; at: string; remarks: string | null } | null;
  /** Present while the renewal is in recheck (retake status or a flagged re-upload). */
  recheck?: { documentOnly: boolean; by: string | null; remarks: string | null } | null;
}

/** What the Re-access dialog is acting on — a rejected member or a rejected renewal loan. */
type ReaccessTarget =
  | { kind: 'client'; clientId: string; name: string }
  | { kind: 'renewal'; loanId: string; loanNumber: string; name: string };

interface ApprovalUser {
  id: string;
  firstName: string;
  lastName: string;
  employeeId?: string;
}

interface LoanSummary {
  id: string;
  loanNumber: string;
  amount: string | number;
  disbursementStatus: string;
  applicationStatus: string;
  disbursedByBMAt?: string;
  createdAt: string;
}

interface ApprovalHistoryEntry {
  action: string;
  previousState?: string | null;
  remarks?: string | null;
  createdAt: string;
  performedBy: ApprovalUser;
}

interface TrackerClient {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  mobileNumber?: string;
  approvalStatus: string;
  createdAt: string;
  bmReviewedAt?: string;
  bmRemarks?: string;
  amReviewedAt?: string;
  amRemarks?: string;
  qcVerifiedAt?: string;
  qcRemarks?: string;
  finalReviewedAt?: string;
  finalRemarks?: string;
  rejectionReason?: string;
  enrolledBy: ApprovalUser;
  bmReviewedBy?: ApprovalUser;
  amReviewedBy?: ApprovalUser;
  qcVerifiedBy?: ApprovalUser;
  finalReviewedBy?: ApprovalUser;
  center?: {
    id: string;
    name: string;
    code: string;
    branch: { id: string; name: string; code: string };
  };
  loanApplications: LoanSummary[];
  approvalHistory?: ApprovalHistoryEntry[];
  // Only present when a document has been flagged RETAKE_REQUIRED — see
  // DOC_RETAKE_CONDITION on the tracker API. Used to label document-level
  // rechecks on the Recheck tab even before the client's own approvalStatus
  // has moved to a *_RETAKE_REQUIRED status.
  kycDocuments?: Array<{
    id: string;
    documentType: string;
    fileUrl?: string | null;
    mimeType?: string | null;
    bmDecision: string;
    amDecision: string;
    qcDecision: string;
    bmRemark?: string | null;
    amRemark?: string | null;
    qcRemark?: string | null;
    retakeReason?: string | null;
    /** Retake flags raised by custom-role dynamic workflow stages. */
    stageReviews?: Array<{ roleSlug: string; decision: string; remark: string | null }>;
  }>;
}

interface TabCounts {
  all: number;
  pending: number;
  new_loan?: number;
  yet_to_approve: number;
  approved: number;
  pre_disbursement: number;
  disbursed: number;
  recheck: number;
  rejected: number;
  // Not populated by /api/clients/tracker (the Renewal Loans tab's count badge
  // comes from renewalStageCounts.all instead) — optional so TABS.map's
  // generic `tabCounts[t.id]` lookup stays type-safe for the 'renewal' tab.
  renewal?: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType; color: string; activeColor: string }[] = [
  { id: 'all',              label: 'All',              icon: Users,      color: 'text-slate-500',    activeColor: 'text-slate-700 bg-white shadow-sm' },
  { id: 'pending',          label: 'Draft',            icon: FileEdit,   color: 'text-amber-500',    activeColor: 'text-amber-700 bg-amber-50 shadow-sm' },
  { id: 'new_loan',         label: 'New Loan',         icon: UserCheck,  color: 'text-orange-500',   activeColor: 'text-orange-700 bg-orange-50 shadow-sm' },
  { id: 'yet_to_approve',   label: 'Approval Queue',   icon: Clock,      color: 'text-orange-500',   activeColor: 'text-orange-700 bg-orange-50 shadow-sm' },
  { id: 'approved',         label: 'Approved',         icon: UserCheck,  color: 'text-emerald-500',  activeColor: 'text-emerald-700 bg-emerald-50 shadow-sm' },
  { id: 'pre_disbursement', label: 'Pre Disbursement', icon: CircleDot,  color: 'text-violet-500',   activeColor: 'text-violet-700 bg-violet-50 shadow-sm' },
  { id: 'disbursed',        label: 'Disbursed',        icon: Banknote,   color: 'text-teal-500',     activeColor: 'text-teal-700 bg-teal-50 shadow-sm' },
  { id: 'recheck',          label: 'Recheck',          icon: RotateCcw,  color: 'text-rose-500',     activeColor: 'text-rose-700 bg-rose-50 shadow-sm' },
  { id: 'rejected',         label: 'Rejected',         icon: XCircle,    color: 'text-red-500',      activeColor: 'text-red-700 bg-red-50 shadow-sm' },
  { id: 'renewal',          label: 'Renewal Loan',     icon: Repeat,     color: 'text-cyan-500',     activeColor: 'text-cyan-700 bg-cyan-50 shadow-sm' },
];
const TOP_TABS = TABS.filter((t): t is (typeof TABS)[number] & { id: TopTab } =>
  t.id === 'all' || t.id === 'pending' || t.id === 'new_loan' || t.id === 'renewal');
// New Loan chips that are their own member list (the rest are approval stages).
const NEW_LOAN_LIST_CHIPS = new Set<string>(['recheck', 'pre_disbursement', 'disbursed', 'rejected']);

// Reuses RenewalLoanApprovalQueue's own stage-status label styling so a
// renewal loan's badge reads the same way here as it does on the actual
// approval queue.
const RENEWAL_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SUBMITTED:                       { label: 'Submitted',      className: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_BM_REVIEW:               { label: 'Pending BM',     className: 'bg-green-50 text-sidebar-accent border-primary/30' },
  BM_RETAKE_REQUIRED:              { label: 'BM Retake',      className: 'bg-orange-50 text-orange-700 border-orange-200' },
  PENDING_AM_REVIEW:               { label: 'Pending AM',     className: 'bg-blue-50 text-blue-700 border-blue-200' },
  AM_RETAKE_REQUIRED:              { label: 'AM Retake',      className: 'bg-rose-50 text-rose-700 border-rose-200' },
  PENDING_QC_VERIFICATION:         { label: 'Pending QC',     className: 'bg-teal-50 text-teal-700 border-teal-200' },
  QC_VERIFICATION_RETAKE_REQUIRED: { label: 'QC Retake',      className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  PENDING_FINAL_REVIEW:            { label: 'Pending Admin',  className: 'bg-violet-50 text-violet-700 border-violet-200' },
  FINAL_RETAKE_REQUIRED:           { label: 'Admin Retake',   className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  PENDING_LEVEL_1:                 { label: 'Level 1 Pending', className: 'bg-green-50 text-sidebar-accent border-primary/30' },
  LEVEL_1_RETAKE_REQUIRED:         { label: 'L1 Retake',      className: 'bg-orange-50 text-orange-700 border-orange-200' },
  PENDING_LEVEL_2:                 { label: 'Level 2 Pending', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  LEVEL_2_RETAKE_REQUIRED:         { label: 'L2 Retake',      className: 'bg-rose-50 text-rose-700 border-rose-200' },
  PENDING_LEVEL_3:                 { label: 'Level 3 Pending', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  LEVEL_3_RETAKE_REQUIRED:         { label: 'L3 Retake',      className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  PENDING_LEVEL_4:                 { label: 'Level 4 Pending', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  LEVEL_4_RETAKE_REQUIRED:         { label: 'L4 Retake',      className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  APPROVED:                        { label: 'Approved',       className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED:                        { label: 'Rejected',       className: 'bg-red-50 text-red-700 border-red-200' },
};

const APPROVAL_FILTERS: { id: ApprovalFilter; label: string; color: string }[] = [
  { id: 'all',   label: 'All Stages',       color: 'bg-slate-100 text-slate-700 border-slate-200 data-[active=true]:bg-slate-800 data-[active=true]:text-white' },
  { id: 'bm',    label: 'BM Approval',      color: 'bg-green-50 text-sidebar-accent border-primary/30 data-[active=true]:bg-primary data-[active=true]:text-white' },
  { id: 'am',    label: 'AM Approval',      color: 'bg-blue-50 text-blue-700 border-blue-200 data-[active=true]:bg-blue-600 data-[active=true]:text-white' },
  { id: 'qc',    label: 'QC Verification',  color: 'bg-teal-50 text-teal-700 border-teal-200 data-[active=true]:bg-teal-600 data-[active=true]:text-white' },
  { id: 'admin', label: 'Admin Approval',   color: 'bg-violet-50 text-violet-700 border-violet-200 data-[active=true]:bg-violet-600 data-[active=true]:text-white' },
];

const REJECTED_FILTER: { id: ApprovalFilter; label: string; color: string } =
  { id: 'rejected', label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-200 data-[active=true]:bg-red-600 data-[active=true]:text-white' };

// Renewal Loans tab only — renewal rechecks live here, not on the member Recheck tab.
const RENEWAL_RECHECK_FILTER: { id: ApprovalFilter; label: string; color: string } =
  { id: 'recheck', label: 'Recheck', color: 'bg-rose-50 text-rose-700 border-rose-200 data-[active=true]:bg-rose-600 data-[active=true]:text-white' };

// Renewal Loans tab only — approved renewals in / through the disbursement pipeline
// (the member Pre-Disbursement / Disbursed tabs list normal loans only).
const RENEWAL_DISBURSEMENT_FILTERS: { id: ApprovalFilter; label: string; color: string }[] = [
  { id: 'pre_disbursement', label: 'Pre-Disbursement', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 data-[active=true]:bg-indigo-600 data-[active=true]:text-white' },
  { id: 'disbursed',        label: 'Disbursed',        color: 'bg-teal-50 text-teal-700 border-teal-200 data-[active=true]:bg-teal-600 data-[active=true]:text-white' },
];
const isRenewalDisbursementFilter = (f: string) => f === 'pre_disbursement' || f === 'disbursed';

const APPROVAL_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SUBMITTED:                       { label: 'Submitted',       className: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_BM_REVIEW:               { label: 'Pending BM',      className: 'bg-green-50 text-sidebar-accent border-primary/30' },
  BM_RETAKE_REQUIRED:              { label: 'BM Recheck',      className: 'bg-orange-50 text-orange-700 border-orange-200' },
  PENDING_AM_REVIEW:               { label: 'Pending AM',      className: 'bg-blue-50 text-blue-700 border-blue-200' },
  AM_RETAKE_REQUIRED:              { label: 'AM Recheck',      className: 'bg-rose-50 text-rose-700 border-rose-200' },
  PENDING_QC_VERIFICATION:         { label: 'Pending QC',      className: 'bg-teal-50 text-teal-700 border-teal-200' },
  QC_VERIFICATION_RETAKE_REQUIRED: { label: 'QC Recheck',      className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  PENDING_FINAL_REVIEW:            { label: 'Pending Admin',   className: 'bg-violet-50 text-violet-700 border-violet-200' },
  FINAL_RETAKE_REQUIRED:           { label: 'Admin Recheck',   className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  APPROVED:                        { label: 'Approved',        className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED:                        { label: 'Rejected',        className: 'bg-red-50 text-red-700 border-red-200' },
  PENDING_LEVEL_1:                 { label: 'Level 1 Pending', className: 'bg-green-50 text-sidebar-accent border-primary/30' },
  LEVEL_1_RETAKE_REQUIRED:         { label: 'L1 Recheck',      className: 'bg-orange-50 text-orange-700 border-orange-200' },
  PENDING_LEVEL_2:                 { label: 'Level 2 Pending', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  LEVEL_2_RETAKE_REQUIRED:         { label: 'L2 Recheck',      className: 'bg-rose-50 text-rose-700 border-rose-200' },
  PENDING_LEVEL_3:                 { label: 'Level 3 Pending', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  LEVEL_3_RETAKE_REQUIRED:         { label: 'L3 Recheck',      className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  PENDING_LEVEL_4:                 { label: 'Level 4 Pending', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  LEVEL_4_RETAKE_REQUIRED:         { label: 'L4 Recheck',      className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
};

const DISB_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING_LEVEL1:  { label: 'Pending AM',    className: 'bg-orange-50 text-orange-700 border-orange-200' },
  APPROVED_LEVEL1: { label: 'AM Approved',   className: 'bg-blue-50 text-blue-700 border-blue-200' },
  PENDING_LEVEL2:  { label: 'Pending BM',    className: 'bg-violet-50 text-violet-700 border-violet-200' },
  APPROVED_LEVEL2: { label: 'Ready to Disburse', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DISBURSED:       { label: 'Disbursed',     className: 'bg-teal-50 text-teal-700 border-teal-200' },
  REJECTED:        { label: 'Rejected',      className: 'bg-red-50 text-red-700 border-red-200' },
};

const RECHECK_WHO: Record<string, string> = {
  BM_RETAKE_REQUIRED:              'by BM',
  AM_RETAKE_REQUIRED:              'by AM',
  QC_VERIFICATION_RETAKE_REQUIRED: 'by QC',
  FINAL_RETAKE_REQUIRED:           'by Admin',
  LEVEL_1_RETAKE_REQUIRED:         'Level 1',
  LEVEL_2_RETAKE_REQUIRED:         'Level 2',
  LEVEL_3_RETAKE_REQUIRED:         'Level 3',
  LEVEL_4_RETAKE_REQUIRED:         'Level 4',
};

// ── Dynamic workflow stage helpers ───────────────────────────────────────────
// With a ClientWorkflowConfig active, stage names/order come from config, so the
// chips, badges, recheck labels and trail are derived from it instead of fixed BM/AM/QC.

const STAGE_PALETTE = [
  { chip: 'bg-green-50 text-sidebar-accent border-primary/30 data-[active=true]:bg-primary data-[active=true]:text-white', badge: 'bg-green-50 text-sidebar-accent border-primary/30' },
  { chip: 'bg-blue-50 text-blue-700 border-blue-200 data-[active=true]:bg-blue-600 data-[active=true]:text-white', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { chip: 'bg-teal-50 text-teal-700 border-teal-200 data-[active=true]:bg-teal-600 data-[active=true]:text-white', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  { chip: 'bg-amber-50 text-amber-700 border-amber-200 data-[active=true]:bg-amber-600 data-[active=true]:text-white', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { chip: 'bg-indigo-50 text-indigo-700 border-indigo-200 data-[active=true]:bg-indigo-600 data-[active=true]:text-white', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
];

const BUILTIN_DECISION_FIELD: Record<string, 'bmDecision' | 'amDecision' | 'qcDecision'> = {
  'branch-manager': 'bmDecision',
  'area-manager': 'amDecision',
  'quality-checkers': 'qcDecision',
  'background-verification-team': 'qcDecision',
};

/** Legacy trail/action stage label → the built-in role slug it stands for. */
const LEGACY_LABEL_SLUG: Record<string, string> = { BM: 'branch-manager', AM: 'area-manager', QC: 'quality-checkers' };

function stageBySlug(stages: TrackerStage[], slug: string): TrackerStage | undefined {
  return stages.find((st) => st.roleSlug === slug
    || (slug === 'quality-checkers' && st.roleSlug === 'background-verification-team'));
}

/** The configured stage a client at `status` is waiting on (SUBMITTED = first stage). */
function stageForStatus(stages: TrackerStage[], status: string): TrackerStage | undefined {
  if (status === 'SUBMITTED') return stages[0];
  return stages.find((st) => st.pendingStatus === status || st.retakeStatus === status);
}

type TrackerDoc = NonNullable<TrackerClient['kycDocuments']>[number];

/** A document's retake flag for one stage role (built-in columns or custom-role rows). */
function docFlaggedForSlug(doc: TrackerDoc, slug: string): boolean {
  const field = BUILTIN_DECISION_FIELD[slug];
  if (field) return doc[field] === 'RETAKE_REQUIRED';
  return !!doc.stageReviews?.some((r) => r.roleSlug === slug && r.decision === 'RETAKE_REQUIRED');
}

/** Approval-status badge config, relabelled with the configured stage names. */
function useApprovalStatusConfig(): Record<string, { label: string; className: string }> {
  const stages = useContext(WorkflowStagesContext);
  return useMemo(() => {
    if (stages.length === 0) return APPROVAL_STATUS_CONFIG;
    const cfg = { ...APPROVAL_STATUS_CONFIG };
    stages.forEach((st, i) => {
      cfg[st.pendingStatus] = { label: `Pending ${st.stageName}`, className: STAGE_PALETTE[i % STAGE_PALETTE.length].badge };
      cfg[st.retakeStatus] = { label: `${st.stageName} Recheck`, className: 'bg-orange-50 text-orange-700 border-orange-200' };
    });
    cfg.SUBMITTED = { label: `Pending ${stages[0].stageName}`, className: cfg[stages[0].pendingStatus].className };
    return cfg;
  }, [stages]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dateStr?: string | null) {
  if (!dateStr) return '—';
  return toDisplayDate(new Date(dateStr));
}

function userName(u?: ApprovalUser | null) {
  if (!u) return '—';
  return `${u.firstName} ${u.lastName}`;
}

function daysSince(dateStr: string) {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  return d <= 0 ? 'Today' : `${d}d ago`;
}

function StatusBadge({ status, config }: { status: string; config: Record<string, { label: string; className: string }> }) {
  const cfg = config[status] ?? { label: status, className: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

// Compact Indian-style count: 1.2K, 3.4L, 5.6Cr, 1.2B — trims a trailing ".0".
function formatCompactCount(n: number): string {
  const units: [number, string][] = [[1e9, 'B'], [1e7, 'Cr'], [1e5, 'L'], [1e3, 'K']];
  for (const [value, suffix] of units) {
    if (n >= value) return `${(Math.floor((n / value) * 10) / 10).toString()}${suffix}`;
  }
  return String(n);
}

function countBadge(n: number) {
  if (n === 0) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-current/15 px-1.5 py-0.5 text-[10px] font-bold leading-none min-w-[18px]">
      {formatCompactCount(n)}
    </span>
  );
}

// ── Approval Trail (expand row) ───────────────────────────────────────────────

interface TrailStep {
  label: string;
  by?: ApprovalUser | null;
  at?: string | null;
  remarks?: string | null;
  done: boolean;
}

// Statuses that prove BM stage is complete (client has moved past BM review)
const BM_DONE_STATUSES = new Set([
  'PENDING_AM_REVIEW', 'AM_RETAKE_REQUIRED',
  'PENDING_QC_VERIFICATION', 'QC_VERIFICATION_RETAKE_REQUIRED',
  'PENDING_FINAL_REVIEW', 'FINAL_RETAKE_REQUIRED',
  'APPROVED',
  'PENDING_LEVEL_2', 'LEVEL_2_RETAKE_REQUIRED',
  'PENDING_LEVEL_3', 'LEVEL_3_RETAKE_REQUIRED',
  'PENDING_LEVEL_4', 'LEVEL_4_RETAKE_REQUIRED',
]);

// Statuses that prove AM stage is complete
const AM_DONE_STATUSES = new Set([
  'PENDING_QC_VERIFICATION', 'QC_VERIFICATION_RETAKE_REQUIRED',
  'PENDING_FINAL_REVIEW', 'FINAL_RETAKE_REQUIRED',
  'APPROVED',
  'PENDING_LEVEL_3', 'LEVEL_3_RETAKE_REQUIRED',
  'PENDING_LEVEL_4', 'LEVEL_4_RETAKE_REQUIRED',
]);

// Statuses that prove QC stage is complete
const QC_DONE_STATUSES = new Set([
  'PENDING_FINAL_REVIEW', 'FINAL_RETAKE_REQUIRED',
  'APPROVED',
  'PENDING_LEVEL_4', 'LEVEL_4_RETAKE_REQUIRED',
]);

// The stage statuses that LEVEL_APPROVED transitions FROM for each named role
const BM_FROM_STATUSES  = new Set(['SUBMITTED', 'PENDING_BM_REVIEW', 'PENDING_LEVEL_1']);
const AM_FROM_STATUSES  = new Set(['PENDING_AM_REVIEW', 'PENDING_LEVEL_2']);
const QC_FROM_STATUSES  = new Set(['PENDING_QC_VERIFICATION', 'PENDING_LEVEL_3']);

/**
 * For old records where bmReviewedBy / amReviewedBy are null (approved via the
 * dynamic LEVEL_APPROVE workflow before the reviewer-field fix was deployed),
 * look up who performed the action from the approval history audit log.
 */
function historyReviewer(
  history: ApprovalHistoryEntry[] | undefined,
  namedAction: string,
  levelFromStatuses: Set<string>,
): { by?: ApprovalUser; at?: string } {
  if (!history?.length) return {};

  // First try the named action (e.g. BM_COMPLETED_REVIEW)
  const byNamed = history.find(h => h.action === namedAction);
  if (byNamed) return { by: byNamed.performedBy, at: byNamed.createdAt };

  // Fall back to LEVEL_APPROVED whose previousState matches the expected from-statuses
  const byLevel = history.find(h => {
    if (h.action !== 'LEVEL_APPROVED') return false;
    try {
      const prev = JSON.parse(h.previousState ?? '{}') as { approvalStatus?: string };
      return levelFromStatuses.has(prev.approvalStatus ?? '');
    } catch { return false; }
  });
  if (byLevel) return { by: byLevel.performedBy, at: byLevel.createdAt };

  return {};
}

function buildTrail(client: TrackerClient): TrailStep[] {
  const s = client.approvalStatus;
  const hist = client.approvalHistory;

  // Use reviewer fields when available; fall back to status-based inference so that
  // clients approved via the dynamic LEVEL_APPROVE workflow (which historically did not
  // populate bmReviewedBy / amReviewedBy) still show the correct "done" state.
  const bmDone    = !!client.bmReviewedBy  || BM_DONE_STATUSES.has(s);
  const amDone    = !!client.amReviewedBy  || AM_DONE_STATUSES.has(s);
  const qcDone    = !!client.qcVerifiedBy  || QC_DONE_STATUSES.has(s);
  const adminDone = !!client.finalReviewedBy || s === 'APPROVED';

  // For steps where the reviewer field is null, look it up from the audit history
  const bmFallback    = !client.bmReviewedBy    ? historyReviewer(hist, 'BM_COMPLETED_REVIEW',  BM_FROM_STATUSES)  : {};
  const amFallback    = !client.amReviewedBy    ? historyReviewer(hist, 'AM_APPROVED_CLIENT',   AM_FROM_STATUSES)  : {};
  const qcFallback    = !client.qcVerifiedBy    ? historyReviewer(hist, 'QC_VERIFIED_CLIENT',   QC_FROM_STATUSES)  : {};
  const adminFallback = !client.finalReviewedBy ? historyReviewer(hist, 'FINAL_APPROVED_CLIENT', new Set())        : {};

  return [
    { label: 'Enrolled',           by: client.enrolledBy,                            at: client.createdAt,                                 done: true      },
    { label: 'BM Review',          by: client.bmReviewedBy    ?? bmFallback.by,      at: client.bmReviewedAt    ?? bmFallback.at,    remarks: client.bmRemarks,    done: bmDone    },
    { label: 'AM Review',          by: client.amReviewedBy    ?? amFallback.by,      at: client.amReviewedAt    ?? amFallback.at,    remarks: client.amRemarks,    done: amDone    },
    { label: 'QC Verification',    by: client.qcVerifiedBy    ?? qcFallback.by,      at: client.qcVerifiedAt    ?? qcFallback.at,    remarks: client.qcRemarks,    done: qcDone    },
    { label: 'Admin Final Review', by: client.finalReviewedBy ?? adminFallback.by,   at: client.finalReviewedAt ?? adminFallback.at, remarks: client.finalRemarks, done: adminDone },
  ];
}

// ── Cycle Trail ──────────────────────────────────────────────────────────────
// Renders the *actual* sequence of stage hops, including recheck loops, e.g.
//   FDO -> BM -> AM (Recheck) -> FDO -> BM -> AM -> QC -> Admin
// instead of one fixed slot per stage. Built directly off the audit log
// (client.approvalHistory), which the tracker API now returns for every
// stage-transition action (forward AND retake/resubmit).

const ACTION_META: Record<string, { stage: string; sub: string }> = {
  BM_COMPLETED_REVIEW:   { stage: 'BM',    sub: 'Approved'    },
  BM_RETAKE_DOCUMENT:    { stage: 'BM',    sub: 'Recheck'     },
  BM_REJECTED_CLIENT:    { stage: 'BM',    sub: 'Rejected'    },
  AM_APPROVED_CLIENT:    { stage: 'AM',    sub: 'Approved'    },
  AM_RETAKE_DOCUMENT:    { stage: 'AM',    sub: 'Recheck'     },
  AM_REJECTED_CLIENT:    { stage: 'AM',    sub: 'Rejected'    },
  QC_VERIFIED_CLIENT:    { stage: 'QC',    sub: 'Verified'    },
  QC_RETAKE_CLIENT:      { stage: 'QC',    sub: 'Recheck'     },
  QC_RETAKE_DOCUMENT:    { stage: 'QC',    sub: 'Recheck'     },
  QC_REJECTED_CLIENT:    { stage: 'QC',    sub: 'Rejected'    },
  FINAL_APPROVED_CLIENT: { stage: 'Admin', sub: 'Approved'    },
  FINAL_RETAKE_CLIENT:   { stage: 'Admin', sub: 'Recheck'     },
  FINAL_REJECTED_CLIENT: { stage: 'Admin', sub: 'Rejected'    },
  FDO_RESUBMITTED:       { stage: 'FDO',   sub: 'Resubmitted' },
  REJECTION_REVOKED:     { stage: 'Re-accessed', sub: '' },
};

const CLIENT_REJECT_ACTIONS = ['BM_REJECTED_CLIENT', 'AM_REJECTED_CLIENT', 'QC_REJECTED_CLIENT', 'FINAL_REJECTED_CLIENT', 'LEVEL_REJECTED'];

// LEVEL_APPROVED / LEVEL_RETAKE_REQUESTED / LEVEL_REJECTED (dynamic multi-level
// workflow) don't carry a fixed stage in their action name — the actual stage
// (BM/AM/QC/Admin) is inferred from the status the client was in *before* the
// action, recorded in previousState. PENDING_LEVEL_1..4 map to the named
// stages in the same order as the legacy BM -> AM -> QC -> Admin pipeline.
const LEVEL_FROM_STATUS: Record<string, string> = {
  SUBMITTED: 'BM', PENDING_BM_REVIEW: 'BM', PENDING_LEVEL_1: 'BM',
  PENDING_AM_REVIEW: 'AM', PENDING_LEVEL_2: 'AM',
  PENDING_QC_VERIFICATION: 'QC', PENDING_LEVEL_3: 'QC',
  PENDING_FINAL_REVIEW: 'Admin', PENDING_LEVEL_4: 'Admin',
};

const LEVEL_ACTION_SUB: Record<string, string> = {
  LEVEL_APPROVED: 'Approved',
  LEVEL_RETAKE_REQUESTED: 'Recheck',
  LEVEL_REJECTED: 'Rejected',
  LEVEL_RETAKE_DOCUMENT: 'Recheck',
};

// What the client is currently waiting on, given its live approvalStatus —
// appended as a trailing "Pending" node after the history-derived steps.
// A *_RETAKE_REQUIRED status always waits on FDO (to recheck & resubmit),
// not on whichever stage flagged it.
const STATUS_TO_PENDING_STAGE: Record<string, string> = {
  SUBMITTED: 'BM', PENDING_BM_REVIEW: 'BM', BM_RETAKE_REQUIRED: 'FDO',
  PENDING_AM_REVIEW: 'AM', AM_RETAKE_REQUIRED: 'FDO',
  PENDING_QC_VERIFICATION: 'QC', QC_VERIFICATION_RETAKE_REQUIRED: 'FDO',
  PENDING_FINAL_REVIEW: 'Admin', FINAL_RETAKE_REQUIRED: 'FDO',
  PENDING_LEVEL_1: 'BM',    LEVEL_1_RETAKE_REQUIRED: 'FDO',
  PENDING_LEVEL_2: 'AM',    LEVEL_2_RETAKE_REQUIRED: 'FDO',
  PENDING_LEVEL_3: 'QC',    LEVEL_3_RETAKE_REQUIRED: 'FDO',
  PENDING_LEVEL_4: 'Admin', LEVEL_4_RETAKE_REQUIRED: 'FDO',
};

interface CycleStep {
  label: string;       // e.g. "BM", "AM (Recheck)"
  by?: ApprovalUser | null;
  at?: string | null;
  remarks?: string | null;
  done: boolean;
}

/** Stage + outcome of one history entry (e.g. { stage: 'BM', sub: 'Rejected' }), or null if not a stage hop. */
function historyStageMeta(h: ApprovalHistoryEntry, stages: TrackerStage[]): { stage: string; sub: string } | null {
  let meta = ACTION_META[h.action] ? { ...ACTION_META[h.action] } : undefined;
  if (!meta && LEVEL_ACTION_SUB[h.action]) {
    let prev: { approvalStatus?: string; stage?: { stageName: string } } = {};
    try { prev = JSON.parse(h.previousState ?? '{}'); } catch { /* ignore */ }
    // Newer entries record the configured stage; older ones are inferred from status.
    const stage = prev.stage?.stageName
      ?? (stages.length > 0 && prev.approvalStatus ? stageForStatus(stages, prev.approvalStatus)?.stageName : undefined)
      ?? (prev.approvalStatus ? LEVEL_FROM_STATUS[prev.approvalStatus] : undefined);
    if (stage) meta = { stage, sub: LEVEL_ACTION_SUB[h.action] };
  }
  if (!meta) return null;
  // Dynamic workflow: name built-in BM/AM/QC steps after their configured stage.
  if (stages.length > 0 && LEGACY_LABEL_SLUG[meta.stage]) {
    meta.stage = stageBySlug(stages, LEGACY_LABEL_SLUG[meta.stage])?.stageName ?? meta.stage;
  }
  return meta;
}

function buildCycleTrail(client: TrackerClient, stages: TrackerStage[] = []): CycleStep[] {
  const hist = (client.approvalHistory ?? []).filter(h => h.action !== 'SUBMITTED');

  const raw: CycleStep[] = [
    { label: 'FDO', by: client.enrolledBy, at: client.createdAt, done: true },
  ];

  for (const h of hist) {
    const meta = historyStageMeta(h, stages);
    if (!meta) continue;
    raw.push({
      label: !meta.sub || meta.sub === 'Approved' || meta.sub === 'Verified' ? meta.stage : `${meta.stage} (${meta.sub})`,
      by: h.performedBy,
      at: h.createdAt,
      remarks: h.remarks ?? null,
      done: true,
    });
  }

  // Collapse consecutive duplicate stage+sub entries (e.g. multiple documents
  // flagged RETAKE_REQUIRED in the same review pass) into a single node —
  // one recheck event per stage visit, regardless of how many documents it covered.
  const collapsed: CycleStep[] = [];
  for (const step of raw) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.label === step.label) continue;
    collapsed.push({ ...step });
  }

  // Trailing "pending" node — what the client is currently waiting on.
  const isFinal = client.approvalStatus === 'APPROVED' || client.approvalStatus === 'REJECTED';
  const dynamicPending = stages.length === 0 || isFinal ? undefined
    : stages.some((st) => st.retakeStatus === client.approvalStatus) ? 'FDO'
    : stageForStatus(stages, client.approvalStatus)?.stageName;
  const pendingStage = isFinal
    ? null
    : dynamicPending ?? STATUS_TO_PENDING_STAGE[client.approvalStatus];
  if (pendingStage) {
    const last = collapsed[collapsed.length - 1];
    // Avoid a redundant "FDO" pending node right after an FDO step (e.g. just resubmitted).
    if (!last || last.label !== pendingStage) {
      collapsed.push({ label: pendingStage, done: false });
    }
  }

  return collapsed;
}

// Maps the stage shown on a "(Recheck)" trail node to the per-document decision
// field that records *that* stage's retake flag. Admin/Final review doesn't
// flag individual KYC documents, so it has no entry — those nodes stay inert.
const STAGE_DECISION_FIELD: Record<string, 'bmDecision' | 'amDecision' | 'qcDecision'> = {
  BM: 'bmDecision',
  AM: 'amDecision',
  QC: 'qcDecision',
};

function docLabel(documentType: string) {
  return documentType.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function docsFlaggedByStage(client: TrackerClient, stage: string, stages: TrackerStage[] = []) {
  // Dynamic workflow: `stage` is a configured stage name (any role).
  const configured = stages.find((st) => st.stageName === stage);
  if (configured) return (client.kycDocuments ?? []).filter((d) => docFlaggedForSlug(d, configured.roleSlug));
  const field = STAGE_DECISION_FIELD[stage];
  if (!field) return [];
  return (client.kycDocuments ?? []).filter((d) => d[field] === 'RETAKE_REQUIRED');
}

/** Read-only grid showing every image a stage flagged for recheck. */
function RecheckImagesDialog({
  stage, docs, onClose,
}: { stage: string | null; docs: TrackerClient['kycDocuments']; onClose: () => void }) {
  return (
    <Dialog open={!!stage} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stage} Recheck — Flagged Documents</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          {(docs ?? []).map((doc) => {
            const remark = doc.retakeReason || doc.bmRemark || doc.amRemark || doc.qcRemark;
            const isImage = doc.mimeType
              ? doc.mimeType.startsWith('image/')
              : /\.(jpg|jpeg|png|webp|gif)$/i.test(doc.fileUrl || '');
            return (
              <div key={doc.id} className="border rounded-lg overflow-hidden border-rose-300">
                <div className="px-3 py-1.5 bg-slate-50 border-b">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {docLabel(doc.documentType)}
                  </span>
                </div>
                <div className="relative h-48 bg-slate-50">
                  {doc.fileUrl && isImage ? (
                    <StorageImage src={doc.fileUrl} alt={docLabel(doc.documentType)} fill className="object-contain p-1" />
                  ) : doc.fileUrl ? (
                    <div className="flex flex-col items-center justify-center h-full gap-1">
                      <FileText className="h-8 w-8 text-slate-400" />
                      <StorageLink href={doc.fileUrl} className="text-xs underline flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" /> View file
                      </StorageLink>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-slate-400">No image</div>
                  )}
                </div>
                {remark && (
                  <p className="px-3 py-1.5 text-xs text-slate-600 border-t bg-rose-50/40">&ldquo;{remark}&rdquo;</p>
                )}
              </div>
            );
          })}
          {(!docs || docs.length === 0) && (
            <p className="col-span-full text-sm text-slate-400 text-center py-6">No flagged documents found for this stage.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalTrail({ client, colSpan }: { client: TrackerClient; colSpan: number }) {
  const stages = useContext(WorkflowStagesContext);
  const trail = buildCycleTrail(client, stages);
  const [previewStage, setPreviewStage] = useState<string | null>(null);
  return (
    <tr className="bg-[#f8fdf9] dark:bg-green-950/60">
      <td colSpan={colSpan} className="p-0">
        <div className="px-6 py-4 border-t border-brand-green-tint dark:border-sidebar-accent">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-4">
            Approval Trail
          </p>
          <div className="flex flex-wrap gap-0">
            {trail.map((step, idx) => {
              // "AM (Recheck)" -> "AM" — the stage whose flagged docs to show.
              const isRecheckStep = step.label.includes('(Recheck)');
              const recheckStage = isRecheckStep ? step.label.replace(/\s*\(Recheck\)$/, '') : null;
              const flaggedDocs = recheckStage ? docsFlaggedByStage(client, recheckStage, stages) : [];
              const isClickable = isRecheckStep && flaggedDocs.length > 0;
              return (
              <React.Fragment key={idx}>
                <div className={cn(
                  'flex flex-col items-center text-center min-w-[100px] flex-1',
                  idx < trail.length - 1 && 'after:hidden'
                )}>
                  {/* Step icon */}
                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => isClickable && setPreviewStage(recheckStage)}
                    title={isClickable ? `View ${flaggedDocs.length} flagged image(s)` : undefined}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2 z-10',
                      step.done
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                        : 'border-slate-200 bg-white dark:bg-green-950 dark:border-slate-700',
                      isClickable && 'cursor-pointer ring-2 ring-rose-200'
                    )}
                  >
                    {step.done
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : <Clock className="h-4 w-4 text-slate-300" />
                    }
                  </button>
                  {/* Connector */}
                  {idx < trail.length - 1 && (
                    <div className="absolute" />
                  )}
                  {/* Text */}
                  <p className={cn(
                    'mt-1.5 text-xs font-semibold',
                    step.done ? 'text-sidebar-accent dark:text-slate-200' : 'text-slate-400',
                    isClickable && 'underline cursor-pointer'
                  )}
                    onClick={() => isClickable && setPreviewStage(recheckStage)}
                  >
                    {step.label}
                  </p>
                  {step.done && step.by && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {userName(step.by)}
                    </p>
                  )}
                  {step.done && step.at && (
                    <p className="text-[10px] text-slate-400 mt-0.5">{fmt(step.at)}</p>
                  )}
                  {!step.done && (
                    <p className="text-[11px] text-slate-400 italic mt-0.5">Pending</p>
                  )}
                  {isClickable && (
                    <p className="text-[10px] text-rose-600 mt-0.5">
                      {flaggedDocs.length} image{flaggedDocs.length !== 1 ? 's' : ''} — click to view
                    </p>
                  )}
                  {!isRecheckStep && step.remarks && (
                    <p className="text-[10px] text-amber-600 mt-0.5 max-w-[120px] truncate" title={step.remarks}>
                      &quot;{step.remarks}&quot;
                    </p>
                  )}
                </div>
                {idx < trail.length - 1 && (
                  <div className="flex items-center justify-center mt-4 mx-1 flex-shrink-0">
                    <div className={cn(
                      'h-0.5 w-6',
                      step.done ? 'bg-emerald-300' : 'bg-slate-200 dark:bg-slate-700'
                    )} />
                  </div>
                )}
              </React.Fragment>
              );
            })}
          </div>
          {client.rejectionReason && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
              <span className="font-semibold">Rejection Reason:</span> {client.rejectionReason}
            </div>
          )}
        </div>
      </td>
      <RecheckImagesDialog
        stage={previewStage}
        docs={previewStage ? docsFlaggedByStage(client, previewStage, stages) : []}
        onClose={() => setPreviewStage(null)}
      />
    </tr>
  );
}

// ── Table Column Configs ──────────────────────────────────────────────────────

function TableHeaders({ tab }: { tab: Tab }) {
  const common = (
    <>
      <TableHead className="w-8" />
      <TableHead className="w-10 text-center">#</TableHead>
      <TableHead>Client ID</TableHead>
      <TableHead>Name</TableHead>
      <TableHead className="hidden sm:table-cell">Mobile</TableHead>
    </>
  );

  switch (tab) {
    case 'pending':
      return (
        <TableRow className="bg-amber-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Started By</TableHead>
          <TableHead>Draft Date</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      );

    case 'yet_to_approve':
      return (
        <TableRow className="bg-orange-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead className="hidden sm:table-cell">Waiting</TableHead>
          <TableHead className="hidden xl:table-cell">Enrolled By</TableHead>
        </TableRow>
      );

    case 'approved':
      return (
        <TableRow className="bg-emerald-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead className="hidden sm:table-cell">Approved By</TableHead>
          <TableHead>Approved On</TableHead>
        </TableRow>
      );

    case 'pre_disbursement':
      return (
        <TableRow className="bg-violet-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead>Loan #</TableHead>
          <TableHead className="text-right hidden sm:table-cell">Amount (₹)</TableHead>
          <TableHead>Disb. Stage</TableHead>
        </TableRow>
      );

    case 'disbursed':
      return (
        <TableRow className="bg-teal-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead>Loan #</TableHead>
          <TableHead className="text-right hidden sm:table-cell">Amount (₹)</TableHead>
          <TableHead>Disbursed On</TableHead>
        </TableRow>
      );

    case 'recheck':
      return (
        <TableRow className="bg-rose-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead>Recheck Stage</TableHead>
          <TableHead className="hidden sm:table-cell">Requested By</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      );

    case 'rejected':
      return (
        <TableRow className="bg-red-50/60 dark:bg-sidebar-accent/20">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead>Rejected By</TableHead>
          <TableHead className="hidden sm:table-cell">Reason</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      );

    // 'all'
    default:
      return (
        <TableRow className="bg-green-50 dark:bg-sidebar-accent/50">
          {common}
          <TableHead className="hidden md:table-cell">Center</TableHead>
          <TableHead className="hidden lg:table-cell">Branch</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden xl:table-cell">Enrolled On</TableHead>
        </TableRow>
      );
  }
}

function colSpanForTab(tab: Tab): number {
  switch (tab) {
    case 'pending':      return 8;
    case 'yet_to_approve': return 9;
    case 'approved':     return 9;
    case 'pre_disbursement': return 10;
    case 'disbursed':    return 10;
    case 'recheck':      return 10;
    case 'rejected':     return 10;
    default:             return 9;
  }
}

interface RowProps {
  client: TrackerClient;
  idx: number;
  tab: Tab;
  expanded: boolean;
  onToggle: () => void;
  onDeleteDraft?: (id: string) => void;
  currentUserRole?: string;
  /** Toggle the inline Re-upload panel under this row (Recheck tab, FDO only). */
  onToggleReupload?: (target: ReuploadTarget) => void;
  reuploadOpen?: boolean;
  /** Rejected tab: open the Re-access dialog (omitted when the user can't re-access). */
  onReaccess?: (client: TrackerClient) => void;
}

/** Which inline re-upload panel is open under a Recheck row. */
type ReuploadTarget = { rowId: string; clientId: string };

function ClientRow({ client, idx, tab, expanded, onToggle, onDeleteDraft, currentUserRole, onToggleReupload, reuploadOpen, onReaccess }: RowProps) {
  const stages = useContext(WorkflowStagesContext);
  const approvalStatusConfig = useApprovalStatusConfig();
  const rowBase = 'cursor-pointer transition-colors hover:bg-green-50 dark:hover:bg-sidebar-accent/30';
  const loan = client.loanApplications[0];

  const commonCells = (
    <>
      <TableCell className="pr-0 pl-3">
        {expanded
          ? <ChevronDown className="h-4 w-4 text-slate-400" />
          : <ChevronRight className="h-4 w-4 text-slate-400" />
        }
      </TableCell>
      <TableCell className="text-center text-xs text-slate-400 tabular-nums">
        {idx + 1}
      </TableCell>
      <TableCell className="font-mono text-xs font-medium text-teal-700 dark:text-teal-400">
        {client.clientId}
      </TableCell>
      <TableCell>
        <p className="font-medium text-sm leading-tight">
          {client.firstName} {client.lastName}
        </p>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-sm text-slate-500">
        {client.mobileNumber || '—'}
      </TableCell>
    </>
  );

  switch (tab) {
    case 'pending':
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-slate-500">
            {userName(client.enrolledBy)}
          </TableCell>
          <TableCell className="text-xs text-slate-500">{fmt(client.createdAt)}</TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => onDeleteDraft?.(client.id)}
              title="Delete this draft"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TableCell>
        </TableRow>
      );

    case 'yet_to_approve':
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell>
            <StatusBadge status={client.approvalStatus} config={approvalStatusConfig} />
          </TableCell>
          <TableCell className="hidden sm:table-cell text-xs text-slate-500">
            {daysSince(client.createdAt)}
          </TableCell>
          <TableCell className="hidden xl:table-cell text-sm text-slate-500">
            {userName(client.enrolledBy)}
          </TableCell>
        </TableRow>
      );

    case 'approved':
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell className="hidden sm:table-cell text-sm text-slate-500">
            {userName(client.finalReviewedBy ?? client.qcVerifiedBy ?? client.amReviewedBy ?? client.bmReviewedBy)}
          </TableCell>
          <TableCell className="text-xs text-slate-500">
            {fmt(client.finalReviewedAt ?? client.qcVerifiedAt ?? client.amReviewedAt ?? client.bmReviewedAt)}
          </TableCell>
        </TableRow>
      );

    case 'pre_disbursement':
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell className="font-mono text-xs text-teal-700 dark:text-teal-400">
            {loan?.loanNumber || '—'}
          </TableCell>
          <TableCell className="text-right hidden sm:table-cell font-medium tabular-nums text-sm">
            {loan ? Number(loan.amount).toLocaleString('en-IN') : '—'}
          </TableCell>
          <TableCell>
            {loan
              ? <StatusBadge status={loan.disbursementStatus} config={DISB_STATUS_CONFIG} />
              : <span className="text-xs text-slate-400">—</span>
            }
          </TableCell>
        </TableRow>
      );

    case 'disbursed':
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell className="font-mono text-xs text-teal-700 dark:text-teal-400">
            {loan?.loanNumber || '—'}
          </TableCell>
          <TableCell className="text-right hidden sm:table-cell font-medium tabular-nums text-sm">
            {loan ? Number(loan.amount).toLocaleString('en-IN') : '—'}
          </TableCell>
          <TableCell className="text-xs text-slate-500">
            {fmt(loan?.disbursedByBMAt)}
          </TableCell>
        </TableRow>
      );

    case 'recheck': {
      // Dynamic workflow: a configured stage's retake status (any role).
      const retakingStage = stages.find((st) => st.retakeStatus === client.approvalStatus);
      const isStageRetake = client.approvalStatus in RECHECK_WHO || !!retakingStage;
      // Document-level recheck: client status hasn't moved to a *_RETAKE_REQUIRED
      // status yet, but at least one of the member's own KYC docs was flagged.
      // (Renewal Loan re-uploads are rechecked on the Renewal Loans tab instead.)
      const docRetake = !isStageRetake ? client.kycDocuments?.[0] : undefined;
      const docRetakeLevel = !docRetake ? null
        // Dynamic workflow: latest configured stage that flagged it.
        : stages.length > 0 ? ([...stages].reverse().find((st) => docFlaggedForSlug(docRetake, st.roleSlug))?.stageName ?? null)
        : docRetake.amDecision === 'RETAKE_REQUIRED' ? 'AM'
        : docRetake.bmDecision === 'RETAKE_REQUIRED' ? 'BM'
        : docRetake.qcDecision === 'RETAKE_REQUIRED' ? 'QC'
        : null;
      const recheckWho = isStageRetake
        ? (retakingStage ? `by ${retakingStage.stageName}` : RECHECK_WHO[client.approvalStatus] ?? '')
        : (docRetakeLevel ? `by ${docRetakeLevel}` : '');
      const stageRemarksByStatus: Record<string, string | null | undefined> = {
        BM_RETAKE_REQUIRED: client.bmRemarks,
        AM_RETAKE_REQUIRED: client.amRemarks,
        QC_VERIFICATION_RETAKE_REQUIRED: client.qcRemarks,
        FINAL_RETAKE_REQUIRED: client.finalRemarks,
      };
      // Custom-role stages have no client-level remark column — use the latest
      // whole-client LEVEL_RETAKE remark from history (oldest-first list).
      const levelRetakeRemark = [...(client.approvalHistory ?? [])].reverse()
        .find((h) => h.action === 'LEVEL_RETAKE_REQUESTED')?.remarks ?? null;
      const remarks = isStageRetake
        ? (stageRemarksByStatus[client.approvalStatus] ?? (retakingStage ? levelRetakeRemark : null))
        : (docRetake?.bmRemark || docRetake?.amRemark || docRetake?.qcRemark
          || docRetake?.stageReviews?.find((r) => r.remark)?.remark || docRetake?.retakeReason || null);
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              {isStageRetake ? (
                <StatusBadge status={client.approvalStatus} config={approvalStatusConfig} />
              ) : (
                <Badge variant="outline" className="text-xs font-medium bg-rose-50 text-rose-700 border-rose-200">
                  Image Recheck
                </Badge>
              )}
              {recheckWho && (
                <span className="text-[10px] text-slate-400">{recheckWho}</span>
              )}
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell text-xs text-slate-500 max-w-[160px] truncate" title={remarks ?? ''}>
            {remarks || '—'}
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            {currentUserRole === 'FDO' ? (
              <Button
                size="sm"
                variant={reuploadOpen ? 'default' : 'outline'}
                className={cn('h-7 gap-1 px-2 text-xs', !reuploadOpen && 'text-rose-600 border-rose-200 hover:bg-rose-50')}
                onClick={() => onToggleReupload?.({ rowId: client.id, clientId: client.clientId })}
              >
                Recheck &amp; Re-upload
                {reuploadOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )}
          </TableCell>
        </TableRow>
      );
    }

    case 'rejected': {
      const lastReject = [...(client.approvalHistory ?? [])].reverse()
        .find((h) => CLIENT_REJECT_ACTIONS.includes(h.action));
      const rejectStage = lastReject ? historyStageMeta(lastReject, stages)?.stage : undefined;
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-red-700">{rejectStage ?? '—'}</span>
              {lastReject && (
                <span className="text-[10px] text-slate-400">
                  {userName(lastReject.performedBy)} · {fmt(lastReject.createdAt)}
                </span>
              )}
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell text-xs text-slate-500 max-w-[180px] truncate" title={client.rejectionReason ?? ''}>
            {client.rejectionReason || lastReject?.remarks || '—'}
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            {onReaccess ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={() => onReaccess(client)}
              >
                <Undo2 className="h-3.5 w-3.5" /> Re-access
              </Button>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )}
          </TableCell>
        </TableRow>
      );
    }

    // 'all'
    default:
      return (
        <TableRow className={rowBase} onClick={onToggle}>
          {commonCells}
          <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
            {client.center?.name || '—'}
          </TableCell>
          <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
            {client.center?.branch?.name || '—'}
          </TableCell>
          <TableCell>
            <StatusBadge status={client.approvalStatus} config={approvalStatusConfig} />
          </TableCell>
          <TableCell className="hidden xl:table-cell text-xs text-slate-500">
            {fmt(client.createdAt)}
          </TableCell>
        </TableRow>
      );
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export function LoanTrackerClient() {
  const { toast } = useToast();
  // Read on mount only — reading synchronously during render would return
  // null on the server (no localStorage) but the real user on the client's
  // first render, causing the Branch/Center filter Selects to mismatch
  // between SSR and hydration (this page has no ProtectedRoute auth gate).
  const [storedUser, setStoredUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
  useEffect(() => {
    setStoredUser(tokenStorage.getUser());
  }, []);
  const currentUserRole = storedUser?.role;
  const isAreaManager = currentUserRole === 'AREA_MANAGER';
  const canFilterByBranch = currentUserRole === 'ADMIN' || currentUserRole === 'ADMIN_NON_HO_BRANCH_SWITCH' || isAreaManager;
  const [reuploadTarget, setReuploadTarget] = useState<ReuploadTarget | null>(null);

  const [clients, setClients] = useState<TrackerClient[]>([]);
  const [tabCounts, setTabCounts] = useState<TabCounts>({
    all: 0, pending: 0, yet_to_approve: 0, approved: 0,
    pre_disbursement: 0, disbursed: 0, recheck: 0, rejected: 0,
  });
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Navigation — four top tabs; New Loan's chip picks the underlying member list
  // (approval stages → yet_to_approve, else recheck / pre_disbursement / ...).
  const [topTab, setTopTab] = useState<TopTab>('all');
  const [newLoanChip, setNewLoanChip] = useState<MemberApprovalFilter>('all');
  const activeTab: Tab = topTab !== 'new_loan' ? topTab
    : newLoanChip === 'all' ? 'new_loan'
    : NEW_LOAN_LIST_CHIPS.has(newLoanChip) ? (newLoanChip as Tab)
    : 'yet_to_approve';
  const approvalFilter: MemberApprovalFilter = activeTab === 'yet_to_approve' ? newLoanChip : 'all';
  // Configured approval-workflow stages + members waiting at each (Approval Queue chips).
  const [workflowStages, setWorkflowStages] = useState<TrackerStage[]>([]);
  const [memberStageCounts, setMemberStageCounts] = useState<Record<string, number>>({});

  // Renewal Loans tab — separate data shape (Loan-centric, not Client-centric)
  // from the rest of this page, so it gets its own state + fetch instead of
  // being shoehorned into the client-tracker's TrackerClient rows.
  const [renewalStage, setRenewalStage] = useState<MemberApprovalFilter>('all');
  const [renewalItems, setRenewalItems] = useState<RenewalTrackerItem[]>([]);
  // Keyed 'all' / 'stage:<roleSlug>' / 'admin' — the renewal chain's configured stages.
  const [renewalStageCounts, setRenewalStageCounts] = useState<Record<string, number>>({ all: 0 });
  const [renewalStages, setRenewalStages] = useState<TrackerStage[]>([]);
  const [renewalPagination, setRenewalPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalDetailId, setRenewalDetailId] = useState<string | null>(null);
  // Renewal loan whose inline re-upload panel is open (Renewal Loans → Recheck, FDO only).
  const [renewalReuploadId, setRenewalReuploadId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [centers, setCenters] = useState<CenterOption[]>([]);
  const [centerId, setCenterId] = useState('');
  const [page, setPage] = useState(1);

  const filteredCenters = branchId ? centers.filter((c) => c.branchId === branchId) : centers;

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch branches for filter — ADMIN, SUBADMIN (ADMIN_NON_HO_BRANCH_SWITCH) and
  // AREA_MANAGER only; AREA_MANAGER's list is scoped to their assigned branches
  // via AreaManagerBranch (same endpoint InlineBranchSwitcher uses) — StoredUser
  // has no `assignedBranchIds` field, so the previous read of it here was always
  // undefined and this filter never actually applied; every AM saw every branch.
  useEffect(() => {
    if (!canFilterByBranch) return;
    if (isAreaManager) {
      if (storedUser?.id) {
        apiClient.get<{ branch: Branch }[]>(`/area-manager-branches?userId=${storedUser.id}`).then((res) => {
          if (res.success && res.data) setBranches(res.data.map((a) => a.branch));
        });
      }
    } else {
      apiClient.get<Branch[]>('/branches').then((res) => {
        if (res.success && res.data) setBranches(res.data);
      });
    }
    // Server action already scopes centers to the caller's permitted branches.
    getCentersForDropdown().then(setCenters).catch(() => {});
  }, [canFilterByBranch, isAreaManager, storedUser?.id]);

  const fetchClients = useCallback(async (pg = 1) => {
    if (activeTab === 'renewal') return; // handled by fetchRenewalTracker instead
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('tab', activeTab);
      params.set('page', String(pg));
      params.set('pageSize', '20');
      if (activeTab === 'yet_to_approve' && approvalFilter !== 'all') {
        params.set('approvalFilter', approvalFilter);
      }
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (canFilterByBranch && branchId) params.set('branchId', branchId);
      if (canFilterByBranch && centerId) params.set('centerId', centerId);

      const res = await apiClient.get<{
        clients: TrackerClient[];
        tabCounts: TabCounts;
        workflowStages?: TrackerStage[];
        stageCounts?: Record<string, number>;
        pagination: Pagination;
      }>(`/clients/tracker?${params.toString()}`);

      if (res.success && res.data) {
        setClients(res.data.clients);
        setTabCounts(res.data.tabCounts);
        setWorkflowStages(res.data.workflowStages ?? []);
        setMemberStageCounts(res.data.stageCounts ?? {});
        setPagination(res.data.pagination);
        setExpandedRows(new Set());
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to fetch clients', variant: 'destructive' });
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, approvalFilter, debouncedSearch, dateFrom, dateTo, branchId, centerId, canFilterByBranch, toast]);

  // Reset page when filters or tab change
  useEffect(() => { setPage(1); }, [activeTab, approvalFilter, debouncedSearch, dateFrom, dateTo, branchId, centerId]);

  useEffect(() => {
    fetchClients(page);
  }, [fetchClients, page]);


  // ── Renewal Loans tab — its own fetch, paging and stage filter ────────────
  const fetchRenewalTracker = useCallback(async (pg = 1) => {
    if (activeTab !== 'renewal') return;
    setRenewalLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('stage', renewalStage);
      params.set('page', String(pg));
      params.set('pageSize', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (canFilterByBranch && branchId) params.set('branchId', branchId);
      if (canFilterByBranch && centerId) params.set('centerId', centerId);

      const res = await apiClient.get<{
        items: RenewalTrackerItem[];
        stages: TrackerStage[];
        stageCounts: Record<string, number>;
        pagination: Pagination;
      }>(`/loans/renewal-tracker?${params.toString()}`);

      if (res.success && res.data) {
        setRenewalItems(res.data.items);
        setRenewalStageCounts(res.data.stageCounts);
        setRenewalStages(res.data.stages ?? []);
        setRenewalPagination(res.data.pagination);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to fetch renewal loans', variant: 'destructive' });
      }
    } finally {
      setRenewalLoading(false);
    }
  }, [activeTab, renewalStage, debouncedSearch, dateFrom, dateTo, branchId, centerId, canFilterByBranch, toast]);

  useEffect(() => { if (activeTab === 'renewal') setPage(1); }, [activeTab, renewalStage]);
  useEffect(() => { setRenewalReuploadId(null); }, [activeTab, renewalStage]);

  useEffect(() => {
    fetchRenewalTracker(page);
  }, [fetchRenewalTracker, page]);

  // Reset renewal stage filter + open detail when leaving the renewal tab
  useEffect(() => {
    if (activeTab !== 'renewal') { setRenewalStage('all'); setRenewalDetailId(null); }
  }, [activeTab]);

  const handleDeleteDraft = async (id: string) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    const res = await apiClient.delete(`/clients/draft?id=${id}`);
    if (res.success) {
      toast({ title: 'Draft deleted', description: 'Draft enrollment removed.' });
      fetchClients(page);
    } else {
      toast({ title: 'Delete failed', description: res.error || 'Could not delete draft.', variant: 'destructive' });
    }
  };

  // ── Re-access a rejected member / renewal loan → back to the stage that rejected it ──
  const canReaccess = ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'].includes(currentUserRole ?? '') || !!storedUser?.isSubAdmin;
  const [reaccessTarget, setReaccessTarget] = useState<ReaccessTarget | null>(null);
  const [reaccessRemarks, setReaccessRemarks] = useState('');
  const [isReaccessing, setIsReaccessing] = useState(false);

  const handleReaccess = async () => {
    if (!reaccessTarget || !reaccessRemarks.trim()) return;
    setIsReaccessing(true);
    try {
      const res = await apiClient.post<{ newStatus: string; returnedToRejectingStage: boolean }>(
        reaccessTarget.kind === 'client'
          ? `/approval/clients/${encodeURIComponent(reaccessTarget.clientId)}/reaccess`
          : `/approval/loans/${encodeURIComponent(reaccessTarget.loanId)}/renewal-reaccess`,
        { remarks: reaccessRemarks.trim() }
      );
      if (res.success && res.data) {
        const name = reaccessTarget.kind === 'client' ? reaccessTarget.name : `Renewal ${reaccessTarget.loanNumber} (${reaccessTarget.name})`;
        toast({
          title: reaccessTarget.kind === 'client' ? 'Member re-accessed' : 'Renewal loan re-accessed',
          description: res.data.returnedToRejectingStage
            ? `${name} is back in the approval queue at the stage that rejected them.`
            : `${name} restarted at the first approval stage (the rejecting stage is no longer in the workflow).`,
        });
        if (reaccessTarget.kind === 'client') fetchClients(page); else fetchRenewalTracker(page);
        setReaccessTarget(null);
        setReaccessRemarks('');
      } else {
        toast({ title: 'Re-access failed', description: res.error || 'Could not re-access.', variant: 'destructive' });
      }
    } finally {
      setIsReaccessing(false);
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const hasFilters = useMemo(
    () => !!(search || dateFrom || dateTo || branchId || centerId),
    [search, dateFrom, dateTo, branchId, centerId]
  );

  const clearFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setBranchId('');
    setCenterId('');
  };

  const activeTabMeta = TABS.find((t) => t.id === activeTab)!;

  // Approval Queue / Renewal Loans chips: one per configured workflow stage (any
  // role, configured order) + Admin. Renewal stages come from its own tracker API
  // (legacy BM -> AM -> QC when no workflow is configured).
  // New Loan and Renewal Loan share one chip row: All Stages → each stage → Admin →
  // Recheck → Pre-Disbursement → Disbursed → Rejected.
  const isRenewalTab = topTab === 'renewal';
  const chipStages = isRenewalTab ? renewalStages : workflowStages;
  const LIST_CHIPS = [RENEWAL_RECHECK_FILTER, ...RENEWAL_DISBURSEMENT_FILTERS, REJECTED_FILTER];
  const stageFilters: { id: MemberApprovalFilter; label: string; color: string }[] =
    chipStages.length > 0
      ? [
          APPROVAL_FILTERS[0],
          ...chipStages.map((st, i) => ({
            id: `stage:${st.roleSlug}` as MemberApprovalFilter,
            label: st.stageName,
            color: STAGE_PALETTE[i % STAGE_PALETTE.length].chip,
          })),
          APPROVAL_FILTERS.find((f) => f.id === 'admin')!,
          ...LIST_CHIPS,
        ]
      : [...APPROVAL_FILTERS, ...LIST_CHIPS];
  const activeChip = isRenewalTab ? renewalStage : newLoanChip;
  const setActiveChip = isRenewalTab ? setRenewalStage : setNewLoanChip;
  const chipCount = (id: MemberApprovalFilter) => isRenewalTab
    ? renewalStageCounts[id] ?? 0
    : NEW_LOAN_LIST_CHIPS.has(id) ? tabCounts[id as keyof TabCounts] ?? 0 : memberStageCounts[id] ?? 0;

  return (
    <WorkflowStagesContext.Provider value={workflowStages}>
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground dark:text-white flex items-center gap-2">
            <Activity className="h-6 w-6 text-teal-600" />
            Client Loan Tracker
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Track customers across all stages — enrollment to disbursement
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <Button variant="outline" size="sm" onClick={() => setIsExportOpen(true)}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Export Approved
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchClients(page)}
            disabled={isLoading}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <ApprovedExportDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        branches={branches}
        canFilterByBranch={canFilterByBranch}
      />

      {/* ── Tab Navigation ── */}
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <Tabs value={topTab} onValueChange={(v) => { setTopTab(v as TopTab); setNewLoanChip('all'); }}>
          <TabsList className="h-auto p-1 bg-green-50 dark:bg-brand-green-darker/60 border border-brand-green-tint dark:border-sidebar-accent gap-0.5 flex-nowrap w-max min-w-full sm:w-auto">
            {TOP_TABS.map((t) => {
              const Icon = t.icon;
              const count = t.id === 'renewal' ? renewalStageCounts.all : (tabCounts[t.id] ?? 0);
              const isActive = topTab === t.id;
              return (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-all whitespace-nowrap',
                    'data-[state=active]:shadow-sm',
                    isActive ? t.activeColor : `${t.color} hover:bg-white/60 dark:hover:bg-white/5`
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{t.label}</span>
                  {count > 0 && (
                    <span className={cn(
                      'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none min-w-[18px]',
                      isActive ? 'bg-current/20' : 'bg-current/10'
                    )}>
                      {formatCompactCount(count)}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      {renewalDetailId ? (
        <RenewalLoanDetail
          loanId={renewalDetailId}
          onBack={() => setRenewalDetailId(null)}
          onDone={() => { setRenewalDetailId(null); fetchRenewalTracker(page); }}
          readOnly
        />
      ) : (
      <>
      {/* ── Sub-filters (New Loan / Renewal Loan only) ── */}
      {(topTab === 'new_loan' || topTab === 'renewal') && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Filter by approval stage:</span>
          {stageFilters.map((f) => (
            <button
              key={f.id}
              data-active={activeChip === f.id}
              onClick={() => setActiveChip(f.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                f.color
              )}
            >
              {f.label}
              {f.id !== 'all' && countBadge(chipCount(f.id))}
            </button>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      <Card className="border-brand-green-tint dark:border-sidebar-accent">
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search */}
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Client ID, name, Aadhaar or mobile..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Date From */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <DateInput
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Date To */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <DateInput
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Branch (ADMIN / SUBADMIN / AREA_MANAGER only) */}
            {canFilterByBranch && (
              <Select
                value={branchId || 'all'}
                onValueChange={(v) => { setBranchId(v === 'all' ? '' : v); setCenterId(''); }}
              >
                <SelectTrigger>
                  <Building2 className="mr-2 h-4 w-4 text-slate-400 shrink-0" />
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Center (ADMIN / SUBADMIN / AREA_MANAGER only) */}
            {canFilterByBranch && (
              <div className="flex gap-2">
                <Select value={centerId || 'all'} onValueChange={(v) => setCenterId(v === 'all' ? '' : v)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="All Centers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Centers</SelectItem>
                    {filteredCenters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0 text-slate-500 hover:text-sidebar-accent">
                    Clear
                  </Button>
                )}
              </div>
            )}

            {!canFilterByBranch && hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0 text-slate-500 hover:text-sidebar-accent self-start">
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Table Card ── */}
      <Card className="border-brand-green-tint dark:border-sidebar-accent">
        {/* Card header with active tab context */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-brand-green-tint dark:border-sidebar-accent">
          <div className="flex items-center gap-2">
            {React.createElement(activeTabMeta.icon, {
              className: cn('h-4 w-4', activeTabMeta.color),
            })}
            <span className="font-semibold text-sm text-foreground dark:text-white">
              {activeTabMeta.label}
            </span>
            <span className="text-sm text-slate-400">
              ({(activeTab === 'renewal' ? renewalPagination.total : pagination.total)} record{(activeTab === 'renewal' ? renewalPagination.total : pagination.total) !== 1 ? 's' : ''})
            </span>
          </div>
        </div>

        <CardContent className="p-0">
          {activeTab === 'renewal' ? (
            renewalLoading ? (
              <PageLoader label="Loading renewal loans…" fullScreen={false} />
            ) : renewalItems.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <Repeat className="mx-auto h-10 w-10 mb-3 text-cyan-500 opacity-30" />
                <p className="font-semibold text-slate-600 dark:text-slate-300">No renewal loans found</p>
                <p className="text-sm mt-1 text-slate-400">
                  {hasFilters ? 'Try adjusting your filters' : 'No renewal loan applications at this stage'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-cyan-50/60 dark:bg-sidebar-accent/20">
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Mobile</TableHead>
                      <TableHead className="hidden md:table-cell">Center</TableHead>
                      <TableHead className="hidden lg:table-cell">Branch</TableHead>
                      <TableHead>Loan #</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Amount (₹)</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="hidden xl:table-cell">FDO</TableHead>
                      <TableHead className="hidden xl:table-cell">Applied On</TableHead>
                      {renewalStage === 'disbursed' && <TableHead className="hidden sm:table-cell">Disbursed On</TableHead>}
                      {renewalStage === 'recheck' && <TableHead className="hidden sm:table-cell">Remarks</TableHead>}
                      {(renewalStage === 'rejected' || renewalStage === 'recheck') && <TableHead>Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renewalItems.map((item, idx) => (
                      <React.Fragment key={item.id}>
                      <TableRow
                        className="cursor-pointer transition-colors hover:bg-cyan-50 dark:hover:bg-sidebar-accent/30"
                        onClick={() => setRenewalDetailId(item.id)}
                      >
                        <TableCell className="text-center text-xs text-slate-400 tabular-nums">
                          {(page - 1) * renewalPagination.pageSize + idx + 1}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-teal-700 dark:text-teal-400">
                          {item.clientDisplayId}
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[120px] max-w-[200px]">
                          <p className="font-medium text-sm leading-tight">{item.clientName}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-500">
                          {item.mobileNumber || '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-sidebar-accent dark:text-slate-300 whitespace-normal min-w-[140px] max-w-[220px]">
                          {item.centerName || '—'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
                          {item.branchName || '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-teal-700 dark:text-teal-400">
                          {item.loanNumber}
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell font-medium tabular-nums text-sm">
                          {item.amount.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell>
                          {isRenewalDisbursementFilter(renewalStage) ? (
                            <StatusBadge status={item.disbursementStatus} config={DISB_STATUS_CONFIG} />
                          ) : item.recheck?.documentOnly ? (
                            <Badge variant="outline" className="text-xs font-medium bg-rose-50 text-rose-700 border-rose-200">
                              Image Recheck
                            </Badge>
                          ) : (
                            <StatusBadge status={item.renewalApprovalStatus} config={RENEWAL_STATUS_CONFIG} />
                          )}
                          {item.recheck?.by && (
                            <span className="ml-1 text-[10px] text-slate-400">by {item.recheck.by}</span>
                          )}
                          {item.rejection && (
                            <div className="mt-1 text-[10px] leading-tight text-slate-500 max-w-[200px]">
                              <span className="font-semibold text-red-700">by {item.rejection.stageName}</span>
                              {' · '}{item.rejection.by} · {fmt(item.rejection.at)}
                              {item.rejection.remarks && (
                                <p className="truncate" title={item.rejection.remarks}>{item.rejection.remarks}</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-sm text-slate-500 whitespace-normal min-w-[110px] max-w-[170px]">
                          {item.fdoName || '—'}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell text-xs text-slate-500">
                          {fmt(item.createdAt)}
                        </TableCell>
                        {renewalStage === 'rejected' && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {canReaccess && item.renewalApprovalStatus === 'REJECTED' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                onClick={() => setReaccessTarget({ kind: 'renewal', loanId: item.id, loanNumber: item.loanNumber, name: item.clientName })}
                              >
                                <Undo2 className="h-3.5 w-3.5" /> Re-access
                              </Button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                        )}
                        {renewalStage === 'disbursed' && (
                          <TableCell className="hidden sm:table-cell text-xs text-slate-500">
                            {fmt(item.disbursedAt)}
                          </TableCell>
                        )}
                        {renewalStage === 'recheck' && (
                          <TableCell className="hidden sm:table-cell text-xs text-slate-500 max-w-[160px] truncate" title={item.recheck?.remarks ?? ''}>
                            {item.recheck?.remarks || '—'}
                          </TableCell>
                        )}
                        {renewalStage === 'recheck' && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {currentUserRole === 'FDO' ? (
                                <Button
                                  size="sm"
                                  variant={renewalReuploadId === item.id ? 'default' : 'outline'}
                                  className={cn('h-7 gap-1 px-2 text-xs', renewalReuploadId !== item.id && 'text-rose-600 border-rose-200 hover:bg-rose-50')}
                                  onClick={() => setRenewalReuploadId((prev) => (prev === item.id ? null : item.id))}
                                >
                                  Renewal Re-upload
                                  {renewalReuploadId === item.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </TableCell>
                        )}
                      </TableRow>
                      {renewalStage === 'recheck' && renewalReuploadId === item.id && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={13} className="bg-muted/30 p-3 sm:p-4">
                            <FDORenewalRecheckPanel
                              loanId={item.id}
                              onClose={() => setRenewalReuploadId(null)}
                              onResubmitted={() => { setRenewalReuploadId(null); fetchRenewalTracker(page); }}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : isLoading ? (
            <PageLoader label="Loading clients…" fullScreen={false} />
          ) : clients.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              {React.createElement(activeTabMeta.icon, {
                className: cn('mx-auto h-10 w-10 mb-3', activeTabMeta.color, 'opacity-30'),
              })}
              <p className="font-semibold text-slate-600 dark:text-slate-300">No clients found</p>
              <p className="text-sm mt-1 text-slate-400">
                {hasFilters ? 'Try adjusting your filters' : `No ${activeTabMeta.label.toLowerCase()} clients yet`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableHeaders tab={activeTab} />
                </TableHeader>
                <TableBody>
                  {clients.map((client, idx) => {
                    const expanded = expandedRows.has(client.id);
                    return (
                      <React.Fragment key={client.id}>
                        <ClientRow
                          client={client}
                          idx={(page - 1) * pagination.pageSize + idx}
                          tab={activeTab}
                          expanded={expanded}
                          onToggle={() => toggleRow(client.id)}
                          onDeleteDraft={activeTab === 'pending' ? handleDeleteDraft : undefined}
                          currentUserRole={currentUserRole}
                          onToggleReupload={(target) => setReuploadTarget((prev) => (prev?.rowId === target.rowId ? null : target))}
                          reuploadOpen={reuploadTarget?.rowId === client.id}
                          onReaccess={activeTab === 'rejected' && canReaccess
                            ? (c) => setReaccessTarget({ kind: 'client', clientId: c.clientId, name: `${c.firstName} ${c.lastName}`.trim() })
                            : undefined}
                        />
                        {activeTab === 'recheck' && reuploadTarget?.rowId === client.id && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={colSpanForTab(activeTab)} className="bg-muted/30 p-3 sm:p-4">
                              <FDORecheckPanel
                                clientId={reuploadTarget.clientId}
                                onClose={() => setReuploadTarget(null)}
                                onResubmitted={() => { setReuploadTarget(null); fetchClients(page); }}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                        {expanded && (
                          <ApprovalTrail
                            client={client}
                            colSpan={colSpanForTab(activeTab)}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      {(() => {
        const activePagination = activeTab === 'renewal' ? renewalPagination : pagination;
        const activeLoading = activeTab === 'renewal' ? renewalLoading : isLoading;
        if (activePagination.totalPages <= 1) return null;
        return (
          <div className="flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
            <span>
              Page {activePagination.page} of {activePagination.totalPages} &nbsp;·&nbsp; {activePagination.total} records
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || activeLoading}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= activePagination.totalPages || activeLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </Button>
            </div>
          </div>
        );
      })()}
      </>
      )}

      {/* ── Re-access rejected member ── */}
      <Dialog
        open={!!reaccessTarget}
        onOpenChange={(open) => { if (!open && !isReaccessing) { setReaccessTarget(null); setReaccessRemarks(''); } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{reaccessTarget?.kind === 'renewal' ? 'Re-access Rejected Renewal Loan' : 'Re-access Rejected Member'}</DialogTitle>
            <DialogDescription>
              {reaccessTarget?.kind === 'client' && (
                <>
                  {reaccessTarget.name} ({reaccessTarget.clientId}) will go back to the approval stage that
                  rejected them and must be reviewed again there.
                </>
              )}
              {reaccessTarget?.kind === 'renewal' && (
                <>
                  Renewal loan {reaccessTarget.loanNumber} for {reaccessTarget.name} will go back to the approval
                  stage that rejected it and must be reviewed again there.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label htmlFor="reaccess-remarks" className="text-sm font-medium">Remarks <span className="text-red-500">*</span></label>
            <Textarea
              id="reaccess-remarks"
              value={reaccessRemarks}
              onChange={(e) => setReaccessRemarks(e.target.value)}
              placeholder="Why is this member being re-accessed?"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReaccessTarget(null); setReaccessRemarks(''); }} disabled={isReaccessing}>
              Cancel
            </Button>
            <Button onClick={handleReaccess} disabled={isReaccessing || !reaccessRemarks.trim()}>
              {isReaccessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Re-access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DashboardFooter />
    </div>
    </WorkflowStagesContext.Provider>
  );
}
